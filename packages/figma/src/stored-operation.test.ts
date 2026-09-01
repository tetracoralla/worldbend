import { describe, expect, it } from "vitest";
import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import { createMeshSpec } from "./mesh-workspace";
import { singleCanvasSpec } from "./stored-canvas";
import {
  readStoredOperation,
  readStoredOperationSlots,
  restoreStoredOperationSlots,
  writeStoredOperation,
  type SharedOperationWriter,
  type StoredOperation,
} from "./stored-operation";
import {
  SHARED_NAMESPACE,
  SHARED_RECTIFY_KEY,
  SHARED_TRANSFORM_KEY,
} from "./stored-plane";
import { SHARED_CANVAS_KEY } from "./stored-canvas";

const transform: TransformSpec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
  },
  content: { fit: "stretch" },
};

const rectification: RectifySpecInput = {
  schema: "worldbend.rectify",
  version: "0.1",
  source: { space: "normalized", quad: transform.destination.quad },
  output: { width: 100, height: 80 },
};

function operationStore(): SharedOperationWriter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getSharedPluginData(namespace, key) {
      return values.get(`${namespace}:${key}`) ?? "";
    },
    setSharedPluginData(namespace, key, value) {
      values.set(`${namespace}:${key}`, value);
    },
  };
}

describe("stored operation envelope", () => {
  const operations: StoredOperation[] = [
    { kind: "transform", spec: transform },
    { kind: "rectify", spec: rectification },
    {
      kind: "canvas",
      spec: singleCanvasSpec({
        kind: "stretch",
        output: { width: 100, height: 80 },
      }),
    },
    { kind: "task", task: { kind: "mesh", spec: createMeshSpec(100, 80, 2) } },
  ];

  it("round-trips each existing persisted operation through one exclusive envelope", () => {
    const store = operationStore();
    for (const operation of operations) {
      writeStoredOperation(store, operation);
      expect(readStoredOperation(store)).toEqual({ status: "valid", operation });
      expect(Object.values(readStoredOperationSlots(store)).filter(Boolean)).toHaveLength(1);
    }
  });

  it("rejects ambiguous or malformed legacy slots instead of selecting one", () => {
    const store = operationStore();
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, JSON.stringify(transform));
    store.setSharedPluginData(
      SHARED_NAMESPACE,
      SHARED_CANVAS_KEY,
      JSON.stringify(operations[2]!.kind === "canvas" ? operations[2]!.spec : undefined),
    );
    expect(readStoredOperation(store)).toEqual({ status: "invalid" });
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, "");
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY, "{not-json");
    expect(readStoredOperation(store)).toEqual({ status: "invalid" });
  });

  it("restores the exact prior slots after a failed replacement", () => {
    const store = operationStore();
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY, JSON.stringify(rectification));
    const before = readStoredOperationSlots(store);
    writeStoredOperation(store, { kind: "transform", spec: transform });
    restoreStoredOperationSlots(store, before);
    expect(readStoredOperationSlots(store)).toEqual(before);
    expect(readStoredOperation(store)).toEqual({
      status: "valid",
      operation: { kind: "rectify", spec: rectification },
    });
  });
});

