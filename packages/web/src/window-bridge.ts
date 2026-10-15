import initWasm, { window_plan_json } from "@worldbend/wasm/surface-window";
import { throwBridgeError } from "./transform-error";
import type { SurfaceWindowSpec, SurfaceWindowPlan } from "./generated/core-contract";

let initialization: Promise<unknown> | undefined;
export async function planSurfaceWindow(spec: SurfaceWindowSpec): Promise<SurfaceWindowPlan> {
  try {
    const json=JSON.stringify(spec);
    await (initialization ??= initWasm().catch(error => { initialization = undefined; throw error; }));
    return JSON.parse(window_plan_json(json)) as SurfaceWindowPlan;
  } catch (error) { throwBridgeError(error); }
}
