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
export type CoordinateSpace = "pixel" | "normalized";
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

/**
 * One mechanically generated schema surface for the Web/WASM carrier. The
 * wrapper is never serialized at runtime; it makes the Rust-owned input,
 * normalized output, mesh, CSS, and structured-error contracts available to
 * the TypeScript generator without a second handwritten semantic model.
 */
export interface WebContract {
  affineCompositionOutput: AffineComposition;
  cssTransformOutput: CssTransform;
  solveOutput: SolveOutput;
  transformError: TransformError;
  transformRecipeInput: TransformRecipe;
  transformSpecInput: TransformSpec1;
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
  pivot?: Point1;
  /**
   * Clockwise screen-space rotation in degrees. Omit to keep zero rotation.
   */
  rotationDegrees?: number;
  scale?: Scale2D;
  skew?: Skew2D;
  translation?: Point2;
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
export interface Point1 {
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
export interface Point2 {
  x: number;
  y: number;
}
export interface WarpMesh {
  subdivisions: number;
  vertices: WarpVertex[];
}
export interface WarpVertex {
  source: Point;
  warped: Point;
}
