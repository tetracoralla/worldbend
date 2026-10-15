import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe("linked raster publication protects native paint edits", () => {
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
