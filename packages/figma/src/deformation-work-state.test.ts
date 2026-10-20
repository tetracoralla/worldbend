import { describe, expect, it } from "vitest";
import type { DeformationWorkPlanOutput, LiquifyControls } from "@worldbend/web";
import { normalizedSpec,planDeformationWork } from "@worldbend/web";
import { createMeshSpec } from "./mesh-workspace";
import { createSurfaceSpec } from "./surface-workspace";
import {
  deformationWorkFromMesh,
  deformationWorkFromMeshView,
  deformationWorkFromPlaneView,
  deformationWorkFromSurface,
  deformationWorkFromSurfaceView,
  meshViewFromDeformationPlan,
  planeSpecComposesWithDeformation,
  planeSpecFromDeformationWork,
  surfaceViewFromDeformationWork,
} from "./deformation-work-state";

describe("Figma deformation work views", () => {
  it("preserves explicit coincident placements and all 225 authored values/order through cold Mesh lift and one selective edit",async()=>{
    const base=deformationWorkFromMesh(createMeshSpec(700,420,16));
    base.meshEdits=Array.from({length:225},(_,i)=>{const column=i%15+1,row=Math.floor(i/15)+1,x=column/16,y=row/16;
      return {column,row,warped:{x:i===0?x:x+.005*Math.sin(Math.PI*x)*Math.sin(Math.PI*y),y}};}).reverse();
    const original=structuredClone(base.meshEdits),plan=await planDeformationWork(base),view=meshViewFromDeformationPlan(plan);
    expect(deformationWorkFromMeshView(view,base,plan.meshEditBaseline).meshEdits).toEqual(original);
    view.mesh.vertices[8*17+8]!.warped.x+=.001;
    const next=deformationWorkFromMeshView(view,base,plan.meshEditBaseline);
    expect(next.meshEdits).toHaveLength(225);
    for(const [i,edit] of original.entries())expect(next.meshEdits![i]).toEqual(edit.column===8&&edit.row===8?{...edit,warped:{...edit.warped,x:edit.warped.x+.001}}:edit);
    expect(next.surface).toEqual(base.surface);expect(next.liquify).toEqual(base.liquify);
    expect(base.meshEdits).toEqual(original);
  });
  it("carries the original shape recipe through Plane, Pin and Mesh views", () => {
    const mesh = createMeshSpec(120, 90, 4);
    const work = deformationWorkFromMesh(mesh);
    work.shapeFit = {
      contour: { start: {x:0,y:0}, segments: [
        {kind:"line",to:{x:1,y:0}},
        {kind:"cubic",c1:{x:0.8,y:0.3},c2:{x:0.8,y:0.7},to:{x:1,y:1}},
        {kind:"line",to:{x:0,y:1}},
      ] },
      cornerPositions: [0,0.25,0.5,0.75], refinement: 2,
    };
    work.shapeFit.clip = { contours: [structuredClone(work.shapeFit.contour), {
      start: {x:0.2,y:0.2}, segments: [
        {kind:"line",to:{x:0.4,y:0.2}}, {kind:"line",to:{x:0.3,y:0.4}},
      ],
    }], fillRule:"evenOdd", regions:[{contourIndices:[0,1],fillRule:"evenOdd"}] };
    const before = structuredClone(work.shapeFit);
    const plane = deformationWorkFromPlaneView(work, planeSpecFromDeformationWork(work));
    const pin = deformationWorkFromSurfaceView(surfaceViewFromDeformationWork(plane), plane);
    const continued = deformationWorkFromMeshView(mesh, pin, mesh.mesh);
    expect(continued.shapeFit).toEqual(before);
    expect(continued.shapeFit).not.toBe(work.shapeFit);
    expect(work.shapeFit).toEqual(before);
    const plan = { meshWarp:{spec:mesh}, shapeFitView:{interiorMesh:mesh.mesh} } as DeformationWorkPlanOutput;
    expect(meshViewFromDeformationPlan(plan).mesh).toEqual(mesh.mesh);
    expect(meshViewFromDeformationPlan(plan).mesh).not.toBe(mesh.mesh);
  });
  it("lifts both legacy editors into one work without changing their state", () => {
    const mesh = createMeshSpec(120, 90, 4);
    mesh.mesh.vertices[6]!.warped = { x: 0.2, y: 0.3 };
    const meshWork = deformationWorkFromMesh(mesh);
    expect(meshWork.meshEdits).toEqual([{ column: 1, row: 1, warped: { x: 0.2, y: 0.3 } }]);

    const surface = createSurfaceSpec(120, 90);
    surface.anchors = [{ id: "center", column: 6, row: 6 }];
    const pinWork = deformationWorkFromSurface(surface);
    expect(pinWork.surface?.anchors).toEqual(surface.anchors);
    expect(pinWork.meshEdits).toEqual([]);
  });

  it("keeps Pin controls and stores only Mesh changes after the planned Pin mesh", () => {
    const surface = createSurfaceSpec(120, 90);
    const work = deformationWorkFromSurface(surface);
    const pinMesh = createMeshSpec(120, 90, surface.meshSubdivisions).mesh;
    const finalMesh = structuredClone(pinMesh);
    finalMesh.vertices[14]!.warped = { x: 0.1, y: 0.12 };
    const next = deformationWorkFromMeshView({
      schema: "worldbend.mesh-warp",
      version: "0.1",
      transform: work.transform,
      ...(work.targetSize ? { targetSize: work.targetSize } : {}),
      mesh: finalMesh,
    }, work, pinMesh);
    expect(next.surface).toEqual(work.surface);
    expect(next.meshEdits).toEqual([{ column: 1, row: 1, warped: { x: 0.1, y: 0.12 } }]);
  });

  it("keeps explicit Mesh edits after Pin edits and rejects density drift", () => {
    const work = deformationWorkFromMesh(createMeshSpec(120, 90, 4));
    work.meshEdits = [{ column: 1, row: 1, warped: { x: 0.2, y: 0.2 } }];
    const pin = surfaceViewFromDeformationWork(work);
    pin.anchors = [{ id: "center", column: 2, row: 2 }];
    expect(deformationWorkFromSurfaceView(pin, work).meshEdits).toEqual(work.meshEdits);
    expect(() => deformationWorkFromSurfaceView({ ...pin, meshSubdivisions: 8 }, work))
      .toThrow("density");
  });

  it("allows Mesh density to change while the Pin view is still identity", () => {
    const work = deformationWorkFromMesh(createMeshSpec(120, 90, 4));
    const pin = surfaceViewFromDeformationWork(work);
    const shared = deformationWorkFromSurfaceView(pin, work);
    const resized = deformationWorkFromMeshView(createMeshSpec(120, 90, 8), shared);
    expect(resized.meshSubdivisions).toBe(8);
    expect(resized.surface).toEqual(shared.surface);
  });

  it("keeps density fixed once Pin controls carry an authored change", () => {
    const work = deformationWorkFromMesh(createMeshSpec(120, 90, 4));
    const pin = surfaceViewFromDeformationWork(work);
    pin.envelope.points[5] = { x: 0.4, y: 0.4 };
    const shared = deformationWorkFromSurfaceView(pin, work);
    expect(() => deformationWorkFromMeshView(createMeshSpec(120, 90, 8), shared))
      .toThrow("density");
  });

  it("reads the Mesh view only from the shared planner output", () => {
    const mesh = createMeshSpec(120, 90, 4);
    const work = deformationWorkFromMesh(mesh);
    const plan = {
      schema: "worldbend.deformation-work-plan",
      version: "0.1",
      spec: work,
      meshWarp: { schema: "worldbend.mesh-warp-plan", version: "0.1", spec: mesh },
      meshEditCount: 0,
    } as DeformationWorkPlanOutput;
    expect(meshViewFromDeformationPlan(plan)).toEqual(mesh);
  });
});

describe("Plane round-trip over one deformation work", () => {
  const plane = normalizedSpec({
    tl: { x: 0.12, y: 0 },
    tr: { x: 1, y: 0.04 },
    br: { x: 0.94, y: 1 },
    bl: { x: 0, y: 0.92 },
  });

  it("composes the live plane without touching the interior", () => {
    const surface = createSurfaceSpec(120, 90);
    surface.envelope.points[5] = { x: 0.4, y: 0.4 };
    const work = deformationWorkFromSurface(surface);
    work.meshEdits = [{ column: 1, row: 1, warped: { x: 0.3, y: 0.3 } }];
    const composed = deformationWorkFromPlaneView(work, plane, { width: 120, height: 90 });
    expect(composed.transform.destination.quad).toEqual(plane.destination.quad);
    expect(composed.transform.content?.warp).toBeUndefined();
    expect(composed.surface).toEqual(work.surface);
    expect(composed.meshEdits).toEqual(work.meshEdits);
    expect(composed.meshSubdivisions).toEqual(work.meshSubdivisions);
    expect(composed.targetSize).toEqual({ width: 120, height: 90 });
  });

  it("round-trips the work's plane back into the plane editor exactly", () => {
    const work = deformationWorkFromPlaneView(
      deformationWorkFromMesh(createMeshSpec(120, 90, 4)),
      plane,
      { width: 120, height: 90 },
    );
    expect(planeSpecFromDeformationWork(work)).toEqual(plane);
  });

  it("refuses an authored preset Warp and strips a zero amount", () => {
    const base = deformationWorkFromMesh(createMeshSpec(120, 90, 4));
    expect(planeSpecComposesWithDeformation(plane)).toBe(true);
    const authored = {
      ...plane,
      content: { ...plane.content, warp: { preset: "arc" as const, amount: 0.5 } },
    };
    expect(planeSpecComposesWithDeformation(authored)).toBe(false);
    const zeroed = {
      ...plane,
      content: { ...plane.content, warp: { preset: "arc" as const, amount: 0 } },
    };
    expect(planeSpecComposesWithDeformation(zeroed)).toBe(true);
    const composed = deformationWorkFromPlaneView(base, zeroed, { width: 120, height: 90 });
    expect(composed.transform.content?.warp).toBeUndefined();
    expect(planeSpecFromDeformationWork(composed)).toEqual(plane);
  });

  it("carries the Liquify block through every view lift and plane publication", () => {
    const liquify: LiquifyControls = {
      strokes: [{ id: "stroke-1", mode: "bloat", samples: [
        { position: { x: 0.5, y: 0.5 }, radius: 0.3, strength: 1 },
      ] }],
    };
    const base = deformationWorkFromMesh(createMeshSpec(120, 90, 4));
    base.liquify = structuredClone(liquify);

    // The Pin view composes its surface controls without losing Liquify, and
    // a live Pin Liquify block replaces the base's own.
    const pin = surfaceViewFromDeformationWork(base);
    expect(deformationWorkFromSurfaceView(pin, base).liquify).toEqual(liquify);
    const painted = structuredClone(liquify);
    painted.strokes![0]!.id = "stroke-2";
    expect(deformationWorkFromSurfaceView(pin, base, painted).liquify).toEqual(painted);
    expect(deformationWorkFromSurfaceView(pin, base, painted).surface)
      .toEqual({ envelope: pin.envelope, anchors: pin.anchors, strokes: pin.strokes });

    // A Mesh view over the same work keeps the block for the return trip.
    const shared = deformationWorkFromMeshView(createMeshSpec(120, 90, 4), base);
    expect(shared.liquify).toEqual(liquify);

    // Publishing from the Plane editor keeps the interior's Liquify intact.
    const published = deformationWorkFromPlaneView(base, plane, { width: 120, height: 90 });
    expect(published.liquify).toEqual(liquify);
    expect(published.meshEdits).toEqual(base.meshEdits);

    // A work without Liquify stays clean instead of gaining an empty block.
    expect(deformationWorkFromSurfaceView(pin).liquify).toBeUndefined();
  });
});
