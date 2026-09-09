import { describe, expect, it, vi } from "vitest";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";

function key(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return {
    key,
    shiftKey: options.shiftKey ?? false,
    metaKey: options.metaKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    target: null,
    defaultPrevented: false,
    preventDefault(this: { defaultPrevented: boolean }) { this.defaultPrevented = true; },
  } as unknown as KeyboardEvent;
}

describe("workspace history shortcuts", () => {
  it("supports standard undo and both redo forms in a live draft", () => {
    const restore = vi.fn();
    const post = vi.fn();
    const history = { undo: vi.fn(() => "undo"), redo: vi.fn(() => "redo") };
    for (const event of [
      key("z", { metaKey: true }),
      key("z", { metaKey: true, shiftKey: true }),
      key("y", { ctrlKey: true }),
    ]) {
      expect(handleWorkspaceHistoryShortcut({ event, phase: "ready", appliedResultPending: false, undoRouted: false, history, post, restore }).handled).toBe(true);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(restore.mock.calls.map(([value]) => value)).toEqual(["undo", "redo", "redo"]);
    expect(post).not.toHaveBeenCalled();
  });

  it("routes only one unmodified undo to Figma after Apply", () => {
    const post = vi.fn();
    const first = handleWorkspaceHistoryShortcut({
      event: key("z", { metaKey: true }),
      phase: "ready",
      appliedResultPending: true,
      undoRouted: false,
      history: undefined,
      post,
      restore: vi.fn(),
    });
    expect(first).toEqual({ handled: true, undoRouted: true });
    expect(post).toHaveBeenCalledWith({ type: "trigger-undo" });
  });
});
