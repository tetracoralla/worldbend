import { describe, expect, it } from "vitest";
import { userMessage } from "./i18n";
import { recipeFromValues, valuesComposeCleanly } from "./transform-controls";

const neutral = { scaleX: "100", scaleY: "100", rotation: "0", skewX: "0", skewY: "0" };

describe("transform recipe parsing", () => {
  it("parses neutral values into the identity recipe with native flips", () => {
    expect(recipeFromValues(neutral)).toEqual({
      scale: { x: 1, y: 1 },
      rotationDegrees: 0,
      skew: { xDegrees: 0, yDegrees: 0 },
      translation: { x: 0, y: 0 },
      pivot: { x: 0.5, y: 0.5 },
      flip: { x: false, y: false },
    });
  });

  it("converts percent scale to ratios and keeps 0.1-unit precision", () => {
    const recipe = recipeFromValues({
      ...neutral,
      scaleX: "12.5",
      rotation: "-45.2",
      skewY: "8.3",
    });
    expect(recipe.scale.x).toBeCloseTo(0.125, 10);
    expect(recipe.rotationDegrees).toBe(-45.2);
    expect(recipe.skew.yDegrees).toBe(8.3);
  });

  it("accepts the typed safe domain beyond the slider working range", () => {
    expect(valuesComposeCleanly({ ...neutral, scaleX: "500" })).toBe(true);
    expect(valuesComposeCleanly({ ...neutral, skewX: "88.9" })).toBe(true);
  });

  it("rejects intermediate typing states without throwing to the UI", () => {
    // These are the states `valuesComposeCleanly` must absorb quietly while
    // the user is still typing; only a committed failure surfaces an error.
    expect(valuesComposeCleanly({ ...neutral, scaleX: "" })).toBe(false);
    expect(valuesComposeCleanly({ ...neutral, scaleX: "0" })).toBe(false);
    expect(valuesComposeCleanly({ ...neutral, skewX: "89" })).toBe(false);
    expect(valuesComposeCleanly({ ...neutral, rotation: "abc" })).toBe(false);
  });

  it("reports the invalidTransform user message for out-of-domain values", () => {
    expect(() => recipeFromValues({ ...neutral, scaleX: "0" })).toThrow(
      userMessage("invalidTransform"),
    );
    expect(() => recipeFromValues({ ...neutral, scaleX: "1001" })).toThrow(
      userMessage("invalidTransform"),
    );
  });
});
