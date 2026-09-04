import type { CanvasSetPlan } from "@worldbend/web";
import {
  canvasVariantOutputSize,
  createCanvasDraft,
  type CanvasAnchor,
  type CanvasBackground,
  type CanvasDraft,
  type CanvasVariantDraft,
} from "./canvas-state";
import type { SourcePayload } from "./messages";
import type { OwnedCanvasOperation, OwnedCanvasSetSpec } from "./stored-canvas";
import type { CanvasWorkspaceCopy, CanvasWorkspaceView } from "./canvas-workspace-view";
import { RESULT_PLACEMENT_GAP } from "./result-placement";

export type CanvasWorkspacePhase = "idle" | "planning" | "ready" | "applying" | "applied";

export function canvasPrimaryActionLabel(
  copy: Pick<CanvasWorkspaceCopy, "apply" | "applyVariants" | "applying" | "replace">,
  state: { phase: CanvasWorkspacePhase; replacing: boolean; variantCount: number },
): string {
  if (state.phase === "applying") return copy.applying;
  if (state.replacing) return copy.replace;
  return state.variantCount > 1 ? copy.applyVariants : copy.apply;
}

export function canvasResultPlacements(
  base: SourcePayload["placement"],
  sizes: readonly { width: number; height: number }[],
  replacing: boolean,
): SourcePayload["placement"][] {
  if (replacing && sizes.length === 1) {
    return [{ x: base.x, y: base.y, width: sizes[0]!.width, height: sizes[0]!.height }];
  }
  let x = base.x + base.width + RESULT_PLACEMENT_GAP;
  return sizes.map((size) => {
    const placement = { x, y: base.y, width: size.width, height: size.height };
    x += size.width + RESULT_PLACEMENT_GAP;
    return placement;
  });
}

export function specFromDraft(draft: CanvasDraft): OwnedCanvasSetSpec {
  return {
    schema: "worldbend.canvas-set",
    version: "0.1",
    variants: draft.variants.map((variant) => ({
      id: variant.id,
      operation: operationFromVariant(variant),
    })),
  };
}

export function draftFromStoredCanvas(
  operation: OwnedCanvasOperation,
  sourceWidth: number,
  sourceHeight: number,
): CanvasDraft {
  const draft = createCanvasDraft(sourceWidth, sourceHeight);
  const variant = draft.variants[0]!;
  variant.kind = operation.kind;
  if (operation.kind === "crop") variant.crop = { ...operation.rect };
  if (operation.kind === "trim") variant.trimThreshold = operation.alphaThreshold;
  if (operation.kind === "pad") {
    variant.insets = { ...operation.insets };
    variant.background = cloneBackground(operation.background);
  }
  if (operation.kind === "contain" || operation.kind === "cover") {
    variant.width = operation.output.width;
    variant.height = operation.output.height;
    variant.anchor = {
      x: operation.anchor.x as CanvasAnchor,
      y: operation.anchor.y as CanvasAnchor,
    };
    variant.background = cloneBackground(operation.background);
  }
  if (operation.kind === "stretch") {
    variant.width = operation.output.width;
    variant.height = operation.output.height;
  }
  return draft;
}

export function draftFromStoredCanvasSet(
  spec: OwnedCanvasSetSpec,
  sourceWidth: number,
  sourceHeight: number,
): CanvasDraft {
  const variants = spec.variants.map((stored) => {
    const restored = draftFromStoredCanvas(
      stored.operation,
      sourceWidth,
      sourceHeight,
    ).variants[0]!;
    return { ...restored, id: stored.id };
  });
  return {
    source: { width: sourceWidth, height: sourceHeight },
    variants,
    activeId: variants[0]?.id ?? "",
  };
}

export function renderVariantTabs(
  view: CanvasWorkspaceView,
  draft: CanvasDraft | undefined,
  plan: CanvasSetPlan | undefined,
  select: (id: string) => void,
): void {
  view.variants.replaceChildren();
  const variants = draft?.variants ?? [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]!;
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.id = `canvas-variant-tab-${variant.id}`;
    button.dataset.variantId = variant.id;
    const active = variant.id === draft?.activeId;
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", "canvas-preview");
    button.tabIndex = active ? 0 : -1;
    const planned = plan?.variants.find((candidate) => candidate.id === variant.id)?.plan.outputSize;
    const output = planned ?? (draft
      ? canvasVariantOutputSize(draft, variant)
      : { width: 0, height: 0 });
    button.textContent = `${variant.id} · ${output.width} × ${output.height}`;
    button.addEventListener("click", () => select(variant.id));
    button.addEventListener("keydown", (event) => {
      const targetIndex = variantTabTargetIndex(event.key, index, variants.length);
      if (targetIndex === undefined) return;
      event.preventDefault();
      const next = variants[targetIndex];
      if (!next) return;
      select(next.id);
      queueMicrotask(() => {
        view.variants
          .querySelector<HTMLButtonElement>(`[data-variant-id="${next.id}"]`)
          ?.focus();
      });
    });
    view.variants.append(button);
    if (active) view.preview.setAttribute("aria-labelledby", button.id);
  }
}

export function variantTabTargetIndex(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  return undefined;
}

export function inspectorControls(
  view: CanvasWorkspaceView,
): Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> {
  return [
    view.variantId,
    view.operation,
    view.width,
    view.height,
    view.cropX,
    view.cropY,
    view.cropWidth,
    view.cropHeight,
    view.trimThreshold,
    view.padTop,
    view.padRight,
    view.padBottom,
    view.padLeft,
    view.background,
    view.backgroundColor,
    ...view.anchorGrid.querySelectorAll<HTMLButtonElement>("button"),
  ];
}

export function renderAnchors(
  view: CanvasWorkspaceView,
  selected: { x: CanvasAnchor; y: CanvasAnchor },
  copy: CanvasWorkspaceCopy,
  choose: (anchor: { x: CanvasAnchor; y: CanvasAnchor }) => void,
): void {
  view.anchorGrid.replaceChildren();
  const values: CanvasAnchor[] = [0, 0.5, 1];
  let index = 0;
  for (const y of values) {
    for (const x of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", copy.anchors[index++] ?? copy.anchor);
      button.setAttribute("aria-pressed", String(x === selected.x && y === selected.y));
      button.addEventListener("click", () => choose({ x, y }));
      view.anchorGrid.append(button);
    }
  }
}

export function imageRgba(image: HTMLImageElement): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D is required to inspect source alpha");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}

export function cloneBackground(background: CanvasBackground): CanvasBackground {
  return background.kind === "transparent"
    ? { kind: "transparent" }
    : {
        ...background,
        rgba: [...background.rgba] as [number, number, number, number],
      };
}

export function hexToRgba(value: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return [255, 255, 255, 255];
  const packed = Number.parseInt(match[1]!, 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 255];
}

export function rgbaToHex(rgba: readonly number[]): string {
  return `#${rgba
    .slice(0, 3)
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("")}`;
}

function operationFromVariant(variant: CanvasVariantDraft): OwnedCanvasOperation {
  if (variant.kind === "crop") return { kind: "crop", rect: { ...variant.crop } };
  if (variant.kind === "trim") {
    return { kind: "trim", alphaThreshold: variant.trimThreshold };
  }
  if (variant.kind === "pad") {
    return {
      kind: "pad",
      insets: { ...variant.insets },
      background: cloneBackground(variant.background),
    };
  }
  if (variant.kind === "stretch") {
    return { kind: "stretch", output: { width: variant.width, height: variant.height } };
  }
  return {
    kind: variant.kind,
    output: { width: variant.width, height: variant.height },
    anchor: { ...variant.anchor },
    background: cloneBackground(variant.background),
  };
}
