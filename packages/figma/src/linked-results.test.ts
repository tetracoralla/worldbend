import { describe, expect, it } from "vitest";
import { linkedResultGraph, linkedResultsForSource } from "./linked-results";
import { SHARED_BINDING_KEY, writeStoredBinding, type StoredBinding } from "./stored-binding";
import { writeStoredOperation } from "./stored-operation";
import { SHARED_CANVAS_KEY } from "./stored-canvas";
import type { TransformSpec } from "@worldbend/web/types";

function resultNode(id: string, name = id, box?: { x: number; y: number } | null) {
  const values = new Map<string, string>();
  return {
    id,
    name,
    values,
    absoluteBoundingBox: box === null ? null : { ...(box ?? { x: 0, y: 0 }), width: 100, height: 80 },
    getSharedPluginData: (_namespace: string, key: string) => values.get(key) ?? "",
    setSharedPluginData: (_namespace: string, key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function bind(node: ReturnType<typeof resultNode>, sourceNodeIds: string[]): void {
  writeStoredBinding(node, { sourceNodeIds, renderWidth: 100, renderHeight: 80 });
}

const transform: TransformSpec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
    },
  },
  content: { fit: "stretch" },
};

function mockupTask() {
  return {
    kind: "mockup" as const,
    spec: {
      schema: "worldbend.mockup" as const, version: "0.1" as const,
      canvas: { width: 100, height: 80 }, background: { kind: "transparent" as const }, seams: [],
      planes: [{ id: "artwork", sourceId: "source-1", opacity: 1, transform }],
    },
  };
}

describe("linked result discovery", () => {
  it("includes a valid raster duplicate and orders the whole that samples the copy after it, without adopting on discovery", () => {
    const original = Object.assign(resultNode("original-result"), { type: "RECTANGLE" });
    bind(original, ["source"]); writeStoredOperation(original, { kind: "transform", spec: transform });
    const copy = Object.assign(resultNode("copy"), { type: "RECTANGLE", parent: { id: "assembly" } });
    copy.values.set(SHARED_BINDING_KEY, original.values.get(SHARED_BINDING_KEY)!);
    writeStoredOperation(copy, { kind: "transform", spec: transform });
    const before = [...copy.values];
    const whole = resultNode("whole"); bind(whole, ["assembly"]);
    writeStoredOperation(whole, { kind: "transform", spec: transform });
    const graph = linkedResultGraph([whole, copy, original], "source");
    expect(graph.entries).toHaveLength(3);
    expect(graph.entries.find(e => e.node.id === "whole")?.dependencyNodeIds).toEqual(["copy"]);
    expect(graph.entries.findIndex(e => e.node.id === "copy")).toBeLessThan(graph.entries.findIndex(e => e.node.id === "whole"));
    expect(graph.entries.find(e => e.node.id === "original-result")?.dependencyNodeIds).toEqual([]);
    expect(linkedResultsForSource([copy, original], "source").items.map(item => item.nodeId)).toEqual(["copy", "original-result"]);
    expect([...copy.values]).toEqual(before);
  });

  it("follows native containment and orders local changes before the assembled output", () => {
    const whole = resultNode("whole");
    const local = Object.assign(resultNode("local"), { parent: { id: "assembly", parent: { id: "page", type: "PAGE" } } });
    const unrelated = resultNode("other-local");
    for (const [node, source] of [[whole, "assembly"], [local, "original"], [unrelated, "other-original"]] as const) {
      bind(node, [source]); writeStoredOperation(node, { kind: "transform", spec: transform });
    }
    const graph = linkedResultGraph([whole, unrelated, local], "original");
    expect(graph.hasCycle).toBe(false);
    expect(graph.entries.map(entry => [entry.node.id, entry.dependencyNodeIds])).toEqual([
      ["local", []], ["whole", ["local"]],
    ]);
    expect(linkedResultsForSource([whole, local], { id: "text", parent: { id: "assembly" } }).items.map(item => item.nodeId)).toEqual(["whole"]);
  });

  it("waits for both branches, deduplicates shared consumers and detects feedback loops", () => {
    const nodes = ["a", "b", "whole"].map(id => resultNode(id));
    bind(nodes[0]!, ["original"]); bind(nodes[1]!, ["original"]); bind(nodes[2]!, ["a", "b"]);
    for (const node of nodes) writeStoredOperation(node, { kind: "transform", spec: transform });
    const graph = linkedResultGraph([nodes[2]!, nodes[1]!, nodes[0]!], "original");
    expect(graph.entries.map(entry => entry.node.id)).toEqual(["b", "a", "whole"]);
    expect(graph.entries[2]!.dependencyNodeIds).toEqual(["b", "a"]);
    bind(nodes[0]!, ["original", "whole"]);
    expect(linkedResultGraph(nodes, "original").hasCycle).toBe(true);
  });

  it("does not mistake the page or an unadopted copy for a content dependency", () => {
    const page = { id: "page", type: "PAGE" };
    const local = Object.assign(resultNode("local"), { parent: page });
    bind(local, ["original"]); writeStoredOperation(local, { kind: "transform", spec: transform });
    const copy = Object.assign(resultNode("copy"), { parent: { id: "assembly" } });
    copy.values.set(SHARED_BINDING_KEY, local.values.get(SHARED_BINDING_KEY)!);
    writeStoredOperation(copy, { kind: "transform", spec: transform });
    const whole = resultNode("whole");
    bind(whole, ["assembly"]); writeStoredOperation(whole, { kind: "transform", spec: transform });
    expect(linkedResultGraph([local, copy, whole], { id: "original", parent: page }).entries.map(entry => entry.node.id)).toEqual(["local"]);
  });

  it("lists only valid results bound to the queried source with kind and rounded position", () => {
    const bound = resultNode("result-1", "Poster", { x: 10.4, y: -7.6 });
    bind(bound, ["source-1"]);
    writeStoredOperation(bound, { kind: "transform", spec: transform });
    const task = resultNode("result-2");
    bind(task, ["source-1", "source-2"]);
    writeStoredOperation(task, { kind: "task", task: mockupTask() });
    const elsewhere = resultNode("result-3");
    bind(elsewhere, ["source-9"]);
    writeStoredOperation(elsewhere, { kind: "transform", spec: transform });

    expect(linkedResultsForSource([bound, task, elsewhere], "source-1")).toEqual({
      total: 2,
      items: [
        { nodeId: "result-1", name: "Poster", revision: 1, kind: "transform", position: { x: 10, y: -8 } },
        { nodeId: "result-2", name: "result-2", revision: 1, kind: "mockup", position: { x: 0, y: 0 } },
      ],
    });
  });

  it("excludes unadopted copies but retains damaged bound work for repair", () => {
    const original = resultNode("result-1");
    bind(original, ["source-1"]);
    writeStoredOperation(original, { kind: "transform", spec: transform });
    const copy = resultNode("copy-1");
    copy.values.set(SHARED_BINDING_KEY, original.values.get(SHARED_BINDING_KEY)!);
    const ambiguous = resultNode("result-2");
    bind(ambiguous, ["source-1"]);
    writeStoredOperation(ambiguous, { kind: "transform", spec: transform });
    ambiguous.values.set(SHARED_CANVAS_KEY, JSON.stringify({ kind: "stretch" }));

    expect(linkedResultsForSource([copy, ambiguous], "source-1")).toEqual({ total: 1, items: [
      { nodeId: "result-2", name: "result-2", revision: 1, kind: "invalid", position: { x: 0, y: 0 } },
    ] });
    const whole = resultNode("whole"); bind(whole, [ambiguous.id]);
    writeStoredOperation(whole, { kind: "transform", spec: transform });
    const graph = linkedResultGraph([whole, ambiguous], "source-1");
    expect(graph.entries.map(entry => [entry.node.id, entry.dependencyNodeIds])).toEqual([
      ["result-2", []], ["whole", ["result-2"]],
    ]);
    expect(graph.entries[0]!.operation).toBeUndefined();
  });

  it("counts every result but lists at most the first 32, truncating names by code points", () => {
    const longName = "a".repeat(127) + "😀" + "b";
    const candidates = Array.from({ length: 33 }, (_, index) => {
      const node = resultNode(`result-${index + 1}`, index === 0 ? longName : `result-${index + 1}`);
      bind(node, ["source-1"]);
      writeStoredOperation(node, { kind: "transform", spec: transform });
      return node;
    });
    const linked = linkedResultsForSource(candidates, "source-1");
    expect(linked.total).toBe(33);
    expect(linked.items).toHaveLength(32);
    expect(linked.items[0]!.name).toBe("a".repeat(127) + "😀");
    expect(linked.items.map((item) => item.nodeId)).not.toContain("result-33");
  });

  it("keeps the binding shape compatible with the stored envelope", () => {
    const node = resultNode("result-1");
    bind(node, ["source-1", "source-2"]);
    const binding = JSON.parse(node.values.get(SHARED_BINDING_KEY)!) as StoredBinding;
    expect(binding.resultNodeId).toBe("result-1");
    expect(binding.revision).toBe(1);
  });
});
