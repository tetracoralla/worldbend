import type { CanvasBackground, CanvasPlan } from "./canvas-types";

export type CanvasSamplingQuality = "preview" | "high";

/**
 * Browser raster executor for a core-resolved CanvasPlan. It deliberately
 * consumes source/output/placement rectangles verbatim and owns no fit math.
 */
export class CanvasRasterRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement = document.createElement("canvas")) {
    this.canvas = canvas;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas 2D is required for Canvas preview");
    this.context = context;
  }

  render(
    source: CanvasImageSource,
    plan: CanvasPlan,
    quality: CanvasSamplingQuality = "preview",
    maximumOutputAxis = Number.POSITIVE_INFINITY,
  ): void {
    this.assertAvailable();
    validatePlan(plan);
    const previewScale = Math.min(
      1,
      maximumOutputAxis / Math.max(plan.outputSize.width, plan.outputSize.height),
    );
    const width = Math.max(1, Math.round(plan.outputSize.width * previewScale));
    const height = Math.max(1, Math.round(plan.outputSize.height * previewScale));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    const context = this.context;
    context.save();
    try {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.clearRect(0, 0, width, height);
      fillBackground(context, plan.background, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = quality === "high" ? "high" : "medium";
      context.drawImage(
        source,
        plan.sourceRect.x,
        plan.sourceRect.y,
        plan.sourceRect.width,
        plan.sourceRect.height,
        plan.placement.x * previewScale,
        plan.placement.y * previewScale,
        plan.placement.width * previewScale,
        plan.placement.height * previewScale,
      );
    } finally {
      context.restore();
    }
  }

  exportPng(): Promise<Uint8Array> {
    this.assertAvailable();
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Unable to encode the Canvas result"));
          return;
        }
        void blob.arrayBuffer().then(
          (buffer) => resolve(new Uint8Array(buffer)),
          reject,
        );
      }, "image/png");
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.canvas.remove();
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("The Canvas renderer is no longer available");
  }
}

function fillBackground(
  context: CanvasRenderingContext2D,
  background: CanvasBackground | null | undefined,
  width: number,
  height: number,
): void {
  if (!background || background.kind === "transparent") return;
  const [red, green, blue, alpha] = background.rgba;
  context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
  context.fillRect(0, 0, width, height);
}

function validatePlan(plan: CanvasPlan): void {
  const integers = [
    plan.sourceSize.width,
    plan.sourceSize.height,
    plan.sourceRect.x,
    plan.sourceRect.y,
    plan.sourceRect.width,
    plan.sourceRect.height,
    plan.outputSize.width,
    plan.outputSize.height,
  ];
  const floats = [
    plan.placement.x,
    plan.placement.y,
    plan.placement.width,
    plan.placement.height,
    plan.scale.x,
    plan.scale.y,
  ];
  if (
    plan.schema !== "worldbend.canvas-plan" ||
    plan.version !== "0.1" ||
    !integers.every((value) => Number.isSafeInteger(value) && value >= 0) ||
    plan.sourceSize.width < 1 ||
    plan.sourceSize.height < 1 ||
    plan.sourceRect.width < 1 ||
    plan.sourceRect.height < 1 ||
    plan.sourceRect.x + plan.sourceRect.width > plan.sourceSize.width ||
    plan.sourceRect.y + plan.sourceRect.height > plan.sourceSize.height ||
    plan.outputSize.width < 1 ||
    plan.outputSize.height < 1 ||
    !floats.every(Number.isFinite) ||
    plan.placement.width <= 0 ||
    plan.placement.height <= 0 ||
    plan.scale.x <= 0 ||
    plan.scale.y <= 0
  ) {
    throw new Error("The core returned an invalid Canvas plan");
  }
}
