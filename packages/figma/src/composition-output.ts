import {
  buildWarpMesh, solveTransformPreview, planCanvasSet, planCanvasSetFromRgba,
  type CanvasRasterRenderer, type TransformWebGLRenderer,
  type PreviewSolveOutput, type WarpMesh, type CanvasSetPlan,
} from "@worldbend/web";
import type { FigmaCompositionTask } from "./stored-designer-task";

export interface CompositionOutputCache {
  solved?: PreviewSolveOutput;
  mesh?: WarpMesh | undefined;
  set?: CanvasSetPlan;
}

/** The same whole-work/selected-output path for authoring and linked updates. */
export async function renderCompositionOutput(
  task: Extract<FigmaCompositionTask, { kind: "composition" }>,
  composition: HTMLCanvasElement,
  whole: TransformWebGLRenderer,
  output: CanvasRasterRenderer,
  quality: "preview" | "high",
  cache?: CompositionOutputCache,
  isCurrent:()=>boolean=()=>true,
): Promise<HTMLCanvasElement> {
  const stage = task.template.operation.postprocess.stages[0];
  if (stage?.kind !== "transform" || !stage.target_size) throw new Error("Composition whole-result size is unavailable");
  const content = stage.spec.content;
  if (!content) throw new Error("Composition whole-result content is unavailable");
  const solved = cache?.solved ?? await solveTransformPreview(stage.spec, stage.target_size);
  const mesh = cache?.mesh ?? (content.warp ? await buildWarpMesh(content.warp) : undefined);
  if(!isCurrent())throw new DOMException("Composition rendering superseded","AbortError");
  if (cache) { cache.solved=solved; cache.mesh=mesh; }
  whole.invalidateSource();
  whole.render(composition, solved, mesh, quality);
  if (task.template.output.kind !== "canvasSet") return whole.canvas;
  const set = task.template.output.spec;
  const size = { width: whole.canvas.width, height: whole.canvas.height };
  const plan = cache?.set ?? (set.variants.some(item => item.operation.kind === "trim")
    ? await planCanvasSetFromRgba(set, size, canvasRgba(whole.canvas))
    : await planCanvasSet(set, size));
  if(!isCurrent())throw new DOMException("Composition rendering superseded","AbortError");
  if(cache)cache.set=plan;
  const variant = plan.variants.find(item => item.id === task.previewOutputId);
  if (!variant) throw new Error("Composition preview output is unavailable");
  output.render(whole.canvas, variant.plan, quality, quality === "preview" ? 1024 : Number.POSITIVE_INFINITY);
  return output.canvas;
}

function canvasRgba(source: HTMLCanvasElement): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is required to inspect Composition alpha");
  context.drawImage(source, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
