import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";

export const SHARED_NAMESPACE = "worldbend";
export const SHARED_TRANSFORM_KEY = "transform";
export const SHARED_RECTIFY_KEY = "rectification";
export const RENDER_WIDTH_KEY = "worldbend.renderWidth";
export const RENDER_HEIGHT_KEY = "worldbend.renderHeight";
export const MAX_FIGMA_IMAGE_AXIS = 4096;

export function parseOwnedTransformSpec(value: string): TransformSpec | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isOwnedTransformSpec(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseOwnedRectifySpec(value: string): RectifySpecInput | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isOwnedRectifySpec(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Figma authors reusable source points only in normalized coordinates. */
export function isOwnedRectifySpec(value: unknown): value is RectifySpecInput {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "version", "source", "output"])) {
    return false;
  }
  if (value["schema"] !== "worldbend.rectify" || value["version"] !== "0.1") {
    return false;
  }
  const source = value["source"];
  if (
    !isRecord(source) ||
    !hasExactKeys(source, ["space", "quad"]) ||
    source["space"] !== "normalized"
  ) {
    return false;
  }
  const quad = source["quad"];
  if (
    !isRecord(quad) ||
    !hasExactKeys(quad, ["tl", "tr", "br", "bl"]) ||
    !["tl", "tr", "br", "bl"].every((corner) => isNormalizedPoint(quad[corner]))
  ) {
    return false;
  }
  const output = value["output"];
  return (
    isRecord(output) &&
    hasExactKeys(output, ["width", "height"]) &&
    isFigmaImageAxis(output["width"]) &&
    isFigmaImageAxis(output["height"])
  );
}

export function isOwnedTransformSpec(value: unknown): value is TransformSpec {
  if (!isRecord(value) || !hasExactKeys(value, ["schema", "version", "destination", "content"])) {
    return false;
  }
  if (value["schema"] !== "worldbend.transform" || value["version"] !== "0.1") {
    return false;
  }
  const content = value["content"];
  const expectedContentKeys = [
    "fit",
    ...(isSourceOrientation(content && isRecord(content) ? content["orientation"] : undefined)
      ? ["orientation"]
      : []),
    ...(content && isRecord(content) && content["warp"] !== undefined ? ["warp"] : []),
  ];
  if (
    !isRecord(content) ||
    !hasExactKeys(content, expectedContentKeys) ||
    content["fit"] !== "stretch" ||
    (content["orientation"] !== undefined && !isSourceOrientation(content["orientation"])) ||
    (content["warp"] !== undefined && !isWarpSpec(content["warp"]))
  ) {
    return false;
  }
  const destination = value["destination"];
  if (
    !isRecord(destination) ||
    !hasExactKeys(destination, ["space", "quad"]) ||
    destination["space"] !== "normalized"
  ) {
    return false;
  }
  const quad = destination["quad"];
  if (!isRecord(quad) || !hasExactKeys(quad, ["tl", "tr", "br", "bl"])) return false;
  return ["tl", "tr", "br", "bl"].every((corner) => isNormalizedPoint(quad[corner]));
}

const warpPresets = new Set([
  "arc",
  "arch",
  "flag",
  "wave",
  "fish",
  "rise",
  "fisheye",
  "inflate",
  "squeeze",
  "twist",
]);

function isWarpSpec(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["preset", "amount"])) return false;
  return (
    typeof value["preset"] === "string" &&
    warpPresets.has(value["preset"]) &&
    typeof value["amount"] === "number" &&
    Number.isFinite(value["amount"]) &&
    value["amount"] >= -1 &&
    value["amount"] <= 1
  );
}

function isSourceOrientation(value: unknown): boolean {
  return (
    value === "native" ||
    value === "flipHorizontal" ||
    value === "flipVertical" ||
    value === "flipBoth"
  );
}

export function isFigmaImageAxis(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_FIGMA_IMAGE_AXIS;
}

// "normalized" names the coordinate scale, not a [0, 1] clip window. A
// destination corner may deliberately sit outside the reference rectangle;
// geometric validity is owned by worldbend-core at preview/apply time.
function isNormalizedPoint(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ["x", "y"])) return false;
  const x = value["x"];
  const y = value["y"];
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y)
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}
