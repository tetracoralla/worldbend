import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { initSync, solve_json } from "../../wasm/pkg-figma/worldbend_wasm.js";
import type { SolveOutput, TransformSpec } from "@worldbend/web/types";
import { nativeCurrentSpec, nativeRendererFromShader, nativeShaderProperties, type NativeProjection } from "./native-projective";

initSync({ module: readFileSync(new URL("../../wasm/pkg-figma/worldbend_wasm_bg.wasm", import.meta.url)) });
const names = ["h00", "h01", "h02", "h10", "h11", "h12", "h20", "h21", "h22"];
const renderer = { id: "sampler", propertyIds: names, extentPropertyIds: ["sourceRight", "sourceBottom"] as [string, string] };
const spec: TransformSpec = {
  schema: "worldbend.transform", version: "0.1",
  destination: { space: "normalized", quad: {
    tl: { x: .08, y: .05 }, tr: { x: .96, y: .18 }, br: { x: .84, y: .96 }, bl: { x: .16, y: .85 },
  } }, content: { fit: "stretch" },
};

describe("native projection uses the real core inverse", () => {
  it.each([
    [80, 90, 160, 120], // outer-only Resize crops the original mapping
    [240, 180, 240, 180], // Scale moves the surface and output together
    [320, 100, 160, 120], // nonuniform enlargement of the output clip
  ])("preserves visible page geometry when reopening output %ix%i with surface %ix%i", (width, height, surfaceWidth, surfaceHeight) => {
    const operation = { ...spec, content: { fit: "stretch", orientation: "flipHorizontal" } };
    const record = { operation: JSON.stringify(operation), sourceSize: { width: 80, height: 60 },
      outputSize: { width: 160, height: 120 } } as NativeProjection;
    const current = nativeCurrentSpec(record, { width: surfaceWidth, height: surfaceHeight }, { width, height });
    const old = JSON.parse(solve_json(record.operation, 160, 120)) as SolveOutput;
    const next = JSON.parse(solve_json(JSON.stringify(current), width, height)) as SolveOutput;
    const project = (h: number[], u: number, v: number) => {
      const w = h[6]! * u + h[7]! * v + h[8]!;
      return { x: (h[0]! * u + h[1]! * v + h[2]!) / w, y: (h[3]! * u + h[4]! * v + h[5]!) / w };
    };
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [.37, .61]] as const) {
      const before = project(old.homography.matrix, u, v);
      const after = project(next.homography.matrix, u, v);
      expect(after.x).toBeCloseTo(before.x * surfaceWidth / 160, 8);
      expect(after.y).toBeCloseTo(before.y * surfaceHeight / 120, 8);
    }
    expect(JSON.parse(record.operation)).toEqual(operation);
  });

  for (const [width, height, orientation] of [
    [720, 400, "native"], [240, 800, "flipHorizontal"], [1080, 1080, "flipBoth"],
  ] as const) {
    it(`preserves UV and explicit orientation at ${width}x${height} (${orientation})`, () => {
      const source = { width: 520, height: 606 };
      const surface = { width: Math.max(width, source.width), height: Math.max(height, source.height) };
      const solved = JSON.parse(solve_json(JSON.stringify({ ...spec, content: { fit: "stretch", orientation } }), width, height)) as SolveOutput;
      const properties = nativeShaderProperties(renderer, solved.homography.inverse, source, surface);
      expect(properties["sourceRight"]).toBe(Math.fround(source.width / surface.width));
      expect(properties["sourceBottom"]).toBe(Math.fround(source.height / surface.height));
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1], [.37, .61]]) {
        const h = solved.homography.matrix;
        const w = h[6] * u! + h[7] * v! + h[8];
        const x = (h[0] * u! + h[1] * v! + h[2]) / w / surface.width;
        const y = (h[3] * u! + h[4] * v! + h[5]) / w / surface.height;
        const m = names.map((name) => properties[name]!);
        const q = m[6]! * x + m[7]! * y + m[8]!;
        const sampledU = (m[0]! * x + m[1]! * y + m[2]!) / q;
        const sampledV = (m[3]! * x + m[4]! * y + m[5]!) / q;
        expect(Math.abs(sampledU - u!) * source.width).toBeLessThan(.001);
        expect(Math.abs(sampledV - v!) * source.height).toBeLessThan(.001);
      }
    });
  }

  it("does not accept a same-named effect with incomplete or different controls", () => {
    expect(nativeRendererFromShader({ id: "wrong", type: "effect", propertyDefinitions: {} })).toBeUndefined();
    const definitions = Object.fromEntries([...names, "sourceRight", "sourceBottom"].map((name, i) => [String(i), { name, type: "NUMBER" }]));
    expect(nativeRendererFromShader({ id: "correct", type: "effect", propertyDefinitions: definitions })?.propertyIds).toEqual(names.map((_, i) => String(i)));
    definitions["0"]!.type = "TEXT";
    expect(nativeRendererFromShader({ id: "wrong", type: "effect", propertyDefinitions: definitions })).toBeUndefined();
  });
});
