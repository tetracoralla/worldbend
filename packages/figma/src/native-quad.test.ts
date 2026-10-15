import { describe, expect, it } from "vitest";
import { documentQuadForSource } from "./native-quad";

const segments = [
  { start: 0, end: 1 },
  { start: 1, end: 2 },
  { start: 2, end: 3 },
  { start: 3, end: 0 },
];

describe("documentQuadForSource", () => {
  it("reads a straight convex four-corner Vector in document coordinates", () => {
    expect(documentQuadForSource({
      type: "VECTOR",
      vectorNetwork: {
        vertices: [
          { x: 10, y: 20 },
          { x: 90, y: 10 },
          { x: 80, y: 90 },
          { x: 20, y: 80 },
        ],
        segments,
      },
      absoluteTransform: [[2, 0, 100], [0, 3, 200]],
    })).toEqual({
      tl: { x: 120, y: 260 },
      tr: { x: 280, y: 230 },
      br: { x: 260, y: 470 },
      bl: { x: 140, y: 440 },
    });
  });

  it("orders a rotated Vector clockwise from its visible top corner", () => {
    const c = Math.SQRT1_2;
    const quad = documentQuadForSource({
      type: "VECTOR",
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        segments,
      },
      absoluteTransform: [[c, -c, 200], [c, c, 100]],
    });
    expect(quad?.tl).toEqual({ x: 200, y: 100 });
    expect(quad?.tr.x).toBeCloseTo(200 + 100 * c);
    expect(quad?.tr.y).toBeCloseTo(100 + 100 * c);
    expect(quad?.br.x).toBeCloseTo(200 + 50 * c);
    expect(quad?.br.y).toBeCloseTo(100 + 150 * c);
    expect(quad?.bl.x).toBeCloseTo(200 - 50 * c);
    expect(quad?.bl.y).toBeCloseTo(100 + 50 * c);
  });

  it("does not confuse document translation with quad degeneracy", () => {
    expect(documentQuadForSource({
      type: "VECTOR",
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        segments,
      },
      absoluteTransform: [[1, 0, 1_000_000_000], [0, 1, -1_000_000_000]],
    })).toEqual({
      tl: { x: 1_000_000_000, y: -1_000_000_000 },
      tr: { x: 1_000_000_100, y: -1_000_000_000 },
      br: { x: 1_000_000_100, y: -999_999_950 },
      bl: { x: 1_000_000_000, y: -999_999_950 },
    });
  });

  it("uses a connected clockwise perimeter for an exact diamond", () => {
    const base = {
      type: "VECTOR",
      vectorNetwork: {
        vertices: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
        segments,
      },
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    };
    expect(documentQuadForSource(base)).toEqual({
      tl: { x: 50, y: 0 }, tr: { x: 100, y: 50 },
      br: { x: 50, y: 100 }, bl: { x: 0, y: 50 },
    });
  });

  it("keeps a flipped Vector upright in document-space corner order", () => {
    expect(documentQuadForSource({
      type: "VECTOR",
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
        segments,
      },
      absoluteTransform: [[-1, 0, 100], [0, 1, 0]],
    })).toEqual({
      tl: { x: 0, y: 0 }, tr: { x: 100, y: 0 },
      br: { x: 100, y: 50 }, bl: { x: 0, y: 50 },
    });
  });

  it("does not guess curved, open, crossed, or concave vectors into fit targets", () => {
    const base = {
      type: "VECTOR",
      vectorNetwork: {
        vertices: [{ x: 10, y: 20 }, { x: 90, y: 10 }, { x: 80, y: 90 }, { x: 20, y: 80 }],
        segments,
      },
      absoluteTransform: [[1, 0, 0], [0, 1, 0]],
    };
    expect(documentQuadForSource({
      ...base,
      vectorNetwork: { ...base.vectorNetwork, segments: segments.slice(0, 3) },
    })).toBeUndefined();
    expect(documentQuadForSource({
      ...base,
      vectorNetwork: {
        ...base.vectorNetwork,
        vertices: [{ x: 10, y: 20 }, { x: 90, y: 10 }, { x: 80, y: 90 }, { x: 20, y: 80 }],
        segments: [{ ...segments[0]!, tangentStart: { x: 1, y: 0 } }, ...segments.slice(1)],
      },
    })).toBeUndefined();
    expect(documentQuadForSource({
      ...base,
      vectorNetwork: {
        vertices: [{ x: 10, y: 20 }, { x: 90, y: 10 }, { x: 80, y: 90 }, { x: 20, y: 80 }],
        segments: [
          { start: 0, end: 2 }, { start: 2, end: 1 },
          { start: 1, end: 3 }, { start: 3, end: 0 },
        ],
      },
    })).toBeUndefined();
    expect(documentQuadForSource({
      ...base,
      vectorNetwork: {
        vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 100 }],
        segments,
      },
    })).toBeUndefined();
  });
});
