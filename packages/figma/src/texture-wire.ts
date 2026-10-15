/**
 * UI-safe wire format of `worldbend.texture@0.1`.
 *
 * Canonical semantics — field ranges, reconciliation states, and the Web
 * delivery — live in `worldbend-core`. This mirror carries the wire shape and
 * the validation both plugin threads share so a request is rejected before it
 * reaches the document; it must never widen what core accepts.
 */

export const TEXTURE_SCHEMA = "worldbend.texture@0.1";
export const TEXTURE_VERSION = "0.1";
export const MAX_TEXTURE_RECIPE_ID = 64;

/** The seven portable texture controls, in the core wire spelling. */
export interface TextureMaterialWire {
  visible: boolean;
  grain: number;
  grainSize: number;
  grainColor: string;
  etch: number;
  etchSize: number;
  clipToShape: boolean;
}

export interface TextureRecipeWire {
  schema: string;
  version: string;
  recipeId: string;
  recipeVersion: number;
  material: TextureMaterialWire;
}

/** The stored provenance record is the seed the instance was applied from. */
export type StoredTextureProvenance = TextureRecipeWire;

export const TEXTURE_WIRE_FIELDS = [
  "visible",
  "grain",
  "grain-size",
  "grain-color",
  "etch",
  "etch-size",
  "clip-to-shape",
] as const;
export type TextureWireField = (typeof TEXTURE_WIRE_FIELDS)[number];

export const DEFAULT_TEXTURE_MATERIAL: TextureMaterialWire = {
  visible: true,
  grain: 0.35,
  grainSize: 3,
  grainColor: "#8a7f72",
  etch: 1.5,
  etchSize: 4,
  clipToShape: true,
};

/** Built-in starting states. Named recipes, editable after application. */
export const BUILTIN_TEXTURE_RECIPES: TextureRecipeWire[] = /* @__PURE__ */ (() => [
  {
    schema: TEXTURE_SCHEMA,
    version: TEXTURE_VERSION,
    recipeId: "warm-paper",
    recipeVersion: 1,
    material: { ...DEFAULT_TEXTURE_MATERIAL },
  },
  {
    schema: TEXTURE_SCHEMA,
    version: TEXTURE_VERSION,
    recipeId: "etched-card",
    recipeVersion: 1,
    material: {
      visible: true,
      grain: 0.22,
      grainSize: 2,
      grainColor: "#5d6b74",
      etch: 3.5,
      etchSize: 6,
      clipToShape: true,
    },
  },
  {
    schema: TEXTURE_SCHEMA,
    version: TEXTURE_VERSION,
    recipeId: "frosted-plastic",
    recipeVersion: 1,
    material: {
      visible: true,
      grain: 0.6,
      grainSize: 5,
      grainColor: "#dfe6ea",
      etch: 0,
      etchSize: 3,
      clipToShape: false,
    },
  },
])();

export function parseHexColorWire(value: string): [number, number, number] | undefined {
  if (value.length !== 7 || value.charCodeAt(0) !== 35 /* # */) return undefined;
  let red = 0, green = 0, blue = 0;
  for (let index = 1; index < 7; index += 2) {
    const digit = (high: string, low: string): number | undefined => {
      const hi = Number.parseInt(high, 16);
      const lo = Number.parseInt(low, 16);
      return Number.isFinite(hi) && Number.isFinite(lo) ? hi * 16 + lo : undefined;
    };
    const channel = digit(value.charAt(index), value.charAt(index + 1));
    if (channel === undefined) return undefined;
    if (index === 1) red = channel;
    else if (index === 3) green = channel;
    else blue = channel;
  }
  return [red, green, blue];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isTextureMaterialWire(value: unknown): value is TextureMaterialWire {
  if (typeof value !== "object" || value === null) return false;
  const material = value as Record<string, unknown>;
  const grainColor = material["grainColor"];
  return typeof material["visible"] === "boolean" &&
    typeof material["clipToShape"] === "boolean" &&
    typeof grainColor === "string" && parseHexColorWire(grainColor) !== undefined &&
    isFiniteNumber(material["grain"]) && isFiniteNumber(material["grainSize"]) &&
    isFiniteNumber(material["etch"]) && isFiniteNumber(material["etchSize"]) &&
    (material["grain"] as number) >= 0 && (material["grain"] as number) <= 1 &&
    (material["grainSize"] as number) >= 0.5 && (material["grainSize"] as number) <= 1000 &&
    (material["etch"] as number) >= 0 && (material["etch"] as number) <= 1000 &&
    (material["etchSize"] as number) >= 0.5 && (material["etchSize"] as number) <= 1000;
}

export function isTextureRecipeWire(value: unknown): value is TextureRecipeWire {
  if (typeof value !== "object" || value === null) return false;
  const recipe = value as Record<string, unknown>;
  const recipeId = recipe["recipeId"];
  const recipeVersion = recipe["recipeVersion"];
  return recipe["schema"] === TEXTURE_SCHEMA && recipe["version"] === TEXTURE_VERSION &&
    typeof recipeId === "string" && recipeId.trim().length > 0 &&
    [...recipeId].length <= MAX_TEXTURE_RECIPE_ID &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(recipeId) &&
    Number.isSafeInteger(recipeVersion) && Number(recipeVersion) >= 1 && Number(recipeVersion) <= 0xffffffff &&
    isTextureMaterialWire(recipe["material"]);
}

export function changedTextureFields(
  live: TextureMaterialWire,
  seed: TextureMaterialWire,
): TextureWireField[] {
  const changed: TextureWireField[] = [];
  // Figma stores native controls as float32. Recognize that exact roundtrip,
  // without hiding a different representable native edit behind a tolerance.
  // Colors compare bytewise: the host's float32 channels round back to the
  // bytes they were authored from.
  const differs = (a: number, b: number): boolean => a !== b && a !== Math.fround(b);
  const colorDiffers = (a: string, b: string): boolean => {
    const left = parseHexColorWire(a);
    const right = parseHexColorWire(b);
    if (left === undefined || right === undefined) return a !== b;
    return left[0] !== right[0] || left[1] !== right[1] || left[2] !== right[2];
  };
  if (live.visible !== seed.visible) changed.push("visible");
  if (differs(live.grain, seed.grain)) changed.push("grain");
  if (differs(live.grainSize, seed.grainSize)) changed.push("grain-size");
  if (colorDiffers(live.grainColor, seed.grainColor)) changed.push("grain-color");
  if (differs(live.etch, seed.etch)) changed.push("etch");
  if (differs(live.etchSize, seed.etchSize)) changed.push("etch-size");
  if (live.clipToShape !== seed.clipToShape) changed.push("clip-to-shape");
  return changed;
}

export type TextureNodeStateWire =
  | "absent"
  | "tagged"
  | "customized"
  | "untagged-native"
  | "removed";

export interface TextureNodeSnapshot {
  nodeId: string;
  name: string;
  eligible: boolean;
  /** Eligibility detail for ineligible nodes. */
  reason?: "no-effects" | "removed" | "multiple-noise" | "multiple-texture" | "invalid-texture" | undefined;
  /** Host extension values preserved on update but not in the seven-field model. */
  nativeExtras?: Record<string, unknown> | undefined;
  /** NOISE and TEXTURE effects currently stacked on the node. */
  noiseCount: number;
  textureCount: number;
  state: TextureNodeStateWire;
  live?: TextureMaterialWire | undefined;
  provenance?: StoredTextureProvenance | undefined;
  customized: TextureWireField[];
}

export type TextureApplyOutcome =
  | { nodeId: string; outcome: "applied"; replacedUntagged: boolean }
  | { nodeId: string; outcome: "skipped"; reason: "no-effects" | "removed" | "multiple-noise" | "multiple-texture" | "invalid-texture" };
