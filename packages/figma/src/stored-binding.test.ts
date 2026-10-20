import { describe, expect, it } from "vitest";
import { readResultBinding, readStoredBinding, writeStoredBinding } from "./stored-binding";
import { writeStoredOperation } from "./stored-operation";
import { MAX_FIGMA_IMAGE_AXIS } from "./stored-plane";

function rasterCopy() {
  const values = new Map<string, string>();
  const node = {
    id: "copy", type: "RECTANGLE", values,
    getSharedPluginData: (_namespace: string, key: string) => values.get(key) ?? "",
    setSharedPluginData: (_namespace: string, key: string, value: string) => { values.set(key, value); },
  };
  const binding = { schema: "worldbend.figma.binding", version: "0.1", resultNodeId: "original",
    sourceNodeIds: ["artwork", "scene"], revision: 7, renderWidth: 1400, renderHeight: 840 };
  values.set("binding", JSON.stringify(binding));
  writeStoredOperation(node, { kind: "transform", spec: {
    schema: "worldbend.transform", version: "0.1", content: { fit: "stretch" },
    destination: { space: "normalized", quad: {
      tl: { x: .2, y: .1 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
    } },
  } });
  return { node, binding };
}

describe("copied raster source bindings", () => {
  it("keeps strict ownership while providing a read-only independent result identity", () => {
    const { node, binding } = rasterCopy();
    const before = [...node.values];
    expect(readStoredBinding(node)).toBeUndefined();
    expect(readResultBinding(node)).toEqual({ ...binding, resultNodeId: node.id });
    expect([...node.values]).toEqual(before);
    expect(readResultBinding({ ...node, type: "FRAME" })).toBeUndefined();
    expect(readResultBinding({ ...node, type: "VECTOR" })).toBeUndefined();
  });

  it.each([
    { resultNodeId: "" }, { resultNodeId: "x".repeat(257) },
    { sourceNodeIds: ["copy"] }, { sourceNodeIds: ["original"] },
    { sourceNodeIds: ["artwork", "artwork"] }, { sourceNodeIds: [] },
    { revision: 0 }, { revision: 1.5 }, { renderWidth: 0 }, { renderHeight: MAX_FIGMA_IMAGE_AXIS + 1 },
    { surprise: true },
  ])("does not admit a malformed or self-referential copied record: %j", patch => {
    const { node, binding } = rasterCopy();
    node.values.set("binding", JSON.stringify({ ...binding, ...patch }));
    expect(readResultBinding(node)).toBeUndefined();
  });

  it("adopts only on publication and advances the copied revision used by pending drafts", () => {
    const { node, binding } = rasterCopy();
    writeStoredBinding(node, { sourceNodeIds: binding.sourceNodeIds, renderWidth: 1400, renderHeight: 840 });
    expect(readStoredBinding(node)).toEqual({ ...binding, resultNodeId: node.id, revision: 8 });
    writeStoredBinding(node, { sourceNodeIds: ["new-artwork"], renderWidth: 700, renderHeight: 420 }, { newResult: true });
    expect(readStoredBinding(node)).toMatchObject({ resultNodeId: node.id, revision: 1, sourceNodeIds: ["new-artwork"] });
  });
});
