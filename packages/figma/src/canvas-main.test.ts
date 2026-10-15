import { afterEach, describe, expect, it, vi } from "vitest";
import type { UiToMainMessage } from "./messages";

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
    const shared = new Map([["canvas", storedCanvas]]);
    const privateData = new Map([["worldbend.renderWidth", "1080"], ["worldbend.renderHeight", "1080"]]);
    target.getSharedPluginData.mockImplementation((_namespace: string, key: string) =>
      shared.get(key) ?? "",
    );
    target.getPluginData.mockImplementation((key: string) =>
      privateData.get(key) ?? "",
    );
    target.setPluginData.mockImplementation((key: string, value: string) => { privateData.set(key, value); });
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
      shared.set(key, value);
    });
  }
  page.selection = target ? [source, target] : [source];
  Object.assign(page, { children: target ? [source, target] : [source] });
  const figmaMock = {
    currentPage: page,
    root: { children: [page] },
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
      on: vi.fn(),
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

function trimReplacementMessage(alphaThreshold = 16, width = 710, height = 416):
  Extract<UiToMainMessage, { type: "apply-canvas" }> {
  const message = singleReplacementMessage();
  return { ...message, payload: { ...message.payload,
    setSpec: { ...message.payload.setSpec, variants: [{ id: "trimmed",
      operation: { kind: "trim", alphaThreshold } }] },
    outputs: [{ ...message.payload.outputs[0]!, id: "trimmed",
      renderWidth: width, renderHeight: height,
      placement: { x: 10, y: 20, width, height } }],
  } };
}

function setupTrim() {
  const state = setup([], {});
  const target = state.target!;
  Object.assign(state.source, { width: 850, height: 500,
    absoluteBoundingBox: { x: 0, y: 0, width: 850, height: 500 } });
  Object.assign(target, { width: 712, height: 418,
    absoluteBoundingBox: { x: 10, y: 20, width: 712, height: 418 } });
  target.setSharedPluginData("worldbend", "canvas", JSON.stringify({
    schema: "worldbend.canvas", version: "0.1", operation: { kind: "trim", alphaThreshold: 0 },
  }));
  target.setSharedPluginData("worldbend", "canvasOutputId", "trimmed");
  target.setSharedPluginData("worldbend", "binding", JSON.stringify({
    schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "target",
    sourceNodeIds: ["source"], revision: 1, renderWidth: 712, renderHeight: 418,
  }));
  target.setPluginData("worldbend.renderWidth", "712");
  target.setPluginData("worldbend.renderHeight", "418");
  return { ...state, target };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Figma Canvas document transaction", () => {
  it("adopts a named single work without replacing its existing native title",async()=>{
    const {figmaMock,posts,target}=setup([],{});await import("./main");
    const title=target!.name;
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({canvasOutputName:title})})));
    const original=singleReplacementMessage();
    const message={...original,payload:{...original.payload,
      outputs:original.payload.outputs.map(output=>({...output,name:title}))}};
    figmaMock.ui.onmessage?.(message);
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-canvas-complete"})));
    expect(target!.name).toBe(title);
    expect(target!.getSharedPluginData("worldbend","canvasOutputName")).toBe(title);
  });
  it("publishes human labels without changing identity and continues renaming the same result",async()=>{
    const {figmaMock,posts,target}=setupTrim();
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    for(const [index,name] of ["书封 · 横版 / 2026 🎨","书封 · 第二版"].entries()) {
      const message=trimReplacementMessage();message.payload.outputs[0]!.name=name;
      figmaMock.ui.onmessage?.(message);
      await vi.waitFor(()=>expect(posts.filter((m:any)=>m.type==="apply-canvas-complete")).toHaveLength(index+1));
      expect(target.name).toBe(`Hero · ${name} · Worldbend`);
      expect(target.getSharedPluginData("worldbend","canvasOutputName")).toBe(name);
      expect(target.getSharedPluginData("worldbend","canvasOutputId")).toBe("trimmed");
    }
    expect(figmaMock.createRectangle).not.toHaveBeenCalled();
  });

  it("reads a persisted human label on cold startup independently of renderer identity",async()=>{
    const {figmaMock,posts,target}=setupTrim();
    target.setSharedPluginData("worldbend","canvasOutputName","书封 · 第二版");
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00002"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({canvasOutputId:"trimmed",canvasOutputName:"书封 · 第二版"})})));
  });

  it.each(["书封 · 外部更名","bad\nname"])("rejects a changed raw name after capture (%s)",async name=>{
    const {figmaMock,posts,target}=setupTrim();await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    target.setSharedPluginData("worldbend","canvasOutputName",name);
    const message=trimReplacementMessage();message.payload.outputs[0]!.name="书封 · 我的更名";
    figmaMock.ui.onmessage?.(message);
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-canvas-error",message:{key:"resultChanged"}})));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(target.getSharedPluginData("worldbend","canvasOutputName")).toBe(name);
  });

  it("rolls back label, native name and pixels when label storage fails",async()=>{
    const {figmaMock,posts,target}=setupTrim();
    target.setSharedPluginData("worldbend","canvasOutputName","原来的书封");
    const before={name:target.name,fills:target.fills,canvas:target.getSharedPluginData("worldbend","canvas"),binding:target.getSharedPluginData("worldbend","binding")};
    const write=target.setSharedPluginData.getMockImplementation()!;let failed=false;
    target.setSharedPluginData.mockImplementation((ns,key,value)=>{
      if(key==="canvasOutputName" && value==="新的书封" && !failed){failed=true;throw Error("name storage failed");}
      write(ns,key,value);
    });
    await import("./main");figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source"})));
    const message=trimReplacementMessage();message.payload.outputs[0]!.name="新的书封";
    figmaMock.ui.onmessage?.(message);
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-canvas-error"})));
    expect(target.getSharedPluginData("worldbend","canvasOutputName")).toBe("原来的书封");
    expect({name:target.name,fills:target.fills,canvas:target.getSharedPluginData("worldbend","canvas"),binding:target.getSharedPluginData("worldbend","binding")}).toEqual(before);
    expect(target).toMatchObject({width:712,height:418,x:10,y:20});
  });

  it("replaces a reopened Trim at its new alpha bounds and continues editing", async () => {
    const { figmaMock, posts, target } = setupTrim();
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(trimReplacementMessage());
    await vi.waitFor(() => expect(posts.filter((m: any) => m.type === "apply-canvas-complete")).toHaveLength(1));
    expect(target).toMatchObject({ x: 10, y: 20, width: 710, height: 416 });
    expect(JSON.parse(target.getSharedPluginData("worldbend", "binding"))).toMatchObject({
      revision: 2, renderWidth: 710, renderHeight: 416,
    });
    figmaMock.ui.onmessage?.(trimReplacementMessage(64, 708, 414));
    await vi.waitFor(() => expect(posts.filter((m: any) => m.type === "apply-canvas-complete")).toHaveLength(2));
    expect(target).toMatchObject({ x: 10, y: 20, width: 708, height: 414 });
    expect(JSON.parse(target.getSharedPluginData("worldbend", "canvas")).operation).toEqual({ kind: "trim", alphaThreshold: 64 });
    expect(figmaMock.createRectangle).not.toHaveBeenCalled();
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-canvas-error" }));
  });

  it.each(["resize", "binding"])("protects a reopened Trim after its %s changes", async (changed) => {
    const { figmaMock, posts, target } = setupTrim();
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    if (changed === "resize") target.width += 1;
    else target.setSharedPluginData("worldbend", "binding", JSON.stringify({
      ...JSON.parse(target.getSharedPluginData("worldbend", "binding")), revision: 2,
    }));
    figmaMock.ui.onmessage?.(trimReplacementMessage());
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({
      type: "apply-canvas-error", message: { key: "resultChanged" },
    })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(target.fills).toEqual([{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }]);
  });

  it("continues a designer-resized Trim without treating its density as a stale result", async () => {
    const {figmaMock,posts,target}=setupTrim();
    Object.assign(target,{width:356,height:209,absoluteBoundingBox:{x:10,y:20,width:356,height:209}});
    await import("./main");
    figmaMock.ui.onmessage?.({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"test-session-00001"});
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source",
      payload:expect.objectContaining({targetRasterSize:{width:712,height:418}})})));
    const message=trimReplacementMessage();message.payload.outputs[0]!.placement={x:10,y:20,width:355,height:208};
    figmaMock.ui.onmessage?.(message);
    await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"apply-canvas-complete"})));
    expect(target).toMatchObject({x:10,y:20,width:355,height:208});
    expect(JSON.parse(target.getSharedPluginData("worldbend","binding"))).toMatchObject({renderWidth:710,renderHeight:416});
  });

  it("publishes an ordered set inside one undo boundary and keeps source selection", async () => {
    const wide = resultNode("wide-result");
    const square = resultNode("square-result");
    const { figmaMock, posts, source } = setup([wide, square]);
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
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
    expect(wide.setSharedPluginData).toHaveBeenCalledWith("worldbend", "canvasOutputId", "wide");
    expect(square.setSharedPluginData).toHaveBeenCalledWith("worldbend", "canvasOutputId", "square");
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
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
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
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
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
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
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

  it("continues replacing the current published operation without reopening", async () => {
    const { figmaMock, posts, target } = setup([], {});
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    figmaMock.ui.onmessage?.(singleReplacementMessage());
    await vi.waitFor(() => expect(posts.filter((m: any) => m.type === "apply-canvas-complete")).toHaveLength(1));
    const next = singleReplacementMessage();
    next.payload.setSpec.variants[0]!.operation.output.width = 900;
    next.payload.outputs[0]!.renderWidth = 900;
    next.payload.outputs[0]!.placement.width = 900;
    figmaMock.ui.onmessage?.(next);
    await vi.waitFor(() => expect(posts.filter((m: any) => m.type === "apply-canvas-complete")).toHaveLength(2));
    expect(target).toMatchObject({ width: 900, height: 628 });
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-canvas-error" }));
  });

  it.each(["canvas", "canvasOutputId", "binding"])("refuses a stale edit after %s changed without a refresh", async (key) => {
    const { figmaMock, posts, target } = setup([], {});
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source" })));
    if (!target) throw new Error("missing target");
    const value = key === "canvas" ? JSON.stringify({ ...JSON.parse(target.getSharedPluginData("worldbend", key)),
      operation: { kind: "stretch", output: { width: 1080, height: 1080 } } }) : key === "canvasOutputId" ? "newer-size"
      : JSON.stringify({ schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "target",
        sourceNodeIds: ["source"], revision: 2, renderWidth: 1080, renderHeight: 1080 });
    target.setSharedPluginData("worldbend", key, value);
    figmaMock.ui.onmessage?.(singleReplacementMessage());
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-canvas-error",
      message: { key: "resultChanged" } })));
    expect(figmaMock.createImage).not.toHaveBeenCalled();
    expect(target.getSharedPluginData("worldbend", key)).toBe(value);
  });

  it("restores pixels, geometry and the prior name if naming a replacement fails", async () => {
    const { figmaMock, posts, target } = setup([], {});
    if (!target) throw new Error("missing target");
    const read = target.getSharedPluginData.getMockImplementation()!;
    target.getSharedPluginData.mockImplementation((ns, key) => key === "canvasOutputId" ? "scene-square" : read(ns, key));
    let fail = true;
    target.setSharedPluginData.mockImplementation((_ns, key) => {
      if (key === "canvasOutputId" && fail) { fail = false; throw new Error("metadata write failed"); }
    });
    await import("./main");
    figmaMock.ui.onmessage?.({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source",
      payload: expect.objectContaining({ canvasOutputId: "scene-square" }) })));
    figmaMock.ui.onmessage?.(singleReplacementMessage());
    await vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "apply-canvas-error" })));
    expect(target).toMatchObject({ x: 10, y: 20, width: 1080, height: 1080 });
    expect(target.fills).toEqual([{ type: "IMAGE", imageHash: "old", scaleMode: "FILL" }]);
    expect(target.setSharedPluginData).toHaveBeenCalledWith("worldbend", "canvasOutputId", "scene-square");
    expect(posts).not.toContainEqual(expect.objectContaining({ type: "apply-canvas-complete" }));
  });
});

function pageSelection(page: { selection: unknown[] }): unknown[] {
  return page.selection;
}
