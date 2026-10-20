import { createSurfaceSpec } from "./surface-workspace";
import { deformationWorkFromSurface } from "./deformation-work-state";
import { isUiToMainMessage } from "./messages";
import { templateLibrarySummary } from "./template-library-summary";
import { describe, expect, it } from "vitest";
import { defaultMockup } from "./mockup-workspace";
import { continuedCompositionTask } from "./stored-designer-task";
import {
  canvasTemplateFromSet,
  deformationTemplateFromWork,
  deformationTemplateWorkForSource,
  checkedTemplateLibrary,
  isFigmaTaskTemplate,
  parseTemplateLibrary,
  spatialTemplateFromMockup,
  spatialTemplateFromCompositionTask,
  templateAppearance,
  templateOutputCount,
  templateSlotsFromSources,
  templateSourceCount,
  utf8ByteLength,
} from "./stored-template-library";

function source(index: number) {
  return {
    sourceNodeId: `node-${index}`,
    sourceName: `Source ${index}`,
    renderWidth: 100,
    renderHeight: 80,
    placement: { x: (index - 1) * 100, y: 0, width: 100, height: 80 },
    image: {} as HTMLImageElement,
  };
}

describe("Figma Spatial Template storage", () => {
  it("round-trips an entire fitted, painted work and rebinds only its output size", () => {
    const work = deformationWorkFromSurface(createSurfaceSpec(120, 90));
    work.meshEdits = [{column:3,row:3,warped:{x:.23,y:.24}}];
    work.liquify = {strokes:[{id:"push",mode:"push",samples:[{
      position:{x:.5,y:.5},delta:{x:.01,y:0},radius:.2,strength:.3,
    }]}]};
    const contour = {start:{x:0,y:0},segments:[
      {kind:"line" as const,to:{x:1,y:0}},
      {kind:"cubic" as const,c1:{x:.8,y:.3},c2:{x:.8,y:.7},to:{x:1,y:1}},
      {kind:"line" as const,to:{x:0,y:1}},
    ]};
    work.shapeFit = {contour,cornerPositions:[0,.25,.5,.75],refinement:2,
      clip:{contours:[contour,{start:{x:.2,y:.2},segments:[
        {kind:"line",to:{x:.4,y:.2}},{kind:"line",to:{x:.3,y:.4}},
      ]}],fillRule:"evenOdd",regions:[{contourIndices:[0,1],fillRule:"evenOdd"}]}};
    const original = structuredClone(work);
    for (const view of ["mesh","pin"] as const) {
      const template = deformationTemplateFromWork(work,view);
      expect(isFigmaTaskTemplate({...template,outputNames:{output:"无关尺寸名称"}})).toBe(false);
      const library = checkedTemplateLibrary([{id:"fit",name:"Fitted artwork",template,
        slots:[{name:"Artwork",width:120,height:90}],appearance:templateAppearance(template)}]);
      expect(library).toBeDefined();
      expect(parseTemplateLibrary(JSON.parse(JSON.stringify(library)))).toEqual(library);
      expect(templateLibrarySummary(library)?.[0]).toMatchObject({kind:"deformation",sourceCount:1});
      expect(templateAppearance(template).supported).toContain("clip");
      const message = {type:"save-template",workspace:view === "pin" ? "surface" : "mesh",requestId:1,name:"Fitted artwork",template};
      expect(isUiToMainMessage(message)).toBe(true);
      expect(isUiToMainMessage({...message,workspace:"canvas"})).toBe(false);
      expect(isUiToMainMessage({...message,template:{...template,operation:{...template.operation,view:"unknown"}}})).toBe(false);
      expect(isFigmaTaskTemplate({...template,operation:{...template.operation,generatedMesh:{}}})).toBe(false);
      const replacement = deformationTemplateWorkForSource(template.operation.spec,{renderWidth:300,renderHeight:100});
      expect(replacement).toEqual({...original,targetSize:{width:300,height:100}});
      replacement.shapeFit!.contour.start.x=.1;
      expect(work).toEqual(original);
      expect(template.operation.spec).toEqual(original);
    }
  });

  it("round-trips a bounded canonical Mockup template", () => {
    const template = spatialTemplateFromMockup(defaultMockup([source(1), source(2)]));
    const library = checkedTemplateLibrary([{ id: "template-1", name: "Two up", template }]);
    expect(library).toBeDefined();
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
    expect(templateSourceCount(template)).toBe(2);
  });

  it("stores slot descriptors beside the template and rejects malformed ones", () => {
    const template = spatialTemplateFromMockup(defaultMockup([source(1), source(2)]));
    const slots = templateSlotsFromSources([source(1), source(2)]);
    expect(slots).toEqual([
      { name: "Source 1", width: 100, height: 80 },
      { name: "Source 2", width: 100, height: 80 },
    ]);
    const library = slots
      ? checkedTemplateLibrary([{ id: "template-1", name: "Two up", template, slots }])
      : undefined;
    expect(library).toBeDefined();
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
    // A slot without a name, out-of-range dimensions, or an empty list is rejected.
    expect(checkedTemplateLibrary([{ id: "t", name: "Bad", template,
      slots: [{ name: "", width: 10, height: 10 }] }])).toBeUndefined();
    expect(checkedTemplateLibrary([{ id: "t", name: "Bad", template,
      slots: [{ name: "A", width: 0, height: 10 }] }])).toBeUndefined();
    expect(checkedTemplateLibrary([{ id: "t", name: "Bad", template, slots: [] }])).toBeUndefined();
    // Slot capture follows the live sources: too few or too many stays absent.
    expect(templateSlotsFromSources([])).toBeUndefined();
    expect(templateSlotsFromSources(Array.from({ length: 9 }, (_, i) => source(i + 1)))).toBeUndefined();
  });

  it("bounds long Unicode source names without splitting a surrogate or rejecting valid slots", () => {
    const slots = templateSlotsFromSources([{ sourceName: "A" + "🧑".repeat(100), renderWidth: 100, renderHeight: 80 }]);
    expect(slots?.[0]?.name).toBe("A" + "🧑".repeat(63));
    expect(templateSlotsFromSources([{ sourceName: "", renderWidth: 100, renderHeight: 80 }])?.[0]?.name).toBe("Artwork");
  });

  it("derives a truthful appearance boundary and rejects hand-declared drift", () => {
    const mockup = spatialTemplateFromMockup(defaultMockup([source(1)]));
    expect(templateAppearance(mockup)).toEqual({
      supported: ["perspective", "opacity"],
      unsupported: ["clip", "masking", "occlusion", "lighting"],
    });
    const mockupSpec = mockup.operation.kind === "mockup" ? mockup.operation.spec : defaultMockup([source(1)]);
    const clipped = spatialTemplateFromMockup({
      ...mockupSpec,
      clip: { contours: [{ start: { x: 0, y: 0 }, segments: [
        { kind: "line", to: { x: 1, y: 0 } },
        { kind: "line", to: { x: 1, y: 1 } },
        { kind: "line", to: { x: 0, y: 1 } },
      ] }], fillRule: "nonZero" },
    });
    expect(templateAppearance(clipped).supported).toContain("clip");
    const composition = spatialTemplateFromCompositionTask(continuedCompositionTask(mockupSpec));
    expect(templateAppearance(composition).supported).toEqual(["perspective", "opacity"]);
    // The boundary is exhaustive and disjoint, so partial or duplicated
    // hand-edits fail the library check.
    expect(checkedTemplateLibrary([{ id: "t", name: "Partial", template: mockup,
      appearance: { supported: ["perspective"], unsupported: [] } }])).toBeUndefined();
    expect(checkedTemplateLibrary([{ id: "t", name: "Duplicated", template: mockup,
      appearance: { supported: ["perspective", "opacity"], unsupported: ["perspective", "clip", "masking", "occlusion", "lighting"] } }]))
      .toBeUndefined();
    expect(checkedTemplateLibrary([{ id: "t", name: "Invented lighting", template: mockup,
      appearance: { supported: ["perspective", "opacity", "lighting"], unsupported: ["clip", "masking", "occlusion"] } }]))
      .toBeUndefined();
    // A derived boundary round-trips through the library.
    const appearance = templateAppearance(mockup);
    const library = checkedTemplateLibrary([{ id: "ok", name: "Scene", template: mockup, appearance }]);
    expect(library).toBeDefined();
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
  });

  it("refreshes older cached appearance without discarding a saved curved scene", () => {
    const spec = defaultMockup([source(1), source(2)]);
    spec.planes[0]!.surface = { kind: "fabric", folds: 3, depth: .42 };
    const template = spatialTemplateFromCompositionTask(continuedCompositionTask(spec));
    const old = { schema: "worldbend.figma-template-library", version: "0.1", templates: [{ id: "cloth", name: "Cloth", template,
      appearance: { supported: ["perspective", "opacity"], unsupported: ["clip", "masking", "occlusion", "lighting"] } }] };
    const library = parseTemplateLibrary(old);
    expect(library?.templates[0]?.appearance?.supported).toEqual(["perspective", "opacity", "lighting"]);
    expect(old.templates[0]!.appearance.unsupported).toContain("lighting");
    spec.planes[0]!.surface.depth = 0;
    expect(templateAppearance(spatialTemplateFromMockup(spec)).supported).not.toContain("lighting");
  });

  it("round-trips a combine-then-transform template with every output variant", () => {
    const task = continuedCompositionTask(defaultMockup([source(1), source(2), source(3), source(4), source(5)]));
    if (task.kind !== "composition") throw new Error("expected composition task");
    const stage = task.template.operation.postprocess.stages[0]!;
    if (stage.kind !== "transform") throw new Error("expected transform stage");
    stage.spec.content!.warp = { preset: "inflate", amount: .35 };
    task.template.output = { kind: "canvasSet", spec: {
      schema: "worldbend.canvas-set", version: "0.1", variants: [
        { id: "wide", operation: { kind: "stretch", output: { width: 1200, height: 628 } } },
        { id: "square", operation: { kind: "cover", output: { width: 1080, height: 1080 }, anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } },
      ],
    } };
    task.previewOutputId = "wide";
    const template = spatialTemplateFromCompositionTask(task);
    const library = checkedTemplateLibrary([{ id: "continued", name: "Five source campaign", template }]);
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
    expect(templateSourceCount(template)).toBe(5);
    expect(template.operation.kind).toBe("compositionProgram");
  });

  it("round-trips a canonical Sizes task template beside Mockup templates", () => {
    const template = canvasTemplateFromSet({
      schema: "worldbend.canvas-set",
      version: "0.1",
      variants: [
        {
          id: "social-square",
          operation: {
            kind: "contain",
            output: { width: 1080, height: 1080 },
            anchor: { x: 0.5, y: 0.5 },
            background: { kind: "transparent" },
          },
        },
        {
          id: "wide",
          operation: { kind: "stretch", output: { width: 1200, height: 628 } },
        },
      ],
    });
    const library = checkedTemplateLibrary([{ id: "template-size", name: "Social", template }]);

    expect(isFigmaTaskTemplate(template)).toBe(true);
    expect(templateSourceCount(template)).toBe(1);
    expect(templateOutputCount(template)).toBe(2);
    expect(templateOutputCount(spatialTemplateFromMockup(defaultMockup([source(1)])))).toBeUndefined();
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
  });

  it("rejects noncanonical source slots and duplicate record ids", () => {
    const template = spatialTemplateFromMockup(defaultMockup([source(1)]));
    if (template.operation.kind !== "mockup") throw new Error("expected mockup template");
    template.operation.spec.planes[0]!.sourceId = "hero";
    expect(checkedTemplateLibrary([{ id: "template-1", name: "Hero", template }])).toBeUndefined();

    const valid = spatialTemplateFromMockup(defaultMockup([source(1)]));
    expect(checkedTemplateLibrary([
      { id: "duplicate", name: "One", template: valid },
      { id: "duplicate", name: "Two", template: valid },
    ])).toBeUndefined();
  });

  it("counts the persisted JSON ceiling in UTF-8 bytes", () => {
    expect(utf8ByteLength("plain")).toBe(5);
    expect(utf8ByteLength("图")).toBe(3);
    expect(utf8ByteLength("🧭")).toBe(4);
  });
});
