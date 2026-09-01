import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import {
  parseOwnedCanvasSpec,
  SHARED_CANVAS_KEY,
  type OwnedCanvasSpec,
} from "./stored-canvas";
import {
  parseStoredDesignerTask,
  SHARED_DESIGNER_TASK_KEY,
  type StoredDesignerTask,
} from "./stored-designer-task";
import {
  parseOwnedRectifySpec,
  parseOwnedTransformSpec,
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
}

export function readStoredOperation(source: SharedOperationReader): StoredOperationRead {
  const slots = readStoredOperationSlots(source);
  const present = Object.values(slots).filter(Boolean);
  if (present.length === 0) return { status: "none" };
  // Exactly one closed operation owns a reusable result. Ambiguous or
  // malformed plugin data is rejected instead of selecting a winner.
  if (present.length !== 1) return { status: "invalid" };
  if (slots.transform) {
    const spec = parseOwnedTransformSpec(slots.transform);
    return spec
      ? { status: "valid", operation: { kind: "transform", spec } }
      : { status: "invalid" };
  }
  if (slots.rectification) {
    const spec = parseOwnedRectifySpec(slots.rectification);
    return spec
      ? { status: "valid", operation: { kind: "rectify", spec } }
      : { status: "invalid" };
  }
  if (slots.canvas) {
    const spec = parseOwnedCanvasSpec(slots.canvas);
    return spec
      ? { status: "valid", operation: { kind: "canvas", spec } }
      : { status: "invalid" };
  }
  const task = parseStoredDesignerTask(slots.task);
  return task
    ? { status: "valid", operation: { kind: "task", task } }
    : { status: "invalid" };
}

export function writeStoredOperation(
  target: SharedOperationWriter,
  operation: StoredOperation,
): void {
  const serialized = JSON.stringify(operation.kind === "task" ? operation.task : operation.spec);
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
}

export function readStoredOperationSlots(source: SharedOperationReader): StoredOperationSlots {
  return {
    transform: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY),
    rectification: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY),
    canvas: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY),
    task: source.getSharedPluginData(SHARED_NAMESPACE, SHARED_DESIGNER_TASK_KEY),
  };
}

export function restoreStoredOperationSlots(
  target: SharedOperationWriter,
  slots: StoredOperationSlots,
): void {
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, slots.transform);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY, slots.rectification);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY, slots.canvas);
  target.setSharedPluginData(SHARED_NAMESPACE, SHARED_DESIGNER_TASK_KEY, slots.task);
}

