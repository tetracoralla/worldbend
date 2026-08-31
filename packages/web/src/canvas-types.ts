import type {
  CanvasBackground as GeneratedCanvasBackground,
  CanvasOperation as GeneratedCanvasOperation,
  CanvasPlan as GeneratedCanvasPlan,
  CanvasSetPlan as GeneratedCanvasSetPlan,
  CanvasSetSpec as GeneratedCanvasSetSpec,
  CanvasSpec as GeneratedCanvasSpec,
  CanvasVariant as GeneratedCanvasVariant,
  NormalizedAnchor as GeneratedCanvasAnchor,
  PixelRect as GeneratedCanvasPixelRect,
  PixelSize as GeneratedCanvasPixelSize,
} from "./generated/core-contract";

/** Rust-schema-owned Canvas wire aliases used by the WASM and carrier adapters. */
export type CanvasPixelSize = GeneratedCanvasPixelSize;
export type CanvasPixelRect = GeneratedCanvasPixelRect;
export type CanvasAnchor = GeneratedCanvasAnchor;
export type CanvasBackground = GeneratedCanvasBackground;
export type CanvasOperation = GeneratedCanvasOperation;
export type CanvasSpecInput = GeneratedCanvasSpec;
/** Dynamic carrier array; Rust remains the owner of the generated 1..16 validation. */
export type CanvasSetSpecInput = Omit<GeneratedCanvasSetSpec, "variants"> & {
  variants: GeneratedCanvasVariant[];
};
export type CanvasPlan = GeneratedCanvasPlan;
export type CanvasSetPlan = GeneratedCanvasSetPlan;
