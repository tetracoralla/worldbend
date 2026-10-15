import { describe, expect, it } from "vitest";
import {
  canvasPrimaryActionLabel,
  canvasResultPlacements,
  draftFromStoredCanvasSet,
  specFromDraft,
  variantTabTargetIndex,
} from "./canvas-workspace";
import { createCanvasDraft } from "./canvas-state";
import { draftFromStoredCanvas } from "./canvas-workspace-support";
import { readCanvasOutputId } from "./stored-canvas";

const actionCopy = {
  apply: "Apply as image",
  applyVariants: "Apply variants",
  applying: "Applying…",
  replace: "Replace image",
};

describe("Canvas primary action copy", () => {
  it("reopens a named delivered size and ignores invalid carrier names", () => {
    const operation = { kind: "cover" as const, output: { width: 1080, height: 1080 },
      anchor: { x: .5, y: .5 }, background: { kind: "transparent" as const } };
    const id = readCanvasOutputId({ getSharedPluginData: () => "scene-square" });
    const draft = draftFromStoredCanvas(operation, 1200, 900, id);
    expect(draft.activeId).toBe("scene-square");
    expect(specFromDraft(draft).variants).toEqual([{ id: "scene-square", operation }]);
    for (const name of ["", "bad name", "a".repeat(65), "../scene"]) {
      expect(readCanvasOutputId({ getSharedPluginData: () => name })).toBeUndefined();
      expect(draftFromStoredCanvas(operation, 1200, 900, name).activeId).toBe("output-1");
    }
  });

  it("names multi-output publication truthfully while preserving single replacement", () => {
    expect(
      canvasPrimaryActionLabel(actionCopy, {
        phase: "ready",
        replacing: false,
        variantCount: 1,
      }),
    ).toBe("Apply as image");
    expect(
      canvasPrimaryActionLabel(actionCopy, {
        phase: "ready",
        replacing: false,
        variantCount: 2,
      }),
    ).toBe("Apply variants");
    expect(
      canvasPrimaryActionLabel(actionCopy, {
        phase: "ready",
        replacing: true,
        variantCount: 1,
      }),
    ).toBe("Replace image");
  });
});

describe("Canvas result placement", () => {
  it("retains each display density when core changes a linked output size", () => {
    expect(canvasResultPlacements({x:10,y:20,width:356,height:209},[{width:710,height:418}],true,
      {width:712,height:418})).toEqual([{x:10,y:20,width:355,height:209}]);
  });
  it("keeps replacement x/y while adopting the new output dimensions", () => {
    expect(
      canvasResultPlacements(
        { x: 10, y: 20, width: 1080, height: 1080 },
        [{ width: 1200, height: 628 }],
        true,
      ),
    ).toEqual([{ x: 10, y: 20, width: 1200, height: 628 }]);
  });

  it("places ordered new variants beside the source without overlap", () => {
    expect(
      canvasResultPlacements(
        { x: 10, y: 20, width: 100, height: 80 },
        [
          { width: 1200, height: 628 },
          { width: 1080, height: 1080 },
        ],
        false,
      ),
    ).toEqual([
      { x: 158, y: 20, width: 1200, height: 628 },
      { x: 1406, y: 20, width: 1080, height: 1080 },
    ]);
  });
});

describe("Canvas variant tab keyboard navigation", () => {
  it("wraps arrows and supports Home/End", () => {
    expect(variantTabTargetIndex("ArrowRight", 2, 3)).toBe(0);
    expect(variantTabTargetIndex("ArrowLeft", 0, 3)).toBe(2);
    expect(variantTabTargetIndex("Home", 2, 3)).toBe(0);
    expect(variantTabTargetIndex("End", 0, 3)).toBe(2);
    expect(variantTabTargetIndex("Enter", 1, 3)).toBeUndefined();
  });
});

describe("Canvas operation projection", () => {
  it("keeps Crop, Trim, Pad, and Stretch semantically distinct", () => {
    const base = createCanvasDraft(100, 80);
    const variant = base.variants[0]!;
    const operations = [
      { ...variant, kind: "crop" as const, crop: { x: 3, y: 4, width: 50, height: 40 } },
      { ...variant, kind: "trim" as const, trimThreshold: 12 },
      { ...variant, kind: "pad" as const, insets: { top: 1, right: 2, bottom: 3, left: 4 } },
      { ...variant, kind: "stretch" as const, width: 64, height: 32 },
    ];
    expect(operations.map((candidate) => specFromDraft({ ...base, variants: [candidate] }).variants[0]!.operation)).toEqual([
      { kind: "crop", rect: { x: 3, y: 4, width: 50, height: 40 } },
      { kind: "trim", alphaThreshold: 12 },
      { kind: "pad", insets: { top: 1, right: 2, bottom: 3, left: 4 }, background: { kind: "transparent" } },
      { kind: "stretch", output: { width: 64, height: 32 } },
    ]);
  });

  it("restores every named Sizes template variant into an editable draft", () => {
    const spec = {
      schema: "worldbend.canvas-set" as const,
      version: "0.1" as const,
      variants: [
        {
          id: "wide",
          operation: {
            kind: "stretch" as const,
            output: { width: 1200, height: 628 },
          },
        },
        {
          id: "square",
          operation: {
            kind: "contain" as const,
            output: { width: 1080, height: 1080 },
            anchor: { x: 0.5, y: 0.5 },
            background: { kind: "transparent" as const },
          },
        },
      ],
    };
    const draft = draftFromStoredCanvasSet(spec, 800, 600);

    expect(draft.activeId).toBe("wide");
    expect(draft.variants.map((variant) => variant.id)).toEqual(["wide", "square"]);
    expect(specFromDraft(draft)).toEqual(spec);
  });
});
