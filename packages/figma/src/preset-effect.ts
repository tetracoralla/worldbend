import type { CardRig, CardView } from "@worldbend/web/types";

export const PRESET_EFFECT_IDS = ["pointer-tilt", "idle-tilt", "card-turn", "fold-screen"] as const;
export type PresetEffectId = typeof PRESET_EFFECT_IDS[number];
export interface PresetEffectSpec {
  schema: "worldbend.figma.preset-effect";
  version: "0.1";
  effect: PresetEffectId;
  amount: number;
}
export const defaultPresetEffect = (): PresetEffectSpec => ({
  schema: "worldbend.figma.preset-effect", version: "0.1", effect: "pointer-tilt", amount: 1,
});
/** The glass finish makes the moving window visible beyond the sampled artwork. */
export const FOLD_GLASS = {
  fill: {r:1,g:1,b:1,opacity:.12},
  stroke: {r:.09,g:.20,b:.21,opacity:.28,width:1.5},
  shadow: {r:0,g:0,b:0,opacity:.08,radius:18,x:8,y:12},
  padding:32,
} as const;
export function isPresetEffectSpec(value: unknown): value is PresetEffectSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 4 && v["schema"] === "worldbend.figma.preset-effect" &&
    v["version"] === "0.1" && PRESET_EFFECT_IDS.includes(v["effect"] as PresetEffectId) &&
    typeof v["amount"] === "number" && Number.isFinite(v["amount"]) && v["amount"] >= 0 && v["amount"] <= 1;
}
/** Presentation defaults over the shared card contract; no projection math. */
export function presetCard(spec: PresetEffectSpec, size: {width: number; height: number}): {rig: CardRig; view: CardView} {
  const k = spec.amount;
  return {
    rig: {schema: "worldbend.card", version: "0.1", elementSize: size,
      geometry: {perspective: Math.max(size.width, size.height) * 3},
      tilt: {maxRotateX: 10 * k, maxRotateY: 14 * k,
        ...(spec.effect === "idle-tilt" ? {idle: {amplitudeX: 5 * k, amplitudeY: 8 * k, periodMs: 5200}} : {})},
      action: {axis: "y", direction: 1, turns: 1, durationMs: 720,
        easing: {kind: "cubicBezier", x1: .4, y1: 0, x2: .2, y2: 1}}},
    view: spec.effect === "card-turn" ? {rotateY: 60 * k}
      : spec.effect === "idle-tilt" ? {rotateX: 5 * k, rotateY: 8 * k}
      : {rotateX: -10 * k, rotateY: 14 * k},
  };
}
export interface PresetEffectRecord {
  schema: "worldbend.figma.preset-result";
  version: "0.1";
  spec: PresetEffectSpec;
  rootNodeId: string;
  sourceHolderId: string;
  sourceNodeId: string;
  presentationNodeId: string;
}
export const PRESET_EFFECT_KEY = "presetEffect";
export function parsePresetEffectRecord(raw: string): PresetEffectRecord | undefined {
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (Object.keys(v).length !== 7 || v["schema"] !== "worldbend.figma.preset-result" || v["version"] !== "0.1" || !isPresetEffectSpec(v["spec"])) return;
    const ids = [v["rootNodeId"], v["sourceHolderId"], v["sourceNodeId"], v["presentationNodeId"]];
    if (!ids.every(id => typeof id === "string" && id.length > 0 && id.length <= 256) || new Set(ids).size !== 4) return;
    return v as unknown as PresetEffectRecord;
  } catch { return; }
}
export interface PresetEffectLayer {
  name: "card" | "fold-outer" | "fold-inner";
  bytes: string;
  quad: {tl: {x:number;y:number};tr: {x:number;y:number};br: {x:number;y:number};bl: {x:number;y:number}};
}
export interface PresetEffectRaster {
  width: number;
  height: number;
  origin: {x:number;y:number};
  /** The native stationary left half is present only for a fold. */
  baseWidth?: number;
  layers: PresetEffectLayer[];
}
