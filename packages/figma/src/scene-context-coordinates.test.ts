import { describe, expect, it } from "vitest";
import { sceneContextCoordinates } from "./scene-context-coordinates";
import type { SceneContextFrame } from "./messages";
import { isUiToMainMessage } from "./messages";

const frame: SceneContextFrame = { bytes: new Uint8Array([1]), width: 600, height: 450,
  placement: { x: 1000, y: 2000, width: 1200, height: 900 },
  resultTransform: [[1, 0, 1120], [0, 1, 2090]], resultWidth: 600, resultHeight: 450 };
describe("native scene preview coordinates and requests", () => {
  it("keeps handles aligned with an inset result in a larger scene", () => {
    const coordinates = sceneContextCoordinates(frame);
    expect(coordinates.project({ x: 0, y: 0 })).toEqual({ x: .1, y: .1 });
    expect(coordinates.project({ x: 1, y: 1 })).toEqual({ x: .6, y: .6 });
    expect(coordinates.unproject({ x: .6, y: .6 })).toEqual({ x: 1, y: 1 });
  });
  it("round-trips handles through native rotation and rejects a singular transform", () => {
    const coordinates = sceneContextCoordinates({ ...frame, resultTransform: [[0, -1, 1700], [1, 0, 2090]] });
    for (const point of [{ x: 0, y: 0 }, { x: .3, y: .8 }, { x: 1, y: 1 }]) {
      const recovered = coordinates.unproject(coordinates.project(point));
      expect(recovered.x).toBeCloseTo(point.x); expect(recovered.y).toBeCloseTo(point.y);
    }
    expect(() => sceneContextCoordinates({ ...frame, resultTransform: [[0, 0, 0], [0, 0, 0]] })).toThrow("unavailable");
  });
  it("bounds preview pixels and correlates scene capture to the current request", () => {
    const request = { type: "request-scene-context", generation: 1, requestId: 1, bytes: new Uint8Array([1]), showCanvas: false };
    expect(isUiToMainMessage(request)).toBe(true);
    for (const change of [{ requestId: 0 }, { bytes: new Uint8Array() }, { showCanvas: 1 }, { extra: true }])
      expect(isUiToMainMessage({ ...request, ...change })).toBe(false);
  });
});
