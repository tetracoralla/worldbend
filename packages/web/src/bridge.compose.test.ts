import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { initSync } from "@worldbend/wasm";
import {
  buildWarpMesh,
  buildWarpMeshPreview,
  composeAffineTransform,
  emitCssTransform,
  rectifyPlane,
  TransformError,
  solveTransform,
  solveTransformPreview,
} from "./bridge";
import { estimateSourceRasterSize } from "./source-raster-plan";
import {
  identityTransformRecipe,
  normalizedSpec,
  type TransformSpec,
  type Quad,
  unitQuad,
} from "./types";

// Real-WASM parity gate: the compose bridge must reproduce the Rust core's
// hand-verified 90-degree composition exactly, including the full
// AffineComposition field set, so the WASM/Web leg of the cross-adapter
// promotion gate does not rest on mocks.
beforeAll(async () => {
  const bytes = await readFile(
    new URL("../../wasm/pkg/worldbend_wasm_bg.wasm", import.meta.url),
  );
  initSync({ module: new WebAssembly.Module(bytes) });
});

function expectCloseToQuad(actual: Quad, expected: Quad): void {
  (
    ["tl", "tr", "br", "bl"] as const
  ).forEach((corner) => {
    expect(actual[corner].x).toBeCloseTo(expected[corner].x, 9);
    expect(actual[corner].y).toBeCloseTo(expected[corner].y, 9);
  });
}

describe("compose over the real WASM core", () => {
  it("plans explicit plane rectification through the real core", async () => {
    const sourceQuad = {
      tl: { x: 0.1, y: 0.15 },
      tr: { x: 0.9, y: 0.2 },
      br: { x: 0.8, y: 0.9 },
      bl: { x: 0.15, y: 0.8 },
    };
    const plan = await rectifyPlane({
      schema: "worldbend.rectify",
      version: "0.1",
      source: { space: "normalized", quad: sourceQuad },
      output: { width: 1200, height: 800 },
    });
    expect(plan.resolvedSourceQuad).toEqual(sourceQuad);
    expect(plan.outputQuad).toEqual({
      tl: { x: 0, y: 0 },
      tr: { x: 1200, y: 0 },
      br: { x: 1200, y: 800 },
      bl: { x: 0, y: 800 },
    });
    expect(plan.diagnostics.reprojection.max).toBeLessThan(
      plan.diagnostics.reprojection.limit,
    );
    expect(plan.outputSpec.schema).toBe("worldbend.transform");
  });

  it("keeps the compact binary preview ABI equivalent to the JSON contract", async () => {
    const spec = normalizedSpec({
      tl: { x: -0.1, y: 0.05 },
      tr: { x: 1.1, y: -0.02 },
      br: { x: 0.92, y: 1.08 },
      bl: { x: 0.04, y: 0.94 },
    });
    const target = { width: 640, height: 360 };
    const [full, preview] = await Promise.all([
      solveTransform(spec, target),
      solveTransformPreview(spec, target),
    ]);
    expect(preview.resolvedDestination.reference).toEqual(full.resolvedDestination.reference);
    expect(preview.homography.matrix).toEqual(full.homography.matrix);
  });

  it("keeps the compact binary Warp mesh equivalent to the JSON contract", async () => {
    const warp = { preset: "twist", amount: 0.8 } as const;
    const spec = normalizedSpec(unitQuad(), undefined, warp);
    const [full, preview] = await Promise.all([
      buildWarpMesh(warp),
      buildWarpMeshPreview(warp),
    ]);
    expect(preview).toEqual(full);
  });

  it("returns the full composition for a clockwise 90-degree rotation", async () => {
    const composition = await composeAffineTransform(
      normalizedSpec(unitQuad()),
      { ...identityTransformRecipe(), rotationDegrees: 90 },
      { width: 100, height: 50 },
    );

    expect(composition.canvas.origin).toEqual({ x: 25, y: -25 });
    expect(composition.canvas.size).toEqual({ width: 50, height: 100 });
    expectCloseToQuad(composition.rawQuad, {
      tl: { x: 75, y: -25 },
      tr: { x: 75, y: 75 },
      br: { x: 25, y: 75 },
      bl: { x: 25, y: -25 },
    });
    expect(composition.rawBounds).toEqual({ x: 25, y: -25, width: 50, height: 100 });
    expectCloseToQuad(composition.spec.destination.quad, {
      tl: { x: 1, y: 0 },
      tr: { x: 1, y: 1 },
      br: { x: 0, y: 1 },
      bl: { x: 0, y: 0 },
    });
    expect(composition.matrix).toHaveLength(9);
    expect(composition.matrix[1]).toBeCloseTo(-1, 9);
    expect(composition.matrix[3]).toBeCloseTo(1, 9);
    expect(composition.matrix[8]).toBeCloseTo(1, 9);
    expect(composition.diagnostics.geometry.convex).toBe(true);
    expect(composition.spec.destination.space).toBe("normalized");
  });

  it("records explicit flips as source orientation without touching geometry", async () => {
    const base = normalizedSpec(unitQuad());
    const unflipped = await composeAffineTransform(
      base,
      identityTransformRecipe(),
      { width: 100, height: 50 },
    );
    const flipped = await composeAffineTransform(
      base,
      { ...identityTransformRecipe(), flip: { x: true, y: false } },
      { width: 100, height: 50 },
    );

    expect(flipped.spec.content.orientation).toBe("flipHorizontal");
    expect(unflipped.spec.content.orientation).toBeUndefined();
    expect(flipped.matrix).toEqual(unflipped.matrix);
    expectCloseToQuad(flipped.rawQuad, unflipped.rawQuad);
    expect(flipped.canvas.size).toEqual(unflipped.canvas.size);

    // Solving the flipped spec yields an orientation-reversing homography:
    // the source top-left corner lands at the destination top-right.
    const { solveTransform } = await import("./bridge");
    const solved = await solveTransform(flipped.spec, flipped.canvas.size);
    expect(solved.diagnostics.matrix.determinant).toBeLessThan(0);
  });

  it("carries a bounded Warp through compose and expands the core mesh", async () => {
    const composition = await composeAffineTransform(
      normalizedSpec(unitQuad()),
      {
        ...identityTransformRecipe(),
        warp: { preset: "arc", amount: 1 },
      },
      { width: 100, height: 50 },
    );
    expect(composition.spec.content.warp).toEqual({ preset: "arc", amount: 1 });
    const mesh = await buildWarpMesh(composition.spec.content.warp!);
    expect(mesh.subdivisions).toBe(16);
    expect(mesh.vertices).toHaveLength(17 * 17);
    const center = mesh.vertices[8 * 17 + 8];
    expect(center?.source).toEqual({ x: 0.5, y: 0.5 });
    expect(center?.warped.y).toBeLessThan(0.5);

    const cleared = await composeAffineTransform(
      composition.spec,
      { ...identityTransformRecipe(), clearWarp: true },
      composition.canvas.size,
    );
    expect(cleared.spec.content.warp).toBeUndefined();
  });

  it("uses the real core Arc mesh when planning final source density", async () => {
    const spec = normalizedSpec(unitQuad(), undefined, { preset: "arc", amount: 1 });
    const { solveTransform } = await import("./bridge");
    const solved = await solveTransform(spec, { width: 1000, height: 1000 });
    const mesh = await buildWarpMesh(spec.content.warp!);

    const result = estimateSourceRasterSize(solved, spec, 4096, mesh);

    // Arc's actual peak vertical derivative is 1.6375. The old amount-only
    // 1.5x estimate returned 1621 px and undersampled this current core mesh.
    expect(result).toEqual({ width: 1281, height: 1769 });
  });

  it("rejects a Warp spec on the matrix3d-only CSS route", async () => {
    const failure = emitCssTransform(
      normalizedSpec(unitQuad(), undefined, { preset: "wave", amount: 0.5 }),
      { width: 100, height: 50 },
      { width: 100, height: 50 },
    );
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({ code: "E_SCHEMA" });
  });

  it("rejects a non-positive scale through the compose error path", async () => {
    const failure = composeAffineTransform(
      normalizedSpec(unitQuad()),
      { ...identityTransformRecipe(), scale: { x: 0, y: 1 } },
      { width: 100, height: 50 },
    );
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({ code: "E_SCHEMA" });
  });

  it("requires a concrete target size for a normalized base spec", async () => {
    const failure = composeAffineTransform(
      normalizedSpec(unitQuad()),
      identityTransformRecipe(),
    );
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({ code: "E_SCHEMA" });
  });

  it("preserves 1e15-scale coordinates without an f32 truncation path", async () => {
    // f64 has 0.125-ulp granularity at 1e15 while f32 collapses the whole
    // plane to a single value; exact corner equality therefore proves the
    // bridge never narrows coordinates to f32.
    const origin = 1e15;
    const spec: TransformSpec = {
      schema: "worldbend.transform",
      version: "0.1",
      destination: {
        space: "pixel",
        reference: { width: 2, height: 2 },
        quad: {
          tl: { x: origin, y: origin },
          tr: { x: origin + 2, y: origin },
          br: { x: origin + 2, y: origin + 2 },
          bl: { x: origin, y: origin + 2 },
        },
      },
      content: { fit: "stretch" },
    };
    const { solveTransform } = await import("./bridge");
    const solved = await solveTransform(spec);
    expect(solved.resolvedDestination.quad.tl.x).toBe(origin);
    expect(solved.resolvedDestination.quad.tl.y).toBe(origin);
    expect(solved.resolvedDestination.quad.br.x).toBe(origin + 2);
    expect(solved.resolvedDestination.quad.br.y).toBe(origin + 2);
    expect(solved.homography.matrix.every(Number.isFinite)).toBe(true);
    expect(solved.homography.inverse.every(Number.isFinite)).toBe(true);
    expect(solved.diagnostics.reprojection.max).toBeLessThan(
      solved.diagnostics.reprojection.limit,
    );
  });

  it("crosses genuine core failures as structured JSON errors", async () => {
    // A real failure raised inside the WASM module must reach TypeScript as
    // a structured TransformError, never as a raw thrown string.
    const { solveTransform } = await import("./bridge");
    const failure = solveTransform({
      ...normalizedSpec({
        tl: { x: 0.1, y: 0.1 },
        tr: { x: 0.9, y: 0.2 },
        br: { x: 0.2, y: 0.9 },
        bl: { x: 0.8, y: 0.8 },
      }),
    });
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({ code: "E_QUAD_SELF_INTERSECT" });
  });
});
