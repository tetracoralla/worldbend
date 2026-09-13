import { describe, expect, it } from "vitest";
import type { DeformationStroke } from "@worldbend/web/types";
import { createMeshSpec } from "./mesh-workspace";
import {
  appendStrokeSample,
  anchorsForSubdivisions,
  envelopePointRole,
  MAX_SURFACE_ANCHORS,
  sourceUvFromWarped,
  strokeAppendLimit,
  strokeSample,
  toggleInteriorAnchor,
  nextStrokeId,
  warpedFromSource,
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

  it("keeps the bounded pin set unchanged at capacity", () => {
    const full = Array.from({ length: MAX_SURFACE_ANCHORS }, (_, index) => ({
      id: `pin-${index + 1}`,
      column: index % 8 + 1,
      row: Math.floor(index / 8) + 1,
    }));
    expect(toggleInteriorAnchor(full, 9, 9, 10)).toEqual(full);
  });
});

describe("sourceUvFromWarped", () => {
  it("inverts an identity mesh at the center", () => {
    const mesh = createMeshSpec(100, 80, 4).mesh;
    expect(sourceUvFromWarped(mesh, { x: 0.5, y: 0.5 })).toEqual({ x: 0.5, y: 0.5 });
  });
  it("round trips the actual triangular mapping for a deformed interior", () => {
    const mesh = createMeshSpec(100, 80, 2).mesh;
    mesh.vertices[4]!.warped = { x: 0.4, y: 0.6 };
    const point = warpedFromSource(mesh, { x: 0.25, y: 0.25 })!;
    expect(point).toEqual({ x: 0.2, y: 0.3 });
    const restored = sourceUvFromWarped(mesh, point)!;
    expect(restored.x).toBeCloseTo(0.25, 12);
    expect(restored.y).toBeCloseTo(0.25, 12);
  });
});

it("preserves pins exactly across compatible densities and refuses moving them", () => {
  expect(anchorsForSubdivisions([{ id: "pin", column: 6, row: 6 }], 12, 8))
    .toEqual([{ id: "pin", column: 4, row: 4 }]);
  expect(anchorsForSubdivisions([{ id: "pin", column: 1, row: 1 }], 12, 8)).toBeUndefined();
});

it("avoids ID collisions when extending Agent-authored pins and strokes", () => {
  expect(nextStrokeId([{ id: "stroke-2", samples: [strokeSample({ x: 0.5, y: 0.5 }, undefined, 0.15, 0.5)] }])).toBe("stroke-1");
  const anchors = toggleInteriorAnchor([{ id: "pin-1-1", column: 2, row: 2 }], 1, 1, 4);
  expect(new Set(anchors.map(anchor => anchor.id)).size).toBe(2);
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

  it("classifies which closed capacity blocks the next sample", () => {
    const sample = strokeSample({ x: 0.5, y: 0.5 }, undefined, 0.15, 0.5);
    const stroke = (id: string, samples: number): DeformationStroke => ({
      id,
      samples: Array.from({ length: samples }, () => sample) as DeformationStroke["samples"],
    });
    expect(strokeAppendLimit([], "stroke-1")).toBe("none");
    const full = Array.from({ length: 4 }, (_, index) => stroke(`stroke-${index + 1}`, 256));
    expect(strokeAppendLimit(full, "stroke-4")).toBe("samples");
    expect(strokeAppendLimit(full, "stroke-5")).toBe("samples");
    expect(strokeAppendLimit(Array.from({ length: 64 }, (_, index) => stroke(`stroke-${index + 1}`, 1)), "stroke-65")).toBe("strokes");
    expect(strokeAppendLimit([stroke("stroke-1", 256)], "stroke-1")).toBe("stroke");
  });
});
