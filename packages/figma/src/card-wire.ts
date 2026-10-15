import type { CardFace, CardRig, CardView } from "@worldbend/web/types";
import { isCardRig } from "@worldbend/web/card-state";
export { isCardRig, isCardView } from "@worldbend/web/card-state";

/** The binding this plugin stores on a node: the accepted rig plus its
 * optional authored back face node. Document-level content bindings live
 * here, not inside the core geometry state. */
export interface StoredCardBinding {
  schema: "worldbend.card-binding";
  version: "0.1";
  rig: CardRig;
  backNodeId?: string;
}

export function parseStoredCardBinding(raw: string): StoredCardBinding | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return undefined;
    const binding = value as Record<string, unknown>;
    if (binding["schema"] !== "worldbend.card-binding" || binding["version"] !== "0.1") return undefined;
    if (!isCardRig(binding["rig"])) return undefined;
    if (binding["backNodeId"] !== undefined &&
        (typeof binding["backNodeId"] !== "string" || binding["backNodeId"].length === 0 || binding["backNodeId"].length > 64))
      return undefined;
    return value as StoredCardBinding;
  } catch {
    return undefined;
  }
}

export type { CardFace, CardRig, CardView };

export interface CardSample {
  kind: "pose" | "turn" | "angle" | "pointer" | "live";
  progress?: number;
  position?: {x: number; y: number};
  tiltX?: number;
  tiltY?: number;
  angle?: number;
  timeMs?: number;
}
export function isCardSample(value: unknown): value is CardSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (!Object.keys(v).every(key => ["kind", "progress", "position", "tiltX", "tiltY", "angle", "timeMs"].includes(key)) ||
      !["pose", "turn", "angle", "pointer", "live"].includes(String(v["kind"]))) return false;
  for (const key of ["progress", "tiltX", "tiltY", "angle", "timeMs"]) {
    if (v[key] !== undefined && (typeof v[key] !== "number" || !Number.isFinite(v[key]))) return false;
  }
  if (v["progress"] !== undefined && ((v["progress"] as number) < 0 || (v["progress"] as number) > 1)) return false;
  if (v["timeMs"] !== undefined && (v["timeMs"] as number) < 0) return false;
  if (v["position"] !== undefined) {
    const position = v["position"] as Record<string, unknown>;
    if (!position || typeof position !== "object" || Object.keys(position).length !== 2 ||
        ![position["x"], position["y"]].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1)) return false;
  }
  return (v["kind"] !== "turn" && v["kind"] !== "angle" || v["progress"] !== undefined) &&
    (v["kind"] !== "pointer" || v["position"] !== undefined);
}
