import type { Point, SolveOutput } from "@worldbend/web";

/** Apply the core's forward/inverse matrices to author controls on its plane.
 * No solver or transform semantics live in this display adapter. */
export function planeCoordinates(solve: Pick<SolveOutput, "homography" | "resolvedDestination">) {
  const { width, height } = solve.resolvedDestination.reference;
  const map = (matrix: readonly number[], point: Point): Point => {
    const w = matrix[6]! * point.x + matrix[7]! * point.y + matrix[8]!;
    return {
      x: (matrix[0]! * point.x + matrix[1]! * point.y + matrix[2]!) / w,
      y: (matrix[3]! * point.x + matrix[4]! * point.y + matrix[5]!) / w,
    };
  };
  return {
    project(point: Point): Point {
      const pixel = map(solve.homography.matrix, point);
      return { x: pixel.x / width, y: pixel.y / height };
    },
    unproject(point: Point): Point {
      return map(solve.homography.inverse, { x: point.x * width, y: point.y * height });
    },
  };
}
