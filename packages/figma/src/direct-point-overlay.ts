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

export function createDirectPointOverlay(input: {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  onMove(id: string, point: { x: number; y: number }, final: boolean): void;
}): DirectPointOverlay {
  const layer = document.createElement("div");
  layer.className = "direct-point-layer";
  input.host.append(layer);
  let points: readonly DirectPoint[] = [];
  let observer: ResizeObserver | undefined;

  const refresh = (): void => {
    const canvasBox = input.canvas.getBoundingClientRect();
    const hostBox = input.host.getBoundingClientRect();
    for (const button of layer.querySelectorAll<HTMLButtonElement>("button")) {
      const point = points.find((candidate) => candidate.id === button.dataset.pointId);
      if (!point) continue;
      button.style.left = `${canvasBox.left - hostBox.left + point.x * canvasBox.width}px`;
      button.style.top = `${canvasBox.top - hostBox.top + point.y * canvasBox.height}px`;
    }
  };
  const moveFromClient = (id: string, clientX: number, clientY: number, final: boolean): void => {
    const box = input.canvas.getBoundingClientRect();
    const point = {
      x: clamp((clientX - box.left) / Math.max(1, box.width)),
      y: clamp((clientY - box.top) / Math.max(1, box.height)),
    };
    const button = layer.querySelector<HTMLButtonElement>(`[data-point-id="${id}"]`);
    if (button) {
      const hostBox = input.host.getBoundingClientRect();
      button.style.left = `${box.left - hostBox.left + point.x * box.width}px`;
      button.style.top = `${box.top - hostBox.top + point.y * box.height}px`;
    }
    input.onMove(id, point, final);
  };
  const set = (next: readonly DirectPoint[]): void => {
    points = next;
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
        const delta = event.shiftKey ? 0.01 : 0.0025;
        const dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
        const dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
        if (dx === 0 && dy === 0) return;
        event.preventDefault();
        input.onMove(point.id, { x: clamp(point.x + dx), y: clamp(point.y + dy) }, true);
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
