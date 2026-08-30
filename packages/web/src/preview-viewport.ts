// Preview zoom, pan, and fit for a PerspectiveEditor inside a clipping mount.
// The viewport owns only presentation (element sizing and translation); all
// geometry and gestures stay normalized, so pointer interactions keep working
// at any zoom level without knowing about it.

import type { DistortGestureEvent, PerspectiveEditor } from "./editor";
import { observePointerSessionBoundary } from "./pointer-session";

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.25;
const MAX_FIT_UPSCALE = 4;
const CONTROL_SCALE_PROPERTY = "--worldbend-viewport-control-scale";
// Corner buttons are 32 px in the Figma surface. Keeping their centers at
// least 16 px inside the mount leaves the full hit target reachable.
const CORNER_REVEAL_MARGIN = 16;
// The outer strip is an interaction zone, not extra permanent padding. Once a
// captured Distort pointer enters it, the compositor camera follows fast
// outward drags without clipping the canonical geometry.
const EDGE_AUTO_PAN_ZONE = 48;
const EDGE_AUTO_PAN_MAX_SPEED = 720;
const EDGE_AUTO_PAN_MAX_FRAME_MS = 34;
// A Perspective camera correction expands the linked pair at twice the
// single-corner screen rate: the partner moves away while the camera follows
// the grabbed corner. Normalize that assistance and require a fresh pointer
// sample for every step so holding still at an edge cannot run away.
const PERSPECTIVE_EDGE_ASSIST_FACTOR = 0.5;
// Fraction of the smaller content/viewport dimension that must stay visible
// on each axis when clamping a manual pan offset.
const VISIBLE_KEEP_FRACTION = 0.25;

export interface PreviewViewportHandle {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  /** Restore a 1:1 display pixel per preview pixel scale. */
  resetScale(): void;
  /** Re-anchor after the preview canvas itself changed size (fit or center). */
  handleCanvasResized(): void;
  /** Keep all four corner centers visible without zooming in. */
  revealAllCorners(options?: { animate?: boolean }): void;
  /** Track live Distort ownership and bounded edge auto-pan. */
  handleDistortGesture(event: DistortGestureEvent): void;
  /** Position a tight output canvas inside the stable transform scene. */
  setSceneOffset(offset: { x: number; y: number }): void;
  /** Space-key state: while active, pointer drags pan instead of gesturing. */
  setPanActive(active: boolean): void;
  scale(): number;
  dispose(): void;
}

export interface PreviewViewportOptions {
  onScaleChange?: (scale: number) => void;
}

export function createPreviewViewport(
  editor: PerspectiveEditor,
  mount: HTMLElement,
  options: PreviewViewportOptions = {},
): PreviewViewportHandle {
  const element = editor.element;
  const previousMountPosition = mount.style.position;
  const previousElementStyle = {
    position: element.style.position,
    left: element.style.left,
    top: element.style.top,
    width: element.style.width,
    height: element.style.height,
    maxWidth: element.style.maxWidth,
    maxHeight: element.style.maxHeight,
    transform: element.style.transform,
    transformOrigin: element.style.transformOrigin,
    willChange: element.style.willChange,
    controlScale: element.style.getPropertyValue?.(CONTROL_SCALE_PROPERTY) ?? "",
  };
  if (getComputedStyle(mount).position === "static") mount.style.position = "relative";
  element.style.position = "absolute";
  element.style.left = "0";
  element.style.top = "0";
  element.style.maxWidth = "none";
  element.style.maxHeight = "none";
  element.style.transformOrigin = "0 0";
  element.style.willChange = "transform";
  const previousCanvasStyle = {
    width: editor.canvas.style.width,
    height: editor.canvas.style.height,
    maxWidth: editor.canvas.style.maxWidth,
    maxHeight: editor.canvas.style.maxHeight,
  };
  editor.canvas.style.width = "100%";
  editor.canvas.style.height = "100%";
  editor.canvas.style.maxWidth = "none";
  editor.canvas.style.maxHeight = "none";

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let sceneOffsetX = 0;
  let sceneOffsetY = 0;
  let fitLocked = true;
  let panActive = false;
  let panCleanup: (() => void) | undefined;
  let settleAnimation: Animation | undefined;
  let disposed = false;
  let lastSpace = { width: 1, height: 1 };
  let lastContent = { width: 1, height: 1 };
  let distortGesture:
    | {
      pointerId: number;
      client: { x: number; y: number };
      perspective: boolean;
      axis: "horizontal" | "vertical" | undefined;
      direction: { x: number; y: number };
      startOffset: { x: number; y: number };
      previousTime: number | undefined;
    }
    | undefined;
  let autoPanFrame: number | undefined;
  let wheelFrame: number | undefined;
  let wheelDelta = 0;
  let wheelAnchor = { x: 0, y: 0 };
  let cachedSpace = { width: 1, height: 1, left: 0, top: 0 };
  let cachedMountRect = { left: 0, top: 0, width: 1, height: 1 };

  const notifyScale = (): void => options.onScaleChange?.(scale);

  function cancelSettleAnimation(): void {
    settleAnimation?.cancel();
    settleAnimation = undefined;
  }

  function cancelAutoPan(): void {
    if (autoPanFrame !== undefined) cancelAnimationFrame(autoPanFrame);
    autoPanFrame = undefined;
  }

  function refreshMountGeometry(): void {
    const style = getComputedStyle(mount);
    const left = pixels(style.paddingLeft);
    const right = pixels(style.paddingRight);
    const top = pixels(style.paddingTop);
    const bottom = pixels(style.paddingBottom);
    cachedSpace = {
      width: Math.max(0, mount.clientWidth - left - right),
      height: Math.max(0, mount.clientHeight - top - bottom),
      left,
      top,
    };
    const rect = mount.getBoundingClientRect();
    cachedMountRect = {
      left: rect.left,
      top: rect.top,
      width: mount.clientWidth,
      height: mount.clientHeight,
    };
    // Insets change only with host layout, so publish them after the grouped
    // reads instead of rewriting left/top on every camera frame.
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function available(): { width: number; height: number; left: number; top: number } {
    return cachedSpace;
  }

  function contentSize(): { width: number; height: number } {
    const display = editor.getDisplaySize();
    return {
      width: Math.max(1, display.width) * scale,
      height: Math.max(1, display.height) * scale,
    };
  }

  function effectiveSceneOffset(): { x: number; y: number } {
    const workspace = editor.getWorkspaceDisplayOffset();
    return {
      x: sceneOffsetX + workspace.x,
      y: sceneOffsetY + workspace.y,
    };
  }

  function sceneTranslation(): { x: number; y: number } {
    const scene = effectiveSceneOffset();
    return { x: scene.x * scale, y: scene.y * scale };
  }

  function layout(): void {
    if (disposed) return;
    const space = available();
    const display = editor.getDisplaySize();
    // Keep zoom on the compositor. Resizing the canvas and SVG for every
    // camera tick forces layout and paint precisely while the pointer is hot.
    element.style.width = `${Math.max(1, display.width)}px`;
    element.style.height = `${Math.max(1, display.height)}px`;
    // The canvas, overlay, and control coordinates share one compositor
    // transform. Counter-scale only the interactive controls in CSS so their
    // visual and hit targets stay in screen pixels at every camera zoom.
    element.style.setProperty(CONTROL_SCALE_PROPERTY, `${1 / scale}`);
    const scene = sceneTranslation();
    element.style.transform =
      `translate3d(${offsetX + scene.x}px, ${offsetY + scene.y}px, 0) scale(${scale})`;
    lastSpace = { width: space.width, height: space.height };
    lastContent = contentSize();
  }

  function clampOffsets(): void {
    const space = available();
    const size = contentSize();
    const keepX = Math.min(size.width, space.width) * VISIBLE_KEEP_FRACTION;
    const keepY = Math.min(size.height, space.height) * VISIBLE_KEEP_FRACTION;
    const scene = sceneTranslation();
    const visualX = clamp(offsetX + scene.x, keepX - size.width, space.width - keepX);
    const visualY = clamp(offsetY + scene.y, keepY - size.height, space.height - keepY);
    offsetX = visualX - scene.x;
    offsetY = visualY - scene.y;
  }

  function centerOffsets(): void {
    const space = available();
    const size = contentSize();
    const scene = sceneTranslation();
    offsetX = (space.width - size.width) / 2 - scene.x;
    offsetY = (space.height - size.height) / 2 - scene.y;
  }

  function preserveViewportCenter(): void {
    cancelSettleAnimation();
    const nextSpace = available();
    const nextContent = contentSize();
    const scene = sceneTranslation();
    const focusX = lastContent.width > 0
      ? (lastSpace.width / 2 - offsetX - scene.x) / lastContent.width
      : 0.5;
    const focusY = lastContent.height > 0
      ? (lastSpace.height / 2 - offsetY - scene.y) / lastContent.height
      : 0.5;
    offsetX = nextSpace.width / 2 - focusX * nextContent.width - scene.x;
    offsetY = nextSpace.height / 2 - focusY * nextContent.height - scene.y;
    clampOffsets();
    layout();
  }

  function autoPanVelocity(): { x: number; y: number } {
    if (!distortGesture) return { x: 0, y: 0 };
    const localX = distortGesture.client.x - cachedMountRect.left;
    const localY = distortGesture.client.y - cachedMountRect.top;
    const allowX = !distortGesture.perspective || distortGesture.axis === "horizontal";
    const allowY = !distortGesture.perspective || distortGesture.axis === "vertical";
    const x = allowX ? edgeCameraVelocity(localX, cachedMountRect.width) : 0;
    const y = allowY ? edgeCameraVelocity(localY, cachedMountRect.height) : 0;
    const factor = distortGesture.perspective ? PERSPECTIVE_EDGE_ASSIST_FACTOR : 1;
    return {
      x: x * distortGesture.direction.x < 0 ? x * factor : 0,
      y: y * distortGesture.direction.y < 0 ? y * factor : 0,
    };
  }

  function scheduleAutoPan(): void {
    if (autoPanFrame !== undefined || !distortGesture || disposed) return;
    const velocity = autoPanVelocity();
    if (velocity.x === 0 && velocity.y === 0) {
      distortGesture.previousTime = undefined;
      return;
    }
    autoPanFrame = requestAnimationFrame(stepAutoPan);
  }

  function stepAutoPan(time: number): void {
    autoPanFrame = undefined;
    const gesture = distortGesture;
    if (!gesture || disposed) return;
    const velocity = autoPanVelocity();
    if (velocity.x === 0 && velocity.y === 0) {
      gesture.previousTime = undefined;
      return;
    }
    const elapsed = gesture.previousTime === undefined
      ? 1000 / 60
      : clamp(time - gesture.previousTime, 0, EDGE_AUTO_PAN_MAX_FRAME_MS);
    gesture.previousTime = time;
    offsetX += velocity.x * elapsed / 1000;
    offsetY += velocity.y * elapsed / 1000;
    clampOffsets();
    const translation = {
      x: offsetX - gesture.startOffset.x,
      y: offsetY - gesture.startOffset.y,
    };
    // The editor re-samples and synchronously positions its controls before
    // this layout publishes the matching compositor camera transform.
    if (!editor.updateActiveDistortCamera(gesture.pointerId, translation)) {
      distortGesture = undefined;
      return;
    }
    layout();
    if (gesture.perspective) {
      // Perspective consumes one bounded camera step per meaningful pointer
      // sample. Free Distort retains traditional sustained edge following.
      gesture.previousTime = undefined;
    } else {
      scheduleAutoPan();
    }
  }

  function applyScale(next: number, anchor?: { x: number; y: number }): void {
    cancelSettleAnimation();
    // Recovery may place the camera below the ordinary 10% zoom floor. From
    // there, Zoom Out stays inert while Zoom In returns in gradual steps
    // instead of jumping abruptly back to 10%.
    const clamped = clamp(next, Math.min(MIN_SCALE, scale), MAX_SCALE);
    if (clamped === scale) return;
    if (anchor) {
      // Keep the content point under the anchor stationary.
      const scene = effectiveSceneOffset();
      const contentX = (anchor.x - offsetX) / scale - scene.x;
      const contentY = (anchor.y - offsetY) / scale - scene.y;
      scale = clamped;
      offsetX = anchor.x - (contentX + scene.x) * scale;
      offsetY = anchor.y - (contentY + scene.y) * scale;
    } else {
      scale = clamped;
    }
    fitLocked = false;
    clampOffsets();
    layout();
    notifyScale();
  }

  function fit(): void {
    cancelSettleAnimation();
    const space = available();
    const display = editor.getDisplaySize();
    const width = Math.max(1, display.width);
    const height = Math.max(1, display.height);
    if (space.width <= 0 || space.height <= 0) return;
    const raw = Math.min(space.width / width, space.height / height);
    scale = positiveScale(Math.min(raw, MAX_FIT_UPSCALE), scale);
    fitLocked = true;
    centerOffsets();
    layout();
    notifyScale();
  }

  function revealAllCorners(revealOptions: { animate?: boolean } = {}): void {
    cancelSettleAnimation();
    const space = available();
    if (space.width <= 0 || space.height <= 0) return;
    const bounds = editor.getQuadDisplayBounds();
    const scene = sceneTranslation();
    const visualX = offsetX + scene.x;
    const visualY = offsetY + scene.y;
    const left = visualX + bounds.x * scale;
    const right = left + bounds.width * scale;
    const top = visualY + bounds.y * scale;
    const bottom = top + bounds.height * scale;
    if (
      left >= CORNER_REVEAL_MARGIN &&
      right <= space.width - CORNER_REVEAL_MARGIN &&
      top >= CORNER_REVEAL_MARGIN &&
      bottom <= space.height - CORNER_REVEAL_MARGIN
    ) {
      return;
    }

    const widthScale = bounds.width > 0
      ? (space.width - CORNER_REVEAL_MARGIN * 2) / bounds.width
      : scale;
    const heightScale = bounds.height > 0
      ? (space.height - CORNER_REVEAL_MARGIN * 2) / bounds.height
      : scale;
    const previousScale = scale;
    // Fit/recovery is a reachability action, not an ordinary zoom step. It may
    // cross the manual 10% floor so an extreme but finite outward transform
    // cannot strand its controls outside the viewport.
    const nextScale = positiveScale(Math.min(scale, widthScale, heightScale), scale);
    const scaleChanged = nextScale !== scale;
    scale = nextScale;
    fitLocked = false;

    const target = editor.getTargetDisplaySize();
    const workspace = editor.getWorkspaceDisplayOffset();
    const referenceCenter = {
      x: -workspace.x + target.width / 2,
      y: -workspace.y + target.height / 2,
    };
    const nextScene = sceneTranslation();
    const desiredVisualX = space.width / 2 - referenceCenter.x * scale;
    const desiredVisualY = space.height / 2 - referenceCenter.y * scale;
    const minimumVisualX = CORNER_REVEAL_MARGIN - bounds.x * scale;
    const maximumVisualX =
      space.width - CORNER_REVEAL_MARGIN - (bounds.x + bounds.width) * scale;
    const minimumVisualY = CORNER_REVEAL_MARGIN - bounds.y * scale;
    const maximumVisualY =
      space.height - CORNER_REVEAL_MARGIN - (bounds.y + bounds.height) * scale;
    const resolvedVisualX = minimumVisualX <= maximumVisualX
      ? clamp(desiredVisualX, minimumVisualX, maximumVisualX)
      : (space.width - (bounds.x * 2 + bounds.width) * scale) / 2;
    const resolvedVisualY = minimumVisualY <= maximumVisualY
      ? clamp(desiredVisualY, minimumVisualY, maximumVisualY)
      : (space.height - (bounds.y * 2 + bounds.height) * scale) / 2;
    offsetX = resolvedVisualX - nextScene.x;
    offsetY = resolvedVisualY - nextScene.y;
    clampOffsets();
    const previousTransform = element.style.transform;
    layout();
    if (scaleChanged) notifyScale();
    if (
      revealOptions.animate &&
      previousTransform !== element.style.transform &&
      typeof element.animate === "function" &&
      !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
    ) {
      const animation = element.animate(
        [
          { transform: previousTransform },
          { transform: element.style.transform },
        ],
        {
          duration: recoveryAnimationDuration(previousScale, scale),
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        },
      );
      settleAnimation = animation;
      animation.onfinish = () => {
        if (settleAnimation === animation) settleAnimation = undefined;
      };
      animation.oncancel = animation.onfinish;
    }
  }

  function onWheel(event: WheelEvent): void {
    if (disposed) return;
    event.preventDefault();
    wheelDelta += event.deltaY;
    wheelAnchor = { x: event.clientX, y: event.clientY };
    if (wheelFrame !== undefined) return;
    // One geometry snapshot and one compositor update per paint even when a
    // trackpad delivers several wheel samples inside the same frame.
    refreshMountGeometry();
    wheelFrame = requestAnimationFrame(() => {
      wheelFrame = undefined;
      const delta = wheelDelta;
      wheelDelta = 0;
      const space = available();
      applyScale(scale * Math.exp(-delta * 0.002), {
        x: wheelAnchor.x - cachedMountRect.left - space.left,
        y: wheelAnchor.y - cachedMountRect.top - space.top,
      });
    });
  }

  // A capture-phase pan grab wins over the editor's surface gestures while
  // the space key is held, matching the Free Transform pan convention.
  function onPanPointerDown(event: PointerEvent): void {
    if (!panActive || disposed || event.button !== 0 || panCleanup) return;
    // Overlay controls sharing the mount (zoom buttons) keep their clicks.
    if (isFormControlTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      mount.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const last = { x: event.clientX, y: event.clientY };
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      // Figma can return focus to the iframe after losing the external
      // pointer-up. A move with no pressed buttons is the first trustworthy
      // signal that this pan no longer owns a pointer.
      if (moveEvent.buttons === 0) {
        detach();
        return;
      }
      offsetX += moveEvent.clientX - last.x;
      offsetY += moveEvent.clientY - last.y;
      last.x = moveEvent.clientX;
      last.y = moveEvent.clientY;
      clampOffsets();
      layout();
    };
    let detachBoundary = (): void => {};
    let detached = false;
    const detach = (): void => {
      if (detached) return;
      detached = true;
      mount.removeEventListener("pointermove", move);
      mount.removeEventListener("pointerup", end);
      mount.removeEventListener("pointercancel", end);
      mount.removeEventListener("lostpointercapture", end);
      detachBoundary();
      if (mount.hasPointerCapture(event.pointerId)) {
        mount.releasePointerCapture(event.pointerId);
      }
      if (panCleanup === detach) panCleanup = undefined;
    };
    const end = (endEvent?: PointerEvent): void => {
      if (endEvent && endEvent.pointerId !== event.pointerId) return;
      detach();
    };
    panCleanup = detach;
    mount.addEventListener("pointermove", move);
    mount.addEventListener("pointerup", end);
    mount.addEventListener("pointercancel", end);
    mount.addEventListener("lostpointercapture", end);
    detachBoundary = observePointerSessionBoundary({
      pointerId: event.pointerId,
      onRelease: detach,
      onInterrupt: detach,
    });
  }

  const observer = new ResizeObserver(() => {
    if (disposed) return;
    refreshMountGeometry();
    if (fitLocked) fit();
    else preserveViewportCenter();
  });
  refreshMountGeometry();
  observer.observe(mount);
  mount.addEventListener("wheel", onWheel, { passive: false });
  mount.addEventListener("pointerdown", onPanPointerDown, true);
  fit();

  return {
    zoomIn() {
      applyScale(scale * ZOOM_STEP);
    },
    zoomOut() {
      applyScale(scale / ZOOM_STEP);
    },
    fit,
    resetScale() {
      cancelSettleAnimation();
      fitLocked = false;
      scale = 1;
      centerOffsets();
      layout();
      notifyScale();
    },
    handleCanvasResized() {
      cancelSettleAnimation();
      // Content changes are the transform feedback itself. Keep the scene
      // camera stable so scale and translation remain visible; fit-lock only
      // responds to an actual mount resize through ResizeObserver.
      if (distortGesture) {
        // Edge auto-pan owns offset changes during the gesture. This call only
        // publishes the latest workspace-origin compensation.
        layout();
        return;
      }
      clampOffsets();
      layout();
    },
    handleDistortGesture(event) {
      if (event.phase === "start") {
        cancelSettleAnimation();
        cancelAutoPan();
        refreshMountGeometry();
        distortGesture = {
          pointerId: event.pointerId,
          client: { ...event.client },
          perspective: event.perspective,
          axis: event.axis,
          direction: { x: 0, y: 0 },
          startOffset: { x: offsetX, y: offsetY },
          previousTime: undefined,
        };
        return;
      }
      if (!distortGesture || distortGesture.pointerId !== event.pointerId) return;
      if (event.phase === "end") {
        cancelAutoPan();
        distortGesture = undefined;
        return;
      }
      const delta = {
        x: event.client.x - distortGesture.client.x,
        y: event.client.y - distortGesture.client.y,
      };
      if (Math.abs(delta.x) >= 0.5) distortGesture.direction.x = Math.sign(delta.x);
      if (Math.abs(delta.y) >= 0.5) distortGesture.direction.y = Math.sign(delta.y);
      distortGesture.client = { ...event.client };
      distortGesture.perspective = event.perspective;
      distortGesture.axis = event.axis;
      const activeDelta = event.axis === "horizontal" ? delta.x : delta.y;
      if (!event.perspective || (event.axis !== undefined && Math.abs(activeDelta) >= 0.5)) {
        scheduleAutoPan();
      }
    },
    revealAllCorners,
    setSceneOffset(offset) {
      cancelSettleAnimation();
      sceneOffsetX = Number.isFinite(offset.x) ? offset.x : 0;
      sceneOffsetY = Number.isFinite(offset.y) ? offset.y : 0;
    },
    setPanActive(active: boolean) {
      panActive = active;
      mount.dataset.pan = active ? "true" : "false";
      if (!active) {
        panCleanup?.();
        panCleanup = undefined;
      }
    },
    scale() {
      return scale;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      mount.removeEventListener("wheel", onWheel);
      mount.removeEventListener("pointerdown", onPanPointerDown, true);
      panCleanup?.();
      panCleanup = undefined;
      cancelAutoPan();
      if (wheelFrame !== undefined) cancelAnimationFrame(wheelFrame);
      wheelFrame = undefined;
      wheelDelta = 0;
      distortGesture = undefined;
      cancelSettleAnimation();
      editor.canvas.style.width = previousCanvasStyle.width;
      editor.canvas.style.height = previousCanvasStyle.height;
      editor.canvas.style.maxWidth = previousCanvasStyle.maxWidth;
      editor.canvas.style.maxHeight = previousCanvasStyle.maxHeight;
      mount.style.position = previousMountPosition;
      element.style.position = previousElementStyle.position;
      element.style.left = previousElementStyle.left;
      element.style.top = previousElementStyle.top;
      element.style.width = previousElementStyle.width;
      element.style.height = previousElementStyle.height;
      element.style.maxWidth = previousElementStyle.maxWidth;
      element.style.maxHeight = previousElementStyle.maxHeight;
      element.style.transform = previousElementStyle.transform;
      element.style.transformOrigin = previousElementStyle.transformOrigin;
      element.style.willChange = previousElementStyle.willChange;
      element.style.setProperty(CONTROL_SCALE_PROPERTY, previousElementStyle.controlScale);
    },
  };
}

/** Camera velocity in px/s for one pointer coordinate in an edge zone. */
export function edgeCameraVelocity(position: number, extent: number): number {
  if (!Number.isFinite(position) || !Number.isFinite(extent) || extent <= 0) return 0;
  const zone = Math.min(EDGE_AUTO_PAN_ZONE, extent / 3);
  if (zone <= 0) return 0;
  if (position < zone) {
    const strength = clamp((zone - position) / zone, 0, 1);
    return EDGE_AUTO_PAN_MAX_SPEED * strength * strength;
  }
  if (position > extent - zone) {
    const strength = clamp((position - (extent - zone)) / zone, 0, 1);
    return -EDGE_AUTO_PAN_MAX_SPEED * strength * strength;
  }
  return 0;
}

/** Duration for a presentation-only recovery; large reframes settle less abruptly. */
export function recoveryAnimationDuration(fromScale: number, toScale: number): number {
  if (!Number.isFinite(fromScale) || !Number.isFinite(toScale) || fromScale <= 0 || toScale <= 0) {
    return 150;
  }
  const ratio = Math.max(fromScale / toScale, toScale / fromScale);
  return Math.round(clamp(150 + Math.log2(ratio) * 30, 150, 240));
}

/** Human-readable zoom text that does not misreport an emergency scale as 0%. */
export function formatZoomPercent(scale: number): string {
  if (!Number.isFinite(scale) || scale <= 0) return "—";
  const percent = scale * 100;
  return percent < 1 ? "<1%" : `${Math.round(percent)}%`;
}

function positiveScale(candidate: number, fallback: number): number {
  return Number.isFinite(candidate) && candidate > 0
    ? Math.min(candidate, MAX_SCALE)
    : fallback;
}

function pixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Duck-typed so the guard also works in DOM-less test environments.
function isFormControlTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const closest = (target as Element).closest;
  return typeof closest === "function" && Boolean((target as Element).closest("button, input"));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
