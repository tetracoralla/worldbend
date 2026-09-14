export interface DirectPoint {
  id: string;
  x: number;
  y: number;
  label: string;
  tone?: "curve" | "handle" | "anchor";
}

export interface DirectPointOverlay {
  set(points: readonly DirectPoint[]): void;
  refresh(): void;
  interrupt(): void;
  selected(): readonly string[];
  dispose(): void;
}

export interface DirectPointBounds {
  min: number;
  max: number;
}

export type DirectPointSelection = "single" | "multiple";

type DirectPointPosition = { x: number; y: number };
type DirectPointMove = { id: string; point: DirectPointPosition };

export interface DirectPointGestureSession {
  begin(pointerId: number, id: string, point: DirectPointPosition): void;
  update(pointerId: number, point: DirectPointPosition): boolean;
  finish(pointerId: number, point?: DirectPointPosition): boolean;
  interrupt(pointerId?: number): boolean;
  /** Restore the gesture-start point instead of keeping the last preview. */
  cancel(pointerId?: number): boolean;
  owns(pointerId: number): boolean;
  active(): boolean;
}

export function createDirectPointGestureSession(input: {
  onPreview(id: string, point: DirectPointPosition): void;
  onCommit(id: string, point: DirectPointPosition): void;
}): DirectPointGestureSession {
  let active:
    | {
        pointerId: number;
        id: string;
        origin: DirectPointPosition;
        lastPoint: DirectPointPosition;
      }
    | undefined;

  const commit = (pointerId?: number, point?: DirectPointPosition): boolean => {
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId)) return false;
    const completed = active;
    active = undefined;
    input.onCommit(completed.id, point ?? completed.lastPoint);
    return true;
  };

  const restoreOrigin = (pointerId?: number): boolean => {
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId)) return false;
    const completed = active;
    active = undefined;
    input.onCommit(completed.id, completed.origin);
    return true;
  };

  return {
    begin(pointerId, id, point) {
      if (active) commit();
      active = { pointerId, id, origin: point, lastPoint: point };
      input.onPreview(id, point);
    },
    update(pointerId, point) {
      if (!active || active.pointerId !== pointerId) return false;
      active = { ...active, lastPoint: point };
      input.onPreview(active.id, point);
      return true;
    },
    finish: commit,
    interrupt: commit,
    cancel: restoreOrigin,
    owns(pointerId) { return active?.pointerId === pointerId; },
    active: () => active !== undefined,
  };
}

/**
 * Keyboard nudge distances in canvas pixels, matching the editor handles:
 * one pixel per press, ten with Shift. Points live in normalized space, so
 * each press resolves the step against the live canvas box.
 */
const KEYBOARD_STEP_PIXELS = 1;
const KEYBOARD_STEP_SHIFT_PIXELS = 10;
const DEFAULT_BOUNDS: DirectPointBounds = { min: 0, max: 1 };

export function keyboardNudgeDelta(
  key: string,
  shiftKey: boolean,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  const directionX = key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0;
  const directionY = key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0;
  if (directionX === 0 && directionY === 0) return { x: 0, y: 0 };
  const pixels = shiftKey ? KEYBOARD_STEP_SHIFT_PIXELS : KEYBOARD_STEP_PIXELS;
  return {
    x: (directionX * pixels) / Math.max(1, canvasWidth),
    y: (directionY * pixels) / Math.max(1, canvasHeight),
  };
}

export function createDirectPointOverlay(input: {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  onMove(id: string, point: { x: number; y: number }, final: boolean): void;
  onMoves?(moves: readonly DirectPointMove[], final: boolean): void;
  onActivate?(id: string, event: MouseEvent): boolean;
  /** Core-solved model coordinates <-> normalized visible canvas coordinates. */
  coordinates?: {
    project(point: DirectPointPosition): DirectPointPosition;
    unproject(point: DirectPointPosition): DirectPointPosition;
  };
  bounds?: DirectPointBounds;
  selection?: DirectPointSelection;
  /** False when the points are activation-only targets, not movable. */
  draggable?: boolean;
}): DirectPointOverlay {
  const layer = document.createElement("div");
  layer.className = "direct-point-layer";
  input.host.append(layer);
  const bounds = input.bounds ?? DEFAULT_BOUNDS;
  const multiple = input.selection === "multiple";
  const project = (point: DirectPointPosition) => input.coordinates?.project(point) ?? point;
  const unproject = (point: DirectPointPosition) => input.coordinates?.unproject(point) ?? point;
  let points: DirectPoint[] = [];
  let selected = new Set<string>();
  let grabOrigins: Record<string, DirectPointPosition> = {};
  let observer: ResizeObserver | undefined;
  let capturedButton: HTMLButtonElement | undefined;
  let grabOffset = { x: 0, y: 0 };

  const clampValue = (value: number): number => Math.max(bounds.min, Math.min(bounds.max, value));
  const clampPoint = (point: DirectPointPosition): DirectPointPosition => ({
    x: clampValue(point.x),
    y: clampValue(point.y),
  });

  const trackPoint = (id: string, point: DirectPointPosition): void => {
    const index = points.findIndex((candidate) => candidate.id === id);
    if (index >= 0) points[index] = { ...points[index]!, x: point.x, y: point.y };
  };

  const placeAt = (
    button: HTMLButtonElement,
    canvasBox: DOMRect,
    hostBox: DOMRect,
    point: DirectPointPosition,
  ): void => {
    point = project(point);
    button.style.left = `${canvasBox.left - hostBox.left + point.x * canvasBox.width}px`;
    button.style.top = `${canvasBox.top - hostBox.top + point.y * canvasBox.height}px`;
  };

  const positionButton = (id: string, point: DirectPointPosition): void => {
    const button = layer.querySelector<HTMLButtonElement>(`[data-point-id="${id}"]`);
    if (!button) return;
    placeAt(button, input.canvas.getBoundingClientRect(), input.host.getBoundingClientRect(), point);
  };

  const refresh = (): void => {
    // One geometry read per refresh, not per point: a 16x16 grid would
    // otherwise issue hundreds of rect reads on every relayout.
    const canvasBox = input.canvas.getBoundingClientRect();
    const hostBox = input.host.getBoundingClientRect();
    for (const button of layer.querySelectorAll<HTMLButtonElement>("button")) {
      const point = points.find((candidate) => candidate.id === button.dataset.pointId);
      if (point) placeAt(button, canvasBox, hostBox, point);
    }
  };

  const syncPressed = (): void => {
    if (!multiple) return;
    for (const button of layer.querySelectorAll<HTMLButtonElement>("button")) {
      const id = button.dataset.pointId;
      if (!id) continue;
      button.setAttribute("aria-pressed", String(selected.has(id)));
    }
  };

  // Pointer drags and keyboard nudges share one application path so a point
  // stays visually live without rebuilding the overlay: a rebuild here would
  // destroy the focused button and strand keyboard users after one press.
  const emitMoves = (moves: readonly DirectPointMove[], final: boolean): void => {
    for (const move of moves) {
      trackPoint(move.id, move.point);
      positionButton(move.id, move.point);
    }
    if (input.onMoves) input.onMoves(moves, final);
    else {
      for (const move of moves) input.onMove(move.id, move.point, final);
    }
  };

  const movesFromGrabbed = (id: string, point: DirectPointPosition): DirectPointMove[] => {
    const origin = grabOrigins[id];
    if (!origin) return [{ id, point }];
    const delta = { x: point.x - origin.x, y: point.y - origin.y };
    return Object.keys(grabOrigins).map((candidateId) => {
      const start = grabOrigins[candidateId] ?? point;
      return { id: candidateId, point: clampPoint({ x: start.x + delta.x, y: start.y + delta.y }) };
    });
  };

  const applyGrabbed = (id: string, point: DirectPointPosition, final: boolean): void => {
    emitMoves(movesFromGrabbed(id, point), final);
  };

  const pointFromClient = (clientX: number, clientY: number): DirectPointPosition => {
    const box = input.canvas.getBoundingClientRect();
    return clampPoint(unproject({
      x: (clientX - grabOffset.x - box.left) / Math.max(1, box.width),
      y: (clientY - grabOffset.y - box.top) / Math.max(1, box.height),
    }));
  };

  const gesture = createDirectPointGestureSession({
    onPreview(id, point) { applyGrabbed(id, point, false); },
    onCommit(id, point) { applyGrabbed(id, point, true); },
  });

  const releaseCapture = (button: HTMLButtonElement | undefined, pointerId: number): void => {
    if (!button?.hasPointerCapture(pointerId)) return;
    button.releasePointerCapture(pointerId);
  };

  const finishPointer = (pointerId: number, point?: DirectPointPosition): boolean => {
    const button = capturedButton;
    const finished = gesture.finish(pointerId, point);
    if (!finished) return false;
    capturedButton = undefined;
    grabOffset = { x: 0, y: 0 };
    grabOrigins = {};
    if (button) delete button.dataset.activePointerId;
    releaseCapture(button, pointerId);
    return true;
  };

  const closePointer = (
    pointerId: number | undefined,
    close: (id?: number) => boolean,
  ): boolean => {
    const button = capturedButton;
    const capturedPointer = pointerId ?? (button
      ? Number(button.dataset.activePointerId)
      : undefined);
    const closed = close(pointerId);
    if (!closed) return false;
    capturedButton = undefined;
    grabOffset = { x: 0, y: 0 };
    grabOrigins = {};
    if (capturedPointer !== undefined && Number.isFinite(capturedPointer)) {
      releaseCapture(button, capturedPointer);
    }
    if (button) delete button.dataset.activePointerId;
    return true;
  };

  const interruptPointer = (pointerId?: number): boolean =>
    closePointer(pointerId, (id) => gesture.interrupt(id));

  const cancelPointer = (pointerId?: number): boolean =>
    closePointer(pointerId, (id) => gesture.cancel(id));

  const onWindowPointerUp = (event: PointerEvent): void => {
    if (gesture.owns(event.pointerId)) {
      finishPointer(event.pointerId, pointFromClient(event.clientX, event.clientY));
    }
  };
  const onWindowPointerCancel = (event: PointerEvent): void => {
    interruptPointer(event.pointerId);
  };
  const onWindowBlur = (): void => { interruptPointer(); };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") interruptPointer();
  };
  const onWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !gesture.active()) return;
    // Cancel only the in-flight point. A workspace-level Escape can still
    // leave after the drag has been restored.
    event.preventDefault();
    event.stopPropagation();
    cancelPointer();
  };
  const onHostPointerDown = (event: PointerEvent): void => {
    if (!multiple || event.shiftKey) return;
    const target = event.target as { closest?: (selector: string) => unknown } | null;
    if (target?.closest?.(".direct-point")) return;
    if (selected.size === 0) return;
    selected = new Set();
    syncPressed();
  };

  const beginDrag = (event: PointerEvent, point: DirectPoint, button: HTMLButtonElement): void => {
    const tracked = points.find((candidate) => candidate.id === point.id) ?? point;
    const box = input.canvas.getBoundingClientRect();
    const visible = project(tracked);
    // The whole hit target is draggable. Keep the grabbed offset so an
    // off-center press does not move the point before the pointer moves.
    grabOffset = {
      x: event.clientX - (box.left + visible.x * box.width),
      y: event.clientY - (box.top + visible.y * box.height),
    };
    capturedButton = button;
    button.dataset.activePointerId = String(event.pointerId);
    grabOrigins = {};
    for (const id of selected) {
      const origin = points.find((candidate) => candidate.id === id);
      if (origin) grabOrigins[id] = { x: origin.x, y: origin.y };
    }
    if (!grabOrigins[point.id]) grabOrigins[point.id] = { x: tracked.x, y: tracked.y };
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // A host can refuse capture for a pointer it does not own; drag on
      // without it — window pointerup still closes the gesture.
    }
    gesture.begin(event.pointerId, point.id, { x: tracked.x, y: tracked.y });
  };

  const set = (next: readonly DirectPoint[]): void => {
    interruptPointer();
    const nextIds = new Set(next.map((point) => point.id));
    selected = new Set([...selected].filter((id) => nextIds.has(id)));
    points = [...next];
    layer.replaceChildren();
    for (const point of points) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.pointId = point.id;
      button.className = point.tone ? `direct-point direct-point--${point.tone}` : "direct-point";
      button.setAttribute("aria-label", point.label);
      if (input.draggable === false) button.setAttribute("aria-pressed", String(point.tone === "anchor"));
      button.addEventListener("click", (event) => {
        if (event.detail === 0) input.onActivate?.(point.id, event);
      });
      if (multiple) button.setAttribute("aria-pressed", String(selected.has(point.id)));
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        interruptPointer();
        if (input.onActivate?.(point.id, event)) return;
        if (input.draggable === false) return;
        if (multiple && event.shiftKey) {
          if (selected.has(point.id)) selected.delete(point.id);
          else selected.add(point.id);
          syncPressed();
          if (!selected.has(point.id)) return;
        } else if (!selected.has(point.id)) {
          selected = new Set([point.id]);
          syncPressed();
        }
        button.focus({ preventScroll: true });
        beginDrag(event, point, button);
      });
      button.addEventListener("pointermove", (event) => {
        if (!gesture.owns(event.pointerId)) return;
        // Some embedded hosts return a pointer after dropping capture without
        // delivering pointerup. Keep the last pressed sample and close once.
        if (event.buttons === 0) {
          interruptPointer(event.pointerId);
          return;
        }
        gesture.update(event.pointerId, pointFromClient(event.clientX, event.clientY));
      });
      button.addEventListener("pointerup", (event) => {
        finishPointer(event.pointerId, pointFromClient(event.clientX, event.clientY));
      });
      button.addEventListener("pointercancel", (event) => { interruptPointer(event.pointerId); });
      button.addEventListener("lostpointercapture", (event) => {
        interruptPointer((event as PointerEvent).pointerId);
      });
      button.addEventListener("keydown", (event) => {
        const box = input.canvas.getBoundingClientRect();
        const delta = keyboardNudgeDelta(event.key, event.shiftKey, box.width, box.height);
        if (delta.x === 0 && delta.y === 0) return;
        event.preventDefault();
        // Activation-only points (pin targets) have nothing to nudge; moving
        // the button would desync it from the spec until the next rebuild.
        if (input.draggable === false) return;
        // Repeated presses continue from the tracked position, not the
        // set()-time snapshot, because the overlay is no longer rebuilt.
        if (multiple && !selected.has(point.id)) {
          selected = new Set([point.id]);
          syncPressed();
        }
        const ids = multiple && selected.has(point.id) ? [...selected] : [point.id];
        emitMoves(ids.map((id) => {
          const tracked = points.find((candidate) => candidate.id === id) ?? point;
          const visible = project(tracked);
          return { id, point: clampPoint(unproject({ x: visible.x + delta.x, y: visible.y + delta.y })) };
        }), true);
      });
      layer.append(button);
    }
    refresh();
  };
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(refresh);
    observer.observe(input.host);
    observer.observe(input.canvas);
  }
  window.addEventListener("pointerup", onWindowPointerUp);
  window.addEventListener("pointercancel", onWindowPointerCancel);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onWindowKeydown, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  input.host.addEventListener("pointerdown", onHostPointerDown);
  return {
    set,
    refresh,
    interrupt: interruptPointer,
    selected: () => [...selected],
    dispose() {
      interruptPointer();
      observer?.disconnect();
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onWindowKeydown, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      input.host.removeEventListener("pointerdown", onHostPointerDown);
      layer.remove();
    },
  };
}
