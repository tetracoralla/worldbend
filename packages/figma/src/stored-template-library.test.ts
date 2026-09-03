import { describe, expect, it } from "vitest";
import { defaultMockup } from "./mockup-workspace";
import {
  canvasTemplateFromSet,
  checkedTemplateLibrary,
  isFigmaTaskTemplate,
  parseTemplateLibrary,
  spatialTemplateFromMockup,
  templateOutputCount,
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
  it("round-trips a bounded canonical Mockup template", () => {
    const template = spatialTemplateFromMockup(defaultMockup([source(1), source(2)]));
    const library = checkedTemplateLibrary([{ id: "template-1", name: "Two up", template }]);
    expect(library).toBeDefined();
    expect(parseTemplateLibrary(structuredClone(library))).toEqual(library);
    expect(templateSourceCount(template)).toBe(2);
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
