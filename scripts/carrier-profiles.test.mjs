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
    "mode-distort",
    "mode-warp",
    "mode-rectify",
  ]);
  assert.deepEqual(profiles.carriers.figma.workspace.siblingWorkspaceIds, [
    "templates", "canvas", "mockup", "mesh", "remap",
  ]);
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("canvas-multi-output"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("canvas-multi-output"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("place-mockup"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("mesh-warp"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("lens-displacement-remap"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("timeline-motion"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("single-raster-program"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("spatial-template"));
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("variation-job"));
  assert(
    profiles.carriers.agent.surfaceFeatureIds.includes("cubic-surface-deformation"),
  );
  assert(profiles.carriers.agent.surfaceFeatureIds.includes("eased-motion"));
  assert(
    profiles.carriers.agent.surfaceFeatureIds.includes("psd-smart-object-interop"),
  );
  assert(profiles.carriers.comfyui.surfaceFeatureIds.includes("canvas-multi-output"));
  assert.equal(profiles.carriers.agent.package.defaultToolSurface, "catalog");
  assert.equal(profiles.carriers.agent.package.maxToolCatalogBytes, 16 * 1024);
  assert.equal(profiles.carriers.agent.package.maxDirectToolCatalogBytes, 80 * 1024);
  assert(!profiles.carriers.figma.surfaceFeatureIds.includes("css-embedding"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("css-embedding"));
  assert.deepEqual(profiles.carriers.comfyui.package.nativeCargoFeatures, ["comfy"]);
  assert.deepEqual(profiles.carriers.agent.package.nativeCargoFeatures, ["full"]);
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("place-mockup"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("place-mockup"));
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("mesh-warp"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("mesh-warp"));
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("lens-displacement-remap"));
  assert(profiles.carriers.comfyui.surfaceFeatureIds.includes("lens-displacement-remap"));
  assert(!profiles.carriers.figma.surfaceFeatureIds.includes("timeline-motion"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("timeline-motion"));
  assert(!profiles.carriers.figma.surfaceFeatureIds.includes("single-raster-program"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("single-raster-program"));
  assert(profiles.carriers.figma.surfaceFeatureIds.includes("spatial-template"));
  assert(!profiles.carriers.figma.surfaceFeatureIds.includes("variation-job"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("spatial-template"));
  assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes("variation-job"));
  for (const feature of [
    "cubic-surface-deformation",
    "eased-motion",
    "psd-smart-object-interop",
  ]) {
    assert(!profiles.carriers.figma.surfaceFeatureIds.includes(feature));
    assert(!profiles.carriers.comfyui.surfaceFeatureIds.includes(feature));
  }
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
