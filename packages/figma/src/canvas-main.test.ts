import { afterEach, describe, expect, it, vi } from "vitest";

function resultNode(id: string, failStoredWrite = false) {
  let fills: unknown[] = [];
  return {
    id,
    name: "",
    type: "RECTANGLE",
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) {
      this.width = width;
      this.height = height;
    }),
    get fills() {
      return fills;
    },
    set fills(value: unknown[]) {
      fills = value;
    },
    setSharedPluginData: vi.fn((_namespace: string, key: string, _value: string) => {
      if (failStoredWrite && key === "canvas") throw new Error("stored write failed");
    }),
    getSharedPluginData: vi.fn((_namespace: string, _key: string) => ""),
    setPluginData: vi.fn((_key: string, _value: string) => undefined),
    getPluginData: vi.fn((_key: string) => ""),
    remove: vi.fn(),
  };
}

function canvasSetMessage() {
  const variants = [
    {
      id: "wide",
      operation: {
        kind: "contain" as const,
        output: { width: 1200, height: 628 },
        anchor: { x: 0.5 as const, y: 0.5 as const },
        background: { kind: "transparent" as const },
      },
    },
    {
      id: "square",
      operation: {
        kind: "cover" as const,
        output: { width: 1080, height: 1080 },
        anchor: { x: 0.5 as const, y: 0.5 as const },
        background: { kind: "color" as const, space: "srgb8" as const, rgba: [255, 255, 255, 255] as const },
      },
    },
  ];
  return {
    type: "apply-canvas" as const,
    payload: {
      generation: 1,
      sourceNodeId: "source",
      setSpec: { schema: "worldbend.canvas-set" as const, version: "0.1" as const, variants },
      outputs: [
        {
          id: "wide",
          bytes: new Uint8Array([1]),
          renderWidth: 1200,
          renderHeight: 628,
          // Stale UI-side hints: main-side publication must place beside the
          // inputs regardless of these x/y values.
          placement: { x: 5000, y: 5000, width: 300, height: 157 },
        },
        {
          id: "square",
          bytes: new Uint8Array([2]),
          renderWidth: 1080,
          renderHeight: 1080,
          placement: { x: -100, y: -100, width: 270, height: 270 },
        },
      ],
    },
  };
}

function setup(
  results: ReturnType<typeof resultNode>[],
  replacement?: { failFirstCanvasWrite?: boolean },
) {
  const posts: unknown[] = [];
  const page = { type: "PAGE", selection: [] as unknown[], on: vi.fn(), off: vi.fn() };
  const source = {
    id: "source",
    name: "Hero",
    type: "RECTANGLE",
    visible: true,
    parent: page,
    width: 100,
    height: 80,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
    getSharedPluginData: vi.fn(() => ""),
    getPluginData: vi.fn(() => ""),
    exportAsync: vi.fn(async () => new Uint8Array([9])),
  };
  const storedCanvas = JSON.stringify({
    schema: "worldbend.canvas",
    version: "0.1",
    operation: {
      kind: "cover",
      output: { width: 1080, height: 1080 },
      anchor: { x: 0.5, y: 0.5 },
      background: { kind: "transparent" },
    },
  });
  const target = replacement
    ? Object.assign(resultNode("target"), {
        name: "Hero · square",
        visible: true,
        parent: page,
        width: 1080,
        height: 1080,
        x: 10,
        y: 20,
        absoluteBoundingBox: { x: 10, y: 20, width: 1080, height: 1080 },
      })
    : undefined;
  if (target) {
    target.fills = [{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }];
    target.getSharedPluginData.mockImplementation((_namespace: string, key: string) =>
      key === "canvas" ? storedCanvas : "",
    );
    target.getPluginData.mockImplementation((key: string) =>
      key === "worldbend.renderWidth" || key === "worldbend.renderHeight" ? "1080" : "",
    );
    let failed = false;
    target.setSharedPluginData.mockImplementation((_namespace: string, key: string, value: string) => {
      if (
        replacement?.failFirstCanvasWrite &&
        key === "canvas" &&
        value !== storedCanvas &&
        !failed
      ) {
        failed = true;
        throw new Error("stored write failed");
      }
    });
  }
  page.selection = target ? [source, target] : [source];
  Object.assign(page, { children: target ? [source, target] : [source] });
  const figmaMock = {
    currentPage: page,
    mixed: Symbol("mixed"),
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() },
    showUI: vi.fn(),
    on: vi.fn(),
    getNodeByIdAsync: vi.fn(async (id: string) =>
      id === source.id ? source : id === target?.id ? target : null,
    ),
    createImage: vi.fn((bytes: Uint8Array) => ({ hash: `image-${bytes[0]}` })),
    createRectangle: vi.fn(() => results.shift()),
    commitUndo: vi.fn(),
    viewport: { scrollAndZoomIntoView: vi.fn() },
    notify: vi.fn(),
    ui: {
      onmessage: undefined as ((message: unknown) => void) | undefined,
      postMessage: vi.fn((message: unknown) => posts.push(message)),
    },
  };
  vi.stubGlobal("figma", figmaMock);
  vi.stubGlobal("__html__", "");
  return { figmaMock, posts, source, target };
}

function singleReplacementMessage() {
  const message = canvasSetMessage();
  return {
    ...message,
    payload: {
      ...message.payload,
      targetNodeId: "target",
      setSpec: { ...message.payload.setSpec, variants: [message.payload.setSpec.variants[0]!] },
      outputs: [
        {
          ...message.payload.outputs[0]!,
          placement: { x: 10, y: 20, width: 1200, height: 628 },
        },
      ],
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Figma Canvas document transaction", () => {
  it("publishes an ordered set inside one undo boundary and keeps source selection", async () => {
    const wide = resultNode("wide-result");
    const square = resultNode("square-result");
    const { figmaMock, posts, source } = setup([wide, square]);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(canvasSetMessage());

    await vi.waitFor(() => {
      expect(posts).toContainEqual({
        type: "apply-canvas-complete",
        generation: 1,
        targetNodeIds: ["wide-result", "square-result"],
        operation: "apply",
      });
    });
    expect(figmaMock.commitUndo).toHaveBeenCalledTimes(2);
    expect(figmaMock.createImage).toHaveBeenCalledTimes(2);
    expect(figmaMock.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([wide, square, source]);
    expect(pageSelection(figmaMock.currentPage)).toEqual([source]);
    // Main-side publication placement: beside the source, variants chained.
    expect(wide).toMatchObject({ x: 148, y: 0, width: 300, height: 157 });
    expect(square).toMatchObject({ x: 496, y: 0, width: 270, height: 270 });
    expect(wide.setSharedPluginData).toHaveBeenCalledWith(
      "worldbend",
      "canvas",
      expect.stringContaining('"schema":"worldbend.canvas"'),
    );
  });

  it("removes every created result when a later publication step fails", async () => {
    const wide = resultNode("wide-result");
    const square = resultNode("square-result", true);
    const { figmaMock, posts } = setup([wide, square]);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(canvasSetMessage());

    await vi.waitFor(() => {
      expect(posts).toContainEqual(
        expect.objectContaining({ type: "apply-canvas-error", generation: 1 }),
      );
    });
    expect(wide.remove).toHaveBeenCalledTimes(1);
    expect(square.remove).toHaveBeenCalledTimes(1);
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-canvas-complete" }));
    expect(figmaMock.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  });

  it("replaces one Canvas result at the new output aspect without creating another node", async () => {
    const { figmaMock, posts, target } = setup([], {});
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(singleReplacementMessage());

    await vi.waitFor(() => {
      expect(posts).toContainEqual({
        type: "apply-canvas-complete",
        generation: 1,
        targetNodeIds: ["target"],
        operation: "replace",
      });
    });
    expect(figmaMock.createRectangle).not.toHaveBeenCalled();
    expect(target?.resize).toHaveBeenCalledWith(1200, 628);
    expect(target).toMatchObject({ x: 10, y: 20, width: 1200, height: 628 });
    expect((target?.width ?? 0) / (target?.height ?? 1)).toBeCloseTo(1200 / 628, 10);
  });

  it("restores the selected Canvas result if its single replacement fails", async () => {
    const { figmaMock, posts, target } = setup([], { failFirstCanvasWrite: true });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(singleReplacementMessage());

    await vi.waitFor(() => {
      expect(posts).toContainEqual(
        expect.objectContaining({ type: "apply-canvas-error", generation: 1 }),
      );
    });
    expect(target).toMatchObject({ x: 10, y: 20, width: 1080, height: 1080 });
    expect(target?.fills).toEqual([{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }]);
    expect(target?.remove).not.toHaveBeenCalled();
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-canvas-complete" }));
  });
});

function pageSelection(page: { selection: unknown[] }): unknown[] {
  return page.selection;
}
