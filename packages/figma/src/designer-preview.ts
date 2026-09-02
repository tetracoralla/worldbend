import type { PreviewSolveOutput } from "@worldbend/web";

/**
 * Presentation-only preview ceiling shared by the designer task workspaces.
 * Perspective and Sizes preview at this cap too; Apply paths keep the full
 * requested resolution and stay under the 4096-axis publication boundary.
 */
export const DESIGNER_PREVIEW_MAX_AXIS = 1024;

/**
 * Uniform presentation scale that caps a planned raster at the preview axis.
 * Invalid or empty plans keep scale 1 so callers fall through to their own
 * validation errors instead of a silently invented geometry.
 */
export function previewScaleFor(
  width: number,
  height: number,
  maxAxis: number = DESIGNER_PREVIEW_MAX_AXIS,
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxAxis) ||
    width <= 0 ||
    height <= 0 ||
    maxAxis <= 0
  ) {
    return 1;
  }
  return Math.min(1, maxAxis / Math.max(width, height));
}

/** Scale one planned raster to its preview size, never below one pixel. */
export function scaledPreviewSize(
  width: number,
  height: number,
  maxAxis: number = DESIGNER_PREVIEW_MAX_AXIS,
): { width: number; height: number } {
  const factor = previewScaleFor(width, height, maxAxis);
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/**
 * Scale one core solve by an explicit presentation factor. The mapping itself
 * is unchanged: the solve homography maps normalized destination space to
 * reference pixels, so scaling its first two rows rescales only the pixel
 * frame. Visible geometry is identical at any preview resolution, and the
 * program that Apply publishes is still planned and rendered at full
 * resolution.
 */
export function scaleSolveByFactor(solve: PreviewSolveOutput, factor: number): PreviewSolveOutput {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return solve;
  const reference = solve.resolvedDestination.reference;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = solve.homography.matrix;
  return {
    resolvedDestination: {
      reference: {
        width: Math.max(1, Math.round(reference.width * factor)),
        height: Math.max(1, Math.round(reference.height * factor)),
      },
    },
    homography: {
      matrix: [
        m0 * factor, m1 * factor, m2 * factor,
        m3 * factor, m4 * factor, m5 * factor,
        m6, m7, m8,
      ],
    },
  };
}

/** Cap one core solve at the shared preview axis. */
export function scalePreviewSolve(
  solve: PreviewSolveOutput,
  maxAxis: number = DESIGNER_PREVIEW_MAX_AXIS,
): PreviewSolveOutput {
  const reference = solve.resolvedDestination.reference;
  return scaleSolveByFactor(solve, previewScaleFor(reference.width, reference.height, maxAxis));
}
