// @generated from Rust core JSON Schema. Do not edit by hand.

export type FitMode = "stretch";
/**
 * Explicit source orientation recorded in the spec. A flip mirrors the
 * source plane inside the destination quad; it is never expressed by
 * reordering destination corners, which would reverse the quad's winding
 * and silently change corner identity.
 */
export type SourceOrientation = "native" | "flipHorizontal" | "flipVertical" | "flipBoth";
export type WarpPreset =
  "arc" | "arch" | "flag" | "wave" | "fish" | "rise" | "fisheye" | "inflate" | "squeeze" | "twist";
export type Destination =
  | {
      quad: Quad1;
      reference: Size;
      space: "pixel";
    }
  | {
      quad: Quad1;
      space: "normalized";
    };
export type CanvasBackground =
  | {
      kind: "transparent";
    }
  | {
      kind: "color";
      /**
       * @minItems 4
       * @maxItems 4
       */
      rgba: [number, number, number, number];
      space: Srgb8Space;
    };
export type Srgb8Space = "srgb8";
export type CanvasOperationKind = "crop" | "trim" | "pad" | "contain" | "cover" | "stretch";
export type CanvasOperation =
  | {
      kind: "crop";
      rect: PixelRect;
    }
  | {
      alphaThreshold: number;
      kind: "trim";
    }
  | {
      background: CanvasBackground;
      insets: CanvasInsets;
      kind: "pad";
    }
  | {
      anchor: NormalizedAnchor;
      background: CanvasBackground;
      kind: "contain";
      output: {
        height: number;
        width: number;
      };
    }
  | {
      anchor: NormalizedAnchor;
      background: CanvasBackground;
      kind: "cover";
      output: {
        height: number;
        width: number;
      };
    }
  | {
      kind: "stretch";
      output: {
        height: number;
        width: number;
      };
    };
export type CoordinateSpace = "pixel" | "normalized";
export type MockupEdge = "top" | "right" | "bottom" | "left";
/**
 * Coordinate system for the explicitly selected plane in the source image.
 * Pixel coordinates require the reference image size that authored them;
 * normalized coordinates are reusable across source resolutions.
 */
export type SourcePlane =
  | {
      quad: Quad1;
      reference: Size;
      space: "pixel";
    }
  | {
      quad: Quad1;
      space: "normalized";
    };
export type RemapOperation =
  | {
      center?: Point2;
      coefficients: LensCoefficients;
      kind: "lens";
      scale?: LensScale;
    }
  | {
      boundary?: "transparent" | "clamp" | "wrap";
      kind: "displacement";
      neutral?: number;
      scaleXPixels: number;
      scaleYPixels: number;
      xChannel: RemapChannel;
      yChannel: RemapChannel;
    }
  | {
      boundary?: "transparent" | "clamp" | "wrap";
      kind: "displacementUnit";
      neutral?: number;
      scaleXPixels: number;
      scaleYPixels: number;
      xChannel: RemapChannel;
      yChannel: RemapChannel;
    };
export type RemapChannel = "red" | "green" | "blue" | "alpha" | "luminance";
export type SpatialTemplateOperationKind = "rasterProgram" | "mockup";
export type SpatialTemplateOutputKind = "single" | "canvasSet";
export type RasterProgramStageKind = "transform" | "rectify" | "canvas";
export type SpatialTemplateOperation =
  | {
      kind: "rasterProgram";
      program: RasterProgramSpec;
      sourceSlot: string;
    }
  | {
      kind: "mockup";
      spec: MockupSpec;
    };
export type RasterProgramStage =
  | {
      canvas?: "tight" | "reference";
      id: string;
      kind: "transform";
      spec: TransformSpec1;
      target_size?: Size | null;
    }
  | {
      id: string;
      kind: "rectify";
      spec: RectifySpec;
    }
  | {
      id: string;
      kind: "canvas";
      spec: CanvasSpec;
    };
export type SpatialTemplateOutput =
  | {
      id: string;
      kind: "single";
    }
  | {
      kind: "canvasSet";
      spec: CanvasSetSpec;
    };
export type ErrorCode =
  | "E_SCHEMA"
  | "E_NON_FINITE_COORDINATE"
  | "E_QUAD_SELF_INTERSECT"
  | "E_QUAD_CONCAVE"
  | "E_QUAD_ORIENTATION"
  | "E_QUAD_DEGENERATE"
  | "E_EDGE_TOO_SHORT"
  | "E_HOMOGRAPHY_SINGULAR"
  | "E_HOMOGRAPHY_HORIZON_CROSSING"
  | "E_REPROJECTION"
  | "E_CROP_BOUNDS"
  | "E_TRIM_EMPTY"
  | "E_RASTER_SHAPE_MISMATCH"
  | "E_OUTPUT_COLLISION"
  | "E_SHARED_EDGE_MISMATCH"
  | "E_UNSUPPORTED_MEDIA"
  | "E_OUTPUT_LIMIT"
  | "E_PATH_OUTSIDE_ROOT"
  | "E_PATH_SYMLINK"
  | "E_DESTINATION_EXISTS"
  | "E_RENDER"
  | "E_CAPACITY"
  | "E_CANCELLED"
  | "E_TIMEOUT"
  | "E_MEMORY"
  | "E_INTERNAL";
export type VariationFailurePolicy = "allOrNone" | "continue";

/**
 * One mechanically generated schema surface for the Web/WASM carrier. The
 * wrapper is never serialized at runtime; it makes the Rust-owned input,
 * normalized output, mesh, CSS, and structured-error contracts available to
 * the TypeScript generator without a second handwritten semantic model.
 */
export interface WebContract {
  affineCompositionOutput: AffineComposition;
  canvasPlanOutput: CanvasPlan;
  canvasSetPlanOutput: CanvasSetPlan;
  canvasSetSpecInput: CanvasSetSpec;
  canvasSpecInput: CanvasSpec;
  cssTransformOutput: CssTransform;
  meshWarpPlanOutput: MeshWarpPlan;
  meshWarpSpecInput: MeshWarpSpec;
  mockupPlanOutput: MockupPlan;
  mockupSpecInput: MockupSpec;
  planePoseInput: PlanePoseInput;
  planePoseOutput: PlanePoseOutput;
  planeStripInput: PlaneStripInput;
  planeStripOutput: PlaneStripOutput;
  rectifyPlanOutput: RectifyPlan;
  rectifySpecInput: RectifySpec;
  remapPlanOutput: RemapPlan;
  remapSpecInput: RemapSpec;
  solveOutput: SolveOutput;
  spatialTemplateInspectionOutput: SpatialTemplateInspection;
  spatialTemplateSpecInput: SpatialTemplateSpec;
  surfaceDeformationPlanOutput: SurfaceDeformationPlan;
  surfaceDeformationSpecInput: SurfaceDeformationSpec;
  transformError: TransformError;
  transformRecipeInput: TransformRecipe;
  transformSpecInput: TransformSpec1;
  variationJobPlanOutput: VariationJobPlan;
  variationJobSpecInput: VariationJobSpec;
  warpMeshOutput: WarpMesh;
}
export interface AffineComposition {
  canvas: TransformCanvas;
  diagnostics: SolveDiagnostics;
  /**
   * Affine matrix in the RAW resolved-destination frame: it maps base
   * destination pixels to raw output pixels, while `spec`/`canvas` are
   * canvas-relative. Chaining this composition as the next base re-pays
   * the integer floor/ceil canvas quantization (up to one pixel per
   * cycle); consumers who require drift-free iteration must retain the
   * original base and the accumulated recipe instead.
   *
   * @minItems 9
   * @maxItems 9
   */
  matrix: [number, number, number, number, number, number, number, number, number];
  rawBounds: Bounds;
  rawQuad: Quad;
  spec: TransformSpec;
}
export interface TransformCanvas {
  origin: Point;
  size: Size;
}
export interface Point {
  x: number;
  y: number;
}
export interface Size {
  height: number;
  width: number;
}
export interface SolveDiagnostics {
  bounds: Bounds;
  geometry: GeometryDiagnostics;
  matrix: MatrixDiagnostics;
  reprojection: ReprojectionDiagnostics;
}
export interface Bounds {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface GeometryDiagnostics {
  convex: boolean;
  /**
   * @minItems 4
   * @maxItems 4
   */
  edgeLengths: [number, number, number, number];
  orientation: "clockwise-screen";
  selfIntersecting: boolean;
  signedArea: number;
}
export interface MatrixDiagnostics {
  determinant: number;
  invertible: boolean;
  minAbsW: number;
}
export interface ReprojectionDiagnostics {
  limit: number;
  max: number;
  mean: number;
  /**
   * @minItems 4
   * @maxItems 4
   */
  points: [ReprojectionPoint, ReprojectionPoint, ReprojectionPoint, ReprojectionPoint];
}
export interface ReprojectionPoint {
  actual: Point;
  corner: "tl" | "tr" | "br" | "bl";
  error: number;
  expected: Point;
}
/**
 * Transformed destination quad in the BASE destination pixel frame.
 */
export interface Quad {
  bl: Point;
  br: Point;
  tl: Point;
  tr: Point;
}
/**
 * Normalized spec for the tight canvas; its quad is canvas-relative.
 */
export interface TransformSpec {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface Content {
  fit: FitMode;
  orientation?: SourceOrientation;
  warp?: WarpSpec | null;
}
export interface WarpSpec {
  /**
   * Signed preset strength. Zero is identity; the closed supported domain
   * is [-1, 1]. Negative values reverse the preset's direction.
   */
  amount: number;
  preset: WarpPreset;
}
export interface Quad1 {
  bl: Point;
  br: Point;
  tl: Point;
  tr: Point;
}
export interface CanvasPlan {
  background?: CanvasBackground | null;
  operation: CanvasOperationKind;
  outputSize: {
    height: number;
    width: number;
  };
  placement: CanvasPlacement;
  scale: CanvasScale;
  schema: "worldbend.canvas-plan";
  sourceRect: PixelRect;
  sourceSize: PixelSize;
  version: "0.1";
}
export interface CanvasPlacement {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface CanvasScale {
  x: number;
  y: number;
}
export interface PixelRect {
  height: number;
  width: number;
  x: number;
  y: number;
}
export interface PixelSize {
  height: number;
  width: number;
}
export interface CanvasSetPlan {
  schema: "worldbend.canvas-set-plan";
  sourceSize: PixelSize;
  /**
   * @minItems 1
   * @maxItems 16
   */
  variants:
    | [CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan, CanvasVariantPlan]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ]
    | [
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan,
        CanvasVariantPlan
      ];
  version: "0.1";
}
export interface CanvasVariantPlan {
  id: string;
  plan: CanvasPlan;
}
export interface CanvasSetSpec {
  schema: "worldbend.canvas-set";
  /**
   * @minItems 1
   * @maxItems 16
   */
  variants:
    | [CanvasVariant]
    | [CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant, CanvasVariant]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ]
    | [
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant,
        CanvasVariant
      ];
  version: "0.1";
}
export interface CanvasVariant {
  id: string;
  operation: CanvasOperation;
}
export interface CanvasInsets {
  bottom: number;
  left: number;
  right: number;
  top: number;
}
export interface NormalizedAnchor {
  x: number;
  y: number;
}
export interface CanvasSpec {
  operation: CanvasOperation;
  schema: "worldbend.canvas";
  version: "0.1";
}
export interface CssTransform {
  height: string;
  /**
   * @minItems 16
   * @maxItems 16
   */
  matrix3d: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];
  transform: string;
  transformOrigin: "0 0";
  width: string;
}
export interface MeshWarpPlan {
  schema: string;
  solve: SolveOutput;
  spec: MeshWarpSpec;
  version: string;
}
export interface SolveOutput {
  diagnostics: SolveDiagnostics;
  homography: Homography;
  resolvedDestination: ResolvedDestination;
  spec: TransformSpec1;
}
export interface Homography {
  /**
   * @minItems 9
   * @maxItems 9
   */
  inverse: [number, number, number, number, number, number, number, number, number];
  /**
   * @minItems 9
   * @maxItems 9
   */
  matrix: [number, number, number, number, number, number, number, number, number];
}
export interface ResolvedDestination {
  quad: Quad1;
  reference: Size;
  sourceSpace: CoordinateSpace;
}
export interface TransformSpec1 {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface MeshWarpSpec {
  mesh: WarpMesh;
  schema: string;
  targetSize?: Size | null;
  transform: TransformSpec1;
  version: string;
}
export interface WarpMesh {
  subdivisions: number;
  vertices: WarpVertex[];
}
export interface WarpVertex {
  source: Point;
  warped: Point;
}
export interface MockupPlan {
  background: CanvasBackground;
  canvas: PixelSize;
  planes: MockupPlanePlan[];
  schema: string;
  seams: MockupSeamPlan[];
  version: string;
}
export interface MockupPlanePlan {
  grid?: MockupGridPlan | null;
  id: string;
  measurement?: MockupMeasurement | null;
  opacity: number;
  solve: SolveOutput;
  sourceId: string;
  transform: TransformSpec1;
}
export interface MockupGridPlan {
  columns: number;
  horizontal: MockupGridLine[];
  rows: number;
  vertical: MockupGridLine[];
}
export interface MockupGridLine {
  end: Point;
  start: Point;
}
export interface MockupMeasurement {
  bottomPixels: number;
  bottomPixelsPerUnit: number;
  height: number;
  leftPixels: number;
  leftPixelsPerUnit: number;
  rightPixels: number;
  rightPixelsPerUnit: number;
  topPixels: number;
  topPixelsPerUnit: number;
  unit: string;
  width: number;
}
export interface MockupSeamPlan {
  first: MockupEdgeRef;
  maximumErrorPixels: number;
  reversed: boolean;
  second: MockupEdgeRef;
  tolerancePixels: number;
}
export interface MockupEdgeRef {
  edge: MockupEdge;
  planeId: string;
}
export interface MockupSpec {
  background?:
    | {
        kind: "transparent";
      }
    | {
        kind: "color";
        /**
         * @minItems 4
         * @maxItems 4
         */
        rgba: [number, number, number, number];
        space: Srgb8Space;
      };
  canvas: PixelSize;
  planes: MockupPlane[];
  schema: string;
  seams?: MockupSeam[];
  version: string;
}
export interface MockupPlane {
  grid?: MockupGrid | null;
  id: string;
  measurement?: MockupPhysicalSize | null;
  opacity?: number;
  sourceId: string;
  transform: TransformSpec1;
}
export interface MockupGrid {
  columns: number;
  rows: number;
}
export interface MockupPhysicalSize {
  height: number;
  unit: string;
  width: number;
}
export interface MockupSeam {
  first: MockupEdgeRef;
  second: MockupEdgeRef;
  tolerancePixels?: number;
}
export interface PlanePoseInput {
  elementSize: Size;
  pose: PlanePose;
}
/**
 * Explicit local single-plane pose; see PLANE_POSE_CONTRACT.md for order and units.
 */
export interface PlanePose {
  /**
   * Translation toward the viewer, in CSS pixels.
   */
  depth?: number;
  /**
   * Perspective distance in CSS pixels. No camera estimation.
   */
  perspective: number;
  perspectiveOrigin?: NormalizedAnchor1;
  pivot?: NormalizedAnchor2;
  rotateX?: number;
  rotateY?: number;
  rotateZ?: number;
  translate?: Point1;
}
/**
 * Projection origin as a fraction of the element border box.
 */
export interface NormalizedAnchor1 {
  x: number;
  y: number;
}
/**
 * Rotation origin as a fraction of the element border box; center by default.
 */
export interface NormalizedAnchor2 {
  x: number;
  y: number;
}
export interface Point1 {
  x: number;
  y: number;
}
export interface PlanePoseOutput {
  css: CssTransform;
  spec: TransformSpec1;
}
export interface PlaneStripInput {
  destinationSize?: Size | null;
  /**
   * @minItems 1
   * @maxItems 32
   */
  panels: [PlaneStripPanel, ...PlaneStripPanel[]];
  spec: TransformSpec2;
}
export interface PlaneStripPanel {
  elementSize: Size;
  end: number;
  id: string;
  /**
   * Left and right source-space fractions of one shared strip, including caller-chosen gaps.
   */
  start: number;
}
/**
 * One front-facing unwarped shared plane. Each panel keeps its own source content.
 */
export interface TransformSpec2 {
  content?: Content;
  destination: Destination;
  schema: "worldbend.transform";
  version: "0.1";
}
export interface PlaneStripOutput {
  items: PlaneStripItem[];
}
export interface PlaneStripItem {
  css: CssTransform;
  id: string;
  spec: TransformSpec1;
}
export interface RectifyPlan {
  diagnostics: RectifyDiagnostics;
  homography: Homography;
  outputQuad: Quad1;
  outputSpec: TransformSpec1;
  resolvedSourceQuad: Quad1;
  spec: RectifySpec;
}
export interface RectifyDiagnostics {
  matrix: MatrixDiagnostics;
  outputBounds: Bounds;
  reprojection: ReprojectionDiagnostics;
  sourceGeometry: GeometryDiagnostics;
}
export interface RectifySpec {
  output: PixelSize;
  schema: "worldbend.rectify";
  source: SourcePlane;
  version: "0.1";
}
export interface RemapPlan {
  outputPixels: number;
  requiresMap: boolean;
  schema: string;
  spec: RemapSpec;
  version: string;
}
export interface RemapSpec {
  operation: RemapOperation;
  output: PixelSize;
  schema: string;
  version: string;
}
export interface Point2 {
  x: number;
  y: number;
}
export interface LensCoefficients {
  k1?: number;
  k2?: number;
  k3?: number;
  p1?: number;
  p2?: number;
}
export interface LensScale {
  x: number;
  y: number;
}
export interface SpatialTemplateInspection {
  operation: SpatialTemplateOperationKind;
  output: SpatialTemplateOutputKind;
  /**
   * @minItems 1
   * @maxItems 16
   */
  outputs:
    | [SpatialTemplateOutputSummary]
    | [SpatialTemplateOutputSummary, SpatialTemplateOutputSummary]
    | [SpatialTemplateOutputSummary, SpatialTemplateOutputSummary, SpatialTemplateOutputSummary]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ]
    | [
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary,
        SpatialTemplateOutputSummary
      ];
  rasterProgram?: RasterProgramInspection | null;
  schema: "worldbend.spatial-template-inspection";
  /**
   * @minItems 1
   * @maxItems 16
   */
  sourceSlots:
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string]
    | [string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [string, string, string, string, string, string, string, string, string, string, string, string, string, string]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ]
    | [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string
      ];
  version: "0.1";
}
export interface SpatialTemplateOutputSummary {
  filename: string;
  id: string;
}
export interface RasterProgramInspection {
  schema: "worldbend.raster-program-inspection";
  stageCount: number;
  /**
   * @minItems 1
   * @maxItems 8
   */
  stages:
    | [RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary]
    | [RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary, RasterProgramStageSummary]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ]
    | [
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary,
        RasterProgramStageSummary
      ];
  version: "0.1";
}
export interface RasterProgramStageSummary {
  id: string;
  kind: RasterProgramStageKind;
}
export interface SpatialTemplateSpec {
  operation: SpatialTemplateOperation;
  output: SpatialTemplateOutput;
  schema: "worldbend.spatial-template";
  version: "0.1";
}
export interface RasterProgramSpec {
  schema: "worldbend.raster-program";
  /**
   * @minItems 1
   * @maxItems 8
   */
  stages:
    | [RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage, RasterProgramStage]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ]
    | [
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage,
        RasterProgramStage
      ];
  version: "0.1";
}
export interface SurfaceDeformationPlan {
  /**
   * @maxItems 64
   */
  anchors: ResolvedDeformationAnchor[];
  meshWarp: MeshWarpPlan;
  schema: "worldbend.surface-deformation-plan";
  spec: SurfaceDeformationSpec;
  strokeSampleCount: number;
  version: "0.1";
}
export interface ResolvedDeformationAnchor {
  column: number;
  id: string;
  row: number;
  vertexIndex: number;
}
export interface SurfaceDeformationSpec {
  /**
   * @maxItems 64
   */
  anchors?: DeformationAnchor[];
  envelope: BezierEnvelope;
  meshSubdivisions?: number;
  schema: "worldbend.surface-deformation";
  /**
   * @maxItems 64
   */
  strokes?: DeformationStroke[];
  targetSize?: Size | null;
  transform: TransformSpec1;
  version: "0.1";
}
export interface DeformationAnchor {
  column: number;
  id: string;
  row: number;
}
export interface BezierEnvelope {
  columns: number;
  /**
   * @minItems 16
   * @maxItems 169
   */
  points: [
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    ...Point[]
  ];
  rows: number;
}
export interface DeformationStroke {
  id: string;
  /**
   * @minItems 1
   * @maxItems 256
   */
  samples: [StrokeSample, ...StrokeSample[]];
}
export interface StrokeSample {
  delta: Point;
  position: Point;
  radius: number;
  strength: number;
}
export interface TransformError {
  code: ErrorCode;
  details?: unknown;
  message: string;
}
export interface TransformRecipe {
  /**
   * Remove the base spec's warp. Mutually exclusive with `warp`.
   */
  clearWarp?: boolean;
  flip?: Flip2D;
  pivot?: Point3;
  /**
   * Clockwise screen-space rotation in degrees. Omit to keep zero rotation.
   */
  rotationDegrees?: number;
  scale?: Scale2D;
  skew?: Skew2D;
  translation?: Point4;
  /**
   * Optional bounded preset warp. Omit to preserve the base spec's warp.
   */
  warp?: WarpSpec | null;
}
/**
 * Explicit source-orientation flips. Omit to preserve orientation.
 */
export interface Flip2D {
  x?: boolean;
  y?: boolean;
}
/**
 * Pivot relative to the current destination bounds: (0,0) is top-left,
 * (0.5,0.5) is the default center, and (1,1) is bottom-right. These are
 * relative values, never destination pixel coordinates. Omit unless the
 * caller explicitly changes the pivot.
 */
export interface Point3 {
  x: number;
  y: number;
}
/**
 * Multipliers on the destination width and height. Omit to keep 1x scale.
 */
export interface Scale2D {
  x: number;
  y: number;
}
/**
 * Horizontal and vertical skew angles in degrees. Omit to keep zero skew.
 */
export interface Skew2D {
  xDegrees: number;
  yDegrees: number;
}
/**
 * Translation in resolved destination units. Omit to keep zero translation.
 */
export interface Point4 {
  x: number;
  y: number;
}
export interface VariationJobPlan {
  /**
   * @minItems 1
   * @maxItems 1024
   */
  assetIds: [string, ...string[]];
  failurePolicy: VariationFailurePolicy;
  /**
   * @minItems 1
   * @maxItems 64
   */
  items: [VariationJobItemPlan, ...VariationJobItemPlan[]];
  outputCount: number;
  schema: "worldbend.variation-job-plan";
  template: SpatialTemplateInspection;
  version: "0.1";
}
export interface VariationJobItemPlan {
  bindings: VariationBinding[];
  id: string;
}
export interface VariationBinding {
  assetId: string;
  slotId: string;
}
export interface VariationJobSpec {
  failurePolicy?: "allOrNone" | "continue";
  /**
   * @minItems 1
   * @maxItems 64
   */
  items: [VariationJobItem, ...VariationJobItem[]];
  schema: "worldbend.variation-job";
  template: SpatialTemplateSpec;
  version: "0.1";
}
export interface VariationJobItem {
  /**
   * @minItems 1
   * @maxItems 16
   */
  bindings:
    | [VariationBinding]
    | [VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding, VariationBinding]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ]
    | [
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding,
        VariationBinding
      ];
  id: string;
}
