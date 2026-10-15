import { afterEach, describe, expect, it, vi } from "vitest";
import type { LinkedBatchItem } from "./messages";

function sourceNode(id: string, x: number, page: object) {
  return {
    id,
    name: id,
    type: "RECTANGLE",
    visible: true,
    parent: page,
    x, y: 0, width: 100, height: 80,
    absoluteBoundingBox: { x, y: 0, width: 100, height: 80 },
    absoluteRenderBounds: undefined as Rect | undefined,
    exportAsync: vi.fn(async (_settings: ExportSettingsImage) => new Uint8Array([1, 2, 3])),
    getSharedPluginData: vi.fn(() => ""),
    getPluginData: vi.fn(() => ""),
  };
}

function setup(linkedKind: "deformation" | "mockup") {
  const posts: unknown[] = [];
  const shared = new Map<string, string>();
  const plugin = new Map<string, string>();
  const page = { type: "PAGE", selection: [] as unknown[], on: vi.fn(), off: vi.fn() };
  const sources = [sourceNode("source-1", 0, page)];
  page.selection = sources;
  const result = {
    id: "result",
    type: "RECTANGLE",
    name: "Poster · Worldbend",
    x: 120, y: 0, width: 100, height: 80,
    fills: [] as unknown[],
    parent: page,
    visible: true,
    absoluteBoundingBox: { x: 120, y: 0, width: 100, height: 80 },
    resize: vi.fn(function (this: { width: number; height: number }, width: number, height: number) { this.width = width; this.height = height; }),
    setSharedPluginData: vi.fn((_ns: string, key: string, value: string) => shared.set(key, value)),
    setPluginData: vi.fn((key: string, value: string) => plugin.set(key, value)),
    getSharedPluginData: vi.fn((_ns: string, key: string) => shared.get(key) ?? ""),
    getPluginData: vi.fn((key: string) => plugin.get(key) ?? ""),
    remove: vi.fn(),
  };
  const plane = {
    schema: "worldbend.transform", version: "0.1",
    destination: { space: "normalized" as const, quad: {
      tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
    } },
    content: { fit: "stretch" as const },
  };
  const deformationTask = {
    kind: "deformation" as const, view: "mesh" as const,
    spec: {
      schema: "worldbend.deformation-work", version: "0.1",
      transform: plane,
      targetSize: { width: 100, height: 80 },
      meshSubdivisions: 4,
      meshEdits: [{ column: 1, row: 1, warped: { x: 0.3, y: 0.3 } }],
    },
  };
  const mockupTask = {
    kind: "mockup" as const,
    spec: {
      schema: "worldbend.mockup", version: "0.1",
      canvas: { width: 100, height: 80 }, background: { kind: "transparent" as const }, seams: [],
      planes: [{ id: "artwork", sourceId: "source-1", opacity: 1, transform: plane }],
    },
  };
  shared.set("task", JSON.stringify(linkedKind === "deformation" ? deformationTask : mockupTask));
  shared.set("binding", JSON.stringify({
    schema: "worldbend.figma.binding", version: "0.1", resultNodeId: result.id,
    sourceNodeIds: [sources[0]!.id], revision: 2, renderWidth: 100, renderHeight: 80,
  }));
  plugin.set("worldbend.renderWidth", "100");
  plugin.set("worldbend.renderHeight", "80");
  const indexedPage = Object.assign(page, {
    children: [...sources, result],
    loadAsync: vi.fn(async () => undefined),
    findAllWithCriteria: vi.fn(() => [result]),
  });
  const figmaMock = {
    mixed: Symbol("mixed"),
    currentPage: page,
    root: { children: [page] },
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn(async () => undefined) },
    showUI: vi.fn(), on: vi.fn(), commitUndo: vi.fn(), notify: vi.fn(),
    viewport: { scrollAndZoomIntoView: vi.fn() },
    ui: { on: vi.fn(), onmessage: undefined as ((message: unknown) => void) | undefined, postMessage: vi.fn((message: unknown) => posts.push(message)) },
    getNodeByIdAsync: vi.fn(async (id: string): Promise<unknown> => id === result.id ? result : sources.find((source) => source.id === id)),
    createImage: vi.fn(() => ({ hash: "image-hash" })),
    createRectangle: vi.fn(() => result),
    triggerUndo: vi.fn(),
  };
  vi.stubGlobal("figma", figmaMock);
  vi.stubGlobal("__html__", "");
  return { figmaMock, page: indexedPage, posts, result, sources, shared, plugin, deformationTask };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

async function startWithLinked(kind: "deformation" | "mockup") {
  const ready = setup(kind);
  const { figmaMock, posts } = ready;
  await import("./main");
  figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
  await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
    type: "source", payload: expect.objectContaining({ linkedResults: expect.objectContaining({ total: 1 }) }),
  })));
  figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
  await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "linked-batch" })));
  return ready;
}

describe("linked batch main boundary", () => {
  it.each([0,1] as const)("exports the current native guide and saves its refreshed task in binding order %s",async guideIndex=>{
    const h=setup("deformation"),art=h.sources[0]!;
    const guide=Object.assign(sourceNode("guide",300,h.page),{type:"VECTOR",effects:[],fills:[],strokes:[],opacity:1,isMask:false,absoluteTransform:[[1,0,300],[0,1,0]],vectorNetwork:{vertices:[],segments:[],regions:[]},vectorPaths:[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 80 80 L 0 80 Z"}]});
    h.sources.push(guide);h.page.children=[...h.sources,h.result];h.page.selection=[guide];
    const ids=guideIndex===0 ? [guide.id,art.id] : [art.id,guide.id];
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    const task={...h.deformationTask,shapeGuideSourceIndex:guideIndex,shapeGuideDomain:{kind:"nativeContour" as const,contourIndex:0},spec:{...h.deformationTask.spec,shapeFit:{contour,clip:{contours:[contour],fillRule:"nonZero" as const}}}};
    h.shared.set("task",JSON.stringify(task));const binding=JSON.parse(h.shared.get("binding")!);binding.sourceNodeIds=ids;h.shared.set("binding",JSON.stringify(binding));
    await import("./main");h.figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({linkedResults:expect.objectContaining({total:1})})})));
    h.figmaMock.ui.onmessage?.({type:"prepare-linked-batch",generation:1});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"linked-batch",items:[expect.objectContaining({sourceNodeIds:ids,kind:"deformation"})]})));
    h.figmaMock.ui.onmessage?.({type:"export-batch-source",generation:1,resultNodeId:h.result.id,nodeId:guide.id,desiredWidth:100,desiredHeight:80});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"batch-source",nodeId:guide.id,shapeGuide:expect.objectContaining({contours:[expect.objectContaining({segments:expect.arrayContaining([{kind:"line",to:{x:380,y:80}}])})]})})));
    const refreshed=structuredClone(task);refreshed.spec.shapeFit.contour.segments[1]!.to.x=.8;refreshed.spec.shapeFit.clip.contours[0]=refreshed.spec.shapeFit.contour;
    const undoRevisions: number[] = [];
    h.figmaMock.commitUndo.mockImplementation(() => { undoRevisions.push(JSON.parse(h.shared.get("binding")!).revision); });
    h.figmaMock.ui.onmessage?.({type:"apply-linked-batch-item",payload:{generation:1,nodeId:h.result.id,bytes:new Uint8Array([9]),renderWidth:100,renderHeight:80,placement:h.result.absoluteBoundingBox,sourceNodeIds:ids,storedOperation:{kind:"task",task:refreshed}}});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"apply-complete",targetNodeId:h.result.id})));
    expect(JSON.parse(h.shared.get("task")!)).toEqual(refreshed);expect(JSON.parse(h.shared.get("binding")!)).toMatchObject({revision:3,sourceNodeIds:ids});expect(undoRevisions).toEqual([2]);
  });

  it("exports linked refresh at the requested source detail without dropping below the stored frame", async () => {
    const h = await startWithLinked("deformation");
    const source = h.sources[0]!;
    source.absoluteRenderBounds = { x: -10, y: -8, width: 120, height: 96 };
    h.figmaMock.ui.onmessage?.({ type: "export-batch-source", generation: 1,
      resultNodeId: h.result.id, nodeId: source.id, desiredWidth: 400, desiredHeight: 320 });
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "batch-source", nodeId: source.id })));
    const detailed = source.exportAsync.mock.calls.at(-1)?.[0];
    expect(detailed).not.toHaveProperty("useAbsoluteBounds");
    expect(detailed?.constraint?.value).toBeCloseTo(Math.max(400 / 120, 320 / 96), 10);

    source.exportAsync.mockClear();
    h.figmaMock.ui.onmessage?.({ type: "export-batch-source", generation: 1,
      resultNodeId: h.result.id, nodeId: source.id, desiredWidth: 40, desiredHeight: 32 });
    await vi.waitFor(() => expect(source.exportAsync).toHaveBeenCalled());
    expect(source.exportAsync.mock.calls.at(-1)?.[0]?.constraint?.value).toBeCloseTo(Math.max(100 / 120, 80 / 96), 10);
  });

  it("retains damaged prerequisites, blocks their consumers and allows an independent result", async () => {
    const { figmaMock, page, posts, result, sources, shared, deformationTask } = setup("deformation");
    const makeResult = (id: string, source: string) => {
      const values = new Map(shared);
      values.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: id,
        sourceNodeIds: [source], revision: 1, renderWidth: 100, renderHeight: 80 }));
      return { ...result, id, name: id, fills: [], getSharedPluginData: vi.fn((_ns: string, key: string) => values.get(key) ?? ""),
        setSharedPluginData: vi.fn((_ns: string, key: string, value: string) => values.set(key, value)) };
    };
    const whole = makeResult("whole", result.id); const independent = makeResult("independent", sources[0]!.id);
    shared.set("task", "{broken");
    page.findAllWithCriteria.mockReturnValue([whole, result, independent]);
    const nodes = [whole, result, independent, ...sources];
    figmaMock.getNodeByIdAsync.mockImplementation(async id => nodes.find(node => node.id === id));
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source",
      payload: expect.objectContaining({ linkedResults: expect.objectContaining({ total: 3 }) }) })));
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "linked-batch" })));
    const batch = posts.find(message => (message as { type: string }).type === "linked-batch") as { items: LinkedBatchItem[] };
    expect(batch.items.find(item => item.nodeId === result.id)).toMatchObject({ kind: "invalid", updatable: false });
    expect(batch.items.find(item => item.nodeId === whole.id)?.dependencyNodeIds).toEqual([result.id]);
    figmaMock.ui.onmessage?.({ type: "export-batch-source", generation: 1, resultNodeId: whole.id,
      nodeId: result.id, desiredWidth: 100, desiredHeight: 80 });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "batch-source-error", resultNodeId: whole.id })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: { generation: 1, nodeId: independent.id,
      bytes: new Uint8Array([3]), renderWidth: 100, renderHeight: 80, placement: independent.absoluteBoundingBox,
      storedOperation: { kind: "task", task: deformationTask }, sourceNodeIds: [sources[0]!.id] } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-complete", targetNodeId: independent.id })));
    expect(JSON.parse(independent.getSharedPluginData("worldbend", "binding"))).toMatchObject({ revision: 2 });
    expect(shared.get("task")).toBe("{broken"); expect(result.fills).toEqual([]); expect(whole.fills).toEqual([]);
  });

  it.each(["transform", "canvas"] as const)("updates the local result before exporting and publishing the containing %s whole", async (family) => {
    const { figmaMock, page, posts, result, sources, deformationTask } = setup("deformation");
    const container = Object.assign(sourceNode("assembly", 300, page), { type: "FRAME", children: [result] });
    Object.assign(result, { parent: container });
    const wholeShared = new Map<string, string>();
    const whole = { ...result, id: "whole", name: "Whole", parent: page,
      getSharedPluginData: vi.fn((_ns: string, key: string) => wholeShared.get(key) ?? ""),
      setSharedPluginData: vi.fn((_ns: string, key: string, value: string) => wholeShared.set(key, value)),
    };
    const canvasSpec = { schema: "worldbend.canvas" as const, version: "0.1" as const,
      operation: { kind: "contain" as const, output: { width: 100, height: 80 },
        anchor: { x: .5 as const, y: .5 as const }, background: { kind: "transparent" as const } } };
    wholeShared.set(family, JSON.stringify(family === "transform" ? deformationTask.spec.transform : canvasSpec));
    const wholeOperation = family === "transform" ? { kind: "transform" as const, spec: deformationTask.spec.transform }
      : { kind: "canvas" as const, spec: canvasSpec };
    wholeShared.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1",
      resultNodeId: whole.id, sourceNodeIds: [container.id], revision: 1, renderWidth: 100, renderHeight: 80 }));
    page.findAllWithCriteria.mockReturnValue([whole, result]); // Deliberately whole-first in the document.
    const nodes = [whole, result, container, ...sources];
    figmaMock.getNodeByIdAsync.mockImplementation(async id => nodes.find(node => node.id === id));
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "source", payload: expect.objectContaining({ linkedResults: expect.objectContaining({ total: 2 }) }),
    })));
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "linked-batch" })));
    const batch = posts.find(message => (message as { type: string }).type === "linked-batch") as { items: LinkedBatchItem[] };
    expect(batch.items.map(item => [item.nodeId, item.sourceNodeIds, item.dependencyNodeIds])).toEqual([
      ["result", ["source-1"], []], ["whole", ["assembly"], ["result"]],
    ]);
    const applyWhole = () => figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: {
      generation: 1, nodeId: whole.id, bytes: new Uint8Array([4]), renderWidth: 100, renderHeight: 80,
      placement: whole.absoluteBoundingBox, storedOperation: wholeOperation,
      sourceNodeIds: [container.id],
    } });
    // A forged/out-of-order UI publication cannot bypass the main prerequisite guard.
    applyWhole();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "resultChanged" } })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: {
      generation: 1, nodeId: result.id, bytes: new Uint8Array([3]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox, storedOperation: { kind: "task", task: deformationTask }, sourceNodeIds: ["source-1"],
    } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-complete", targetNodeId: "result" })));
    expect(posts.filter(message => (message as { type: string }).type === "apply-complete")).toHaveLength(1);
    figmaMock.ui.onmessage?.({ type: "export-batch-source", generation: 1, resultNodeId: whole.id,
      nodeId: container.id, desiredWidth: 100, desiredHeight: 80 });
    await vi.waitFor(() => expect(container.exportAsync).toHaveBeenCalled());
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "batch-source", nodeId: "assembly" })));
    applyWhole();
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-complete", targetNodeId: "whole" })));
    expect(JSON.parse(wholeShared.get("binding")!)).toMatchObject({ sourceNodeIds: ["assembly"], revision: 2 });
    expect(figmaMock.viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  });

  it.each([33, 65])("checks all %i affected results before publication rather than truncating to menu rows", async (count) => {
    const { figmaMock, page, posts, result, sources, shared } = setup("deformation");
    const results = Array.from({ length: count }, (_, index) => {
      const id = `result-${index}`;
      const values = new Map(shared);
      values.set("binding", JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: id,
        sourceNodeIds: [sources[0]!.id], revision: 1, renderWidth: 100, renderHeight: 80 }));
      return { ...result, id, getSharedPluginData: vi.fn((_ns: string, key: string) => values.get(key) ?? "") };
    });
    page.findAllWithCriteria.mockReturnValue(results);
    figmaMock.getNodeByIdAsync.mockImplementation(async id => [...results, ...sources].find(node => node.id === id));
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    if (count === 33) {
      await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "linked-batch" })));
      expect((posts.find(message => (message as { type: string }).type === "linked-batch") as { items: unknown[] }).items).toHaveLength(33);
    } else {
      await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
        type: "linked-batch-error", message: { key: "batchTooManyResults" },
      })));
      expect(posts.some(message => (message as { type: string }).type === "linked-batch")).toBe(false);
    }
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(figmaMock.commitUndo).not.toHaveBeenCalled();
  });

  it("rejects a saved result placed inside its own original before any publication", async () => {
    const { figmaMock, posts, result, sources } = setup("deformation");
    Object.assign(sources[0]!, { type: "FRAME", children: [result] });
    Object.assign(result, { parent: sources[0] });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "linked-batch-error", message: { key: "batchDependencyCycle" },
    })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(figmaMock.commitUndo).not.toHaveBeenCalled();
  });

  it.each(["task", "binding", "draft", "fills", "placement", "parent"])("protects a newer same-family %s edit after batch discovery", async (field) => {
    const { figmaMock, posts, shared, result, deformationTask } = await startWithLinked("deformation");
    if (field === "task") shared.set("task", JSON.stringify({ ...deformationTask, view: "pin" }));
    if (field === "binding") shared.set("binding", JSON.stringify({ ...JSON.parse(shared.get("binding")!), revision: 3 }));
    if (field === "draft") shared.set("mockupDraft", "newer scene draft");
    if (field === "fills") result.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    if (field === "placement") result.x += 30;
    if (field === "parent") Object.assign(result, { parent: { id: "new-container", type: "FRAME", parent: result.parent } });
    const before = { task: shared.get("task"), binding: shared.get("binding"), fills: result.fills, x: result.x };
    figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: {
      generation: 1, nodeId: "result", bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: { x: 120, y: 0, width: 100, height: 80 }, storedOperation: { kind: "task", task: deformationTask },
    } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "resultChanged" } })));
    expect({ task: shared.get("task"), binding: shared.get("binding"), fills: result.fills, x: result.x }).toEqual(before);
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(figmaMock.commitUndo).not.toHaveBeenCalled();
  });

  it("updates stored HD pixels independently of the result's canvas size", async () => {
    const { figmaMock, posts, plugin, shared, deformationTask } = await startWithLinked("deformation");
    plugin.set("worldbend.renderWidth", "200"); plugin.set("worldbend.renderHeight", "160");
    shared.set("binding", JSON.stringify({ ...JSON.parse(shared.get("binding")!), renderWidth: 200, renderHeight: 160 }));
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts.filter(m => (m as { type?: string }).type === "linked-batch")).toHaveLength(2));
    figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: {
      generation: 1, nodeId: "result", bytes: new Uint8Array([9]), renderWidth: 200, renderHeight: 160,
      placement: { x: 120, y: 0, width: 100, height: 80 }, storedOperation: { kind: "task", task: deformationTask },
    } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-complete" })));
    expect(figmaMock.commitUndo).toHaveBeenCalled();
  });

  it("keeps a rotated result's native frame instead of resizing it to its axis-aligned bounds", async () => {
    const { figmaMock, posts, result, deformationTask } = await startWithLinked("deformation");
    const transform = [[.707, -.707, 120], [.707, .707, 0]];
    Object.assign(result, { relativeTransform: transform,
      absoluteBoundingBox: { x: 63.44, y: 0, width: 127.26, height: 127.26 } });
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts.filter(m => (m as { type?: string }).type === "linked-batch")).toHaveLength(2));
    figmaMock.ui.onmessage?.({ type: "apply-linked-batch-item", payload: {
      generation: 1, nodeId: "result", bytes: new Uint8Array([9]), renderWidth: 100, renderHeight: 80,
      placement: result.absoluteBoundingBox, storedOperation: { kind: "task", task: deformationTask },
    } });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-complete" })));
    expect(result).toMatchObject({ x: 120, y: 0, width: 100, height: 80, relativeTransform: transform });
    expect(result.resize).not.toHaveBeenCalled();
  });
  it("correlates the source's linked results with their stored operations", async () => {
    const { figmaMock, posts, deformationTask } = await startWithLinked("deformation");
    figmaMock.ui.onmessage?.({ type: "prepare-linked-batch", generation: 1 });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "linked-batch" })));
    const batch = posts.find((message) => (message as { type?: string }).type === "linked-batch") as {
      items: LinkedBatchItem[];
    };
    expect(batch.items).toHaveLength(1);
    expect(batch.items[0]).toMatchObject({
      nodeId: "result", revision: 2, kind: "deformation", width: 100, height: 80, operationKind: "task",
    });
    expect(JSON.parse(batch.items[0]!.operationJson)).toEqual(deformationTask);
  });

  it("publishes one recomputed item in place and keeps its undo boundary", async () => {
    const { figmaMock, posts, shared, deformationTask } = await startWithLinked("deformation");
    figmaMock.ui.onmessage?.({
      type: "apply-linked-batch-item",
      payload: {
        generation: 1, nodeId: "result",
        bytes: new Uint8Array([9, 9, 9]),
        renderWidth: 100, renderHeight: 80,
        placement: { x: 120, y: 0, width: 100, height: 80 },
        storedOperation: { kind: "task", task: deformationTask },
      },
    });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-complete", targetNodeId: "result", operation: "replace",
    })));
    expect(figmaMock.commitUndo).toHaveBeenCalled();
    expect(JSON.parse(shared.get("task")!)).toEqual(deformationTask);
    expect(JSON.parse(shared.get("binding")!).revision).toBe(3);
  });

  it("refuses to overwrite a result whose stored family changed underneath", async () => {
    const { figmaMock, posts, shared, deformationTask } = await startWithLinked("mockup");
    const before = shared.get("task");
    figmaMock.ui.onmessage?.({
      type: "apply-linked-batch-item",
      payload: {
        generation: 1, nodeId: "result",
        bytes: new Uint8Array([9, 9, 9]),
        renderWidth: 100, renderHeight: 80,
        placement: { x: 120, y: 0, width: 100, height: 80 },
        storedOperation: { kind: "task", task: deformationTask },
      },
    });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-error", message: expect.objectContaining({ key: "resultChanged" }),
    })));
    expect(shared.get("task")).toBe(before);
    expect(figmaMock.commitUndo).not.toHaveBeenCalled();
  });

  it("rejects an item from a stale selection generation", async () => {
    const { figmaMock, posts, deformationTask } = await startWithLinked("deformation");
    figmaMock.ui.onmessage?.({
      type: "apply-linked-batch-item",
      payload: {
        generation: 7, nodeId: "result",
        bytes: new Uint8Array([9, 9, 9]),
        renderWidth: 100, renderHeight: 80,
        placement: { x: 120, y: 0, width: 100, height: 80 },
        storedOperation: { kind: "task", task: deformationTask },
      },
    });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-error", message: expect.objectContaining({ key: "selectionChanged" }),
    })));
  });
});
