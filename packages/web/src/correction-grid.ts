import type { Point, PreviewSolveOutput, WarpMesh } from "./types";

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
  const subdivisions = mesh.subdivisions;
  const side = subdivisions + 1;
  if (!Number.isInteger(subdivisions) || subdivisions < 1 || mesh.vertices.length !== side * side) {
    throw new Error("The correction grid received an invalid warp mesh");
  }
  const scaledX = clamp(point.x, 0, 1) * subdivisions;
  const scaledY = clamp(point.y, 0, 1) * subdivisions;
  const cellX = Math.min(subdivisions - 1, Math.floor(scaledX));
  const cellY = Math.min(subdivisions - 1, Math.floor(scaledY));
  const x = scaledX - cellX;
  const y = scaledY - cellY;
  const vertex = (offsetX: number, offsetY: number): Point => {
    const item = mesh.vertices[(cellY + offsetY) * side + cellX + offsetX];
    if (!item) throw new Error("The correction grid received an incomplete warp mesh");
    return item.warped;
  };
  const tl = vertex(0, 0);
  const tr = vertex(1, 0);
  const br = vertex(1, 1);
  const bl = vertex(0, 1);
  return y <= x
    ? combine([tl, tr, br], [1 - x, x - y, y])
    : combine([tl, br, bl], [1 - y, x, y - x]);
}

function combine(points: readonly Point[], weights: readonly number[]): Point {
  return points.reduce(
    (result, point, index) => ({
      x: result.x + point.x * (weights[index] ?? 0),
      y: result.y + point.y * (weights[index] ?? 0),
    }),
    { x: 0, y: 0 },
  );
}

function project(matrix: PreviewSolveOutput["homography"]["matrix"], point: Point): Point {
  const w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
