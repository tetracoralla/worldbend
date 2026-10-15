import { describe, expect, it, vi } from "vitest";
import { TemplateWorkspaceAsyncState } from "./template-workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("Template workspace asynchronous state", () => {
  it("ignores late scene-use errors after leaving or selecting another source", () => {
    const state = new TemplateWorkspaceAsyncState();
    state.enter(); state.beginUse(); state.beginSceneUse(1);
    state.sourceChanged(); state.beginUse(); state.beginSceneUse(2);
    expect(state.finishSceneUse(1)).toBe(false);
    expect(state.busy()).toBe(true);
    expect(state.finishSceneUse(2)).toBe(true);
    expect(state.busy()).toBe(false);
    state.beginUse(); state.beginSceneUse(3); state.leave();
    expect(state.finishSceneUse(3)).toBe(false);
  });
  it("invalidates old Use on source refresh without releasing a newer Use", () => {
    const state = new TemplateWorkspaceAsyncState();
    state.enter();
    const old = state.beginUse();
    state.sourceChanged();
    expect(state.active).toBe(true);
    expect(state.busy()).toBe(false);
    const current = state.beginUse();
    state.finishUse(old);
    expect(state.acceptsUse(old)).toBe(false);
    expect(state.acceptsUse(current)).toBe(true);
    expect(state.busy()).toBe(true);
    state.finishUse(current);
    expect(state.busy()).toBe(false);
  });

  it("invalidates an awaited Use when the workspace is left", async () => {
    const state = new TemplateWorkspaceAsyncState();
    const pending = deferred<void>();
    const onUse = vi.fn();
    state.enter();
    const generation = state.beginUse();
    const use = pending.promise.then(() => {
      if (state.acceptsUse(generation)) onUse();
    }).finally(() => state.finishUse(generation));

    state.leave();
    pending.resolve();
    await use;

    expect(onUse).not.toHaveBeenCalled();
    expect(state.active).toBe(false);
    expect(state.busy()).toBe(false);
  });

  it("only releases a pending delete for its matching receipt", () => {
    const state = new TemplateWorkspaceAsyncState();
    state.enter();
    state.beginDelete(1);

    expect(state.finishDelete({
      kind: "save",
      workspace: "mockup",
      requestId: 44,
    })).toBe(false);
    expect(state.finishDelete({ kind: "delete", requestId: 99 })).toBe(false);
    expect(state.busy()).toBe(true);
    expect(state.finishDelete({ kind: "delete", requestId: 1 })).toBe(true);
    expect(state.busy()).toBe(false);
  });
});
