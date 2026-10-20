import { describe, expect, it } from "vitest";
import { sliderProgress, sliderValueForNumber } from "./slider-domain";

describe("slider working domains", () => {
  it("keeps a wider exact value while placing the coarse slider at its edge", () => {
    expect(sliderValueForNumber("500", 10, 300, 100)).toBe(300);
    expect(sliderValueForNumber("0.1", 10, 300, 100)).toBe(10);
  });

  it("leaves the coarse control stable while the exact field is incomplete", () => {
    expect(sliderValueForNumber("", -180, 180, 12)).toBe(12);
    expect(sliderValueForNumber("not-a-number", -180, 180, 12)).toBe(12);
  });

  it("computes bounded track progress at minimum, neutral, and maximum", () => {
    expect(sliderProgress(-180, -180, 180)).toBe(0);
    expect(sliderProgress(0, -180, 180)).toBe(50);
    expect(sliderProgress(180, -180, 180)).toBe(100);
  });
});
