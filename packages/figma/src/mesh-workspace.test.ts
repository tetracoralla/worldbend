import { describe, expect, it } from "vitest";
import {
  createMeshSpec,
  DEFAULT_MESH_SUBDIVISIONS,
  meshSpecFromPerspective,
  resampleMesh,
  transformForMesh,
} from "./mesh-workspace";
import { normalizedSpec, type WarpMesh } from "@worldbend/web";

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
    expect(vertex(next, 1, 1)?.warped).toEqual({ x: 0.2, y: 0.3 });
    expect(vertex(next, 0, 0)?.warped).toEqual({ x: 0, y: 0 });
    expect(vertex(next, 4, 4)?.warped).toEqual({ x: 1, y: 1 });
  });

  it("returns the same mesh when density is unchanged", () => {
    const mesh = createMeshSpec(100, 80, 4).mesh;
    expect(resampleMesh(mesh, 4)).toBe(mesh);
  });
});

describe("meshSpecFromPerspective", () => {
  const plane = normalizedSpec({
    tl: { x: 0.1, y: 0 },
    tr: { x: 1, y: 0.05 },
    br: { x: 0.9, y: 1 },
    bl: { x: 0, y: 0.95 },
  });

  it("defaults a new grid to 4×4 cells", () => {
    expect(createMeshSpec(100, 80).mesh.subdivisions).toBe(DEFAULT_MESH_SUBDIVISIONS);
    expect(DEFAULT_MESH_SUBDIVISIONS).toBe(4);
  });

  it("strips preset Warp so Mesh cannot carry two deformation models", () => {
    const spec = {
      ...plane,
      content: { ...plane.content, warp: { preset: "arc" as const, amount: 0.5 } },
    };
    expect(transformForMesh(spec).content.warp).toBeUndefined();
    expect(transformForMesh(spec).destination.quad).toEqual(plane.destination.quad);
  });

  it("keeps the live plane and a default grid when Warp is unused", async () => {
    const mesh = await meshSpecFromPerspective({ spec: plane, width: 120, height: 90 });
    expect(mesh.mesh.subdivisions).toBe(4);
    expect(mesh.transform.content?.warp).toBeUndefined();
    expect(mesh.transform.destination.quad.tl).toEqual({ x: 0.1, y: 0 });
    expect(mesh.targetSize).toEqual({ width: 120, height: 90 });
  });

  it("treats a zero Warp amount as the default editable grid", async () => {
    const spec = {
      ...plane,
      content: { ...plane.content, warp: { preset: "arc" as const, amount: 0 } },
    };
    const mesh = await meshSpecFromPerspective({ spec, width: 100, height: 80 });
    expect(mesh.mesh.subdivisions).toBe(DEFAULT_MESH_SUBDIVISIONS);
    expect(mesh.transform.content?.warp).toBeUndefined();
  });
});
