import { describe, expect, it } from "vitest";
import { createMeshSpec } from "./mesh-workspace";
import {
  appendStrokeSample,
  envelopePointRole,
  sourceUvFromWarped,
  strokeSample,
  toggleInteriorAnchor,
} from "./surface-authoring";

describe("envelopePointRole", () => {
  it("marks the 1×1 interior as off-curve handles", () => {
    expect(envelopePointRole(1, 1, 0)).toBe("boundary");
    expect(envelopePointRole(1, 1, 5)).toBe("handle");
    expect(envelopePointRole(1, 1, 15)).toBe("boundary");
  });

  it("marks the 2×1 split as on-curve interior points", () => {
    // 7×4 lattice: column 3 is the split, row 1 is interior.
    expect(envelopePointRole(2, 1, 1 * 7 + 3)).toBe("curve");
    expect(envelopePointRole(2, 1, 1 * 7 + 1)).toBe("handle");
  });
});

describe("toggleInteriorAnchor", () => {
  it("pins and unpins an interior mesh vertex", () => {
    const pinned = toggleInteriorAnchor([], 1, 1, 4);
    expect(pinned).toEqual([{ id: "pin-1-1", column: 1, row: 1 }]);
    expect(toggleInteriorAnchor(pinned, 1, 1, 4)).toEqual([]);
  });

  it("rejects boundary vertices", () => {
    expect(toggleInteriorAnchor([], 0, 1, 4)).toEqual([]);
    expect(toggleInteriorAnchor([], 4, 1, 4)).toEqual([]);
  });
});

describe("sourceUvFromWarped", () => {
  it("inverts an identity mesh at the center", () => {
    const mesh = createMeshSpec(100, 80, 4).mesh;
    expect(sourceUvFromWarped(mesh, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("appendStrokeSample", () => {
  it("opens a stroke then records later deltas", () => {
    const first = strokeSample({ x: 0.4, y: 0.4 }, undefined, 0.2, 0.5);
    const opened = appendStrokeSample([], "stroke-1", first);
    expect(opened?.[0]?.samples).toHaveLength(1);
    const moved = strokeSample({ x: 0.45, y: 0.4 }, first.position, 0.2, 0.5);
    expect(moved.delta.x).toBeCloseTo(0.05);
    const next = appendStrokeSample(opened ?? [], "stroke-1", moved);
    expect(next?.[0]?.samples).toHaveLength(2);
  });
});
