import { describe, expect, it } from "vitest";
import {
  createDeferredEditCommit,
  createEditHistory,
  type EditHistoryEntry,
} from "./edit-history";
import { normalizedSpec, unitQuad } from "@worldbend/web";

let counter = 0;
function entry(over: Partial<EditHistoryEntry> = {}): EditHistoryEntry {
  counter += 1;
  const frame = {
    spec: normalizedSpec(unitQuad()),
    renderWidth: 100,
    renderHeight: 100,
    placement: { x: counter, y: 0, width: 100, height: 100 },
  };
  return {
    mode: "distort",
    distortMode: "free",
    distortFrameDirty: false,
    values: { scaleX: "100", scaleY: "100", rotation: "0", skewX: "0", skewY: "0" },
    gestureTranslation: { x: 0, y: 0 },
    flip: { x: false, y: false },
    pivot: { x: 0.5, y: 0.5 },
    baseFrame: frame,
    activeFrame: frame,
    ...over,
  };
}

describe("createEditHistory", () => {
  it("cannot undo past the baseline", () => {
    const history = createEditHistory(entry());
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeUndefined();
  });

  it("steps back and forward through committed edits", () => {
    const baseline = entry({ values: { scaleX: "100", scaleY: "100", rotation: "0", skewX: "0", skewY: "0" } });
    const history = createEditHistory(baseline);
    const second = entry({ values: { scaleX: "150", scaleY: "150", rotation: "10", skewX: "0", skewY: "0" } });
    const third = entry({ values: { scaleX: "200", scaleY: "200", rotation: "20", skewX: "0", skewY: "0" } });
    history.push(second);
    history.push(third);

    expect(history.current()).toBe(third);
    expect(history.undo()?.values.scaleX).toBe("150");
    expect(history.current()).toBe(second);
    expect(history.redo()?.values.scaleX).toBe("200");
    expect(history.canRedo()).toBe(false);
  });

  it("restores the Distort behavior with the geometry entry", () => {
    const history = createEditHistory(
      entry({ distortMode: "free", distortFrameDirty: false }),
    );
    history.push(entry({
      distortMode: "perspective",
      distortFrameDirty: true,
    }));
    expect(history.current().distortMode).toBe("perspective");
    expect(history.current().distortFrameDirty).toBe(true);
    const undone = history.undo();
    expect(undone?.distortMode).toBe("free");
    expect(undone?.distortFrameDirty).toBe(false);
    const redone = history.redo();
    expect(redone?.distortMode).toBe("perspective");
    expect(redone?.distortFrameDirty).toBe(true);
  });

  it("truncates the redo tail on a new edit after undo", () => {
    const history = createEditHistory(entry());
    history.push(entry());
    history.push(entry());
    history.undo();
    const afterUndo = history.current();
    history.push(entry());
    expect(history.current()).not.toBe(afterUndo);
    expect(history.canRedo()).toBe(false);
  });

  it("restores a fresh baseline for a new session", () => {
    const history = createEditHistory(entry());
    history.push(entry());
    history.push(entry());
    const fresh = entry();
    history.resetToBaseline(fresh);
    expect(history.current()).toBe(fresh);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
  });

  it("caps the stack without losing the current entry", () => {
    const history = createEditHistory(entry());
    for (let index = 0; index < 150; index += 1) history.push(entry());
    expect(history.canUndo()).toBe(true);
    let steps = 0;
    while (history.undo()) steps += 1;
    expect(steps).toBe(99);
  });

  it("does not add a duplicate current state", () => {
    const baseline = entry();
    const history = createEditHistory(baseline);
    history.push(structuredClone(baseline));
    expect(history.canUndo()).toBe(false);
  });
});

describe("createDeferredEditCommit", () => {
  it("waits for the matching async result and flushes only once", () => {
    let committed = 0;
    const deferred = createDeferredEditCommit(() => {
      committed += 1;
    });
    deferred.request();
    expect(committed).toBe(0);
    expect(deferred.flush()).toBe(true);
    expect(committed).toBe(1);
    expect(deferred.flush()).toBe(false);
    expect(committed).toBe(1);
  });

  it("drops a request when composition fails or the session resets", () => {
    let committed = 0;
    const deferred = createDeferredEditCommit(() => {
      committed += 1;
    });
    deferred.request();
    deferred.clear();
    expect(deferred.isPending()).toBe(false);
    expect(deferred.flush()).toBe(false);
    expect(committed).toBe(0);
  });
});
