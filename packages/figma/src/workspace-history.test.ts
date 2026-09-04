import { describe, expect, it } from "vitest";
import { createWorkspaceHistory } from "./workspace-history";

describe("workspace history", () => {
  it("restores independent snapshots and truncates redo after a new edit", () => {
    const history = createWorkspaceHistory({ value: 0, nested: { value: 0 } });
    history.push({ value: 1, nested: { value: 1 } });
    const restored = history.undo();
    restored!.nested.value = 99;
    expect(history.redo()).toEqual({ value: 1, nested: { value: 1 } });
    history.undo();
    history.push({ value: 2, nested: { value: 2 } });
    expect(history.canRedo()).toBe(false);
  });
});
