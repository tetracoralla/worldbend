import { describe, expect, it } from "vitest";
import type { UserConfig } from "vite";
import { figmaBuildConfig } from "../vite.config";

describe("Figma build entrypoint continuity", () => {
  it.each(["ui", "main"])("does not erase the live sibling entrypoint in a %s build", (target) => {
    const config = figmaBuildConfig(target) as UserConfig;
    expect(config.build?.emptyOutDir).toBe(false);
    expect(config.build?.outDir).toMatch(/packages\/figma\/dist$/);
  });
});
