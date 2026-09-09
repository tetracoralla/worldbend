export interface DirectPoint {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface DirectPointOverlay {
  set(points: readonly DirectPoint[]): void;
  refresh(): void;
  interrupt(): void;
  dispose(): void;
}

type DirectPointPosition = { x: number; y: number };

export interface DirectPointGestureSession {
  begin(pointerId: number, id: string, point: DirectPointPosition): void;
  update(pointerId: number, point: DirectPointPosition): boolean;
  finish(pointerId: number, point?: DirectPointPosition): boolean;
  interrupt(pointerId?: number): boolean;
  owns(pointerId: number): boolean;
}

export function createDirectPointGestureSession(input: {
  onPreview(id: string, point: DirectPointPosition): void;
  onCommit(id: string, point: DirectPointPosition): void;
}): DirectPointGestureSession {
  let active: { pointerId: number; id: string; lastPoint: DirectPointPosition } | undefined;

  const commit = (pointerId?: number, point?: DirectPointPosition): boolean => {
    if (!active || (pointerId !== undefined && pointerId !== active.pointerId)) return false;
    const completed = active;
    active = undefined;
    input.onCommit(completed.id, point ?? completed.lastPoint);
    return true;
  };

  return {
    begin(pointerId, id, point) {
      if (active) commit();
      active = { pointerId, id, lastPoint: point };
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
    owns(pointerId) { return active?.pointerId === pointerId; },
  };
}

/**
 * Keyboard nudge distances in canvas pixels, matching the editor handles:
 * one pixel per press, ten with Shift. Points live in normalized space, so
 * each press resolves the step against the live canvas box.
 */
const KEYBOARD_STEP_PIXELS = 1;
const KEYBOARD_STEP_SHIFT_PIXELS = 10;

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
}): DirectPointOverlay {
  const layer = document.createElement("div");
  layer.className = "direct-point-layer";
  input.host.append(layer);
  let points: DirectPoint[] = [];
  let observer: ResizeObserver | undefined;
  let capturedButton: HTMLButtonElement | undefined;
  let grabOffset = { x: 0, y: 0 };

  const trackPoint = (id: string, point: { x: number; y: number }): void => {
    const index = points.findIndex((candidate) => candidate.id === id);
    if (index >= 0) points[index] = { ...points[index]!, x: point.x, y: point.y };
  };

  const placeAt = (
    button: HTMLButtonElement,
    canvasBox: DOMRect,
    hostBox: DOMRect,
    point: { x: number; y: number },
  ): void => {
    button.style.left = `${canvasBox.left - hostBox.left + point.x * canvasBox.width}px`;
    button.style.top = `${canvasBox.top - hostBox.top + point.y * canvasBox.height}px`;
  };

  const positionButton = (id: string, point: { x: number; y: number }): void => {
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

  // Pointer drags and keyboard nudges share one application path so a point
  // stays visually live without rebuilding the overlay: a rebuild here would
  // destroy the focused button and strand keyboard users after one press.
  const applyPoint = (id: string, point: { x: number; y: number }, final: boolean): void => {
    trackPoint(id, point);
    positionButton(id, point);
    input.onMove(id, point, final);
  };

  const pointFromClient = (clientX: number, clientY: number): DirectPointPosition => {
    const box = input.canvas.getBoundingClientRect();
    return {
      x: clamp((clientX - grabOffset.x - box.left) / Math.max(1, box.width)),
      y: clamp((clientY - grabOffset.y - box.top) / Math.max(1, box.height)),
    };
  };

  const gesture = createDirectPointGestureSession({
    onPreview(id, point) { applyPoint(id, point, false); },
    onCommit(id, point) { applyPoint(id, point, true); },
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
    if (button) delete button.dataset.activePointerId;
    releaseCapture(button, pointerId);
    return true;
  };

  const interruptPointer = (pointerId?: number): boolean => {
    const button = capturedButton;
    const capturedPointer = pointerId ?? (button
      ? Number(button.dataset.activePointerId)
      : undefined);
    const interrupted = gesture.interrupt(pointerId);
    if (!interrupted) return false;
    capturedButton = undefined;
    grabOffset = { x: 0, y: 0 };
    if (capturedPointer !== undefined && Number.isFinite(capturedPointer)) {
      releaseCapture(button, capturedPointer);
    }
    if (button) delete button.dataset.activePointerId;
    return true;
  };

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
    if (event.key === "Escape") interruptPointer();
  };

  const set = (next: readonly DirectPoint[]): void => {
    interruptPointer();
    points = [...next];
    layer.replaceChildren();
    for (const point of points) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.pointId = point.id;
      button.className = "direct-point";
      button.setAttribute("aria-label", point.label);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        interruptPointer();
        const tracked = points.find((candidate) => candidate.id === point.id) ?? point;
        const box = input.canvas.getBoundingClientRect();
        // The whole hit target is draggable. Keep the grabbed offset so an
        // off-center press does not move the point before the pointer moves.
        grabOffset = {
          x: event.clientX - (box.left + tracked.x * box.width),
          y: event.clientY - (box.top + tracked.y * box.height),
        };
        capturedButton = button;
        button.dataset.activePointerId = String(event.pointerId);
        button.setPointerCapture(event.pointerId);
        gesture.begin(event.pointerId, point.id, { x: tracked.x, y: tracked.y });
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
        // Repeated presses continue from the tracked position, not the
        // set()-time snapshot, because the overlay is no longer rebuilt.
        const tracked = points.find((candidate) => candidate.id === point.id) ?? point;
        applyPoint(point.id, { x: clamp(tracked.x + delta.x), y: clamp(tracked.y + delta.y) }, true);
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
  return {
    set,
    refresh,
    interrupt: interruptPointer,
    dispose() {
      interruptPointer();
      observer?.disconnect();
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerCancel);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onWindowKeydown, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      layer.remove();
    },
  };
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
