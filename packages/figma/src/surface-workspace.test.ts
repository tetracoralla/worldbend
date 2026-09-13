import { describe, expect, it } from "vitest";
import { normalizedSpec } from "@worldbend/web";
import {
  compatibleSubdivisions,
  createSurfaceSpec,
  DEFAULT_SURFACE_SUBDIVISIONS,
  identityEnvelope,
  patchChoicesFor,
  resampleEnvelope,
  surfaceSpecFromPerspective,
} from "./surface-workspace";
import { transformForMesh } from "./mesh-workspace";
import { isStoredDesignerTask } from "./stored-designer-task";

describe("identityEnvelope", () => {
  it("builds the regular 1×1 cubic lattice on the unit square", () => {
    const envelope = identityEnvelope(1, 1);
    expect(envelope.columns).toBe(1);
    expect(envelope.rows).toBe(1);
    expect(envelope.points).toHaveLength(16);
    expect(envelope.points[0]).toEqual({ x: 0, y: 0 });
    expect(envelope.points[3]).toEqual({ x: 1, y: 0 });
    expect(envelope.points[5]).toEqual({ x: 1 / 3, y: 1 / 3 });
    expect(envelope.points[15]).toEqual({ x: 1, y: 1 });
  });
});

describe("resampleEnvelope", () => {
  it("splits and merges a curved cubic envelope without changing its control data", () => {
    const envelope = identityEnvelope(1, 1);
    envelope.points[5] = { x: 0.4, y: 0.45 };
    const next = resampleEnvelope(envelope, 2, 2);
    expect(next.points).toHaveLength(49);
    const merged = resampleEnvelope(next, 1, 1);
    for (let i = 0; i < envelope.points.length; i += 1) {
      expect(merged.points[i]!.x).toBeCloseTo(envelope.points[i]!.x, 12);
      expect(merged.points[i]!.y).toBeCloseTo(envelope.points[i]!.y, 12);
    }
    // A split control is the exact half-interval derivative, not a sample of
    // the original control polygon (which would change the rendered curve).
    expect(next.points[8]!.x).toBeCloseTo(0.18333333333333332, 12);
    expect(next.points[8]!.y).toBeCloseTo(0.19583333333333333, 12);
  });

  it("rejects removing a split required by the authored shape", () => {
    const envelope = identityEnvelope(2, 2);
    envelope.points[8] = { x: 0.2, y: 0.2 };
    expect(() => resampleEnvelope(envelope, 1, 1)).toThrow("need these splits");
  });

  it("returns the same envelope when patch density is unchanged", () => {
    const envelope = identityEnvelope(1, 1);
    expect(resampleEnvelope(envelope, 1, 1)).toBe(envelope);
  });
});

describe("createSurfaceSpec", () => {
  const plane = normalizedSpec({
    tl: { x: 0.1, y: 0 },
    tr: { x: 1, y: 0.05 },
    br: { x: 0.9, y: 1 },
    bl: { x: 0, y: 0.95 },
  });

  it("defaults to a 1×1 envelope on a 12×12 mesh", () => {
    const spec = createSurfaceSpec(120, 90);
    expect(spec.meshSubdivisions).toBe(DEFAULT_SURFACE_SUBDIVISIONS);
    expect(spec.envelope.columns).toBe(1);
    expect(spec.envelope.rows).toBe(1);
    expect(spec.anchors).toEqual([]);
    expect(spec.strokes).toEqual([]);
    expect(isStoredDesignerTask({ kind: "surface", spec })).toBe(true);
  });

  it("strips preset Warp so Split Warp cannot carry two deformation models", () => {
    const spec = {
      ...plane,
      content: { ...plane.content, warp: { preset: "arc" as const, amount: 0.5 } },
    };
    expect(transformForMesh(spec).content.warp).toBeUndefined();
    expect(surfaceSpecFromPerspective({ spec, width: 100, height: 80 }).transform.content?.warp)
      .toBeUndefined();
    expect(surfaceSpecFromPerspective({ spec, width: 100, height: 80 }).transform.destination.quad.tl)
      .toEqual({ x: 0.1, y: 0 });
  });

  it("picks a compatible mesh density when patch counts change", () => {
    expect(compatibleSubdivisions(2, 2, 12)).toBe(12);
    expect(compatibleSubdivisions(2, 1, 9)).toBe(8);
  });
});

describe("patchChoicesFor", () => {
  it("keeps the authored 1–2 split list for densities this workspace writes", () => {
    expect(patchChoicesFor(1, 1)).toEqual([
      { columns: 1, rows: 1 },
      { columns: 2, rows: 1 },
      { columns: 1, rows: 2 },
      { columns: 2, rows: 2 },
    ]);
    expect(patchChoicesFor(2, 2)).toEqual(patchChoicesFor(1, 1));
  });

  it("appends a stored 3×3 or 4×4 only for the current lattice", () => {
    expect(patchChoicesFor(3, 3)).toEqual([
      ...patchChoicesFor(1, 1),
      { columns: 3, rows: 3 },
    ]);
    expect(patchChoicesFor(4, 1)).toEqual([
      ...patchChoicesFor(1, 1),
      { columns: 4, rows: 1 },
    ]);
    expect(patchChoicesFor(1, 1).some((choice) => choice.columns === 3)).toBe(false);
  });
});
