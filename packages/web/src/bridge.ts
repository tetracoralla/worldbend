import { TransformError, throwBridgeError } from "./transform-error";
export { TransformError } from "./transform-error";
import initWasm, {
  canvas_plan_json as canvasPlanJson,
  canvas_set_plan_json as canvasSetPlanJson,
  canvas_set_plan_rgba_json as canvasSetPlanRgbaJson,
  compose_json as composeJson,
  source_capture_plan_json as sourceCapturePlanJson,
  source_sampling_validate_json as sourceSamplingValidateJson,
  native_frame_plan_json as nativeFramePlanJson,
  native_affine_rebase_json as nativeAffineRebaseJson,
  css_json as cssJson,
  pose_json as poseJson,
  rectify_json as rectifyJson,
  solve_json as solveJson,
  solve_preview_f64 as solvePreviewF64,
  spatial_template_inspect_json as spatialTemplateInspectJson,
  variation_job_plan_json as variationJobPlanJson,
  vector_projection_json as vectorProjectionJson,
  vector_operation_json as vectorOperationJson,
  vector_artwork_json as vectorArtworkJson,
  warp_mesh_f64 as warpMeshF64,
  warp_mesh_json as warpMeshJson,
  mockup_plan_json as mockupPlanJson,
  mockup_motion_plan_json as mockupMotionPlanJson,
  mockup_motion_authoring_json as mockupMotionAuthoringJson,
  material_preference_json as materialPreferenceJson,
  mockup_surface_mesh_json as mockupSurfaceMeshJson,
  deformation_work_plan_json as deformationWorkPlanJson,
  deformation_clip_json as deformationClipJson,
  shape_fit_domains_json as shapeFitDomainsJson,
  shape_fit_refresh_json as shapeFitRefreshJson,
  deformation_work_migrate_json as deformationWorkMigrateJson,
  MeshCoordinateMap as WasmMeshCoordinateMap,
} from "@worldbend/wasm";
import type {
  CanvasPlan,
  CanvasPixelSize,
  CanvasSetPlan,
  CanvasSetSpecInput,
  CanvasSpecInput,
} from "./canvas-types";
import type {MockupMotionAuthoringInput,MockupMotionAuthoringOutput} from './generated/core-contract';
export async function authorMockupMotion(input:MockupMotionAuthoringInput):Promise<MockupMotionAuthoringOutput>{
  await initializeWorldbend();return invoke<MockupMotionAuthoringOutput>(()=>mockupMotionAuthoringJson(JSON.stringify(input)));
}
import type {
  AffineComposition,
  PlanePoseInput,
  PlanePoseOutput,
  CssTransform,
  ErrorCode,
  RectifyPlan,
  RectifySpecInput,
  TransformErrorData,
  TransformSpecInput,
  PreviewSolveOutput,
  Size,
  SolveOutput,
  TransformRecipeInput,
  SpatialTemplateInspectionOutput,
  SpatialTemplateSpecInput,
  VariationJobPlanOutput,
  VariationJobSpecInput,
  DeformationWorkMigrationOutput,
  DeformationWorkPlanOutput,
  DeformationWorkSpecInput,
  MeshWarpSpecInput,
  SurfaceDeformationSpecInput,
  VectorProjectionInput,
  VectorProjectionOutput,
  WarpMesh,
  GridWarpMesh,
  WarpSpec,
  MockupSurface,
  MockupPlane,
  MockupSpec,
  MockupPlan,
  MockupMotionSpec,
  MockupMotionPlan,
  MockupClip,
  MockupClipPlan,
  ShapeFitDomain,
  ShapeFitRefreshInput,
  ShapeFitRefreshOutput,
  Point,
} from "./types";

let initialization: Promise<unknown> | undefined;

export async function planNativeFrame(input: import("./generated/core-contract").NativeFramePlanInput): Promise<import("./generated/core-contract").NativeFramePlan> {
  await initializeWorldbend();
  return invoke(() => nativeFramePlanJson(JSON.stringify(input)));
}
export async function rebaseNativeAffine(input: import("./generated/core-contract").NativeAffineFrameState): Promise<import("./types").TransformSpec> {
  await initializeWorldbend();
  return invoke(() => nativeAffineRebaseJson(JSON.stringify(input)));
}

/** Capture coordinates are provider facts; their meaning is owned by core. */
export async function planSourceCapture(input: import("./generated/core-contract").SourceCaptureFacts): Promise<import("./generated/core-contract").SourceSamplingFrame> {
  await initializeWorldbend();
  return invoke(() => sourceCapturePlanJson(JSON.stringify(input)));
}

export async function validateSourceSamplingFrame(input: import("./generated/core-contract").SourceSamplingFrame): Promise<import("./generated/core-contract").SourceSamplingFrame> {
  await initializeWorldbend();
  return invoke(() => sourceSamplingValidateJson(JSON.stringify(input)));
}

/** Typed material policy/intent evaluation, offline and without per-frame tools. */
export async function resolveMaterialPreference(input: import("./generated/core-contract").MaterialPreferenceInput): Promise<import("./generated/core-contract").MaterialPreferenceOutput> {
  await initializeWorldbend();
  return evaluateMaterialPreference(input);
}

/** Synchronous local evaluation after initializeWorldbend; receivers own initialization. */
export function evaluateMaterialPreference(input: import("./generated/core-contract").MaterialPreferenceInput): import("./generated/core-contract").MaterialPreferenceOutput {
  return invoke(() => materialPreferenceJson(JSON.stringify(input)));
}

/** Expand authored scene timing using the same core as encoded video. */
export async function planMockupMotion(spec: MockupMotionSpec): Promise<MockupMotionPlan> {
  await initializeWorldbend();
  return invoke<MockupMotionPlan>(() => mockupMotionPlanJson(JSON.stringify(spec)));
}

/** Resolve seams, content fitting, clipping and homographies in the core. */
export async function planMockup(spec: MockupSpec): Promise<MockupPlan> {
  await initializeWorldbend();
  return invoke<MockupPlan>(() => mockupPlanJson(JSON.stringify(spec)));
}

/** Version marker the WASM side prepends to every compact payload. */
const COMPACT_ABI_VERSION = 1;


export async function composeAffineTransform(
  spec: TransformSpecInput,
  transform: TransformRecipeInput,
  targetSize?: Size,
): Promise<AffineComposition> {
  await initializeWorldbend();
  return invoke<AffineComposition>(() =>
    composeJson(
      JSON.stringify(spec),
      JSON.stringify(transform),
      targetSize?.width,
      targetSize?.height,
    ),
  );
}

export async function initializeWorldbend(): Promise<void> {
  // A failed initialization must not be cached: the next call retries so a
  // transient load failure does not disable the bridge for the page lifetime.
  try {
    await (initialization ??= initWasm());
  } catch (error) {
    initialization = undefined;
    throw error;
  }
}

export async function solveTransform(
  spec: TransformSpecInput,
  targetSize?: Size,
): Promise<SolveOutput> {
  await initializeWorldbend();
  return invoke<SolveOutput>(() =>
    solveJson(
      JSON.stringify(spec),
      targetSize?.width,
      targetSize?.height,
    ),
  );
}

export async function rectifyPlane(spec: RectifySpecInput): Promise<RectifyPlan> {
  await initializeWorldbend();
  return invoke<RectifyPlan>(() => rectifyJson(JSON.stringify(spec)));
}

/** Resolve Canvas geometry exclusively through the canonical Rust core. */
export async function planCanvas(
  spec: CanvasSpecInput,
  sourceSize: CanvasPixelSize,
): Promise<CanvasPlan> {
  await initializeWorldbend();
  assertSourcePixelSize(sourceSize);
  return invoke<CanvasPlan>(() =>
    canvasPlanJson(JSON.stringify(spec), sourceSize.width, sourceSize.height),
  );
}

/** Resolve every ordered variant from the same original source raster. */
export async function planCanvasSet(
  spec: CanvasSetSpecInput,
  sourceSize: CanvasPixelSize,
): Promise<CanvasSetPlan> {
  await initializeWorldbend();
  assertSourcePixelSize(sourceSize);
  return invoke<CanvasSetPlan>(() =>
    canvasSetPlanJson(JSON.stringify(spec), sourceSize.width, sourceSize.height),
  );
}

/** Resolve alpha-dependent Trim variants from one decoded 8-bit RGBA raster. */
export async function planCanvasSetFromRgba(
  spec: CanvasSetSpecInput,
  sourceSize: CanvasPixelSize,
  rgba: Uint8Array,
): Promise<CanvasSetPlan> {
  await initializeWorldbend();
  assertSourcePixelSize(sourceSize);
  const expected = sourceSize.width * sourceSize.height * 4;
  if (!Number.isSafeInteger(expected) || rgba.byteLength !== expected) {
    throw new TransformError({
      code: "E_SCHEMA",
      message: "Decoded RGBA bytes do not match the Canvas source dimensions",
    });
  }
  return invoke<CanvasSetPlan>(() =>
    canvasSetPlanRgbaJson(
      JSON.stringify(spec),
      sourceSize.width,
      sourceSize.height,
      rgba,
    ),
  );
}

/** Validate and summarize one reusable template through the Rust-owned contract. */
export async function inspectSpatialTemplate(
  spec: SpatialTemplateSpecInput,
): Promise<SpatialTemplateInspectionOutput> {
  await initializeWorldbend();
  return invoke<SpatialTemplateInspectionOutput>(() =>
    spatialTemplateInspectJson(JSON.stringify(spec)),
  );
}

/** Resolve exact ordered bindings and output topology without rendering. */
export async function planVariationJob(
  spec: VariationJobSpecInput,
): Promise<VariationJobPlanOutput> {
  await initializeWorldbend();
  return invoke<VariationJobPlanOutput>(() =>
    variationJobPlanJson(JSON.stringify(spec)),
  );
}

/** Plan one replayable deformation work through the Rust-owned contract. The
 * result carries the canonical mesh plan plus the pin-view projection, so
 * Plane, Pin, and Mesh editing views share one derivation. */
export async function planDeformationWork(
  spec: DeformationWorkSpecInput,
): Promise<DeformationWorkPlanOutput> {
  await initializeWorldbend();
  return invoke<DeformationWorkPlanOutput>(() =>
    deformationWorkPlanJson(JSON.stringify(spec)),
  );
}

/** Core-derived connected domains retain the complete compound fill. */
export async function refreshShapeFit(input: ShapeFitRefreshInput): Promise<ShapeFitRefreshOutput> {
  await initializeWorldbend();
  return invoke<ShapeFitRefreshOutput>(() => shapeFitRefreshJson(JSON.stringify(input)));
}

export async function shapeFitDomains(clip: MockupClip): Promise<ShapeFitDomain[]> {
  await initializeWorldbend();
  return invoke<ShapeFitDomain[]>(()=>shapeFitDomainsJson(JSON.stringify(clip)));
}

/** Reproject the retained target-domain fill using a core-solved plane. */
export async function projectDeformationClip(
  clip: MockupClip, solved: PreviewSolveOutput,
): Promise<MockupClipPlan> {
  await initializeWorldbend();
  return invoke<MockupClipPlan>(() => deformationClipJson(JSON.stringify(clip),
    new Float64Array(solved.homography.matrix), solved.resolvedDestination.reference.width,
    solved.resolvedDestination.reference.height));
}

export interface MeshCoordinateMap {
  map(point: Point, inverse?: boolean): Point | undefined;
  mapControl(point: Point, sourceAnchor: Point, inverse?: boolean): Point;
  dispose(): void;
}

/** Interactive lookup and local cubic control frames stay in the core. */
export async function createMeshCoordinateMap(mesh: WarpMesh): Promise<MeshCoordinateMap> {
  await initializeWorldbend();
  let core: WasmMeshCoordinateMap;
  try { core = new WasmMeshCoordinateMap(JSON.stringify(mesh)); }
  catch (error) { throwBridgeError(error); }
  let disposed = false;
  const query = (call: () => Float64Array): Point | undefined => {
    if (disposed) throw new Error("Mesh coordinates have been disposed");
    try {
      const value = call();
      return value.length === 0 ? undefined : {x: value[0]!, y: value[1]!};
    } catch (error) { throwBridgeError(error); }
  };
  return {
    map: (point, inverse = false) => query(() => core.map(point.x, point.y, inverse)),
    mapControl: (point, anchor, inverse = false) => query(() => core.map_control(point.x, point.y, anchor.x, anchor.y, inverse))!,
    dispose() { if (!disposed) { disposed = true; core.free(); } },
  };
}

/** Migrate one persisted mesh-warp or surface-deformation document into the
 * replayable deformation work and return its equivalent plan. */
export async function migrateDeformationWork(source: {
  meshWarp?: MeshWarpSpecInput;
  surfaceDeformation?: SurfaceDeformationSpecInput;
}): Promise<DeformationWorkMigrationOutput> {
  await initializeWorldbend();
  return invoke<DeformationWorkMigrationOutput>(() =>
    deformationWorkMigrateJson(JSON.stringify(source)),
  );
}

export async function solveTransformPreview(
  spec: TransformSpecInput,
  targetSize?: Size,
): Promise<PreviewSolveOutput> {
  await initializeWorldbend();
  try {
    const values = solvePreviewF64(
      JSON.stringify(spec),
      targetSize?.width,
      targetSize?.height,
    );
    // [abiVersion, reference width, reference height, 9 coefficients]
    if (
      values.length !== 12 ||
      values[0] !== COMPACT_ABI_VERSION ||
      !Array.from(values).every(Number.isFinite)
    ) {
      throw new Error("The compact preview solve returned an invalid layout");
    }
    return {
      resolvedDestination: { reference: { width: values[1]!, height: values[2]! } },
      homography: {
        matrix: Array.from(values.slice(3)) as PreviewSolveOutput["homography"]["matrix"],
      },
    };
  } catch (error) {
    throwBridgeError(error);
  }
}

export async function buildMockupSurfaceMesh(surface: MockupSurface, warp?: WarpSpec | null): Promise<WarpMesh> {
  await initializeWorldbend();
  return invoke<WarpMesh>(() => mockupSurfaceMeshJson(JSON.stringify(surface), JSON.stringify(warp ?? null)));
}

/** Preserve the ordinary plane path exactly when a surface has zero strength. */
export async function buildMockupPlaneMesh(plane: Pick<MockupPlane,"transform"|"surface">): Promise<WarpMesh | undefined> {
  const surface = plane.surface;
  if (surface) {
    const mesh = await buildMockupSurfaceMesh(surface, plane.transform.content?.warp);
    return mesh.boundary === "free" || plane.transform.content?.warp ? mesh : undefined;
  }
  return plane.transform.content?.warp ? buildWarpMesh(plane.transform.content.warp) : undefined;
}

export async function buildWarpMesh(warp: WarpSpec): Promise<GridWarpMesh> {
  await initializeWorldbend();
  return invoke<GridWarpMesh>(() => warpMeshJson(JSON.stringify(warp)));
}

/** Project one editable vector path through the canonical core semantics. */
export async function planVectorProjection(
  input: VectorProjectionInput,
): Promise<VectorProjectionOutput> {
  await initializeWorldbend();
  return invoke<VectorProjectionOutput>(() =>
    vectorProjectionJson(JSON.stringify(input)),
  );
}

export async function buildWarpMeshPreview(warp: WarpSpec): Promise<GridWarpMesh> {
  await initializeWorldbend();
  try {
    const values = warpMeshF64(JSON.stringify(warp));
    // [abiVersion, subdivisions, then 4 floats per vertex]
    const abiVersion = values[0];
    const subdivisions = values[1];
    if (
      abiVersion !== COMPACT_ABI_VERSION ||
      !Number.isSafeInteger(subdivisions) ||
      Number(subdivisions) < 1
    ) {
      throw new Error("The compact Warp mesh returned an invalid layout");
    }
    const vertexCount = (Number(subdivisions) + 1) ** 2;
    if (values.length !== 2 + vertexCount * 4) {
      throw new Error("The compact Warp mesh returned an invalid layout");
    }
    const vertices = [] as WarpMesh["vertices"];
    for (let index = 0; index < vertexCount; index += 1) {
      const offset = 2 + index * 4;
      const coordinates = values.slice(offset, offset + 4);
      if (!Array.from(coordinates).every(Number.isFinite)) {
        throw new Error("The compact Warp mesh contains a non-finite vertex");
      }
      vertices.push({
        source: { x: coordinates[0]!, y: coordinates[1]! },
        warped: { x: coordinates[2]!, y: coordinates[3]! },
      });
    }
    return { subdivisions: Number(subdivisions), vertices };
  } catch (error) {
    throwBridgeError(error);
  }
}

export async function emitCssTransform(
  spec: TransformSpecInput,
  elementSize: Size,
  destinationSize?: Size,
): Promise<CssTransform> {
  await initializeWorldbend();
  return invoke<CssTransform>(() =>
    cssJson(
      JSON.stringify(spec),
      elementSize.width,
      elementSize.height,
      destinationSize?.width,
      destinationSize?.height,
    ),
  );
}

/** Resolve an explicit local plane pose through the same core as CLI/MCP. */
export async function projectPlanePose(input: PlanePoseInput): Promise<PlanePoseOutput> {
  await initializeWorldbend();
  return invoke<PlanePoseOutput>(() => poseJson(JSON.stringify(input)));
}

function invoke<T>(operation: () => string): T {
  try {
    return JSON.parse(operation()) as T;
  } catch (error) {
    throwBridgeError(error);
  }
}

function assertSourcePixelSize(size: CanvasPixelSize): void {
  if (
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width < 1 ||
    size.height < 1 ||
    size.width > 0xffff_ffff ||
    size.height > 0xffff_ffff
  ) {
    throw new TransformError({
      code: "E_SCHEMA",
      message: "Canvas source dimensions must be positive unsigned 32-bit integers",
    });
  }
}

export async function planVectorOperation(input: import("./generated/core-contract").VectorOperationInput):Promise<import("./generated/core-contract").VectorOperationPlan> {
  await initializeWorldbend();return invoke(()=>vectorOperationJson(JSON.stringify(input)));
}
export async function planVectorArtwork(input: import("./generated/core-contract").VectorArtworkProjectionInput):Promise<import("./generated/core-contract").VectorArtworkProjectionOutput> {
  await initializeWorldbend();return invoke(()=>vectorArtworkJson(JSON.stringify(input)));
}
