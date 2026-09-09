import { afterEach, describe, expect, it, vi } from "vitest";
import { createDirectPointGestureSession, createDirectPointOverlay, keyboardNudgeDelta } from "./direct-point-overlay";

afterEach(() => vi.unstubAllGlobals());

class OverlayElement extends EventTarget {
  children: OverlayElement[] = [];
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  type = "";
  captured = new Set<number>();
  setAttribute() {}
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
    Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientX: x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }),
  );
  // A prior keyboard edit changes the tracked position without rebuilding.
  button.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight", shiftKey: true }));
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.525, y: 0.5 }, true);
  onMove.mockClear();
  send(button, "pointerdown", 322, 142); // 12 px right, 8 px above its center.
  expect(onMove).toHaveBeenLastCalledWith("point", { x: 0.525, y: 0.5 }, false);
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
