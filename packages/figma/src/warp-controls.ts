import type { WarpPreset, WarpSpec } from "@worldbend/web";

export const WARP_PRESETS: readonly WarpPreset[] = [
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
] as const;

export function parseWarpControls(preset: string, amountPercent: string, previous?: WarpSpec): WarpSpec | undefined {
  if (preset === "") return undefined;
  if (!(WARP_PRESETS as readonly string[]).includes(preset)) {
    throw new Error("The Warp preset is invalid");
  }
  if (amountPercent.trim().length === 0) {
    throw new Error("The Warp amount must be between -100 and 100");
  }
  const amount = Number(amountPercent);
  if (!Number.isFinite(amount) || amount < -100 || amount > 100) {
    throw new Error("The Warp amount must be between -100 and 100");
  }
  const unchanged = previous && Number.isFinite(previous.amount) && Math.abs(previous.amount) <= 1 &&
    amountPercent === warpAmountPercent(previous);
  return { preset: preset as WarpPreset, amount: unchanged ? previous.amount : amount / 100 };
}

export function warpAmountPercent(warp: WarpSpec | undefined): string {
  // Keep the human field compact. Callers pass the previous Warp to parsing
  // so an unchanged field preserves the exact saved strength on preset edits.
  const percent = Number((warp?.amount ?? 0.5).toFixed(6)) * 100;
  return String(Number(percent.toFixed(4)));
}
