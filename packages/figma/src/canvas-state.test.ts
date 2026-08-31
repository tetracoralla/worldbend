import { describe, expect, it } from "vitest";
import {
  addCanvasVariant,
  createCanvasDraft,
  MAX_FIGMA_CANVAS_PIXELS,
  removeCanvasVariant,
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
});
