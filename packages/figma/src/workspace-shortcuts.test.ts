import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => vi.unstubAllGlobals());

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

  it("leaves text-field Undo with the field after Apply and preserves the pending document Undo", () => {
    class Field {
      type = "text";
      closest() { return this; }
    }
    vi.stubGlobal("HTMLElement", Field);
    vi.stubGlobal("HTMLInputElement", Field);
    const field = new Field();
    const post = vi.fn(), restore = vi.fn();
    const textUndo = Object.assign(key("z", { metaKey: true }), { target: field });
    const inField = handleWorkspaceHistoryShortcut({ event: textUndo, phase: "ready",
      appliedResultPending: true, undoRouted: false, history: undefined, post, restore });
    expect(inField).toEqual({ handled: false, undoRouted: false });
    expect(textUndo.defaultPrevented).toBe(false);
    expect(post).not.toHaveBeenCalled();
    const canvasUndo = key("z", { metaKey: true });
    const onCanvas = handleWorkspaceHistoryShortcut({ event: canvasUndo, phase: "ready",
      appliedResultPending: true, undoRouted: inField.undoRouted, history: undefined, post, restore });
    expect(onCanvas).toEqual({ handled: true, undoRouted: true });
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith({ type: "trigger-undo" });
  });
});
