/**
 * UI-safe wire format of `worldbend.appearance@0.1`.
 *
 * Canonical semantics — field ranges, reconciliation states, and target
 * delivery — live in `worldbend-core`. This mirror carries the wire shape and
 * the validation both plugin threads share so a request is rejected before it
 * reaches the document; it must never widen what core accepts.
 */

export const APPEARANCE_SCHEMA = "worldbend.appearance@0.1";
export const APPEARANCE_VERSION = "0.1";
export const MAX_APPEARANCE_RECIPE_ID = 64;

/** The seven native GLASS controls, in the core wire spelling. */
export interface GlassMaterialWire {
  visible: boolean;
  lightIntensity: number;
  lightAngle: number;
  refraction: number;
  depth: number;
  dispersion: number;
  radius: number;
}

export interface AppearanceRecipeWire {
  schema: string;
  version: string;
  recipeId: string;
  recipeVersion: number;
  material: GlassMaterialWire;
}

/** One selected layer rendered for the workspace material preview. */
export interface AppearancePreviewWire {
  /** Base64 PNG of the applied native scene, including backdrop and glass. */
  bytes: string;
  width: number;
  height: number;
}

/** The stored provenance record is the seed the instance was applied from. */
export type StoredAppearanceProvenance = AppearanceRecipeWire;

export const GLASS_WIRE_FIELDS = [
  "visible",
  "light-intensity",
  "light-angle",
  "refraction",
  "depth",
  "dispersion",
  "radius",
] as const;
export type GlassWireField = (typeof GLASS_WIRE_FIELDS)[number];

export type AppearanceNodeStateWire =
  | "absent"
  | "tagged"
  | "customized"
  | "untagged-native"
  | "removed";

export const DEFAULT_GLASS_MATERIAL: GlassMaterialWire = {
  visible: true,
  lightIntensity: 0.5,
  lightAngle: 90,
  refraction: 0.35,
  depth: 2,
  dispersion: 0,
  radius: 12,
};

/** Built-in starting states. Named recipes, editable after application. */
export const BUILTIN_APPEARANCE_RECIPES: AppearanceRecipeWire[] = /* @__PURE__ */ (() => [
  {
    schema: APPEARANCE_SCHEMA,
    version: APPEARANCE_VERSION,
    recipeId: "clear-lens",
    recipeVersion: 2,
    material: { ...DEFAULT_GLASS_MATERIAL, radius: 1 },
  },
  {
    schema: APPEARANCE_SCHEMA,
    version: APPEARANCE_VERSION,
    recipeId: "frosted-panel",
    recipeVersion: 1,
    material: {
      visible: true,
      lightIntensity: 0.35,
      lightAngle: 90,
      refraction: 0.15,
      depth: 1.5,
      dispersion: 0,
      radius: 32,
    },
  },
  {
    schema: APPEARANCE_SCHEMA,
    version: APPEARANCE_VERSION,
    recipeId: "prism-edge",
    recipeVersion: 1,
    material: {
      visible: true,
      lightIntensity: 0.85,
      lightAngle: 120,
      refraction: 0.8,
      depth: 6,
      dispersion: 0.45,
      radius: 4,
    },
  },
])();

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isGlassMaterialWire(value: unknown): value is GlassMaterialWire {
  if (typeof value !== "object" || value === null) return false;
  const material = value as Record<string, unknown>;
  const lightIntensity = material["lightIntensity"];
  const lightAngle = material["lightAngle"];
  const refraction = material["refraction"];
  const depth = material["depth"];
  const dispersion = material["dispersion"];
  const radius = material["radius"];
  return typeof material["visible"] === "boolean" &&
    isFiniteNumber(lightIntensity) && isFiniteNumber(lightAngle) &&
    isFiniteNumber(refraction) && isFiniteNumber(depth) &&
    isFiniteNumber(dispersion) && isFiniteNumber(radius) &&
    lightIntensity >= 0 && lightIntensity <= 1 &&
    refraction >= 0 && refraction <= 1 &&
    dispersion >= 0 && dispersion <= 1 &&
    lightAngle >= 0 && lightAngle < 360 &&
    depth >= 1 && depth <= 1000 &&
    radius >= 0 && radius <= 1000;
}

export function isAppearanceRecipeWire(value: unknown): value is AppearanceRecipeWire {
  if (typeof value !== "object" || value === null) return false;
  const recipe = value as Record<string, unknown>;
  const recipeId = recipe["recipeId"];
  const recipeVersion = recipe["recipeVersion"];
  return recipe["schema"] === APPEARANCE_SCHEMA && recipe["version"] === APPEARANCE_VERSION &&
    typeof recipeId === "string" && recipeId.trim().length > 0 &&
    [...recipeId].length <= MAX_APPEARANCE_RECIPE_ID &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(recipeId) &&
    Number.isSafeInteger(recipeVersion) && Number(recipeVersion) >= 1 && Number(recipeVersion) <= 0xffffffff &&
    isGlassMaterialWire(recipe["material"]);
}

export function changedGlassFields(
  live: GlassMaterialWire,
  seed: GlassMaterialWire,
): GlassWireField[] {
  const changed: GlassWireField[] = [];
  // Figma stores native controls as float32. Recognize that exact roundtrip,
  // without hiding a different representable native edit behind a tolerance.
  const differs = (a: number, b: number): boolean => a !== b && a !== Math.fround(b);
  if (live.visible !== seed.visible) changed.push("visible");
  if (differs(live.lightIntensity, seed.lightIntensity)) changed.push("light-intensity");
  if (differs(live.lightAngle, seed.lightAngle)) changed.push("light-angle");
  if (differs(live.refraction, seed.refraction)) changed.push("refraction");
  if (differs(live.depth, seed.depth)) changed.push("depth");
  if (differs(live.dispersion, seed.dispersion)) changed.push("dispersion");
  if (differs(live.radius, seed.radius)) changed.push("radius");
  return changed;
}

export interface AppearanceNodeSnapshot {
  nodeId: string;
  name: string;
  eligible: boolean;
  /** Eligibility detail for ineligible nodes. */
  reason?: "no-effects" | "removed" | "multiple-glass" | "invalid-glass" | undefined;
  warnings?: ("opaque-fill" | "background-blur")[] | undefined;
  /** Host extension values preserved on update but not in the seven-field delivery model. */
  nativeExtras?: Record<string, unknown> | undefined;
  /** GLASS effects currently stacked on the node. */
  glassCount: number;
  state: AppearanceNodeStateWire;
  live?: GlassMaterialWire | undefined;
  provenance?: StoredAppearanceProvenance | undefined;
  customized: GlassWireField[];
}

export type AppearanceApplyOutcome =
  | { nodeId: string; outcome: "applied"; replacedUntagged: boolean }
  | { nodeId: string; outcome: "skipped"; reason: "no-effects" | "removed" | "multiple-glass" | "invalid-glass" };
