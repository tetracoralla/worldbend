import { describe, expect, it } from "vitest";
import { defaultMockup, mockupGeometryFingerprint } from "./mockup-workspace";
import type { LoadedDesignerSource } from "./designer-workspace-common";

const source = (id: string, x: number): LoadedDesignerSource => ({
  sourceNodeId: id,
  sourceName: id,
  renderWidth: 100,
  renderHeight: 80,
  placement: { x, y: 20, width: 100, height: 80 },
  image: {} as HTMLImageElement,
});

describe("mockupGeometryFingerprint", () => {
  it("ignores opacity so a live fade can reuse the last solved planes", () => {
    const spec = defaultMockup([source("one", 10), source("two", 130)]);
    const faded = {
      ...spec,
      planes: spec.planes.map((plane, index) => index === 0 ? { ...plane, opacity: 0.4 } : plane),
    };
    expect(mockupGeometryFingerprint(faded)).toBe(mockupGeometryFingerprint(spec));
  });

  it("changes when a plane's corners or canvas size change", () => {
    const spec = defaultMockup([source("one", 10)]);
    const moved = {
      ...spec,
      planes: spec.planes.map((plane) => ({
        ...plane,
        transform: {
          ...plane.transform,
          destination: {
            ...plane.transform.destination,
            quad: { ...plane.transform.destination.quad, tl: { x: 0.1, y: 0.1 } },
          },
        },
      })),
    };
    expect(mockupGeometryFingerprint(moved)).not.toBe(mockupGeometryFingerprint(spec));
    expect(mockupGeometryFingerprint({ ...spec, canvas: { width: 50, height: 40 } }))
      .not.toBe(mockupGeometryFingerprint(spec));
  });
});
