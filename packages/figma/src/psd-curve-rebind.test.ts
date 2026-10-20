import { describe, expect, it } from "vitest";
import type { PsdCurveWorkPlanWire } from "./psd-curve-import";
import { psdAdoptionFromPlan } from "./psd-curve-import";
import { rebindPsdCurveWorkToEditorSpace } from "./psd-curve-rebind";
import { deformationTask, isStoredDeformationTask } from "./stored-designer-task";

/** The exact work shape `adopt_psd_curve_warp` emits for a measured
 * `warpCustom` 4×4 curve: pixel-space `Trnf` placement against the PSD
 * document, normalized sixteen-control envelope, and a twelve-density mesh
 * with a fixed boundary when the outline ring stays on the rest grid. */
function adoptedCurvePlan(): PsdCurveWorkPlanWire {
  return {
    schema: "worldbend.psd-curve-work-plan",
    version: "0.1",
    smartObjectId: "smart-object-0001",
    name: "Fixture curve",
    source: { format: "psd", bytes: 4648, sha256: "8".repeat(64), document: { width: 100, height: 100 } },
    layerPath: ["Fixture curve"],
    photoshopLayerId: 42,
    linkedAssetId: "11111111-2222-3333-4444-555555555555",
    curve: {
      uOrder: 4,
      vOrder: 4,
      envelope: { left: 18, top: 18, right: 82, bottom: 82 },
      controls: Array.from({ length: 16 }, (_, index) => ({
        x: (index % 4) / 3,
        y: Math.floor(index / 4) / 3,
      })),
    },
    work: {
      schema: "worldbend.deformation-work",
      version: "0.1",
      transform: {
        schema: "worldbend.transform",
        version: "0.1",
        destination: {
          space: "pixel",
          quad: {
            tl: { x: 18, y: 18 },
            tr: { x: 82, y: 20 },
            br: { x: 80, y: 82 },
            bl: { x: 20, y: 80 },
          },
          reference: { width: 100, height: 100 },
        },
        content: { fit: "stretch" },
      },
      targetSize: { width: 100, height: 100 },
      meshSubdivisions: 12,
      surface: {
        envelope: {
          columns: 1,
          rows: 1,
          points: Array.from({ length: 16 }, (_, index) => ({
            x: (index % 4) / 3,
            y: Math.floor(index / 4) / 3,
          })),
        },
        anchors: [],
        strokes: [],
      },
      meshEdits: [],
    },
    provenance: {
      controlBbox: { left: 18, top: 18, right: 82, bottom: 82 },
      bboxMatchesEnvelope: true,
      boundary: "fixed",
      snappedCoordinates: 0,
    },
    losses: [],
  };
}

describe("PSD curve adoption rebinds into the editor's normalized space", () => {
  it("divides the pixel placement by the PSD document size and drops the reference", () => {
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    const destination = (rebound as unknown as {
      transform: { destination: { space: string; quad: Record<"tl" | "tr" | "br" | "bl", { x: number; y: number }>; reference?: unknown } };
    }).transform.destination;
    expect(destination.space).toBe("normalized");
    expect(destination.reference).toBeUndefined();
    expect(destination.quad.tl).toEqual({ x: 0.18, y: 0.18 });
    expect(destination.quad.br).toEqual({ x: 0.8, y: 0.82 });
  });

  it("produces a deformation task the main thread's publication validation accepts", () => {
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    expect(isStoredDeformationTask({ kind: "deformation", view: "pin", spec: rebound })).toBe(true);
    expect(isStoredDeformationTask({ kind: "deformation", view: "mesh", spec: rebound })).toBe(true);
  });

  it("rejects the unrebound pixel work exactly like the stalled real-host publication", () => {
    const plan = adoptedCurvePlan();
    // Regression guard for the real-host stall: before the rebind existed,
    // this validation rejected the apply-designer payload and the panel
    // stayed on "Applying…" forever.
    expect(isStoredDeformationTask({ kind: "deformation", view: "pin", spec: plan.work as never })).toBe(false);
  });

  it("leaves an already-normalized work untouched", () => {
    const plan = adoptedCurvePlan();
    (plan.work as { transform: { destination: { space: string; reference?: unknown } } }).transform.destination.space = "normalized";
    delete (plan.work as { transform: { destination: { reference?: unknown } } }).transform.destination.reference;
    const rebound = rebindPsdCurveWorkToEditorSpace(plan);
    expect((rebound as unknown as { transform: { destination: { quad: { tl: { x: number } } } } }).transform.destination.quad.tl.x).toBe(18);
  });
});

describe("PSD curve adoption provenance", () => {
  it("builds an adoption record the deformation-task validator accepts", () => {
    const adoption = psdAdoptionFromPlan(adoptedCurvePlan());
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    const task = deformationTask(rebound, "pin", undefined, undefined, adoption);
    expect(isStoredDeformationTask(task)).toBe(true);
    expect(task.psdAdoption?.source.sha256).toBe("8".repeat(64));
    expect(task.psdAdoption?.layerPath).toEqual(["Fixture curve"]);
    expect(task.psdAdoption?.provenance.boundary).toBe("fixed");
  });

  it("round-trips through JSON like the stored task on the result node", () => {
    const adoption = psdAdoptionFromPlan(adoptedCurvePlan());
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    const task = deformationTask(rebound, "pin", undefined, undefined, adoption);
    const stored = JSON.parse(JSON.stringify(task));
    expect(isStoredDeformationTask(stored)).toBe(true);
    expect(stored.psdAdoption.source.bytes).toBe(4648);
  });

  it("rejects malformed adoption records instead of persisting them", () => {
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    const adoption = psdAdoptionFromPlan(adoptedCurvePlan());
    const badSha = JSON.parse(JSON.stringify(adoption));
    badSha.source.sha256 = "not-a-hash";
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, badSha))).toBe(false);
    const badKind = JSON.parse(JSON.stringify(adoption));
    badKind.kind = "other";
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, badKind))).toBe(false);
    const extraField = JSON.parse(JSON.stringify(adoption));
    extraField.bytes = "raw";
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, extraField))).toBe(false);
    const oversized = JSON.parse(JSON.stringify(adoption));
    oversized.source.bytes = 64 * 1024 * 1024 + 1;
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, oversized))).toBe(false);
    const wrongOrder = JSON.parse(JSON.stringify(adoption));
    wrongOrder.curve.uOrder = 5;
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, wrongOrder))).toBe(false);
    const invertedEnvelope = JSON.parse(JSON.stringify(adoption));
    invertedEnvelope.curve.envelope.right = invertedEnvelope.curve.envelope.left;
    expect(isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, invertedEnvelope))).toBe(false);
  });

  it("matches the interop's real serialized field names (controlBbox)", () => {
    // The interop serializes core's control_bbox via camelCase as
    // "controlBbox" — not "controlBBox". A mismatch silently produces an
    // empty record that publication validation rejects on the real host.
    const plan = adoptedCurvePlan();
    (plan.provenance as { controlBbox?: unknown }).controlBbox = { left: 0, top: 0, right: 96, bottom: 64 };
    const adoption = psdAdoptionFromPlan(plan);
    expect(adoption.provenance.controlBbox).toEqual({ left: 0, top: 0, right: 96, bottom: 64 });
    const rebound = rebindPsdCurveWorkToEditorSpace(plan);
    expect(
      isStoredDeformationTask(deformationTask(rebound, "pin", undefined, undefined, adoption)),
    ).toBe(true);
  });

  it("keeps tasks without an adoption valid", () => {
    const rebound = rebindPsdCurveWorkToEditorSpace(adoptedCurvePlan());
    expect(isStoredDeformationTask(deformationTask(rebound, "pin"))).toBe(true);
  });

  it("keeps a non-zero subpixel placement and inward and outward controls editable", () => {
    const plan = adoptedCurvePlan();
    plan.source.document = { width: 400, height: 250 };
    const placement = {
      tl: { x: 40.5, y: 20.25 },
      tr: { x: 210.5, y: 18.75 },
      br: { x: 208.25, y: 160.5 },
      bl: { x: 36.75, y: 158.25 },
    };
    const work = plan.work as {
      boundary?: string;
      transform: { destination: { quad: typeof placement; reference: { width: number; height: number } } };
      surface: { envelope: { points: Array<{ x: number; y: number }> } };
    };
    work.boundary = "free";
    plan.provenance.boundary = "free";
    work.transform.destination.quad = placement;
    work.transform.destination.reference = { width: 400, height: 250 };
    const inward = { x: 1 / 3, y: 0.08 };
    const outward = { x: 2 / 3, y: 1.35 };
    plan.curve.controls[5] = inward;
    plan.curve.controls[14] = outward;
    work.surface.envelope.points[5] = inward;
    work.surface.envelope.points[14] = outward;
    const rebound = rebindPsdCurveWorkToEditorSpace(plan);
    const destination = rebound.transform.destination as { space: string; quad: typeof placement };
    expect(destination.space).toBe("normalized");
    expect(destination.quad.tl).toEqual({ x: 40.5 / 400, y: 20.25 / 250 });
    expect(destination.quad.br).toEqual({ x: 208.25 / 400, y: 160.5 / 250 });
    const points = rebound.surface?.envelope.points ?? [];
    expect(points[5]).toEqual(inward);
    expect(points[14]).toEqual(outward);
    const adoption = psdAdoptionFromPlan(plan);
    const task = deformationTask(rebound, "mesh", undefined, undefined, adoption);
    expect(isStoredDeformationTask(task)).toBe(true);
    expect(task.psdAdoption?.provenance.boundary).toBe("free");
    expect(task.psdAdoption?.provenance.controlBbox).toEqual(plan.provenance.controlBbox);
  });

  it("does not publish a normalized placement when the document size is not finite", () => {
    const plan = adoptedCurvePlan();
    plan.source.document = { width: Number.NaN, height: 100 };
    const rebound = rebindPsdCurveWorkToEditorSpace(plan);
    const destination = rebound.transform.destination as { space: string; quad: { tl: { x: number; y: number } } };
    expect(destination.space).toBe("pixel");
    expect(destination.quad.tl).toEqual({ x: 18, y: 18 });
    expect(isStoredDeformationTask({ kind: "deformation", view: "pin", spec: rebound })).toBe(false);
  });
});
