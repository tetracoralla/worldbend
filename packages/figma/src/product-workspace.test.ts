import { describe, expect, it, vi } from "vitest";
import { createProductWorkspaceRouter } from "./product-workspace";

describe("product workspace routing", () => {
  it("enters Canvas as a replacing child and returns without touching the parent draft", () => {
    const perspectiveDraft = { mode: "distort", quad: { tl: { x: -0.2, y: 0.1 } } };
    const snapshot = structuredClone(perspectiveDraft);
    const onEnterCanvas = vi.fn();
    const onReturnToPerspective = vi.fn();
    const router = createProductWorkspaceRouter({ onEnterCanvas, onReturnToPerspective });

    expect(router.current()).toBe("perspective");
    expect(router.enterCanvas()).toBe(true);
    expect(router.enterCanvas()).toBe(false);
    expect(router.current()).toBe("canvas");
    expect(router.returnToPerspective()).toBe(true);
    expect(router.returnToPerspective()).toBe(false);
    expect(router.current()).toBe("perspective");
    expect(perspectiveDraft).toEqual(snapshot);
    expect(onEnterCanvas).toHaveBeenCalledTimes(1);
    expect(onReturnToPerspective).toHaveBeenCalledTimes(1);
  });
});
