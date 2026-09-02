export interface DirectPoint {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface DirectPointOverlay {
  set(points: readonly DirectPoint[]): void;
  refresh(): void;
  dispose(): void;
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

  const moveFromClient = (id: string, clientX: number, clientY: number, final: boolean): void => {
    const box = input.canvas.getBoundingClientRect();
    applyPoint(id, {
      x: clamp((clientX - box.left) / Math.max(1, box.width)),
      y: clamp((clientY - box.top) / Math.max(1, box.height)),
    }, final);
  };

  const set = (next: readonly DirectPoint[]): void => {
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
        button.setPointerCapture(event.pointerId);
        moveFromClient(point.id, event.clientX, event.clientY, false);
      });
      button.addEventListener("pointermove", (event) => {
        if (button.hasPointerCapture(event.pointerId)) moveFromClient(point.id, event.clientX, event.clientY, false);
      });
      button.addEventListener("pointerup", (event) => {
        if (!button.hasPointerCapture(event.pointerId)) return;
        moveFromClient(point.id, event.clientX, event.clientY, true);
        button.releasePointerCapture(event.pointerId);
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
  return { set, refresh, dispose() { observer?.disconnect(); layer.remove(); } };
}

function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
