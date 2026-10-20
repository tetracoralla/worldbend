import type { CanvasOperation } from "@worldbend/web";
import { normalizeCanvasOutputName } from "./canvas-output-name";
import { hasExactKeys, isRecord } from "./stored-plane";
import {
  MAX_FIGMA_CANVAS_AXIS,
  MAX_FIGMA_CANVAS_VARIANTS,
  type CanvasBackground,
} from "./canvas-state";

export const SHARED_CANVAS_KEY = "canvas";
export const CANVAS_OUTPUT_ID_KEY = "canvasOutputId";
export const CANVAS_OUTPUT_NAME_KEY = "canvasOutputName";
export function readCanvasOutputName(node: { name?: string; getSharedPluginData(namespace: string, key: string): string }): string | undefined {
  const raw = node.getSharedPluginData("worldbend", CANVAS_OUTPUT_NAME_KEY);
  const name = normalizeCanvasOutputName(raw);
  if (name === raw) return name;
  // Agent-created and older single Canvas works can already have a useful
  // native title without variant metadata. Keep that title when first adopted.
  if (!raw && !readCanvasOutputId(node)) return normalizeCanvasOutputName(node.name);
  return undefined;
}
export function readCanvasOutputId(node: { getSharedPluginData(namespace: string, key: string): string }): string | undefined {
  const id = node.getSharedPluginData("worldbend", CANVAS_OUTPUT_ID_KEY);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) ? id : undefined;
}

export type OwnedCanvasOperation = CanvasOperation;

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
  }
  return true;
}

export function singleCanvasSpec(operation: OwnedCanvasOperation): OwnedCanvasSpec {
  return { schema: "worldbend.canvas", version: "0.1", operation };
}

export function ownedCanvasOperationOutput(
  operation: OwnedCanvasOperation,
  source?: { width: number; height: number },
): { width: number; height: number } | undefined {
  if (operation.kind === "crop") return { width: operation.rect.width, height: operation.rect.height };
  if (operation.kind === "trim") return undefined;
  if (operation.kind === "pad") {
    return source
      ? {
          width: source.width + operation.insets.left + operation.insets.right,
          height: source.height + operation.insets.top + operation.insets.bottom,
        }
      : undefined;
  }
  return operation.output;
}

function isOwnedCanvasOperation(value: unknown): value is OwnedCanvasOperation {
  if (!isRecord(value) || typeof value["kind"] !== "string") return false;
  if (value["kind"] === "crop") {
    return hasExactKeys(value, ["kind", "rect"]) && isPixelRect(value["rect"]);
  }
  if (value["kind"] === "trim") {
    return (
      hasExactKeys(value, ["kind", "alphaThreshold"]) &&
      Number.isInteger(value["alphaThreshold"]) &&
      Number(value["alphaThreshold"]) >= 0 &&
      Number(value["alphaThreshold"]) <= 254
    );
  }
  if (value["kind"] === "pad") {
    return (
      hasExactKeys(value, ["kind", "insets", "background"]) &&
      isInsets(value["insets"]) &&
      isBackground(value["background"])
    );
  }
  if (value["kind"] === "contain" || value["kind"] === "cover") {
    return (
      hasExactKeys(value, ["kind", "output", "anchor", "background"]) &&
      isPixelSize(value["output"]) &&
      isAnchor(value["anchor"]) &&
      isBackground(value["background"])
    );
  }
  return (
    value["kind"] === "stretch" &&
    hasExactKeys(value, ["kind", "output"]) &&
    isPixelSize(value["output"])
  );
}

function isPixelRect(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["x", "y", "width", "height"]) &&
    isNonNegativeInteger(value["x"]) &&
    isNonNegativeInteger(value["y"]) &&
    isAxis(value["width"]) &&
    isAxis(value["height"]) &&
    Number(value["x"]) + Number(value["width"]) <= MAX_FIGMA_CANVAS_AXIS &&
    Number(value["y"]) + Number(value["height"]) <= MAX_FIGMA_CANVAS_AXIS
  );
}

function isInsets(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["top", "right", "bottom", "left"]) &&
    ["top", "right", "bottom", "left"].every((key) => isNonNegativeInteger(value[key]))
  );
}

function isPixelSize(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["width", "height"]) &&
    isAxis(value["width"]) &&
    isAxis(value["height"])
  );
}

function isAnchor(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["x", "y"]) &&
    [0, 0.5, 1].includes(Number(value["x"])) &&
    [0, 0.5, 1].includes(Number(value["y"]))
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

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_FIGMA_CANVAS_AXIS;
}

function isAxis(value: unknown): boolean {
  return isNonNegativeInteger(value) && value > 0;
}
