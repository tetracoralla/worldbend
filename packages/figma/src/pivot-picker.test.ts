import { describe, expect, it } from "vitest";
import { nextPivotIndex, pivotMatchesPreset } from "./pivot-picker";

describe("pivot preset keyboard routing", () => {
  it("moves spatially and wraps within the 3x3 grid", () => {
    expect(nextPivotIndex(4, "ArrowLeft")).toBe(3);
    expect(nextPivotIndex(3, "ArrowLeft")).toBe(5);
    expect(nextPivotIndex(4, "ArrowRight")).toBe(5);
    expect(nextPivotIndex(5, "ArrowRight")).toBe(3);
    expect(nextPivotIndex(1, "ArrowUp")).toBe(7);
    expect(nextPivotIndex(7, "ArrowDown")).toBe(1);
  });

  it("supports Home and End and ignores unrelated keys", () => {
    expect(nextPivotIndex(4, "Home")).toBe(0);
    expect(nextPivotIndex(4, "End")).toBe(8);
    expect(nextPivotIndex(4, "Enter")).toBeUndefined();
  });
});

describe("pivot preset selection", () => {
  it("absorbs floating residue when a continuous pivot returns to a preset", () => {
    expect(pivotMatchesPreset({ x: 0, y: 0 }, { x: 2e-16, y: -3e-16 })).toBe(true);
    expect(pivotMatchesPreset({ x: 0, y: 0 }, { x: 0.001, y: 0 })).toBe(false);
  });
});
