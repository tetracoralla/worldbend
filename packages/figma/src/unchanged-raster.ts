import type { PreviewSolveOutput, Size, WarpMesh } from "@worldbend/web/types";

/** Recognize a pixel-preserving publication from the core's resolved mapping.
 * Looking only at the UI recipe would miss flips, fitting and rebased inputs.
 * A mesh always uses the renderer, even when its outer corners are unchanged.
 */
export function isUnchangedRasterProjection(
  solved: PreviewSolveOutput,
  output: Size,
  mesh?: WarpMesh,
): boolean {
  if (mesh || !Number.isSafeInteger(output.width) || !Number.isSafeInteger(output.height) ||
    output.width < 1 || output.height < 1 ||
    solved.resolvedDestination.reference.width !== output.width ||
    solved.resolvedDestination.reference.height !== output.height) return false;
  const matrix = solved.homography.matrix;
  const scale = matrix[8];
  if (matrix.length !== 9 || !matrix.every(Number.isFinite) || scale === 0) return false;
  const expected = [output.width, 0, 0, 0, output.height, 0, 0, 0, 1];
  // Homogeneous matrices may differ by a scalar. This tolerance is below a
  // billionth of one output pixel, only absorbing the solver's roundoff.
  return matrix.every((value, index) => Math.abs(value / scale - expected[index]!) <= 1e-9);
}
