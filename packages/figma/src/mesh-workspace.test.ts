import { describe, expect, it } from "vitest";
import { createMeshSpec, resampleMesh } from "./mesh-workspace";
import type { WarpMesh } from "@worldbend/web";

function vertex(mesh: WarpMesh, x: number, y: number) {
  return mesh.vertices[y * (mesh.subdivisions + 1) + x];
}

describe("resampleMesh", () => {
  it("rebuilds an identity mesh at a new density without moving the boundary", () => {
    const identity = createMeshSpec(100, 80, 2).mesh;
    const next = resampleMesh(identity, 4);
    expect(next.subdivisions).toBe(4);
    expect(next.vertices).toHaveLength(25);
    for (const point of next.vertices) {
      const edge =
        point.source.x === 0 || point.source.x === 1 || point.source.y === 0 || point.source.y === 1;
      if (edge) expect(point.warped).toEqual(point.source);
    }
    expect(vertex(next, 2, 2)?.warped).toEqual({ x: 0.5, y: 0.5 });
  });

  it("keeps an interior deformation instead of resetting to identity", () => {
    const mesh = createMeshSpec(100, 80, 2).mesh;
    const center = vertex(mesh, 1, 1);
    if (!center) throw new Error("missing interior vertex");
    center.warped = { x: 0.4, y: 0.6 };
    const next = resampleMesh(mesh, 4);
    expect(vertex(next, 2, 2)?.warped).toEqual({ x: 0.4, y: 0.6 });
    expect(vertex(next, 0, 0)?.warped).toEqual({ x: 0, y: 0 });
    expect(vertex(next, 4, 4)?.warped).toEqual({ x: 1, y: 1 });
  });

  it("returns the same mesh when density is unchanged", () => {
    const mesh = createMeshSpec(100, 80, 4).mesh;
    expect(resampleMesh(mesh, 4)).toBe(mesh);
  });
});
