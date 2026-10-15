import { describe, expect, it } from "vitest";
import type { PreviewSolveOutput, WarpMesh } from "@worldbend/web/types";
import { isUnchangedRasterProjection } from "./unchanged-raster";

const size = { width: 640, height: 480 };
function solved(matrix: PreviewSolveOutput["homography"]["matrix"] = [640, 0, 0, 0, 480, 0, 0, 0, 1]): PreviewSolveOutput {
  return { resolvedDestination: { reference: { ...size } }, homography: { matrix } };
}

describe("unchanged raster publication", () => {
  it("accepts the core's full-domain mapping, including homogeneous normalization", () => {
    expect(isUnchangedRasterProjection(solved(), size)).toBe(true);
    expect(isUnchangedRasterProjection(solved([-1280, 0, 0, 0, -960, 0, 0, 0, -2]), size)).toBe(true);
    expect(isUnchangedRasterProjection(solved([640 + 1e-10, 0, 0, 0, 480, 0, 0, 0, 1]), size)).toBe(true);
  });

  it.each([
    [-640, 0, 640, 0, 480, 0, 0, 0, 1], // Horizontal source flip.
    [640, 0, 0, 0, -480, 480, 0, 0, 1], // Vertical source flip.
    [640, 0, .25, 0, 480, 0, 0, 0, 1], // Subpixel translation.
    [600, 0, 20, 0, 480, 0, 0, 0, 1], // Fit/inset content.
    [640, 0, 0, 0, 480, 0, .1, 0, 1], // Projective denominator.
  ])("retains rendering for a changed mapping %j", (...matrix) => {
    expect(isUnchangedRasterProjection(solved(matrix as PreviewSolveOutput["homography"]["matrix"]), size)).toBe(false);
  });

  it("rejects an interior deformation with identity outer corners", () => {
    const mesh = { subdivisions: 2, vertices: [] } as WarpMesh;
    expect(isUnchangedRasterProjection(solved(), size, mesh)).toBe(false);
  });

  it("rejects mismatched, fractional or damaged output plans", () => {
    expect(isUnchangedRasterProjection(solved(), { width: 320, height: 240 })).toBe(false);
    expect(isUnchangedRasterProjection(solved(), { width: 640.1, height: 480 })).toBe(false);
    expect(isUnchangedRasterProjection(solved([640, 0, 0, 0, 480, 0, 0, 0, 0]), size)).toBe(false);
    expect(isUnchangedRasterProjection(solved([640, 0, 0, 0, NaN, 0, 0, 0, 1]), size)).toBe(false);
  });
});
