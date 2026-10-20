import { describe, expect, it } from "vitest";
import { unitQuad } from "@worldbend/web";
import {
  canApplyOutput,
  outputSizeForQuad,
  planFigmaOutput,
  rasterSizeForPolicy,
} from "./output-density";

describe("Figma output density", () => {
  it("keeps a safe output at its requested density", () => {
    expect(planFigmaOutput(
      { width: 4000, height: 3000 },
      { width: 3800, height: 2850 },
      4096,
    )).toEqual({
      source: { width: 4000, height: 3000 },
      requested: { width: 3800, height: 2850 },
      applied: { width: 3800, height: 2850 },
      scale: 1,
      fitted: false,
      change: "smaller",
    });
  });

  it("fits both axes proportionally when one requested axis exceeds 4096", () => {
    const plan = planFigmaOutput(
      { width: 4000, height: 4000 },
      { width: 4400, height: 3800 },
      4096,
    );
    expect(plan).toMatchObject({
      requested: { width: 4400, height: 3800 },
      applied: { width: 4096, height: 3537 },
      fitted: true,
      change: "mixed",
    });
    expect(plan.scale).toBeCloseTo(4096 / 4400, 12);
    expect(canApplyOutput(plan, "fit")).toBe(true);
    expect(canApplyOutput(plan, "original")).toBe(false);
    expect(rasterSizeForPolicy(plan, "fit")).toEqual({ width: 4096, height: 3537 });
  });

  it("computes live tight bounds for an outward normalized quad", () => {
    const quad = unitQuad();
    quad.tl = { x: -0.1, y: -0.25 };
    quad.tr = { x: 1.05, y: 0 };
    expect(outputSizeForQuad(quad, { width: 4000, height: 2000 })).toEqual({
      width: 4600,
      height: 2500,
    });
  });

  it("rejects non-representable dimensions before UI or export use", () => {
    expect(() => planFigmaOutput(
      { width: 100, height: 100 },
      { width: Number.POSITIVE_INFINITY, height: 100 },
      4096,
    )).toThrow("invalid dimensions");
  });
});
