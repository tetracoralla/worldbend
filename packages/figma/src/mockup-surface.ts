import type { MockupSurface } from "@worldbend/web";

export function isMockupSurface(value: unknown): value is MockupSurface {
  if (!record(value)) return false;
  const common = ["kind", ...(value.light === undefined ? [] : ["light"])];
  if (value.light !== undefined && (!record(value.light) || !keys(value.light,["strength","direction"]) || !unit(value.light.strength) || !signed(value.light.direction))) return false;
  if (value.kind === "cylinder") return keys(value,[...common,"curvature",...(value.tilt === undefined ? [] : ["tilt"])]) && unit(value.curvature) && (value.tilt === undefined || signed(value.tilt));
  if (value.kind === "fabric") return keys(value,[...common,"folds","depth",...(value.phase === undefined ? [] : ["phase"])]) && Number.isInteger(value.folds) && typeof value.folds === "number" && value.folds >= 1 && value.folds <= 4 && unit(value.depth) && (value.phase === undefined || unit(value.phase));
  return false;
}

export interface MockupSurfaceControls {
  kind: string;
  amount: string;
  tilt: string;
  folds: string;
  phase: string;
  light: string;
  direction: string;
}

export function surfacePercent(value: number): string { return String(Number((value * 100).toPrecision(12))); }

export function mockupSurfaceControls(surface?: MockupSurface | null): MockupSurfaceControls {
  return { kind: surface?.kind ?? "", amount: surfacePercent(surface?.kind === "cylinder" ? surface.curvature : surface?.kind === "fabric" ? surface.depth : 0.7),
    tilt: surfacePercent(surface?.kind === "cylinder" ? surface.tilt ?? 0 : 0), folds: String(surface?.kind === "fabric" ? surface.folds : 2),
    phase: surfacePercent(surface?.kind === "fabric" ? surface.phase ?? 0 : 0),
    light: surfacePercent(surface?.light?.strength ?? 0.65), direction: surfacePercent(surface?.light?.direction ?? -0.45) };
}

export function parseMockupSurfaceControls(input: MockupSurfaceControls, previous?: MockupSurface | null): MockupSurface | undefined {
  if (input.kind === "") return undefined;
  if (input.kind !== "cylinder" && input.kind !== "fabric") throw new Error("Invalid surface");
  const prior = mockupSurfaceControls(previous);
  const percent = (key: "amount" | "tilt" | "phase" | "light" | "direction", old: number | undefined): number => {
    const text = input[key];
    if (!text.trim()) throw new Error("Missing surface value");
    if (old !== undefined && input.kind === previous?.kind && text === prior[key]) return old;
    const value = Number(text) / 100;
    const minimum = key === "tilt" || key === "direction" ? -1 : 0;
    if (!Number.isFinite(value) || value < minimum || value > 1) throw new Error("Invalid surface value");
    return value;
  };
  const light = {strength: percent("light",previous?.light?.strength), direction:percent("direction",previous?.light?.direction)};
  const surface: MockupSurface = input.kind === "cylinder"
    ? {kind:"cylinder",curvature:percent("amount",previous?.kind === "cylinder" ? previous.curvature : undefined),tilt:percent("tilt",previous?.kind === "cylinder" ? previous.tilt : undefined),light}
    : {kind:"fabric",folds:Number(input.folds),depth:percent("amount",previous?.kind === "fabric" ? previous.depth : undefined),phase:percent("phase",previous?.kind === "fabric" ? previous.phase : undefined),light};
  if (!isMockupSurface(surface)) throw new Error("Invalid surface");
  return surface;
}

function record(value: unknown): value is Record<string,unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string,unknown>, expected: string[]): boolean { const actual = Object.keys(value); return actual.length === expected.length && expected.every(key => Object.hasOwn(value,key)); }
function unit(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function signed(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1; }
