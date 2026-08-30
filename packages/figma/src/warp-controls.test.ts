import { describe, expect, it } from "vitest";
import { parseWarpControls, warpAmountPercent } from "./warp-controls";

describe("Warp controls", () => {
  it("maps the human percent field into the bounded core value", () => {
    expect(parseWarpControls("arc", "-42.5")).toEqual({ preset: "arc", amount: -0.425 });
    expect(parseWarpControls("", "not read")).toBeUndefined();
  });

  it("rejects unknown presets and out-of-domain strength", () => {
    expect(() => parseWarpControls("custom", "50")).toThrow("preset is invalid");
    expect(() => parseWarpControls("wave", "")).toThrow("between -100 and 100");
    expect(() => parseWarpControls("wave", "101")).toThrow("between -100 and 100");
  });

  it("formats stored strength without inventing a default deformation", () => {
    expect(warpAmountPercent(undefined)).toBe("50");
    expect(warpAmountPercent({ preset: "twist", amount: 0.5 })).toBe("50");
    expect(warpAmountPercent({ preset: "twist", amount: -0.42 })).toBe("-42");
  });

  it("round-trips stored strength losslessly through the percent field", () => {
    // A preset-only edit re-parses this text; the stored amount must survive.
    for (const amount of [0.3333, -0.1234, 0.07, 1, -1, 0.005]) {
      const formatted = warpAmountPercent({ preset: "twist", amount });
      const parsed = parseWarpControls("twist", formatted);
      expect(parsed?.amount).toBe(amount);
    }
  });
});
