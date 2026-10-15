import {
  TransformWebGLRenderer,
  CanvasRasterRenderer,
  buildWarpMesh,
  buildMockupPlaneMesh, paintMockupShadow,
  solveTransform,
  estimateSourceRasterSize,
  planCanvasSet,
  type DeformationWorkSpecInput,
  type MeshWarpSpecInput,
  type MockupSpecInput,
  type Size,
  type SurfaceDeformationSpecInput,
  type TransformSpec,
} from "@worldbend/web";
import { planDeformationWork, planMockup } from "./designer-plan";
import {
  deformationWorkFromMesh,
  deformationWorkFromSurface,
} from "./deformation-work-state";
import { parseOwnedTransformSpec } from "./stored-plane";
import { compositionMockup, parseStoredDesignerTask, type FigmaCompositionTask, type FigmaDeformationTask } from "./stored-designer-task";
import { renderCompositionOutput } from "./composition-output";
import type { LinkedBatchItem } from "./messages";
import { parseOwnedCanvasSpec, type OwnedCanvasSpec } from "./stored-canvas";
import { scaleSolveToRasterSize } from "./designer-preview";

export type ParsedBatchOperation =
  | { kind: "transform"; spec: TransformSpec }
  | { kind: "canvas"; spec: OwnedCanvasSpec }
  | { kind: "mesh"; spec: MeshWarpSpecInput }
  | { kind: "surface"; spec: SurfaceDeformationSpecInput }
  | FigmaDeformationTask
  /** Multi-source slice: one explicit Mockup task recomputed from every bound source. */
  | { kind: "mockup"; spec: MockupSpecInput }
  | { kind: "composition"; task: Extract<FigmaCompositionTask, { kind: "composition" }> };

export type BatchParse =
  | { status: "supported"; operation: ParsedBatchOperation }
  | { status: "unsupported"; kind: LinkedBatchItem["kind"] }
  | { status: "invalid" };

/** Parses one item's stored operation, or reports why it cannot participate. */
export function parseBatchOperation(item: LinkedBatchItem): BatchParse {
  if (item.kind === "invalid") return { status: "invalid" };
  if (item.updatable === false) return { status: "unsupported", kind: item.kind };
  // The item's kind is the stored operation's own family; families outside
  // this slice are reported without touching their stored JSON.
  if (item.kind !== "transform" && item.kind !== "mesh" && item.kind !== "surface" &&
    item.kind !== "deformation" && item.kind !== "mockup" && item.kind !== "composition" && item.kind !== "canvas") {
    return { status: "unsupported", kind: item.kind };
  }
  if (item.kind === "transform") {
    if (item.operationKind !== "transform") return { status: "invalid" };
    const spec = parseOwnedTransformSpec(item.operationJson);
    return spec ? { status: "supported", operation: { kind: "transform", spec } } : { status: "invalid" };
  }
  if (item.kind === "canvas") {
    if (item.operationKind !== "canvas" || item.sourceNodeIds?.length !== 1) return { status: "invalid" };
    const spec = parseOwnedCanvasSpec(item.operationJson);
    if (!spec) return { status: "invalid" };
    const operation = spec.operation;
    if (operation.kind !== "contain" && operation.kind !== "cover" && operation.kind !== "stretch") return { status: "unsupported", kind: item.kind };
    if (operation.output.width !== item.width || operation.output.height !== item.height) return { status: "invalid" };
    return { status: "supported", operation: { kind: "canvas", spec } };
  }
  if (item.operationKind !== "task") return { status: "invalid" };
  const task = parseStoredDesignerTask(item.operationJson);
  if (!task || task.kind !== item.kind) return { status: "invalid" };
  if (task.kind === "composition") {
    if (!hasCompleteBindings(item, compositionMockup(task))) return { status: "invalid" };
    return { status: "supported", operation: { kind: "composition", task } };
  }
  if (task.kind === "deformation") {
    const ids=item.sourceNodeIds;
    if (task.shapeGuideSourceIndex !== undefined && (!ids || ids.length!==2 || new Set(ids).size!==2)) return {status:"invalid"};
    if (task.shapeGuideSourceIndex === undefined && ids && ids.length!==1) return {status:"invalid"};
    return {status:"supported",operation:task};
  }
  if (task.kind === "mesh") {
    return { status: "supported", operation: { kind: "mesh", spec: task.spec } };
  }
  if (task.kind === "surface") {
    return { status: "supported", operation: { kind: "surface", spec: task.spec } };
  }
  if (task.kind === "mockup") {
    // The multi-source slice resolves the bound sources explicitly; a task
    // without its binding-order source ids cannot recompute deterministically.
    if (!hasCompleteBindings(item, task.spec)) return { status: "invalid" };
    return { status: "supported", operation: { kind: "mockup", spec: task.spec } };
  }
  return { status: "invalid" };
}

function hasCompleteBindings(item: LinkedBatchItem, spec: MockupSpecInput): boolean {
  const ids = item.sourceNodeIds ?? [];
  const slots = new Set(spec.planes.map(plane => plane.sourceId));
  return ids.length >= 2 && ids.length <= 8 && new Set(ids).size === ids.length &&
    slots.size === ids.length && ids.every((_id, index) => slots.has(`source-${index + 1}`));
}

/** The deformation work one parsed task updates through, with its reopen view. */
export function batchOperationWork(operation: ParsedBatchOperation): {
  work: DeformationWorkSpecInput;
  view: "pin" | "mesh";
} {
  switch (operation.kind) {
    case "deformation":
      return { work: operation.spec, view: operation.view };
    case "mesh":
      return { work: deformationWorkFromMesh(operation.spec), view: "mesh" };
    case "surface":
      return { work: deformationWorkFromSurface(operation.spec), view: "pin" };
    case "transform":
    case "canvas":
      throw new Error("A plane result does not carry a deformation work");
    case "mockup":
    case "composition":
      throw new Error("A Composition result recomputes through its bound sources, not one plane");
  }
}

export interface BatchRenderer {
  render(item: ParsedBatchOperation, image: HTMLImageElement, size: Size,
    captureSource?: (size: Size) => Promise<HTMLImageElement>): Promise<Uint8Array>;
  /** Recompute one multi-source Mockup task from its bound source rasters. */
  renderMockup(spec: MockupSpecInput, sources: ReadonlyMap<string, TexImageSource>): Promise<Uint8Array>;
  renderComposition(task: Extract<FigmaCompositionTask, { kind: "composition" }>, sources: MockupBatchSources): Promise<Uint8Array>;
  dispose(): void;
}

/** Plane sourceId (`source-N`) to its current raster for one mockup item. */
export type MockupBatchSources = ReadonlyMap<string, TexImageSource>;

export function createBatchRenderer(): BatchRenderer {
  let whole: TransformWebGLRenderer | undefined;
  let output: CanvasRasterRenderer | undefined;
  let renderer: TransformWebGLRenderer | undefined;
  renderer = new TransformWebGLRenderer(undefined, {
    preserveDrawingBuffer: true,
    onContextLost: () => {
      renderer?.dispose();
      renderer = undefined;
    },
  });
  const activeRenderer = () => (renderer ??= new TransformWebGLRenderer(undefined, {
    preserveDrawingBuffer: true,
    onContextLost: () => {
      renderer?.dispose();
      renderer = undefined;
    },
  }));
  const batch: BatchRenderer = {
    async render(item, image, size, captureSource) {
      if (item.kind === "canvas") {
        const sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
        const plan = await planCanvasSet({ schema: "worldbend.canvas-set", version: "0.1",
          variants: [{ id: "output", operation: item.spec.operation }] }, sourceSize);
        const variant = plan.variants[0]?.plan;
        if (!variant || variant.outputSize.width !== size.width || variant.outputSize.height !== size.height) throw new Error("Canvas output changed");
        output ??= new CanvasRasterRenderer(document.createElement("canvas"));
        output.render(image, variant, "high");
        return encodeCanvas(output.canvas);
      }
      const active = activeRenderer();
      if (item.kind === "transform") {
        const solved = await solveTransform(item.spec, size);
        const warpMesh = item.spec.content.warp?.amount
          ? await buildWarpMesh(item.spec.content.warp)
          : undefined;
        const desired = estimateSourceRasterSize(solved, item.spec, 4096, warpMesh);
        const pixels = captureSource && (image.naturalWidth < desired.width || image.naturalHeight < desired.height)
          ? await captureSource(desired) : image;
        active.render(pixels, solved, warpMesh, "high");
      } else {
        const { work } = batchOperationWork(item);
        const plan = await planDeformationWork(work);
        const solve = scaleSolveToRasterSize(plan.meshWarp.solve, size);
        const desired = estimateSourceRasterSize(solve, plan.meshWarp.spec.transform, 4096, plan.meshWarp.spec.mesh);
        const pixels = captureSource && (image.naturalWidth < desired.width || image.naturalHeight < desired.height)
          ? await captureSource(desired) : image;
        active.render(pixels, solve, plan.meshWarp.spec.mesh, "high", plan.clip ?? undefined);
      }
      const blob = await new Promise<Blob>((resolve, reject) => {
        active.canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("Unable to encode the batch result"))),
          "image/png",
        );
      });
      return new Uint8Array(await blob.arrayBuffer());
    },
    async renderMockup(spec, sources) {
      return encodeCanvas(await renderMockupCanvas(spec, sources));
    },
    async renderComposition(task, sources) {
      const canvas = await renderMockupCanvas(compositionMockup(task), sources);
      whole ??= new TransformWebGLRenderer(undefined, { preserveDrawingBuffer: true });
      output ??= new CanvasRasterRenderer(document.createElement("canvas"));
      return encodeCanvas(await renderCompositionOutput(task, canvas, whole, output, "high"));
    },
    dispose() {
      renderer?.dispose(); renderer = undefined;
      whole?.dispose(); whole = undefined;
      output?.dispose(); output = undefined;
    },
  };
  return batch;

  async function renderMockupCanvas(spec: MockupSpecInput, sources: MockupBatchSources): Promise<HTMLCanvasElement> {
      const plan = await planMockup(spec);
      const canvas = document.createElement("canvas");
      canvas.width = plan.canvas.width;
      canvas.height = plan.canvas.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D is required to recompute a Composition result");
      if (plan.background.kind === "color") {
        const [r, g, b, a] = plan.background.rgba;
        context.fillStyle = `rgba(${r} ${g} ${b} / ${a / 255})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const active = activeRenderer(),shadowMask=document.createElement("canvas");
      for (const plane of plan.planes) {
        const image = sources.get(plane.sourceId);
        if (!image) throw new Error(`Missing bound source ${plane.sourceId}`);
        const mesh = await buildMockupPlaneMesh(plane);
        if(plane.shadow&&plane.shadow.shadow.opacity>0&&plane.opacity>0){active.render(image,plane.shadow.solve,mesh,"high");paintMockupShadow(context,active.canvas,plane.shadow,plane.opacity,1,shadowMask)}
        active.render(image, plane.solve, mesh, "high");
        const layer = document.createElement("canvas");
        layer.width = active.canvas.width;
        layer.height = active.canvas.height;
        const layerContext = layer.getContext("2d");
        if (!layerContext) throw new Error("Canvas 2D is required to recompute a Composition result");
        layerContext.drawImage(active.canvas, 0, 0);
        context.save();
        context.globalAlpha = plane.opacity;
        context.drawImage(
          layer,
          0,
          0,
          plane.solve.resolvedDestination.reference.width,
          plane.solve.resolvedDestination.reference.height,
        );
        context.restore();
      }
      if (spec.clip) {
        const path = new Path2D();
        for (const contour of spec.clip.contours) {
          path.moveTo(contour.start.x * canvas.width, contour.start.y * canvas.height);
          for (const segment of contour.segments) {
            if (segment.kind === "line") {
              path.lineTo(segment.to.x * canvas.width, segment.to.y * canvas.height);
            } else {
              path.bezierCurveTo(
                segment.c1.x * canvas.width, segment.c1.y * canvas.height,
                segment.c2.x * canvas.width, segment.c2.y * canvas.height,
                segment.to.x * canvas.width, segment.to.y * canvas.height,
              );
            }
          }
          path.closePath();
        }
        context.save();
        context.globalCompositeOperation = "destination-in";
        context.fillStyle = "#000";
        context.fill(path, spec.clip.fillRule === "evenOdd" ? "evenodd" : "nonzero");
        context.restore();
      }
      return canvas;
  }
}

async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unable to encode the batch result")), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}
