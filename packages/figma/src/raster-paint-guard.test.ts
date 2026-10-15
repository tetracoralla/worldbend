import { describe, expect, it } from "vitest";
import { captureRasterPaints, rasterPaintsIntact, rasterPaintsMatch, SHARED_RASTER_PAINT_KEY, writeRasterPaintProof } from "./raster-paint-guard";

function result() {
  const data = new Map<string, string>();
  const node = {
    fills: [{ type: "IMAGE", scaleMode: "FILL", imageHash: "published", opacity: 1,
      filters: { exposure: 0 }, imageTransform: [[1, 0, 0], [0, 1, 0]] }],
    opacity: 1, x: 0,
    getSharedPluginData: (_namespace: string, key: string) => data.get(key) ?? "",
    setSharedPluginData: (_namespace: string, key: string, value: string) => data.set(key, value),
  };
  return { node: node as unknown as RectangleNode, data };
}

describe("published raster paint protection", () => {
  it.each(["opacity", "filters", "imageTransform", "imageHash"])("detects a saved %s edit after reopen", key => {
    const { node } = result();
    writeRasterPaintProof(node);
    const paint = (node.fills as ImagePaint[])[0]!;
    if (key === "opacity") node.fills = [{ ...paint, opacity: 0.55 }];
    if (key === "filters") node.fills = [{ ...paint, filters: { exposure: 0.2 } }];
    if (key === "imageTransform") node.fills = [{ ...paint, scaleMode: "CROP", imageTransform: [[1, 0, 0.2], [0, 1, 0]] }];
    if (key === "imageHash") node.fills = [{ ...paint, imageHash: "replacement" }];
    expect(rasterPaintsIntact(node)).toBe(false);
  });

  it("retains proof on a Duplicate while native placement and layer opacity remain editable", () => {
    const { node, data } = result();
    writeRasterPaintProof(node);
    const copy = { ...node, id: "copy", x: 20, opacity: 0.4,
      getSharedPluginData: (_namespace: string, key: string) => data.get(key) ?? "" };
    expect(rasterPaintsIntact(copy)).toBe(true);
    const paint = (node.fills as ImagePaint[])[0]!;
    node.fills = [Object.fromEntries(Object.entries(paint).reverse()) as unknown as ImagePaint];
    expect(rasterPaintsIntact(node)).toBe(true);
  });

  it("protects legacy results from edits during async reads without inventing a prior publication", () => {
    const { node } = result();
    expect(rasterPaintsIntact(node)).toBe(true);
    const snapshot = captureRasterPaints(node);
    node.fills = [];
    expect(rasterPaintsMatch(node, snapshot)).toBe(false);
    expect(rasterPaintsIntact(node)).toBe(true);
  });

  it("refuses damaged proof rather than downgrading it to a legacy result", () => {
    const { node, data } = result();
    for (const raw of ["{", JSON.stringify({ schema: "worldbend.figma.raster-paint", version: "9", fills: node.fills }), " ".repeat(32769)]) {
      data.set(SHARED_RASTER_PAINT_KEY, raw);
      expect(rasterPaintsIntact(node)).toBe(false);
    }
  });
});
