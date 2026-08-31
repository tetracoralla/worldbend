import { describe, expect, it, vi } from "vitest";

vi.mock("@worldbend/wasm", () => ({
  default: vi.fn(),
  canvas_plan_json: vi.fn(),
  canvas_set_plan_json: vi.fn(),
  compose_json: vi.fn(),
  solve_json: vi.fn(),
  css_json: vi.fn(),
  rectify_json: vi.fn(),
  warp_mesh_json: vi.fn(),
}));

import initWasm, {
  canvas_plan_json,
  canvas_set_plan_json,
  compose_json,
  rectify_json,
  solve_json,
} from "@worldbend/wasm";
import {
  composeAffineTransform,
  planCanvas,
  planCanvasSet,
  rectifyPlane,
  TransformError,
  solveTransform,
} from "./bridge";
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

  it("passes an explicit RectifySpec through without deriving geometry in TypeScript", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    const spec = {
      schema: "worldbend.rectify" as const,
      version: "0.1" as const,
      source: { space: "normalized" as const, quad: unitQuad() },
      output: { width: 640, height: 480 },
    };
    vi.mocked(rectify_json).mockReturnValue(
      JSON.stringify({ outputQuad: { ...unitQuad(), br: { x: 640, y: 480 } } }),
    );

    await rectifyPlane(spec);
    expect(rectify_json).toHaveBeenCalledWith(JSON.stringify(spec));
  });

  it("passes Canvas fit semantics to Rust and returns its resolved placement unchanged", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    const operation = {
      kind: "contain" as const,
      output: { width: 1200, height: 628 },
      anchor: { x: 0.5, y: 1 },
      background: { kind: "transparent" as const },
    };
    const spec = { schema: "worldbend.canvas" as const, version: "0.1" as const, operation };
    const plan = {
      schema: "worldbend.canvas-plan",
      version: "0.1",
      sourceSize: { width: 800, height: 800 },
      sourceRect: { x: 0, y: 0, width: 800, height: 800 },
      outputSize: operation.output,
      placement: { x: 286, y: 0, width: 628, height: 628 },
      scale: { x: 0.785, y: 0.785 },
      operation: "contain",
      background: operation.background,
    };
    vi.mocked(canvas_plan_json).mockReturnValue(JSON.stringify(plan));

    await expect(planCanvas(spec, { width: 800, height: 800 })).resolves.toEqual(plan);
    expect(canvas_plan_json).toHaveBeenCalledWith(JSON.stringify(spec), 800, 800);
  });

  it("preserves Canvas Set order and rejects source dimensions before u32 coercion", async () => {
    vi.mocked(initWasm).mockResolvedValue({} as never);
    const operation = {
      kind: "cover" as const,
      output: { width: 1080, height: 1080 },
      anchor: { x: 0.5, y: 0.5 },
      background: { kind: "transparent" as const },
    };
    const spec = {
      schema: "worldbend.canvas-set" as const,
      version: "0.1" as const,
      variants: [
        { id: "first", operation },
        { id: "second", operation: { ...operation, kind: "contain" as const } },
      ],
    } as Parameters<typeof planCanvasSet>[0];
    vi.mocked(canvas_set_plan_json).mockReturnValue(
      JSON.stringify({
        schema: "worldbend.canvas-set-plan",
        version: "0.1",
        sourceSize: { width: 640, height: 480 },
        variants: spec.variants.map(({ id }) => ({ id, plan: {} })),
      }),
    );
    const result = await planCanvasSet(spec, { width: 640, height: 480 });
    expect(result.variants.map((variant) => variant.id)).toEqual(["first", "second"]);
    await expect(planCanvas(spec.variants[0] as never, { width: -1, height: 480 })).rejects.toMatchObject({
      code: "E_SCHEMA",
    });
    expect(canvas_plan_json).not.toHaveBeenCalledWith(expect.anything(), -1, 480);
  });
});
