import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPreviewViewport,
  edgeCameraVelocity,
  formatZoomPercent,
  recoveryAnimationDuration,
} from "./preview-viewport";
import type { PerspectiveEditor } from "./editor";

class ResizeObserverStub {
  static callback: ResizeObserverCallback | undefined;
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverStub.callback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let nextFrameId = 1;
let frameQueue = new Map<number, FrameRequestCallback>();

function flushViewportFrame(time: number): void {
  const queued = [...frameQueue.values()];
  frameQueue.clear();
  for (const callback of queued) callback(time);
}

type Mount = {
  style: Record<string, string>;
  dataset: Record<string, string>;
  clientWidth: number;
  clientHeight: number;
  listeners: Map<string, Set<{ listener: (event: FakePointerEvent) => void; capture: boolean }>>;
  addEventListener: (
    type: string,
    listener: (event: FakePointerEvent) => void,
    capture?: boolean,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: FakePointerEvent) => void,
    capture?: boolean,
  ) => void;
  emit: (type: string, event: FakePointerEvent) => void;
  getBoundingClientRect: () => { left: number; top: number };
  setPointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
};

interface FakePointerEvent {
  type?: string;
  button?: number;
  pointerId?: number;
  buttons?: number;
  clientX?: number;
  clientY?: number;
  deltaY?: number;
  preventDefault?: ReturnType<typeof vi.fn>;
  stopPropagation?: () => void;
  stopPropagationCalled?: boolean;
}

type FakeStyle = Record<string, string> & {
  setProperty(name: string, value: string): void;
};

function fakeStyle(): FakeStyle {
  const style = {} as FakeStyle;
  Object.defineProperty(style, "setProperty", {
    enumerable: false,
    value(name: string, value: string) {
      style[name] = value;
    },
  });
  return style;
}

function fakeMount(width = 500, height = 300): Mount {
  const listeners = new Map<
    string,
    Set<{ listener: (event: FakePointerEvent) => void; capture: boolean }>
  >();
  const mount: Mount = {
    style: {},
    dataset: {},
    clientWidth: width,
    clientHeight: height,
    listeners,
    addEventListener(type, listener, capture) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add({ listener, capture: Boolean(capture) });
    },
    removeEventListener(type, listener, capture) {
      for (const entry of listeners.get(type) ?? []) {
        if (entry.listener === listener && entry.capture === Boolean(capture)) {
          listeners.get(type)?.delete(entry);
        }
      }
    },
    emit(type, event) {
      const entries = [...(listeners.get(type) ?? [])];
      // Capture-phase listeners run first; stopPropagation suspends the rest.
      event.stopPropagation = () => {
        event.stopPropagationCalled = true;
      };
      for (const entry of entries.sort((a, b) => Number(b.capture) - Number(a.capture))) {
        if (event.stopPropagationCalled) break;
        entry.listener(event);
      }
    },
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  };
  return mount;
}

function fakeEditor(canvasWidth: number, canvasHeight: number): {
  editor: PerspectiveEditor;
  element: { style: FakeStyle };
  workspaceOffset: { x: number; y: number };
  quadBounds: { x: number; y: number; width: number; height: number };
  cornerPoints: Record<"tl" | "tr" | "br" | "bl", { x: number; y: number }>;
  cameraUpdates: ReturnType<typeof vi.fn>;
} {
  const element = { style: fakeStyle() };
  const workspaceOffset = { x: 0, y: 0 };
  const targetSize = { width: canvasWidth, height: canvasHeight };
  const quadBounds = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  const cornerPoints = {
    tl: { x: 0, y: 0 },
    tr: { x: canvasWidth, y: 0 },
    br: { x: canvasWidth, y: canvasHeight },
    bl: { x: 0, y: canvasHeight },
  };
  const canvas = {
    width: canvasWidth,
    height: canvasHeight,
    style: {} as Record<string, string>,
  };
  const cameraUpdates = vi.fn(() => true);
  return {
    editor: {
      element,
      canvas,
      getDisplaySize: () => ({ width: canvas.width, height: canvas.height }),
      getTargetDisplaySize: () => ({ ...targetSize }),
      getWorkspaceDisplayOffset: () => ({ ...workspaceOffset }),
      getQuadDisplayBounds: () => ({ ...quadBounds }),
      getCornerDisplayPoint: (corner: "tl" | "tr" | "br" | "bl") => ({
        ...cornerPoints[corner],
      }),
      updateActiveDistortCamera: cameraUpdates,
    } as unknown as PerspectiveEditor,
    element,
    workspaceOffset,
    quadBounds,
    cornerPoints,
    cameraUpdates,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  ResizeObserverStub.callback = undefined;
});

describe("createPreviewViewport", () => {
  beforeEachStubGlobals();

  it("fits the canvas inside the mount on creation", () => {
    const mount = fakeMount();
    const { editor, element } = fakeEditor(1000, 600);
    createPreviewViewport(editor, mount as unknown as HTMLElement);
    // 500/1000 = 0.5 scale, centered vertically in 300 px.
    expect(element.style.width).toBe("1000px");
    expect(element.style.height).toBe("600px");
    expect(element.style.transform).toBe("translate3d(0px, 0px, 0) scale(0.5)");
    expect(element.style["--worldbend-viewport-control-scale"]).toBe("2");
  });

  it("zooms in steps and reports the scale", () => {
    const onScaleChange = vi.fn();
    const mount = fakeMount();
    const { editor, element } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement, {
      onScaleChange,
    });
    const baseScale = viewport.scale();
    const logicalWidth = element.style.width;
    viewport.zoomIn();
    expect(viewport.scale()).toBeCloseTo(baseScale * 1.25, 10);
    expect(element.style.width).toBe(logicalWidth);
    expect(element.style.transform).toContain(`scale(${baseScale * 1.25})`);
    expect(Number(element.style["--worldbend-viewport-control-scale"]))
      .toBeCloseTo(1 / viewport.scale(), 10);
    viewport.zoomOut();
    expect(viewport.scale()).toBeCloseTo(baseScale, 10);
    expect(onScaleChange).toHaveBeenCalled();
  });

  it("clamps zoom to the supported range", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    for (let index = 0; index < 40; index += 1) viewport.zoomIn();
    expect(viewport.scale()).toBe(8);
    for (let index = 0; index < 80; index += 1) viewport.zoomOut();
    expect(viewport.scale()).toBeCloseTo(0.1, 10);
  });

  it("zooms at the pointer anchor from the wheel", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const before = elementTransform(editor);
    mount.emit("wheel", { preventDefault: vi.fn(), deltaY: -240, clientX: 200, clientY: 150 });
    flushViewportFrame(16);
    const after = elementTransform(editor);
    expect(after.scale).toBeGreaterThan(before.scale);
    // The anchor point stays put: transform moves to compensate the growth.
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
  });

  it("keeps the scale but re-centers when the canvas changes size", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const scale = viewport.scale();
    (editor.canvas as unknown as { width: number }).width = 800;
    viewport.handleCanvasResized();
    expect(viewport.scale()).toBe(scale);
    expect(elementTransform(editor).width).toBeCloseTo(800 * scale, 10);
  });

  it("keeps transform scale visible instead of auto-fitting every content change", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    const initialScale = viewport.scale();
    (editor.canvas as unknown as { width: number }).width = 800;
    (editor.canvas as unknown as { height: number }).height = 400;
    viewport.handleCanvasResized();
    expect(viewport.scale()).toBe(initialScale);
    expect(elementTransform(editor).width).toBeCloseTo(800 * initialScale, 10);
  });

  it("shows a transform scene offset without conflating it with camera pan", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    const before = elementTransform(editor);
    viewport.setSceneOffset({ x: 40, y: -20 });
    viewport.handleCanvasResized();
    const after = elementTransform(editor);
    expect(after.x - before.x).toBeCloseTo(40 * viewport.scale(), 10);
    expect(after.y - before.y).toBeCloseTo(-20 * viewport.scale(), 10);
  });

  it("keeps the scene camera fixed when transformed content changes size", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    viewport.setPanActive(true);
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 5,
      clientX: 100,
      clientY: 80,
      preventDefault: vi.fn(),
    });
    mount.emit("pointermove", { pointerId: 5, clientX: 150, clientY: 100 });
    mount.emit("pointerup", { pointerId: 5, clientX: 150, clientY: 100 });
    const before = elementTransform(editor);
    (editor.canvas as unknown as { width: number }).width = 800;
    viewport.handleCanvasResized();

    const after = elementTransform(editor);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
  });

  it("keeps the original target frame fixed when an outward workspace grows left and up", () => {
    const mount = fakeMount();
    const { editor, workspaceOffset } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const before = elementTransform(editor);

    // The workspace now includes 80 px to the left and 40 px above the target.
    // Its element grows, while the editor reports the equal negative correction
    // needed to keep the target's internal origin at the same screen position.
    (editor.canvas as unknown as { width: number }).width = 480;
    (editor.canvas as unknown as { height: number }).height = 240;
    workspaceOffset.x = -80;
    workspaceOffset.y = -40;
    viewport.handleCanvasResized();

    const after = elementTransform(editor);
    expect(after.x - workspaceOffset.x).toBeCloseTo(before.x, 10);
    expect(after.y - workspaceOffset.y).toBeCloseTo(before.y, 10);
  });

  it("leaves the camera untouched when every Distort corner is already visible", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const before = elementTransform(editor);
    viewport.revealAllCorners();
    expect(elementTransform(editor)).toEqual(before);
  });

  it("only zooms out as needed and reveals every corner after an outward Distort", () => {
    const mount = fakeMount();
    const { editor, workspaceOffset, quadBounds } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    (editor.canvas as unknown as { width: number }).width = 620;
    (editor.canvas as unknown as { height: number }).height = 300;
    workspaceOffset.x = -120;
    workspaceOffset.y = -50;
    quadBounds.x = 20;
    quadBounds.y = 10;
    quadBounds.width = 580;
    quadBounds.height = 280;
    viewport.handleCanvasResized();
    viewport.revealAllCorners();

    const after = elementTransform(editor);
    const left = after.x + quadBounds.x * after.scale;
    const right = left + quadBounds.width * after.scale;
    const top = after.y + quadBounds.y * after.scale;
    const bottom = top + quadBounds.height * after.scale;
    expect(after.scale).toBeLessThan(1);
    expect(left).toBeGreaterThanOrEqual(16 - 1e-10);
    expect(right).toBeLessThanOrEqual(500 - 16 + 1e-10);
    expect(top).toBeGreaterThanOrEqual(16 - 1e-10);
    expect(bottom).toBeLessThanOrEqual(300 - 16 + 1e-10);
  });

  it("crosses the ordinary 10% floor to recover every corner after an extreme Distort", () => {
    const mount = fakeMount();
    const { editor, quadBounds } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    Object.assign(quadBounds, { x: -5_000, y: -2_000, width: 10_000, height: 4_000 });

    viewport.revealAllCorners();

    const after = elementTransform(editor);
    const left = after.x + quadBounds.x * after.scale;
    const right = left + quadBounds.width * after.scale;
    const top = after.y + quadBounds.y * after.scale;
    const bottom = top + quadBounds.height * after.scale;
    expect(after.scale).toBeLessThan(0.1);
    expect(left).toBeGreaterThanOrEqual(16 - 1e-10);
    expect(right).toBeLessThanOrEqual(500 - 16 + 1e-10);
    expect(top).toBeGreaterThanOrEqual(16 - 1e-10);
    expect(bottom).toBeLessThanOrEqual(300 - 16 + 1e-10);

    viewport.zoomOut();
    expect(viewport.scale()).toBe(after.scale);
    viewport.zoomIn();
    expect(viewport.scale()).toBeCloseTo(after.scale * 1.25, 10);
  });

  it("keeps scale and source registration stable before the pointer enters an edge zone", () => {
    const mount = fakeMount();
    const { editor, workspaceOffset, quadBounds } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    const before = elementTransform(editor);
    viewport.handleDistortGesture({
      phase: "start",
      corner: "tl",
      pointerId: 7,
      client: { x: 200, y: 120 },
      perspective: false,
    });

    (editor.canvas as unknown as { width: number }).width = 620;
    (editor.canvas as unknown as { height: number }).height = 300;
    workspaceOffset.x = -120;
    workspaceOffset.y = -50;
    Object.assign(quadBounds, { x: 20, y: 10, width: 580, height: 280 });
    viewport.handleDistortGesture({
      phase: "update",
      corner: "tl",
      pointerId: 7,
      client: { x: 220, y: 130 },
      perspective: false,
    });
    viewport.handleCanvasResized();

    const after = elementTransform(editor);
    expect(after.scale).toBe(before.scale);
    // The only live transform change is the workspace-origin compensation
    // that keeps the original target frame registered.
    expect(after.x - workspaceOffset.x * after.scale).toBeCloseTo(before.x, 10);
    expect(after.y - workspaceOffset.y * after.scale).toBeCloseTo(before.y, 10);
    viewport.handleDistortGesture({
      phase: "end",
      corner: "tl",
      pointerId: 7,
      client: { x: 220, y: 130 },
      perspective: false,
    });
  });

  it("auto-pans continuously at the edge and stops as soon as the pointer returns", () => {
    const mount = fakeMount();
    const { editor, cameraUpdates } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const before = elementTransform(editor);

    viewport.handleDistortGesture({
      phase: "start",
      corner: "tr",
      pointerId: 31,
      client: { x: 400, y: 100 },
      perspective: false,
    });
    viewport.handleDistortGesture({
      phase: "update",
      corner: "tr",
      pointerId: 31,
      client: { x: 490, y: 100 },
      perspective: false,
    });
    flushViewportFrame(16);
    const first = elementTransform(editor);
    flushViewportFrame(32);
    const second = elementTransform(editor);

    expect(first.x).toBeLessThan(before.x);
    expect(second.x).toBeLessThan(first.x);
    expect(second.y).toBe(before.y);
    expect(cameraUpdates).toHaveBeenLastCalledWith(
      31,
      expect.objectContaining({ x: expect.any(Number), y: 0 }),
    );

    viewport.handleDistortGesture({
      phase: "update",
      corner: "tr",
      pointerId: 31,
      client: { x: 250, y: 100 },
      perspective: false,
    });
    flushViewportFrame(48);
    const returned = elementTransform(editor);
    flushViewportFrame(64);
    expect(elementTransform(editor)).toEqual(returned);

    viewport.handleDistortGesture({
      phase: "end",
      corner: "tr",
      pointerId: 31,
      client: { x: 250, y: 100 },
      perspective: false,
    });
  });

  it("auto-pans only the captured Perspective axis", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const before = elementTransform(editor);

    viewport.handleDistortGesture({
      phase: "start",
      corner: "br",
      pointerId: 32,
      client: { x: 400, y: 200 },
      perspective: true,
    });
    viewport.handleDistortGesture({
      phase: "update",
      corner: "br",
      pointerId: 32,
      client: { x: 490, y: 290 },
      perspective: true,
      axis: "horizontal",
    });
    flushViewportFrame(16);
    const after = elementTransform(editor);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBe(before.y);
  });

  it("settles a Perspective edge assist until a fresh outward pointer sample arrives", () => {
    const mount = fakeMount();
    const { editor, cameraUpdates } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    viewport.handleDistortGesture({
      phase: "start",
      corner: "br",
      pointerId: 33,
      client: { x: 400, y: 100 },
      perspective: true,
    });
    viewport.handleDistortGesture({
      phase: "update",
      corner: "br",
      pointerId: 33,
      client: { x: 490, y: 100 },
      perspective: true,
      axis: "horizontal",
    });
    flushViewportFrame(16);
    const assisted = elementTransform(editor);
    expect(cameraUpdates).toHaveBeenCalledTimes(1);

    flushViewportFrame(32);
    flushViewportFrame(48);
    expect(elementTransform(editor)).toEqual(assisted);
    expect(cameraUpdates).toHaveBeenCalledTimes(1);

    viewport.handleDistortGesture({
      phase: "update",
      corner: "br",
      pointerId: 33,
      client: { x: 510, y: 100 },
      perspective: true,
      axis: "horizontal",
    });
    flushViewportFrame(64);
    expect(cameraUpdates).toHaveBeenCalledTimes(2);
    expect(elementTransform(editor).x).toBeLessThan(assisted.x);
  });

  it("positions the preview inside the mount's padding box", () => {
    vi.stubGlobal("getComputedStyle", () => ({
      position: "relative",
      paddingLeft: "16px",
      paddingRight: "16px",
      paddingTop: "12px",
      paddingBottom: "12px",
    }));
    const mount = fakeMount(500, 300);
    const { editor, element } = fakeEditor(1000, 600);
    createPreviewViewport(editor, mount as unknown as HTMLElement);
    expect(element.style.left).toBe("16px");
    expect(element.style.top).toBe("12px");
    expect(elementTransform(editor).width).toBeCloseTo(460, 10);
  });

  it("restores every viewport-owned style on dispose", () => {
    const mount = fakeMount();
    mount.style.position = "sticky";
    const { editor, element } = fakeEditor(400, 200);
    element.style.position = "relative";
    element.style.left = "7px";
    element.style.transform = "rotate(1deg)";
    element.style.willChange = "auto";
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);

    viewport.dispose();

    expect(mount.style.position).toBe("sticky");
    expect(element.style.position).toBe("relative");
    expect(element.style.left).toBe("7px");
    expect(element.style.transform).toBe("rotate(1deg)");
    expect(element.style.willChange).toBe("auto");
  });

  it("re-fits on mount resize while fit-locked", () => {
    const mount = fakeMount(500, 300);
    const { editor } = fakeEditor(1000, 600);
    createPreviewViewport(editor, mount as unknown as HTMLElement);
    mount.clientWidth = 250;
    ResizeObserverStub.callback?.([], {} as ResizeObserver);
    expect(elementTransform(editor).width).toBeCloseTo(250, 10);
  });

  it("pans while pan is active and stops the gesture surface from seeing it", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.resetScale();
    const bubbleListener = vi.fn();
    mount.addEventListener("pointerdown", bubbleListener);
    viewport.setPanActive(true);
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 3,
      clientX: 100,
      clientY: 80,
      preventDefault,
      stopPropagation,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(bubbleListener).not.toHaveBeenCalled();
    const before = elementTransform(editor);
    mount.emit("pointermove", { pointerId: 3, clientX: 160, clientY: 90 });
    const after = elementTransform(editor);
    expect(after.x - before.x).toBeCloseTo(60, 10);
    expect(after.y - before.y).toBeCloseTo(10, 10);
    viewport.setPanActive(false);
    expect(mount.releasePointerCapture).toHaveBeenCalledWith(3);
    mount.emit("pointermove", { pointerId: 3, clientX: 200, clientY: 120 });
    const settled = elementTransform(editor);
    expect(settled.x).toBe(after.x);
  });

  it("releases a pan when the embedded window loses focus", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.setPanActive(true);
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 13,
      clientX: 100,
      clientY: 80,
      preventDefault: vi.fn(),
    });
    mount.emit("pointermove", { pointerId: 13, clientX: 140, clientY: 90 });
    const beforeBlur = elementTransform(editor);

    window.dispatchEvent(new Event("blur"));
    mount.emit("pointermove", { pointerId: 13, clientX: 200, clientY: 150 });

    expect(mount.releasePointerCapture).toHaveBeenCalledWith(13);
    expect(elementTransform(editor)).toEqual(beforeBlur);
  });

  it("self-heals a pan when Figma returns a move with no pressed buttons", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.setPanActive(true);
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 21,
      clientX: 100,
      clientY: 80,
      preventDefault: vi.fn(),
    });
    mount.emit("pointermove", { pointerId: 21, buttons: 1, clientX: 140, clientY: 90 });
    const lastPressedSample = elementTransform(editor);

    mount.emit("pointermove", { pointerId: 21, buttons: 0, clientX: 260, clientY: 190 });
    mount.emit("pointermove", { pointerId: 21, buttons: 1, clientX: 300, clientY: 220 });

    expect(mount.releasePointerCapture).toHaveBeenCalledWith(21);
    expect(elementTransform(editor)).toEqual(lastPressedSample);
  });

  it("does not let a second pointer replace the active pan session", () => {
    const mount = fakeMount();
    const { editor } = fakeEditor(400, 200);
    const viewport = createPreviewViewport(editor, mount as unknown as HTMLElement);
    viewport.setPanActive(true);
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 17,
      clientX: 100,
      clientY: 80,
      preventDefault: vi.fn(),
    });
    mount.emit("pointerdown", {
      button: 0,
      pointerId: 18,
      clientX: 200,
      clientY: 180,
      preventDefault: vi.fn(),
    });

    mount.emit("pointermove", { pointerId: 18, clientX: 260, clientY: 220 });
    const beforeOwnerMove = elementTransform(editor);
    mount.emit("pointermove", { pointerId: 17, clientX: 120, clientY: 90 });

    expect(elementTransform(editor).x - beforeOwnerMove.x).toBeCloseTo(20, 10);
    expect(mount.setPointerCapture).toHaveBeenCalledTimes(1);
  });
});

describe("edgeCameraVelocity", () => {
  it("ramps toward the camera direction needed to follow an outward pointer", () => {
    expect(edgeCameraVelocity(250, 500)).toBe(0);
    expect(edgeCameraVelocity(0, 500)).toBe(720);
    expect(edgeCameraVelocity(500, 500)).toBe(-720);
    expect(edgeCameraVelocity(24, 500)).toBeGreaterThan(0);
    expect(edgeCameraVelocity(476, 500)).toBeLessThan(0);
  });

  it("stays inert for invalid or empty viewports", () => {
    expect(edgeCameraVelocity(Number.NaN, 500)).toBe(0);
    expect(edgeCameraVelocity(0, 0)).toBe(0);
  });
});

describe("viewport recovery presentation", () => {
  it("uses a calmer bounded duration for a large reframe", () => {
    expect(recoveryAnimationDuration(1, 0.8)).toBeGreaterThanOrEqual(150);
    expect(recoveryAnimationDuration(1, 0.05)).toBe(240);
  });

  it("does not render a sub-percent recovery as zero", () => {
    expect(formatZoomPercent(0.1)).toBe("10%");
    expect(formatZoomPercent(0.0468)).toBe("5%");
    expect(formatZoomPercent(0.004)).toBe("<1%");
  });
});

function beforeEachStubGlobals(): void {
  beforeEach(() => {
    nextFrameId = 1;
    frameQueue = new Map();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      frameQueue.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frameQueue.delete(id);
    });
    vi.stubGlobal("getComputedStyle", () => ({
      position: "static",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }));
  });
}

function elementTransform(editor: PerspectiveEditor): {
  x: number;
  y: number;
  scale: number;
  width: number;
} {
  const style = (editor as unknown as { element: { style: Record<string, string> } }).element.style;
  const match =
    /translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\((-?[\d.]+)\)/.exec(
      style.transform ?? "",
    );
  const scale = Number(match?.[3] ?? 0);
  const logicalWidth = Number.parseFloat(style.width ?? "0");
  return {
    x: Number(match?.[1] ?? 0),
    y: Number(match?.[2] ?? 0),
    scale,
    width: logicalWidth * scale,
  };
}
