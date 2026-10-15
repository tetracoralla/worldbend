import { describe, expect, it } from "vitest";
import type { DocumentShape } from "./native-shape";
import type { LoadedDesignerSource } from "./designer-workspace-common";
import { prepareNativeShapeFit, refreshNativeShapeFit } from "./native-shape-fit";
import { deformationArtworkIndex, deformationTaskSourceCount, parseStoredDesignerTask } from "./stored-designer-task";
import { planDeformationWork } from "./designer-plan";

const rectangle = (x: number, y: number, width: number, height: number) => ({
  start: { x, y }, segments: [
    { kind: "line" as const, to: { x: x + width, y } },
    { kind: "line" as const, to: { x: x + width, y: y + height } },
    { kind: "line" as const, to: { x, y: y + height } },
    { kind: "line" as const, to: { x, y } },
  ],
});
const shape = (): DocumentShape => ({
  bounds: { x: 100, y: 20, width: 240, height: 160 },
  contours: [rectangle(100, 20, 240, 160), rectangle(180, 70, 80, 60), rectangle(220, 40, 80, 120)],
  fillRule: "evenOdd",
  regions: [{ contourIndices: [0, 1], fillRule: "evenOdd" }, { contourIndices: [2], fillRule: "nonZero" }],
});
const source = (id: string, guide?: DocumentShape): LoadedDesignerSource => ({
  sourceNodeId: id, sourceName: id, renderWidth: 360, renderHeight: 240,
  placement: { x: 0, y: 0, width: 360, height: 240 },
  image: {} as HTMLImageElement, ...(guide ? { shapeGuide: guide } : {}),
});

describe("native guide fitting through the real core", () => {
  it.each([0, 1] as const)("retains regions, source roles and durable recipe with guide index %i", async index => {
    const guide = shape(), sources = index === 0 ? [source("guide", guide), source("art")] : [source("art"), source("guide", guide)];
    const before = structuredClone(guide);
    const { task, domains } = await prepareNativeShapeFit(sources);
    expect(task.shapeGuideSourceIndex).toBe(index);
    expect(deformationArtworkIndex(task)).toBe(1 - index);
    expect(deformationTaskSourceCount(task)).toBe(2);
    expect(task.spec.targetSize).toEqual({ width: 240, height: 160 });
    expect(task.spec.shapeFit?.clip?.regions).toEqual(guide.regions);
    expect(domains.some(domain => domain.kind === "bounds")).toBe(true);
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
    for (const fields of [
      { shapeGuideSourceIndex: 2 }, { shapeGuideSourceIndex: undefined, shapeGuideDomain: { kind: "bounds" } },
      { shapeGuideDomain: { kind: "bounds", contourIndex: 0 } },
      { shapeGuideDomain: { kind: "nativeContour", contourIndex: -1 } },
      { shapeGuideDomain: { kind: "nativeContour", contourIndex: .5 } },
      { shapeGuideDomain: { kind: "nativeContour", contourIndex: 8 } },
    ]) expect(parseStoredDesignerTask(JSON.stringify({ ...task, ...fields }))).toBeUndefined();
    const missingClip = structuredClone(task); delete missingClip.spec.shapeFit!.clip;
    expect(parseStoredDesignerTask(JSON.stringify(missingClip))).toBeUndefined();
    const plan = await planDeformationWork(task.spec);
    expect(plan.shapeFitView).toBeDefined();
    expect(plan.clip?.regions).toEqual(guide.regions);
    expect(guide).toEqual(before);
  });

  it("refreshes the native boundary without resetting authored interior, size or landmarks", async () => {
    const { task } = await prepareNativeShapeFit([source("art"), source("guide", shape())]);
    task.spec.meshEdits = [{ column: 1, row: 1, warped: { x: .25, y: .23 } }];
    task.spec.targetSize = { width: 480, height: 320 };
    task.spec.shapeFit!.cornerPositions = [0, .25, .5, .75];
    const before = structuredClone(task);
    const changed = shape();
    changed.contours[0]!.segments[0]!.to.x -= 12;
    const refreshed = await refreshNativeShapeFit(task, changed);
    expect(refreshed.spec.meshEdits).toEqual(before.spec.meshEdits);
    expect(refreshed.spec.targetSize).toEqual(before.spec.targetSize);
    expect(refreshed.spec.shapeFit?.cornerPositions).toEqual(before.spec.shapeFit?.cornerPositions);
    expect(refreshed.spec.shapeFit?.clip).not.toEqual(before.spec.shapeFit?.clip);
    expect(parseStoredDesignerTask(JSON.stringify(refreshed))).toEqual(refreshed);
    expect(task).toEqual(before);
    await expect(refreshNativeShapeFit(task, undefined)).rejects.toThrow("unavailable");
    expect(task).toEqual(before);
  });

  it("rejects unplannable edited geometry while preserving the caller's draft", async () => {
    const { task } = await prepareNativeShapeFit([source("art"), source("guide", shape())]);
    const invalid = structuredClone(task.spec);
    invalid.meshEdits = [{ column: 1, row: 1, warped: { x: 2, y: 2 } }];
    const before = structuredClone(invalid);
    const changed = shape(); changed.contours[0]!.segments[0]!.to.x -= 12;
    await expect(refreshNativeShapeFit(task, changed, invalid)).rejects.toThrow();
    expect(invalid).toEqual(before);
    await expect(prepareNativeShapeFit([source("art")])).rejects.toThrow("Select artwork");
  });
});
