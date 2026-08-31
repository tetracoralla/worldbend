import { describe, expect, it } from "vitest";
import {
  addCanvasVariant,
  createCanvasDraft,
  MAX_FIGMA_CANVAS_PIXELS,
  removeCanvasVariant,
  renameCanvasVariant,
  selectCanvasVariant,
  updateCanvasVariant,
  validateCanvasDraft,
} from "./canvas-state";

describe("Canvas draft", () => {
  it("keeps one selected preview while adding and removing ordered variants", () => {
    const first = createCanvasDraft(1200, 628);
    const second = addCanvasVariant(first);
    expect(second.variants.map((variant) => variant.id)).toEqual(["output-1", "output-2"]);
    expect(second.activeId).toBe("output-2");
    const selected = selectCanvasVariant(second, "output-1");
    expect(selected.activeId).toBe("output-1");
    const removed = removeCanvasVariant(selected, "output-1");
    expect(removed.variants.map((variant) => variant.id)).toEqual(["output-2"]);
    expect(removed.activeId).toBe("output-2");
    expect(removeCanvasVariant(removed, "output-2")).toBe(removed);
  });

  it("validates axes, IDs, color components, and the 32 Mi-pixel set ceiling", () => {
    const draft = createCanvasDraft(4096, 4096);
    const two = addCanvasVariant(draft);
    expect(validateCanvasDraft(two)).toBeUndefined();
    const tooManyPixels = addCanvasVariant(two);
    expect(tooManyPixels.variants).toHaveLength(3);
    expect(tooManyPixels.variants.reduce((sum, variant) => sum + variant.width * variant.height, 0))
      .toBeGreaterThan(MAX_FIGMA_CANVAS_PIXELS);
    expect(validateCanvasDraft(tooManyPixels)).toBe("pixel-limit");
    expect(validateCanvasDraft(updateCanvasVariant(draft, "output-1", { width: 4097 }))).toBe(
      "axis-limit",
    );
    expect(
      validateCanvasDraft({
        ...draft,
        variants: [{ ...draft.variants[0]!, id: "bad id" }],
        activeId: "bad id",
      }),
    ).toBe("variant-id");
  });

  it("clones nested anchor and background values before editing", () => {
    const base = updateCanvasVariant(createCanvasDraft(100, 100), "output-1", {
      anchor: { x: 0, y: 1 },
      background: { kind: "color", space: "srgb8", rgba: [1, 2, 3, 255] },
    });
    const next = addCanvasVariant(base);
    next.variants[1]!.anchor.x = 1;
    expect(base.variants[0]!.anchor.x).toBe(0);
  });

  it("validates Crop, Trim, Pad, Contain, Cover, and Stretch together", () => {
    let draft = createCanvasDraft(100, 80);
    const kinds = ["crop", "trim", "pad", "contain", "cover", "stretch"] as const;
    for (let index = 1; index < kinds.length; index += 1) draft = addCanvasVariant(draft);
    draft = {
      ...draft,
      variants: draft.variants.map((variant, index) => ({
        ...variant,
        id: kinds[index]!,
        kind: kinds[index]!,
        crop: { x: 10, y: 5, width: 40, height: 30 },
        insets: { top: 1, right: 2, bottom: 3, left: 4 },
        width: 60,
        height: 50,
      })),
      activeId: "crop",
    };
    expect(validateCanvasDraft(draft)).toBeUndefined();
  });

  it("renames an output without allowing invalid or colliding identities", () => {
    const draft = addCanvasVariant(createCanvasDraft(100, 80));
    const renamed = renameCanvasVariant(draft, "output-2", "square");
    expect(renamed.activeId).toBe("square");
    expect(renamed.variants.map((variant) => variant.id)).toEqual(["output-1", "square"]);
    expect(renameCanvasVariant(renamed, "square", "bad name")).toBe(renamed);
    expect(renameCanvasVariant(renamed, "square", "output-1")).toBe(renamed);
  });
});
