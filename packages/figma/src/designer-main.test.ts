import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeshSpec } from "./mesh-workspace";

function sourceNode(id: string, x: number, page: object) {
  return {
    id,
    name: id,
    type: "RECTANGLE",
    visible: true,
    parent: page,
    width: 100,
    height: 80,
    absoluteBoundingBox: { x, y: 20, width: 100, height: 80 },
    getSharedPluginData: vi.fn(() => ""),
    getPluginData: vi.fn(() => ""),
    exportAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
}

function setup(selectionCount: number) {
  const posts: unknown[] = [];
  const page = { type: "PAGE", selection: [] as unknown[], on: vi.fn(), off: vi.fn() };
  const sources = Array.from({ length: selectionCount }, (_, index) => sourceNode(`source-${index + 1}`, index * 120, page));
  page.selection = sources;
  const result = {
    id: "result",
    type: "RECTANGLE",
    name: "",
    x: 0, y: 0, width: 100, height: 80,
    fills: [] as unknown[],
    parent: page,
    resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) { this.width = width; this.height = height; }),
    setSharedPluginData: vi.fn(),
    setPluginData: vi.fn(),
    getSharedPluginData: vi.fn(() => ""),
    getPluginData: vi.fn(() => ""),
    remove: vi.fn(),
  };
  const figmaMock = {
    mixed: Symbol("mixed"),
    currentPage: page,
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn(async () => undefined) },
    showUI: vi.fn(), on: vi.fn(), commitUndo: vi.fn(), notify: vi.fn(),
    viewport: { scrollAndZoomIntoView: vi.fn() },
    ui: { onmessage: undefined as ((message: unknown) => void) | undefined, postMessage: vi.fn((message: unknown) => posts.push(message)) },
    getNodeByIdAsync: vi.fn(async (id: string) => sources.find((source) => source.id === id)),
    createImage: vi.fn(() => ({ hash: "image-hash" })),
    createRectangle: vi.fn(() => result),
    triggerUndo: vi.fn(),
  };
  vi.stubGlobal("figma", figmaMock);
  vi.stubGlobal("__html__", "");
  return { figmaMock, page, posts, result, sources };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("Figma designer task main boundary", () => {
  it("exports 1–8 raw selections as an ordered source set", async () => {
    const { figmaMock, posts } = setup(2);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => {
      const message = posts.find((candidate) => (candidate as { type?: string }).type === "source") as { payload: { sources?: unknown[] } } | undefined;
      expect(message?.payload.sources).toHaveLength(2);
    });
  });

  it("publishes one canonical task result with recoverable shared data", async () => {
    const { figmaMock, posts, result } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"] });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({
      type: "apply-designer",
      payload: {
        generation: 1,
        task: { kind: "mesh", spec: createMeshSpec(100, 80, 2) },
        sourceNodeIds: ["source-1"],
        bytes: new Uint8Array([9]),
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 0, y: 20, width: 100, height: 80 },
      },
    });
    await vi.waitFor(() => expect(posts).toContainEqual({
      type: "apply-designer-complete",
      generation: 1,
      targetNodeId: "result",
      operation: "apply",
    }));
    expect(result.setSharedPluginData).toHaveBeenCalledWith(
      "worldbend", "task", expect.stringContaining('"kind":"mesh"'),
    );
    expect(figmaMock.commitUndo).toHaveBeenCalledTimes(2);
  });
});
