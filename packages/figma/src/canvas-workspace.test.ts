import { describe, expect, it } from "vitest";
import {
  canvasPrimaryActionLabel,
  canvasResultPlacements,
  specFromDraft,
  variantTabTargetIndex,
} from "./canvas-workspace";
import { createCanvasDraft } from "./canvas-state";

const actionCopy = {
  apply: "Apply as image",
  applyVariants: "Apply variants",
  applying: "Applying…",
  replace: "Replace image",
};

describe("Canvas primary action copy", () => {
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
});
