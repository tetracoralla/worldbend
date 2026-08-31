import assert from "node:assert/strict";
import test from "node:test";

import {
  assertByteBudget,
  assertCarrierIsolation,
  loadCarrierProfiles,
} from "./carrier-profiles.mjs";

test("current carrier profiles are closed and reference existing features", async () => {
  const profiles = await loadCarrierProfiles();
  assert.deepEqual(profiles.carriers.figma.workspace.modeControlIds, [
    "mode-transform",
    "distort-free",
    "distort-perspective",
    "mode-warp",
    "mode-rectify",
    "more-options",
  ]);
  assert.deepEqual(profiles.carriers.figma.workspace.siblingWorkspaceIds, ["canvas"]);
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("canvas-multi-output"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("canvas-multi-output"));
  assert(profiles.carriers.comfyui.surfaceFeatureIds.includes("canvas-multi-output"));
  assert.equal(profiles.carriers.agent.package.maxToolCatalogBytes, 80 * 1024);
  assert(!profiles.carriers.figma.surfaceFeatureIds.includes("css-embedding"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("css-embedding"));
  assert.deepEqual(profiles.carriers.comfyui.package.nativeCargoFeatures, ["comfy"]);
});

test("byte budgets reject only values above the declared maximum", () => {
  assert.doesNotThrow(() => assertByteBudget(10, 10, "fixture"));
  assert.throws(
    () => assertByteBudget(11, 10, "fixture"),
    /fixture is 11 bytes; budget is 10 bytes/,
  );
});

test("carrier isolation catches UI and adapter contamination", async () => {
  const profiles = await loadCarrierProfiles();
  assert.doesNotThrow(() =>
    assertCarrierIsolation(
      ["bin/worldbend", "skills/worldbend/SKILL.md"],
      profiles.carriers.agent.package,
      "Agent package",
    ),
  );
  assert.throws(
    () =>
      assertCarrierIsolation(
        ["bin/worldbend", "ui.html"],
        profiles.carriers.agent.package,
        "Agent package",
      ),
    /forbidden file ui.html/,
  );
  assert.throws(
    () =>
      assertCarrierIsolation(
        ["nodes.py", "dist/main.js"],
        profiles.carriers.comfyui.package,
        "ComfyUI package",
      ),
    /forbidden file dist\/main.js/,
  );
});
