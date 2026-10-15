import { describe, expect, it } from "vitest";
import { planDeformationWork, TransformError } from "@worldbend/web";
import { messageFromError } from "./error-messages";
import { translate } from "./i18n";
import { createMeshSpec, resampleMesh } from "./mesh-workspace";
import { createSurfaceSpec } from "./surface-workspace";
import {
  deformationWorkFromMesh, deformationWorkFromMeshView, deformationWorkFromPlaneView,
  deformationWorkFromSurface, deformationWorkFromSurfaceView, meshViewFromDeformationPlan,
  planeSpecFromDeformationWork, surfaceViewFromDeformationWork,
} from "./deformation-work-state";
import { isStoredDesignerTask, parseStoredDesignerTask } from "./stored-designer-task";

function curvedWork() {
  const surface = createSurfaceSpec(320, 180);
  surface.boundary = "free";
  // The top edge bends inward; original source coordinates and corners stay intact.
  surface.envelope.points[1]!.y = .2;
  surface.envelope.points[2]!.y = .2;
  return deformationWorkFromSurface(surface);
}

describe("editable free outlines", () => {
  it("retains outward curves and raw edits across all views and JSON reopen", async () => {
    const work = curvedWork();
    work.surface!.envelope.points[1]!.y = -.2;
    work.surface!.envelope.points[2]!.y = -.2;
    const plan = await planDeformationWork(work);
    expect(plan.authoredView!.mesh.vertices[6]!.warped.y).toBeCloseTo(-.15, 10);
    expect(plan.meshWarp.solve.resolvedDestination.reference.height).toBeGreaterThan(180);
    const mesh = meshViewFromDeformationPlan(plan);
    expect(mesh.transform).toEqual(work.transform);
    expect(mesh.targetSize).toEqual(work.targetSize);
    const continued = deformationWorkFromMeshView(mesh, work, plan.meshEditBaseline);
    expect(continued).toEqual(work);
    expect(parseStoredDesignerTask(JSON.stringify({kind:"deformation",view:"mesh",spec:continued}))).toEqual({kind:"deformation",view:"mesh",spec:work});
    mesh.mesh.vertices[6]!.warped.y = -.16;
    const edited = deformationWorkFromMeshView(mesh, work, plan.meshEditBaseline);
    expect(edited.meshEdits).toEqual([{column:6,row:0,warped:{x:.5,y:-.16}}]);
    expect((await planDeformationWork(edited)).authoredView!.mesh.vertices[6]!.warped.y).toBe(-.16);
  });
  it("explains refused boundary changes using actual core errors and keeps unrelated failures distinct", async () => {
    const curve = { ...curvedWork(), boundary: "fixed" as const };
    const edge = deformationWorkFromMesh(createMeshSpec(320, 180, 4));
    edge.meshEdits = [{ column: 2, row: 0, warped: { x: .5, y: .05 } }];
    for (const work of [curve, edge]) {
      const error = await planDeformationWork(work).then(() => { throw Error("Invalid boundary accepted"); }, error => error);
      const message = messageFromError(error, "unexpectedError");
      expect(message.key).toBe("deformationFixedBoundary");
      expect(translate("en", message)).toMatch(/Undo.*Reset/);
      expect(translate("zh-CN", message)).toContain("撤销");
    }
    const outside = { ...edge, boundary: "free" as const, meshEdits: [{ column: 2, row: 0, warped: { x: .5, y: -2.01 } }] };
    const error = await planDeformationWork(outside).then(() => { throw Error("Outside boundary accepted"); }, error => error);
    expect(messageFromError(error, "unexpectedError").key).toBe("deformationCanvasLimit");
    const fitted=messageFromError(new TransformError({code:"E_SCHEMA",message:"shape fitting edits must stay inside the fitted domain"}),"unexpectedError");
    expect(fitted.key).toBe("deformationFittedDomain");
    expect(translate("zh-CN",fitted)).toContain("映射区域");
    expect(messageFromError(new TransformError({code:"E_INTERNAL",message:"Unexpected internal failure"}), "unexpectedError").key).toBe("unexpectedError");
    expect(messageFromError(new TransformError({code:"E_SCHEMA",message:"unsupported schema"}), "unexpectedError").key).toBe("invalidSchema");
    await expect(planDeformationWork(curvedWork())).resolves.toBeDefined();
  });

  it("never drops a moved Mesh edge when a fixed-boundary candidate is lifted", async () => {
    const view = createMeshSpec(320, 180, 4);
    const base = deformationWorkFromMesh(view);
    view.mesh.boundary = "free";
    view.mesh.vertices[2]!.warped.y = .05;
    await expect(planDeformationWork(deformationWorkFromMeshView(view, base))).resolves.toBeDefined();
    delete view.mesh.boundary;
    // Reject the unchanged edge through the core instead of silently omitting it.
    const candidate = deformationWorkFromMeshView(view, base);
    expect(candidate.meshEdits).toEqual([{column:2,row:0,warped:{x:.5,y:.05}}]);
    await expect(planDeformationWork(candidate)).rejects.toThrow();
  });

  it("keeps cubic intent across JSON reopen, Plane, Mesh and Pin without baking or dropping controls", async () => {
    const original = curvedWork();
    const task = { kind: "deformation" as const, view: "pin" as const, spec: original };
    const reopened = parseStoredDesignerTask(JSON.stringify(task));
    expect(reopened).toEqual(task);
    const first = await planDeformationWork(original);
    expect(first.meshWarp.spec.mesh.boundary).toBe("free");
    expect(first.meshWarp.spec.mesh.vertices[6]!.warped.y).toBeCloseTo(.15, 10);
    const plane = deformationWorkFromPlaneView(original, planeSpecFromDeformationWork(original));
    const mesh = meshViewFromDeformationPlan(first);
    const fromMesh = deformationWorkFromMeshView(mesh, plane, first.meshEditBaseline);
    const pin = surfaceViewFromDeformationWork(fromMesh);
    const continued = deformationWorkFromSurfaceView(pin, fromMesh);
    expect(continued).toEqual(original);
    expect((await planDeformationWork(continued)).meshWarp).toEqual(first.meshWarp);
  });

  it("retains explicit edge edits and their later precedence over the cubic envelope", async () => {
    const work = curvedWork();
    const plan = await planDeformationWork(work);
    const mesh = meshViewFromDeformationPlan(plan);
    mesh.mesh.vertices[6]!.warped.y = .18;
    const edited = deformationWorkFromMeshView(mesh, work, plan.meshEditBaseline);
    expect(edited.meshEdits).toEqual([{ column: 6, row: 0, warped: { x: .5, y: .18 } }]);
    const pin = surfaceViewFromDeformationWork(edited);
    pin.envelope.points[1]!.y = .21;
    const next = deformationWorkFromSurfaceView(pin, edited);
    expect((await planDeformationWork(next)).meshWarp.spec.mesh.vertices[6]!.warped.y).toBe(.18);
    expect(isStoredDesignerTask({ kind: "deformation", view: "mesh", spec: next })).toBe(true);
  });

  it("samples a free edge at a new density and keeps its policy when lifting legacy meshes", async () => {
    const input = createMeshSpec(320, 180, 4);
    input.mesh.boundary = "free";
    input.mesh.vertices[2]!.warped.y = .125;
    const denser = resampleMesh(input.mesh, 8);
    expect(denser.boundary).toBe("free");
    expect(denser.vertices[4]!.warped).toEqual({ x: .5, y: .125 });
    expect(denser.vertices[3]!.warped).toEqual({ x: .375, y: .0625 });
    const work = deformationWorkFromMesh({ ...input, mesh: denser });
    expect(work.boundary).toBe("free");
    expect(work.meshEdits!.some(edit => edit.row === 0)).toBe(true);
    expect((await planDeformationWork(work)).meshWarp.spec.mesh).toEqual(denser);
  });

  it("preserves fixed-boundary rejection, rejects invalid policies, and accepts the complete 17×17 free grid", async () => {
    const work = curvedWork();
    const fixed = { ...work, boundary: "fixed" as const };
    expect(isStoredDesignerTask({ kind: "deformation", view: "pin", spec: fixed })).toBe(false);
    await expect(planDeformationWork(fixed)).rejects.toThrow();
    expect(isStoredDesignerTask({kind:"deformation",view:"pin",spec:{...work,boundary:"auto"}})).toBe(false);
    const full = deformationWorkFromMesh(createMeshSpec(320, 180, 16));
    full.boundary = "free";
    full.meshEdits = Array.from({length:289},(_,i)=>({column:i%17,row:Math.floor(i/17),warped:{x:(i%17)/16,y:Math.floor(i/17)/16}}));
    expect(isStoredDesignerTask({kind:"deformation",view:"mesh",spec:full})).toBe(true);
    expect((await planDeformationWork(full)).meshEditCount).toBe(289);
    full.meshEdits[0]!.warped.x = -2.01;
    expect(isStoredDesignerTask({kind:"deformation",view:"mesh",spec:full})).toBe(false);
    await expect(planDeformationWork(full)).rejects.toThrow();
    expect((await planDeformationWork(curvedWork())).meshWarp.spec.mesh.boundary).toBe("free");
  });
});
