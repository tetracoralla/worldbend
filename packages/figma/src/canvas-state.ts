export const MAX_FIGMA_CANVAS_VARIANTS = 8;
export const MAX_FIGMA_CANVAS_AXIS = 4096;
export const MAX_FIGMA_CANVAS_PIXELS = 32 * 1024 * 1024;

export type CanvasOperationKind = "crop" | "trim" | "pad" | "contain" | "cover" | "stretch";
export type CanvasAnchor = 0 | 0.5 | 1;
export type CanvasRgba = [number, number, number, number];
export type CanvasBackground =
  | { kind: "transparent" }
  | { kind: "color"; space: "srgb8"; rgba: CanvasRgba };

export interface CanvasVariantDraft {
  id: string;
  kind: CanvasOperationKind;
  width: number;
  height: number;
  crop: { x: number; y: number; width: number; height: number };
  trimThreshold: number;
  insets: { top: number; right: number; bottom: number; left: number };
  anchor: { x: CanvasAnchor; y: CanvasAnchor };
  background: CanvasBackground;
}

export interface CanvasDraft {
  source: { width: number; height: number };
  variants: CanvasVariantDraft[];
  activeId: string;
}

export type CanvasDraftIssue =
  | "source"
  | "variant-count"
  | "variant-id"
  | "duplicate-id"
  | "operation"
  | "axis-limit"
  | "pixel-limit"
  | "crop-bounds"
  | "trim-threshold"
  | "insets"
  | "background";

export function createCanvasDraft(width: number, height: number): CanvasDraft {
  const source = { width: clampAxis(width), height: clampAxis(height) };
  const variant = createCanvasVariant("output-1", source.width, source.height);
  return { source, variants: [variant], activeId: variant.id };
}

export function createCanvasVariant(
  id: string,
  width: number,
  height: number,
): CanvasVariantDraft {
  const safeWidth = clampAxis(width);
  const safeHeight = clampAxis(height);
  return {
    id,
    kind: "contain",
    width: safeWidth,
    height: safeHeight,
    crop: { x: 0, y: 0, width: safeWidth, height: safeHeight },
    trimThreshold: 0,
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    anchor: { x: 0.5, y: 0.5 },
    background: { kind: "transparent" },
  };
}

export function cloneCanvasDraft(draft: CanvasDraft): CanvasDraft {
  return {
    source: { ...draft.source },
    activeId: draft.activeId,
    variants: draft.variants.map((variant) => ({
      ...variant,
      crop: { ...variant.crop },
      insets: { ...variant.insets },
      anchor: { ...variant.anchor },
      background: cloneBackground(variant.background),
    })),
  };
}

export function addCanvasVariant(draft: CanvasDraft): CanvasDraft {
  if (draft.variants.length >= MAX_FIGMA_CANVAS_VARIANTS) return draft;
  const source = activeCanvasVariant(draft) ?? draft.variants[0];
  if (!source) return draft;
  const id = nextVariantId(draft.variants);
  const next = cloneCanvasDraft(draft);
  next.variants.push({
    ...source,
    id,
    crop: { ...source.crop },
    insets: { ...source.insets },
    anchor: { ...source.anchor },
    background: cloneBackground(source.background),
  });
  next.activeId = id;
  return next;
}

export function removeCanvasVariant(draft: CanvasDraft, id: string): CanvasDraft {
  if (draft.variants.length <= 1 || !draft.variants.some((variant) => variant.id === id)) {
    return draft;
  }
  const removedIndex = draft.variants.findIndex((variant) => variant.id === id);
  const next = cloneCanvasDraft(draft);
  next.variants = next.variants.filter((variant) => variant.id !== id);
  if (next.activeId === id) {
    next.activeId = next.variants[Math.min(removedIndex, next.variants.length - 1)]?.id ?? "";
  }
  return next;
}

export function renameCanvasVariant(draft: CanvasDraft, id: string, nextId: string): CanvasDraft {
  if (
    id === nextId ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(nextId) ||
    draft.variants.some((variant) => variant.id === nextId)
  ) {
    return draft;
  }
  const next = cloneCanvasDraft(draft);
  const variant = next.variants.find((candidate) => candidate.id === id);
  if (!variant) return draft;
  variant.id = nextId;
  if (next.activeId === id) next.activeId = nextId;
  return next;
}

export function updateCanvasVariant(
  draft: CanvasDraft,
  id: string,
  patch: Partial<Omit<CanvasVariantDraft, "id">>,
): CanvasDraft {
  if (!draft.variants.some((variant) => variant.id === id)) return draft;
  const next = cloneCanvasDraft(draft);
  next.variants = next.variants.map((variant) =>
    variant.id === id
      ? {
          ...variant,
          ...patch,
          ...(patch.crop ? { crop: { ...patch.crop } } : {}),
          ...(patch.insets ? { insets: { ...patch.insets } } : {}),
          ...(patch.anchor ? { anchor: { ...patch.anchor } } : {}),
          ...(patch.background ? { background: cloneBackground(patch.background) } : {}),
        }
      : variant,
  );
  return next;
}

export function selectCanvasVariant(draft: CanvasDraft, id: string): CanvasDraft {
  if (draft.activeId === id || !draft.variants.some((variant) => variant.id === id)) return draft;
  return { ...draft, activeId: id };
}

export function activeCanvasVariant(draft: CanvasDraft): CanvasVariantDraft | undefined {
  return draft.variants.find((variant) => variant.id === draft.activeId);
}

export function canvasVariantOutputSize(
  draft: Pick<CanvasDraft, "source">,
  variant: CanvasVariantDraft,
): { width: number; height: number } {
  if (variant.kind === "crop") return { width: variant.crop.width, height: variant.crop.height };
  if (variant.kind === "trim") return { ...draft.source };
  if (variant.kind === "pad") {
    return {
      width: draft.source.width + variant.insets.left + variant.insets.right,
      height: draft.source.height + variant.insets.top + variant.insets.bottom,
    };
  }
  return { width: variant.width, height: variant.height };
}

export function validateCanvasDraft(draft: CanvasDraft): CanvasDraftIssue | undefined {
  if (!isAxis(draft.source.width) || !isAxis(draft.source.height)) return "source";
  if (draft.variants.length < 1 || draft.variants.length > MAX_FIGMA_CANVAS_VARIANTS) {
    return "variant-count";
  }
  const ids = new Set<string>();
  let pixels = 0;
  for (const variant of draft.variants) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(variant.id)) return "variant-id";
    if (ids.has(variant.id)) return "duplicate-id";
    ids.add(variant.id);
    if (!isOperation(variant.kind)) return "operation";
    if (variant.kind === "crop") {
      const { x, y, width, height } = variant.crop;
      if (
        ![x, y, width, height].every(Number.isSafeInteger) ||
        x < 0 ||
        y < 0 ||
        width < 1 ||
        height < 1 ||
        x + width > draft.source.width ||
        y + height > draft.source.height
      ) {
        return "crop-bounds";
      }
    }
    if (
      variant.kind === "trim" &&
      (!Number.isInteger(variant.trimThreshold) ||
        variant.trimThreshold < 0 ||
        variant.trimThreshold > 254)
    ) {
      return "trim-threshold";
    }
    if (variant.kind === "pad" && !Object.values(variant.insets).every(isInset)) return "insets";
    if (
      ["contain", "cover", "stretch"].includes(variant.kind) &&
      (!isAxis(variant.width) || !isAxis(variant.height))
    ) {
      return "axis-limit";
    }
    if (
      ["pad", "contain", "cover"].includes(variant.kind) &&
      !isBackground(variant.background)
    ) {
      return "background";
    }
    const output = canvasVariantOutputSize(draft, variant);
    if (!isAxis(output.width) || !isAxis(output.height)) return "axis-limit";
    pixels += output.width * output.height;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_FIGMA_CANVAS_PIXELS) return "pixel-limit";
  }
  return ids.has(draft.activeId) ? undefined : "variant-id";
}

function cloneBackground(background: CanvasBackground): CanvasBackground {
  return background.kind === "transparent"
    ? { kind: "transparent" }
    : { ...background, rgba: [...background.rgba] as CanvasRgba };
}

function isBackground(background: CanvasBackground): boolean {
  return (
    background.kind === "transparent" ||
    (background.space === "srgb8" &&
      background.rgba.length === 4 &&
      background.rgba.every((value) => Number.isInteger(value) && value >= 0 && value <= 255))
  );
}

function isOperation(value: string): value is CanvasOperationKind {
  return ["crop", "trim", "pad", "contain", "cover", "stretch"].includes(value);
}

function isInset(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_FIGMA_CANVAS_AXIS;
}

function isAxis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FIGMA_CANVAS_AXIS;
}

/** Finite number ready for a live Sizes preview; empty or mid-edit text stays quiet. */
export function parseCanvasNumericPreview(text: string): number | undefined {
  if (text.trim().length === 0) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function clampAxis(value: number): number {
  return Math.min(MAX_FIGMA_CANVAS_AXIS, Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
}

function nextVariantId(variants: readonly CanvasVariantDraft[]): string {
  const ids = new Set(variants.map((variant) => variant.id));
  for (let index = 1; index <= MAX_FIGMA_CANVAS_VARIANTS + 1; index += 1) {
    const id = `output-${index}`;
    if (!ids.has(id)) return id;
  }
  return `output-${variants.length + 1}`;
}
