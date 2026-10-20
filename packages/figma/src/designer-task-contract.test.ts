import { describe, expect, it } from "vitest";
import type { DeformationWorkSpecInput, LiquifyControls } from "@worldbend/web/types";
import { defaultMockup } from "./mockup-workspace";
import { createMeshSpec } from "./mesh-workspace";
import { createSurfaceSpec } from "./surface-workspace";
import { deformationWorkFromSurface } from "./deformation-work-state";
import { defaultRemap } from "./remap-workspace";
import {
  continuedCompositionTask,
  isStoredDesignerTask,
  parseStoredDesignerTask,
  parseStoredEffectDraft,
  type FigmaSpatialEffectTask,
} from "./stored-designer-task";
import { isUiToMainMessage } from "./messages";

const source = (id: string, x: number, width = 100) => ({
  sourceNodeId: id,
  sourceName: id,
  renderWidth: width,
  renderHeight: 80,
  placement: { x, y: 20, width, height: 80 },
  image: {} as HTMLImageElement,
});

function effectTask() {
  const viewport = { width: 600, height: 400 };
  return {
    kind: "effect" as const,
    recipe: {
      schema: "worldbend.effect-recipe" as const,
      version: "3" as const,
      origin: { effect: "multiplane-camera" as const, version: "3" as const, viewport, intensity: .8 },
      viewport,
      camera: { focalLength: 1320, focusDistance: 1000, travel: { x: 48, y: 32 } },
      appearance: {
        depthOfField: { focusDistance: 1000, focusRange: 300, maxBlurRadius: 12 },
        motionBlur: { exposureFraction: .65, maxBlurRadius: 24 },
      },
      layers: [
        { id: "background", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 1500 }, tracks: [] },
        { id: "middle", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 1000 }, tracks: [] },
        { id: "foreground", offset: { x: -60, y: -40 }, surface: { kind: "camera-plane" as const, size: { width: 720, height: 480 }, distance: 650 }, tracks: [] },
      ],
    },
    state: { progress: 1, pointerX: 0, pointerY: 0, reducedMotion: false },
  };
}

describe("designer task contracts", () => {
  it("persists fitting curves and landmarks with the deformation work", () => {
    const spec = deformationWorkFromSurface(createSurfaceSpec(100,80));
    spec.shapeFit = {
      contour:{start:{x:0,y:0},segments:[{kind:"line",to:{x:1,y:0}},
        {kind:"cubic",c1:{x:0.8,y:0.3},c2:{x:0.8,y:0.7},to:{x:1,y:1}},
        {kind:"line",to:{x:0,y:1}}]},
      cornerPositions:[0,0.25,0.5,0.75],refinement:2,
    };
    spec.shapeFit.clip = {contours:[structuredClone(spec.shapeFit.contour)],fillRule:"evenOdd",
      regions:[{contourIndices:[0],fillRule:"evenOdd"}]};
    const task = {kind:"deformation" as const,view:"mesh" as const,spec};
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
    for (const corners of [[0,0.25,0.25,0.75],[0,0.5,0.25,0.75],[0,0.25,0.5,1]]) {
      const bad = structuredClone(task);
      bad.spec.shapeFit!.cornerPositions = corners as [number,number,number,number];
      expect(isStoredDesignerTask(bad)).toBe(false);
    }
    const bad = structuredClone(task);
    Object.assign(bad.spec.shapeFit!,{unexpected:"value"});
    expect(isStoredDesignerTask(bad)).toBe(false);
    const damagedMask = structuredClone(task);
    damagedMask.spec.shapeFit!.clip!.regions![0]!.contourIndices = [3];
    expect(isStoredDesignerTask(damagedMask)).toBe(false);
  });
  it("preserves closed curved surfaces in stored scenes and Composition continuation", () => {
    const spec = defaultMockup([source("art",0),source("guide",120)]);
    spec.planes[0]!.surface = {kind:"fabric",folds:3,depth:1/3,phase:0.25,light:{strength:0.65,direction:-0.45}};
    const task = {kind:"mockup" as const,spec};
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
    const continued = continuedCompositionTask(task.spec);
    expect(parseStoredDesignerTask(JSON.stringify(continued))).toEqual(continued);
    const malformed = structuredClone(task);
    Object.assign(malformed.spec.planes[0]!.surface!,{unexpected:"value"});
    expect(isStoredDesignerTask(malformed)).toBe(false);
    spec.planes[0]!.surface = {kind:"cylinder",curvature:0.7};
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
  });
  it("preserves independent clip regions across saved tasks, Composition and publication messages", () => {
    const spec = defaultMockup([source("art", 0), source("guide", 120)]);
    const contour = { start: { x: 0, y: 0 }, segments: [
      { kind: "line" as const, to: { x: 1, y: 0 } },
      { kind: "line" as const, to: { x: 1, y: 1 } },
      { kind: "line" as const, to: { x: 0, y: 1 } },
      { kind: "line" as const, to: { x: 0, y: 0 } },
    ] };
    spec.clip = { contours: [contour, structuredClone(contour)], fillRule: "evenOdd", regions: [
      { contourIndices: [0], fillRule: "evenOdd" }, { contourIndices: [1], fillRule: "nonZero" },
    ] };
    const task = { kind: "mockup" as const, spec };
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
    const continued = continuedCompositionTask(spec);
    expect(parseStoredDesignerTask(JSON.stringify(continued))).toEqual(continued);
    const message = { type: "apply-designer", payload: { generation: 1, sourceNodeIds: ["art", "guide"],
      task, bytes: new Uint8Array([1]), renderWidth: spec.canvas.width, renderHeight: spec.canvas.height,
      placement: { x: 0, y: 0, ...spec.canvas } } };
    expect(isUiToMainMessage(message)).toBe(true);
    const rejects = [
      [{ contourIndices: [] }], [{ contourIndices: [0] }],
      [{ contourIndices: [0, 0, 1] }], [{ contourIndices: [0, 2] }],
      [{ contourIndices: [0, -1] }], [{ contourIndices: [0, .5, 1] }],
      [{ contourIndices: [0, 1], fillRule: "unknown" }],
      [{ contourIndices: [0, 1], extra: true }],
      Array.from({ length: 9 }, () => ({ contourIndices: [0, 1] })),
    ];
    for (const regions of rejects) {
      const malformed = structuredClone(task); Object.assign(malformed.spec.clip!, { regions });
      expect(isStoredDesignerTask(malformed), JSON.stringify(regions)).toBe(false);
      expect(isUiToMainMessage({ ...message, payload: { ...message.payload, task: malformed } })).toBe(false);
    }
    // Canonical empty regions retain the legacy global rule; per-region rules
    // default to nonZero, and a contour may participate in distinct regions.
    spec.clip.regions = []; expect(isStoredDesignerTask(task)).toBe(true);
    spec.clip.regions = [{ contourIndices: [0, 1] }, { contourIndices: [1] }];
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
  });

  it("retains fractional logical Depth planes while requiring integer output pixels", () => {
    const task = effectTask();
    task.recipe.viewport = { width: 375, height: 812 };
    task.recipe.origin.viewport = { ...task.recipe.viewport };
    task.recipe.layers.forEach(layer => {
      layer.surface.size = { width: 450, height: 974.4 };
      layer.offset = { x: -37.5, y: -81.2 };
    });
    expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
    for (const axis of [0, .9, 4096.1, Infinity, NaN]) {
      const invalid = structuredClone(task);
      invalid.recipe.layers[0]!.surface.size.height = axis;
      expect(isStoredDesignerTask(invalid)).toBe(false);
    }
    task.recipe.layers[0]!.surface.size.height = 4095.6;
    expect(isStoredDesignerTask(task)).toBe(true);
    task.recipe.viewport.height = 812.5;
    expect(isStoredDesignerTask(task)).toBe(false);
  });

  it("stores only closed canonical designer tasks, including the shared Spatial recipe", () => {
    const continued = continuedCompositionTask(defaultMockup([source("one", 10), source("two", 130)]));
    if (continued.kind !== "composition") throw new Error("expected composition task");
    const continuedStage = continued.template.operation.postprocess.stages[0]!;
    if (continuedStage.kind !== "transform") throw new Error("expected transform stage");
    continuedStage.spec.content!.warp = { preset: "arch", amount: .4 };
    continued.template.output = {
      kind: "canvasSet",
      spec: { schema: "worldbend.canvas-set", version: "0.1", variants: [
        { id: "hero", operation: { kind: "stretch", output: { width: 1200, height: 628 } } },
        { id: "square", operation: { kind: "contain", output: { width: 1080, height: 1080 }, anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } },
      ] },
    };
    continued.previewOutputId = "hero";
    const tasks = [
      { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) },
      { kind: "surface" as const, spec: createSurfaceSpec(100, 80) },
      { kind: "deformation" as const, view: "pin" as const,
        spec: deformationWorkFromSurface(createSurfaceSpec(100, 80)) },
      { kind: "mockup" as const, spec: defaultMockup([source("one", 10), source("two", 130)]) },
      continued,
      { kind: "remap" as const, spec: defaultRemap(100, 80, true) },
      effectTask(),
    ];
    for (const task of tasks) {
      expect(isStoredDesignerTask(task)).toBe(true);
      expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
      expect(isStoredDesignerTask({ ...task, planner: "wasm" })).toBe(false);
    }
    const wrongPreview = structuredClone(continued);
    wrongPreview.previewOutputId = "missing";
    expect(isStoredDesignerTask(wrongPreview)).toBe(false);
    const extraStage = structuredClone(continued);
    extraStage.template.operation.postprocess.stages.push(structuredClone(extraStage.template.operation.postprocess.stages[0]!));
    expect(isStoredDesignerTask(extraStage)).toBe(false);
  });

  it("accepts a bounded Liquify block and rejects contract-violating strokes", () => {
    const work = () => deformationWorkFromSurface(createSurfaceSpec(100, 80));
    const push = (delta?: { x: number; y: number }): LiquifyControls => ({
      strokes: [{ id: "stroke-1", mode: "push", samples: [
        { position: { x: .5, y: .5 }, ...(delta ? { delta } : {}), radius: .3, strength: 1 },
      ] }],
    });
    const valid = work();
    valid.liquify = push({ x: .1, y: -.2 });
    expect(isStoredDesignerTask({ kind: "deformation", view: "pin", spec: valid })).toBe(true);
    const radial = work();
    radial.liquify = { strokes: [{ id: "stroke-1", mode: "bloat", samples: [
      { position: { x: .5, y: .5 }, radius: .3, strength: 1 },
    ] }] };
    expect(isStoredDesignerTask({ kind: "deformation", view: "pin", spec: radial })).toBe(true);
    const rejects: [string, () => DeformationWorkSpecInput][] = [
      ["push without delta", () => { const value = work(); value.liquify = push(); return value; }],
      ["delta outside push mode", () => {
        const value = work();
        const strokes = push({ x: .1, y: 0 }).strokes!;
        strokes[0]!.mode = "twirl";
        value.liquify = { strokes };
        return value;
      }],
      ["delta beyond bounds", () => { const value = work(); value.liquify = push({ x: 2, y: 0 }); return value; }],
      ["position beyond bounds", () => {
        const value = work();
        const strokes = push({ x: 0, y: 0 }).strokes!;
        strokes[0]!.samples[0]!.position = { x: 1.2, y: .5 };
        value.liquify = { strokes };
        return value;
      }],
      ["duplicate stroke ids", () => {
        const value = work();
        const strokes = push({ x: 0, y: 0 }).strokes!;
        strokes.push(structuredClone(strokes[0]!));
        value.liquify = { strokes };
        return value;
      }],
      ["too many strokes", () => {
        const value = work();
        const strokes = push({ x: 0, y: 0 }).strokes!;
        for (let index = 0; index < 64; index += 1) {
          strokes.push({ ...structuredClone(strokes[0]!), id: `s-${index}` });
        }
        value.liquify = { strokes };
        return value;
      }],
    ];
    for (const [label, build] of rejects) {
      const value = build();
      expect(isStoredDesignerTask({ kind: "deformation", view: "pin", spec: value }), label).toBe(false);
    }
  });

  it("accepts only a revision-bound Agent draft for an ordered Figma Spatial task", () => {
    const task = effectTask();
    const draft = {
      schema: "worldbend.figma.effect-draft",
      version: "0.1",
      baseRevision: 3,
      fingerprint: `sha256:${"a".repeat(64)}`,
      task,
    };
    expect(parseStoredEffectDraft(JSON.stringify(draft))).toEqual(draft);
    expect(parseStoredEffectDraft(JSON.stringify({ ...draft, baseRevision: 0 }))).toBeUndefined();
    expect(parseStoredEffectDraft(JSON.stringify({ ...draft, fingerprint: "sha256:bad" }))).toBeUndefined();
    const wrong = structuredClone(task);
    wrong.recipe.layers[0]!.id = "foreground";
    expect(isStoredDesignerTask(wrong)).toBe(false);
    const reordered = structuredClone(task);
    [reordered.recipe.layers[0], reordered.recipe.layers[2]] = [reordered.recipe.layers[2]!, reordered.recipe.layers[0]!];
    expect(isStoredDesignerTask(reordered)).toBe(false);
    const emptyAppearance = structuredClone(task);
    emptyAppearance.recipe.appearance = {} as typeof emptyAppearance.recipe.appearance;
    expect(isStoredDesignerTask(emptyAppearance)).toBe(false);
    const clearAppearance = structuredClone(task);
    Reflect.deleteProperty(clearAppearance.recipe, "appearance");
    expect(parseStoredDesignerTask(JSON.stringify(clearAppearance))).toEqual(clearAppearance);
    const five = structuredClone(task) as FigmaSpatialEffectTask;
    five.recipe.origin = null;
    five.recipe.layers = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(task.recipe.layers[0]!),
      id: `layer-${index + 1}`,
      surface: { ...structuredClone(task.recipe.layers[0]!.surface), distance: 1800 - index * 250 },
    })) as FigmaSpatialEffectTask["recipe"]["layers"];
    expect(parseStoredDesignerTask(JSON.stringify(five))).toEqual(five);
  });

  it("turns the current selected layout into ordered explicit Mockup planes", () => {
    const spec = defaultMockup([source("one", 10), source("two", 130)]);
    expect(spec.canvas).toEqual({ width: 220, height: 80 });
    expect(spec.planes.map((plane) => [plane.id, plane.sourceId])).toEqual([
      ["plane-1", "source-1"],
      ["plane-2", "source-2"],
    ]);
    expect(spec.planes[0]!.transform.destination.quad.tl).toEqual({ x: 0, y: 0 });
    expect(spec.planes[1]!.transform.destination.quad.br).toEqual({ x: 1, y: 1 });
  });

  it("accepts a bounded designer publication and rejects duplicate source IDs", () => {
    const task = { kind: "mesh" as const, spec: createMeshSpec(100, 80, 2) };
    const message = {
      type: "apply-designer",
      payload: {
        generation: 1,
        task,
        sourceNodeIds: ["source"],
        bytes: new Uint8Array([1]),
        renderWidth: 100,
        renderHeight: 80,
        placement: { x: 0, y: 0, width: 100, height: 80 },
      },
    };
    expect(isUiToMainMessage(message)).toBe(true);
    expect(isUiToMainMessage({ ...message, payload: { ...message.payload, sourceNodeIds: ["source", "source"] } })).toBe(false);
  });

  it("accepts a bounded multi-source Spatial publication in explicit layer order", () => {
    const message = {
      type: "apply-designer",
      payload: {
        generation: 4,
        task: effectTask(),
        sourceNodeIds: ["background-node", "middle-node", "foreground-node"],
        bytes: new Uint8Array([1, 2, 3]),
        renderWidth: 600,
        renderHeight: 400,
        placement: { x: 10, y: 20, width: 600, height: 400 },
      },
    };
    expect(isUiToMainMessage(message)).toBe(true);
    const five = effectTask() as FigmaSpatialEffectTask;
    five.recipe.origin = null;
    five.recipe.layers = Array.from({ length: 5 }, (_, index) => ({
      ...structuredClone(five.recipe.layers[0]!), id: `layer-${index + 1}`,
      surface: { ...structuredClone(five.recipe.layers[0]!.surface), distance: 1800 - index * 250 },
    })) as FigmaSpatialEffectTask["recipe"]["layers"];
    expect(isUiToMainMessage({
      ...message,
      payload: { ...message.payload, task: five, sourceNodeIds: Array.from({ length: 5 }, (_, index) => `node-${index + 1}`) },
    })).toBe(true);
  });
});
