import { nativeVectorOperationDigest } from "./native-vector-operation";
import type { RasterCanvasChange } from "./raster-canvas-change";
import { estimateSourceRasterSize, type DeformationWorkPlanOutput, type Size } from "@worldbend/web";
import { scaleSolveToRasterSize } from "./designer-preview";
import { deformationArtworkSource, outputDocumentBox, type DesignerWorkspaceSource } from "./designer-workspace-common";
import { planDeformationWork, planMeshWarp, planSurfaceDeformation } from "./designer-plan";

export type CaptureDeformationRaster = (source: DesignerWorkspaceSource, size: Size) => Promise<HTMLImageElement>;

const RASTER_AXIS_LIMIT = 4096;

type PreviousDeformationPlan = Pick<DeformationWorkPlanOutput, "meshWarp" | "authoredView">;

async function previousDeformationPlan(source: DesignerWorkspaceSource): Promise<PreviousDeformationPlan | undefined> {
  const task = source.task;
  if (task?.kind === "deformation") return planDeformationWork(task.spec);
  if (task?.kind === "surface") return planSurfaceDeformation(task.spec);
  if (task?.kind === "mesh") return { meshWarp: await planMeshWarp(task.spec) };
  return undefined;
}

const canvasFrame = (value: PreviousDeformationPlan) => ({
  origin: value.authoredView?.canvasOrigin ?? { x: 0, y: 0 },
  reference: value.meshWarp.solve.resolvedDestination.reference,
});

const sameCanvasFrame = (from: ReturnType<typeof canvasFrame>, to: ReturnType<typeof canvasFrame>) =>
  from.origin.x === to.origin.x && from.origin.y === to.origin.y &&
  from.reference.width === to.reference.width && from.reference.height === to.reference.height;

export async function deformationCanvasChange(
  source: DesignerWorkspaceSource,
  plan: DeformationWorkPlanOutput,
  duplicate = false,
): Promise<RasterCanvasChange | undefined> {
  if (duplicate || !source.targetPlacement) return undefined;
  const previous = await previousDeformationPlan(source);
  if (!previous) return undefined;
  const from = canvasFrame(previous), to = canvasFrame(plan);
  return sameCanvasFrame(from, to) ? undefined : {
    from, to,
    workExpected: nativeVectorOperationDigest({ kind: "task", task: source.task! }),
  };
}

/** Preserve the authoring plane's page position when its complete canvas grows. */
export async function deformationPublicationPlacement(source: DesignerWorkspaceSource, plan: DeformationWorkPlanOutput, duplicate = false) {
  const artwork = deformationArtworkSource(source);
  if (!artwork) throw new Error("No source is loaded");
  const reference = plan.meshWarp.solve.resolvedDestination.reference;
  const previous = !duplicate && source.targetPlacement ? await previousDeformationPlan(source) : undefined;
  if (source.targetPlacement && previous) {
    const oldSize = previous.meshWarp.solve.resolvedDestination.reference;
    const oldOrigin = previous.authoredView?.canvasOrigin ?? { x: 0, y: 0 };
    const origin = plan.authoredView?.canvasOrigin ?? { x: 0, y: 0 };
    const scaleX = source.targetPlacement.width / oldSize.width;
    const scaleY = source.targetPlacement.height / oldSize.height;
    return { x: source.targetPlacement.x + (origin.x - oldOrigin.x) * scaleX,
      y: source.targetPlacement.y + (origin.y - oldOrigin.y) * scaleY,
      width: reference.width * scaleX, height: reference.height * scaleY };
  }
  return outputDocumentBox([artwork], reference.width, reference.height);
}

/** Publication pixels are independent of the saved work's coordinate frame.
 * The renderer clears an integer canvas, so the homography has to land on
 * that same frame. A stored size that already meets the density floor and
 * the axis ceiling is kept as published, including when its axes are not one
 * scale. Otherwise one uniform factor is rounded and then fitted down.
 * Only the pixel frame changes; the authored mesh stays normalized. */
export async function prepareDeformationRaster(
  source: DesignerWorkspaceSource,
  plan: DeformationWorkPlanOutput,
  capture: CaptureDeformationRaster,
): Promise<{ image: HTMLImageElement; solve: ReturnType<typeof scaleSolveToRasterSize>; size: Size }> {
  const artwork = deformationArtworkSource(source);
  if (!artwork) throw new Error("No source is loaded");
  const { size } = await planDeformationRaster(source, plan);
  const solve = scaleSolveToRasterSize(plan.meshWarp.solve, size);
  const desired = estimateSourceRasterSize(solve, plan.meshWarp.spec.transform, RASTER_AXIS_LIMIT, plan.meshWarp.spec.mesh);
  const image = artwork.image.naturalWidth >= desired.width && artwork.image.naturalHeight >= desired.height
    ? artwork.image : await capture(source, desired);
  return { image, solve, size };
}

/** Shared by all three views: the complete canvas, rather than the original
 * authoring rectangle, owns the publication pixels and density floor. */
export async function planDeformationRaster(source: DesignerWorkspaceSource, plan: DeformationWorkPlanOutput) {
  const placement = await deformationPublicationPlacement(source, plan);
  const reference = plan.meshWarp.solve.resolvedDestination.reference;
  const size = deformationPublicationSize(reference, placement, source.targetRasterSize);
  return { placement, size };
}

function deformationPublicationSize(
  reference: Size,
  placement: { width: number; height: number },
  retained: Size | undefined,
): Size {
  const longest = Math.max(reference.width, reference.height);
  const minimum = Math.max(1, 2 * placement.width / reference.width, 2 * placement.height / reference.height);
  const ceiling = RASTER_AXIS_LIMIT / longest;
  if (![minimum, ceiling, reference.width, reference.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Invalid deformation output size");
  }
  if (retained && retainedCoversPublication(retained, reference, minimum)) {
    return { width: retained.width, height: retained.height };
  }
  const factor = Math.min(Math.max(minimum, retainedDensity(reference, retained)), ceiling);
  let width = Math.max(1, Math.round(reference.width * factor));
  let height = Math.max(1, Math.round(reference.height * factor));
  const over = Math.max(width, height);
  if (over > RASTER_AXIS_LIMIT) {
    const fit = RASTER_AXIS_LIMIT / over;
    width = Math.max(1, Math.floor(width * fit));
    height = Math.max(1, Math.floor(height * fit));
  }
  return { width, height };
}

function retainedCoversPublication(retained: Size, reference: Size, minimum: number): boolean {
  const { width, height } = retained;
  return Number.isSafeInteger(width) && Number.isSafeInteger(height)
    && width >= 1 && width <= RASTER_AXIS_LIMIT
    && height >= 1 && height <= RASTER_AXIS_LIMIT
    && width >= reference.width * minimum - 1e-6
    && height >= reference.height * minimum - 1e-6;
}

function retainedDensity(reference: Size, retained: Size | undefined): number {
  if (!retained) return 0;
  const width = retained.width / reference.width;
  const height = retained.height / reference.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) return 0;
  return Math.max(width, height);
}
