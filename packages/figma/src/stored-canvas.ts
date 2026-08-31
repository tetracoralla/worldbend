import {
  MAX_FIGMA_CANVAS_AXIS,
  MAX_FIGMA_CANVAS_PIXELS,
  MAX_FIGMA_CANVAS_VARIANTS,
  type CanvasAnchor,
  type CanvasBackground,
  type CanvasFit,
} from "./canvas-state";

export const SHARED_CANVAS_KEY = "canvas";

export interface OwnedCanvasOperation {
  kind: CanvasFit;
  output: { width: number; height: number };
  anchor: { x: CanvasAnchor; y: CanvasAnchor };
  background: CanvasBackground;
}

export interface OwnedCanvasSpec {
  schema: "worldbend.canvas";
  version: "0.1";
  operation: OwnedCanvasOperation;
}

export interface OwnedCanvasSetSpec {
  schema: "worldbend.canvas-set";
  version: "0.1";
  variants: Array<{ id: string; operation: OwnedCanvasOperation }>;
}

export function parseOwnedCanvasSpec(value: string): OwnedCanvasSpec | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isOwnedCanvasSpec(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function isOwnedCanvasSpec(value: unknown): value is OwnedCanvasSpec {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["schema", "version", "operation"]) &&
    value["schema"] === "worldbend.canvas" &&
    value["version"] === "0.1" &&
    isOwnedCanvasOperation(value["operation"])
  );
}

export function isOwnedCanvasSetSpec(value: unknown): value is OwnedCanvasSetSpec {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema", "version", "variants"]) ||
    value["schema"] !== "worldbend.canvas-set" ||
    value["version"] !== "0.1" ||
    !Array.isArray(value["variants"]) ||
    value["variants"].length < 1 ||
    value["variants"].length > MAX_FIGMA_CANVAS_VARIANTS
  ) {
    return false;
  }
  const ids = new Set<string>();
  let pixels = 0;
  for (const variant of value["variants"]) {
    if (
      !isRecord(variant) ||
      !hasExactKeys(variant, ["id", "operation"]) ||
      typeof variant["id"] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(variant["id"]) ||
      ids.has(variant["id"]) ||
      !isOwnedCanvasOperation(variant["operation"])
    ) {
      return false;
    }
    ids.add(variant["id"]);
    pixels += variant["operation"].output.width * variant["operation"].output.height;
    if (!Number.isSafeInteger(pixels) || pixels > MAX_FIGMA_CANVAS_PIXELS) return false;
  }
  return true;
}

export function singleCanvasSpec(operation: OwnedCanvasOperation): OwnedCanvasSpec {
  return { schema: "worldbend.canvas", version: "0.1", operation };
}

function isOwnedCanvasOperation(value: unknown): value is OwnedCanvasOperation {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "output", "anchor", "background"]) ||
    (value["kind"] !== "contain" && value["kind"] !== "cover")
  ) {
    return false;
  }
  const output = value["output"];
  const anchor = value["anchor"];
  return (
    isRecord(output) &&
    hasExactKeys(output, ["width", "height"]) &&
    isAxis(output["width"]) &&
    isAxis(output["height"]) &&
    isRecord(anchor) &&
    hasExactKeys(anchor, ["x", "y"]) &&
    isAnchor(anchor["x"]) &&
    isAnchor(anchor["y"]) &&
    isBackground(value["background"])
  );
}

function isBackground(value: unknown): value is CanvasBackground {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  if (value["kind"] === "transparent") return hasExactKeys(value, ["kind"]);
  return (
    value["kind"] === "color" &&
    hasExactKeys(value, ["kind", "space", "rgba"]) &&
    value["space"] === "srgb8" &&
    Array.isArray(value["rgba"]) &&
    value["rgba"].length === 4 &&
    value["rgba"].every(
      (component) => Number.isInteger(component) && component >= 0 && component <= 255,
    )
  );
}

function isAnchor(value: unknown): value is CanvasAnchor {
  return value === 0 || value === 0.5 || value === 1;
}

function isAxis(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_FIGMA_CANVAS_AXIS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
