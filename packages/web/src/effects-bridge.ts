import initWasm, { effect_catalog_json, effect_recipe_json, effect_plan_json } from "@worldbend/wasm/effects";
import { TransformError, throwBridgeError } from "./transform-error";
import type { EffectCatalogInput, EffectCatalog, EffectRecipeInput, EffectRecipe, EffectPlanInput, EffectPlan } from "./generated/core-contract";

let initialization: Promise<unknown> | undefined;
async function run<T>(operation: (input: string) => string, input: unknown): Promise<T> {
  try {
    // Snapshot before awaiting initialization; caller mutations cannot change a queued request.
    const json = JSON.stringify(input);
    if (new TextEncoder().encode(json).byteLength > 262_144) throw new TransformError({code:"E_OUTPUT_LIMIT",message:"Spatial effect request exceeds 256 KiB"});
    await (initialization ??= initWasm().catch(error => { initialization = undefined; throw error; }));
    return JSON.parse(operation(json)) as T;
  } catch (error) { throwBridgeError(error); }
}
export const discoverEffects = (input: EffectCatalogInput): Promise<EffectCatalog> => run(effect_catalog_json, input);
export const createEffectRecipe = (input: EffectRecipeInput): Promise<EffectRecipe> => run(effect_recipe_json, input);
export const planEffect = (input: EffectPlanInput): Promise<EffectPlan> => run(effect_plan_json, input);
