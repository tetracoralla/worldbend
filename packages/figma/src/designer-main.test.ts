import { documentShapeForSource, normalizedDocumentShape } from "./native-shape";
import { deformationTask } from "./stored-designer-task";
import { deformationWorkFromMesh } from "./deformation-work-state";
import {nativeVectorOperationDigest} from "./native-vector-operation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readySceneRecords } from "./ready-scenes";
import { createMeshSpec } from "./mesh-workspace";
import { defaultMockup } from "./mockup-workspace";
import {
  canvasTemplateFromSet,
  deformationTemplateFromWork,
  spatialTemplateFromMockup,
} from "./stored-template-library";

function spatialTask() {
  const viewport = { width: 100, height: 80 };
  return {
    kind: "effect" as const,
    recipe: {
      schema: "worldbend.effect-recipe" as const, version: "3" as const,
      origin: { effect: "multiplane-camera" as const, version: "3" as const, viewport, intensity: .8 },
      viewport,
      camera: { focalLength: 220, focusDistance: 1000, travel: { x: 8, y: 6.4 } },
      appearance: { depthOfField: { focusDistance: 1000, focusRange: 300, maxBlurRadius: 12 }, motionBlur: { exposureFraction: .65, maxBlurRadius: 24 } },
      layers: [
        { id: "background", offset: { x: -10, y: -8 }, surface: { kind: "camera-plane" as const, size: { width: 120, height: 96 }, distance: 1500 }, tracks: [] },
        { id: "middle", offset: { x: -10, y: -8 }, surface: { kind: "camera-plane" as const, size: { width: 120, height: 96 }, distance: 1000 }, tracks: [] },
        { id: "foreground", offset: { x: -10, y: -8 }, surface: { kind: "camera-plane" as const, size: { width: 120, height: 96 }, distance: 650 }, tracks: [] },
      ],
    },
    state: { progress: 1, pointerX: 0, pointerY: 0, reducedMotion: false },
  };
}

function mockupTask(opacity = 1) {
  const transform = { schema: "worldbend.transform" as const, version: "0.1" as const,
    destination: { space: "normalized" as const, quad: {
      tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
    } }, content: { fit: "stretch" as const } };
  return { kind: "mockup" as const, spec: {
    schema: "worldbend.mockup" as const, version: "0.1" as const,
    canvas: { width: 100, height: 80 }, background: { kind: "transparent" as const }, seams: [],
    planes: [
      { id: "artwork", sourceId: "source-1", opacity, transform },
      { id: "scene", sourceId: "source-2", opacity: 1, transform },
    ],
  } };
}

function sourceNode(id: string, x: number, page: object) {
  return {
    id,
    name: id,
    type: "RECTANGLE",
    visible: true,
    fills: [],
    strokes: [],
    effects: [],
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
  const shared = new Map<string, string>();
  const plugin = new Map<string, string>();
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
    visible: true,
    absoluteBoundingBox: { x: 0, y: 20, width: 100, height: 80 },
    resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) { this.width = width; this.height = height; }),
    setSharedPluginData: vi.fn((_namespace: string, key: string, value: string) => shared.set(key, value)),
    setPluginData: vi.fn((key: string, value: string) => plugin.set(key, value)),
    getSharedPluginData: vi.fn((_namespace: string, key: string) => shared.get(key) ?? ""),
    getPluginData: vi.fn((key: string) => plugin.get(key) ?? ""),
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
    getNodeByIdAsync: vi.fn(async (id: string) => id === result.id ? result : sources.find((source) => source.id === id)),
    createImage: vi.fn(() => ({ hash: "image-hash" })),
    createRectangle: vi.fn(() => result),
    triggerUndo: vi.fn(),
  };
  vi.stubGlobal("figma", figmaMock);
  vi.stubGlobal("__html__", "");
  return { figmaMock, page, posts, result, sources, shared, plugin };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function sourceWithLinkedResult() {
  const ready = setup(1);
  const { figmaMock, page, posts, result, sources, shared } = ready;
  const task = mockupTask();
  task.spec.planes = [task.spec.planes[0]!];
  shared.set("task", JSON.stringify(task));
  shared.set("binding", JSON.stringify({
    schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
    sourceNodeIds: [sources[0]!.id], revision: 3, renderWidth: 100, renderHeight: 80,
  }));
  Object.assign(page, {
    children: [...sources, result],
    loadAsync: vi.fn(async () => undefined),
    findAllWithCriteria: vi.fn(() => [result]),
  });
  await import("./main");
  figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
  await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
    type: "source", payload: expect.objectContaining({
      linkedResults: { total: 1, items: [{ nodeId: "result", name: "", revision: 3,
        kind: "mockup", position: { x: 0, y: 20 } }] },
    }),
  })));
  return ready;
}

describe("Figma designer task main boundary", () => {
  it("expands a continued rotated raster in its own axes and refuses replaying the old frame change",async()=>{
    const {figmaMock,page,posts,result,sources,shared,plugin}=setup(1);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4)),task=deformationTask(work,"mesh");
    const matrix=[[.8,-.6,120],[.6,.8,20]];
    Object.assign(result,{relativeTransform:matrix,absoluteTransform:matrix});
    shared.set("task",JSON.stringify(task));
    shared.set("binding",JSON.stringify({schema:"worldbend.figma.binding",version:"0.1",resultNodeId:result.id,sourceNodeIds:[sources[0]!.id],revision:1,renderWidth:100,renderHeight:80}));
    plugin.set("worldbend.renderWidth","100");plugin.set("worldbend.renderHeight","80");
    page.selection=[result];Object.assign(page,{children:[...sources,result]});
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    const next=structuredClone(work);next.boundary="free";next.meshEdits=[{column:2,row:0,warped:{x:.5,y:-.25}}];
    const payload={generation:1,targetNodeId:result.id,task:deformationTask(next,"mesh"),sourceNodeIds:[sources[0]!.id],bytes:new Uint8Array([9]),renderWidth:200,renderHeight:200,
      placement:{x:0,y:0,width:100,height:100},canvasChange:{workExpected:nativeVectorOperationDigest({kind:"task",task}),from:{origin:{x:0,y:0},reference:{width:100,height:80}},to:{origin:{x:0,y:-20},reference:{width:100,height:100}}}};
    figmaMock.ui.onmessage?.({type:"apply-designer",payload});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-designer-complete"})));
    expect(result.width).toBe(100);expect(result.height).toBe(100);
    expect((result as typeof result & {relativeTransform:number[][]}).relativeTransform).toEqual([[.8,-.6,132],[.6,.8,4]]);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(2);
    figmaMock.ui.onmessage?.({type:"apply-designer",payload});
    await vi.waitFor(()=>expect(posts).toContainEqual({type:"apply-designer-error",generation:1,message:{key:"resultChanged"}}));
    expect(result.height).toBe(100);expect(JSON.parse(shared.get("binding")!).revision).toBe(2);
  });
  it.each([false, true])("keeps the saved task when switching families with duplicate=%s", async duplicate => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(1);
    const task = { kind: "mesh", spec: createMeshSpec(100, 80) };
    const original = JSON.stringify(task);
    shared.set("task", original);
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: [sources[0]!.id], revision: 3, renderWidth: 100, renderHeight: 80 }));
    plugin.set("worldbend.renderWidth", "100"); plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    const newData = new Map<string, string>();
    const newResult = { ...result, id: "new-result", fills: [],
      getSharedPluginData: vi.fn((_namespace: string, key: string) => newData.get(key) ?? ""),
      setSharedPluginData: vi.fn((_namespace: string, key: string, value: string) => newData.set(key, value)),
      getPluginData: vi.fn(() => ""), setPluginData: vi.fn() };
    figmaMock.createRectangle.mockReturnValue(newResult);
    figmaMock.getNodeByIdAsync.mockImplementation(async id => id === newResult.id ? newResult : id === result.id ? result : sources.find(source => source.id === id));
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const source = posts.findLast((post: any) => post.type === "source") as any;
    const remap = { kind: "remap", spec: { schema: "worldbend.remap", version: "0.1", output: { width: 100, height: 80 },
      operation: { kind: "lens", coefficients: { k1: .2, k2: 0, k3: 0, p1: 0, p2: 0 },
        center: { x: .5, y: .5 }, scale: { x: .5, y: .5 } } } };
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: source.generation, task: remap,
      sourceNodeIds: [sources[0]!.id], targetNodeId: result.id, ...(duplicate ? { duplicate: true } : {}),
      bytes: new Uint8Array([1, 2, 3]), renderWidth: 100, renderHeight: 80,
      placement: { x: 0, y: 0, width: 100, height: 80 } } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: duplicate ? "apply-designer-complete" : "apply-designer-error" } )));
    expect(shared.get("task")).toBe(original);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
    if (duplicate) {
      expect(JSON.parse(newData.get("task")!)).toEqual(remap);
      expect(JSON.parse(newData.get("binding")!).sourceNodeIds).toEqual([sources[0]!.id]);
      expect(figmaMock.createRectangle).toHaveBeenCalledOnce();
    } else {
      expect(figmaMock.createImage).not.toHaveBeenCalled();
      expect(figmaMock.createRectangle).not.toHaveBeenCalled();
    }
  });

  it("applies a scene draft before handing its complete native preview Frame to Canvas", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const preview = Object.assign(sourceNode("scene-preview", 400, page), { type: "FRAME", children: [result] });
    Object.assign(result, { parent: preview });
    page.selection = [result];
    Object.assign(page, { children: [...sources, preview] });
    shared.set("task", JSON.stringify(mockupTask()));
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80 }));
    plugin.set("worldbend.renderWidth", "100"); plugin.set("worldbend.renderHeight", "80");
    figmaMock.getNodeByIdAsync.mockImplementation(async id => id === preview.id ? preview : id === result.id ? result : sources.find(source => source.id === id));
    preview.exportAsync.mockImplementation(async () => {
      expect(JSON.parse(shared.get("task")!).spec.planes[0].opacity).toBe(.5);
      return new Uint8Array([8]);
    });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: 1, targetNodeId: result.id, task: mockupTask(.5),
      sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox, sceneSizes: true } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 2,
      payload: expect.objectContaining({ sourceNodeId: preview.id, bytes: new Uint8Array([8]) }) })));
    expect(posts).toContainEqual({ type: "scene-sizes-ready", generation: 1, sourceNodeId: preview.id });
    expect(page.selection).toEqual([preview]);
    expect(result.fills).toEqual([{ type: "IMAGE", imageHash: "image-hash", scaleMode: "FILL" }]);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(2);
  });

  it("refuses a scene-size handoff after its native preview container is lost", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const preview = Object.assign(sourceNode("preview", 400, page), { type: "FRAME", children: [result] });
    Object.assign(result, { parent: preview }); page.selection = [result];
    shared.set("task", JSON.stringify(mockupTask()));
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80 }));
    plugin.set("worldbend.renderWidth", "100"); plugin.set("worldbend.renderHeight", "80");
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    Object.assign(result, { parent: page });
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: 1, targetNodeId: result.id, task: mockupTask(.5),
      sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox, sceneSizes: true } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-designer-error" })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(JSON.parse(shared.get("binding")!).revision).toBe(1);
    expect(posts.some(post => (post as { type: string }).type === "scene-sizes-ready")).toBe(false);
  });

  it.each(["flipped", "rotated HD"])("re-edits a %s result without rebuilding its native frame from visual bounds", async (variant) => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const task = mockupTask();
    const hd = variant === "rotated HD";
    const transform = hd ? [[.707, -.707, 120], [.707, .707, 20]] : [[1, 0, 120], [0, -1, 100]];
    Object.assign(result, { x: 120, y: hd ? 20 : 100, relativeTransform: transform,
      absoluteBoundingBox: hd ? { x: 63.44, y: 20, width: 127.26, height: 127.26 }
        : { x: 120, y: 20, width: 100, height: 80 } });
    shared.set("task", JSON.stringify(task));
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: hd ? 200 : 100, renderHeight: hd ? 160 : 80 }));
    plugin.set("worldbend.renderWidth", hd ? "200" : "100");
    plugin.set("worldbend.renderHeight", hd ? "160" : "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: 1, targetNodeId: "result", task,
      sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9]),
      renderWidth: 100, renderHeight: 80, placement: result.absoluteBoundingBox } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-designer-complete" })));
    expect(result).toMatchObject({ x: 120, y: hd ? 20 : 100, width: 100, height: 80, relativeTransform: transform });
    expect(result.resize).not.toHaveBeenCalled();
  });

  it("rejects a legacy fill edit that lands after the designer read and before apply", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(1);
    const task = { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) };
    result.fills = [{ type: "IMAGE", imageHash: "published", scaleMode: "FILL" }];
    shared.set("task", JSON.stringify(task));
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: [sources[0]!.id], revision: 3, renderWidth: 100, renderHeight: 80 }));
    plugin.set("worldbend.renderWidth", "100"); plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ targetNodeId: result.id }),
    })));
    result.fills = [{ type: "IMAGE", imageHash: "hand-edit", scaleMode: "FILL", opacity: 0.4 }];
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: 1, targetNodeId: result.id, task,
      sourceNodeIds: [sources[0]!.id], bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox } });
    await vi.waitFor(() => expect(posts).toContainEqual({
      type: "apply-designer-error", generation: 1, message: { key: "rasterResultPaintChanged" },
    }));
    expect(result.fills).toEqual([{ type: "IMAGE", imageHash: "hand-edit", scaleMode: "FILL", opacity: 0.4 }]);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
    expect(shared.has("rasterPaint")).toBe(false);
  });

  it("records the designer paint guard and accepts the next apply of that same result", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(1);
    const task = { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) };
    result.fills = [{ type: "IMAGE", imageHash: "published", scaleMode: "FILL" }];
    shared.set("task", JSON.stringify(task));
    shared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
      sourceNodeIds: [sources[0]!.id], revision: 1, renderWidth: 100, renderHeight: 80 }));
    plugin.set("worldbend.renderWidth", "100"); plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    const apply = () => figmaMock.ui.onmessage?.({ type: "apply-designer", payload: { generation: 1, targetNodeId: result.id, task,
      sourceNodeIds: [sources[0]!.id], bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox } });
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-designer-complete" })));
    expect(JSON.parse(shared.get("rasterPaint")!).fills).toEqual(result.fills);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(2);
    apply();
    await vi.waitFor(() => expect(posts.filter(message =>
      (message as { type?: string }).type === "apply-designer-complete")).toHaveLength(2));
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-designer-error" }));
    result.fills = [{ type: "IMAGE", imageHash: "hand-edit", scaleMode: "FILL" }];
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual({
      type: "apply-designer-error", generation: 1, message: { key: "rasterResultPaintChanged" },
    }));
    expect(result.fills).toEqual([{ type: "IMAGE", imageHash: "hand-edit", scaleMode: "FILL" }]);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
  });

  it("finds a result from its source and selects that exact Figma node to continue editing", async () => {
    const { figmaMock, page, result, sources } = await sourceWithLinkedResult();
    figmaMock.ui.onmessage?.({ type: "select-linked-result", generation: 1,
      sourceNodeId: sources[0]!.id, resultNodeId: "another-result" });
    expect(page.selection).toEqual(sources);
    figmaMock.ui.onmessage?.({ type: "select-linked-result", generation: 1,
      sourceNodeId: sources[0]!.id, resultNodeId: result.id });
    await vi.waitFor(() => expect(page.selection).toEqual([result]));
    expect(figmaMock.viewport.scrollAndZoomIntoView).toHaveBeenCalledWith([result]);
  });

  it("refreshes the source when a listed result disappears before it can be selected", async () => {
    const { figmaMock, page, posts, result, sources } = await sourceWithLinkedResult();
    figmaMock.getNodeByIdAsync.mockImplementation(async (id: string) =>
      id === result.id ? undefined : sources.find((source) => source.id === id));
    figmaMock.ui.onmessage?.({ type: "select-linked-result", generation: 1,
      sourceNodeId: sources[0]!.id, resultNodeId: result.id });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "selection-loading", generation: 2, nodeIds: [sources[0]!.id],
    })));
    expect(page.selection).toEqual(sources);
    expect(figmaMock.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  });

  it("drops a linked-result choice that resolves after the designer has moved on", async () => {
    const { figmaMock, page, result, sources } = await sourceWithLinkedResult();
    let resolveResult: (node: typeof result) => void = () => undefined;
    figmaMock.getNodeByIdAsync.mockImplementation((id: string) => id === result.id
      ? new Promise<typeof result>((resolve) => { resolveResult = resolve; })
      : Promise.resolve(sources.find((source) => source.id === id)));
    figmaMock.ui.onmessage?.({ type: "select-linked-result", generation: 1,
      sourceNodeId: sources[0]!.id, resultNodeId: result.id });
    page.selection = [];
    const onSelection = figmaMock.on.mock.calls.find((call) => call[0] === "selectionchange")?.[1];
    if (typeof onSelection !== "function") throw new Error("missing selectionchange handler");
    onSelection();
    resolveResult(result);
    await Promise.resolve();
    expect(page.selection).toEqual([]);
    expect(figmaMock.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });

  it("keeps the source editable when the Figma result search is unavailable", async () => {
    const { figmaMock, page, posts } = setup(1);
    Object.assign(page, { loadAsync: vi.fn(async () => undefined),
      findAllWithCriteria: vi.fn(() => { throw new Error("host search failed"); }) });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ linkedResultsUnavailable: true }),
    })));
    expect(posts.some((post) => (post as { type?: string }).type === "selection-error")).toBe(false);
  });

  it("loads a Composition Agent draft, publishes its pixels and clears only the reviewed draft", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const published = mockupTask();
    const staged = mockupTask(.4);
    const draft = JSON.stringify({ schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 1, task: staged });
    shared.set("task", JSON.stringify(published));
    shared.set("binding", JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    }));
    shared.set("mockupDraft", draft);
    plugin.set("worldbend.renderWidth", "100");
    plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ targetNodeId: "result", mockupDraft: expect.objectContaining({ task: staged }) }),
    })));
    const apply = () => figmaMock.ui.onmessage?.({
      type: "apply-designer", payload: {
        generation: 1, targetNodeId: "result", task: staged,
        sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9, 8, 7]),
        renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 20, width: 100, height: 80 },
      },
    });
    const newer = JSON.stringify({ ...JSON.parse(draft), task: mockupTask(.7) });
    shared.set("mockupDraft", newer);
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-designer-error", generation: 1, message: { key: "resultChanged" },
    })));
    expect(shared.get("mockupDraft")).toBe(newer);
    expect(figmaMock.createImage).not.toHaveBeenCalled();

    shared.set("mockupDraft", draft);
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-designer-complete", generation: 1, targetNodeId: "result", operation: "replace",
    })));
    expect(shared.get("mockupDraft")).toBe("");
    expect(JSON.parse(shared.get("task")!)).toEqual(staged);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(2);
  });

  it("keeps the staged Composition draft when image publication fails", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const staged = mockupTask(.4);
    const draft = JSON.stringify({ schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 1, task: staged });
    shared.set("task", JSON.stringify(mockupTask()));
    shared.set("binding", JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    }));
    shared.set("mockupDraft", draft);
    plugin.set("worldbend.renderWidth", "100");
    plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    figmaMock.createImage.mockImplementationOnce(() => { throw new Error("image unavailable"); });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ mockupDraft: expect.objectContaining({ task: staged }) }),
    })));
    figmaMock.ui.onmessage?.({ type: "apply-designer", payload: {
      generation: 1, targetNodeId: "result", task: staged,
      sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9, 8, 7]),
      renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 20, width: 100, height: 80 },
    } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-designer-error", generation: 1 })));
    expect(shared.get("mockupDraft")).toBe(draft);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(1);
    expect(JSON.parse(shared.get("task")!)).toEqual(mockupTask());
  });

  it("recovers an unusable Composition draft while guarding newer changes", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(2);
    const published = mockupTask();
    shared.set("task", JSON.stringify(published));
    shared.set("binding", JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    }));
    shared.set("mockupDraft", "{broken");
    plugin.set("worldbend.renderWidth", "100");
    plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ mockupDraftUnavailable: true, task: published }),
    })));
    const apply = () => figmaMock.ui.onmessage?.({ type: "apply-designer", payload: {
      generation: 1, targetNodeId: "result", task: published,
      sourceNodeIds: sources.map(source => source.id), bytes: new Uint8Array([9, 8, 7]),
      renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 20, width: 100, height: 80 },
    } });
    shared.set("mockupDraft", "{newer");
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-designer-error", generation: 1, message: { key: "resultChanged" },
    })));
    expect(shared.get("mockupDraft")).toBe("{newer");
    shared.set("mockupDraft", "{broken");
    apply();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-designer-complete", generation: 1, targetNodeId: "result", operation: "replace",
    })));
    expect(shared.get("mockupDraft")).toBe("");
  });

  it("treats a slot-mismatched Composition draft as unavailable, matching the Agent handoff", async () => {
    const { figmaMock, page, posts, result, sources, shared } = setup(2);
    const published = mockupTask();
    const staged = mockupTask(.4);
    const unbound = { ...staged, spec: { ...staged.spec,
      planes: [{ ...staged.spec.planes[0]! }, { ...staged.spec.planes[1]!, sourceId: "source-3" }] } };
    shared.set("task", JSON.stringify(published));
    shared.set("binding", JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map(source => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    }));
    shared.set("mockupDraft", JSON.stringify({ schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 1, task: unbound }));
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => {
      const payload = posts.find(post => (post as { type?: string }).type === "source") as { payload?: { mockupDraft?: unknown; mockupDraftUnavailable?: true } } | undefined;
      expect(payload?.payload).toMatchObject({ mockupDraftUnavailable: true, task: published });
      expect(payload?.payload?.mockupDraft).toBeUndefined();
    });
  });

  it.each([0, 1] as const)("prepares, publishes and reopens native fitting with guide in slot %s", async guideIndex => {
    const {figmaMock,page,posts,result,sources,shared}=setup(2);
    const guide=sources[guideIndex]!,art=sources[1-guideIndex]!;
    Object.assign(guide,{type:"VECTOR",vectorNetwork:{vertices:[],segments:[]},vectorPaths:[{windingRule:"EVENODD",data:"M 0 0 L 100 0 L 100 32 L 40 32 L 40 80 L 0 80 Z M 10 45 L 30 45 L 30 65 L 10 65 Z"}],
      absoluteTransform:[[1,0,guide.absoluteBoundingBox.x],[0,1,20]]});
    const clip=normalizedDocumentShape(documentShapeForSource(guide)!);
    const work=deformationWorkFromMesh(createMeshSpec(100,80,4));
    work.shapeFit={contour:clip.contours[0]!,clip};
    const task=deformationTask(work,"mesh",guideIndex);
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    const first=(posts.findLast((post:any)=>post.type==="source") as any);
    figmaMock.ui.onmessage?.({type:"prepare-shape-fit",generation:first.generation,task});
    await vi.waitFor(()=>expect((posts.findLast((post:any)=>post.type==="source") as any).payload).toMatchObject({
      sourceNodeId:art.id,deformationDraft:task,sources:sources.map(node=>({sourceNodeId:node.id}))}));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    const bad=structuredClone(task);bad.spec.shapeFit!.clip!.contours.pop();
    figmaMock.ui.onmessage?.({type:"prepare-shape-fit",generation:first.generation,task:bad});
    expect(posts).toContainEqual(expect.objectContaining({type:"shape-fit-error"}));
    figmaMock.ui.onmessage?.({type:"apply-designer",payload:{generation:first.generation,task,
      sourceNodeIds:sources.map(node=>node.id),bytes:new Uint8Array([9]),renderWidth:100,renderHeight:80,
      placement:{x:0,y:20,width:100,height:80}}});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-designer-complete"})));
    expect(JSON.parse(shared.get("task")!)).toEqual(task);
    expect(JSON.parse(shared.get("binding")!).sourceNodeIds).toEqual(sources.map(node=>node.id));
    expect(result.name).toContain(art.name);
    page.selection=[result];
    const changed=figmaMock.on.mock.calls.find(([kind])=>kind==="selectionchange")?.[1];
    if(typeof changed!=="function") throw new Error("Missing selection event");
    changed();
    await vi.waitFor(()=>expect((posts.findLast((post:any)=>post.type==="source") as any)).toMatchObject({
      generation:first.generation+1,payload:{sourceNodeId:art.id,task,targetNodeId:result.id}}));
    const reopened=(posts.findLast((post:any)=>post.type==="source") as any);
    figmaMock.ui.onmessage?.({type:"prepare-shape-fit",generation:reopened.generation,task});
    expect((posts.findLast((post:any)=>post.type==="source") as any).payload.placement).toEqual(reopened.payload.placement);
    figmaMock.ui.onmessage?.({type:"prepare-shape-fit",generation:first.generation,task});
    expect(posts.findLast((post:any)=>post.type==="shape-fit-error")).toMatchObject({generation:first.generation});
  });

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

  it("publishes Spatial role order and clears the staged Agent draft only after pixels exist", async () => {
    const { figmaMock, posts, result } = setup(3);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({
      type: "apply-designer",
      payload: {
        generation: 1,
        task: spatialTask(),
        sourceNodeIds: ["source-3", "source-2", "source-1"],
        bytes: new Uint8Array([9, 8, 7]),
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 0, y: 20, width: 100, height: 80 },
      },
    });
    await vi.waitFor(() => expect(posts).toContainEqual({
      type: "apply-designer-complete", generation: 1, targetNodeId: "result", operation: "apply",
    }));
    expect(result.setSharedPluginData).toHaveBeenCalledWith("worldbend", "task", expect.stringContaining('"kind":"effect"'));
    expect(result.setSharedPluginData).toHaveBeenCalledWith("worldbend", "binding", expect.stringContaining('"sourceNodeIds":["source-3","source-2","source-1"]'));
    expect(result.setSharedPluginData).toHaveBeenCalledWith("worldbend", "effectDraft", "");
  });

  it("preserves a newer Agent draft instead of publishing from a stale Spatial workspace", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(3);
    const task = spatialTask();
    const draft = (pointerX: number) => JSON.stringify({
      schema: "worldbend.figma.effect-draft",
      version: "0.1",
      baseRevision: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
      task: { ...task, state: { ...task.state, pointerX } },
    });
    shared.set("task", JSON.stringify(task));
    const publishedBinding = JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map((source) => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    });
    shared.set("binding", publishedBinding);
    shared.set("effectDraft", draft(.1));
    plugin.set("worldbend.renderWidth", "100");
    plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ targetNodeId: "result", effectDraft: expect.objectContaining({ baseRevision: 1 }) }),
    })));

    const apply = () => figmaMock.ui.onmessage?.({
      type: "apply-designer",
      payload: {
        generation: 1,
        targetNodeId: "result",
        task,
        sourceNodeIds: sources.map((source) => source.id),
        bytes: new Uint8Array([9, 8, 7]),
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 0, y: 20, width: 100, height: 80 },
      },
    });

    shared.set("binding", JSON.stringify({ ...JSON.parse(publishedBinding), revision: 2 }));
    apply();
    await vi.waitFor(() => expect(posts.filter((message) =>
      (message as { type?: string }).type === "apply-designer-error")).toHaveLength(1));

    shared.set("binding", publishedBinding);
    const newerDraft = draft(.7);
    shared.set("effectDraft", newerDraft);
    apply();
    await vi.waitFor(() => expect(posts.filter((message) =>
      (message as { type?: string }).type === "apply-designer-error")).toHaveLength(2));
    expect(posts).toContainEqual({ type: "apply-designer-error", generation: 1, message: { key: "resultChanged" } });
    expect(shared.get("effectDraft")).toBe(newerDraft);
    expect(figmaMock.createImage).not.toHaveBeenCalled();
  });

  it("clears the exact published Agent draft and refreshes the replacement snapshot", async () => {
    const { figmaMock, page, posts, result, sources, shared, plugin } = setup(3);
    const task = spatialTask();
    const stagedDraft = JSON.stringify({
      schema: "worldbend.figma.effect-draft",
      version: "0.1",
      baseRevision: 1,
      fingerprint: `sha256:${"b".repeat(64)}`,
      task,
    });
    shared.set("task", JSON.stringify(task));
    shared.set("binding", JSON.stringify({
      schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "result",
      sourceNodeIds: sources.map((source) => source.id), revision: 1, renderWidth: 100, renderHeight: 80,
    }));
    shared.set("effectDraft", stagedDraft);
    plugin.set("worldbend.renderWidth", "100");
    plugin.set("worldbend.renderHeight", "80");
    page.selection = [result];
    Object.assign(page, { children: [...sources, result] });

    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ targetNodeId: "result" }),
    })));
    const apply = (nextTask: ReturnType<typeof spatialTask>) => figmaMock.ui.onmessage?.({
      type: "apply-designer",
      payload: {
        generation: 1, targetNodeId: "result", task: nextTask,
        sourceNodeIds: sources.map((source) => source.id), bytes: new Uint8Array([9, 8, 7]),
        renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 20, width: 100, height: 80 },
      },
    });

    apply(task);
    await vi.waitFor(() => expect(posts.some((message) =>
      ["apply-designer-complete", "apply-designer-error"].includes((message as { type?: string }).type ?? ""))).toBe(true));
    expect(posts).toContainEqual(expect.objectContaining({ type: "apply-designer-complete" }));
    expect(shared.get("effectDraft")).toBe("");
    expect(JSON.parse(shared.get("binding")!).revision).toBe(2);

    apply({ ...task, state: { ...task.state, pointerX: .35 } });
    await vi.waitFor(() => expect(posts.filter((message) =>
      (message as { type?: string }).type === "apply-designer-complete")).toHaveLength(2));
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-designer-error" }));
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
        templates: [...readySceneRecords(), expect.objectContaining({ name: "Card", template })],
      }));
    });
    const saved = posts.findLast((message) =>
      (message as { type?: string; templates?: unknown[] }).type === "template-library" &&
      (message as { templates?: unknown[] }).templates?.length === readySceneRecords().length + 1
    ) as { templates: Array<{ id: string }> };
    figmaMock.ui.onmessage?.({
      type: "delete-template",
      requestId: 12,
      id: saved.templates.at(-1)!.id,
    });
    await vi.waitFor(() => {
      expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(2);
      expect(posts.at(-1)).toEqual({
        type: "template-library",
        templates: readySceneRecords(),
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

  it("persists a complete deformation recipe without losing it", async () => {
    const {figmaMock,posts} = setup(1);
    vi.stubGlobal("figma",figmaMock);
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    const work = deformationWorkFromMesh(createMeshSpec(120,90,4));
    work.meshEdits=[{column:1,row:1,warped:{x:.2,y:.3}}];
    work.liquify={strokes:[{id:"paint",mode:"bloat",samples:[{position:{x:.5,y:.5},radius:.2,strength:.2}]}]};
    const template=deformationTemplateFromWork(work,"mesh");
    figmaMock.ui.onmessage!({type:"save-template",workspace:"mesh",requestId:71,name:"Entire work",template});
    await vi.waitFor(()=>expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(1));
    expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledWith("worldbend.spatial-templates.v1",expect.objectContaining({
      templates:[expect.objectContaining({name:"Entire work",template})],
    }));
    expect(posts).toContainEqual(expect.objectContaining({type:"template-library",mutation:{kind:"save",workspace:"mesh",requestId:71},
      templates:[...readySceneRecords(),expect.objectContaining({name:"Entire work",template})]}));
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
        templates: [...readySceneRecords(), expect.objectContaining({ name: "Social square", template })],
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
      expect(posts).toContainEqual({ type: "template-library", templates: readySceneRecords() });
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
      templates: [...readySceneRecords(), expect.objectContaining({ name: "Recovered" })],
    })));
    expect(figmaMock.clientStorage.setAsync).toHaveBeenCalledTimes(2);
  });
});
