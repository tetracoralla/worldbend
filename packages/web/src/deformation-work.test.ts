import { describe, expect, it, vi } from "vitest";

vi.mock("@worldbend/wasm", () => ({
  default: vi.fn(),
  canvas_plan_json: vi.fn(),
  canvas_set_plan_json: vi.fn(),
  compose_json: vi.fn(),
  solve_json: vi.fn(),
  vector_projection_json: vi.fn(),
  spatial_template_inspect_json: vi.fn(),
  variation_job_plan_json: vi.fn(),
  css_json: vi.fn(),
  rectify_json: vi.fn(),
  warp_mesh_json: vi.fn(),
  deformation_work_plan_json: vi.fn(),
  deformation_clip_json: vi.fn(),
  deformation_work_migrate_json: vi.fn(),
}));

import initWasm, {
  deformation_work_plan_json as deformationWorkPlanJson,
  deformation_clip_json as deformationClipJson,
  deformation_work_migrate_json as deformationWorkMigrateJson,
} from "@worldbend/wasm";
import { migrateDeformationWork, planDeformationWork, projectDeformationClip } from "./bridge";
import type { BezierEnvelope, DeformationWorkSpecInput } from "./types";
import { normalizedSpec, unitQuad } from "./types";

const envelope: BezierEnvelope = {
  columns: 1,
  rows: 1,
  points: [
    { x: 0, y: 0 },
    { x: 1 / 3, y: 0 },
    { x: 2 / 3, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 / 3 },
    { x: 1 / 3, y: 1 / 3 },
    { x: 2 / 3, y: 1 / 3 },
    { x: 1, y: 1 / 3 },
    { x: 0, y: 2 / 3 },
    { x: 1 / 3, y: 2 / 3 },
    { x: 2 / 3, y: 2 / 3 },
    { x: 1, y: 2 / 3 },
    { x: 0, y: 1 },
    { x: 1 / 3, y: 1 },
    { x: 2 / 3, y: 1 },
    { x: 1, y: 1 },
  ],
};

const work: DeformationWorkSpecInput = {
  schema: "worldbend.deformation-work",
  version: "0.1",
  transform: normalizedSpec(unitQuad()),
  meshSubdivisions: 8,
  surface: {
    envelope,
    anchors: [],
    strokes: [],
  },
};

describe("deformation work bridge", () => {
  it("projects the original compound fill through the core-solved plane", async () => {
    const clip = { contours:[{start:{x:0,y:0},segments:[
      {kind:"line" as const,to:{x:1,y:0}}, {kind:"line" as const,to:{x:0,y:1}},
    ]}], fillRule:"evenOdd" as const, regions:[{contourIndices:[0],fillRule:"evenOdd" as const}] };
    const matrix = [120,0,0,0,90,0,0,0,1] as [number,number,number,number,number,number,number,number,number];
    const expected = {...clip,bounds:{x:0,y:0,width:120,height:90},contourAreaPixels:5400};
    vi.mocked(deformationClipJson).mockReturnValue(JSON.stringify(expected));
    const result = await projectDeformationClip(clip, {homography:{matrix},resolvedDestination:{reference:{width:120,height:90}}});
    expect(result).toEqual(expected);
    expect(deformationClipJson).toHaveBeenCalledWith(JSON.stringify(clip),new Float64Array(matrix),120,90);
  });
  it("plans one work and returns the canonical mesh plan plus pin view", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(deformationWorkPlanJson).mockReturnValue(
      JSON.stringify({
        schema: "worldbend.deformation-work-plan",
        version: "0.1",
        spec: work,
        meshWarp: { schema: "worldbend.mesh-warp-plan", version: "0.1" },
        pinView: {
          anchors: [],
          strokeSampleCount: 0,
          resolvedMesh: { subdivisions: 8, vertices: [] },
        },
        meshEditCount: 0,
      }),
    );

    const plan = await planDeformationWork(work);
    expect(plan.schema).toBe("worldbend.deformation-work-plan");
    expect(plan.pinView?.resolvedMesh).toMatchObject({ subdivisions: 8 });
    expect(plan.meshEditCount).toBe(0);
    expect(deformationWorkPlanJson).toHaveBeenCalledWith(JSON.stringify(work));
  });

  it("plans a liquify work through the bridge and reports its sample count", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    const liquifyWork: DeformationWorkSpecInput = {
      ...work,
      liquify: {
        strokes: [
          { id: "twirl", mode: "twirl", samples: [{ position: { x: 0.5, y: 0.5 }, radius: 0.3, strength: 1 }] },
        ],
      },
    };
    vi.mocked(deformationWorkPlanJson).mockReturnValue(
      JSON.stringify({
        schema: "worldbend.deformation-work-plan",
        version: "0.1",
        spec: liquifyWork,
        meshWarp: { schema: "worldbend.mesh-warp-plan", version: "0.1" },
        liquifySampleCount: 1,
        meshEditCount: 0,
      }),
    );
    const plan = await planDeformationWork(liquifyWork);
    expect(plan.liquifySampleCount).toBe(1);
    expect(JSON.parse(vi.mocked(deformationWorkPlanJson).mock.calls[0]?.[0] ?? "{}").liquify.strokes[0].mode).toBe("twirl");
  });

  it("migrates one persisted surface document into the work", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    const migration = {
      schema: "worldbend.deformation-work-migration",
      version: "0.1",
      sourceSchema: "worldbend.surface-deformation",
      sourceVersion: "0.1",
      work,
      plan: { schema: "worldbend.deformation-work-plan", version: "0.1" },
    };
    vi.mocked(deformationWorkMigrateJson).mockReturnValue(
      JSON.stringify(migration),
    );

    const result = await migrateDeformationWork({
      surfaceDeformation: {
        schema: "worldbend.surface-deformation",
        version: "0.1",
        transform: normalizedSpec(unitQuad()),
        meshSubdivisions: 8,
        envelope,
        anchors: [],
        strokes: [],
      },
    });
    expect(result.sourceSchema).toBe("worldbend.surface-deformation");
    expect(result.work.schema).toBe("worldbend.deformation-work");
    const call = vi.mocked(deformationWorkMigrateJson).mock.calls[0]?.[0] ?? "";
    expect(JSON.parse(call).surfaceDeformation.schema).toBe(
      "worldbend.surface-deformation",
    );
  });

  it("surfaces a structured error from the bridge", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(deformationWorkPlanJson).mockImplementation(() => {
      throw JSON.stringify({
        code: "E_SCHEMA",
        message: "unsupported deformation work schema or version",
      });
    });
    await expect(planDeformationWork(work)).rejects.toMatchObject({
      code: "E_SCHEMA",
    });
  });
});
