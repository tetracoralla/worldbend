import { describe, expect, it } from "vitest";
import { defaultMockup } from "./mockup-workspace";
import { createMeshSpec } from "./mesh-workspace";
import { defaultRemap } from "./remap-workspace";
import { isStoredDesignerTask, parseStoredDesignerTask } from "./stored-designer-task";
import { isUiToMainMessage } from "./messages";

const source = (id: string, x: number, width = 100) => ({
  sourceNodeId: id,
  sourceName: id,
  renderWidth: width,
  renderHeight: 80,
  placement: { x, y: 20, width, height: 80 },
  image: {} as HTMLImageElement,
});

describe("designer task contracts", () => {
  it("stores only closed canonical Mockup, Mesh, and Remap specs", () => {
    const tasks = [
      { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) },
      { kind: "mockup" as const, spec: defaultMockup([source("one", 10), source("two", 130)]) },
      { kind: "remap" as const, spec: defaultRemap(100, 80, true) },
    ];
    for (const task of tasks) {
      expect(isStoredDesignerTask(task)).toBe(true);
      expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
      expect(isStoredDesignerTask({ ...task, planner: "wasm" })).toBe(false);
    }
  });

  it("turns the current selected layout into ordered explicit Mockup planes", () => {
    const spec = defaultMockup([source("one", 10), source("two", 130)]);
    expect(spec.canvas).toEqual({ width: 220, height: 80 });
    expect(spec.planes.map((plane) => [plane.id, plane.sourceId])).toEqual([
      ["plane-1", "source-1"],
      ["plane-2", "source-2"],
    ]);
    expect(spec.planes[0]!.transform.destination.quad.tl).toEqual({ x: 0, y: 0 });
    expect(spec.planes[1]!.transform.destination.quad.br).toEqual({ x: 1, y: 1 });
  });

  it("accepts a bounded designer publication and rejects duplicate source IDs", () => {
    const task = { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) };
    const message = {
      type: "apply-designer",
      payload: {
        generation: 1,
        task,
        sourceNodeIds: ["source"],
        bytes: new Uint8Array([1]),
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 0, y: 0, width: 100, height: 80 },
      },
    };
    expect(isUiToMainMessage(message)).toBe(true);
    expect(isUiToMainMessage({ ...message, payload: { ...message.payload, sourceNodeIds: ["source", "source"] } })).toBe(false);
  });
});
