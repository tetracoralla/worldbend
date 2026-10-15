import {describe, expect, it, vi} from "vitest";
import type {DeformationWorkPlanOutput, MeshCoordinateMap} from "@worldbend/web";

vi.mock("@worldbend/web", async importOriginal => ({
  ...await importOriginal<object>(), createMeshCoordinateMap: vi.fn(),
}));
import {createMeshCoordinateMap} from "@worldbend/web";
import {createDeformationCoordinateCache} from "./deformation-coordinates";
import {identityEnvelope} from "./surface-workspace";

const plan = (fitted: boolean) => ({
  meshWarp:{solve:{homography:{matrix:[100,0,0,0,80,0,0,0,1],inverse:[.01,0,0,0,.0125,0,0,0,1]},
    resolvedDestination:{reference:{width:100,height:80}}}},
  ...(fitted ? {shapeFitView:{fit:{mesh:{subdivisions:2,vertices:[]}}}} : {}),
}) as unknown as DeformationWorkPlanOutput;

describe("deformation coordinate cache", () => {
  it("projects raw outward handles through the shifted authoring plane", async () => {
    const value = plan(false);
    value.authoredView = { solve: { homography:{matrix:[100,0,0,0,80,16,0,0,1],inverse:[.01,0,0,0,.0125,-.2,0,0,1]},
      resolvedDestination:{reference:{width:100,height:112}} } } as NonNullable<DeformationWorkPlanOutput["authoredView"]>;
    const cache = createDeformationCoordinateCache();
    const coordinates = await cache.resolve(value);
    const projected = coordinates.project({x:.5,y:-.1});
    expect(projected.x).toBe(.5); expect(projected.y).toBeCloseTo(8/112,12);
    expect(coordinates.unproject(projected)!.y).toBeCloseTo(-.1,12);
    cache.dispose();
  });
  it("reuses fit faces and distinguishes exact image lookup from cubic frames", async () => {
    const mapper: MeshCoordinateMap = {map:vi.fn(p=>p.x===.9 ? undefined : p),
      mapControl:vi.fn(p=>p),dispose:vi.fn()};
    vi.mocked(createMeshCoordinateMap).mockResolvedValue(mapper);
    const cache=createDeformationCoordinateCache(), envelope=identityEnvelope(1,1);
    const coordinates=await cache.resolve(plan(true),envelope);
    expect(coordinates.project({x:-.2,y:.3},"5")).toEqual({x:-.2,y:.3});
    expect(mapper.mapControl).toHaveBeenLastCalledWith({x:-.2,y:.3},{x:1/3,y:1/3});
    const inverse=coordinates.unproject({x:.2,y:.3},"5")!;
    expect(inverse.x).toBeCloseTo(.2,12); expect(inverse.y).toBeCloseTo(.3,12);
    expect(mapper.mapControl).toHaveBeenLastCalledWith(inverse,{x:1/3,y:1/3},true);
    expect(coordinates.project({x:.2,y:.3},"2,2")).toEqual({x:.2,y:.3});
    expect(mapper.map).toHaveBeenLastCalledWith({x:.2,y:.3});
    expect(coordinates.unproject({x:.9,y:.9})).toBeUndefined();
    await cache.resolve(plan(true),envelope);
    expect(createMeshCoordinateMap).toHaveBeenCalledTimes(1);
    await cache.resolve(plan(false));
    expect(mapper.dispose).toHaveBeenCalledTimes(1);
    cache.dispose();
    expect(mapper.dispose).toHaveBeenCalledTimes(1);
  });

  it("disposes a delayed fit superseded by state removal or workspace disposal", async () => {
    for (const action of ["remove","dispose"]) {
      let resolve!: (value:MeshCoordinateMap)=>void;
      vi.mocked(createMeshCoordinateMap).mockImplementationOnce(()=>new Promise(ready=>{resolve=ready;}));
      const mapper: MeshCoordinateMap={map:vi.fn(),mapControl:vi.fn(),dispose:vi.fn()};
      const cache=createDeformationCoordinateCache();
      const pending=cache.resolve(plan(true));
      const failure=expect(pending).rejects.toThrow("superseded");
      if(action==="remove") await cache.resolve(plan(false)); else cache.dispose();
      resolve(mapper);await failure;
      expect(mapper.dispose).toHaveBeenCalledTimes(1);
      cache.dispose();
    }
  });
});
