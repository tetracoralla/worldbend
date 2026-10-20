import { describe, expect, it } from "vitest";
import { createMeshSpec } from "./mesh-workspace";
import { createSurfaceSpec } from "./surface-workspace";
import type { LinkedBatchItem } from "./messages";
import { batchOperationWork, parseBatchOperation } from "./batch-update";
import { normalizedSpec } from "@worldbend/web";
import { deformationWorkFromMesh } from "./deformation-work-state";
import { deformationTask } from "./stored-designer-task";
import { continuedCompositionTask } from "./stored-designer-task";

function item(overrides: Partial<LinkedBatchItem>): LinkedBatchItem {
  return {
    nodeId: "10:1",
    name: "Poster",
    revision: 2,
    kind: "deformation",
    width: 600,
    height: 400,
    placement: { x: 0, y: 0, width: 600, height: 400 },
    operationKind: "task",
    operationJson: "",
    batchRunId: 1,
    ...overrides,
  };
}

describe("linked batch operation parsing", () => {
  it("keeps the stored deformation task with its reopen view", () => {
    const spec = {
      schema: "worldbend.deformation-work", version: "0.1",
      transform: normalizedSpec(unitQuad()),
      targetSize: { width: 600, height: 400 },
      meshSubdivisions: 4,
      meshEdits: [{ column: 1, row: 1, warped: { x: 0.3, y: 0.3 } }],
    };
    const parsed = parseBatchOperation(item({ operationJson: JSON.stringify({ kind: "deformation", view: "pin", spec }) }));
    expect(parsed).toEqual({ status: "supported", operation: { kind: "deformation", view: "pin", spec } });
  });

  it.each([0,1] as const)("retains native fitting roles through batch recomputation in order %s",guideIndex=>{
    const work=deformationWorkFromMesh(createMeshSpec(600,400,4));
    const contour={start:{x:0,y:0},segments:[{kind:"line" as const,to:{x:1,y:0}},{kind:"line" as const,to:{x:1,y:1}},{kind:"line" as const,to:{x:0,y:1}}]};
    work.shapeFit={contour,clip:{contours:[contour],fillRule:"nonZero"}};
    const task=deformationTask(work,"pin",guideIndex),operationJson=JSON.stringify(task);
    const ids=guideIndex===0 ? ["guide","art"] : ["art","guide"];
    const parsed=parseBatchOperation(item({operationJson,sourceNodeIds:ids}));
    expect(parsed).toEqual({status:"supported",operation:task});
    if(parsed.status!=="supported") throw Error("Missing fitted batch");
    expect(batchOperationWork(parsed.operation)).toEqual({work,view:"pin"});
    for(const bad of [[],["art"],["art","art"],["art","guide","extra"]]) {
      expect(parseBatchOperation(item({operationJson,sourceNodeIds:bad}))).toEqual({status:"invalid"});
    }
  });

  it("lifts legacy Mesh and Surface tasks into the shared work", () => {
    const mesh = createMeshSpec(120, 90, 4);
    mesh.mesh.vertices[6]!.warped = { x: 0.4, y: 0.4 };
    const meshParsed = parseBatchOperation(item({
      kind: "mesh",
      operationJson: JSON.stringify({ kind: "mesh", spec: mesh }),
    }));
    expect(meshParsed.status).toBe("supported");
    if (meshParsed.status !== "supported") return;
    const lifted = batchOperationWork(meshParsed.operation);
    expect(lifted.view).toBe("mesh");
    expect(lifted.work.meshEdits).toEqual([{ column: 1, row: 1, warped: { x: 0.4, y: 0.4 } }]);

    const surface = createSurfaceSpec(120, 90);
    surface.anchors = [{ id: "pin", column: 6, row: 6 }];
    const surfaceParsed = parseBatchOperation(item({
      kind: "surface",
      operationJson: JSON.stringify({ kind: "surface", spec: surface }),
    }));
    expect(surfaceParsed.status).toBe("supported");
    if (surfaceParsed.status !== "supported") return;
    const pinLifted = batchOperationWork(surfaceParsed.operation);
    expect(pinLifted.view).toBe("pin");
    expect(pinLifted.work.surface?.anchors).toEqual(surface.anchors);
  });

  it("parses a plane result and rejects the families slice one does not touch", () => {
    const plane = normalizedSpec(unitQuad());
    const planeParsed = parseBatchOperation(item({
      kind: "transform", operationKind: "transform", operationJson: JSON.stringify(plane),
    }));
    expect(planeParsed).toEqual({ status: "supported", operation: { kind: "transform", spec: plane } });

    for (const kind of ["rectify", "effect", "remap"] as const) {
      expect(parseBatchOperation(item({ kind, operationKind: "task", operationJson: "" })))
        .toEqual({ status: "unsupported", kind });
    }
    expect(parseBatchOperation(item({ operationJson: "{not json" }))).toEqual({ status: "invalid" });
  });

  it("refreshes explicit scene sizes while rejecting changed sizes, incomplete bindings and dynamic outputs", () => {
    const spec = { schema: "worldbend.canvas", version: "0.1", operation: { kind: "contain", output: { width: 600, height: 400 },
      anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } };
    const canvas = item({ kind: "canvas", operationKind: "canvas", operationJson: JSON.stringify(spec), sourceNodeIds: ["preview"] });
    expect(parseBatchOperation(canvas)).toEqual({ status: "supported", operation: { kind: "canvas", spec } });
    for (const changed of [{ ...canvas, width: 601 }, { ...canvas, sourceNodeIds: [] }, { ...canvas, sourceNodeIds: ["a", "b"] },
      { ...canvas, operationKind: "task" as const }, { ...canvas, operationJson: "{bad" }]) {
      expect(parseBatchOperation(changed)).toEqual({ status: "invalid" });
    }
    expect(parseBatchOperation({ ...canvas, operationJson: JSON.stringify({ ...spec, operation: { kind: "trim", alphaThreshold: 0 } }) }))
      .toEqual({ status: "unsupported", kind: "canvas" });
  });

  it("recomputes a multi-source Mockup task only with its binding-order sources", () => {
    const spec = {
      schema: "worldbend.mockup", version: "0.1",
      canvas: { width: 600, height: 400 },
      background: { kind: "transparent" },
      planes: [
        { id: "plane-1", sourceId: "source-1", transform: normalizedSpec(unitQuad()), opacity: 0 },
        { id: "plane-2", sourceId: "source-2", transform: normalizedSpec(unitQuad()), opacity: 1 },
      ],
      seams: [],
    };
    const sourceNodeIds = ["20:1", "20:2"];
    const parsed = parseBatchOperation(item({
      kind: "mockup",
      operationJson: JSON.stringify({ kind: "mockup", spec }),
      sourceNodeIds,
    }));
    expect(parsed).toEqual({ status: "supported", operation: { kind: "mockup", spec } });
    // Without the binding-order ids the item cannot resolve its sources.
    expect(parseBatchOperation(item({ kind: "mockup", operationJson: JSON.stringify({ kind: "mockup", spec }) })))
      .toEqual({ status: "invalid" });
    // A mockup item without a stored task stays invalid.
    expect(parseBatchOperation(item({ kind: "mockup", operationJson: "{bad", sourceNodeIds })))
      .toEqual({ status: "invalid" });
  });

  it("retains the whole Composition program and named output instead of flattening it to Mockup", () => {
    const task = continuedCompositionTask({ schema: "worldbend.mockup", version: "0.1",
      canvas: { width: 200, height: 160 }, background: { kind: "transparent" }, seams: [],
      planes: [{ id: "art", sourceId: "source-1", transform: normalizedSpec(unitQuad()), opacity: 1 },
        { id: "guide", sourceId: "source-2", transform: normalizedSpec(unitQuad()), opacity: 0 }],
    });
    expect(parseBatchOperation(item({ kind: "composition", operationJson: JSON.stringify(task), sourceNodeIds: ["source", "guide"] })))
      .toEqual({ status: "supported", operation: { kind: "composition", task } });
    expect(parseBatchOperation(item({ kind: "composition", operationJson: JSON.stringify(task) }))).toEqual({ status: "invalid" });
    for (const sourceNodeIds of [["source"], ["source", "source"], ["source", "guide", "unused"]]) {
      expect(parseBatchOperation(item({ kind: "composition", operationJson: JSON.stringify(task), sourceNodeIds })))
        .toEqual({ status: "invalid" });
    }
    expect(parseBatchOperation(item({ kind: "mockup", operationJson: JSON.stringify(task), sourceNodeIds: ["source", "guide"] })))
      .toEqual({ status: "invalid" });
  });
});

function unitQuad() {
  return { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } };
}
