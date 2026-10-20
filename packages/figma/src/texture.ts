import {
  changedTextureFields,
  TEXTURE_WIRE_FIELDS,
  isTextureRecipeWire,
  isTextureMaterialWire,
  parseHexColorWire,
  type StoredTextureProvenance,
  type TextureApplyOutcome,
  type TextureMaterialWire,
  type TextureNodeSnapshot,
  type TextureRecipeWire,
  type TextureWireField,
} from "./texture-wire";
import { materialProperty, sameMaterialSeed, validMaterialFields } from "./material-selective";

export {
  BUILTIN_TEXTURE_RECIPES,
  DEFAULT_TEXTURE_MATERIAL,
  changedTextureFields,
  isTextureRecipeWire,
  isTextureMaterialWire,
  MAX_TEXTURE_RECIPE_ID,
  TEXTURE_SCHEMA,
  TEXTURE_VERSION,
  TEXTURE_WIRE_FIELDS,
  type TextureApplyOutcome,
  type TextureMaterialWire,
  type TextureNodeSnapshot,
  type TextureNodeStateWire,
  type TextureRecipeWire,
  type TextureWireField,
  type StoredTextureProvenance,
} from "./texture-wire";

/**
 * Native texture authoring over the NOISE and TEXTURE effects. Live Figma
 * properties are the authority for actual values; stored provenance records
 * only which seed an instance was applied from. Native extras — duotone
 * secondary colors, blend modes, per-axis sizes — are preserved and disclosed,
 * never rewritten into a portable field.
 */

export const SHARED_TEXTURE_KEY = "texture";
export const TEXTURE_NAMESPACE = "worldbend";

type EffectsNode = SceneNode & { effects: Effect[] };

function isEffectsNode(node: SceneNode): node is EffectsNode {
  return "effects" in node && Array.isArray((node as { effects?: unknown }).effects);
}

type NoiseLike = {
  type: "NOISE";
  visible: boolean;
  color: { r: number; g: number; b: number; a: number };
  noiseSize: number;
  density: number;
  blendMode?: BlendMode;
};
type TextureLike = {
  type: "TEXTURE";
  visible: boolean;
  noiseSize: number;
  radius: number;
  clipToShape: boolean;
};

/** Fields the Worldbend texture model owns on each native effect. */
const OWNED_NOISE_FIELDS = ["visible", "color", "noiseSize", "density"] as const;
const OWNED_TEXTURE_FIELDS = ["visible", "noiseSize", "radius", "clipToShape"] as const;

function isNoiseEffect(effect: Effect): effect is Effect & NoiseLike {
  return effect.type === "NOISE" && "color" in effect && "density" in effect &&
    "noiseSize" in effect;
}

function isTextureEffect(effect: Effect): effect is Effect & TextureLike {
  return effect.type === "TEXTURE" && "radius" in effect && "noiseSize" in effect &&
    "clipToShape" in effect;
}

function effectIndices(node: EffectsNode, predicate: (effect: Effect) => boolean): number[] {
  const indices: number[] = [];
  for (let index = 0; index < node.effects.length; index += 1) {
    if (predicate(node.effects[index]!)) indices.push(index);
  }
  return indices;
}

function toHex(color: { r: number; g: number; b: number }): string | undefined {
  if (![color.r, color.g, color.b].every(channel => typeof channel === "number" && Number.isFinite(channel))) {
    return undefined;
  }
  const channel = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

/** Read the live portable material from the first NOISE and TEXTURE effects. */
export function liveTextureMaterial(node: EffectsNode): TextureMaterialWire | undefined {
  const noise = node.effects.find(isNoiseEffect);
  const texture = node.effects.find(isTextureEffect);
  if (!noise && !texture) return undefined;
  const grainColor = noise ? toHex(noise.color) : undefined;
  if (noise && !grainColor) return undefined;
  const material: TextureMaterialWire = {
    visible: (!noise || noise.visible) && (!texture || texture.visible),
    grain: noise ? noise.density : 0,
    grainSize: noise ? noise.noiseSize : 3,
    grainColor: grainColor ?? "#8a7f72",
    etch: texture ? texture.radius : 0,
    etchSize: texture ? texture.noiseSize : 3,
    clipToShape: texture ? texture.clipToShape : true,
  };
  return isTextureMaterialWire(material) ? material : undefined;
}

export function readStoredTexture(node: SceneNode): StoredTextureProvenance | undefined {
  // New bindings must be accessible to another plugin and engineering Agent.
  // Legacy private bindings remain readable in the original human plugin.
  let raw = "";
  try { raw = node.getSharedPluginData(TEXTURE_NAMESPACE, SHARED_TEXTURE_KEY); } catch { /* legacy host */ }
  if (!raw) { try { raw = node.getPluginData(SHARED_TEXTURE_KEY); } catch { return undefined; } }
  try { const value: unknown = JSON.parse(raw); return isTextureRecipeWire(value) ? value : undefined; }
  catch { return undefined; }
}

export function textureExpectedState(node: SceneNode): string {
  return JSON.stringify({ effects: "effects" in node ? node.effects : [], fills: "fills" in node ? node.fills : null, parent: node.parent?.id, transform: node.relativeTransform, provenance: node.getSharedPluginData(TEXTURE_NAMESPACE, SHARED_TEXTURE_KEY) });
}

/** Native properties are the authority; provenance only explains origin. */
export function textureNodeSnapshot(node: SceneNode): TextureNodeSnapshot {
  if (node.removed) {
    return { nodeId: node.id, name: node.name, eligible: false, reason: "removed", noiseCount: 0, textureCount: 0, state: "absent", customized: [] };
  }
  if (!isEffectsNode(node)) {
    return { nodeId: node.id, name: node.name, eligible: false, reason: "no-effects", noiseCount: 0, textureCount: 0, state: "absent", customized: [] };
  }
  const noiseIndices = effectIndices(node, effect => effect.type === "NOISE");
  const textureIndices = effectIndices(node, effect => effect.type === "TEXTURE");
  if (noiseIndices.length > 1 || textureIndices.length > 1) {
    return {
      nodeId: node.id,
      name: node.name,
      eligible: false,
      reason: noiseIndices.length > 1 ? "multiple-noise" : "multiple-texture",
      noiseCount: noiseIndices.length,
      textureCount: textureIndices.length,
      // Ambiguous ownership is disclosed, never guessed.
      state: "untagged-native",
      customized: [],
    };
  }
  const noise = noiseIndices.length === 1 ? node.effects[noiseIndices[0]!] : undefined;
  const texture = textureIndices.length === 1 ? node.effects[textureIndices[0]!] : undefined;
  if ((noise && !isNoiseEffect(noise)) || (texture && !isTextureEffect(texture))) {
    return { nodeId: node.id, name: node.name, eligible: false, reason: "invalid-texture", noiseCount: noiseIndices.length, textureCount: textureIndices.length, state: "untagged-native", customized: [] };
  }
  const live = liveTextureMaterial(node);
  if ((noise || texture) && !live) {
    return { nodeId: node.id, name: node.name, eligible: false, reason: "invalid-texture", noiseCount: noiseIndices.length, textureCount: textureIndices.length, state: "untagged-native", customized: [] };
  }
  const provenance = readStoredTexture(node);
  const nativeExtras: Record<string, unknown> = {};
  for (const effect of [noise, texture]) {
    if (!effect) continue;
    const owned = effect.type === "NOISE" ? OWNED_NOISE_FIELDS : OWNED_TEXTURE_FIELDS;
    for (const [key, value] of Object.entries(effect)) {
      if (key !== "type" && key !== "boundVariables" && !owned.includes(key as never)) {
        nativeExtras[`${effect.type.toLowerCase()}.${key}`] = value;
      }
    }
  }
  if (noise && isNoiseEffect(noise)) nativeExtras["noise.colorAlpha"] = noise.color.a;
  if (noise && texture && noise.visible !== texture.visible) {
    nativeExtras["noise.visible"] = noise.visible;
    nativeExtras["texture.visible"] = texture.visible;
  }
  const hasNative = live !== undefined;
  const extras = hasNative ? { nativeExtras } : {};
  if (hasNative && provenance) {
    const customized = changedTextureFields(live!, provenance.material);
    return {
      nodeId: node.id,
      name: node.name,
      eligible: true,
      noiseCount: noiseIndices.length,
      textureCount: textureIndices.length,
      ...extras,
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
    noiseCount: noiseIndices.length,
    textureCount: textureIndices.length,
    ...extras,
    state: hasNative ? "untagged-native" : provenance ? "removed" : "absent",
    live,
    provenance,
    customized: [],
  };
}

function noiseEffectFields(material: TextureMaterialWire, includeKind: boolean): NoiseLike {
  const [red, green, blue] = parseHexColorWire(material.grainColor) ?? [138, 127, 114];
  return {
    type: "NOISE",
    visible: material.visible,
    // The real host validates RGBA completeness; the alpha channel is required.
    color: { r: red / 255, g: green / 255, b: blue / 255, a: 1 },
    noiseSize: material.grainSize,
    density: material.grain,
    // The portable model is monotone grain; an append declares it while a
    // replacement omits it so a native duotone keeps its own kind. blendMode
    // stays untouched: installed Figma hosts reject it as an unrecognized
    // noise-effect key, and the fresh append inherits the host default.
    ...(includeKind ? { noiseType: "MONOTONE" } : {}),
  };
}

function textureEffectFields(material: TextureMaterialWire): TextureLike {
  return {
    type: "TEXTURE",
    visible: material.visible,
    noiseSize: material.etchSize,
    radius: material.etch,
    clipToShape: material.clipToShape,
  };
}

/** Figma requires the scalar size to equal vector.x. Keep a native-only
 * anisotropic Y, but resize both axes when the source was uniform. */
function nativeSizeFields(effect: unknown, size: number): Record<string, unknown> {
  const vector = (effect as { noiseSizeVector?: { x?: number; y?: number } } | undefined)?.noiseSizeVector;
  if (!vector || !Number.isFinite(vector.x) || !Number.isFinite(vector.y)) return {};
  return { noiseSizeVector: { x: size, y: vector.x === vector.y ? size : vector.y } };
}

/**
 * Apply one texture recipe to each node with a targeted merge: the owned
 * NOISE and TEXTURE effects are replaced in place (or appended), unrelated
 * effects and their order are preserved, and native extras such as duotone
 * secondary colors survive the write. A node with stacked noise or texture
 * piles is skipped rather than guessed into. A mid-batch failure restores
 * every already-changed node.
 */
export function applyTextureToNodes(
  nodes: readonly SceneNode[],
  recipe: TextureRecipeWire,
  material: TextureMaterialWire = recipe.material,
  fields?: TextureWireField[],
  retainUntagged = false,
): { ok: true; outcomes: TextureApplyOutcome[] } | { ok: false; error: string; unrestoredNodeIds: string[] } {
  if (!isTextureRecipeWire(recipe) || !isTextureMaterialWire(material) ||
      (fields !== undefined && !validMaterialFields(fields, TEXTURE_WIRE_FIELDS)) ||
      (typeof retainUntagged !== "boolean" || (retainUntagged && !fields))) {
    return { ok: false, error: "The texture recipe is not a valid worldbend.texture@0.1 seed", unrestoredNodeIds: [] };
  }
  const changed: { node: EffectsNode; effects: Effect[]; pluginData: string }[] = [];
  const outcomes: TextureApplyOutcome[] = [];
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
      const noiseIndices = effectIndices(node, effect => effect.type === "NOISE");
      const textureIndices = effectIndices(node, effect => effect.type === "TEXTURE");
      if (noiseIndices.length > 1) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "multiple-noise" });
        continue;
      }
      if (textureIndices.length > 1) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "multiple-texture" });
        continue;
      }
      if ((noiseIndices.length === 1 && !isNoiseEffect(node.effects[noiseIndices[0]!]!)) ||
          (textureIndices.length === 1 && !isTextureEffect(node.effects[textureIndices[0]!]!)) ||
          ((noiseIndices.length === 1 || textureIndices.length === 1) && !liveTextureMaterial(node))) {
        outcomes.push({ nodeId: node.id, outcome: "skipped", reason: "invalid-texture" });
        continue;
      }
      const legacyProvenance = readStoredTexture(node);
      if (fields && (!liveTextureMaterial(node) || (retainUntagged ? !!legacyProvenance : !sameMaterialSeed(legacyProvenance, recipe)))) {
        throw Error("E_FIGMA_CONFLICT: Selective Texture edits require the current live instance and unchanged seed");
      }
      const previous = [...node.effects];
      const next = [...node.effects];
      const noiseIndex = noiseIndices[0];
      const textureIndex = textureIndices[0];
      const writeNoise = (index: number | undefined, fields: NoiseLike) => {
        if (index !== undefined) {
          // A native extra such as a duotone kind or secondary color survives
          // the write: only the owned fields are overwritten.
          const native = previous[index] as Effect & NoiseLike;
          next[index] = { ...native, ...fields, ...nativeSizeFields(native, fields.noiseSize),
            color: { ...fields.color, a: native.color.a } } as Effect;
        } else {
          next.push(fields as unknown as Effect);
        }
      };
      // A zero-density or zero-radius portion is a deliberate grain-only or
      // etch-only seed, not a reason to stack an inert native effect.
      if (fields) {
        const merged = { ...liveTextureMaterial(node)! };
        for (const field of fields) {
          const key = materialProperty(field) as keyof TextureMaterialWire;
          Object.assign(merged, { [key]: material[key] });
        }
        const noiseChanges: Record<string, unknown> = {}, textureChanges: Record<string, unknown> = {};
        for (const field of fields) {
          switch (field) {
            case "visible": noiseChanges["visible"] = material.visible; textureChanges["visible"] = material.visible; break;
            case "grain": noiseChanges["density"] = material.grain; break;
            case "grain-color": {
              const color = noiseEffectFields(material, false).color;
              noiseChanges["color"] = { ...color, a: noiseIndex === undefined ? 1 : (previous[noiseIndex] as Effect & NoiseLike).color.a }; break;
            }
            case "grain-size": noiseChanges["noiseSize"] = material.grainSize; Object.assign(noiseChanges, nativeSizeFields(previous[noiseIndex!], material.grainSize)); break;
            case "etch": textureChanges["radius"] = material.etch; break;
            case "etch-size": textureChanges["noiseSize"] = material.etchSize; Object.assign(textureChanges, nativeSizeFields(previous[textureIndex!], material.etchSize)); break;
            case "clip-to-shape": textureChanges["clipToShape"] = material.clipToShape; break;
          }
        }
        if (Object.keys(noiseChanges).length) {
          if (noiseIndex !== undefined) next[noiseIndex] = { ...previous[noiseIndex], ...noiseChanges } as Effect;
          else if (merged.grain > 0) next.push(noiseEffectFields(merged, true) as unknown as Effect);
        }
        if (Object.keys(textureChanges).length) {
          if (textureIndex !== undefined) next[textureIndex] = { ...previous[textureIndex], ...textureChanges } as Effect;
          else if (merged.etch > 0) next.push(textureEffectFields(merged) as unknown as Effect);
        }
      } else {
      if (material.grain > 0 || noiseIndex !== undefined) {
        writeNoise(noiseIndex, noiseEffectFields(material, noiseIndex === undefined));
      }
      if (material.etch > 0 || textureIndex !== undefined) {
        if (textureIndex !== undefined) {
          next[textureIndex] = { ...previous[textureIndex], ...textureEffectFields(material),
            ...nativeSizeFields(previous[textureIndex], material.etchSize) } as Effect;
        } else {
          next.push(textureEffectFields(material) as unknown as Effect);
        }
      }
      }
      const previousPluginData = node.getSharedPluginData(TEXTURE_NAMESPACE, SHARED_TEXTURE_KEY);
      changed.push({ node, effects: previous, pluginData: previousPluginData });
      node.effects = next as unknown as Effect[];
      if (!fields) node.setSharedPluginData(TEXTURE_NAMESPACE, SHARED_TEXTURE_KEY, JSON.stringify(recipe));
      outcomes.push({
        nodeId: node.id,
        outcome: "applied",
        replacedUntagged: (noiseIndex !== undefined || textureIndex !== undefined) && !previousPluginData && !legacyProvenance,
      });
    }
    return { ok: true, outcomes };
  } catch (error) {
    const unrestoredNodeIds: string[] = [];
    for (const entry of changed.reverse()) {
      let failed = false;
      try { if (JSON.stringify(entry.node.effects) !== JSON.stringify(entry.effects)) entry.node.effects = entry.effects as unknown as Effect[]; } catch { failed = true; }
      try { entry.node.setSharedPluginData(TEXTURE_NAMESPACE, SHARED_TEXTURE_KEY, entry.pluginData); } catch { failed = true; }
      if (failed) unrestoredNodeIds.push(entry.node.id);
    }
    return { ok: false, error: `${error instanceof Error ? error.message : String(error)}${unrestoredNodeIds.length ? `; rollback incomplete for ${unrestoredNodeIds.join(", ")}` : ""}`, unrestoredNodeIds };
  }
}
