import { describe, expect, it } from "vitest";
import { createDirectPointGestureSession, keyboardNudgeDelta } from "./direct-point-overlay";

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
