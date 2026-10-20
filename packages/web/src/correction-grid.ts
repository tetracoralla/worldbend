import type { Point, PreviewSolveOutput, WarpMesh } from "./types";

import { mapWarpMesh, validateMeshTopology } from "./mesh-topology";

const GRID_FRACTIONS = [1 / 3, 2 / 3] as const;
const SAMPLES_PER_LINE = 24;

/**
 * Build non-authoritative visual guides from the same solved homography and
 * optional core-owned warp mesh used by the renderer. The guides never feed
 * geometry back into TransformSpec.
 */
export function correctionGridPolylines(
  solved: PreviewSolveOutput,
  warpMesh?: WarpMesh,
): Point[][] {
  if (warpMesh) validateMeshTopology(warpMesh);
  return [
    ...GRID_FRACTIONS.map((u) => sampleLine(solved, warpMesh, (step) => ({ x: u, y: step }))),
    ...GRID_FRACTIONS.map((v) => sampleLine(solved, warpMesh, (step) => ({ x: step, y: v }))),
  ];
}

function sampleLine(
  solved: PreviewSolveOutput,
  warpMesh: WarpMesh | undefined,
  sourcePoint: (step: number) => Point,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= SAMPLES_PER_LINE; index += 1) {
    const source = sourcePoint(index / SAMPLES_PER_LINE);
    points.push(project(solved.homography.matrix, warpedPoint(warpMesh, source)));
  }
  return points;
}

function warpedPoint(mesh: WarpMesh | undefined, point: Point): Point {
  if (!mesh) return point;
  const warped = mapWarpMesh(mesh, point);
  if (!warped) throw new Error("The correction grid received an incomplete warp mesh");
  return warped;
}

function project(matrix: PreviewSolveOutput["homography"]["matrix"], point: Point): Point {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  };
}
