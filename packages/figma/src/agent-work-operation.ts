import { mockupSlots } from "./agent-handoff";
import { deformationTaskSourceCount } from "./stored-designer-task";
import { isStoredOperation, type StoredOperation } from "./stored-operation";
import { isFigmaImageAxis } from "./stored-plane";

/** Shared carrier admission for cold creation and selective revision.
 * Canonical geometry and target-dimension agreement remain core-owned. */
export function workOperationSupports(operation: StoredOperation, count: number, width: number, height: number) {
  return isStoredOperation(operation) && isFigmaImageAxis(width) && isFigmaImageAxis(height) && workSourcesMatch(operation,count);
}

export function deformationOperation(operation: StoredOperation): boolean {
  return operation.kind === "task" && ["mesh", "surface", "deformation"].includes(operation.task.kind);
}

/** Shared supported-family/source arity for discovery as well as authoring. */
export function workSourcesMatch(operation: StoredOperation, count: number) {
  if (count < 1 || count > 8) return false;
  if (operation.kind === "transform" || operation.kind === "rectify") return count === 1;
  if (operation.kind === "canvas") return count === 1;
  if (operation.kind !== "task") return false;
  const task = operation.task;
  if (task.kind === "remap") return count === (task.spec.operation.kind === "displacement" ? 2 : 1);
  if (task.kind === "effect") return count === task.recipe.layers.length;
  if (task.kind === "mockup" || task.kind === "composition") return mockupSlots(task, count);
  if (task.kind === "deformation") return count === deformationTaskSourceCount(task);
  return (task.kind === "mesh" || task.kind === "surface") && count === 1;
}

/** Pixel-coordinate Canvas operations read the source at 1× independently
 * of a previous output's crop or padding. Output geometry remains core-owned. */
export function dynamicCanvas(operation: StoredOperation) {
  return operation.kind === "canvas" && ["crop", "trim", "pad"].includes(operation.spec.operation.kind);
}
