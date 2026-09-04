import { describe, expect, it } from "vitest";
import {
  isWorkspaceNavigationDisabled,
  taskWorkspaceAvailability,
  workspaceNavigationFocusableWorkspace,
  workspaceNavigationTargetIndex,
} from "./task-launcher";

describe("workspace navigation keyboard navigation", () => {
  it("moves across the same-level workspace strip", () => {
    expect(workspaceNavigationTargetIndex("ArrowRight", 0, 6)).toBe(1);
    expect(workspaceNavigationTargetIndex("ArrowRight", 5, 6)).toBe(0);
    expect(workspaceNavigationTargetIndex("ArrowLeft", 0, 6)).toBe(5);
    expect(workspaceNavigationTargetIndex("ArrowDown", 1, 6)).toBe(2);
    expect(workspaceNavigationTargetIndex("ArrowUp", 1, 6)).toBe(0);
    expect(workspaceNavigationTargetIndex("Home", 3, 6)).toBe(0);
    expect(workspaceNavigationTargetIndex("End", 1, 6)).toBe(5);
    expect(workspaceNavigationTargetIndex("Enter", 1, 6)).toBeUndefined();
  });

  it("recovers from an unfocused menu and an empty availability set", () => {
    expect(workspaceNavigationTargetIndex("ArrowRight", -1, 3)).toBe(0);
    expect(workspaceNavigationTargetIndex("ArrowLeft", -1, 3)).toBe(2);
    expect(workspaceNavigationTargetIndex("ArrowRight", 0, 0)).toBeUndefined();
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

  it("keeps Perspective as the keyboard and pointer recovery path", () => {
    const available = taskWorkspaceAvailability(1);
    expect(isWorkspaceNavigationDisabled("perspective", true, available)).toBe(false);
    expect(isWorkspaceNavigationDisabled("mesh", true, available)).toBe(true);
    expect(workspaceNavigationFocusableWorkspace("mesh", true, available)).toBe("perspective");
    expect(workspaceNavigationFocusableWorkspace("mesh", false, available)).toBe("mesh");
  });
});
