import { afterEach, describe, expect, it, vi } from "vitest";
import * as nativeComponents from "./native-component";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import { writeStoredOperation } from "./stored-operation";
import { SHARED_RASTER_PAINT_KEY, writeRasterPaintProof } from "./raster-paint-guard";
import type { TransformSpec } from "@worldbend/web/types";

const spec: TransformSpec = { schema: "worldbend.transform", version: "0.1",
  destination: { space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } }, content: { fit: "stretch" } };

function host() {
  const posts: any[] = [], registry = new Map<string, any>();
  const page: any = { id: "page", type: "PAGE", children: [], selection: [], on: vi.fn(), off: vi.fn() };
  const rectangle = (id: string) => {
    const shared = new Map<string, string>(), privateData = new Map<string, string>();
    const node: any = { id, type: "RECTANGLE", name: id, parent: page, visible: true,
      removed: false, x: 0, y: 0, width: 100, height: 80, fills: [], strokes: [], effects: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
      getSharedPluginData: (_ns: string, key: string) => shared.get(key) ?? "",
      setSharedPluginData: vi.fn((_ns: string, key: string, value: string) => shared.set(key, value)),
      getPluginData: (key: string) => privateData.get(key) ?? "",
      setPluginData: vi.fn((key: string, value: string) => privateData.set(key, value)),
      exportAsync: vi.fn(async () => new Uint8Array([1, 2, 3])),
      resize: vi.fn((width: number, height: number) => { node.width = width; node.height = height; }),
      remove: vi.fn(() => { node.removed = true; }), shared };
    registry.set(id, node); page.children.push(node); return node;
  };
  const source = rectangle("source"), result = rectangle("result");
  result.fills = [{ type: "IMAGE", imageHash: "published", scaleMode: "FILL", opacity: 1 }];
  writeStoredBinding(result, { sourceNodeIds: [source.id], renderWidth: 100, renderHeight: 80 });
  writeStoredOperation(result, { kind: "transform", spec });
  page.selection = [result];
  const api: any = { currentPage: page, root: { children: [page] }, mixed: Symbol("mixed"),
    clientStorage: { getAsync: vi.fn(async () => undefined), setAsync: vi.fn() }, showUI: vi.fn(), on: vi.fn(),
    getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
    createImage: vi.fn(() => ({ hash: "updated" })), createRectangle: vi.fn(() => rectangle("copy")),
    commitUndo: vi.fn(), viewport: { scrollAndZoomIntoView: vi.fn() }, notify: vi.fn(),
    ui: { on: vi.fn(), onmessage: undefined as any, postMessage: (message: any) => posts.push(message) } };
  vi.stubGlobal("figma", api); vi.stubGlobal("__html__", "");
  const start = async () => {
    await import("./main");
    api.ui.onmessage({ type: "ready", systemLocales: ["en-US"], sceneDraftSessionId: "test-session-00001" });
  };
  const apply = (extra = {}) => api.ui.onmessage({ type: "apply", payload: { generation: 1,
    bytes: new Uint8Array([1]), spec, sourceNodeId: source.id, targetNodeId: result.id,
    renderWidth: 100, renderHeight: 80, placement: { x: 0, y: 0, width: 100, height: 80 }, ...extra } });
  const ready = async () => vi.waitFor(() => expect(posts).toContainEqual(expect.objectContaining({ type: "source", generation: 1 })));
  return { api, source, result, posts, start, apply, ready };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

describe("linked raster publication protects native paint edits", () => {
  it("reopens and refreshes a linked HD consumer in its owned Content's logical pixel space",async()=>{
    const h=host();
    Object.assign(h.source,{type:"FRAME",children:[],clipsContent:true,layoutMode:"NONE",
      relativeTransform:[[1,0,0],[0,1,0]],
      absoluteTransform:[[1,.25,0],[.1,1,0]],absoluteBoundingBox:{x:0,y:0,width:120,height:90},
      absoluteRenderBounds:{x:0,y:0,width:122,height:92}});
    vi.spyOn(nativeComponents,"componentNativeSourceOwner").mockResolvedValue({id:"native-owner"} as FrameNode);
    h.source.exportAsync.mockImplementation(async(options:ExportSettingsImage)=>{
      const scale=options.constraint?.type==="SCALE"?options.constraint.value:1;
      const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);png.set([73,72,68,82],12);
      const view=new DataView(png.buffer);view.setUint32(16,120*scale);view.setUint32(20,90*scale);return png;
    });
    await h.start();await h.ready();
    const source=h.posts.find(message=>message.type==="source").payload;
    expect(source.captureFacts).toMatchObject({logicalSize:{width:100,height:80},
      logicalToCaptureSpace:h.source.absoluteTransform,pixelSize:{width:120,height:90}});
    h.api.ui.onmessage({type:"request-source-raster",generation:1,requestId:7,sourceNodeId:h.source.id,
      targetNodeId:h.result.id,desiredWidth:200,desiredHeight:160});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source-raster",requestId:7,
      captureFacts:expect.objectContaining({logicalSize:{width:100,height:80},pixelSize:{width:240,height:180}})})));
    const exportRaster=h.source.exportAsync.getMockImplementation()!;
    h.source.exportAsync.mockImplementationOnce(async(settings:ExportSettingsImage)=>{
      const png=await exportRaster(settings);h.source.absoluteTransform[0][2]+=1;return png;
    });
    h.api.ui.onmessage({type:"request-source-raster",generation:1,requestId:8,sourceNodeId:h.source.id,
      targetNodeId:h.result.id,desiredWidth:200,desiredHeight:160});
    await vi.waitFor(()=>expect(h.posts).toContainEqual(expect.objectContaining({type:"source-raster-error",requestId:8})));
  });
  it("admits legacy results and records fresh normalized paints on a successful update", async () => {
    const h = host(); await h.start(); await h.ready(); h.apply();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-complete" })));
    expect(h.result.fills[0].imageHash).toBe("updated");
    expect(JSON.parse(h.result.shared.get(SHARED_RASTER_PAINT_KEY)).fills).toEqual(h.result.fills);
    expect(readStoredBinding(h.result)?.revision).toBe(2);
  });

  it("refuses a paint edit made before reopen without exporting or overwriting it", async () => {
    const h = host(); writeRasterPaintProof(h.result); h.result.fills[0].opacity = 0.55;
    await h.start();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", message: { key: "rasterResultPaintChanged" } })));
    expect(h.source.exportAsync).not.toHaveBeenCalled(); expect(h.api.createImage).not.toHaveBeenCalled();
    expect(h.result.fills[0].opacity).toBe(0.55); expect(readStoredBinding(h.result)?.revision).toBe(1);
  });

  it("rejects a legacy paint change while its source export is pending", async () => {
    const h = host(); let finish!: (value: Uint8Array) => void;
    h.source.exportAsync.mockReturnValue(new Promise<Uint8Array>(resolve => { finish = resolve; }));
    await h.start(); await vi.waitFor(() => expect(h.source.exportAsync).toHaveBeenCalled());
    h.result.fills[0].opacity = 0.55; finish(new Uint8Array([1]));
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "selection-error", message: { key: "rasterResultPaintChanged" } })));
    expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("rejects an edit arriving after the read even before the host reports a nodechange", async () => {
    const h = host(); await h.start(); await h.ready(); h.result.fills[0].opacity = 0.55; h.apply();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error", message: { key: "rasterResultPaintChanged" } })));
    expect(h.result.fills[0].opacity).toBe(0.55); expect(h.api.createImage).not.toHaveBeenCalled();
  });

  it("rolls back the paint proof and binding with the image when a later write fails", async () => {
    const h = host(); writeRasterPaintProof(h.result);
    const proof = h.result.shared.get(SHARED_RASTER_PAINT_KEY), binding = h.result.shared.get("binding");
    await h.start(); await h.ready();
    const write = h.result.setSharedPluginData.getMockImplementation()!;
    let failed = false;
    h.result.setSharedPluginData.mockImplementation((namespace: string, key: string, value: string) => {
      write(namespace, key, value);
      if (key === SHARED_RASTER_PAINT_KEY && !failed) { failed = true; throw Error("host write failed"); }
    }); h.apply();
    await vi.waitFor(() => expect(h.posts).toContainEqual(expect.objectContaining({ type: "apply-error" })));
    expect(h.result.fills[0].imageHash).toBe("published");
    expect(h.result.shared.get(SHARED_RASTER_PAINT_KEY)).toBe(proof); expect(h.result.shared.get("binding")).toBe(binding);
  });
});
