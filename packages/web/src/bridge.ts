import initWasm, {
  canvas_plan_json as canvasPlanJson,
  canvas_set_plan_json as canvasSetPlanJson,
  compose_json as composeJson,
  css_json as cssJson,
  rectify_json as rectifyJson,
  solve_json as solveJson,
  solve_preview_f64 as solvePreviewF64,
  warp_mesh_f64 as warpMeshF64,
  warp_mesh_json as warpMeshJson,
} from "@worldbend/wasm";
import type {
  CanvasPlan,
  CanvasPixelSize,
  CanvasSetPlan,
  CanvasSetSpecInput,
  CanvasSpecInput,
} from "./canvas-types";
import type {
  AffineComposition,
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
  WarpMesh,
  WarpSpec,
} from "./types";

let initialization: Promise<unknown> | undefined;

/** Version marker the WASM side prepends to every compact payload. */
const COMPACT_ABI_VERSION = 1;

export class TransformError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(data: TransformErrorData) {
    super(data.message);
    this.name = "TransformError";
    this.code = data.code;
    this.details = data.details;
  }
}

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

export async function buildWarpMesh(warp: WarpSpec): Promise<WarpMesh> {
  await initializeWorldbend();
  return invoke<WarpMesh>(() => warpMeshJson(JSON.stringify(warp)));
}

export async function buildWarpMeshPreview(warp: WarpSpec): Promise<WarpMesh> {
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

function throwBridgeError(error: unknown): never {
    // A Rust panic crosses the bridge as a bare RuntimeError; unexpected
    // internal failures still belong inside the stable error contract.
    if (error instanceof WebAssembly.RuntimeError) {
      throw new TransformError({
        code: "E_INTERNAL",
        message: `Unexpected internal failure: ${error.message}`,
      });
    }
    if (typeof error === "string") {
      try {
        throw new TransformError(JSON.parse(error) as TransformErrorData);
      } catch (parsed) {
        if (parsed instanceof TransformError) throw parsed;
      }
    }
  throw error;
}
