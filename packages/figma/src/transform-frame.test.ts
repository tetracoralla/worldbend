import { describe, expect, it } from "vitest";
import {
  composeAffineTransform,
  identityTransformRecipe,
  normalizedSpec,
  unitQuad,
  type AffineComposition,
} from "@worldbend/web";
import {
  frameFromComposition,
  frameFromSource,
  rebaseTransformFrame,
  TransformFrameError,
} from "./transform-frame";

const identitySpec = () => normalizedSpec(unitQuad());

describe("Figma transform frame", () => {
  it("maps tight render bounds back to Figma placement without clipping", () => {
    const base = frameFromSource({
      bytes: new Uint8Array([1]),
      sourceNodeId: "source",
      sourceName: "Poster",
      renderWidth: 100,
      renderHeight: 50,
      placement: { x: 20, y: 30, width: 200, height: 100 },
    });
    const composition = {
      spec: identitySpec(),
      canvas: { origin: { x: 25, y: -25 }, size: { width: 50, height: 100 } },
    } as AffineComposition;

    expect(frameFromComposition(base, composition)).toEqual({
      spec: identitySpec(),
      renderWidth: 50,
      renderHeight: 100,
      placement: { x: 70, y: -20, width: 100, height: 200 },
    });
  });

  it("turns an outward Distort into a tight canvas and translated Figma placement", async () => {
    const base = frameFromSource({
      bytes: new Uint8Array([1]),
      sourceNodeId: "source",
      sourceName: "Poster",
      renderWidth: 100,
      renderHeight: 50,
      placement: { x: 20, y: 30, width: 200, height: 100 },
    });
    const outward = normalizedSpec({
      tl: { x: -0.2, y: -0.2 },
      tr: { x: 1.2, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    });
    const composition = await composeAffineTransform(
      outward,
      identityTransformRecipe(),
      { width: base.renderWidth, height: base.renderHeight },
    );

    const framed = frameFromComposition(base, composition);
    expect(framed.renderWidth).toBe(140);
    expect(framed.renderHeight).toBe(60);
    expect(framed.placement).toEqual({ x: -20, y: 10, width: 280, height: 120 });
    expect(framed.spec.destination.quad.tl).toEqual({ x: 0, y: 0 });
  });

  it("rejects a transformed Figma image axis above the host limit", () => {
    const base = {
      spec: identitySpec(),
      renderWidth: 100,
      renderHeight: 100,
      placement: { x: 0, y: 0, width: 100, height: 100 },
    };
    const composition = {
      spec: identitySpec(),
      canvas: { origin: { x: 0, y: 0 }, size: { width: 4097, height: 100 } },
    } as AffineComposition;
    expect(() => frameFromComposition(base, composition)).toThrow(TransformFrameError);
    expect(() => frameFromComposition(base, composition)).toThrow(
      expect.objectContaining({ code: "figmaImageAxisExceeded" }),
    );
  });

  it("reports a typed reason when the placement is not representable", () => {
    const base = {
      spec: identitySpec(),
      renderWidth: 100,
      renderHeight: 100,
      placement: { x: 0, y: 0, width: 100, height: 100 },
    };
    const composition = {
      spec: identitySpec(),
      canvas: { origin: { x: Number.NaN, y: 0 }, size: { width: 50, height: 50 } },
    } as AffineComposition;
    expect(() => frameFromComposition(base, composition)).toThrow(
      expect.objectContaining({ code: "placementInvalid" }),
    );
  });

  it("keeps an in-progress frame attached when the selected source moves and resizes", () => {
    const previousInitial = {
      spec: identitySpec(),
      renderWidth: 100,
      renderHeight: 50,
      placement: { x: 20, y: 30, width: 200, height: 100 },
    };
    const nextInitial = {
      spec: identitySpec(),
      renderWidth: 150,
      renderHeight: 100,
      placement: { x: 100, y: 80, width: 300, height: 200 },
    };
    const current = {
      spec: identitySpec(),
      renderWidth: 50,
      renderHeight: 100,
      placement: { x: 70, y: -20, width: 100, height: 200 },
    };

    expect(rebaseTransformFrame(previousInitial, nextInitial, current)).toEqual({
      spec: identitySpec(),
      renderWidth: 75,
      renderHeight: 200,
      placement: { x: 175, y: -20, width: 150, height: 400 },
    });
  });
});
