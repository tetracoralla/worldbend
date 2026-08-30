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

export function parseWarpControls(preset: string, amountPercent: string): WarpSpec | undefined {
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
  return { preset: preset as WarpPreset, amount: amount / 100 };
}

export function warpAmountPercent(warp: WarpSpec | undefined): string {
  // The formatted text is re-parsed whenever the user changes only the
  // preset, so it must round-trip the stored amount losslessly (a rounded
  // display like 33.3 would silently rewrite 0.3333 to 0.333).
  const percent = Number((warp?.amount ?? 0.5).toFixed(6)) * 100;
  return String(Number(percent.toFixed(4)));
}
