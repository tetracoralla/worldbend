import type { CardRig, CardView } from "./types";

/** Compose motion without exhausting the static view's input domain. Only
 * equivalent rendering angles wrap; callers retain cumulative action state. */
export function localCardView(view: CardView): CardView {
  const result = {...view};
  for (const key of ["rotateX", "rotateY", "rotateZ"] as const) {
    const angle = result[key];
    if (angle !== undefined && Math.abs(angle) > 3600) result[key] = angle % 360;
  }
  return result;
}

const CARD_SCHEMA = "worldbend.card";
const CARD_VERSION = "0.1";
const FINITE = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const UNIT = (value: unknown): boolean =>
  typeof value === "object" && value !== null &&
  Object.keys(value).every(key => key === "x" || key === "y") &&
  FINITE((value as { x?: unknown }).x) && FINITE((value as { y?: unknown }).y) &&
  (value as { x: number }).x >= 0 && (value as { x: number }).x <= 1 &&
  (value as { y: number }).y >= 0 && (value as { y: number }).y <= 1;

/** Mirror of the core's `worldbend.card` validation for the UI→host boundary.
 * The core stays the projection implementation; this only rejects malformed
 * host traffic before it reaches document storage. */
export function isCardRig(value: unknown): value is CardRig {
  if (typeof value !== "object" || value === null) return false;
  const rig = value as Record<string, unknown>;
  if (Object.keys(rig).some((key) =>
    !["schema", "version", "elementSize", "geometry", "rest", "back", "tilt", "action"].includes(key)))
    return false;
  if (rig["schema"] !== CARD_SCHEMA || rig["version"] !== CARD_VERSION) return false;
  if (rig["rest"] !== undefined && !isCardView(rig["rest"])) return false;
  const size = rig["elementSize"] as { width?: unknown; height?: unknown } | undefined;
  if (!size || typeof size !== "object" || Object.keys(size).some(key => !["width", "height"].includes(key)) || !FINITE(size.width) || !FINITE(size.height) ||
      size.width <= 0 || size.height <= 0) return false;
  const geometry = rig["geometry"] as Record<string, unknown> | undefined;
  if (!geometry || typeof geometry !== "object" || Object.keys(geometry).some(key => !["perspective", "pivot", "perspectiveOrigin"].includes(key)) || !FINITE(geometry["perspective"]) || geometry["perspective"] < 1) return false;
  if (geometry["pivot"] !== undefined && !UNIT(geometry["pivot"])) return false;
  if (geometry["perspectiveOrigin"] !== undefined && !UNIT(geometry["perspectiveOrigin"])) return false;
  if (rig["back"] !== undefined) {
    const back = rig["back"] as { treatment?: unknown } | undefined;
    if (!back || back["treatment"] !== "mirror" || Object.keys(back).length !== 1) return false;
  }
  const tilt = rig["tilt"] as Record<string, unknown> | undefined;
  if (!tilt || typeof tilt !== "object") return false;
  if (Object.keys(tilt).some((key) =>
    !["maxRotateX", "maxRotateY", "pointerRegion", "idle", "smoothingMs", "settleMs"].includes(key)))
    return false;
  if (!FINITE(tilt["maxRotateX"]) || tilt["maxRotateX"] < 0 || tilt["maxRotateX"] > 90) return false;
  if (!FINITE(tilt["maxRotateY"]) || tilt["maxRotateY"] < 0 || tilt["maxRotateY"] > 90) return false;
  if (tilt["smoothingMs"] !== undefined && (!FINITE(tilt["smoothingMs"]) || tilt["smoothingMs"] < 0 || tilt["smoothingMs"] > 2000)) return false;
  if (tilt["settleMs"] !== undefined && (!FINITE(tilt["settleMs"]) || tilt["settleMs"] < 0 || tilt["settleMs"] > 5000)) return false;
  if (tilt["pointerRegion"] !== undefined) {
    const region = tilt["pointerRegion"] as Record<string, unknown> | undefined;
    if (!region || typeof region !== "object" || Object.keys(region).some(key => !["x", "y", "width", "height"].includes(key)) || !FINITE(region["x"]) || !FINITE(region["y"]) ||
        !FINITE(region["width"]) || !FINITE(region["height"]) ||
        region["x"] < 0 || region["y"] < 0 || region["width"] <= 0 || region["height"] <= 0 ||
        region["x"] + region["width"] > 1 || region["y"] + region["height"] > 1) return false;
  }
  if (tilt["idle"] !== null && tilt["idle"] !== undefined) {
    const idle = tilt["idle"] as Record<string, unknown>;
    if (!idle || typeof idle !== "object" || Object.keys(idle).some(key => !["amplitudeX", "amplitudeY", "periodMs"].includes(key))) return false;
    if (!FINITE(idle["amplitudeX"]) || idle["amplitudeX"] < 0 || idle["amplitudeX"] > 45) return false;
    if (!FINITE(idle["amplitudeY"]) || idle["amplitudeY"] < 0 || idle["amplitudeY"] > 45) return false;
    if (!FINITE(idle["periodMs"]) || idle["periodMs"] < 100 || idle["periodMs"] > 60000) return false;
  }
  const action = rig["action"] as Record<string, unknown> | undefined;
  if (!action || typeof action !== "object" || Array.isArray(action)) return false;
  if (Object.keys(action).some((key) =>
    !["axis", "direction", "turns", "durationMs", "easing", "interruption"].includes(key)))
    return false;
  if (action["axis"] !== undefined && action["axis"] !== "x" && action["axis"] !== "y") return false;
  if (action["direction"] !== undefined && action["direction"] !== 1 && action["direction"] !== -1) return false;
  if (action["turns"] !== undefined && (!Number.isInteger(action["turns"]) || (action["turns"] as number) < 1 || (action["turns"] as number) > 8)) return false;
  if (action["durationMs"] !== undefined && (!FINITE(action["durationMs"]) || action["durationMs"] < 100 || action["durationMs"] > 10000)) return false;
  if (action["interruption"] !== undefined && action["interruption"] !== "ignore-while-active") return false;
  if (action["easing"] !== undefined && !isEasing(action["easing"])) return false;
  return true;
}

function isEasing(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const easing = value as { kind?: unknown; x1?: unknown; y1?: unknown; x2?: unknown; y2?: unknown };
  if (Object.keys(easing).some((key) => !["kind", "x1", "y1", "x2", "y2"].includes(key))) return false;
  if (easing["kind"] === "linear" || easing["kind"] === "hold") return Object.keys(easing).length === 1;
  if (easing["kind"] !== "cubicBezier") return false;
  return FINITE(easing["x1"]) && FINITE(easing["y1"]) && FINITE(easing["x2"]) && FINITE(easing["y2"]) &&
    easing["x1"] >= 0 && easing["x1"] <= 1 && easing["x2"] >= 0 && easing["x2"] <= 1 &&
    easing["y1"] >= -4 && easing["y1"] <= 4 && easing["y2"] >= -4 && easing["y2"] <= 4;
}

export function isCardView(value: unknown): value is CardView {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const view = value as Record<string, unknown>;
  if (Object.keys(view).some((key) => !["rotateX", "rotateY", "rotateZ", "depth", "translate"].includes(key)))
    return false;
  for (const key of ["rotateX", "rotateY", "rotateZ", "depth"] as const) {
    if (view[key] === undefined) continue;
    if (!FINITE(view[key])) return false;
    if (key.startsWith("rotate") && Math.abs(view[key] as number) > 3600) return false;
    if (key === "depth" && Math.abs(view[key] as number) > 1e6) return false;
  }
  if (view["translate"] !== undefined) {
    const point = view["translate"] as { x?: unknown; y?: unknown };
    if (!point || typeof point !== "object" || Object.keys(point).some(key => !["x", "y"].includes(key)) || !FINITE(point?.x) || !FINITE(point?.y)) return false;
  }
  return true;
}
