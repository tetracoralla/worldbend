import { describe, expect, it } from "vitest";
import {
  defaultWorkspaceForSourceCount,
  isWorkspaceNavigationDisabled,
  taskWorkspaceAvailability,
  workspaceNavigationFocusableWorkspace,
  workspaceNavigationTargetIndex,
} from "./task-launcher";

describe("workspace navigation keyboard navigation", () => {
  it("moves across the same-level workspace strip", () => {
    expect(workspaceNavigationTargetIndex("ArrowRight", 0, 7)).toBe(1);
    expect(workspaceNavigationTargetIndex("ArrowRight", 6, 7)).toBe(0);
    expect(workspaceNavigationTargetIndex("ArrowLeft", 0, 7)).toBe(6);
    expect(workspaceNavigationTargetIndex("ArrowDown", 1, 7)).toBe(2);
    expect(workspaceNavigationTargetIndex("ArrowUp", 1, 7)).toBe(0);
    expect(workspaceNavigationTargetIndex("Home", 3, 7)).toBe(0);
    expect(workspaceNavigationTargetIndex("End", 1, 7)).toBe(6);
    expect(workspaceNavigationTargetIndex("Enter", 1, 7)).toBeUndefined();
  });

  it("recovers from an unfocused menu and an empty availability set", () => {
    expect(workspaceNavigationTargetIndex("ArrowRight", -1, 3)).toBe(0);
    expect(workspaceNavigationTargetIndex("ArrowLeft", -1, 3)).toBe(2);
    expect(workspaceNavigationTargetIndex("ArrowRight", 0, 0)).toBeUndefined();
  });
});

describe("task workspace availability", () => {
  it("opens a multi-source selection as one Composition job", () => {
    expect(defaultWorkspaceForSourceCount(1)).toBe("perspective");
    expect(defaultWorkspaceForSourceCount(2)).toBe("mockup");
    expect(defaultWorkspaceForSourceCount(5)).toBe("mockup");
    expect(defaultWorkspaceForSourceCount(8)).toBe("mockup");
    expect(defaultWorkspaceForSourceCount(9)).toBe("perspective");
  });

  it("keeps every entry point on the same source-count contract", () => {
    expect(taskWorkspaceAvailability(0)).toEqual({
      templates: false,
      canvas: false,
      spatial: false,
      mesh: false,
      surface: false,
      mockup: false,
      remap: false,
      appearance: true,
      card: true,
      presets: true,
    });
    expect(taskWorkspaceAvailability(1)).toEqual({
      templates: true,
      canvas: true,
      spatial: false,
      mesh: true,
      surface: true,
      mockup: true,
      remap: true,
      appearance: true,
      card: true,
      presets: true,
    });
    expect(taskWorkspaceAvailability(2)).toEqual({
      templates: true,
      canvas: false,
      spatial: true,
      mesh: false,
      surface: false,
      mockup: true,
      remap: true,
      appearance: true,
      card: true,
      presets: true,
    });
    expect(taskWorkspaceAvailability(3).spatial).toBe(true);
    expect(taskWorkspaceAvailability(8).spatial).toBe(true);
    expect(taskWorkspaceAvailability(8).mockup).toBe(true);
    expect(taskWorkspaceAvailability(9).templates).toBe(false);
    // Appearance reads the live selection itself, so it stays reachable for
    // effect-capable layers that never become raster sources.
    expect(taskWorkspaceAvailability(0).appearance).toBe(true);
    expect(taskWorkspaceAvailability(9).appearance).toBe(true);
  });

  it("keeps Perspective as the keyboard and pointer recovery path", () => {
    const available = taskWorkspaceAvailability(1);
    expect(isWorkspaceNavigationDisabled("perspective", true, available)).toBe(false);
    expect(isWorkspaceNavigationDisabled("mesh", true, available)).toBe(true);
    expect(workspaceNavigationFocusableWorkspace("mesh", true, available)).toBe("perspective");
    expect(workspaceNavigationFocusableWorkspace("mesh", false, available)).toBe("mesh");
  });
});
