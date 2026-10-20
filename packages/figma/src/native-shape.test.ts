import { describe, expect, it } from "vitest";
import { documentShapeForSource } from "./native-shape";

const identity = [[1, 0, 0], [0, 1, 0]] as const;
const box = { x: 0, y: 0, width: 240, height: 160 };
const ring = "M 0 0 L 240 0 L 240 160 L 0 160 L 0 0 Z M 80 50 L 160 50 L 160 110 L 80 110 L 80 50 Z";
const rectangle = "M 0 0 L 240 0 L 240 160 L 0 160 Z";
function vector(paths: Array<{ windingRule: "NONZERO" | "EVENODD" | "NONE"; data: string }>,
  bounds = box, transform: readonly (readonly number[])[] = identity) {
  return { type: "VECTOR", vectorPaths: paths, absoluteTransform: transform, absoluteBoundingBox: bounds };
}

describe("documentShapeForSource", () => {
  it("captures the actual native same-winding EVENODD hole without a node fillRule", () => {
    const shape = documentShapeForSource(vector([{ windingRule: "EVENODD", data: ring }]));
    expect(shape?.contours).toHaveLength(2);
    expect(shape?.fillRule).toBe("evenOdd");
    expect(shape?.bounds).toEqual(box);
    expect(shape?.contours[1]?.start).toEqual({ x: 80, y: 50 });
  });

  it("preserves independent regions with different winding rules", () => {
    const shape = documentShapeForSource(vector([
      { windingRule: "EVENODD", data: ring },
      { windingRule: "NONZERO", data: "M 120 20 L 200 20 L 200 140 L 120 140 Z" },
    ]));
    expect(shape?.contours).toHaveLength(3);
    expect(shape?.regions).toEqual([
      { contourIndices: [0, 1], fillRule: "evenOdd" },
      { contourIndices: [2], fillRule: "nonZero" },
    ]);
  });

  it("maps native curve controls and uses the native bounds rather than sampled extrema", () => {
    // This cubic's extremum is between the old 1/32 sample positions.
    const extremum = (1 + Math.sqrt(7)) / 6;
    const minimum = 20 + 2 * (-120 * extremum - 120 * extremum ** 2 + 240 * extremum ** 3);
    const bounds = { x: -150, y: minimum, width: 200, height: 220 - minimum };
    const shape = documentShapeForSource(vector([
      { windingRule: "NONZERO", data: "M 0 0 C 0 -40 100 -120 100 0 L 100 100 L 0 100 Z" },
    ], bounds, [[-2, 0, 50], [0, 2, 20]]));
    expect(shape?.contours[0]?.start).toEqual({ x: 50, y: 20 });
    expect(shape?.contours[0]?.segments[0]).toEqual({
      kind: "cubic", c1: { x: 50, y: -60 }, c2: { x: -150, y: -220 }, to: { x: -150, y: 20 },
    });
    expect(shape?.bounds).toEqual(bounds);
  });

  it("retains NONZERO loop direction and skips native unfilled open paths", () => {
    const shape = documentShapeForSource(vector([
      { windingRule: "NONE", data: "M 0 0 L 100 100" },
      { windingRule: "NONZERO", data: "M 0 0 L 0 160 L 240 160 L 240 0 Z" },
    ]));
    expect(shape?.contours[0]?.segments[0]?.to).toEqual({ x: 0, y: 160 });
    expect(shape?.fillRule).toBe("nonZero");
  });

  it("rejects malformed, unclosed, nonfinite and oversized native paths", () => {
    for (const data of ["M 0 0 L 240 0 L 0 160", "M 0 0 Q 20 30 40 50 Z", "M 0 0 L 1e999 0 L 0 160 Z", "M 0 0 L 240 0 Z"]) {
      expect(documentShapeForSource(vector([{ windingRule: "NONZERO", data }]))).toBeUndefined();
    }
    expect(documentShapeForSource(vector([{ windingRule: "NONE", data: "M 0 0 L 10 10" }]))).toBeUndefined();
    expect(documentShapeForSource(vector([{ windingRule: "NONZERO", data: Array(9).fill(rectangle).join(" ") }]))).toBeUndefined();
    expect(documentShapeForSource({ type: "RECTANGLE" })).toBeUndefined();
    expect(documentShapeForSource({ ...vector([{ windingRule: "NONZERO", data: rectangle }]), absoluteBoundingBox: null })).toBeUndefined();
  });
});
