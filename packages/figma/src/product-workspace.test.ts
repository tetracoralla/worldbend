import { describe, expect, it, vi } from "vitest";
import {
  createProductWorkspaceRouter,
  PRODUCT_WORKSPACE_FAMILIES,
  productWorkspaceFamily,
  type ProductWorkspace,
} from "./product-workspace";

describe("product workspace routing", () => {
  it("enters Canvas as a replacing child and returns without touching the parent draft", () => {
    const perspectiveDraft = { mode: "distort", quad: { tl: { x: -0.2, y: 0.1 } } };
    const snapshot = structuredClone(perspectiveDraft);
    const onChange = vi.fn();
    const router = createProductWorkspaceRouter({ onChange });

    expect(router.current()).toBe("perspective");
    expect(router.enter("canvas")).toBe(true);
    expect(router.enter("canvas")).toBe(false);
    expect(router.current()).toBe("canvas");
    expect(router.enter("mesh")).toBe(true);
    expect(router.current()).toBe("mesh");
    expect(router.returnToPerspective()).toBe(true);
    expect(router.returnToPerspective()).toBe(false);
    expect(router.current()).toBe("perspective");
    expect(perspectiveDraft).toEqual(snapshot);
    expect(onChange).toHaveBeenNthCalledWith(1, "perspective", "canvas");
    expect(onChange).toHaveBeenNthCalledWith(2, "canvas", "mesh");
    expect(onChange).toHaveBeenNthCalledWith(3, "mesh", "perspective");
  });
});

describe("product workspace families", () => {
  it("places every workspace once in a durable user-intent family", () => {
    const expected: ProductWorkspace[] = [
      "perspective", "canvas", "spatial", "mockup", "mesh", "surface",
      "remap", "appearance", "card", "presets", "templates",
    ];
    const grouped = Object.values(PRODUCT_WORKSPACE_FAMILIES).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...expected].sort());
  });

  it("keeps editing, composition, finishing and reusable starts distinct", () => {
    expect(productWorkspaceFamily("perspective")).toBe("shape");
    expect(productWorkspaceFamily("surface")).toBe("shape");
    expect(productWorkspaceFamily("mockup")).toBe("compose");
    expect(productWorkspaceFamily("appearance")).toBe("finish");
    expect(productWorkspaceFamily("templates")).toBe("library");
  });
});
