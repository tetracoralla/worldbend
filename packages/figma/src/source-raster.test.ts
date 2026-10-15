import { describe, expect, it } from "vitest";
import { sameSourceRasterViewBox, sourceRasterBounds, sourceRasterViewBox } from "./source-raster";
import { canUseNativeSource, nativeAppearanceInsideViewport } from "./native-document";

function frame() {
  return { type: "FRAME", clipsContent: true, width: 320, height: 240,
    relativeTransform: [[1, 0, 0], [0, 1, 0]], absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    absoluteBoundingBox: { x: 100, y: 200, width: 320, height: 240 },
    absoluteRenderBounds: { x: 100, y: 200, width: 320, height: 240 },
    fills: [], strokes: [], effects: [] } as unknown as FrameNode;
}

describe("source raster domain", () => {
  it("preserves a clipped Frame's intentional blank margins", () => {
    const node = frame();
    Object.assign(node, { absoluteRenderBounds: { x: 130, y: 230, width: 100, height: 80 } });
    expect(sourceRasterBounds(node)).toEqual({ useAbsoluteBounds: true });
    expect(sourceRasterViewBox(node)).toEqual(node.absoluteBoundingBox);
  });

  it("keeps a Frame's own shadow/outside border rather than treating clipsContent as a paint clip", () => {
    const node = frame();
    Object.assign(node, { absoluteRenderBounds: { x: 93, y: 197, width: 344, height: 264 } });
    expect(sourceRasterBounds(node)).toEqual({});
    expect(sourceRasterViewBox(node)).toEqual(node.absoluteRenderBounds);
    expect(canUseNativeSource(node)).toBe(true); // Existing Content remains structurally valid.
    expect(nativeAppearanceInsideViewport(node)).toBe(false); // New Shader UV cannot include outside root paint.
    expect(sourceRasterViewBox(node, true)).toEqual(node.absoluteBoundingBox);
    expect(node.width).toBe(320);
  });

  it("keeps the full domain of region-only vectors and the appearance crop of stroked vectors", () => {
    const node = { type: "VECTOR", fills: Symbol("mixed"), strokes: [], effects: [],
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 },
      absoluteRenderBounds: { x: -4, y: -4, width: 108, height: 88 } } as unknown as VectorNode;
    expect(sourceRasterBounds(node)).toEqual({ useAbsoluteBounds: true });
    expect(sourceRasterViewBox(node)).toEqual(node.absoluteBoundingBox);
    Object.assign(node, { strokes: [{ type: "SOLID", opacity: 1 }] });
    expect(sourceRasterBounds(node)).toEqual({});
    expect(sourceRasterViewBox(node)).toEqual(node.absoluteRenderBounds);
  });

  it("snapshots bounds by value and detects geometry drift without a host change event", () => {
    const node = frame(), box = sourceRasterViewBox(node)!;
    Object.assign(node.absoluteBoundingBox!, { width: 321 });
    expect(box.width).toBe(320);
    expect(sameSourceRasterViewBox(node, box)).toBe(false);
  });

  it("refuses a nonfinite capture domain and handles scene kinds without rendered bounds", () => {
    const node = frame();
    Object.assign(node, { absoluteBoundingBox: { x: NaN, y: 0, width: 320, height: 240 },
      absoluteRenderBounds: { x: NaN, y: 0, width: 320, height: 240 } });
    expect(sourceRasterViewBox(node)).toBeNull();
    const other = { type: "CODE_BLOCK", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 80 } } as unknown as SceneNode;
    expect(sourceRasterViewBox(other)).toEqual(other.absoluteBoundingBox);
  });
});
