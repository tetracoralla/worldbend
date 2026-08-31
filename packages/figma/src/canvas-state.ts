export const MAX_FIGMA_CANVAS_VARIANTS = 8;
export const MAX_FIGMA_CANVAS_AXIS = 4096;
export const MAX_FIGMA_CANVAS_PIXELS = 32 * 1024 * 1024;

export type CanvasFit = "contain" | "cover";
export type CanvasAnchor = 0 | 0.5 | 1;
export type CanvasRgba = [number, number, number, number];
export type CanvasBackground =
  | { kind: "transparent" }
  | { kind: "color"; space: "srgb8"; rgba: CanvasRgba };

export interface CanvasVariantDraft {
  id: string;
  width: number;
  height: number;
  fit: CanvasFit;
  anchor: { x: CanvasAnchor; y: CanvasAnchor };
  background: CanvasBackground;
}

export interface CanvasDraft {
  variants: CanvasVariantDraft[];
  activeId: string;
}

export type CanvasDraftIssue =
  | "variant-count"
  | "variant-id"
  | "duplicate-id"
  | "axis-limit"
  | "pixel-limit"
  | "background";

export function createCanvasDraft(width: number, height: number): CanvasDraft {
  const variant = createCanvasVariant("output-1", width, height);
  return { variants: [variant], activeId: variant.id };
}

export function createCanvasVariant(
  id: string,
  width: number,
  height: number,
): CanvasVariantDraft {
  return {
    id,
    width: clampAxis(width),
    height: clampAxis(height),
    fit: "contain",
    anchor: { x: 0.5, y: 0.5 },
    background: { kind: "transparent" },
  };
}

export function cloneCanvasDraft(draft: CanvasDraft): CanvasDraft {
  return {
    activeId: draft.activeId,
    variants: draft.variants.map((variant) => ({
      ...variant,
      anchor: { ...variant.anchor },
      background:
        variant.background.kind === "transparent"
          ? { kind: "transparent" }
          : { ...variant.background, rgba: [...variant.background.rgba] as CanvasRgba },
    })),
  };
}

export function addCanvasVariant(draft: CanvasDraft): CanvasDraft {
  if (draft.variants.length >= MAX_FIGMA_CANVAS_VARIANTS) return draft;
  const source = activeCanvasVariant(draft) ?? draft.variants[0];
  if (!source) return draft;
  const id = nextVariantId(draft.variants);
  const next = cloneCanvasDraft(draft);
  next.variants.push({ ...source, id, anchor: { ...source.anchor }, background: cloneBackground(source.background) });
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

export function validateCanvasDraft(draft: CanvasDraft): CanvasDraftIssue | undefined {
  if (draft.variants.length < 1 || draft.variants.length > MAX_FIGMA_CANVAS_VARIANTS) {
    return "variant-count";
  }
  const ids = new Set<string>();
  let pixels = 0;
  for (const variant of draft.variants) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(variant.id)) return "variant-id";
    if (ids.has(variant.id)) return "duplicate-id";
    ids.add(variant.id);
    if (!isAxis(variant.width) || !isAxis(variant.height)) return "axis-limit";
    pixels += variant.width * variant.height;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_FIGMA_CANVAS_PIXELS) return "pixel-limit";
    if (!isBackground(variant.background)) return "background";
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

function isAxis(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_FIGMA_CANVAS_AXIS;
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
