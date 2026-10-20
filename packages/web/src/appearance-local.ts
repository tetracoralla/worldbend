import {sha256Hex} from "./sha256";
export {sha256Hex} from "./sha256";
// Local evaluation path for adopted live appearance controls. This mirrors
// the canonical Rust core compile (worldbend-core/src/appearance.rs) so a
// receiver can tune a material per frame without MCP or model calls. Parity
// with the canonical receipts is enforced by scripts/generate-appearance-parity.mjs
// fixtures in appearance-local.test.ts; do not edit the formulas on one side
// only.
import type {
  AppearanceDeliveryPlan,
  AppearanceExposureReport,
  AppearancePreferenceRecord,
  AppearanceDeliveryTarget,
  GlassMaterial,
  WebGlassDelivery,
} from "./generated/core-contract";

export type GlassFieldId =
  | "visible"
  | "light-intensity"
  | "light-angle"
  | "refraction"
  | "depth"
  | "dispersion"
  | "radius";

export const GLASS_FIELD_IDS: GlassFieldId[] = [
  "visible",
  "light-intensity",
  "light-angle",
  "refraction",
  "depth",
  "dispersion",
  "radius",
];

export const CLARITY_MAPPING_VERSION = "1";
export const DEFAULT_CLARITY_RADIUS_MAX = 64;

const WEB_DEPTH_LINEAR_END = 10;
const WEB_DEPTH_EFFECTIVE_MAX = 100;
const WEB_DEPTH_FACTOR_AT_LINEAR_END = 1.0;
const WEB_DEPTH_FACTOR_AT_EFFECTIVE_MAX = 1.5;
const WEB_RIM_LINEAR_END = 20;
const WEB_RIM_EFFECTIVE_MAX = 100;
const WEB_RIM_AT_EFFECTIVE_MAX = 40;

/** Rust `f64::round` rounds half away from zero; JS Math.round half up. */
function roundHalfAway(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function webDepthFactor(depth: number): [factor: number, effective: number, clamped: boolean] {
  const clamped = !(depth >= 1 && depth <= WEB_DEPTH_EFFECTIVE_MAX);
  const effective = Math.min(WEB_DEPTH_EFFECTIVE_MAX, Math.max(1, depth));
  const factor = effective <= WEB_DEPTH_LINEAR_END
    ? effective / WEB_DEPTH_LINEAR_END
    : WEB_DEPTH_FACTOR_AT_LINEAR_END
      + (WEB_DEPTH_FACTOR_AT_EFFECTIVE_MAX - WEB_DEPTH_FACTOR_AT_LINEAR_END)
        * smoothstep((effective - WEB_DEPTH_LINEAR_END) / (WEB_DEPTH_EFFECTIVE_MAX - WEB_DEPTH_LINEAR_END));
  return [factor, effective, clamped];
}

export function webRimDepth(depth: number): [rim: number, effective: number, clamped: boolean] {
  const clamped = !(depth >= 1 && depth <= WEB_RIM_EFFECTIVE_MAX);
  const effective = Math.min(WEB_RIM_EFFECTIVE_MAX, Math.max(1, depth));
  const rim = effective <= WEB_RIM_LINEAR_END
    ? effective
    : WEB_RIM_LINEAR_END
      + (WEB_RIM_AT_EFFECTIVE_MAX - WEB_RIM_LINEAR_END)
        * smoothstep((effective - WEB_RIM_LINEAR_END) / (WEB_RIM_EFFECTIVE_MAX - WEB_RIM_LINEAR_END));
  return [rim, effective, clamped];
}

export function lightDirectionScreen(angleDegrees: number): [direction: [number, number], cardinal: string] {
  // Multiply by the precomputed PI/180 double, matching Rust's to_radians
  // (angle * PI / 180 rounds differently from (angle * PI) / 180).
  const radians = angleDegrees * (Math.PI / 180);
  const direction: [number, number] = [-Math.sin(radians), Math.cos(radians)];
  const cardinal = roundHalfAway(angleDegrees) === 0 ? "down"
    : roundHalfAway(angleDegrees) === 90 ? "left"
    : roundHalfAway(angleDegrees) === 180 ? "up"
    : roundHalfAway(angleDegrees) === 270 ? "right"
    : "oblique";
  return [direction, cardinal];
}

function formatPx(value: number): string {
  const rounded = roundHalfAway(value * 100) / 100;
  if (Math.abs(rounded - Math.trunc(rounded)) < Number.EPSILON) return `${Math.trunc(rounded)}px`;
  return `${rounded}px`;
}

function formatRatio(value: number): string {
  const rounded = roundHalfAway(value * 1000) / 1000;
  if (Math.abs(rounded - Math.trunc(rounded)) < Number.EPSILON) return `${Math.trunc(rounded)}`;
  return `${rounded}`;
}

const Y_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><defs><linearGradient id='y' x1='0' y1='0' x2='0' y2='1'><stop stop-color='#80ff80'/><stop offset='1' stop-color='#800080'/></linearGradient></defs><rect width='256' height='256' fill='url(#y)'/></svg>";
const MAP_SVG = "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><defs><linearGradient id='x'><stop stop-color='#ff8080'/><stop offset='1' stop-color='#008080'/></linearGradient><radialGradient id='rim'><stop offset='.65' stop-color='black'/><stop offset='1' stop-color='white'/></radialGradient><mask id='m'><rect width='256' height='256' fill='url(#rim)'/></mask><filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feImage href='%s' result='y' x='0' y='0' width='100%' height='100%'/><feComposite in='SourceGraphic' in2='y' operator='arithmetic' k2='1' k3='1' k4='-.502'/></filter></defs><rect width='256' height='256' fill='#808080'/><rect width='256' height='256' fill='url(#x)' filter='url(#n)' mask='url(#m)'/></svg>";

function percentEncode(source: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(source)) out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  return out;
}

/** Mirror of the core Web compile: strings, receipts and numbers exactly. */
export function compileWebAppearance(material: GlassMaterial, preserveColor = false): WebGlassDelivery {
  const saturation = 1.0 + 0.35 * material.dispersion + 0.25 * material.refraction;
  const brightness = 1.0 + Math.min(0.12, material.radius / 2000.0);
  const backdropFilter = preserveColor ? `blur(${formatPx(material.radius)})` : `blur(${formatPx(material.radius)}) saturate(${formatRatio(saturation)}) brightness(${formatRatio(brightness)})`;

  const [lightDir, cardinal] = lightDirectionScreen(material.lightAngle);
  const amount = 2.0 + 6.0 * material.lightIntensity;
  const offsetX = lightDir[0] * amount;
  const offsetY = lightDir[1] * amount;
  const highlightBlur = 4.0 + 10.0 * material.lightIntensity;
  const highlightAlpha = 0.15 + 0.55 * material.lightIntensity;
  const borderAlpha = 0.08 + 0.25 * material.lightIntensity;
  const boxShadow = `inset ${formatPx(offsetX)} ${formatPx(offsetY)} ${formatPx(highlightBlur)} rgba(255,255,255,${Math.min(highlightAlpha, 1).toFixed(2)}), inset 0 0 ${formatPx(highlightBlur * 1.5)} rgba(255,255,255,${(Math.min(highlightAlpha, 1) * 0.6).toFixed(2)})`;
  let css = `backdrop-filter: ${backdropFilter};\nbox-shadow: ${boxShadow};\nborder: 1px solid rgba(255,255,255,${Math.min(borderAlpha, 1).toFixed(2)});`;

  const [depthFactor, depthEffective, depthClamped] = webDepthFactor(material.depth);
  const [rimDepth, rimEffective, rimClamped] = webRimDepth(material.depth);
  const displacement = material.refraction > 0.0 || material.dispersion > 0.0
    ? (() => {
      const scale = 64.0 * material.refraction * depthFactor;
      const chromaticOffset = 24.0 * material.dispersion;
      const yUri = `data:image/svg+xml,${percentEncode(Y_SVG)}`;
      const edgeMap = `data:image/svg+xml,${percentEncode(MAP_SVG.replace("%s", yUri))}`;
      const markup = `<filter id="worldbend-glass" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">\n<feImage href="${edgeMap}" result="edge-map" preserveAspectRatio="none"/>\n<feDisplacementMap in="SourceGraphic" in2="edge-map" scale="${formatRatio(scale)}" xChannelSelector="R" yChannelSelector="G" result="refracted"/>\n<feDisplacementMap in="refracted" in2="edge-map" scale="${formatRatio(chromaticOffset)}" xChannelSelector="R" yChannelSelector="G" result="red-shift"/>\n<feColorMatrix in="red-shift" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red"/>\n<feColorMatrix in="refracted" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green"/>\n<feDisplacementMap in="refracted" in2="edge-map" scale="${formatRatio(-chromaticOffset)}" xChannelSelector="R" yChannelSelector="G" result="blue-shift"/>\n<feColorMatrix in="blue-shift" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue"/>\n<feBlend in="red" in2="green" mode="screen" result="rg"/><feBlend in="rg" in2="blue" mode="screen"/>\n</filter>`;
      return { scale, chromaticOffset, markup };
    })()
    : null;

  if (displacement) css = css.replace(backdropFilter, `${backdropFilter} url("#worldbend-glass")`);
  if (!material.visible) css = "";

  const fidelity = [
    { field: "visible" as const, mapping: "native" as const, note: "visible=false omits the glass declarations entirely" },
    { field: "radius" as const, mapping: "native" as const, note: "frost radius maps to the backdrop-filter blur length" },
    { field: "light-intensity" as const, mapping: "approximated" as const, note: "drives the inset edge highlight strength; Figma's full specular response is richer" },
    { field: "light-angle" as const, mapping: "approximated" as const, note: `positions the inset highlight on the lit edge; cardinals match native/Metal (${cardinal} at ${material.lightAngle}°)` },
    { field: "refraction" as const, mapping: "approximated" as const, note: preserveColor ? "edge-only displacement without global saturation or brightness compensation; sampled color stays intact, while explicit dispersion and edge lighting remain separate" : "edge-only displacement; also intentionally raises backdrop-filter saturate (see couplings)" },
    { field: "depth" as const, mapping: "approximated" as const, note: `scales edge displacement (linear to depth ${WEB_DEPTH_LINEAR_END}, soft tail to ${WEB_DEPTH_EFFECTIVE_MAX}; effective ${depthEffective}, clamped=${depthClamped}) and rim width (linear to ${WEB_RIM_LINEAR_END}, soft tail to ${WEB_RIM_EFFECTIVE_MAX})` },
    { field: "dispersion" as const, mapping: "approximated" as const, note: "RGB channel separation in the Web runtime; an approximation rather than a spectral solver" },
  ];
  const parameterRanges = [
    {
      field: "depth",
      unit: "logical-px",
      authoredMin: 1,
      authoredMax: 1000,
      effectiveMin: 1,
      effectiveMax: WEB_DEPTH_EFFECTIVE_MAX,
      authored: material.depth,
      effective: depthEffective,
      clamped: depthClamped,
      note: `Web displacement depthFactor is linear on [1,10] then a soft tail through 100; values above 100 clamp`,
    },
    {
      field: "depth.rim",
      unit: "logical-px",
      authoredMin: 1,
      authoredMax: 1000,
      effectiveMin: 1,
      effectiveMax: WEB_RIM_EFFECTIVE_MAX,
      authored: material.depth,
      effective: rimEffective,
      clamped: rimClamped,
      note: `Web receiver rim uses clamped authored depth on [1,100] (historical linear [1,20] then soft tail); mapped rim contribution is delivery.rimDepth (max 40)`,
    },
  ];
  const couplings = preserveColor ? [] : [
    { fromField: "refraction", toChannel: "backdrop-filter.saturate", formula: "1 + 0.35*dispersion + 0.25*refraction", intentional: true, note: "This Web profile also changes artwork saturation; use web-color-preserving when refraction must retain the sampled color treatment" },
    { fromField: "dispersion", toChannel: "backdrop-filter.saturate", formula: "1 + 0.35*dispersion + 0.25*refraction", intentional: true, note: "Dispersion shares the same saturate compensation channel as refraction" },
  ];
  const lightAxis = {
    convention: "native-cardinal@1",
    angleDegrees: material.lightAngle,
    direction: lightDir,
    cardinal,
    note: "Shared Figma/Web/Metal screen-space mapping: 0 down, 90 left, 180 up, 270 right; Web inset highlight uses this vector on the lit edge",
  };
  return {
    css,
    backdropFilter: material.visible ? backdropFilter : "",
    boxShadow: material.visible ? boxShadow : "",
    displacement: material.visible ? displacement : null,
    fidelity,
    parameterRanges: material.visible ? parameterRanges : [],
    couplings: material.visible ? couplings : [],
    lightAxis,
    rimDepth: material.visible ? rimDepth : 0,
  };
}

// --- Canonical identity -----------------------------------------------------

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Canonical appearance values must be finite");
  if (Object.is(value, -0)) value = 0;
  if (value === 0) return "0.0";
  const magnitude = Math.abs(value);
  // serde_json (ryu) prints fixed notation exactly on [1e-5, 1e16); outside
  // that band it uses exponential with an explicit sign ("1e+16", "1e-6").
  // JS String() agrees with ryu inside the band (both print the shortest
  // round-trip digits, plus the ".0" on integer-valued doubles) and
  // toExponential() reproduces ryu's exponential text outside it.
  if (magnitude >= 1e-5 && magnitude < 1e16) {
    return Number.isInteger(value) ? `${value}.0` : String(value);
  }
  return value.toExponential();
}

/** Canonical JSON text: recursively sorted keys, serde_json float text. */
export function canonicalSerialize(value: unknown): string {
  if (value === null || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalSerialize(v)}`).join(",")}}`;
}


/** Delivery fingerprint mirror: binds seed identity + resolved values + target.
 * The identity field is `recipe_fingerprint` in snake_case: the core's
 * fingerprint struct keeps Rust field names (existing receipts pin it). */
export function appearanceDeliveryFingerprint(
  recipeFingerprint: string,
  material: GlassMaterial,
  target: AppearanceDeliveryTarget,
): string {
  return `sha256:${sha256Hex(canonicalSerialize({
    schema: "worldbend.appearance-delivery@0.1",
    version: "0.1",
    recipe_fingerprint: recipeFingerprint,
    material,
    target,
  }))}`;
}

/** Re-compile one delivered state under new values, keeping the same seed. */
export function evaluateAppearanceDelivery(
  base: AppearanceDeliveryPlan,
  material: GlassMaterial,
): AppearanceDeliveryPlan {
  if (base.target !== "web" && base.target !== "web-color-preserving") throw new Error("Local evaluation currently mirrors Web receiving profiles only");
  return {
    ...structuredClone(base),
    material,
    web: compileWebAppearance(material, base.target === "web-color-preserving"),
    fingerprint: appearanceDeliveryFingerprint(base.recipeFingerprint, material, base.target),
  };
}

// --- Preference semantics ---------------------------------------------------

export interface PreferenceFieldReceipt {
  field: GlassFieldId;
  state: "applied" | "not-exposed";
  reason: string;
}
function applyField(material: GlassMaterial, field: GlassFieldId, value: boolean | number): void {
  if (field === "visible") material.visible = value as boolean;
  else if (typeof value !== "number") throw new Error(`Field ${field} needs a numeric override`);
  else if (field === "light-intensity") material.lightIntensity = value;
  else if (field === "light-angle") material.lightAngle = value;
  else if (field === "refraction") material.refraction = value;
  else if (field === "depth") material.depth = value;
  else if (field === "dispersion") material.dispersion = value;
  else if (field === "radius") material.radius = value;
}

/** Which saved overrides drive the effective material under the pinned
 * exposure report; hidden ones stay saved with a receipt, exactly like the
 * canonical core split. A radius override saved through an exposed clarity
 * composite stays applied even when raw radius is not itself exposed. */
export function effectiveOverrides(
  record: AppearancePreferenceRecord,
  exposure?: AppearanceExposureReport | null,
): { applied: GlassFieldId[]; receipts: PreferenceFieldReceipt[] } {
  const applied: GlassFieldId[] = [];
  const receipts: PreferenceFieldReceipt[] = [];
  const clarityOwnsRadius = !!exposure
    && exposure.controls.some(row => row.field === "clarity" && row.state === "exposed")
    && exposure.clarity?.mapsTo === "radius";
  const radiusDirectlyExposed = !!exposure
    && exposure.controls.some(row => row.field === "radius" && row.state === "exposed");
  for (const field of GLASS_FIELD_IDS) {
    const override = record.fields?.[field];
    if (!override) continue;
    const row = exposure?.controls.find(control => control.field === field);
    // Only a hidden radius row is carried by the composite; a directly
    // exposed radius row applies the override under its own name.
    const carriedByClarity = clarityOwnsRadius && field === "radius" && !radiusDirectlyExposed;
    if (row && exposure && row.state === "not-exposed" && !carriedByClarity) {
      receipts.push({
        field,
        state: "not-exposed",
        reason: `the current exposure policy (revision ${exposure.policyRevision}) does not expose \`${field}\`; the override stays saved and applies again when the field is re-exposed`,
      });
    } else {
      applied.push(field);
      receipts.push({
        field,
        state: "applied",
        reason: carriedByClarity
          ? "explicit override applied through the exposed clarity composite"
          : "explicit override applied to the effective material",
      });
    }
  }
  return { applied, receipts };
}

/** Resolve a preference against a delivered base, fully locally. */
export function resolvePreferenceLocally(
  base: AppearanceDeliveryPlan,
  record: AppearancePreferenceRecord,
  exposure?: AppearanceExposureReport | null,
): { material: GlassMaterial; delivery: AppearanceDeliveryPlan; receipts: PreferenceFieldReceipt[] } {
  if (exposure && exposure.target !== base.target) throw new Error("Exposure report target must match the receiving profile");
  const { applied, receipts } = effectiveOverrides(record, exposure);
  const material = structuredClone(base.material);
  for (const field of applied) applyField(material, field, record.fields![field]!.value as boolean | number);
  validateGlassMaterial(material);
  return { material, delivery: evaluateAppearanceDelivery(base, material), receipts };
}

export function validateGlassMaterial(material: GlassMaterial): void {
  const values = [material.lightIntensity, material.lightAngle, material.refraction, material.depth, material.dispersion, material.radius];
  if (!values.every(Number.isFinite) || material.radius < 0 || material.radius > 1000
    || material.depth < 1 || material.depth > 1000 || material.refraction < 0 || material.refraction > 1
    || material.dispersion < 0 || material.dispersion > 1 || material.lightIntensity < 0
    || material.lightIntensity > 1 || material.lightAngle < 0 || material.lightAngle >= 360
    || typeof material.visible !== "boolean") throw new Error("Invalid glass material");
}

/** Mirror of the versioned clarity composite: 1 clearest, 0 most solid. */
export function clarityToRadius(clarity: number, rangeMin: number, rangeMax: number): number {
  if (!Number.isFinite(clarity) || clarity < 0 || clarity > 1) throw new Error("clarity must be in [0,1]");
  if (!(rangeMin <= rangeMax) || rangeMin < 0) throw new Error("clarity frost range must satisfy 0 <= min <= max");
  return rangeMin + (rangeMax - rangeMin) * (1 - clarity);
}
