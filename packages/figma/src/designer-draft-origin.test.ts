import { describe, expect, it } from "vitest";
import { DesignerDraftOriginState } from "./designer-draft-origin";

describe("DesignerDraftOriginState", () => {
  it("seeds only an unresolved source", () => {
    const state = new DesignerDraftOriginState();
    state.loadSource(false);
    expect(state.shouldSeedFromPerspective()).toBe(true);
    state.mark("perspective");
    expect(state.shouldSeedFromPerspective()).toBe(false);
  });

  it.each(["template", "user"] as const)(
    "does not overwrite a %s draft merely because its history is empty",
    (origin) => {
      const state = new DesignerDraftOriginState();
      state.loadSource(false);
      state.mark(origin);
      expect(state.shouldSeedFromPerspective()).toBe(false);
    },
  );

  it("keeps stored tasks resolved and reopens seeding for a new blank source", () => {
    const state = new DesignerDraftOriginState();
    state.loadSource(true);
    expect(state.current).toBe("stored-task");
    expect(state.shouldSeedFromPerspective()).toBe(false);
    state.loadSource(false);
    expect(state.shouldSeedFromPerspective()).toBe(true);
  });
});
