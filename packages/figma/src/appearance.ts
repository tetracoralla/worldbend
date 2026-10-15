import {
  changedGlassFields,
  GLASS_WIRE_FIELDS,
  isAppearanceRecipeWire,
  isGlassMaterialWire,
  type AppearanceApplyOutcome,
  type AppearanceNodeSnapshot,
  type AppearanceRecipeWire,
  type GlassMaterialWire,
  type GlassWireField,
  type StoredAppearanceProvenance,
} from "./appearance-wire";
import { materialProperty, sameMaterialSeed, validMaterialFields } from "./material-selective";

export {
  APPEARANCE_SCHEMA,
  APPEARANCE_VERSION,
  BUILTIN_APPEARANCE_RECIPES,
  changedGlassFields,
  DEFAULT_GLASS_MATERIAL,
  GLASS_WIRE_FIELDS,
  isAppearanceRecipeWire,
  isGlassMaterialWire,
  MAX_APPEARANCE_RECIPE_ID,
  type AppearanceApplyOutcome,
  type AppearanceNodeSnapshot,
  type AppearanceNodeStateWire,
  type AppearanceRecipeWire,
  type GlassMaterialWire,
  type GlassWireField,
  type StoredAppearanceProvenance,
} from "./appearance-wire";

/**
 * Native appearance authoring over the Figma GLASS effect. The live Figma
 * properties are the authority for actual values; the stored provenance
 * records only which seed an instance was applied from.
 */

export const SHARED_APPEARANCE_KEY = "appearance";
export const APPEARANCE_NAMESPACE = "worldbend";

export function readStoredAppearance(node: SceneNode): StoredAppearanceProvenance | undefined {
  // New bindings must be accessible to another plugin and engineering Agent.
  // Legacy private bindings remain readable in the original human plugin.
  let raw = "";
  try { raw = node.getSharedPluginData(APPEARANCE_NAMESPACE, SHARED_APPEARANCE_KEY); } catch { /* legacy host */ }
  if (!raw) { try { raw = node.getPluginData(SHARED_APPEARANCE_KEY); } catch { return undefined; } }
  try { const value: unknown = JSON.parse(raw); return isAppearanceRecipeWire(value) ? value : undefined; }
  catch { return undefined; }
}

export function appearanceExpectedState(node: SceneNode): string {
  return JSON.stringify({ effects: "effects" in node ? node.effects : [], fills: "fills" in node ? node.fills : null, parent: node.parent?.id, transform: node.relativeTransform, provenance: node.getSharedPluginData(APPEARANCE_NAMESPACE, SHARED_APPEARANCE_KEY) });
}

/** One context rule shared by the human preview and Agent inspection. */
export function appearancePreviewContext(node: SceneNode): SceneNode {
  let parent = node.parent;
  while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
    if (parent.type === "FRAME" || parent.type === "COMPONENT" || parent.type === "INSTANCE") return parent;
    parent = parent.parent;
  }
  return node;
}

export function appearanceWarnings(node: SceneNode): ("opaque-fill" | "background-blur")[] {
  const warnings: ("opaque-fill" | "background-blur")[] = [];
  if ("fills" in node && Array.isArray(node.fills) && node.fills.some(p => p.visible !== false && (p.opacity ?? 1) === 1)) warnings.push("opaque-fill");
  if ("effects" in node && node.effects.some(e => e.type === "BACKGROUND_BLUR" && e.visible)) warnings.push("background-blur");
  return warnings;
}

type EffectsNode = SceneNode & { effects: Effect[] };

function isEffectsNode(node: SceneNode): node is EffectsNode {
  return "effects" in node && Array.isArray((node as { effects?: unknown }).effects);
}

function glassEffectIndices(node: EffectsNode): number[] {
  const effects: readonly Effect[] = node.effects;
  const indices: number[] = [];
  for (let index = 0; index < effects.length; index += 1) {
    if (effects[index]?.type === "GLASS") indices.push(index);
  }
  return indices;
}

function liveGlassMaterial(effect: Effect): GlassMaterialWire | undefined {
  if (effect.type !== "GLASS") return undefined;
  const candidate: GlassMaterialWire = {
    visible: effect.visible,
    lightIntensity: effect.lightIntensity,
    lightAngle: effect.lightAngle,
    refraction: effect.refraction,
    depth: effect.depth,
    dispersion: effect.dispersion,
    radius: effect.radius,
  };
  return isGlassMaterialWire(candidate) ? candidate : undefined;
}

/** Native properties are the authority; provenance only explains origin. */
export function appearanceNodeSnapshot(node: SceneNode): AppearanceNodeSnapshot {
  if (node.removed) {
    return {
      nodeId: node.id,
      name: node.name,
      eligible: false,
      reason: "removed",
      glassCount: 0,
      state: "absent",
      customized: [],
    };
  }
  if (!isEffectsNode(node)) {
    return {
      nodeId: node.id,
      name: node.name,
      eligible: false,
      reason: "no-effects",
      glassCount: 0,
      state: "absent",
      customized: [],
    };
  }
  const glassIndices = glassEffectIndices(node);
  const firstGlassIndex = glassIndices[0];
  const firstGlassEffect = firstGlassIndex === undefined ? undefined : node.effects[firstGlassIndex];
  const live = firstGlassEffect === undefined ? undefined : liveGlassMaterial(firstGlassEffect);
  const provenance = readStoredAppearance(node);
  if (glassIndices.length > 1) {
    return {
      nodeId: node.id,
      name: node.name,
      eligible: false,
      reason: "multiple-glass",
      glassCount: glassIndices.length,
      // Ambiguous ownership is disclosed, never guessed.
      state: "untagged-native",
      live,
      provenance,
      customized: [],
    };
  }
  if (glassIndices.length === 1 && !live) return { nodeId: node.id, name: node.name, eligible: false, reason: "invalid-glass", glassCount: 1, state: "untagged-native", provenance, customized: [] };
  const warnings = appearanceWarnings(node);
  const nativeExtras = firstGlassEffect ? Object.fromEntries(Object.entries(firstGlassEffect).filter(([k]) => !["type", "visible", "lightIntensity", "lightAngle", "refraction", "depth", "dispersion", "radius", "boundVariables"].includes(k))) : undefined;
  const hasGlass = live !== undefined;
  if (hasGlass && provenance) {
    const customized = changedGlassFields(live, provenance.material);
    return {
      nodeId: node.id,
      name: node.name,
      eligible: true,
      glassCount: 1,
      warnings, nativeExtras,
      state: customized.length > 0 ? "customized" : "tagged",
      live,
      provenance,
      customized,
    };
  }
  return {
    nodeId: node.id,
    name: node.name,
    eligible: true,
    glassCount: hasGlass ? 1 : 0,
    warnings, nativeExtras,
    state: hasGlass ? "untagged-native" : provenance ? "removed" : "absent",
    live,
    provenance,
    customized: [],
  };
}

function glassEffectFromMaterial(material: GlassMaterialWire): Effect {
  return {
    type: "GLASS",
    visible: material.visible,
    lightIntensity: material.lightIntensity,
    lightAngle: material.lightAngle,
    refraction: material.refraction,
    depth: material.depth,
    dispersion: material.dispersion,
    radius: material.radius,
  } as unknown as Effect;
}

/**
 * Apply one recipe to each node with a targeted merge: the Worldbend-owned
 * GLASS effect is replaced in place (or appended), unrelated effects and
 * their order are preserved, and provenance records the seed. A node with a
 * stacked glass pile is skipped rather than guessed into. A mid-batch
 * failure restores every already-changed node.
 */
export function applyAppearanceToNodes(
  nodes: readonly SceneNode[],
  recipe: AppearanceRecipeWire,
  material: GlassMaterialWire = recipe.material,
  fields?: GlassWireField[],
  retainUntagged = false,
): { ok: true; outcomes: AppearanceApplyOutcome[] } | { ok: false; error: string; unrestoredNodeIds: string[] } {
  if (!isAppearanceRecipeWire(recipe) || !isGlassMaterialWire(material) ||
      (fields !== undefined && !validMaterialFields(fields, GLASS_WIRE_FIELDS)) ||
      (typeof retainUntagged !== "boolean" || (retainUntagged && !fields))) {
    return { ok: false, error: "The appearance recipe is not a valid worldbend.appearance@0.1 seed", unrestoredNodeIds: [] };
  }
  const changed: { node: EffectsNode; effects: Effect[]; pluginData: string }[] = [];
  const outcomes: AppearanceApplyOutcome[] = [];
  try {
    for (const node of nodes) {
      if (node.removed) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "removed" });
        continue;
      }
      if (!isEffectsNode(node)) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "no-effects" });
        continue;
      }
      const glassIndices = glassEffectIndices(node);
      if (glassIndices.length > 1) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "multiple-glass" });
        continue;
      }
      if (glassIndices.length === 1 && !liveGlassMaterial(node.effects[glassIndices[0]!]!)) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "invalid-glass" });
        continue;
      }
      const legacyProvenance = readStoredAppearance(node);
      if (fields && (glassIndices.length !== 1 || (retainUntagged ? !!legacyProvenance : !sameMaterialSeed(legacyProvenance, recipe)))) {
        throw Error("E_FIGMA_CONFLICT: Selective Glass edits require the current live instance and unchanged seed");
      }
      const glass = glassEffectFromMaterial(material);
      const previous = [...node.effects];
      const next = [...node.effects];
      const ownedIndex = glassIndices[0];
      if (ownedIndex !== undefined) {
        const changes = fields ? Object.fromEntries(fields.map(field => {
          const key = materialProperty(field) as keyof GlassMaterialWire;
          return [key, material[key]];
        })) : glass;
        next[ownedIndex] = { ...previous[ownedIndex], ...changes } as Effect;
      } else {
        next.push(glass);
      }
      const previousPluginData = node.getSharedPluginData(APPEARANCE_NAMESPACE, SHARED_APPEARANCE_KEY);
      changed.push({ node, effects: previous, pluginData: previousPluginData });
      node.effects = next;
      if (!fields) node.setSharedPluginData(APPEARANCE_NAMESPACE, SHARED_APPEARANCE_KEY, JSON.stringify(recipe));
      outcomes.push({
        nodeId: node.id,
        outcome: "applied",
        replacedUntagged: ownedIndex !== undefined && !previousPluginData && !legacyProvenance,
      });
    }
    return { ok: true, outcomes };
  } catch (error) {
    const unrestoredNodeIds: string[] = [];
    for (const entry of changed.reverse()) {
      let failed = false;
      try { if (JSON.stringify(entry.node.effects) !== JSON.stringify(entry.effects)) entry.node.effects = entry.effects; } catch { failed = true; }
      try { entry.node.setSharedPluginData(APPEARANCE_NAMESPACE, SHARED_APPEARANCE_KEY, entry.pluginData); } catch { failed = true; }
      if (failed) unrestoredNodeIds.push(entry.node.id);
    }
    return { ok: false, error: `${error instanceof Error ? error.message : String(error)}${unrestoredNodeIds.length ? `; rollback incomplete for ${unrestoredNodeIds.join(", ")}` : ""}`, unrestoredNodeIds };
  }
}
