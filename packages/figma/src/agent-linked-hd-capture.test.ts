import { afterEach, describe, expect, it, vi } from "vitest";
import { planSourceCapture } from "../../web/src/bridge";
import { captureMockupSources, exportCapturedSources } from "./agent-handoff";
import * as nativeComponents from "./native-component";

const pageId = "page-1";
const parent = [[0, -1, 80], [1, 0, 0]] as [[number, number, number], [number, number, number]];

function png(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function host() {
  const page: any = { id: pageId, type: "PAGE", children: [] };
  const registry = new Map<string, any>();
  const frame = (id: string) => {
    const node: any = {
      id, type: "FRAME", name: id, parent: page, removed: false,
      width: 100, height: 80, fills: [{ type: "SOLID", color: { r: 0.2, g: 0.3, b: 0.4 } }],
      strokes: [], effects: [], clipsContent: true, children: [],
      relativeTransform: [[1, 0, 0], [0, 1, 0]],
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
      absoluteRenderBounds: { x: 0, y: 0, width: 100, height: 80 },
      exportAsync: vi.fn(async () => png(1, 1)),
    };
    registry.set(id, node);
    page.children.push(node);
    return node;
  };
  const api: any = {
    currentPage: page,
    getNodeByIdAsync: vi.fn(async (id: string) => registry.get(id) ?? null),
  };
  vi.stubGlobal("figma", api);
  return { frame };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shipped Agent Linked HD capture", () => {
  it("exports a rotated owned parent once and keeps that capture's logical facts", async () => {
    const { frame } = host();
    const source = frame("content");
    source.absoluteTransform = parent.map(row => [...row]);
    source.absoluteBoundingBox = { x: 0, y: 0, width: 80, height: 100 };
    source.absoluteRenderBounds = { x: -4, y: -6, width: 90, height: 120 };
    vi.spyOn(nativeComponents, "componentNativeSourceOwner").mockResolvedValue({ id: "native-owner" } as FrameNode);
    const exported = new Map<string, Uint8Array>();
    source.exportAsync.mockImplementation(async (settings: ExportSettingsImage) => {
      const scale = settings.constraint?.type === "SCALE" ? settings.constraint.value : 1;
      const bytes = png(Math.round(80 * scale), Math.round(100 * scale));
      exported.set("last", bytes);
      return bytes;
    });
    const [capture] = await captureMockupSources([source.id], pageId, { width: 200, height: 160 });
    expect(source.exportAsync).toHaveBeenCalledTimes(1);
    expect(source.exportAsync.mock.calls[0][0]).toEqual({
      format: "PNG", useAbsoluteBounds: true, constraint: { type: "SCALE", value: 2 },
    });
    expect(capture?.bytes).toBe(exported.get("last"));
    expect(capture?.sourceCapture).toEqual({
      logicalSize: { width: 100, height: 80 },
      logicalToCaptureSpace: parent,
      captureOrigin: { x: 0, y: 0 },
      captureScale: 2,
      pixelSize: { width: 160, height: 200 },
      convention: "fixedDensityFromOrigin",
    });
    expect(capture?.source.sourceCapture).toEqual(capture?.sourceCapture);
    const view = await planSourceCapture(capture!.sourceCapture!);
    expect(view.logicalUvToTextureUv).toEqual([[0, -1, 1], [1, 0, 0]]);
    expect(view.logicalUvToTextureUv).not.toEqual([[-1.25, 0, -1], [0, -0.8, 0.8]]);
    const [raster] = exportCapturedSources("result-1", [capture!], "inline");
    expect(raster).toMatchObject({
      slotId: "source-1", nodeId: source.id, width: 160, height: 200,
      sourceCapture: capture?.sourceCapture,
    });
    expect(raster?.base64).toBe(Buffer.from(capture!.bytes).toString("base64"));
    expect(source.effects).toEqual([]);
    expect(source.width).toBe(100);
    expect(source.height).toBe(80);
  });

  it("rejects a source that moves during export and captures the restored artwork", async () => {
    const { frame } = host();
    const source = frame("content");
    const transform = parent.map(row => [...row]);
    source.absoluteTransform = transform;
    source.absoluteBoundingBox = { x: 0, y: 0, width: 80, height: 100 };
    source.effects = [{ type: "DROP_SHADOW", visible: true, radius: 6 }];
    vi.spyOn(nativeComponents, "componentNativeSourceOwner").mockResolvedValue({ id: "native-owner" } as FrameNode);
    source.exportAsync.mockImplementation(async (settings: ExportSettingsImage) => {
      const scale = settings.constraint?.type === "SCALE" ? settings.constraint.value : 1;
      const bytes = png(Math.round(80 * scale), Math.round(100 * scale));
      source.absoluteTransform[0][2] += 1;
      return bytes;
    });
    await expect(captureMockupSources([source.id], pageId, { width: 200, height: 160 }))
      .rejects.toThrow("E_FIGMA_CONFLICT: Source changed during capture; inspect again");
    expect(source.exportAsync).toHaveBeenCalledTimes(1);
    expect(source.effects).toEqual([{ type: "DROP_SHADOW", visible: true, radius: 6 }]);
    source.absoluteTransform[0][2] = 80;
    source.exportAsync.mockImplementation(async (settings: ExportSettingsImage) => {
      const scale = settings.constraint?.type === "SCALE" ? settings.constraint.value : 1;
      return png(Math.round(80 * scale), Math.round(100 * scale));
    });
    const [capture] = await captureMockupSources([source.id], pageId, { width: 200, height: 160 });
    expect(capture?.sourceCapture?.logicalToCaptureSpace).toEqual(parent);
    expect(source.exportAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps an ordinary frame's outside shadow in one appearance export", async () => {
    const { frame } = host();
    const source = frame("poster");
    source.effects = [{ type: "DROP_SHADOW", visible: true, offset: { x: 12, y: 8 }, radius: 10 }];
    source.absoluteRenderBounds = { x: -12, y: -8, width: 140, height: 110 };
    const before = {
      effects: structuredClone(source.effects),
      fills: structuredClone(source.fills),
      width: source.width,
      height: source.height,
      absoluteTransform: structuredClone(source.absoluteTransform),
    };
    let appearance: Uint8Array | undefined;
    source.exportAsync.mockImplementation(async (settings: ExportSettingsImage) => {
      const scale = settings.constraint?.type === "SCALE" ? settings.constraint.value : 1;
      appearance = png(Math.round(140 * scale), Math.round(110 * scale));
      return appearance;
    });
    const [capture] = await captureMockupSources([source.id], pageId, { width: 200, height: 160 });
    expect(source.exportAsync).toHaveBeenCalledTimes(1);
    expect(source.exportAsync.mock.calls[0][0]).not.toHaveProperty("useAbsoluteBounds");
    expect(source.exportAsync.mock.calls[0][0].constraint.value).toBe(160 / 110);
    expect(capture?.bytes).toBe(appearance);
    expect(capture).not.toHaveProperty("sourceCapture");
    const [raster] = exportCapturedSources("result-1", [capture!], "inline");
    expect(raster).not.toHaveProperty("sourceCapture");
    expect(source.effects).toEqual(before.effects);
    expect(source.fills).toEqual(before.fills);
    expect(source.width).toBe(before.width);
    expect(source.height).toBe(before.height);
    expect(source.absoluteTransform).toEqual(before.absoluteTransform);
  });
});
