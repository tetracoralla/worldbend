import { afterEach, expect, it, vi } from "vitest";
import { captureNativeMotion, readNativeMotionPlayhead, recordedRenderer, restoreNativeMotion, validateProjectiveMotionBase,
  type NativeMotionSnapshot } from "./native-motion";
import type { NativeRenderer } from "./native-projective";

afterEach(() => vi.restoreAllMocks());

const binding = (baseValue: number, value = baseValue) => ({ id: `track-${baseValue}`,
  baseValue: { type: "FLOAT" as const, value }, keyframes: [
    { id: `key-${baseValue}-0`, timelinePosition: 0, easing: { type: "LINEAR" as const },
      value: { type: "FLOAT" as const, value: 0 } },
    { id: `key-${baseValue}-1`, timelinePosition: 2, easing: { type: "EASE_IN_AND_OUT" as const },
      value: { type: "FLOAT" as const, value: baseValue } },
  ] });

function animatedSurface() {
  const ids = Array.from({ length: 11 }, (_, index) => `old-${index}`);
  const properties = Object.fromEntries(ids.map((id, index) => [id, index + .25]));
  const propertyTracks = Object.fromEntries(ids.slice(0, 9).map((id, index) => [id, binding(index + .25)]));
  const surface = {
    effects: [{ type: "SHADER", visible: true, id: "old-shader",
      properties: Object.fromEntries(ids.slice(9).map(id => [id, properties[id]])) }],
    manualKeyframeTracks: { OPACITY: binding(.8), effects: { 0: { properties: propertyTracks } } },
    animationStyles: [
      { type: "FIGMA", id: "applied-style", styleId: "style", name: "Fade", duration: .4, timelineOffset: .1,
        props: { timing: "in" } },
      { type: "CUSTOM", id: "applied-custom", styleId: "custom-style", name: "Custom", timelineOffset: .2 },
    ],
    timelines: [{ id: "timeline", duration: 2 }],
    applyManualKeyframeTrack: vi.fn(), applyAnimationStyle: vi.fn(), setTimelineDuration: vi.fn(),
  };
  return { ids, properties, surface };
}

it("admits a projective surface whose keyed shader bases plus static extents equal the saved result", () => {
  const { properties, surface } = animatedSurface();
  expect(() => validateProjectiveMotionBase(surface as unknown as FrameNode, properties)).not.toThrow();
  const keyed = surface.manualKeyframeTracks.effects[0].properties;
  keyed[Object.keys(keyed)[0]!] = binding(1, 999);
  expect(() => validateProjectiveMotionBase(surface as unknown as FrameNode, properties)).toThrow("Motion base changed");
});

it("rejects an unknown keyed shader field instead of hiding incompatible Motion", () => {
  const { properties, surface } = animatedSurface();
  surface.manualKeyframeTracks.effects[0].properties.unknown = binding(1);
  expect(() => validateProjectiveMotionBase(surface as unknown as FrameNode, properties)).toThrow("Motion changed");
});

it("remaps shader tracks, rebases only their resting values, and preserves native timing and ordinary Motion", () => {
  const { properties, surface } = animatedSurface();
  const capture = captureNativeMotion(surface as unknown as FrameNode);
  expect(capture.snapshot).toBeDefined();
  const oldRenderer = recordedRenderer("old-shader", properties)!;
  const newRenderer: NativeRenderer = { id: "new-shader",
    propertyIds: Array.from({ length: 9 }, (_, index) => `new-${index}`),
    extentPropertyIds: ["new-9", "new-10"] };
  const newProperties = Object.fromEntries([...newRenderer.propertyIds, ...newRenderer.extentPropertyIds]
    .map((id, index) => [id, 100 + index]));
  const target = { manualKeyframeTracks: {}, animationStyles: [], timelines: [{ id: "next-timeline", duration: 1 }],
    applyManualKeyframeTrack: vi.fn(), applyAnimationStyle: vi.fn(), setTimelineDuration: vi.fn() };
  restoreNativeMotion(target as unknown as FrameNode, capture.snapshot, oldRenderer, newRenderer, newProperties);
  expect(target.applyAnimationStyle).toHaveBeenCalledWith("style", { duration: .4, timelineOffset: .1, props: { timing: "in" } });
  expect(target.applyAnimationStyle).toHaveBeenCalledWith("custom-style", { type: "CUSTOM", timelineOffset: .2 });
  expect(target.applyManualKeyframeTrack).toHaveBeenCalledWith(
    { type: "INDEXED_ITEM", collection: "effects", index: 0, propertyId: "new-0" },
    expect.objectContaining({ baseValue: { type: "FLOAT", value: 100 }, keyframes: [
      expect.objectContaining({ timelinePosition: 0, value: { type: "FLOAT", value: 0 } }),
      expect.objectContaining({ timelinePosition: 2, value: { type: "FLOAT", value: .25 } }),
    ] }),
  );
  expect(target.applyManualKeyframeTrack).toHaveBeenCalledWith(
    { type: "PROPERTY", name: "OPACITY" },
    expect.objectContaining({ baseValue: { type: "FLOAT", value: .8 } }),
  );
  expect(target.setTimelineDuration).toHaveBeenCalledWith("next-timeline", 2);
  surface.manualKeyframeTracks.OPACITY.keyframes[1]!.timelinePosition = 1.5;
  expect(capture.validate).toThrow("Motion changed");
});

it("refuses to reinterpret shader keyframe units after a source or surface size change", () => {
  const { properties, surface } = animatedSurface();
  const snapshot = captureNativeMotion(surface as unknown as FrameNode).snapshot as NativeMotionSnapshot;
  const renderer = recordedRenderer("shader", properties)!;
  expect(() => restoreNativeMotion(surface as unknown as FrameNode, snapshot, renderer, renderer, properties, false))
    .toThrow("matching source and surface dimensions");
});

it("refuses a shader track when the replacement renderer has no semantic mapping", () => {
  const { properties, surface } = animatedSurface();
  const snapshot = captureNativeMotion(surface as unknown as FrameNode).snapshot as NativeMotionSnapshot;
  expect(() => restoreNativeMotion(surface as unknown as FrameNode, snapshot,
    recordedRenderer("old", properties), undefined, undefined)).toThrow("renderer mapping is unavailable");
});

it("reads only a real active native Motion playhead", () => {
  expect(readNativeMotionPlayhead({ motion: { playheadPosition: 1.25 } })).toBe(1.25);
  expect(readNativeMotionPlayhead({ motion: { playheadPosition: undefined } })).toBeUndefined();
  expect(readNativeMotionPlayhead({ motion: { playheadPosition: Number.NaN } })).toBeUndefined();
  expect(readNativeMotionPlayhead({ get motion(): {playheadPosition:number|undefined} { throw Error("not a supported API"); } })).toBeUndefined();
});

it("refuses to replace a surface when the host can write Motion but cannot read its tracks", () => {
  const surface = {
    applyManualKeyframeTrack: vi.fn(),
    get manualKeyframeTracks() { throw Error('"manualKeyframeTracks" is not a supported API'); },
    animationStyles: [], timelines: [],
  };
  expect(() => captureNativeMotion(surface as unknown as FrameNode)).toThrow("Motion state is unavailable");
  expect(captureNativeMotion({} as FrameNode).snapshot).toBeUndefined();
});
