import { describe, expect, it } from "vitest";
import {
  applySymmetricPerspective,
  pointToQuadOutlineDistance,
  quadContainsPoint,
  resolvePerspectiveAxis,
} from "./quad-edits";
import { unitQuad, type Quad } from "./types";

function closeTo(actual: number, expected: number): void {
  expect(actual).toBeCloseTo(expected, 10);
}

describe("applySymmetricPerspective", () => {
  it("moves only the dragged corner and same-row partner horizontally", () => {
    const next = applySymmetricPerspective(
      unitQuad(),
      "tl",
      { x: 0.2, y: 0.3 },
      "horizontal",
    );
    expect(next.tl).toEqual({ x: 0.2, y: 0 });
    expect(next.tr).toEqual({ x: 0.8, y: 0 });
    expect(next.bl).toEqual({ x: 0, y: 1 });
    expect(next.br).toEqual({ x: 1, y: 1 });
  });

  it.each([
    [
      "tl",
      { x: 0.1, y: 9 },
      { tl: [0.1, 0], tr: [0.9, 0], br: [1, 1], bl: [0, 1] },
    ],
    [
      "tr",
      { x: 1.1, y: 9 },
      { tl: [-0.1, 0], tr: [1.1, 0], br: [1, 1], bl: [0, 1] },
    ],
    [
      "br",
      { x: 1.1, y: -9 },
      { tl: [0, 0], tr: [1, 0], br: [1.1, 1], bl: [-0.1, 1] },
    ],
    [
      "bl",
      { x: 0.1, y: -9 },
      { tl: [0, 0], tr: [1, 0], br: [0.9, 1], bl: [0.1, 1] },
    ],
  ] as const)("applies the horizontal two-point rule from %s", (corner, pointer, expected) => {
    const next = applySymmetricPerspective(unitQuad(), corner, pointer, "horizontal");
    for (const key of ["tl", "tr", "br", "bl"] as const) {
      closeTo(next[key].x, expected[key][0]);
      closeTo(next[key].y, expected[key][1]);
    }
  });

  it("preserves outward deltas instead of clamping them to the unit window", () => {
    const quad: Quad = {
      tl: { x: 0.1, y: 0.2 },
      tr: { x: 0.9, y: 0.1 },
      br: { x: 0.95, y: 0.85 },
      bl: { x: 0.15, y: 0.75 },
    };
    const next = applySymmetricPerspective(
      quad,
      "tr",
      { x: 1.05, y: 9 },
      "horizontal",
    );
    expect(next.tr).toEqual({ x: 1.05, y: 0.1 });
    closeTo(next.tl.x, -0.05);
    closeTo(next.tl.y, 0.2);
    expect(next.br).toEqual(quad.br);
    expect(next.bl).toEqual(quad.bl);
  });

  it("does not jump an existing distort when Shift is pressed without movement", () => {
    const quad: Quad = {
      tl: { x: 0.1, y: 0.2 },
      tr: { x: 0.9, y: 0.1 },
      br: { x: 0.95, y: 0.85 },
      bl: { x: 0.15, y: 0.75 },
    };
    expect(applySymmetricPerspective(quad, "tr", quad.tr, "horizontal")).toEqual(quad);
    expect(applySymmetricPerspective(quad, "tr", quad.tr, "vertical")).toEqual(quad);
  });

  it("preserves every unrelated coordinate on an existing distorted quad", () => {
    const quad: Quad = {
      tl: { x: 0.1, y: 0.2 },
      tr: { x: 0.9, y: 0.1 },
      br: { x: 0.95, y: 0.85 },
      bl: { x: 0.15, y: 0.75 },
    };
    const next = applySymmetricPerspective(
      quad,
      "tr",
      { x: 0.95, y: 99 },
      "horizontal",
    );
    closeTo(next.tr.x, 0.95);
    closeTo(next.tr.y, 0.1);
    closeTo(next.tl.x, 0.05);
    closeTo(next.tl.y, 0.2);
    expect(next.br).toEqual(quad.br);
    expect(next.bl).toEqual(quad.bl);
  });

  it("moves only the dragged corner and same-column partner vertically", () => {
    const next = applySymmetricPerspective(
      unitQuad(),
      "tl",
      { x: 9, y: 0.3 },
      "vertical",
    );
    expect(next.tl).toEqual({ x: 0, y: 0.3 });
    expect(next.tr).toEqual({ x: 1, y: 0 });
    expect(next.bl).toEqual({ x: 0, y: 0.7 });
    expect(next.br).toEqual({ x: 1, y: 1 });
  });

  it.each([
    ["tl", 0.2, { tl: 0.2, tr: 0, br: 1, bl: 0.8 }],
    ["tr", 0.2, { tl: 0, tr: 0.2, br: 0.8, bl: 1 }],
    ["br", 1.2, { tl: 0, tr: -0.2, br: 1.2, bl: 1 }],
    ["bl", 1.2, { tl: -0.2, tr: 0, br: 1, bl: 1.2 }],
  ] as const)("applies the vertical two-point rule from %s", (corner, y, expectedY) => {
    const next = applySymmetricPerspective(unitQuad(), corner, { x: 9, y }, "vertical");
    for (const key of ["tl", "tr", "br", "bl"] as const) {
      closeTo(next[key].y, expectedY[key]);
      closeTo(next[key].x, unitQuad()[key].x);
    }
  });
});

describe("resolvePerspectiveAxis", () => {
  it("waits through the dead zone and captures the dominant physical axis", () => {
    expect(resolvePerspectiveAxis({ x: 3.9, y: 1 })).toBeUndefined();
    expect(resolvePerspectiveAxis({ x: 8, y: 3 })).toBe("horizontal");
    expect(resolvePerspectiveAxis({ x: 2, y: -9 })).toBe("vertical");
  });

  it("resolves equal movement deterministically", () => {
    expect(resolvePerspectiveAxis({ x: -5, y: 5 })).toBe("horizontal");
  });
});

describe("quadContainsPoint", () => {
  it("classifies inside and outside points for a rotated quad", () => {
    const quad: Quad = {
      tl: { x: 0.25, y: 0 },
      tr: { x: 1, y: 0.25 },
      br: { x: 0.75, y: 1 },
      bl: { x: 0, y: 0.75 },
    };
    expect(quadContainsPoint(quad, { x: 0.5, y: 0.5 })).toBe(true);
    expect(quadContainsPoint(quad, { x: 0.05, y: 0.05 })).toBe(false);
    expect(quadContainsPoint(quad, { x: 0.95, y: 0.95 })).toBe(false);
  });

  it("treats outline points as contained", () => {
    expect(quadContainsPoint(unitQuad(), { x: 0, y: 0 })).toBe(true);
    expect(quadContainsPoint(unitQuad(), { x: 1, y: 0.5 })).toBe(true);
  });
});

describe("pointToQuadOutlineDistance", () => {
  it("measures the nearest outline distance", () => {
    closeTo(pointToQuadOutlineDistance(unitQuad(), { x: 0.5, y: 0.2 }), 0.2);
    closeTo(pointToQuadOutlineDistance(unitQuad(), { x: 1.3, y: 0.5 }), 0.3);
    closeTo(pointToQuadOutlineDistance(unitQuad(), { x: 0, y: 0 }), 0);
  });
});
