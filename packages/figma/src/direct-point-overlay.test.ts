import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectPointGestureSession, createDirectPointOverlay, keyboardNudgeDelta } from "./direct-point-overlay";
import {solveTransform} from "@worldbend/web";
import {planeCoordinates} from "./plane-coordinates";

afterEach(() => vi.unstubAllGlobals());

class OverlayElement extends EventTarget {
  children: OverlayElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  attributes: Record<string, string> = {};
  className = "";
  type = "";
  focus = vi.fn();
  captured = new Set<number>();
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name]; }
  closest(selector: string) { return selector.includes("direct-point") && this.className.includes("direct-point") ? this : null; }
  append(child: OverlayElement) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  remove() {}
  querySelectorAll() { return this.children; }
  querySelector(selector: string) { return this.children.find(n => selector.includes(`"${n.dataset.pointId}"`)); }
  getBoundingClientRect() { return { left: 100, top: 50, width: 400, height: 200 }; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
}

it("keeps the last valid fitted point when the pointer leaves a concave domain", () => {
  const windowTarget = new EventTarget();
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", Object.assign(new EventTarget(), {createElement: () => new OverlayElement()}));
  const host = new OverlayElement(), canvas = new OverlayElement(), onMove = vi.fn();
  const coordinates = {
    project: vi.fn((point: {x:number;y:number}) => point),
    unproject: vi.fn((point: {x:number;y:number}) => point.x < .8 ? point : undefined),
  };
  const overlay = createDirectPointOverlay({host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, coordinates, onMove});
  overlay.set([{id:"6",x:.5,y:.5,label:"Fitted point"}]);
  const button = host.children[0]!.children[0]!;
  const send = (target: EventTarget, type: string, x: number) => target.dispatchEvent(
    Object.assign(new Event(type, {cancelable:true}), {pointerId:1, button:0, pointerType:"mouse", clientX:x, clientY:150, buttons:type === "pointerup" ? 0 : 1}));
  send(button,"pointerdown",300); send(button,"pointermove",340);
  expect(onMove).toHaveBeenLastCalledWith("6",{x:.6,y:.5},false);
  const calls = onMove.mock.calls.length;
  send(button,"pointermove",480);
  expect(onMove).toHaveBeenCalledTimes(calls);
  send(windowTarget,"pointerup",480);
  expect(onMove).toHaveBeenLastCalledWith("6",{x:.6,y:.5},true);
  expect(coordinates.unproject).toHaveBeenLastCalledWith({x:.95,y:.5},"6");
  overlay.dispose();
});

it("keeps an authored untouched axis exact when a mapped keyboard nudge has inverse roundtrip residue", () => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => new OverlayElement() }));
  const host = new OverlayElement(), canvas = new OverlayElement(), onMove = vi.fn();
  const authoredX = .501937984496124;
  // This separable plane deliberately has a representable inverse-roundtrip
  // residue on X. A vertical visible nudge does not change that inverse X.
  const coordinates = {
    project: (p: { x: number; y: number }) => ({ x: p.x * .7 + .1, y: p.y * .7 }),
    unproject: (p: { x: number; y: number }) => ({ x: (p.x - .1) / .7, y: p.y / .7 }),
  };
  const origin = coordinates.unproject(coordinates.project({ x: authoredX, y: .5 }));
  expect(origin.x).not.toBe(authoredX);
  const overlay = createDirectPointOverlay({ host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, coordinates, onMove });
  overlay.set([{ id: "point", x: authoredX, y: .5, label: "Point" }]);
  const button = host.children[0]!.children[0]!;
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowDown" }));
  expect(onMove).toHaveBeenLastCalledWith("point", { x: authoredX, y: (.5 * .7 + .005) / .7 }, true);
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight" }));
  expect(onMove.mock.lastCall![1].x).not.toBe(authoredX);
  expect(onMove.mock.lastCall![1].y).toBe((.5 * .7 + .005) / .7);
  overlay.dispose();
});

it("keeps stationary focus clicks and the following one-axis nudge exact through the real96×870 Core plane",async()=>{
  const windowTarget=new EventTarget();vi.stubGlobal("window",windowTarget);
  vi.stubGlobal("document",Object.assign(new EventTarget(),{createElement:()=>new OverlayElement()}));
  const solve=await solveTransform({schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:"stretch"}},{width:96,height:870});
  const coordinates=planeCoordinates(solve),point={x:.5,y:.5};
  const visible=coordinates.project(point);
  const witness=[.1,50.1,180.04,180.1,413.25,413.1,20.3].flatMap(top=>[439,439.1,200.2,869.75].map(height=>{
    const clientY=top+visible.y*height+3,offset=clientY-(top+visible.y*height);
    return {top,height,clientY,inverse:coordinates.unproject({x:visible.x,y:(clientY-offset-top)/height})};
  })).find(sample=>sample.inverse.y!==point.y);
  expect(witness).toBeDefined();
  const box={left:100,top:witness!.top,width:400,height:witness!.height},clientY=witness!.clientY;
  const host=new OverlayElement(),canvas=new OverlayElement();canvas.getBoundingClientRect=()=>box;
  const onMove=vi.fn(),overlay=createDirectPointOverlay({host:host as unknown as HTMLElement,canvas:canvas as unknown as HTMLCanvasElement,coordinates,onMove});
  overlay.set([{id:"point",...point,label:"Center"}]);const button=host.children[0]!.children[0]!;
  const send=(target:EventTarget,type:string)=>target.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),{pointerId:1,button:0,pointerType:"mouse",clientX:300,clientY,buttons:type==="pointerup"?0:1}));
  send(button,"pointerdown");send(windowTarget,"pointerup");
  expect(onMove).toHaveBeenLastCalledWith("point",point,true);
  button.dispatchEvent(Object.assign(new Event("keydown",{cancelable:true}),{key:"ArrowRight"}));
  expect(onMove.mock.lastCall![1].x).toBeGreaterThan(point.x);expect(onMove.mock.lastCall![1].y).toBe(point.y);
  overlay.dispose();
});

it("keeps off-center grabs fixed until movement and uses the same offset for window release", () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  const host = new OverlayElement();
  const canvas = new OverlayElement();
  const onMove = vi.fn();
  const overlay = createDirectPointOverlay({ host: host as unknown as HTMLElement, canvas: canvas as unknown as HTMLCanvasElement, onMove });
  overlay.set([{ id: "point", x: 0.5, y: 0.5, label: "Point" }]);
  const button = host.children[0]!.children[0]!;
  const send = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, pointerType: "mouse", clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }),
  );
  // A prior keyboard edit changes the tracked position without rebuilding.
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight", shiftKey: true }));
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.525, y: 0.5 }, true);
  onMove.mockClear();
  send(button, "pointerdown", 322, 142); // 12 px right, 8 px above its center.
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.525, y: 0.5 }, false);
  expect(button.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(button.style).toMatchObject({ left: "210px", top: "100px" });
  send(button, "pointermove", 342, 152);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.575, y: 0.55 }, false);
  send(windowTarget, "pointerup", 362, 162);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.625, y: 0.6 }, true);
  expect(button.hasPointerCapture(1)).toBe(false);
  // A later grab has its own offset and stays fixed through a stationary release.
  send(button, "pointerdown", 342, 170);
  send(button, "pointerup", 342, 170);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.625, y: 0.6 }, true);
  overlay.dispose();
});

it("keeps the gesture alive when a host refuses pointer capture", () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  const host = new OverlayElement();
  const canvas = new OverlayElement();
  const onMove = vi.fn();
  const overlay = createDirectPointOverlay({
    host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
    onMove,
  });
  overlay.set([{ id: "point", x: 0.5, y: 0.5, label: "Point" }]);
  const button = host.children[0]!.children[0]!;
  button.setPointerCapture = () => { throw new Error("capture refused"); };
  const send = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, pointerType: "mouse", clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }),
  );
  send(button, "pointerdown", 300, 150);
  send(button, "pointermove", 320, 160);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.55, y: 0.55 }, false);
  send(windowTarget, "pointerup", 320, 160);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.55, y: 0.55 }, true);
  overlay.dispose();
});

it("ignores no-button point moves without losing a retargeted real release", () => {
  const win = new EventTarget(), doc = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", win); vi.stubGlobal("document", doc);
  const host = new OverlayElement(), canvas = new OverlayElement(), onMove = vi.fn();
  const overlay = createDirectPointOverlay({ host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, onMove });
  overlay.set([{ id: "point", x: .5, y: .5, label: "Point" }]);
  const button = host.children[0]!.children[0]!;
  const send = (target: EventTarget, type: string, x: number, y: number, buttons: number) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, clientX: x, clientY: y, buttons }));
  send(button, "pointerdown", 300, 150, 1);
  const count = onMove.mock.calls.length;
  send(button, "pointermove", 480, 240, 0);
  expect(onMove).toHaveBeenCalledTimes(count);
  send(win, "pointerup", 360, 170, 0);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: .65, y: .6 }, true);
  const committed = onMove.mock.calls.length;
  send(win, "mouseup", 480, 240, 0);
  expect(onMove).toHaveBeenCalledTimes(committed);
  expect(button.hasPointerCapture(1)).toBe(false);
  // Same-pointer fresh press recovers a missing UP before a new target grab.
  send(button, "pointerdown", 360, 170, 1);
  send(button, "pointermove", 380, 180, 1);
  send(button, "pointermove", 480, 240, 0);
  send(win, "pointerdown", 380, 180, 1);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: .7, y: .65 }, true);
  send(button, "pointerdown", 380, 180, 1);
  send(win, "pointerup", 400, 190, 0);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: .75, y: .7 }, true);
  overlay.dispose();
});

it("does not let a foreign pointer or secondary button replace a point gesture", () => {
  const win = new EventTarget();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", Object.assign(new EventTarget(), { createElement: () => new OverlayElement() }));
  const host = new OverlayElement(), canvas = new OverlayElement(), onMove = vi.fn();
  const overlay = createDirectPointOverlay({ host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, selection: "multiple", onMove });
  overlay.set([{ id: "first", x: .5, y: .5, label: "First" }, { id: "second", x: .7, y: .7, label: "Second" }]);
  const [first, second] = host.children[0]!.children;
  const send = (target: EventTarget, type: string, fields: object) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }),
      { button: 0, pointerType: "mouse", clientX: 300, clientY: 150, buttons: 1, ...fields }));
  send(first!, "pointerdown", { pointerId: 1 });
  send(first!, "pointermove", { pointerId: 1, button: 0, pointerType: "mouse", clientX: 320 });
  const count = onMove.mock.calls.length;
  send(second!, "pointerdown", { pointerId: 2, pointerType: "touch" });
  send(first!, "pointerdown", { pointerId: 1, button: 2 });
  send(host, "pointerdown", { pointerId: 2 });
  expect(onMove).toHaveBeenCalledTimes(count);
  expect(overlay.selected()).toEqual(["first"]);
  expect(first!.hasPointerCapture(1)).toBe(true);
  expect(second!.hasPointerCapture(2)).toBe(false);
  send(win, "pointerup", { pointerId: 1, button: 0, pointerType: "mouse", clientX: 340 });
  expect(onMove).toHaveBeenLastCalledWith("first", { x: .6, y: .5 }, true);
  overlay.dispose();
});

it("cancels Escape back to the grab-start point and does not keep the last preview", () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  const host = new OverlayElement();
  const canvas = new OverlayElement();
  const onMove = vi.fn();
  const overlay = createDirectPointOverlay({
    host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
    onMove,
  });
  overlay.set([{ id: "point", x: 0.5, y: 0.5, label: "Point" }]);
  const button = host.children[0]!.children[0]!;
  const send = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, button: 0, pointerType: "mouse", clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }),
  );
  send(button, "pointerdown", 300, 150);
  send(button, "pointermove", 340, 170);
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.6, y: 0.6 }, false);
  const escape = Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), { key: "Escape" });
  const stopped = vi.spyOn(escape, "stopPropagation");
  windowTarget.dispatchEvent(escape);
  expect(stopped).toHaveBeenCalled();
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.5, y: 0.5 }, true);
  overlay.dispose();
});

it("does not drag or nudge activation-only points", () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  const host = new OverlayElement();
  const canvas = new OverlayElement();
  const onMove = vi.fn();
  const onActivate = vi.fn(() => true);
  const overlay = createDirectPointOverlay({
    host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
    onMove,
    onActivate,
    draggable: false,
  });
  overlay.set([{ id: "pin", x: 0.5, y: 0.5, label: "Pin" }]);
  const button = host.children[0]!.children[0]!;
  button.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }), {
    pointerId: 1, button: 0, pointerType: "mouse", clientX: 300, clientY: 150, buttons: 1,
  }));
  button.dispatchEvent(Object.assign(new Event("pointermove", { cancelable: true }), {
    pointerId: 1, button: 0, pointerType: "mouse", clientX: 340, clientY: 170, buttons: 1,
  }));
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight" }));
  expect(onActivate).toHaveBeenCalledWith("pin", expect.anything());
  expect(onMove).not.toHaveBeenCalled();
  overlay.dispose();
});

it("moves every selected point together and restores all of them on Escape", () => {
  const windowTarget = new EventTarget();
  const documentTarget = Object.assign(new EventTarget(), { createElement: () => new OverlayElement() });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  const host = new OverlayElement();
  const canvas = new OverlayElement();
  const onMoves = vi.fn();
  const overlay = createDirectPointOverlay({
    host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement,
    selection: "multiple",
    onMove() {},
    onMoves,
  });
  overlay.set([
    { id: "a", x: 0.25, y: 0.25, label: "A" },
    { id: "b", x: 0.75, y: 0.25, label: "B" },
  ]);
  const layer = host.children[0]!;
  const first = layer.children[0]!;
  const second = layer.children[1]!;
  const send = (target: EventTarget, type: string, x: number, y: number, shiftKey = false) => target.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, button: 0, pointerType: "mouse", clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1, shiftKey,
    }),
  );
  send(first, "pointerdown", 200, 100);
  send(first, "pointerup", 200, 100);
  send(second, "pointerdown", 400, 100, true);
  send(second, "pointermove", 440, 120);
  expect(onMoves).toHaveBeenLastCalledWith([
    { id: "a", point: { x: 0.35, y: 0.35 } },
    { id: "b", point: { x: 0.85, y: 0.35 } },
  ], false);
  const escape = Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), { key: "Escape" });
  windowTarget.dispatchEvent(escape);
  expect(onMoves).toHaveBeenLastCalledWith([
    { id: "a", point: { x: 0.25, y: 0.25 } },
    { id: "b", point: { x: 0.75, y: 0.25 } },
  ], true);
  expect(overlay.selected()).toEqual(["a", "b"]);
  overlay.dispose();
});

it("keeps focused point and selection through redraw, but drops removed point IDs", () => {
  const doc = Object.assign(new EventTarget(), { activeElement: undefined as OverlayElement | undefined });
  class FocusElement extends OverlayElement {
    focus = vi.fn(() => { doc.activeElement = this; });
  }
  Object.assign(doc, { createElement: () => new FocusElement() });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", doc);
  const host = new OverlayElement(), canvas = new OverlayElement(), onMove = vi.fn();
  const first = createDirectPointOverlay({ host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, selection: "multiple", onMove });
  first.set([{ id: "a", x: .25, y: .25, label: "A" }, { id: "b", x: .5, y: .5, label: "B" }]);
  const button = host.children[0]!.children[1]!;
  button.dispatchEvent(Object.assign(new Event("pointerdown", { cancelable: true }),
    { pointerId: 1, button: 0, pointerType: "mouse", clientX: 300, clientY: 150, buttons: 1 }));
  button.dispatchEvent(Object.assign(new Event("pointerup", { cancelable: true }),
    { pointerId: 1, button: 0, pointerType: "mouse", clientX: 300, clientY: 150, buttons: 0 }));
  expect(first.state()).toEqual({ selected: ["b"], focusedId: "b" });
  first.set([{ id: "a", x: .25, y: .25, label: "A" }, { id: "b", x: .5, y: .5, label: "B" }]);
  expect(host.children[0]!.children[1]!.focus).toHaveBeenCalledWith({ preventScroll: true });
  const saved = first.state();
  expect(saved).toEqual({ selected: ["b"], focusedId: "b" });
  first.dispose();
  const next = createDirectPointOverlay({ host: host as unknown as HTMLElement,
    canvas: canvas as unknown as HTMLCanvasElement, selection: "multiple",
    initialState: saved, onMove });
  next.set([{ id: "a", x: .25, y: .25, label: "A" }, { id: "b", x: .5, y: .5, label: "B" }]);
  expect(next.selected()).toEqual(["b"]);
  expect(host.children[1]!.children[1]!.focus).toHaveBeenCalledWith({ preventScroll: true });
  next.set([{ id: "a", x: .25, y: .25, label: "A" }]);
  expect(next.selected()).toEqual([]);
  expect(host.children[1]!.children[0]!.focus).not.toHaveBeenCalled();
  next.dispose();
});

describe("keyboardNudgeDelta", () => {
  it("nudges one canvas pixel per press and ten with Shift", () => {
    expect(keyboardNudgeDelta("ArrowRight", false, 400, 200)).toEqual({ x: 0.0025, y: 0 });
    expect(keyboardNudgeDelta("ArrowRight", true, 400, 200)).toEqual({ x: 0.025, y: 0 });
    expect(keyboardNudgeDelta("ArrowDown", true, 400, 200)).toEqual({ x: 0, y: 0.05 });
  });

  it("keeps non-arrow keys inert", () => {
    expect(keyboardNudgeDelta("Enter", false, 400, 200)).toEqual({ x: 0, y: 0 });
    expect(keyboardNudgeDelta("a", true, 400, 200)).toEqual({ x: 0, y: 0 });
  });

  it("degrades to a normalized step when the canvas box is not laid out", () => {
    expect(keyboardNudgeDelta("ArrowLeft", false, 0, 0)).toEqual({ x: -1, y: 0 });
  });
});

describe("direct point gesture session", () => {
  it("commits the last visible point exactly once when capture is interrupted", () => {
    const previews: unknown[] = [];
    const commits: unknown[] = [];
    const session = createDirectPointGestureSession({
      onPreview(id, point) { previews.push({ id, point }); },
      onCommit(id, point) { commits.push({ id, point }); },
    });

    session.begin(7, "center", { x: 0.5, y: 0.5 });
    session.update(7, { x: 0.65, y: 0.4 });
    expect(session.interrupt(7)).toBe(true);
    expect(session.interrupt(7)).toBe(false);
    expect(previews).toEqual([
      { id: "center", point: { x: 0.5, y: 0.5 } },
      { id: "center", point: { x: 0.65, y: 0.4 } },
    ]);
    expect(commits).toEqual([
      { id: "center", point: { x: 0.65, y: 0.4 } },
    ]);
  });

  it("restores the gesture-start point on cancel instead of keeping the last preview", () => {
    const previews: unknown[] = [];
    const commits: unknown[] = [];
    const session = createDirectPointGestureSession({
      onPreview(id, point) { previews.push({ id, point }); },
      onCommit(id, point) { commits.push({ id, point }); },
    });

    session.begin(7, "center", { x: 0.5, y: 0.5 });
    session.update(7, { x: 0.65, y: 0.4 });
    expect(session.cancel(7)).toBe(true);
    expect(session.cancel(7)).toBe(false);
    expect(session.active()).toBe(false);
    expect(commits).toEqual([
      { id: "center", point: { x: 0.5, y: 0.5 } },
    ]);
  });

  it("uses the real release coordinate and ignores unrelated pointers", () => {
    const commits: unknown[] = [];
    const session = createDirectPointGestureSession({
      onPreview() {},
      onCommit(id, point) { commits.push({ id, point }); },
    });

    session.begin(3, "corner", { x: 0.1, y: 0.1 });
    expect(session.finish(4, { x: 0.8, y: 0.8 })).toBe(false);
    expect(session.finish(3, { x: 0.25, y: 0.3 })).toBe(true);
    expect(commits).toEqual([{ id: "corner", point: { x: 0.25, y: 0.3 } }]);
  });
});
