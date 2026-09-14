import { describe, expect, it } from "vitest";
import { defaultMockup, mockupGeometryFingerprint } from "./mockup-workspace";
import { sameJsonValue, type LoadedDesignerSource } from "./designer-workspace-common";

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

describe("sameJsonValue", () => {
  it("ignores object key order and detects a semantic edit", () => {
    const spec = defaultMockup([source("one", 10)]);
    const reordered = {
      planes: spec.planes.map((plane) => ({
        opacity: plane.opacity,
        transform: plane.transform,
        sourceId: plane.sourceId,
        id: plane.id,
      })),
      background: spec.background,
      canvas: spec.canvas,
      version: spec.version,
      schema: spec.schema,
      seams: spec.seams,
    };
    expect(sameJsonValue(reordered, spec)).toBe(true);
    expect(sameJsonValue({
      ...reordered,
      canvas: { ...spec.canvas, width: spec.canvas.width + 1 },
    }, spec)).toBe(false);
  });
});

describe("placeOnBackdrop", () => {
  it("puts the chosen backdrop behind artwork without rebinding sources", async () => {
    const { placeOnBackdrop } = await import("./mockup-workspace");
    const { checkedTemplateLibrary, spatialTemplateFromMockup } = await import("./stored-template-library");
    const sources = [source("art", 10), { ...source("scene", 500), placement: {x:500,y:20,width:600,height:400} }];
    const before = defaultMockup(sources);
    const original = structuredClone(before);
    const next = placeOnBackdrop(before, "plane-2", sources)!;
    expect(before).toEqual(original);
    expect(next.canvas).toEqual({width:600,height:400});
    expect(next.planes.map(p => p.sourceId)).toEqual(["source-2", "source-1"]);
    const quad = next.planes[1]!.transform.destination.quad;
    expect((quad.tr.x-quad.tl.x)*600 / ((quad.bl.y-quad.tl.y)*400)).toBeCloseTo(100/80);
    expect(checkedTemplateLibrary([{id:"scene",name:"Screen",template:spatialTemplateFromMockup(next)}])).toBeDefined();
  });
  it("bounds large backdrop pixels and rejects unavailable backdrop commands", async () => {
    const { placeOnBackdrop } = await import("./mockup-workspace");
    const sources = [source("art", 0), {...source("scene", 500),placement:{x:500,y:0,width:8000,height:6000}}];
    const before = defaultMockup(sources);
    expect(placeOnBackdrop(before,"plane-2",sources)?.canvas).toEqual({width:4096,height:3072});
    expect(placeOnBackdrop(before,"missing",sources)).toBeUndefined();
    expect(placeOnBackdrop(defaultMockup([sources[0]!]),"plane-1",sources)).toBeUndefined();
  });
});
