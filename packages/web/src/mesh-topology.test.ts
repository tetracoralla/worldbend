import { describe, expect, it } from "vitest";
import { mapWarpMesh, validateMeshTopology } from "./mesh-topology";
import { warpMeshVertexData, writeWarpMeshVertexData } from "./webgl-renderer";
import { estimateSourceRasterSize } from "./source-raster-plan";
import { normalizedSpec, unitQuad, type SolveOutput, type TriangleWarpMesh, type WarpMesh } from "./types";

function concave(): TriangleWarpMesh {
  const vertex = (x: number, y: number, targetX = x, targetY = y) => ({
    source: {x, y}, warped: {x: targetX, y: targetY},
  });
  return {
    boundary: "free", triangles: [[0,1,5],[1,2,5],[2,3,5],[3,4,5],[4,0,5]],
    vertices: [vertex(0,0), vertex(1,0), vertex(1,0.5,0.65,0.5), vertex(1,1), vertex(0,1), vertex(0.4,0.5,0.3,0.5)],
  };
}

describe("canonical indexed warp geometry",()=>{
  it("retains positive subpixel overlay faces while rejecting numerical collapse",()=>{
    const mesh:TriangleWarpMesh={boundary:"free",triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]],vertices:[
      {source:{x:0,y:0},warped:{x:0,y:0}},
      {source:{x:1,y:0},warped:{x:1,y:0}},
      {source:{x:1,y:1},warped:{x:1,y:1}},
      {source:{x:0,y:1},warped:{x:0,y:1}},
      {source:{x:0.4,y:0.5},warped:{x:0.5,y:4e-9}},
    ]};
    expect(()=>validateMeshTopology(mesh)).not.toThrow();
    expect(mapWarpMesh(mesh,{x:0.25,y:2e-9},true)).toBeDefined();
    mesh.vertices[4]!.warped.y=1e-13;
    expect(()=>validateMeshTopology(mesh)).toThrow("collapsed");
    mesh.vertices[4]!.warped.y=-4e-9;
    expect(()=>validateMeshTopology(mesh)).toThrow();
  });
  it("uploads the declared concave faces and samples the original source square",()=>{
    const mesh=concave();
    expect(validateMeshTopology(mesh).boundary).toEqual([0,1,2,3,4]);
    const data=warpMeshVertexData(mesh);
    expect(data.length).toBe(5*3*4);
    expect(Array.from(data.slice(8,12))).toEqual(Array.from(new Float32Array([0.3,0.5,0.4,0.5])));
    expect(mapWarpMesh(mesh,{x:0.4,y:0.5})?.x).toBeCloseTo(0.3);
    expect(mapWarpMesh(mesh,{x:0.3,y:0.5},true)?.x).toBeCloseTo(0.4);
    expect(mapWarpMesh(mesh,{x:0.8,y:0.5},true)).toBeUndefined();
  });

  it("retains shading by vertex identity across differently connected faces",()=>{
    const mesh=concave();mesh.shading=[0.5,0.6,0.7,0.8,0.9,1.5];
    const data=new Float32Array(5*3*5);
    expect(writeWarpMeshVertexData(mesh,data,true)).toBe(75);
    expect(data[4]).toBeCloseTo(0.5);
    expect(data[14]).toBeCloseTo(1.5);
    expect(data[29]).toBeCloseTo(1.5);
  });

  it("rejects malformed indexed topology before geometry allocation",()=>{
    for (let mutation=0;mutation<8;mutation++) {
      const mesh=concave();
      switch(mutation) {
        case 0:mesh.triangles[0]![0]=65535;break;
        case 1:mesh.triangles[0]![0]=mesh.triangles[0]![1];break;
        case 2:mesh.triangles.push(mesh.triangles[0]!);break;
        case 3:mesh.triangles.pop();break;
        case 4:mesh.vertices[5]!.warped={x:0.9,y:0.5};break;
        case 5:mesh.vertices[5]!.source={x:0,y:0.5};break;
        case 6:mesh.vertices.push(mesh.vertices[5]!);break;
        case 7:mesh.vertices[3]!.source={x:0.95,y:1};break;
      }
      expect(()=>warpMeshVertexData(mesh),`mutation ${mutation}`).toThrow();
    }
    const mixed={...concave(),subdivisions:4} as WarpMesh;
    expect(()=>warpMeshVertexData(mixed)).toThrow("topology is invalid");
    const oversized=concave();
    oversized.vertices.push(...Array.from({length:2049-oversized.vertices.length},()=>oversized.vertices[5]!));
    expect(()=>warpMeshVertexData(oversized)).toThrow("topology is invalid");
  });

  it("plans source resolution from custom faces even without a preset Warp",()=>{
    const solve={homography:{matrix:[1000,0,0,0,1000,0,0,0,1]}} as SolveOutput;
    const ordinary=estimateSourceRasterSize(solve,normalizedSpec(unitQuad()),4096);
    const fitted=estimateSourceRasterSize(solve,normalizedSpec(unitQuad()),4096,concave());
    expect(fitted.height).toBeGreaterThan(ordinary.height);
    expect(fitted.width).toBeLessThanOrEqual(4096);
  });
});
