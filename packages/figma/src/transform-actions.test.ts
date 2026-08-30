import { describe, expect, it } from "vitest";
import { normalizedSpec, unitQuad } from "@worldbend/web";
import {
  createAppliedTransformMemory,
  effectiveFlipState,
  parsePlacementValue,
  translationForPlacement,
} from "./transform-actions";
import type { TransformFrame } from "./transform-frame";

function frame(overrides: Partial<TransformFrame> = {}): TransformFrame {
  return {
    spec: normalizedSpec(unitQuad()),
    renderWidth: 100,
    renderHeight: 50,
    placement: { x: 10, y: 20, width: 200, height: 100 },
    ...overrides,
  };
}

describe("effective flip state", () => {
  it("reports the saved result orientation instead of a relative recipe flag", () => {
    expect(effectiveFlipState(normalizedSpec(unitQuad()))).toEqual({ x: false, y: false });
    expect(effectiveFlipState(normalizedSpec(unitQuad(), "flipHorizontal"))).toEqual({
      x: true,
      y: false,
    });
    expect(effectiveFlipState(normalizedSpec(unitQuad(), "flipBoth"))).toEqual({
      x: true,
      y: true,
    });
  });
});

describe("confirmed Transform Again memory", () => {
  it("does not expose a pending or failed apply", () => {
    const memory = createAppliedTransformMemory();
    memory.begin(3, { initialFrame: frame(), finalFrame: frame({ renderWidth: 80 }) });
    expect(memory.hasLatest()).toBe(false);
    memory.fail(3);
    expect(memory.hasLatest()).toBe(false);
  });

  it("ignores a stale completion and commits only the matching generation", () => {
    const memory = createAppliedTransformMemory();
    memory.begin(4, { initialFrame: frame(), finalFrame: frame({ renderWidth: 80 }) });
    expect(memory.complete(3)).toBe(false);
    expect(memory.hasLatest()).toBe(false);
    expect(memory.complete(4)).toBe(true);
    expect(memory.hasLatest()).toBe(true);
  });

  it("replays the complete final frame onto a differently sized source", () => {
    const memory = createAppliedTransformMemory();
    memory.begin(1, {
      initialFrame: frame(),
      finalFrame: frame({
        spec: normalizedSpec({
          tl: { x: 0.1, y: 0 },
          tr: { x: 1, y: 0.2 },
          br: { x: 0.8, y: 1 },
          bl: { x: 0, y: 0.9 },
        }, "flipVertical"),
        renderWidth: 80,
        renderHeight: 60,
        placement: { x: 30, y: 5, width: 160, height: 120 },
      }),
    });
    memory.complete(1);

    const repeated = memory.repeatFor(
      frame({
        renderWidth: 200,
        renderHeight: 100,
        placement: { x: 100, y: 80, width: 400, height: 200 },
      }),
    );
    expect(repeated).toMatchObject({
      renderWidth: 160,
      renderHeight: 120,
      placement: { x: 140, y: 50, width: 320, height: 240 },
      spec: { content: { orientation: "flipVertical" } },
    });
  });
});

describe("placement parsing", () => {
  it("rejects empty and non-finite input instead of retaining misleading text", () => {
    expect(parsePlacementValue("")).toBeUndefined();
    expect(parsePlacementValue("   ")).toBeUndefined();
    expect(parsePlacementValue("Infinity")).toBeUndefined();
    expect(parsePlacementValue("120.5")).toBe(120.5);
  });

  it("maps a document delta back to base-render translation", () => {
    expect(
      translationForPlacement({
        desired: 50,
        current: 30,
        currentTranslation: 4,
        baseRenderSize: 100,
        basePlacementSize: 200,
      }),
    ).toBe(14);
    expect(
      translationForPlacement({
        desired: 50,
        current: 30,
        currentTranslation: 4,
        baseRenderSize: 0,
        basePlacementSize: 200,
      }),
    ).toBeUndefined();
  });
});
