import {
  initializeWorldbend,
  TransformError,
  type EffectPlan,
  type EffectPlanInput,
  type EffectRecipe,
  type EffectRecipeInput,
  type DeformationWorkPlanOutput,
  type DeformationWorkSpecInput,
  type ShapeFitDomain,
  type ShapeFitRefreshInput,
  type ShapeFitRefreshOutput,
  type MockupClip,
  type MeshWarpPlanOutput,
  type MeshWarpSpecInput,
  type MockupPlanOutput,
  type MockupSpecInput,
  type RemapPlanOutput,
  type RemapSpecInput,
  type SurfaceDeformationPlanOutput,
  type SurfaceDeformationSpecInput,
} from "@worldbend/web";
import {
  effect_plan_json as effectPlanJson,
  effect_recipe_json as effectRecipeJson,
  deformation_work_plan_json as deformationWorkPlanJson,
  shape_fit_domains_json as shapeFitDomainsJson,
  shape_fit_refresh_json as shapeFitRefreshJson,
  mesh_warp_plan_json as meshWarpPlanJson,
  mockup_plan_json as mockupPlanJson,
  remap_plan_json as remapPlanJson,
  surface_deformation_plan_json as surfaceDeformationPlanJson,
} from "./figma-wasm-runtime";

export async function createEffectRecipe(input: EffectRecipeInput): Promise<EffectRecipe> {
  await initializeWorldbend();
  return invoke<EffectRecipe>(() => effectRecipeJson(JSON.stringify(input)));
}

export async function planEffect(input: EffectPlanInput): Promise<EffectPlan> {
  await initializeWorldbend();
  return invoke<EffectPlan>(() => effectPlanJson(JSON.stringify(input)));
}

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

export async function planSurfaceDeformation(
  spec: SurfaceDeformationSpecInput,
): Promise<SurfaceDeformationPlanOutput> {
  await initializeWorldbend();
  return invoke<SurfaceDeformationPlanOutput>(() => surfaceDeformationPlanJson(JSON.stringify(spec)));
}

export async function planDeformationWork(
  spec: DeformationWorkSpecInput,
): Promise<DeformationWorkPlanOutput> {
  await initializeWorldbend();
  return invoke<DeformationWorkPlanOutput>(() => deformationWorkPlanJson(JSON.stringify(spec)));
}

export async function refreshShapeFit(input: ShapeFitRefreshInput): Promise<ShapeFitRefreshOutput> {
  await initializeWorldbend();
  return invoke<ShapeFitRefreshOutput>(() => shapeFitRefreshJson(JSON.stringify(input)));
}

export async function shapeFitDomains(clip: MockupClip): Promise<ShapeFitDomain[]> {
  await initializeWorldbend();
  return invoke<ShapeFitDomain[]>(()=>shapeFitDomainsJson(JSON.stringify(clip)));
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
