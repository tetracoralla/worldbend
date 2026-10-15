import { describe, expect, it } from "vitest";
import { placementBeside, RESULT_PLACEMENT_GAP } from "./result-placement";

describe("Figma result placement", () => {
  it("places a new result to the right of every input on a shared top edge", () => {
    expect(placementBeside([
      { x: 0, y: 20, width: 100, height: 80 },
      { x: 140, y: -10, width: 120, height: 96 },
    ], { width: 160, height: 90 })).toEqual({
      x: 260 + RESULT_PLACEMENT_GAP,
      y: -10,
      width: 160,
      height: 90,
    });
  });

  it("has a deterministic empty fallback", () => {
    expect(placementBeside([], { width: 160, height: 90 })).toEqual({
      x: 0,
      y: 0,
      width: 160,
      height: 90,
    });
  });

  it("steps past a nearby small obstacle", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [
        { x: 0, y: 0, width: 100, height: 80 },
        { x: 120, y: 0, width: 100, height: 80 },
      ],
    )).toEqual({ x: 220 + RESULT_PLACEMENT_GAP, y: 0, width: 100, height: 80 });
  });

  it("wraps below a long row of individually small obstacles", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [
        { x: 120, y: 0, width: 100, height: 80 },
        { x: 240, y: 0, width: 100, height: 80 },
        { x: 360, y: 0, width: 100, height: 80 },
      ],
    )).toEqual({ x: 100 + RESULT_PLACEMENT_GAP, y: 80 + RESULT_PLACEMENT_GAP, width: 100, height: 80 });
  });

  it("does not jump past content outside the output's vertical band", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [{ x: 120, y: 200, width: 1000, height: 80 }],
    )).toEqual({ x: 100 + RESULT_PLACEMENT_GAP, y: 0, width: 100, height: 80 });
  });

  it("drops below an obstacle wider than the output instead of teleporting past it", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [{ x: 120, y: 0, width: 1000, height: 80 }],
    )).toEqual({ x: 100 + RESULT_PLACEMENT_GAP, y: 80 + RESULT_PLACEMENT_GAP, width: 100, height: 80 });
  });

  it("escapes an obstacle that fully contains the output band", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [{ x: -500, y: -500, width: 2000, height: 2000 }],
    )).toEqual({
      x: 100 + RESULT_PLACEMENT_GAP,
      y: 1500 + RESULT_PLACEMENT_GAP,
      width: 100,
      height: 80,
    });
  });

  it("keeps walking the row it dropped into", () => {
    expect(placementBeside(
      [{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 },
      [
        { x: 120, y: 0, width: 1000, height: 80 },
        { x: 148, y: 128, width: 100, height: 80 },
      ],
    )).toEqual({ x: 248 + RESULT_PLACEMENT_GAP, y: 128, width: 100, height: 80 });
  });

  it("keeps a screen copy nearby when a tall neighboring Frame blocks the row", () => {
    expect(placementBeside([{ x: 1268, y: 3500, width: 700, height: 420 }],
      { width: 700, height: 420 }, [{ x: 2016, y: 3400, width: 2000, height: 5800 }]))
      .toEqual({ x: 1268, y: 3032, width: 700, height: 420 });
  });

  it("uses a nearby free side when the requested output also carries its old position", () => {
    const output = { x: 1268, y: 3500, width: 700, height: 420 };
    const inputs = [{ x: 1268, y: 3500, width: 700, height: 420 }];
    expect(placementBeside(inputs, output, [
      ...inputs,
      { x: 520, y: 3500, width: 700, height: 420 },
      { x: 0, y: 2700, width: 1840, height: 620 },
      { x: 1888, y: 2700, width: 1840, height: 620 },
      { x: 2600, y: 3500, width: 1400, height: 1000 },
    ])).toEqual({ x: 1268, y: 3968, width: 700, height: 420 });
  });

  it("tries another nearby side when the space above the source is occupied", () => {
    expect(placementBeside([{ x: 0, y: 0, width: 100, height: 80 }],
      { width: 100, height: 80 }, [
        { x: 120, y: -100, width: 1000, height: 2000 },
        { x: 0, y: -128, width: 100, height: 80 },
      ])).toEqual({ x: 0, y: 128, width: 100, height: 80 });
  });
});
