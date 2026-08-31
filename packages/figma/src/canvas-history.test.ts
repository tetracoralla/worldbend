import { describe, expect, it } from "vitest";
import { createCanvasHistory } from "./canvas-history";
import { createCanvasDraft, updateCanvasVariant } from "./canvas-state";

describe("Canvas history", () => {
  it("is independent, immutable, and truncates redo after a new edit", () => {
    const baseline = createCanvasDraft(100, 100);
    const history = createCanvasHistory(baseline);
    history.push(updateCanvasVariant(baseline, "output-1", { width: 200 }));
    const undone = history.undo();
    expect(undone?.variants[0]?.width).toBe(100);
    undone!.variants[0]!.width = 999;
    expect(history.current().variants[0]?.width).toBe(100);
    history.push(updateCanvasVariant(baseline, "output-1", { height: 300 }));
    expect(history.canRedo()).toBe(false);
  });
});
