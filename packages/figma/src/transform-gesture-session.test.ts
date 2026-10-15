import { describe, expect, it } from "vitest";
import { identityTransformRecipe, type TransformGestureEvent } from "@worldbend/web";
import type { GestureFrame } from "./recipe-gestures";
import { createTransformGestureSession } from "./transform-gesture-session";

function frame(translationX = 0): GestureFrame {
  return {
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    canvasOrigin: { x: 0, y: 0 },
    canvasSize: { width: 100, height: 100 },
    baseQuad: {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 100 },
      bl: { x: 0, y: 100 },
    },
    recipe: {
      ...identityTransformRecipe(),
      translation: { x: translationX, y: 0 },
    },
  };
}

function move(phase: TransformGestureEvent["phase"], x: number): TransformGestureEvent {
  if (phase === "start") {
    return {
      phase,
      kind: "move",
      pointer: { x, y: 0 },
      quad: frame().baseQuad,
    };
  }
  return { phase, pointer: { x, y: 0 }, shiftKey: false };
}

describe("transform gesture session", () => {
  it("clears pointer ownership before returning the final sample", () => {
    const session = createTransformGestureSession();
    expect(session.start(move("start", 0), frame())).toBe(true);
    expect(session.update(move("update", 0.25), false)?.recipe.translation.x).toBe(25);
    const final = session.update(move("end", 0.5), false);
    expect(final?.final).toBe(true);
    expect(final?.recipe.translation.x).toBe(50);
    expect(session.active()).toBe(false);
    expect(session.update(move("update", 0.75), false)).toBeUndefined();
  });

  it("starts each of three gestures from the newly supplied committed frame", () => {
    const session = createTransformGestureSession();
    for (const baseline of [0, 10, 30]) {
      session.start(move("start", 0), frame(baseline));
      const final = session.update(move("end", 0.1), false);
      expect(final?.recipe.translation.x).toBe(baseline + 10);
    }
  });

  it("cancels an open gesture without emitting residual work", () => {
    const session = createTransformGestureSession();
    session.start(move("start", 0), frame());
    session.cancel();
    expect(session.active()).toBe(false);
    expect(session.update(move("end", 1), false)).toBeUndefined();
  });
});
