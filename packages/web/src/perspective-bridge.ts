import initWasm, { card_idle_json, card_pointer_json, card_pose_json, card_turn_json, css_json, pose_json, strip_json } from "@worldbend/wasm/perspective";
import { throwBridgeError } from "./transform-error";
import type { CardIdleInput, CardPointerInput, CardPointerOutput, CardPoseInput, CardPoseOutput, CardTurnInput, CardTurnOutput, CssTransform, PlanePoseInput, PlanePoseOutput, PlaneStripInput,
  PlaneStripOutput, Size, TransformSpecInput } from "./types";
export { TransformError } from "./transform-error";

let initialization: Promise<unknown> | undefined;
export async function initializeWorldbend(): Promise<void> {
  try { await (initialization ??= initWasm()); }
  catch (error) { initialization = undefined; throwBridgeError(error); }
}
async function run<T>(operation: (json: string) => string, input: unknown): Promise<T> {
  await initializeWorldbend();
  try { return JSON.parse(operation(JSON.stringify(input))) as T; }
  catch (error) { throwBridgeError(error); }
}
export function projectPlanePose(input: PlanePoseInput): Promise<PlanePoseOutput> {
  return run(pose_json, input);
}
export function projectPlaneStrip(input: PlaneStripInput): Promise<PlaneStripOutput> {
  return run(strip_json, input);
}
export function emitCssTransform(spec: TransformSpecInput, elementSize: Size, destinationSize?: Size): Promise<CssTransform> {
  return run(css_json, { spec, elementSize, destinationSize });
}
export function projectCardPose(input: CardPoseInput): Promise<CardPoseOutput> {
  return run(card_pose_json, input);
}
export function sampleCardPointer(input: CardPointerInput): Promise<CardPointerOutput> {
  return run(card_pointer_json, input);
}
export function sampleCardIdle(input: CardIdleInput): Promise<CardPointerOutput> {
  return run(card_idle_json, input);
}
export function sampleCardTurn(input: CardTurnInput): Promise<CardTurnOutput> {
  return run(card_turn_json, input);
}
