import { describe, expect, it } from "vitest";
import {
  taskMenuTargetIndex,
  taskWorkspaceAvailability,
} from "./task-launcher";

describe("task launcher keyboard navigation", () => {
  it("matches the horizontal icon layout while retaining vertical menu keys", () => {
    expect(taskMenuTargetIndex("ArrowRight", 0, 5)).toBe(1);
    expect(taskMenuTargetIndex("ArrowRight", 4, 5)).toBe(0);
    expect(taskMenuTargetIndex("ArrowLeft", 0, 5)).toBe(4);
    expect(taskMenuTargetIndex("ArrowDown", 1, 5)).toBe(2);
    expect(taskMenuTargetIndex("ArrowUp", 1, 5)).toBe(0);
    expect(taskMenuTargetIndex("Home", 3, 5)).toBe(0);
    expect(taskMenuTargetIndex("End", 1, 5)).toBe(4);
    expect(taskMenuTargetIndex("Enter", 1, 5)).toBeUndefined();
  });

  it("recovers from an unfocused menu and an empty availability set", () => {
    expect(taskMenuTargetIndex("ArrowRight", -1, 3)).toBe(0);
    expect(taskMenuTargetIndex("ArrowLeft", -1, 3)).toBe(2);
    expect(taskMenuTargetIndex("ArrowRight", 0, 0)).toBeUndefined();
  });
});

describe("task workspace availability", () => {
  it("keeps every entry point on the same source-count contract", () => {
    expect(taskWorkspaceAvailability(0)).toEqual({
      templates: false,
      canvas: false,
      mesh: false,
      mockup: false,
      remap: false,
    });
    expect(taskWorkspaceAvailability(1)).toEqual({
      templates: true,
      canvas: true,
      mesh: true,
      mockup: true,
      remap: true,
    });
    expect(taskWorkspaceAvailability(2)).toEqual({
      templates: true,
      canvas: false,
      mesh: false,
      mockup: true,
      remap: true,
    });
    expect(taskWorkspaceAvailability(8).mockup).toBe(true);
    expect(taskWorkspaceAvailability(9).templates).toBe(false);
  });
});
