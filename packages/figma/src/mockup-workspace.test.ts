import { describe, expect, it } from "vitest";
import {
  compositionParametersJson,
  defaultMockup,
  loadMockupDraft,
  mockupGeometryFingerprint,
} from "./mockup-workspace";
import { sameJsonValue, type LoadedDesignerSource } from "./designer-workspace-common";
import { compositionMockup } from "./stored-designer-task";

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

describe("Composition Agent draft loading", () => {
  it("previews the staged geometry while Reset still returns to the published result", () => {
    const sources = [source("art", 10), source("scene", 130)];
    const published = defaultMockup(sources);
    const staged = structuredClone(published);
    staged.planes[0]!.opacity = .4;
    const loaded = loadMockupDraft({
      sources, selectionGeneration: 1, targetNodeId: "result",
      task: { kind: "mockup", spec: published },
      mockupDraft: { schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision: 2,
        task: { kind: "mockup", spec: staged } },
    });
    expect(loaded.agentDraftLoaded).toBe(true);
    expect(compositionMockup(loaded.task).planes[0]?.opacity).toBe(.4);
    expect(compositionMockup(loaded.baseline).planes[0]?.opacity).toBe(1);
    compositionMockup(loaded.task).planes[0]!.opacity = .2;
    expect(published.planes[0]?.opacity).toBe(1);
  });
});

describe("Composition parameter export", () => {
  it("keeps the whole-result stage and named outputs", async () => {
    const { continuedCompositionTask } = await import("./stored-designer-task");
    const task = continuedCompositionTask(defaultMockup([
      source("art", 10), source("scene", 130),
    ]));
    if (task.kind !== "composition") throw new Error("expected a continued Composition task");
    const stage = task.template.operation.postprocess.stages[0];
    if (stage?.kind !== "transform") throw new Error("expected a whole-result Transform");
    stage.spec = { ...stage.spec, content: {
      ...(stage.spec.content ?? { fit: "stretch" }),
      warp: { preset: "arch", amount: .4 },
    } };
    task.template.output = { kind: "canvasSet", spec: {
      schema: "worldbend.canvas-set", version: "0.1", variants: [{
        id: "wide", operation: { kind: "stretch", output: { width: 1200, height: 628 } },
      }],
    } };
    task.previewOutputId = "wide";
    const copied = JSON.parse(compositionParametersJson(task));
    expect(copied.operation.kind).toBe("compositionProgram");
    expect(copied.operation.postprocess.stages[0].spec.content.warp).toEqual({
      preset: "arch", amount: .4,
    });
    expect(copied.output.spec.variants[0].id).toBe("wide");
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

describe("fitArtworkToQuad", () => {
  it("anchors the output to the guide and puts the artwork on its exact quad", async () => {
    const { fitArtworkToQuad } = await import("./mockup-workspace");
    const artwork = source("art", 20);
    const guide = {
      ...source("screen", 500),
      placement: { x: 500, y: 100, width: 600, height: 400 },
      quadGuide: {
        tl: { x: 560, y: 140 }, tr: { x: 1040, y: 120 },
        br: { x: 1010, y: 460 }, bl: { x: 590, y: 480 },
      },
    };
    const before = defaultMockup([artwork, guide]);
    const original = structuredClone(before);
    const fitted = fitArtworkToQuad(before, [artwork, guide]);
    expect(before).toEqual(original);
    expect(fitted?.spec.canvas).toEqual({ width: 600, height: 400 });
    expect(fitted?.spec.planes.map((plane) => plane.sourceId)).toEqual(["source-2", "source-1"]);
    expect(fitted?.spec.planes.map((plane) => plane.opacity)).toEqual([0, 1]);
    expect(fitted?.artworkPlaneId).toBe("plane-1");
    expect(fitted?.spec.planes[1]?.transform.destination.quad).toEqual({
      tl: { x: .1, y: .1 }, tr: { x: .9, y: .05 },
      br: { x: .85, y: .9 }, bl: { x: .15, y: .95 },
    });
  });

  it.each([
    { name: "screen", placement: { x: 500, y: 100, width: 600, height: 400 }, canvas: { width: 600, height: 400 }, guideFirst: false },
    { name: "package", placement: { x: 40, y: 60, width: 2400, height: 3200 }, canvas: { width: 2400, height: 3200 }, guideFirst: true },
    { name: "poster above the 4096 limit", placement: { x: 80, y: 120, width: 8000, height: 12000 }, canvas: { width: 2731, height: 4096 }, guideFirst: false },
  ])("keeps exact $name geometry independent of selection order", async ({ placement, canvas, guideFirst }) => {
    const { fitArtworkToQuad } = await import("./mockup-workspace");
    const artwork = source("art", 20);
    const { x, y, width, height } = placement;
    const guide = {
      ...source("target", x), placement,
      quadGuide: {
        tl: { x: x + width * .1, y: y + height * .1 },
        tr: { x: x + width * .9, y: y + height * .05 },
        br: { x: x + width * .85, y: y + height * .9 },
        bl: { x: x + width * .15, y: y + height * .95 },
      },
    };
    const sources = guideFirst ? [guide, artwork] : [artwork, guide];
    const fitted = fitArtworkToQuad(defaultMockup(sources), sources);
    expect(fitted?.spec.canvas).toEqual(canvas);
    expect(fitted?.artworkPlaneId).toBe(guideFirst ? "plane-2" : "plane-1");
    expect(fitted?.spec.planes[0]?.opacity).toBe(0);
    const quad = fitted?.spec.planes[1]?.transform.destination.quad;
    expect(quad?.tl.x).toBeCloseTo(.1);
    expect(quad?.tl.y).toBeCloseTo(.1);
    expect(quad?.tr.x).toBeCloseTo(.9);
    expect(quad?.tr.y).toBeCloseTo(.05);
    expect(quad?.br.x).toBeCloseTo(.85);
    expect(quad?.br.y).toBeCloseTo(.9);
    expect(quad?.bl.x).toBeCloseTo(.15);
    expect(quad?.bl.y).toBeCloseTo(.95);
  });

  it("requires exactly one explicit guide and one artwork layer", async () => {
    const { fitArtworkToQuad } = await import("./mockup-workspace");
    const artwork = source("art", 20);
    const other = source("other", 500);
    expect(fitArtworkToQuad(defaultMockup([artwork, other]), [artwork, other])).toBeUndefined();
    const guide = { ...other, quadGuide: {
      tl: { x: 500, y: 20 }, tr: { x: 600, y: 20 }, br: { x: 600, y: 100 }, bl: { x: 500, y: 100 },
    } };
    expect(fitArtworkToQuad(defaultMockup([artwork]), [artwork])).toBeUndefined();
    expect(fitArtworkToQuad(defaultMockup([guide, { ...artwork, quadGuide: guide.quadGuide }]),
      [guide, { ...artwork, quadGuide: guide.quadGuide }])).toBeUndefined();
  });
});

describe("fitArtworkToShape", () => {
  it("retains independent region unions when preparing shape clipping", async () => {
    const { fitArtworkToShape } = await import("./mockup-workspace");
    const artwork = { ...source("art",0), renderWidth:360, renderHeight:240 };
    const guide = { ...source("guide",420), renderWidth:240, renderHeight:160 };
    const shape = { bounds: {x:420,y:0,width:240,height:160}, fillRule:"evenOdd" as const,
      contours: [0,1].map(() => ({ start:{x:420,y:0}, segments:[
        {kind:"line" as const,to:{x:660,y:0}}, {kind:"line" as const,to:{x:660,y:160}},
        {kind:"line" as const,to:{x:420,y:160}}, {kind:"line" as const,to:{x:420,y:0}},
      ]})), regions:[{contourIndices:[0],fillRule:"evenOdd" as const},{contourIndices:[1],fillRule:"nonZero" as const}] };
    const sources = [artwork,{...guide,shapeGuide:shape}];
    const task = fitArtworkToShape(defaultMockup(sources),sources)!;
    expect(task.spec.clip?.regions).toEqual(shape.regions);
    expect(task.spec.clip?.regions).not.toBe(shape.regions);
    expect(shape.contours[0]!.start).toEqual({x:420,y:0});
  });

  const shapeGuide = (bounds: { x: number; y: number; width: number; height: number }) => ({
    contours: [{
      start: { x: bounds.x + bounds.width / 2, y: bounds.y },
      segments: [
        { kind: "cubic" as const, to: { x: bounds.x + bounds.width, y: bounds.y + bounds.height / 2 },
          c1: { x: bounds.x + bounds.width, y: bounds.y }, c2: { x: bounds.x + bounds.width / 2, y: bounds.y } },
        { kind: "cubic" as const, to: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height },
          c1: { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, c2: { x: bounds.x + bounds.width, y: bounds.y + bounds.height } },
        { kind: "cubic" as const, to: { x: bounds.x, y: bounds.y + bounds.height / 2 },
          c1: { x: bounds.x, y: bounds.y + bounds.height }, c2: { x: bounds.x, y: bounds.y + bounds.height } },
        { kind: "cubic" as const, to: { x: bounds.x + bounds.width / 2, y: bounds.y },
          c1: { x: bounds.x, y: bounds.y }, c2: { x: bounds.x, y: bounds.y } },
      ],
    }],
    fillRule: "nonZero" as const,
    bounds,
  });

  it("clips the canvas to the shape and covers it with the artwork", async () => {
    const { fitArtworkToShape } = await import("./mockup-workspace");
    const artwork = { ...source("art", 20), renderWidth: 100, renderHeight: 100 };
    const bounds = { x: 500, y: 100, width: 600, height: 400 };
    const guide = { ...source("badge", 500), placement: bounds, shapeGuide: shapeGuide(bounds) };
    const before = defaultMockup([artwork, guide]);
    const fitted = fitArtworkToShape(before, [artwork, guide]);
    expect(fitted?.spec.canvas).toEqual({ width: 600, height: 400 });
    expect(fitted?.spec.planes.map((plane) => plane.opacity)).toEqual([0, 1]);
    expect(fitted?.artworkPlaneId).toBe("plane-1");
    // Square artwork covers a 3:2 canvas by filling the width and extending
    // vertically beyond the box, centered.
    expect(fitted?.spec.planes[1]?.transform.destination.quad).toEqual({
      tl: { x: 0, y: -0.25 }, tr: { x: 1, y: -0.25 },
      br: { x: 1, y: 1.25 }, bl: { x: 0, y: 1.25 },
    });
    const clip = fitted?.spec.clip;
    expect(clip?.fillRule).toBe("nonZero");
    expect(clip?.contours[0]?.start).toEqual({ x: 0.5, y: 0 });
    expect(clip?.contours[0]?.segments.every((segment) => segment.kind === "cubic")).toBe(true);
    // Wider artwork covers by height instead, cropping the sides.
    const wide = { ...artwork, renderWidth: 400, renderHeight: 100 };
    const wideFit = fitArtworkToShape(defaultMockup([wide, guide]), [wide, guide]);
    const wideQuad = wideFit?.spec.planes[1]?.transform.destination.quad;
    expect(wideQuad?.tl.x).toBeCloseTo((1 - 4 / 1.5) / 2);
    expect(wideQuad?.tr.x).toBeCloseTo((1 + 4 / 1.5) / 2);
    expect(wideQuad?.tl.y).toBe(0);
    expect(wideQuad?.br.y).toBe(1);
  });

  it("keeps guide-first selection order and normalizes against the shape bounds", async () => {
    const { fitArtworkToShape } = await import("./mockup-workspace");
    const artwork = { ...source("art", 20), renderWidth: 100, renderHeight: 100 };
    const bounds = { x: 40, y: 60, width: 300, height: 300 };
    const guide = { ...source("badge", 40), shapeGuide: shapeGuide(bounds) };
    const sources = [guide, artwork];
    const fitted = fitArtworkToShape(defaultMockup(sources), sources);
    expect(fitted?.spec.canvas).toEqual({ width: 300, height: 300 });
    expect(fitted?.artworkPlaneId).toBe("plane-2");
    expect(fitted?.spec.clip?.contours[0]?.segments[0]?.to).toEqual({ x: 1, y: 0.5 });
  });

  it("requires one non-quad closed shape guide and does not mutate its input", async () => {
    const { fitArtworkToShape } = await import("./mockup-workspace");
    const artwork = { ...source("art", 20), renderWidth: 100, renderHeight: 100 };
    const other = source("other", 500);
    expect(fitArtworkToShape(defaultMockup([artwork, other]), [artwork, other])).toBeUndefined();
    expect(fitArtworkToShape(defaultMockup([artwork]), [artwork])).toBeUndefined();

    const bounds = { x: 0, y: 0, width: 200, height: 200 };
    const guide = { ...other, shapeGuide: shapeGuide(bounds) };
    // Two shape guides are ambiguous.
    expect(fitArtworkToShape(defaultMockup([guide, { ...artwork, shapeGuide: guide.shapeGuide }]),
      [guide, { ...artwork, shapeGuide: guide.shapeGuide }])).toBeUndefined();
    // A quad guide wins over shape treatment for the same outline: the shape
    // candidate never competes with the stronger perspective affordance.
    const quadLike = { ...other, quadGuide: {
      tl: { x: 0, y: 0 }, tr: { x: 200, y: 0 }, br: { x: 200, y: 200 }, bl: { x: 0, y: 200 },
    }, shapeGuide: shapeGuide(bounds) };
    expect(fitArtworkToShape(defaultMockup([artwork, quadLike]), [artwork, quadLike])).toBeUndefined();
    const before = defaultMockup([artwork, guide]);
    const original = structuredClone(before);
    fitArtworkToShape(before, [artwork, guide]);
    expect(before).toEqual(original);
  });
});
