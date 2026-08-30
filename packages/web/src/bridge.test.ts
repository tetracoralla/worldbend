import { describe, expect, it, vi } from "vitest";

vi.mock("@worldbend/wasm", () => ({
  default: vi.fn(),
  compose_json: vi.fn(),
  solve_json: vi.fn(),
  css_json: vi.fn(),
  warp_mesh_json: vi.fn(),
}));

import initWasm, { compose_json, solve_json } from "@worldbend/wasm";
import { composeAffineTransform, TransformError, solveTransform } from "./bridge";
import { identityTransformRecipe, normalizedSpec, unitQuad } from "./types";

describe("canonical web data", () => {
  it("builds the versioned normalized TransformSpec", () => {
    expect(normalizedSpec(unitQuad())).toEqual({
      schema: "worldbend.transform",
      version: "0.1",
      destination: { space: "normalized", quad: unitQuad() },
      content: { fit: "stretch" },
    });
  });
});

describe("bridge error chain", () => {
  it("passes a semantic affine recipe through the canonical WASM bridge", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(compose_json).mockReturnValue(
      JSON.stringify({
        spec: normalizedSpec(unitQuad()),
        canvas: { origin: { x: 0, y: 0 }, size: { width: 8, height: 4 } },
      }),
    );

    const recipe = identityTransformRecipe();
    const output = await composeAffineTransform(normalizedSpec(unitQuad()), recipe, {
      width: 8,
      height: 4,
    });
    expect(compose_json).toHaveBeenCalledWith(
      JSON.stringify(normalizedSpec(unitQuad())),
      JSON.stringify(recipe),
      8,
      4,
    );
    expect(output.canvas.size).toEqual({ width: 8, height: 4 });
  });

  it("maps a compose error string through the same TransformError chain", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(compose_json).mockImplementation(() => {
      throw '{"code":"E_SCHEMA","message":"transform scale must be greater than 1e-6"}';
    });

    const failure = composeAffineTransform(
      normalizedSpec(unitQuad()),
      { ...identityTransformRecipe(), scale: { x: 0, y: 1 } },
      { width: 8, height: 4 },
    );
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({
      code: "E_SCHEMA",
      message: "transform scale must be greater than 1e-6",
    });
  });

  it("parses a thrown wasm-bindgen error string into a coded TransformError", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(solve_json).mockImplementation(() => {
      throw '{"code":"E_QUAD_CONCAVE","message":"quad is concave"}';
    });

    const failure = solveTransform(normalizedSpec(unitQuad()), { width: 4, height: 4 });
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({
      code: "E_QUAD_CONCAVE",
      message: "quad is concave",
    });
  });

  it("wraps a raw wasm RuntimeError as an E_INTERNAL TransformError", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(solve_json).mockImplementation(() => {
      throw new WebAssembly.RuntimeError("unreachable");
    });

    const failure = solveTransform(normalizedSpec(unitQuad()), { width: 4, height: 4 });
    await expect(failure).rejects.toBeInstanceOf(TransformError);
    await expect(failure).rejects.toMatchObject({ code: "E_INTERNAL" });
  });

  it("rethrows a non-JSON error string unchanged", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(solve_json).mockImplementation(() => {
      throw "not json";
    });

    await expect(
      solveTransform(normalizedSpec(unitQuad()), { width: 4, height: 4 }),
    ).rejects.toBe("not json");
  });

  it("returns the parsed solve output on success", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    vi.mocked(solve_json).mockReturnValue('{"homography":{"matrix":[1,0,0,0,1,0,0,0,1]}}');

    const output = await solveTransform(normalizedSpec(unitQuad()), { width: 4, height: 4 });
    expect(output).toEqual({
      homography: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    });
  });
});
