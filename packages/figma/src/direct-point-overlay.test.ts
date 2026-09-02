import { describe, expect, it } from "vitest";
import { keyboardNudgeDelta } from "./direct-point-overlay";

describe("keyboardNudgeDelta", () => {
  it("nudges one canvas pixel per press and ten with Shift", () => {
    expect(keyboardNudgeDelta("ArrowRight", false, 400, 200)).toEqual({ x: 0.0025, y: 0 });
    expect(keyboardNudgeDelta("ArrowRight", true, 400, 200)).toEqual({ x: 0.025, y: 0 });
    expect(keyboardNudgeDelta("ArrowDown", true, 400, 200)).toEqual({ x: 0, y: 0.05 });
  });

  it("keeps non-arrow keys inert", () => {
    expect(keyboardNudgeDelta("Enter", false, 400, 200)).toEqual({ x: 0, y: 0 });
    expect(keyboardNudgeDelta("a", true, 400, 200)).toEqual({ x: 0, y: 0 });
  });

  it("degrades to a normalized step when the canvas box is not laid out", () => {
    expect(keyboardNudgeDelta("ArrowLeft", false, 0, 0)).toEqual({ x: -1, y: 0 });
  });
});
