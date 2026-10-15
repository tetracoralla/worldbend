import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import {operationBankBytes,prepareOperationSlot,readOperationSlot} from "./operation-storage";
import {assertPersistableDesignerTask} from "./stored-designer-task";
import {
  parseOwnedCanvasSpec,
  isOwnedCanvasSpec,
  SHARED_CANVAS_KEY,
  type OwnedCanvasSpec,
} from "./stored-canvas";
import {
  isStoredDesignerTask,
  SHARED_DESIGNER_TASK_KEY,
  type StoredDesignerTask,
} from "./stored-designer-task";
import {
  parseOwnedRectifySpec,
  parseOwnedTransformSpec,
  isOwnedTransformSpec,
  isOwnedRectifySpec,
  isRecord,
  SHARED_NAMESPACE,
  SHARED_RECTIFY_KEY,
  SHARED_TRANSFORM_KEY,
} from "./stored-plane";

export type StoredOperation =
  | { kind: "transform"; spec: TransformSpec }
  | { kind: "rectify"; spec: RectifySpecInput }
  | { kind: "canvas"; spec: OwnedCanvasSpec }
  | { kind: "task"; task: StoredDesignerTask };

export type StoredOperationRead =
  | { status: "none" }
  | { status: "invalid" }
  | { status: "valid"; operation: StoredOperation };

/** Only the active family owns its pending controls. Other family bytes may
 * remain as history and must not be mistaken for the current draft. */
export function operationDraftKey(operation: StoredOperation) {
  return operation.kind !== "task" ? undefined : operation.task.kind === "effect" ? "effectDraft" :
    operation.task.kind === "mockup" || operation.task.kind === "composition" ? "mockupDraft" : undefined;
}

export function isStoredOperation(value: unknown): value is StoredOperation {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort().join(",");
  if (value.kind === "task") return keys === "kind,task" && isStoredDesignerTask(value.task);
  if (keys !== "kind,spec") return false;
  if (value.kind === "transform") return isOwnedTransformSpec(value.spec);
  if (value.kind === "rectify") return isOwnedRectifySpec(value.spec);
  return value.kind === "canvas" && isOwnedCanvasSpec(value.spec);
}

export interface SharedOperationReader {
  getSharedPluginData(namespace: string, key: string): string;
}

export interface SharedOperationWriter extends SharedOperationReader {
  setSharedPluginData(namespace: string, key: string, value: string): void;
}

export interface StoredOperationSlots {
  transform: string;
  rectification: string;
  canvas: string;
  task: string;
  banks?: Record<string,string>;
}

/** Exclusive owning-slot decoding is shared by generic and narrower carriers.
 * The relevant owning family then validates its complete value. */
export function readStoredOperationValue(source:SharedOperationReader):{kind:"transform"|"rectify"|"canvas"|"task";value:unknown}|undefined {
  const slots=readStoredOperationSlots(source),present=(["transform","rectification","canvas","task"] as const).filter(k=>slots[k]);
  if(present.length!==1)return undefined;
  const key=present[0]!;return {kind:key==="rectification"?"rectify":key,value:readOperationSlot(source,slots[key])};
}

export function readStoredOperation(source: SharedOperationReader): StoredOperationRead {
  const slots = readStoredOperationSlots(source);
  const present = [slots.transform,slots.rectification,slots.canvas,slots.task].filter(Boolean);
  if (present.length === 0) return { status: "none" };
  // Exactly one closed operation owns a reusable result. Ambiguous or
  // malformed plugin data is rejected instead of selecting a winner.
  if (present.length !== 1) return { status: "invalid" };
  try {
  if (slots.transform) {
    const value=readOperationSlot(source,slots.transform);
    if(isOwnedTransformSpec(value))return {status:"valid",operation:{kind:"transform",spec:value}};
    const spec = parseOwnedTransformSpec(slots.transform);
    return spec
      ? { status: "valid", operation: { kind: "transform", spec } }
      : { status: "invalid" };
  }
  if (slots.rectification) {
    const value=readOperationSlot(source,slots.rectification);
    const spec = isOwnedRectifySpec(value)?value:undefined;
    return spec
      ? { status: "valid", operation: { kind: "rectify", spec } }
      : { status: "invalid" };
  }
  if (slots.canvas) {
    const value=readOperationSlot(source,slots.canvas);
    const spec = isOwnedCanvasSpec(value)?value:undefined;
    return spec
      ? { status: "valid", operation: { kind: "canvas", spec } }
      : { status: "invalid" };
  }
  const value=readOperationSlot(source,slots.task);
  const task = isStoredDesignerTask(value)?value:undefined;
  return task
    ? { status: "valid", operation: { kind: "task", task } }
    : { status: "invalid" };
  }catch{return {status:"invalid"};}
}

export function writeStoredOperation(
  target: SharedOperationWriter,
  operation: StoredOperation,
): void {
  if(operation.kind==="task"&&operation.task.kind!=="deformation")assertPersistableDesignerTask(operation.task);
  const previous=readStoredOperationSlots(target);
  const prepared=prepareOperationSlot(target,operation.kind === "task" ? operation.task : operation.spec);
  const serialized=prepared.raw;
  try {
  target.setSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_TRANSFORM_KEY,
    operation.kind === "transform" ? serialized : "",
  );
  target.setSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_RECTIFY_KEY,
    operation.kind === "rectify" ? serialized : "",
  );
  target.setSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_CANVAS_KEY,
    operation.kind === "canvas" ? serialized : "",
  );
  target.setSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_DESIGNER_TASK_KEY,
    operation.kind === "task" ? serialized : "",
  );
  if(JSON.stringify(readOperationSlot(target,serialized))!==JSON.stringify(operation.kind==="task"?operation.task:operation.spec))
    throw Error("E_FIGMA_STATE: complete owning operation was not retained");
  const active=readStoredOperationSlots(target).banks??{};
  for(const key of Object.keys(previous.banks??{}))if(key!=="invalid-operation-bank"&&!(key in active))
    target.setSharedPluginData(SHARED_NAMESPACE,key,"");
  }catch(e){restoreStoredOperationSlots(target,previous);for(const key of prepared.created)target.setSharedPluginData(SHARED_NAMESPACE,key,"");throw e;}
}

export function readStoredOperationSlots(source: SharedOperationReader): StoredOperationSlots {
  const slots={
    transform: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY),
    rectification: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY),
    canvas: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY),
    task: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_DESIGNER_TASK_KEY),
  };
  const banks:Record<string,string>={};
  for(const raw of Object.values(slots))try{Object.assign(banks,operationBankBytes(source,raw));}catch{banks["invalid-operation-bank"]=raw;}
  return {...slots,...(Object.keys(banks).length?{banks}:{})};
}

export function restoreStoredOperationSlots(
  target: SharedOperationWriter,
  slots: StoredOperationSlots,
): void {
  const currentBanks=readStoredOperationSlots(target).banks??{};
  if(slots.banks)for(const [key,value] of Object.entries(slots.banks))if(key!=="invalid-operation-bank")target.setSharedPluginData(SHARED_NAMESPACE,key,value);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, slots.transform);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY, slots.rectification);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY, slots.canvas);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_DESIGNER_TASK_KEY, slots.task);
  // A failed update owns its current active bank only. Never enumerate or
  // remove unrelated historical/user keys while restoring the prior value.
  for(const key of Object.keys(currentBanks))if(key!=="invalid-operation-bank"&&!(key in (slots.banks??{})))
    target.setSharedPluginData(SHARED_NAMESPACE,key,"");
}
