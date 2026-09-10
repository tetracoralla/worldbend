import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const solveTransform = vi.fn();
const buildWarpMesh = vi.fn();

vi.mock("./bridge", () => ({
  solveTransformPreview: (...args: unknown[]) => solveTransform(...args),
  buildWarpMeshPreview: (...args: unknown[]) => buildWarpMesh(...args),
}));

vi.mock("./preview-source", () => ({
  createPreviewSource: vi.fn(async (source: unknown) => source),
  closePreviewSource: vi.fn(),
}));

vi.mock("./webgl-renderer", () => {
  class TransformWebGLRenderer {
    static instances: InstanceType<typeof TransformWebGLRenderer>[] = [];
    readonly canvas: {
      className: string;
      style: Record<string, string>;
      toBlob: (callback: (blob: { arrayBuffer: () => Promise<ArrayBuffer> }) => void, type: string) => void;
    };
    render = vi.fn();
    dispose = vi.fn();
    invalidateSource = vi.fn();
    constructor() {
      this.canvas = {
        className: "",
        style: {},
        toBlob: (callback) => callback({ arrayBuffer: async () => new ArrayBuffer(8) }),
      };
      TransformWebGLRenderer.instances.push(this);
    }
  }
  return { TransformWebGLRenderer };
});

import { PerspectiveEditor, type DistortGestureEvent } from "./editor";
import { createPreviewViewport, type PreviewViewportHandle } from "./preview-viewport";
import { TransformWebGLRenderer } from "./webgl-renderer";
import { normalizedSpec, type TransformSpec, unitQuad } from "./types";

type Listener = (event: unknown) => void;

function fakeElement(tag: string): Record<string, unknown> & {
  emit: (type: string, event: unknown) => void;
  getAttribute: (key: string) => string | undefined;
} {
  const listeners = new Map<string, Set<Listener>>();
  const attributes: Record<string, string> = {};
  const style = {} as Record<string, string> & {
    setProperty(name: string, value: string): void;
  };
  Object.defineProperty(style, "setProperty", {
    enumerable: false,
    value(name: string, value: string) {
      style[name] = value;
    },
  });
  const element = {
    tag,
    tagName: tag.toUpperCase(),
    className: "",
    type: "",
    hidden: false,
    disabled: false,
    dataset: {},
    style,
    attributes,
    children: [] as unknown[],
    classList: { add: vi.fn(), remove: vi.fn() },
    append: (...kids: unknown[]) => {
      element.children.push(...kids);
    },
    replaceChildren: vi.fn(),
    setAttribute: vi.fn((key: string, value: string) => {
      attributes[key] = value;
    }),
    getAttribute: vi.fn((key: string) => attributes[key]),
    removeAttribute: vi.fn((key: string) => {
      delete attributes[key];
    }),
    addEventListener: vi.fn((type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    }),
    emit: (type: string, event: unknown) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    focus: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 400, height: 200 })),
  };
  return element;
}

function pointerEvent(overrides: Record<string, unknown> = {}): PointerEvent {
  return {
    button: 0,
    pointerId: 7,
    clientX: 10,
    clientY: 10,
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent;
}

const solvedOutput = {
  resolvedDestination: { reference: { width: 200, height: 100 } },
  homography: { matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] },
} as unknown as Awaited<ReturnType<typeof solveTransform>>;

function fakeImage(complete = true): HTMLImageElement {
  return { complete, naturalWidth: 200, naturalHeight: 100 } as unknown as HTMLImageElement;
}

function handleFor(editor: PerspectiveEditor, corner: string): ReturnType<typeof fakeElement> {
  const children = editor.element.children as unknown as unknown[];
  const handle = children.find(
    (child): boolean =>
      typeof child === "object" &&
      child !== null &&
      ((child as Record<string, Record<string, unknown>>)["dataset"]?.corner === corner),
  );
  if (!handle) throw new Error(`handle ${corner} not mounted`);
  return handle as ReturnType<typeof fakeElement>;
}

function pivotHandleFor(editor: PerspectiveEditor): ReturnType<typeof fakeElement> {
  const children = editor.element.children as unknown as unknown[];
  const handle = children.find(
    (child): boolean =>
      typeof child === "object" &&
      child !== null &&
      ((child as Record<string, Record<string, unknown>>)["dataset"]?.transformPivot === "true"),
  );
  if (!handle) throw new Error("pivot handle not mounted");
  return handle as ReturnType<typeof fakeElement>;
}

let frameQueue: FrameRequestCallback[] = [];

function flushFrame(): void {
  const callbacks = frameQueue;
  frameQueue = [];
  for (const callback of callbacks) callback(0);
}

beforeEach(() => {
  solveTransform.mockReset();
  solveTransform.mockResolvedValue(solvedOutput);
  buildWarpMesh.mockReset();
  buildWarpMesh.mockResolvedValue(undefined);
  (TransformWebGLRenderer as unknown as { instances: unknown[] }).instances = [];
  frameQueue = [];
  vi.stubGlobal("document", {
    createElement: (tag: string) => fakeElement(tag),
    createElementNS: (_ns: string, tag: string) => fakeElement(tag),
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameQueue.push(callback);
    return frameQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function createEditorWithSource(callbacks: {
  onChange?: (spec: TransformSpec) => void;
  onError?: (error: unknown) => void;
  onValidityChange?: (valid: boolean) => void;
  onDistortGesture?: (event: DistortGestureEvent) => void;
  onEditEnd?: (source: "distort" | "transform") => void;
}): Promise<PerspectiveEditor> {
  const editor = new PerspectiveEditor(callbacks);
  await editor.setSource(fakeImage());
  return editor;
}

describe("PerspectiveEditor interaction pipeline", () => {
  it("validates a source selection while previewing the untouched source frame", async () => {
    const editor = await createEditorWithSource({});
    const selection = normalizedSpec({
      tl: { x: 0.1, y: 0.15 },
      tr: { x: 0.9, y: 0.05 },
      br: { x: 0.8, y: 0.9 },
      bl: { x: 0.2, y: 0.85 },
    });
    solveTransform.mockClear();
    const renderer = editor["renderer"] as unknown as {
      render: ReturnType<typeof vi.fn>;
    };
    renderer.render.mockClear();

    editor.setSourceSelectionMode(true);
    await editor.setSpec(selection, { width: 200, height: 100 });

    expect(solveTransform).toHaveBeenCalledTimes(2);
    expect(solveTransform.mock.calls[0]?.[0]).toEqual(selection);
    expect(solveTransform.mock.calls[1]?.[0]).toEqual(normalizedSpec(unitQuad()));
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(editor.captureSpec()).toEqual(selection);
  });

  it("invalidates a late spec render before restoring a known frame", async () => {
    const editor = await createEditorWithSource({});
    const fallback = normalizedSpec(unitQuad());
    const candidate = normalizedSpec({
      tl: { x: 0.1, y: 0.1 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
    let releaseCandidate: ((value: typeof solvedOutput) => void) | undefined;
    solveTransform.mockImplementationOnce(
      () =>
        new Promise<typeof solvedOutput>((resolve) => {
          releaseCandidate = resolve;
        }),
    );
    solveTransform.mockResolvedValueOnce(solvedOutput);

    const late = editor.setSpec(candidate, { width: 200, height: 100 });
    editor.invalidatePendingRender();
    const restored = editor.setSpec(fallback, { width: 200, height: 100 });
    // A superseded bridge call is allowed to finish, but the latest request
    // waits behind it instead of starting a second solve concurrently.
    releaseCandidate?.(solvedOutput);
    await restored;

    // Superseded waiters settle with the outcome of the render that replaced
    // them: resolving them false made valid loads report as unpreviewable.
    await expect(late).resolves.toBe(true);
    expect(editor.captureSpec()).toEqual(fallback);
  });

  it("keeps one preview solve in flight and renders the latest queued spec", async () => {
    const editor = await createEditorWithSource({});
    solveTransform.mockClear();
    let releaseFirst: ((value: typeof solvedOutput) => void) | undefined;
    solveTransform.mockImplementationOnce(
      () => new Promise<typeof solvedOutput>((resolve) => { releaseFirst = resolve; }),
    );
    solveTransform.mockResolvedValueOnce(solvedOutput);
    const firstSpec = normalizedSpec({
      tl: { x: 0.05, y: 0.05 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
    const latestSpec = normalizedSpec({
      tl: { x: 0.1, y: 0.1 },
      tr: { x: 0.95, y: 0.05 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });

    const first = editor.setSpec(firstSpec, { width: 200, height: 100 });
    const latest = editor.setSpec(latestSpec, { width: 200, height: 100 });
    expect(solveTransform).toHaveBeenCalledTimes(1);
    releaseFirst?.(solvedOutput);

    // The replaced intermediate settles with the latest render's outcome
    // instead of reporting a false preview failure.
    await expect(first).resolves.toBe(true);
    await expect(latest).resolves.toBe(true);
    expect(solveTransform).toHaveBeenCalledTimes(2);
    expect(solveTransform.mock.calls[1]?.[0]).toEqual(latestSpec);
  });

  it("rejects a pixel-space spec on both source and spec entry points", async () => {
    const editor = new PerspectiveEditor();
    const pixelSpec = {
      ...normalizedSpec(unitQuad()),
      destination: {
        space: "pixel" as const,
        reference: { width: 100, height: 100 },
        quad: unitQuad(),
      },
    };
    await expect(editor.setSource(fakeImage(), pixelSpec)).rejects.toThrow(
      "The interactive editor requires a normalized perspective spec",
    );
    await editor.setSource(fakeImage());
    await expect(editor.setSpec(pixelSpec, { width: 100, height: 50 })).rejects.toThrow(
      "The interactive editor requires a normalized perspective spec",
    );
  });

  it("rejects invalid preview targets before touching geometry", async () => {
    const editor = new PerspectiveEditor();
    await editor.setSource(fakeImage());
    for (const invalid of [
      { width: Number.NaN, height: 100 },
      { width: 100, height: Number.POSITIVE_INFINITY },
      { width: 0, height: 100 },
      { width: 100, height: -1 },
    ]) {
      await expect(editor.setSpec(normalizedSpec(unitQuad()), invalid)).rejects.toThrow(
        "The preview target has invalid dimensions",
      );
      await expect(
        editor.setSource(fakeImage(), undefined, { targetSize: invalid }),
      ).rejects.toThrow("The preview target has invalid dimensions");
    }
  });

  it("decouples the preview aspect from the source aspect via targetSize", async () => {
    const editor = new PerspectiveEditor();
    await editor.setSource(fakeImage());
    // A 200x100 source composes into a 50x200 rotated canvas: the viewBox
    // must follow the composed aspect, not the source's.
    await editor.setSpec(
      normalizedSpec({
        tl: { x: 1, y: 0 },
        tr: { x: 1, y: 1 },
        br: { x: 0, y: 1 },
        bl: { x: 0, y: 0 },
      }),
      { width: 50, height: 200 },
    );
    expect(editor.element).toBeDefined();
    const overlay = (editor as unknown as { overlay: { getAttribute: (key: string) => string } })
      .overlay;
    expect(overlay.getAttribute("viewBox")).toBe("0 0 50 200");
  });

  it("reuses the loaded source while replacing the spec and output aspect", async () => {
    const editor = await createEditorWithSource({});
    const rotated = normalizedSpec({
      tl: { x: 1, y: 0 },
      tr: { x: 1, y: 1 },
      br: { x: 0, y: 1 },
      bl: { x: 0, y: 0 },
    });
    solveTransform.mockClear();

    await editor.setSpec(rotated, { width: 50, height: 200 });

    expect(editor.captureSpec()).toEqual(rotated);
    expect(solveTransform).toHaveBeenLastCalledWith(rotated, { width: 50, height: 200 });
  });

  it("reuses one core Warp mesh while non-Warp geometry keeps changing", async () => {
    const warp = { preset: "twist", amount: 0.8 } as const;
    buildWarpMesh.mockResolvedValue({ subdivisions: 1, vertices: [] });
    const editor = new PerspectiveEditor();
    await editor.setSource(fakeImage(), normalizedSpec(unitQuad(), undefined, warp), {
      targetSize: { width: 200, height: 100 },
    });
    const changed = normalizedSpec({
      tl: { x: -0.1, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    }, undefined, warp);
    await editor.setSpec(changed, { width: 200, height: 100 });

    expect(buildWarpMesh).toHaveBeenCalledTimes(1);
    expect(buildWarpMesh).toHaveBeenCalledWith(warp);
  });

  it("hides transform handles without destroying their state", () => {
    const editor = new PerspectiveEditor();
    const handle = handleFor(editor, "tl");
    const reference = editor["referenceRect"] as unknown as ReturnType<typeof fakeElement>;
    editor.setHandlesVisible(false);
    expect(handle.hidden).toBe(true);
    expect(reference.style).toMatchObject({ display: "none" });
    editor.setHandlesVisible(true);
    expect(handle.hidden).toBe(false);
    expect(reference.style).toMatchObject({ display: "" });
    expect(handleFor(editor, "tl")).toBe(handle);
  });

  it("keeps controls aligned when a host fits the editor with CSS", async () => {
    const editor = await createEditorWithSource({});
    const topRight = handleFor(editor, "tr");
    const bottomRight = handleFor(editor, "br");

    editor.setPresentationSize({ width: 100, height: 50 });
    expect(topRight.style).toMatchObject({
      "--worldbend-control-x": "100px",
      "--worldbend-control-y": "0px",
    });
    expect(bottomRight.style).toMatchObject({
      "--worldbend-control-x": "100px",
      "--worldbend-control-y": "50px",
    });

    editor.setPresentationSize(undefined);
    expect(bottomRight.style).toMatchObject({
      "--worldbend-control-x": "200px",
      "--worldbend-control-y": "100px",
    });
  });

  it("exposes a movable reference point only in Transform mode", () => {
    const gestures: unknown[] = [];
    const editor = new PerspectiveEditor({
      transformPivotLabel: "Move reference point",
      onTransformGesture: (event) => gestures.push(event),
    });
    const pivot = pivotHandleFor(editor);
    expect(pivot.hidden).toBe(true);
    expect(pivot.getAttribute("aria-label")).toBe("Move reference point");

    editor.setInteractionMode("transform");
    editor.setTransformPivot({ x: 0.25, y: 0.75 });
    expect(pivot.hidden).toBe(false);
    expect(pivot.style).toMatchObject({
      "--worldbend-control-x": "0.25px",
      "--worldbend-control-y": "0.75px",
    });

    pivot.emit("keydown", {
      key: "ArrowRight",
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    });
    expect(gestures).toEqual([
      expect.objectContaining({ phase: "start", kind: "pivot", pointer: { x: 0.25, y: 0.75 } }),
      expect.objectContaining({ phase: "update" }),
      expect.objectContaining({ phase: "end" }),
    ]);
  });

  it("updates accessible corner labels without recreating the editor", () => {
    const editor = new PerspectiveEditor({
      cornerLabel: (corner, point) => `first:${corner}:${point.x}:${point.y}`,
    });
    const handle = handleFor(editor, "tl");
    expect(handle.getAttribute("aria-label")).toBe("first:tl:0:0");

    editor.setCornerLabelFormatter(
      (corner, point) => `second:${corner}:${point.x}:${point.y}`,
    );

    expect(handleFor(editor, "tl")).toBe(handle);
    expect(handle.getAttribute("aria-label")).toBe("second:tl:0:0");
  });

  it("coalesces a pointer-move storm into one render and one change per frame", async () => {
    const onChange = vi.fn();
    const editor = await createEditorWithSource({ onChange });
    const renderer = editor["renderer"] as unknown as {
      render: ReturnType<typeof vi.fn>;
    };
    renderer.render.mockClear();
    onChange.mockClear();

    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    for (let i = 1; i <= 20; i += 1) {
      handle.emit("pointermove", pointerEvent({ clientX: i * 5, clientY: i * 3 }));
    }
    expect(renderer.render).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    flushFrame();
    expect(onChange).toHaveBeenCalledTimes(1);
    // render() awaits the solve bridge, so it lands a microtask after the frame.
    await vi.waitFor(() => {
      expect(renderer.render).toHaveBeenCalledTimes(1);
    });

    for (let i = 1; i <= 10; i += 1) {
      handle.emit("pointermove", pointerEvent({ clientX: 120 + i, clientY: 40 + i }));
    }
    flushFrame();
    expect(onChange).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(renderer.render).toHaveBeenCalledTimes(2);
    });

    handle.emit("pointerup", pointerEvent({ clientX: 130, clientY: 50 }));
  });

  it("applies the exact final Distort pointer-up sample before committing", async () => {
    const onDistortGesture = vi.fn();
    const editor = await createEditorWithSource({ onDistortGesture });
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    handle.emit("pointermove", pointerEvent({ clientX: 120, clientY: 40 }));

    handle.emit(
      "pointerup",
      pointerEvent({ type: "pointerup", clientX: 160, clientY: 80 }),
    );

    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.4, y: 0.4 });
    expect(onDistortGesture).toHaveBeenLastCalledWith({
      phase: "end",
      corner: "tr",
      pointerId: 7,
      client: { x: 160, y: 80 },
      perspective: false,
    });
    flushFrame();
  });

  it("keeps a focus-only Distort click from moving the corner under the hit target", async () => {
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({ onEditEnd });
    const handle = handleFor(editor, "tl");

    handle.emit(
      "pointerdown",
      pointerEvent({ currentTarget: handle, clientX: 12, clientY: 8 }),
    );
    handle.emit(
      "pointerup",
      pointerEvent({ type: "pointerup", clientX: 12, clientY: 8 }),
    );

    expect(editor.captureSpec().destination.quad).toEqual(unitQuad());
    expect(onEditEnd).toHaveBeenCalledWith("distort");
  });

  it("keeps the last visible Distort sample when pointer capture is cancelled", async () => {
    const editor = await createEditorWithSource({});
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    handle.emit("pointermove", pointerEvent({ clientX: 120, clientY: 40 }));

    handle.emit(
      "pointercancel",
      pointerEvent({ type: "pointercancel", clientX: 200, clientY: 100 }),
    );

    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.3, y: 0.2 });
    flushFrame();
  });

  it("commits the last visible Distort sample when the embedded window loses focus", async () => {
    const onDistortGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({ onDistortGesture, onEditEnd });
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    handle.emit("pointermove", pointerEvent({ clientX: 180, clientY: -30 }));

    const addWindowListener = window.addEventListener as ReturnType<typeof vi.fn>;
    const blur = addWindowListener.mock.calls.find(([type]) => type === "blur")?.[1] as
      | (() => void)
      | undefined;
    blur?.();

    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.45, y: -0.15 });
    expect(onDistortGesture).toHaveBeenLastCalledWith({
      phase: "end",
      corner: "tr",
      pointerId: 7,
      client: { x: 180, y: -30 },
      perspective: false,
    });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(
      (handle as unknown as { dataset: Record<string, string> }).dataset.active,
    ).toBeUndefined();
    expect(editor.element.dataset.dragging).toBeUndefined();

    // Recovery must be immediate: a fresh pointer can own the same handle.
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle, pointerId: 9 }));
    expect(onDistortGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", pointerId: 9 }),
    );
  });

  it("self-heals a Distort drag when re-entry reports no pressed buttons", async () => {
    const onDistortGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({ onDistortGesture, onEditEnd });
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle, pointerId: 7 }));
    handle.emit("pointermove", pointerEvent({ pointerId: 7, buttons: 1, clientX: 120, clientY: 40 }));

    handle.emit("pointermove", pointerEvent({ pointerId: 7, buttons: 0, clientX: 300, clientY: 160 }));

    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.3, y: 0.2 });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(onDistortGesture).toHaveBeenLastCalledWith({
      phase: "end",
      corner: "tr",
      pointerId: 7,
      client: { x: 120, y: 40 },
      perspective: false,
    });
    expect(editor.element.dataset.dragging).toBeUndefined();

    handle.emit("pointerdown", pointerEvent({ currentTarget: handle, pointerId: 9 }));
    expect(onDistortGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", pointerId: 9 }),
    );
  });

  it("uses a window mouseup fallback as the exact final Distort sample", async () => {
    const editor = await createEditorWithSource({});
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    handle.emit("pointermove", pointerEvent({ clientX: 120, clientY: 40 }));

    const addWindowListener = window.addEventListener as ReturnType<typeof vi.fn>;
    const mouseup = addWindowListener.mock.calls.find(([type]) => type === "mouseup")?.[1] as
      | ((event: MouseEvent) => void)
      | undefined;
    mouseup?.({
      type: "mouseup",
      button: 0,
      clientX: 200,
      clientY: 80,
      shiftKey: false,
    } as MouseEvent);

    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.5, y: 0.4 });
  });

  it("ignores other pointers and releases a drag when pointer capture is lost", async () => {
    const onChange = vi.fn();
    const editor = await createEditorWithSource({ onChange });
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle, pointerId: 7 }));
    handle.emit("pointermove", pointerEvent({ pointerId: 8, clientX: 300, clientY: 150 }));
    expect(frameQueue).toHaveLength(0);

    handle.emit("lostpointercapture", pointerEvent({ pointerId: 7 }));
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle, pointerId: 9 }));
    handle.emit("pointermove", pointerEvent({ pointerId: 9, clientX: 200, clientY: 60 }));
    flushFrame();

    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(solveTransform).toHaveBeenCalled());
    handle.emit("pointerup", pointerEvent({ pointerId: 9 }));
  });

  it("reports each distinct render failure once while sweeping invalid geometry", async () => {
    const onError = vi.fn();
    const editor = await createEditorWithSource({ onError });
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));

    const fail = async (message: string): Promise<void> => {
      const previousCount = onError.mock.calls.length;
      solveTransform.mockRejectedValueOnce(new Error(message));
      handle.emit("pointermove", pointerEvent({ clientX: 200, clientY: 60 }));
      flushFrame();
      await vi.waitFor(() => {
        expect(onError.mock.calls.length).toBe(previousCount + 1);
      });
    };

    await fail("E_QUAD_SELF_INTERSECT: bowtie");
    const firstCount = onError.mock.calls.length;
    handle.emit("pointermove", pointerEvent({ clientX: 210, clientY: 61 }));
    flushFrame();
    expect(onError.mock.calls.length).toBe(firstCount);

    await fail("E_QUAD_DEGENERATE: collapsed");
    expect(onError.mock.calls.length).toBe(firstCount + 1);
    expect((editor.element as unknown as { dataset: Record<string, string> }).dataset.valid).toBe("false");

    handle.emit("pointerup", pointerEvent({ clientX: 210, clientY: 61 }));
  });

  it("notifies validity changes only on transitions", async () => {
    const onValidityChange = vi.fn();
    const editor = await createEditorWithSource({ onValidityChange });
    expect(onValidityChange).toHaveBeenCalledTimes(1);
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    for (let round = 0; round < 3; round += 1) {
      handle.emit("pointermove", pointerEvent({ clientX: 100 + round, clientY: 40 + round }));
      flushFrame();
    }
    expect(onValidityChange).toHaveBeenCalledTimes(1);
    handle.emit("pointerup", pointerEvent({ clientX: 103, clientY: 43 }));
  });

  it("reuses one export renderer across exports and disposes it with the editor", async () => {
    const editor = await createEditorWithSource({});
    const instances = (TransformWebGLRenderer as unknown as { instances: unknown[] }).instances;
    expect(instances).toHaveLength(1); // preview renderer only

    await editor.exportPng(100, 50);
    await editor.exportPng(100, 50);
    expect(instances).toHaveLength(2); // one shared export renderer

    const exportRenderer = instances[1] as { dispose: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn> };
    expect(exportRenderer.render).toHaveBeenCalledTimes(2);
    expect(exportRenderer.render.mock.calls[0]?.[3]).toBe("high");
    expect(exportRenderer.render.mock.calls[1]?.[3]).toBe("high");
    editor.dispose();
    expect(exportRenderer.dispose).toHaveBeenCalled();
  });

  it("uses an explicitly reacquired source raster for the final export", async () => {
    const editor = await createEditorWithSource({});
    const highResolutionSource = fakeImage();

    await editor.exportPng(100, 50, undefined, highResolutionSource);

    const instances = (TransformWebGLRenderer as unknown as { instances: unknown[] }).instances;
    const exportRenderer = instances[1] as { render: ReturnType<typeof vi.fn> };
    expect(exportRenderer.render.mock.calls[0]?.[0]).toBe(highResolutionSource);
    expect(exportRenderer.render.mock.calls[0]?.[3]).toBe("high");
  });

  it("reuses prepared solve and Warp geometry for the final export", async () => {
    const editor = await createEditorWithSource({});
    const mesh = { subdivisions: 1, vertices: [] };
    solveTransform.mockClear();
    buildWarpMesh.mockClear();

    await editor.exportPng(100, 50, undefined, undefined, {
      solved: solvedOutput,
      warpMesh: mesh,
    });

    expect(solveTransform).not.toHaveBeenCalled();
    expect(buildWarpMesh).not.toHaveBeenCalled();
    const instances = (TransformWebGLRenderer as unknown as { instances: unknown[] }).instances;
    const exportRenderer = instances[1] as { render: ReturnType<typeof vi.fn> };
    expect(exportRenderer.render.mock.calls[0]?.[1]).toBe(solvedOutput);
    expect(exportRenderer.render.mock.calls[0]?.[2]).toBe(mesh);
  });

});

describe("PerspectiveEditor transform gestures", () => {
  it("mounts edge handles that stay hidden until transform mode", async () => {
    const editor = new PerspectiveEditor({
      cornerLabel: (corner) => `distort:${corner}`,
      transformHandleLabel: (handle) => `transform:${handle}`,
    });
    await editor.setSource(fakeImage());
    const topEdge = handleByData(editor, "edge", "top");
    const corner = handleByData(editor, "corner", "tl");
    expect(topEdge.hidden).toBe(true);
    expect(corner.hidden).toBe(false);
    expect(corner.getAttribute("aria-label")).toBe("distort:tl");

    editor.setInteractionMode("transform");
    expect((editor.element as unknown as { dataset: Record<string, string> }).dataset.mode).toBe(
      "transform",
    );
    expect(topEdge.hidden).toBe(false);
    expect(corner.hidden).toBe(false);
    expect(corner.getAttribute("aria-label")).toBe("transform:tl");

    editor.setInteractionMode("distort");
    expect(topEdge.hidden).toBe(true);
    expect(corner.hidden).toBe(false);
    expect(corner.getAttribute("aria-label")).toBe("distort:tl");
  });

  it("routes corner drags to gesture events in transform mode", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const corner = handleByData(editor, "corner", "br");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    expect(onTransformGesture).toHaveBeenCalledTimes(1);
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", kind: "scale", handle: "br" }),
    );

    const surface = surfaceFor(editor);
    surface.emit("pointermove", pointerEvent({ clientX: 300, clientY: 140, shiftKey: false }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "update", shiftKey: false }),
    );

    surface.emit("pointerup", pointerEvent({ clientX: 300, clientY: 140 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "end" }),
    );
  });

  it("classifies surface grabs as move, rotate, or inert", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");

    // Inside the unit quad (400x200 rect, preview 200x100 -> clientX 100 = 0.25).
    const surface = surfaceFor(editor);
    surface.emit("pointerdown", pointerEvent({ clientX: 100, clientY: 50 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", kind: "move" }),
    );
    surface.emit("pointerup", pointerEvent({ clientX: 100, clientY: 50 }));

    // A point 40 display px outside the quad rotates.
    surface.emit("pointerdown", pointerEvent({ clientX: 440, clientY: 100 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", kind: "rotate" }),
    );
    surface.emit("pointerup", pointerEvent({ clientX: 440, clientY: 100 }));

    // Just outside the top edge stays inert (0.02 * 100 = 2 px < 10 px margin).
    onTransformGesture.mockClear();
    surface.emit("pointerdown", pointerEvent({ clientX: 100, clientY: -4 }));
    expect(onTransformGesture).not.toHaveBeenCalled();
  });

  it("captures the horizontal axis and moves only the same-row pair in Perspective", async () => {
    const onChange = vi.fn();
    const editor = await createEditorWithSource({ onChange });
    const corner = handleFor(editor, "tl");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: 40, clientY: 30, shiftKey: true }));
    flushFrame();

    const spec = editor.captureSpec();
    expect(spec.destination.quad.tl).toEqual({ x: 0.1, y: 0 });
    expect(spec.destination.quad.tr).toEqual({ x: 0.9, y: 0 });
    expect(spec.destination.quad.bl).toEqual({ x: 0, y: 1 });
    expect(spec.destination.quad.br).toEqual({ x: 1, y: 1 });
    corner.emit("pointerup", pointerEvent({ clientX: 40, clientY: 30 }));
  });

  it("captures the vertical axis, then keeps it locked through diagonal jitter", async () => {
    const editor = await createEditorWithSource({});
    editor.setDistortMode("perspective");
    const corner = handleFor(editor, "tl");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner, clientX: 10, clientY: 10 }));
    // Movement inside the four-screen-pixel intent threshold does not choose
    // a linked pair or create an initial jump.
    corner.emit("pointermove", pointerEvent({ clientX: 12, clientY: 13 }));
    expect(editor.captureSpec().destination.quad).toEqual(unitQuad());

    corner.emit("pointermove", pointerEvent({ clientX: 20, clientY: 50 }));
    expect(editor.captureSpec().destination.quad).toEqual({
      tl: { x: 0, y: 0.25 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 0.75 },
    });

    // A later large horizontal component cannot switch the pair mid-gesture.
    corner.emit("pointermove", pointerEvent({ clientX: 160, clientY: 60 }));
    expect(editor.captureSpec().destination.quad).toEqual({
      tl: { x: 0, y: 0.3 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 0.7 },
    });
    corner.emit("pointerup", pointerEvent({ clientX: 160, clientY: 60 }));
  });

  it("commits the last visible Free sample when Shift flips between move and release", async () => {
    const editor = await createEditorWithSource({});
    const corner = handleFor(editor, "tl");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: 60, clientY: 40, shiftKey: false }));
    const shown = editor.captureSpec().destination.quad;
    expect(shown.tl).toEqual({ x: 0.15, y: 0.2 });

    // Releasing with Shift pressed must not reinterpret the whole drag as a
    // Perspective gesture and wipe it back to the gesture-start quad.
    corner.emit("pointerup", pointerEvent({ clientX: 60, clientY: 40, shiftKey: true }));
    expect(editor.captureSpec().destination.quad).toEqual(shown);
  });

  it("keeps the last sampled Shift state on the Transform release boundary", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const corner = handleByData(editor, "corner", "br");
    const surface = surfaceFor(editor);

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    surface.emit("pointermove", pointerEvent({ clientX: 300, clientY: 140, shiftKey: false }));
    // The release event's own Shift state was never previewed; the end
    // boundary must carry the recipe the user actually saw.
    surface.emit("pointerup", pointerEvent({ clientX: 300, clientY: 140, shiftKey: true }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "end", shiftKey: false }),
    );
  });

  it("re-samples the active drag against compositor camera translation", async () => {
    const editor = await createEditorWithSource({});
    const corner = handleFor(editor, "tr");
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: 390, clientY: 40 }));
    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 0.975, y: 0.2 });

    expect(editor.updateActiveDistortCamera(99, { x: -20, y: 0 })).toBe(false);
    expect(editor.updateActiveDistortCamera(7, { x: -20, y: 0 })).toBe(true);
    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 1.025, y: 0.2 });

    corner.emit("pointerup", pointerEvent({ clientX: 390, clientY: 40 }));
    expect(editor.captureSpec().destination.quad.tr).toEqual({ x: 1.025, y: 0.2 });
  });

  it("keeps the real editor handle coupled through viewport edge auto-pan and release", async () => {
    vi.stubGlobal("getComputedStyle", () => ({
      position: "relative",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }));
    const mount = fakeElement("div") as unknown as Record<string, unknown> & HTMLElement;
    Object.assign(mount, { clientWidth: 400, clientHeight: 200 });
    let viewport: PreviewViewportHandle | undefined;
    const editor = new PerspectiveEditor({
      interactionSurface: mount,
      onDistortGesture(event) {
        viewport?.handleDistortGesture(event);
      },
      onChange() {
        viewport?.handleCanvasResized();
      },
    });
    await editor.setSource(fakeImage());
    viewport = createPreviewViewport(editor, mount);
    const corner = handleFor(editor, "tr");
    const overlay = (editor.element.children as unknown as Array<Record<string, unknown>>)
      .find((child) => child["tag"] === "svg") as {
        getBoundingClientRect: ReturnType<typeof vi.fn>;
      };
    overlay.getBoundingClientRect.mockReturnValue({
      left: 20,
      top: 10,
      width: 360,
      height: 180,
    });

    // Initial Fit leaves a 5% halo, so the real top-right handle is at
    // (380, 10) rather than flush with the 400 x 200 viewport edge.
    corner.emit(
      "pointerdown",
      pointerEvent({ currentTarget: corner, clientX: 380, clientY: 10 }),
    );
    corner.emit(
      "pointermove",
      pointerEvent({ buttons: 1, clientX: 490, clientY: 10 }),
    );
    flushFrame();

    const transform = /^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0\) scale\((-?[\d.]+)\)$/
      .exec(editor.element.style.transform);
    const visualX = Number(transform?.[1]) +
      editor.getCornerDisplayPoint("tr").x * Number(transform?.[3]);
    expect(visualX).toBeCloseTo(490, 8);
    const shownSpec = editor.captureSpec();
    expect(shownSpec.destination.quad.tr.x).toBeGreaterThan(1.225);

    corner.emit(
      "pointerup",
      pointerEvent({ type: "pointerup", clientX: 490, clientY: 10 }),
    );
    expect(editor.captureSpec()).toEqual(shownSpec);
    expect(editor.element.dataset.dragging).toBeUndefined();

    viewport.dispose();
    editor.dispose();
  });

  it("keeps a real Perspective pair stable while the pointer is held still at the edge", async () => {
    vi.stubGlobal("getComputedStyle", () => ({
      position: "relative",
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }));
    const mount = fakeElement("div") as unknown as Record<string, unknown> & HTMLElement;
    Object.assign(mount, { clientWidth: 400, clientHeight: 200 });
    let viewport: PreviewViewportHandle | undefined;
    const editor = new PerspectiveEditor({
      interactionSurface: mount,
      onDistortGesture(event) {
        viewport?.handleDistortGesture(event);
      },
      onChange() {
        viewport?.handleCanvasResized();
      },
    });
    await editor.setSource(fakeImage());
    editor.setDistortMode("perspective");
    viewport = createPreviewViewport(editor, mount);
    const corner = handleFor(editor, "br");

    corner.emit(
      "pointerdown",
      pointerEvent({ currentTarget: corner, clientX: 400, clientY: 200 }),
    );
    corner.emit(
      "pointermove",
      pointerEvent({ buttons: 1, clientX: 490, clientY: 200 }),
    );
    flushFrame();
    const assisted = editor.captureSpec();
    expect(assisted.destination.quad.br.x).toBeGreaterThan(1);
    expect(assisted.destination.quad.bl.x).toBeLessThan(0);
    expect(assisted.destination.quad.tl).toEqual({ x: 0, y: 0 });
    expect(assisted.destination.quad.tr).toEqual({ x: 1, y: 0 });

    flushFrame();
    flushFrame();
    expect(editor.captureSpec()).toEqual(assisted);

    corner.emit(
      "pointermove",
      pointerEvent({ buttons: 1, clientX: 510, clientY: 200 }),
    );
    flushFrame();
    expect(editor.captureSpec().destination.quad.br.x)
      .toBeGreaterThan(assisted.destination.quad.br.x);

    corner.emit(
      "pointerup",
      pointerEvent({ type: "pointerup", clientX: 510, clientY: 200 }),
    );
    viewport.dispose();
    editor.dispose();
  });

  it("keeps free-distort corners outside the original target frame", async () => {
    const editor = await createEditorWithSource({});
    const corner = handleFor(editor, "tl");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: -80, clientY: -40 }));
    flushFrame();

    expect(editor.captureSpec().destination.quad.tl).toEqual({ x: -0.2, y: -0.2 });
    expect(editor.getDisplaySize().width).toBeGreaterThan(editor.getTargetDisplaySize().width);
    expect(editor.getDisplaySize().height).toBeGreaterThan(editor.getTargetDisplaySize().height);
    expect(editor.getWorkspaceDisplayOffset().x).toBeLessThan(0);
    expect(editor.getWorkspaceDisplayOffset().y).toBeLessThan(0);
    const [previewSpec, previewSize] = (solveTransform.mock.calls.at(-1) ?? []) as [
      TransformSpec,
      { width: number; height: number },
    ];
    expect(previewSize).toEqual(expect.objectContaining({ width: 328, height: 164 }));
    for (const point of Object.values(previewSpec.destination.quad)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
    corner.emit("pointerup", pointerEvent({ clientX: -80, clientY: -40 }));
  });

  it("makes perspective an explicit Distort mode and Shift a temporary inverse", async () => {
    const editor = await createEditorWithSource({});
    editor.setDistortMode("perspective");
    const corner = handleFor(editor, "tl");

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: -40, clientY: -20 }));
    flushFrame();
    expect(editor.captureSpec().destination.quad).toEqual({
      tl: { x: -0.1, y: 0 },
      tr: { x: 1.1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
    corner.emit("pointerup", pointerEvent({ clientX: -40, clientY: -20 }));

    await editor.reset();
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit(
      "pointermove",
      pointerEvent({ clientX: 40, clientY: 20, shiftKey: true }),
    );
    flushFrame();
    expect(editor.captureSpec().destination.quad).toEqual({
      tl: { x: 0.1, y: 0.1 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
    corner.emit("pointerup", pointerEvent({ clientX: 40, clientY: 20 }));
  });

  it("emits a complete keyboard resize gesture from a transform handle", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    handleFor(editor, "tl").emit("keydown", { key: "ArrowRight", preventDefault: vi.fn() });

    const phases = onTransformGesture.mock.calls.map((call) => call[0].phase);
    expect(phases).toEqual(["start", "update", "end"]);
    expect(onTransformGesture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: "start", kind: "scale", handle: "tl" }),
    );
    const updateCall = onTransformGesture.mock.calls[1]?.[0];
    expect(updateCall).toEqual(
      expect.objectContaining({ phase: "update", pointer: { x: 1 / 200, y: 0 } }),
    );
  });

  it("exposes a focusable transform surface whose arrow keys move the plane", async () => {
    const onTransformGesture = vi.fn();
    const editor = new PerspectiveEditor({
      onTransformGesture,
      transformSurfaceLabel: "Move transform preview",
    });
    await editor.setSource(fakeImage());
    editor.setInteractionMode("transform");
    const surface = surfaceFor(editor);
    expect((surface as Record<string, unknown>)["tabIndex"]).toBe(0);
    expect(surface.getAttribute("aria-label")).toBe("Move transform preview");

    surface.emit("keydown", {
      target: editor.element,
      key: "ArrowRight",
      preventDefault: vi.fn(),
    });

    expect(onTransformGesture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ phase: "start", kind: "move" }),
    );
    expect(onTransformGesture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pointer: { x: 1 / 200, y: 0 } }),
    );
  });

  it("keeps nudging corners by arrow keys in distort mode", async () => {
    const editor = await createEditorWithSource({});
    const corner = handleFor(editor, "tr");
    corner.emit("keydown", { key: "ArrowLeft", preventDefault: vi.fn() });
    flushFrame();
    expect(editor.captureSpec().destination.quad.tr.x).toBeCloseTo(1 - 1 / 200, 10);
  });

  it("lets keyboard nudges cross the target boundary in both Distort modes", async () => {
    const editor = await createEditorWithSource({});
    const freeCorner = handleFor(editor, "tl");
    freeCorner.emit("keydown", { key: "ArrowLeft", preventDefault: vi.fn() });
    flushFrame();
    expect(editor.captureSpec().destination.quad.tl.x).toBeCloseTo(-1 / 200, 10);

    await editor.reset();
    editor.setDistortMode("perspective");
    handleFor(editor, "tr").emit("keydown", {
      key: "ArrowRight",
      preventDefault: vi.fn(),
    });
    flushFrame();
    const quad = editor.captureSpec().destination.quad;
    expect(quad.tr.x).toBeCloseTo(1 + 1 / 200, 10);
    expect(quad.tl.x).toBeCloseTo(-1 / 200, 10);
    expect(quad.br.x).toBeCloseTo(1, 10);
    expect(quad.bl.x).toBeCloseTo(0, 10);
  });

  it("treats Shift+arrow in free Distort mode as the symmetric perspective nudge", async () => {
    // Shift is deliberately double-duty: the 10x step multiplier in the
    // transform plane and the temporary inverse of the Distort sub-mode.
    // Pin the combined behavior so the entanglement stays intentional.
    const editor = await createEditorWithSource({});
    handleFor(editor, "tr").emit("keydown", {
      key: "ArrowRight",
      shiftKey: true,
      preventDefault: vi.fn(),
    });
    flushFrame();
    const quad = editor.captureSpec().destination.quad;
    expect(quad.tr.x).toBeCloseTo(1 + 10 / 200, 10);
    expect(quad.tl.x).toBeCloseTo(-10 / 200, 10);
    expect(quad.br.x).toBeCloseTo(1, 10);
    expect(quad.bl.x).toBeCloseTo(0, 10);
  });

  it("keeps keyboard steps in output pixels when a large target preview is capped", async () => {
    const onTransformGesture = vi.fn();
    const editor = new PerspectiveEditor({ maxPreviewAxis: 100, onTransformGesture });
    await editor.setSource(fakeImage(), undefined, { targetSize: { width: 2000, height: 1000 } });

    handleFor(editor, "tr").emit("keydown", { key: "ArrowLeft", preventDefault: vi.fn() });
    flushFrame();
    expect(editor.captureSpec().destination.quad.tr.x).toBeCloseTo(1 - 1 / 2000, 10);

    editor.setInteractionMode("transform");
    surfaceFor(editor).emit("keydown", {
      target: editor.element,
      key: "ArrowRight",
      preventDefault: vi.fn(),
    });
    expect(onTransformGesture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pointer: { x: 1 / 2000, y: 0 } }),
    );
  });

  it("commits repeated corner nudges once on key release", async () => {
    vi.useFakeTimers();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({ onEditEnd });
    const corner = handleFor(editor, "tr");

    corner.emit("keydown", { key: "ArrowRight", preventDefault: vi.fn() });
    corner.emit("keydown", { key: "ArrowRight", repeat: true, preventDefault: vi.fn() });
    corner.emit("keydown", { key: "ArrowRight", repeat: true, preventDefault: vi.fn() });
    expect(onEditEnd).not.toHaveBeenCalled();

    (editor.element as unknown as ReturnType<typeof fakeElement>).emit("keyup", {
      key: "ArrowRight",
    });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(onEditEnd).toHaveBeenCalledWith("distort");
    vi.useRealTimers();
  });

  it("keeps the rotation grab band constant through viewport zoom", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const overlay = editor["overlay"] as unknown as ReturnType<typeof fakeElement>;
    (overlay.getBoundingClientRect as ReturnType<typeof vi.fn>).mockReturnValue({
      left: 0,
      top: 0,
      width: 800,
      height: 400,
    });

    surfaceFor(editor).emit("pointerdown", pointerEvent({ clientX: 840, clientY: 200 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start", kind: "rotate" }),
    );
  });

  it("notifies onEditEnd when a distort drag and a transform gesture finish", async () => {
    const onEditEnd = vi.fn();
    const onDistortGesture = vi.fn();
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({
      onEditEnd,
      onDistortGesture,
      onTransformGesture,
    } as Parameters<typeof createEditorWithSource>[0]);

    const corner = handleFor(editor, "tr");
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    corner.emit("pointermove", pointerEvent({ clientX: 120, clientY: 40 }));
    corner.emit("pointerup", pointerEvent({ clientX: 120, clientY: 40 }));
    expect(onEditEnd).toHaveBeenLastCalledWith("distort");
    expect(onDistortGesture.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "update",
      "end",
    ]);
    expect(onDistortGesture).toHaveBeenLastCalledWith({
      phase: "end",
      corner: "tr",
      pointerId: 7,
      client: { x: 120, y: 40 },
      perspective: false,
    });

    editor.setInteractionMode("transform");
    const surface = surfaceFor(editor);
    surface.emit("pointerdown", pointerEvent({ clientX: 100, clientY: 50 }));
    surface.emit("pointerup", pointerEvent({ clientX: 110, clientY: 60 }));
    expect(onEditEnd).toHaveBeenLastCalledWith("transform");
  });

  it("keeps a Transform gesture owned by the pointer that started it", async () => {
    const onTransformGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({
      onTransformGesture,
      onEditEnd,
    } as Parameters<typeof createEditorWithSource>[0]);
    editor.setInteractionMode("transform");
    const surface = surfaceFor(editor);

    surface.emit(
      "pointerdown",
      pointerEvent({ pointerId: 7, clientX: 100, clientY: 50 }),
    );
    surface.emit(
      "pointerup",
      pointerEvent({ pointerId: 8, clientX: 300, clientY: 150 }),
    );

    expect(onTransformGesture.mock.calls.map(([event]) => event.phase)).toEqual(["start"]);
    expect(onEditEnd).not.toHaveBeenCalled();
    expect(surface.releasePointerCapture).not.toHaveBeenCalled();
    expect(editor.element.dataset.dragging).toBe("true");

    surface.emit(
      "pointerup",
      pointerEvent({ pointerId: 7, clientX: 120, clientY: 60, shiftKey: false }),
    );

    // The end boundary carries the gesture's sampled modifier state. No move
    // happened, so the synthetic down event's missing shiftKey propagates.
    expect(onTransformGesture).toHaveBeenLastCalledWith({
      phase: "end",
      pointer: { x: 0.3, y: 0.3 },
      shiftKey: undefined,
    });
    expect(onEditEnd).toHaveBeenCalledWith("transform");
    expect(surface.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(editor.element.dataset.dragging).toBeUndefined();
  });

  it("closes a Transform gesture at its last sample when the embedded window blurs", async () => {
    const onTransformGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({
      onTransformGesture,
      onEditEnd,
    } as Parameters<typeof createEditorWithSource>[0]);
    editor.setInteractionMode("transform");
    const corner = handleFor(editor, "tr");
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    surfaceFor(editor).emit("pointermove", pointerEvent({ clientX: 140, clientY: 40 }));

    const addWindowListener = window.addEventListener as ReturnType<typeof vi.fn>;
    const blur = addWindowListener.mock.calls.find(([type]) => type === "blur")?.[1] as
      | (() => void)
      | undefined;
    blur?.();

    expect(onTransformGesture.mock.calls.map(([event]) => event.phase)).toEqual([
      "start",
      "update",
      "end",
    ]);
    expect(onEditEnd).toHaveBeenCalledWith("transform");
    expect(surfaceFor(editor).releasePointerCapture).toHaveBeenCalledWith(7);
    expect(editor.element.dataset.dragging).toBeUndefined();

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner, pointerId: 9 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start" }),
    );
  });

  it("self-heals a Transform gesture when re-entry reports no pressed buttons", async () => {
    const onTransformGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({
      onTransformGesture,
      onEditEnd,
    } as Parameters<typeof createEditorWithSource>[0]);
    editor.setInteractionMode("transform");
    const surface = surfaceFor(editor);
    const corner = handleFor(editor, "tr");
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner, pointerId: 7 }));
    surface.emit("pointermove", pointerEvent({ pointerId: 7, buttons: 1, clientX: 140, clientY: 40 }));

    surface.emit("pointermove", pointerEvent({ pointerId: 7, buttons: 0, clientX: 320, clientY: 160 }));

    expect(onTransformGesture).toHaveBeenLastCalledWith({
      phase: "end",
      pointer: { x: 0.35, y: 0.2 },
      shiftKey: undefined,
    });
    expect(onEditEnd).toHaveBeenCalledTimes(1);
    expect(editor.element.dataset.dragging).toBeUndefined();

    corner.emit("pointerdown", pointerEvent({ currentTarget: corner, pointerId: 9 }));
    expect(onTransformGesture).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "start" }),
    );
  });

  it("lets a transform gesture survive the setSpec feedback loop", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const corner = handleFor(editor, "tl");
    corner.emit("pointerdown", pointerEvent({ currentTarget: corner }));
    expect(onTransformGesture).toHaveBeenCalledTimes(1);

    await editor.setSpec(
      normalizedSpec({
        tl: { x: 0.1, y: 0 },
        tr: { x: 0.9, y: 0.1 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 0.9 },
      }),
      { width: 200, height: 100 },
    );
    onTransformGesture.mockClear();
    surfaceFor(editor).emit("pointermove", pointerEvent({ clientX: 60, clientY: 40 }));
    expect(onTransformGesture).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "update" }),
    );
  });

  it("keeps pointer samples in the gesture-start frame while feedback resizes the preview", async () => {
    const onTransformGesture = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const overlay = editor["overlay"] as unknown as ReturnType<typeof fakeElement>;
    const corner = handleByData(editor, "corner", "br");
    corner.emit(
      "pointerdown",
      pointerEvent({ currentTarget: corner, clientX: 400, clientY: 200 }),
    );
    (overlay.getBoundingClientRect as ReturnType<typeof vi.fn>).mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    });

    surfaceFor(editor).emit(
      "pointermove",
      pointerEvent({ clientX: 300, clientY: 150 }),
    );

    expect(onTransformGesture).toHaveBeenLastCalledWith({
      phase: "update",
      pointer: { x: 0.75, y: 0.75 },
      shiftKey: undefined,
    });
  });

  it("finishes a cancelled pointer with the last visible sample", async () => {
    const onTransformGesture = vi.fn();
    const onEditEnd = vi.fn();
    const editor = await createEditorWithSource({ onTransformGesture, onEditEnd } as Parameters<
      typeof createEditorWithSource
    >[0]);
    editor.setInteractionMode("transform");
    const corner = handleByData(editor, "corner", "br");
    corner.emit(
      "pointerdown",
      pointerEvent({ currentTarget: corner, clientX: 400, clientY: 200 }),
    );
    const surface = surfaceFor(editor);
    surface.emit("pointermove", pointerEvent({ clientX: 300, clientY: 150, shiftKey: false }));
    surface.emit("pointercancel", pointerEvent({ clientX: 0, clientY: 0, shiftKey: false }));

    expect(onTransformGesture).toHaveBeenLastCalledWith({
      phase: "end",
      pointer: { x: 0.75, y: 0.75 },
      shiftKey: false,
    });
    expect(onEditEnd).toHaveBeenLastCalledWith("transform");
  });
});

function surfaceFor(editor: PerspectiveEditor): ReturnType<typeof fakeElement> {
  return editor.element as unknown as ReturnType<typeof fakeElement>;
}

function handleByData(
  editor: PerspectiveEditor,
  key: "edge" | "corner",
  value: string,
): ReturnType<typeof fakeElement> {
  const children = editor.element.children as unknown as unknown[];
  const handle = children.find(
    (child): boolean =>
      typeof child === "object" &&
      child !== null &&
      ((child as Record<string, Record<string, unknown>>)["dataset"]?.[key] === value),
  );
  if (!handle) throw new Error(`handle ${key}=${value} not mounted`);
  return handle as ReturnType<typeof fakeElement>;
}

describe("PerspectiveEditor source orientation", () => {
  it("round-trips a flipped orientation through setSpec and captureSpec", async () => {
    const editor = await createEditorWithSource({});
    const flipped = {
      ...normalizedSpec(unitQuad()),
      content: { fit: "stretch" as const, orientation: "flipHorizontal" as const },
    };
    await editor.setSpec(flipped, { width: 200, height: 100 });
    expect(editor.captureSpec().content.orientation).toBe("flipHorizontal");
    // Corner edits keep the orientation: flips are content data, not geometry.
    const handle = handleFor(editor, "tr");
    handle.emit("pointerdown", pointerEvent({ currentTarget: handle }));
    handle.emit("pointermove", pointerEvent({ clientX: 150, clientY: 40 }));
    flushFrame();
    expect(editor.captureSpec().content.orientation).toBe("flipHorizontal");
    handle.emit("pointerup", pointerEvent({ clientX: 150, clientY: 40 }));
  });

  it("adopts a spec orientation on setSource and resets to native", async () => {
    const editor = new PerspectiveEditor();
    const flipped = {
      ...normalizedSpec({
        tl: { x: 0.1, y: 0 },
        tr: { x: 0.9, y: 0.1 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 0.9 },
      }),
      content: { fit: "stretch" as const, orientation: "flipBoth" as const },
    };
    await editor.setSource(fakeImage(), flipped);
    expect(editor.captureSpec().content.orientation).toBe("flipBoth");

    // A plain setSource without a spec starts from native.
    await editor.setSource(fakeImage());
    expect(editor.captureSpec().content.orientation).toBeUndefined();
  });
});
