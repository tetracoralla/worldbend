import { describe, expect, it, vi } from "vitest";
import { planDeformationWork } from "./designer-plan";
import { deformationWorkFromMesh } from "./deformation-work-state";
import { createMeshSpec } from "./mesh-workspace";
import { deformationPublicationPlacement, prepareDeformationRaster } from "./deformation-raster";
import { postDesignerResult, type DesignerWorkspaceSource } from "./designer-workspace-common";
import { deformationTask } from "./stored-designer-task";
import type { Size } from "@worldbend/web";

function project(matrix: readonly number[], u: number, v: number): [number, number] {
  if (matrix.length !== 9) throw new Error("Expected a homography");
  const [a, b, c, d, e, f, g, h, i] = matrix as readonly [number, number, number, number, number, number, number, number, number];
  const w = g * u + h * v + i;
  return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
}

const source = (): DesignerWorkspaceSource => ({ selectionGeneration: 1, sources: [{
  sourceNodeId: "art", sourceName: "Artwork", renderWidth: 200, renderHeight: 160,
  placement: { x: 20, y: 30, width: 200, height: 160 },
  image: { naturalWidth: 200, naturalHeight: 160 } as HTMLImageElement,
}] });
const work = () => deformationWorkFromMesh(createMeshSpec(200, 160, 4));
const capture = () => vi.fn(async (_source: DesignerWorkspaceSource, _size: Size) => ({ naturalWidth: 1000, naturalHeight: 800 } as HTMLImageElement));

describe("deformation publication pixels through the real core", () => {
  it("expands the output without scaling or moving its authored plane, then reopens without drift", async () => {
    const spec = work(); spec.boundary = "free";
    spec.meshEdits = [{column:2,row:0,warped:{x:.5,y:-.125}}, {column:2,row:4,warped:{x:.5,y:1.125}}];
    const plan = await planDeformationWork(spec);
    const selection = source();
    expect(plan.meshWarp.solve.resolvedDestination.reference).toEqual({width:200,height:200});
    expect(await deformationPublicationPlacement(selection,plan)).toEqual({x:0,y:0,width:200,height:200});
    selection.task = deformationTask(work(),"mesh");
    selection.targetPlacement = {x:400,y:300,width:200,height:160};
    const expanded = await deformationPublicationPlacement(selection,plan);
    expect(expanded).toEqual({x:400,y:280,width:200,height:200});
    selection.task = deformationTask(spec,"mesh"); selection.targetPlacement = expanded;
    expect(await deformationPublicationPlacement(selection,plan)).toEqual(expanded);
    const raster = await prepareDeformationRaster(selection,plan,capture());
    expect(raster.size).toEqual({width:400,height:400});
    expect(await deformationPublicationPlacement(selection,await planDeformationWork(work()))).toEqual({x:400,y:300,width:200,height:160});
  });
  it("requests a fresh HD raster and keeps the saved nonlinear work and mapping", async () => {
    const spec = work(); spec.meshEdits = [{ column: 2, row: 2, warped: { x: .55, y: .4 } }];
    const plan = await planDeformationWork(spec), before = structuredClone(plan), read = capture();
    const result = await prepareDeformationRaster(source(), plan, read);
    expect(result.size).toEqual({ width: 400, height: 320 });
    expect(read.mock.calls[0]?.[1].width).toBeGreaterThan(400);
    expect(result.image).toBe(await read.mock.results[0]!.value);
    expect(result.solve.homography.matrix.slice(6)).toEqual(plan.meshWarp.solve.homography.matrix.slice(6));
    expect(plan).toEqual(before);
  });
  it("uses an already sufficient source without another export", async () => {
    const selection = source(); selection.sources[0]!.image = { naturalWidth: 1000, naturalHeight: 800 } as HTMLImageElement;
    const read = capture();
    const result = await prepareDeformationRaster(selection, await planDeformationWork(work()), read);
    expect(result.image).toBe(selection.sources[0]!.image); expect(read).not.toHaveBeenCalled();
  });
  it("retains denser existing output without accumulating density on reopen", async () => {
    const selection = source(); selection.targetRasterSize = { width: 800, height: 640 };
    selection.targetPlacement = { x: 20, y: 30, width: 200, height: 160 };
    const plan = await planDeformationWork(work());
    const first = await prepareDeformationRaster(selection, plan, capture());
    selection.targetRasterSize = first.size;
    expect((await prepareDeformationRaster(selection, plan, capture())).size).toEqual(first.size);
    expect(first.size).toEqual({ width: 800, height: 640 });
  });
  it("caps large publication and source rasters without shrinking document placement", async () => {
    const selection = source(); selection.sources[0]!.placement.width = 3000; selection.sources[0]!.placement.height = 2400;
    const read = capture(), spec = work(), plan = await planDeformationWork(spec);
    const result = await prepareDeformationRaster(selection, plan, read);
    expect(result.size).toEqual({ width: 4096, height: 3277 });
    expect(result.solve.resolvedDestination.reference).toEqual(result.size);
    const reference = plan.meshWarp.solve.resolvedDestination.reference;
    const before = project(plan.meshWarp.solve.homography.matrix, 1, 1);
    const after = project(result.solve.homography.matrix, 1, 1);
    expect(after[0]).toBeCloseTo(before[0] * result.size.width / reference.width, 6);
    expect(after[1]).toBeCloseTo(before[1] * result.size.height / reference.height, 6);
    const requested = read.mock.calls[0]?.[1]; expect(Math.max(requested!.width, requested!.height)).toBeLessThanOrEqual(4096);
    const post = vi.fn(); postDesignerResult({ post, source: selection, task: deformationTask(spec, "mesh"),
      bytes: new Uint8Array([1]), width: 200, height: 160, rasterSize: result.size });
    expect(post.mock.calls[0]?.[0].payload.placement).toEqual({ x: 0, y: 0, width: 3000, height: 2400 });
  });
  it("gets density and new placement from artwork when a differently scaled guide comes first", async () => {
    const selection = source(); selection.sources.unshift({ ...selection.sources[0]!, sourceNodeId: "guide",
      placement: { x: 0, y: 0, width: 1000, height: 800 } });
    const spec = work(); selection.deformationDraft = deformationTask(spec, "pin", 0, { kind: "bounds" });
    const read = capture(), result = await prepareDeformationRaster(selection, await planDeformationWork(spec), read);
    expect(result.size).toEqual({ width: 400, height: 320 });
    const post = vi.fn(); postDesignerResult({ post, source: selection, task: selection.deformationDraft,
      bytes: new Uint8Array([1]), width: 200, height: 160, rasterSize: result.size });
    expect(post.mock.calls[0]?.[0].payload.placement).toEqual({ x: 0, y: 0, width: 200, height: 160 });
  });
  it("keeps a stored frame that already meets the density floor when its axes are not one scale", async () => {
    const selection = source();
    selection.targetRasterSize = { width: 810, height: 640 };
    selection.targetPlacement = { x: 20, y: 30, width: 200, height: 160 };
    const plan = await planDeformationWork(work());
    const result = await prepareDeformationRaster(selection, plan, capture());
    expect(result.size).toEqual({ width: 810, height: 640 });
    const reference = plan.meshWarp.solve.resolvedDestination.reference;
    const before = project(plan.meshWarp.solve.homography.matrix, 1, 1);
    const after = project(result.solve.homography.matrix, 1, 1);
    expect(after[0]).toBeCloseTo(before[0] * result.size.width / reference.width, 6);
    expect(after[1]).toBeCloseTo(before[1] * result.size.height / reference.height, 6);
    expect(result.solve.homography.matrix.slice(6)).toEqual(plan.meshWarp.solve.homography.matrix.slice(6));
  });
  it("propagates source export failure instead of publishing preview pixels", async () => {
    await expect(prepareDeformationRaster(source(), await planDeformationWork(work()), async () => {
      throw new Error("Export failed");
    })).rejects.toThrow("Export failed");
  });
});
