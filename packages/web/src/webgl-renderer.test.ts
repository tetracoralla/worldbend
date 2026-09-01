import { describe, expect, it } from "vitest";
import { warpMeshVertexData, writeWarpMeshVertexData } from "./webgl-renderer";
import type { WarpMesh } from "./types";

describe("warpMeshVertexData", () => {
  it("emits two source-mapped triangles for the identity plane", () => {
    expect(Array.from(warpMeshVertexData())).toEqual([
      0, 0, 0, 0,
      1, 0, 1, 0,
      1, 1, 1, 1,
      0, 0, 0, 0,
      1, 1, 1, 1,
      0, 1, 0, 1,
    ]);
  });

  it("triangulates the core-owned row-major warp mesh", () => {
    const subdivisions = 16;
    const mesh: WarpMesh = {
      subdivisions,
      vertices: Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
        const x = index % (subdivisions + 1);
        const y = Math.floor(index / (subdivisions + 1));
        const source = { x: x / subdivisions, y: y / subdivisions };
        return { source, warped: { ...source } };
      }),
    };
    const vertices = Array.from(warpMeshVertexData(mesh));
    expect(vertices).toHaveLength(subdivisions * subdivisions * 2 * 3 * 4);
    expect(vertices.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(vertices.slice(8, 12)).toEqual([1 / 16, 1 / 16, 1 / 16, 1 / 16]);
  });

  it("rejects malformed topology before drawing", () => {
    expect(() => warpMeshVertexData({ subdivisions: 1, vertices: [] })).toThrow(
      "topology is invalid",
    );
    const subdivisions = 16;
    const vertices = Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
      const x = index % (subdivisions + 1);
      const y = Math.floor(index / (subdivisions + 1));
      const source = { x: x / subdivisions, y: y / subdivisions };
      return { source, warped: { ...source } };
    });
    vertices[1] = { source: { x: 0.1, y: 0 }, warped: { x: 0.1, y: 0 } };
    expect(() => warpMeshVertexData({ subdivisions, vertices })).toThrow(
      "source grid is invalid",
    );
  });

  it("rejects a moved mesh boundary vertex", () => {
    const subdivisions = 16;
    const vertices = Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
      const x = index % (subdivisions + 1);
      const y = Math.floor(index / (subdivisions + 1));
      const source = { x: x / subdivisions, y: y / subdivisions };
      return { source, warped: { ...source } };
    });
    vertices[1] = { source: { x: 1 / 16, y: 0 }, warped: { x: 1 / 16, y: 0.05 } };
    expect(() => warpMeshVertexData({ subdivisions, vertices })).toThrow(
      "boundary is invalid",
    );
  });

  it("rejects a folded or collapsed triangle", () => {
    const subdivisions = 16;
    const vertices = Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
      const x = index % (subdivisions + 1);
      const y = Math.floor(index / (subdivisions + 1));
      const source = { x: x / subdivisions, y: y / subdivisions };
      return { source, warped: { ...source } };
    });
    // Collapse an interior cell: move vertex (2,2) onto vertex (1,1) so the
    // surrounding triangles lose all area. An interior vertex keeps the
    // boundary-fixed check out of the way.
    const collapsed = 2 * (subdivisions + 1) + 2;
    vertices[collapsed] = {
      source: { x: 2 / 16, y: 2 / 16 },
      warped: { x: 1 / 16, y: 1 / 16 },
    };
    expect(() => warpMeshVertexData({ subdivisions, vertices })).toThrow(
      "folded or collapsed",
    );
  });

  it("accepts the bounded custom grid and rejects unsafe resolutions before allocation", () => {
    const subdivisions = 2;
    const mesh: WarpMesh = {
      subdivisions,
      vertices: Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
        const x = index % (subdivisions + 1);
        const y = Math.floor(index / (subdivisions + 1));
        const source = { x: x / subdivisions, y: y / subdivisions };
        return { source, warped: { ...source } };
      }),
    };
    expect(warpMeshVertexData(mesh)).toHaveLength(subdivisions * subdivisions * 2 * 3 * 4);
    expect(() => warpMeshVertexData({ subdivisions: 1, vertices: [] })).toThrow(
      "topology is invalid",
    );
    expect(() =>
      warpMeshVertexData({ subdivisions: Number.MAX_SAFE_INTEGER, vertices: [] }),
    ).toThrow("topology is invalid");
  });

  it("fills one caller-owned staging buffer across repeated mesh updates", () => {
    const subdivisions = 2;
    const mesh: WarpMesh = {
      subdivisions,
      vertices: Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
        const x = index % (subdivisions + 1);
        const y = Math.floor(index / (subdivisions + 1));
        const source = { x: x / subdivisions, y: y / subdivisions };
        return { source, warped: { ...source } };
      }),
    };
    const target = new Float32Array(16 ** 2 * 2 * 3 * 4);
    const firstCount = writeWarpMeshVertexData(mesh, target);
    mesh.vertices[4] = {
      source: { x: 0.5, y: 0.5 },
      warped: { x: 0.55, y: 0.5 },
    };
    const secondCount = writeWarpMeshVertexData(mesh, target);
    expect(firstCount).toBe(subdivisions ** 2 * 2 * 3 * 4);
    expect(secondCount).toBe(firstCount);
    expect(target[8]).toBeCloseTo(0.55);
    expect(() => writeWarpMeshVertexData(mesh, new Float32Array(firstCount - 1))).toThrow(
      "geometry buffer is too small",
    );
  });
});
