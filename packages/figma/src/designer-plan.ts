import {
  initializeWorldbend,
  TransformError,
  type MeshWarpPlanOutput,
  type MeshWarpSpecInput,
  type MockupPlanOutput,
  type MockupSpecInput,
  type RemapPlanOutput,
  type RemapSpecInput,
} from "@worldbend/web";
import {
  mesh_warp_plan_json as meshWarpPlanJson,
  mockup_plan_json as mockupPlanJson,
  remap_plan_json as remapPlanJson,
} from "./figma-wasm-runtime";

export async function planMockup(spec: MockupSpecInput): Promise<MockupPlanOutput> {
  await initializeWorldbend();
  return invoke<MockupPlanOutput>(() => mockupPlanJson(JSON.stringify(spec)));
}

export async function planMeshWarp(spec: MeshWarpSpecInput): Promise<MeshWarpPlanOutput> {
  await initializeWorldbend();
  return invoke<MeshWarpPlanOutput>(() => meshWarpPlanJson(JSON.stringify(spec)));
}

export async function planRemap(spec: RemapSpecInput): Promise<RemapPlanOutput> {
  await initializeWorldbend();
  return invoke<RemapPlanOutput>(() => remapPlanJson(JSON.stringify(spec)));
}

function invoke<T>(operation: () => string): T {
  try {
    return JSON.parse(operation()) as T;
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) {
      throw new TransformError({
        code: "E_INTERNAL",
        message: `Unexpected internal failure: ${error.message}`,
      });
    }
    if (typeof error === "string") {
      try {
        throw new TransformError(JSON.parse(error) as ConstructorParameters<typeof TransformError>[0]);
      } catch (parsed) {
        if (parsed instanceof TransformError) throw parsed;
      }
    }
    throw error;
  }
}
