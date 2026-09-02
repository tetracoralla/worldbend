import type { Quad, Size } from "@worldbend/web";

export type OutputDensityPolicy = "fit" | "original";
export type OutputSizeChange = "same" | "larger" | "smaller" | "mixed";

export interface PixelSize {
  width: number;
  height: number;
}

export interface FigmaOutputPlan {
  source: PixelSize;
  requested: PixelSize;
  applied: PixelSize;
  scale: number;
  fitted: boolean;
  change: OutputSizeChange;
}

/**
 * Plan the raster density independently from the logical Figma placement.
 * A fitted result keeps the same normalized transform and document bounds;
 * only the pixels carried by the image resource are reduced proportionally.
 */
export function planFigmaOutput(
  source: Size,
  requested: Size,
  maximumAxis: number,
): FigmaOutputPlan {
  const sourceSize = checkedPixelSize(source);
  const requestedSize = checkedPixelSize(requested);
  if (!Number.isSafeInteger(maximumAxis) || maximumAxis < 1) {
    throw new Error("The Figma output limit is invalid");
  }
  const scale = Math.min(
    1,
    maximumAxis / requestedSize.width,
    maximumAxis / requestedSize.height,
  );
  const applied = {
    width: clampAxis(Math.round(requestedSize.width * scale), maximumAxis),
    height: clampAxis(Math.round(requestedSize.height * scale), maximumAxis),
  };
  return {
    source: sourceSize,
    requested: requestedSize,
    applied,
    scale,
    fitted: scale < 1,
    change: comparePixelSize(sourceSize, requestedSize),
  };
}

/** Tight pixel bounds for a normalized destination quad before core reframing. */
export function outputSizeForQuad(quad: Quad, reference: Size): PixelSize {
  const referenceSize = checkedPixelSize(reference);
  const points = [quad.tl, quad.tr, quad.br, quad.bl];
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error("The perspective output bounds are invalid");
  }
  const x = points.map((point) => point.x * referenceSize.width);
  const y = points.map((point) => point.y * referenceSize.height);
  return checkedPixelSize({
    width: Math.ceil(Math.max(...x)) - Math.floor(Math.min(...x)),
    height: Math.ceil(Math.max(...y)) - Math.floor(Math.min(...y)),
  });
}

export function canApplyOutput(
  plan: FigmaOutputPlan | undefined,
  policy: OutputDensityPolicy,
): boolean {
  return Boolean(plan) && (policy === "fit" || !plan!.fitted);
}

export function rasterSizeForPolicy(
  plan: FigmaOutputPlan,
  policy: OutputDensityPolicy,
): PixelSize {
  return policy === "fit" ? { ...plan.applied } : { ...plan.requested };
}

function checkedPixelSize(size: Size): PixelSize {
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error("The output image has invalid dimensions");
  }
  return { width, height };
}

function clampAxis(value: number, maximumAxis: number): number {
  return Math.min(maximumAxis, Math.max(1, value));
}

function comparePixelSize(source: PixelSize, requested: PixelSize): OutputSizeChange {
  const width = Math.sign(requested.width - source.width);
  const height = Math.sign(requested.height - source.height);
  if (width === 0 && height === 0) return "same";
  if (width >= 0 && height >= 0) return "larger";
  if (width <= 0 && height <= 0) return "smaller";
  return "mixed";
}
