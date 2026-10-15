import { afterEach, expect, it, vi } from "vitest";
import { observePointerSessionBoundary } from "./pointer-session";

afterEach(() => vi.unstubAllGlobals());

function fixture(pointerType = "mouse") {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win); vi.stubGlobal("document", doc);
  const onRelease = vi.fn(), onInterrupt = vi.fn();
  const cleanup = observePointerSessionBoundary({ pointerId: 7, pointerType, onRelease, onInterrupt });
  const send = (type: string, fields: object = {}) => win.dispatchEvent(Object.assign(new Event(type), fields));
  return { win, doc, onRelease, onInterrupt, cleanup, send };
}

it("foreign input and zero-button hover cannot steal a pending release", () => {
  const f = fixture();
  f.send("pointerdown", { pointerId: 8, button: 0 });
  f.send("pointercancel", { pointerId: 8 });
  f.send("pointerup", { pointerId: 8 });
  f.send("pointermove", { pointerId: 7, buttons: 0, clientX: 999 });
  expect(f.onRelease).not.toHaveBeenCalled(); expect(f.onInterrupt).not.toHaveBeenCalled();
  f.send("pointerup", { pointerId: 7, clientX: 160, clientY: 80 });
  expect(f.onRelease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientX: 160, clientY: 80 }));
  f.send("mouseup", { button: 0 }); f.send("blur");
  expect(f.onRelease).toHaveBeenCalledTimes(1); expect(f.onInterrupt).not.toHaveBeenCalled();
});

it("foreign primary pointers make untyped mouseup ambiguous until the matching release", () => {
  const f = fixture();
  f.send("pointerdown", { pointerId: 8, pointerType: "touch", isPrimary: true });
  f.send("mouseup", { button: 0, clientX: 999 });
  f.send("pointerup", { pointerId: 8, pointerType: "touch" });
  f.send("mouseup", { button: 0, clientX: 999 });
  expect(f.onRelease).not.toHaveBeenCalled();
  f.send("mouseup", { button: 0, clientX: 140 });
  expect(f.onRelease).not.toHaveBeenCalled();
  f.send("pointerup", { pointerId: 7, clientX: 140 });
  expect(f.onRelease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientX: 140 }));
});

it.each(["touch", "pen"])("an unrelated mouseup cannot release an owned %s pointer", pointerType => {
  const f = fixture(pointerType);
  f.send("mouseup", { button: 0, clientX: 999 });
  expect(f.onRelease).not.toHaveBeenCalled();
  f.send("pointerup", { pointerId: 7, clientX: 140 });
  expect(f.onRelease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientX: 140 }));
});

it("a non-primary foreign touch does not consume a later mouse-only host release", () => {
  const f = fixture();
  f.send("pointerdown", { pointerId: 8, pointerType: "touch", isPrimary: false });
  f.send("pointerup", { pointerId: 8, pointerType: "touch", isPrimary: false });
  f.send("mouseup", { button: 0, clientX: 140 });
  expect(f.onRelease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientX: 140 }));
});

it.each(["pointerdown", "pointercancel", "blur", "pagehide", "hidden"])(
  "a missing release recovers once through %s, without a late phantom release", kind => {
    const f = fixture();
    if (kind === "hidden") { f.doc.visibilityState = "hidden"; f.doc.dispatchEvent(new Event("visibilitychange")); }
    else f.send(kind, { pointerId: 7, button: 0 });
    expect(f.onInterrupt).toHaveBeenCalledTimes(1);
    f.send("pointerup", { pointerId: 7, clientX: 999 }); f.send("blur");
    expect(f.onRelease).not.toHaveBeenCalled(); expect(f.onInterrupt).toHaveBeenCalledTimes(1);
  },
);

it("compatible mouseup owns the final coordinate and cleanup retires all handlers", () => {
  const f = fixture();
  f.send("mouseup", { button: 2 }); expect(f.onRelease).not.toHaveBeenCalled();
  f.send("mouseup", { button: 0, clientX: 140 });
  expect(f.onRelease).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientX: 140 }));
  const next = fixture(); next.cleanup();
  next.send("pointerup", { pointerId: 7 }); next.send("pointerdown", { pointerId: 7, button: 0 });
  next.doc.visibilityState = "hidden"; next.doc.dispatchEvent(new Event("visibilitychange"));
  expect(next.onRelease).not.toHaveBeenCalled(); expect(next.onInterrupt).not.toHaveBeenCalled();
});

it("removes every installed lifecycle listener with matching capture flags", () => {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", win); vi.stubGlobal("document", doc);
  const add = vi.spyOn(win, "addEventListener"), remove = vi.spyOn(win, "removeEventListener");
  const addDoc = vi.spyOn(doc, "addEventListener"), removeDoc = vi.spyOn(doc, "removeEventListener");
  const cleanup = observePointerSessionBoundary({ pointerId: 1, pointerType: "mouse", onRelease() {}, onInterrupt() {} });
  cleanup(); cleanup();
  expect(remove.mock.calls).toEqual(add.mock.calls);
  expect(removeDoc.mock.calls).toEqual(addDoc.mock.calls);
});
