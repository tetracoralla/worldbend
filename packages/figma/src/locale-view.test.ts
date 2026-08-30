import { describe, expect, it } from "vitest";
import { nextMenuIndex } from "./locale-view";

describe("options menu keyboard routing", () => {
  it("navigates the whole enabled menu rather than the locale subset", () => {
    expect(nextMenuIndex(-1, "ArrowDown", 8)).toBe(0);
    expect(nextMenuIndex(-1, "ArrowUp", 8)).toBe(7);
    expect(nextMenuIndex(0, "ArrowUp", 8)).toBe(7);
    expect(nextMenuIndex(7, "ArrowDown", 8)).toBe(0);
  });

  it("supports Home and End", () => {
    expect(nextMenuIndex(5, "Home", 8)).toBe(0);
    expect(nextMenuIndex(2, "End", 8)).toBe(7);
    expect(nextMenuIndex(2, "Tab", 8)).toBeUndefined();
  });
});
