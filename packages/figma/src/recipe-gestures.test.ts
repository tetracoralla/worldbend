import { describe, expect, it } from "vitest";
import {
  applyMoveGesture,
  applyPivotGesture,
  applyRotateGesture,
  applyScaleGesture,
  changePivotWithoutMoving,
  pivotPoint,
  pivotPreviewPoint,
  rawToBase,
  toRaw,
  wrapDegrees,
  type GestureFrame,
} from "./recipe-gestures";
import { identityTransformRecipe } from "@worldbend/web";

function baseFrame(overrides: Partial<GestureFrame> = {}): GestureFrame {
  return {
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    canvasOrigin: { x: 0, y: 0 },
    canvasSize: { width: 200, height: 100 },
    baseQuad: {
      tl: { x: 0, y: 0 },
      tr: { x: 200, y: 0 },
      br: { x: 200, y: 100 },
      bl: { x: 0, y: 100 },
    },
    recipe: identityTransformRecipe(),
    ...overrides,
  };
}

describe("applyMoveGesture", () => {
  it("translates by the pointer delta in base pixels", () => {
    const recipe = applyMoveGesture(
      baseFrame(),
      { x: 0.1, y: 0.2 },
      { x: 0.35, y: 0.1 },
    );
    expect(recipe.translation.x).toBeCloseTo(50, 10);
    expect(recipe.translation.y).toBeCloseTo(-10, 10);
  });

  it("accumulates over the recipe that was live at gesture start", () => {
    const frame = baseFrame({
      recipe: { ...identityTransformRecipe(), translation: { x: 8, y: -4 } },
    });
    const recipe = applyMoveGesture(frame, { x: 0, y: 0 }, { x: 0.5, y: 0.5 });
    expect(recipe.translation.x).toBeCloseTo(108, 10);
    expect(recipe.translation.y).toBeCloseTo(46, 10);
  });

  it("uses output-canvas units even when the on-screen preview is capped", () => {
    const frame = baseFrame({ canvasSize: { width: 2000, height: 1000 } });
    const recipe = applyMoveGesture(frame, { x: 0.1, y: 0.2 }, { x: 0.35, y: 0.1 });
    expect(recipe.translation.x).toBeCloseTo(500, 10);
    expect(recipe.translation.y).toBeCloseTo(-100, 10);
    expect(toRaw(frame, { x: 0.5, y: 0.25 })).toEqual({ x: 1000, y: 250 });
  });
});

describe("applyScaleGesture", () => {
  it("scales both axes from a corner handle", () => {
    const frame = baseFrame();
    // Pointer at raw (400, 200): pivot is (100, 50), anchor br is (200, 100).
    const recipe = applyScaleGesture(frame, "br", { x: 2, y: 2 }, false);
    expect(recipe.scale.x).toBeCloseTo(3, 10);
    expect(recipe.scale.y).toBeCloseTo(3, 10);
  });

  it("uses the radial distance for uniform corner scaling", () => {
    const frame = baseFrame();
    // Pointer at raw (250, 100): distance from pivot (100,50) is sqrt(150^2+50^2)
    // while anchor br sits at distance sqrt(100^2+50^2).
    const recipe = applyScaleGesture(frame, "br", { x: 1.25, y: 1 }, true);
    const expected = Math.hypot(150, 50) / Math.hypot(100, 50);
    expect(recipe.scale.x).toBeCloseTo(expected, 10);
    expect(recipe.scale.y).toBeCloseTo(expected, 10);
  });

  it("scales only the perpendicular axis from an edge handle", () => {
    const frame = baseFrame();
    const recipe = applyScaleGesture(frame, "top", { x: 0.5, y: 0.5 }, false);
    expect(recipe.scale.x).toBeCloseTo(1, 10);
    // The pointer lands exactly on the pivot: the axis floors at the flip guard.
    expect(recipe.scale.y).toBeCloseTo(0.01, 10);
  });

  it("clamps a pivot-crossing drag to a positive floor instead of flipping", () => {
    const frame = baseFrame();
    // Dragging the top edge past the pivot would mirror the plane.
    const recipe = applyScaleGesture(frame, "top", { x: 0.5, y: 0.6 }, false);
    expect(recipe.scale.y).toBeGreaterThan(0);
    expect(recipe.scale.y).toBeLessThan(0.05);
  });

  it("respects the absolute scale domain across an already-scaled frame", () => {
    const frame = baseFrame({
      recipe: { ...identityTransformRecipe(), scale: { x: 8, y: 8 } },
    });
    const grown = applyScaleGesture(frame, "br", { x: 4, y: 4 }, false);
    expect(grown.scale.x).toBeLessThanOrEqual(10);
    expect(grown.scale.y).toBeLessThanOrEqual(10);
  });

  it("inverts the composed matrix when deriving base coordinates", () => {
    // Quarter-turn clockwise matrix: [0,-1,tx, 1,0,ty].
    const rotated = baseFrame({
      matrix: [0, -1, 100, 1, 0, 50, 0, 0, 1],
    });
    const roundTrip = rawToBase(rotated, {
      x: rotated.matrix[0] * 30 + rotated.matrix[1] * 70 + rotated.matrix[2],
      y: rotated.matrix[3] * 30 + rotated.matrix[4] * 70 + rotated.matrix[5],
    });
    expect(roundTrip.x).toBeCloseTo(30, 9);
    expect(roundTrip.y).toBeCloseTo(70, 9);
  });
});

describe("applyRotateGesture", () => {
  it("rotates clockwise by the swept angle around the pivot", () => {
    const frame = baseFrame();
    // Start above the pivot, end to its right: +90 degrees clockwise.
    const recipe = applyRotateGesture(frame, { x: 0.5, y: 0 }, { x: 1, y: 0.5 }, false);
    expect(recipe.rotationDegrees).toBeCloseTo(90, 8);
  });

  it("snaps to the 15-degree grid with shift", () => {
    const frame = baseFrame();
    // A sweep of ~20 degrees (atan2 math): start up, end 20 degrees clockwise.
    const angle = 20 * (Math.PI / 180);
    const pivot = { x: 100, y: 50 };
    const radius = 100;
    const start = { x: pivot.x + radius * Math.cos(-Math.PI / 2), y: pivot.y + radius * Math.sin(-Math.PI / 2) };
    const end = { x: pivot.x + radius * Math.cos(-Math.PI / 2 + angle), y: pivot.y + radius * Math.sin(-Math.PI / 2 + angle) };
    const toPointer = (p: { x: number; y: number }) => ({ x: p.x / 200, y: p.y / 100 });
    const recipe = applyRotateGesture(frame, toPointer(start), toPointer(end), true);
    expect(recipe.rotationDegrees).toBe(15);
  });

  it("gently snaps near quarter turns without shift", () => {
    const frame = baseFrame();
    const angle = 88.5 * (Math.PI / 180);
    const pivot = { x: 100, y: 50 };
    const radius = 100;
    const start = { x: pivot.x, y: pivot.y - radius };
    const end = {
      x: pivot.x + radius * Math.cos(-Math.PI / 2 + angle),
      y: pivot.y + radius * Math.sin(-Math.PI / 2 + angle),
    };
    const recipe = applyRotateGesture(
      frame,
      { x: start.x / 200, y: start.y / 100 },
      { x: end.x / 200, y: end.y / 100 },
      false,
    );
    expect(recipe.rotationDegrees).toBeCloseTo(90, 8);
  });

  it("keeps rotation inside the signed half turn", () => {
    const frame = baseFrame({
      recipe: { ...identityTransformRecipe(), rotationDegrees: 170 },
    });
    const recipe = applyRotateGesture(frame, { x: 0.5, y: 0 }, { x: 1, y: 0.5 }, false);
    expect(recipe.rotationDegrees).toBeCloseTo(-100, 8);
  });
});

describe("helpers", () => {
  it("resolves the pivot against the base quad bounds and recipe pivot", () => {
    const frame = baseFrame({
      baseQuad: {
        tl: { x: 10, y: 20 },
        tr: { x: 210, y: 20 },
        br: { x: 210, y: 120 },
        bl: { x: 10, y: 120 },
      },
      recipe: { ...identityTransformRecipe(), pivot: { x: 0.25, y: 0.75 } },
    });
    const pivot = pivotPoint(frame);
    expect(pivot).toEqual({ x: 60, y: 95 });
  });

  it("maps normalized pointers into raw canvas pixels", () => {
    const frame = baseFrame({ canvasOrigin: { x: -20, y: 5 } });
    expect(toRaw(frame, { x: 0.5, y: 0.25 })).toEqual({ x: 80, y: 30 });
  });

  it("changes a rotated pivot without moving the existing result", () => {
    const frame = baseFrame({
      matrix: [0, -1, 150, 1, 0, -50, 0, 0, 1],
      recipe: {
        ...identityTransformRecipe(),
        rotationDegrees: 90,
      },
    });
    const recipe = changePivotWithoutMoving(frame, { x: 0, y: 0 });
    expect(recipe.pivot).toEqual({ x: 0, y: 0 });
    // Center -> top-left on a 200x100 base needs (+150,+50) compensation
    // for a clockwise quarter turn.
    expect(recipe.translation.x).toBeCloseTo(150, 10);
    expect(recipe.translation.y).toBeCloseTo(-50, 10);
  });

  it("drags the pivot in output space while preserving geometry", () => {
    const frame = baseFrame({
      matrix: [0, -1, 150, 1, 0, -50, 0, 0, 1],
      recipe: {
        ...identityTransformRecipe(),
        rotationDegrees: 90,
      },
    });
    const recipe = applyPivotGesture(frame, { x: 0.75, y: 0.5 });
    expect(recipe.pivot.x).toBeCloseTo(0.5, 10);
    expect(recipe.pivot.y).toBeCloseTo(0, 10);
    expect(recipe.translation.x).toBeCloseTo(50, 10);
    expect(recipe.translation.y).toBeCloseTo(50, 10);
  });

  it("reports the pivot position in the transformed preview", () => {
    const frame = baseFrame({
      canvasOrigin: { x: 50, y: -50 },
      matrix: [0, -1, 150, 1, 0, -50, 0, 0, 1],
    });
    expect(pivotPreviewPoint(frame)).toEqual({ x: 0.25, y: 1 });
  });
});

describe("wrapDegrees", () => {
  it("wraps into the signed half turn for quarter-turn menu actions", () => {
    expect(wrapDegrees(90)).toBe(90);
    expect(wrapDegrees(270)).toBe(-90);
    expect(wrapDegrees(180)).toBe(180);
    expect(wrapDegrees(-180)).toBe(180);
    expect(wrapDegrees(170 + 90)).toBeCloseTo(-100, 10);
    expect(wrapDegrees(0 - 90)).toBeCloseTo(-90, 10);
    expect(wrapDegrees(Number.NaN)).toBe(0);
  });
});
