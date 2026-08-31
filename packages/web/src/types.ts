import type {
  AffineComposition as GeneratedAffineComposition,
  Content as GeneratedContent,
  RectifyPlan as GeneratedRectifyPlan,
  RectifySpec as GeneratedRectifySpec,
  TransformError as GeneratedTransformError,
  TransformSpec as GeneratedTransformSpec,
  Quad,
  SolveOutput as GeneratedSolveOutput,
  SourceOrientation,
  TransformRecipe as GeneratedTransformRecipe,
  WarpSpec,
} from "./generated/core-contract";

export type {
  CanvasAnchor,
  CanvasBackground,
  CanvasOperation,
  CanvasPixelRect,
  CanvasPixelSize,
  CanvasPlan,
  CanvasSetPlan,
  CanvasSetSpecInput,
  CanvasSpecInput,
} from "./canvas-types";

export type {
  Bounds,
  CssTransform,
  Destination,
  ErrorCode,
  Homography,
  Point,
  PixelSize,
  Quad,
  RectifyDiagnostics,
  SourcePlane,
  Size,
  SourceOrientation,
  WarpMesh,
  WarpPreset,
  WarpSpec,
  WarpVertex,
} from "./generated/core-contract";

/** Exact Rust deserialization surface, including serde defaults and nulls. */
export type TransformSpecInput = GeneratedTransformSpec;

/** Exact Rust deserialization surface for explicit planar rectification. */
export type RectifySpecInput = GeneratedRectifySpec;

/** Deterministic core plan for mapping the selected source quad to the output rectangle. */
export type RectifyPlan = GeneratedRectifyPlan;

/** Canonical Rust serialization omits a missing warp instead of emitting null. */
export type TransformContent = Omit<GeneratedContent, "warp"> & {
  warp?: WarpSpec;
};

/** Normalized spec returned by the core and retained by the editors. */
export type TransformSpec = Omit<GeneratedTransformSpec, "content"> & {
  content: TransformContent;
};

/** Exact Rust TransformRecipe deserialization surface with all serde defaults. */
export type TransformRecipeInput = GeneratedTransformRecipe;

/** Fully materialized recipe used by direct-manipulation controllers. */
export type TransformRecipe = Omit<
  GeneratedTransformRecipe,
  "scale" | "rotationDegrees" | "skew" | "translation" | "pivot" | "flip" | "warp"
> & {
  scale: NonNullable<GeneratedTransformRecipe["scale"]>;
  rotationDegrees: NonNullable<GeneratedTransformRecipe["rotationDegrees"]>;
  skew: NonNullable<GeneratedTransformRecipe["skew"]>;
  translation: NonNullable<GeneratedTransformRecipe["translation"]>;
  pivot: NonNullable<GeneratedTransformRecipe["pivot"]>;
  flip?: { x: boolean; y: boolean };
  warp?: WarpSpec;
};

export type NineNumbers = GeneratedSolveOutput["homography"]["matrix"];

/** Core output with its normalized TransformSpec made explicit. */
export type SolveOutput = Omit<GeneratedSolveOutput, "spec"> & {
  spec: TransformSpec;
};

/** Fixed-layout WASM preview result; diagnostics stay on the full solve path. */
export type PreviewSolveOutput = {
  resolvedDestination: { reference: GeneratedSolveOutput["resolvedDestination"]["reference"] };
  homography: { matrix: GeneratedSolveOutput["homography"]["matrix"] };
};

/** Core output with its normalized TransformSpec made explicit. */
export type AffineComposition = Omit<GeneratedAffineComposition, "spec"> & {
  spec: TransformSpec;
};

export type TransformErrorData = GeneratedTransformError;

export function identityTransformRecipe(): TransformRecipe {
  return {
    scale: { x: 1, y: 1 },
    rotationDegrees: 0,
    skew: { xDegrees: 0, yDegrees: 0 },
    translation: { x: 0, y: 0 },
    pivot: { x: 0.5, y: 0.5 },
    flip: { x: false, y: false },
  };
}

export function normalizedSpec(
  quad: Quad,
  orientation?: SourceOrientation,
  warp?: WarpSpec,
): TransformSpec {
  return {
    schema: "worldbend.transform",
    version: "0.1",
    destination: { space: "normalized", quad },
    content: {
      fit: "stretch",
      ...(orientation && orientation !== "native" ? { orientation } : {}),
      ...(warp ? { warp: { ...warp } } : {}),
    },
  };
}

export function cloneQuad(quad: Quad): Quad {
  return {
    tl: { x: quad.tl.x, y: quad.tl.y },
    tr: { x: quad.tr.x, y: quad.tr.y },
    br: { x: quad.br.x, y: quad.br.y },
    bl: { x: quad.bl.x, y: quad.bl.y },
  };
}

export function unitQuad(): Quad {
  return {
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 },
  };
}
