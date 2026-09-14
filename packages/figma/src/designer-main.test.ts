import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeshSpec } from "./mesh-workspace";
import { defaultMockup } from "./mockup-workspace";
import {
  canvasTemplateFromSet,
  spatialTemplateFromMockup,
} from "./stored-template-library";

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
  Object.assign(page, { children: sources });
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
    root: { children: [page] },
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn(async () => undefined) },
    showUI: vi.fn(), on: vi.fn(), commitUndo: vi.fn(), notify: vi.fn(),
    viewport: { scrollAndZoomIntoView: vi.fn() },
    ui: { on: vi.fn(),
      onmessage: undefined as ((message: unknown) => void) | undefined, postMessage: vi.fn((message: unknown) => posts.push(message)) },
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
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => {
      const message = posts.find((candidate) => (candidate as { type?: string }).type === "source") as { payload: { sources?: unknown[] } } | undefined;
      expect(message?.payload.sources).toHaveLength(2);
    });
  });

  it("publishes one canonical task result with recoverable shared data", async () => {
    const { figmaMock, posts, result, sources } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
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
    expect(result).toMatchObject({ x: 148, y: 20, width: 100, height: 80 });
    expect(figmaMock.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([result, ...sources]);
    expect(figmaMock.commitUndo).toHaveBeenCalledTimes(2);
  });

  it("rejects a designer result when selection changes during source lookup", async () => {
    const { figmaMock, page, posts, sources } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));

    let resolveLookup!: (value: (typeof sources)[number]) => void;
    const pendingLookup = new Promise<(typeof sources)[number]>((resolve) => {
      resolveLookup = resolve;
    });
    figmaMock.getNodeByIdAsync.mockImplementationOnce(() => pendingLookup);
    const selectionHandler = figmaMock.on.mock.calls.find(([type]) => type === "selectionchange")?.[1] as
      | (() => void)
      | undefined;

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
    await vi.waitFor(() => expect(figmaMock.getNodeByIdAsync).toHaveBeenCalledWith("source-1"));
    page.selection = [];
    selectionHandler?.();
    resolveLookup(sources[0]!);

    await vi.waitFor(() => expect(posts).toContainEqual({
      type: "apply-designer-error",
      generation: 1,
      message: { key: "selectionChanged" },
    }));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(figmaMock.createRectangle).not.toHaveBeenCalled();
  });

  it("persists and removes a validated Spatial Template through client storage", async () => {
    const { figmaMock, posts } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const template = spatialTemplateFromMockup(defaultMockup([{
      sourceNodeId: "source-1",
      sourceName: "Source",
      renderWidth: 100,
      renderHeight: 80,
      placement: { x: 0, y: 20, width: 100, height: 80 },
      image: {} as HTMLImageElement,
    }]));
    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 11,
      name: "Card",
      template,
    });
    await vi.waitFor(() => {
      expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(1);
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library",
        mutation: { kind: "save", workspace: "mockup", requestId: 11 },
        templates: [expect.objectContaining({ name: "Card", template })],
      }));
    });
    const saved = posts.findLast((message) =>
      (message as { type?: string; templates?: unknown[] }).type === "template-library" &&
      (message as { templates?: unknown[] }).templates?.length === 1
    ) as { templates: Array<{ id: string }> };
    figmaMock.ui.onmessage?.({
      type: "delete-template",
      requestId: 12,
      id: saved.templates[0]!.id,
    });
    await vi.waitFor(() => {
      expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(2);
      expect(posts.at(-1)).toEqual({
        type: "template-library",
        templates: [],
        mutation: { kind: "delete", requestId: 12 },
      });
    });
  });

  it("rejects saving a second template under an existing name without writing storage", async () => {
    const { figmaMock, posts } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const template = spatialTemplateFromMockup(defaultMockup([{
      sourceNodeId: "source-1",
      sourceName: "Source",
      renderWidth: 100,
      renderHeight: 80,
      placement: { x: 0, y: 20, width: 100, height: 80 },
      image: {} as HTMLImageElement,
    }]));

    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 21,
      name: "Card",
      template,
    });
    await vi.waitFor(() => expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(1));

    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 22,
      name: "Card",
      template,
    });
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library-error",
        mutation: { kind: "save", workspace: "mockup", requestId: 22 },
        message: { key: "templateNameExists", values: { name: "Card" } },
      }));
      expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(1);
    });
  });

  it("persists a validated Sizes task template without fabricating a program root", async () => {
    const { figmaMock, posts } = setup(1);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const template = canvasTemplateFromSet({
      schema: "worldbend.canvas-set",
      version: "0.1",
      variants: [{
        id: "square",
        operation: { kind: "stretch", output: { width: 1080, height: 1080 } },
      }],
    });

    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "canvas",
      requestId: 13,
      name: "Social square",
      template,
    });

    await vi.waitFor(() => {
      expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(1);
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library",
        mutation: { kind: "save", workspace: "canvas", requestId: 13 },
        templates: [expect.objectContaining({ name: "Social square", template })],
      }));
    });
  });

  it("keeps the UI usable but rejects mutations when template storage cannot be read", async () => {
    const { figmaMock, posts } = setup(1);
    figmaMock.clientStorage.getAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("storage unavailable"));
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => {
      expect(posts).toContainEqual({ type: "template-library", templates: [] });
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library-error",
      }));
      expect(posts).toContainEqual(expect.objectContaining({ type: "source" }));
    });

    const template = spatialTemplateFromMockup(defaultMockup([{
      sourceNodeId: "source-1",
      sourceName: "Source",
      renderWidth: 100,
      renderHeight: 80,
      placement: { x: 0, y: 20, width: 100, height: 80 },
      image: {} as HTMLImageElement,
    }]));
    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 21,
      name: "Must not overwrite",
      template,
    });
    figmaMock.ui.onmessage?.({
      type: "delete-template",
      requestId: 22,
      id: "template-existing",
    });
    await vi.waitFor(() => {
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library-error",
        mutation: { kind: "save", workspace: "mockup", requestId: 21 },
      }));
      expect(posts).toContainEqual(expect.objectContaining({
        type: "template-library-error",
        mutation: { kind: "delete", requestId: 22 },
      }));
    });
    expect(figmaMock.clientStorage.setAsync).not.toHaveBeenCalled();
  });

  it("reports a correlated write failure and keeps the mutation queue usable", async () => {
    const { figmaMock, posts } = setup(1);
    figmaMock.clientStorage.setAsync
      .mockRejectedValueOnce(new Error("storage write failed"))
      .mockResolvedValueOnce(undefined);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const template = spatialTemplateFromMockup(defaultMockup([{
      sourceNodeId: "source-1",
      sourceName: "Source",
      renderWidth: 100,
      renderHeight: 80,
      placement: { x: 0, y: 20, width: 100, height: 80 },
      image: {} as HTMLImageElement,
    }]));

    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 31,
      name: "First attempt",
      template,
    });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "template-library-error",
      mutation: { kind: "save", workspace: "mockup", requestId: 31 },
    })));

    figmaMock.ui.onmessage?.({
      type: "save-template",
      workspace: "mockup",
      requestId: 32,
      name: "Recovered",
      template,
    });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "template-library",
      mutation: { kind: "save", workspace: "mockup", requestId: 32 },
      templates: [expect.objectContaining({ name: "Recovered" })],
    })));
    expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(2);
  });
});
