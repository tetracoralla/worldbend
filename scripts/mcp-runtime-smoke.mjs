import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { deflateSync, gunzipSync } from "node:zlib";

import { loadCarrierProfiles } from "./carrier-profiles.mjs";

// Inspect the owning SDK call without mistaking its bounded executable
// envelope for a missing method. The actual outer request budget is still
// asserted at each preparation entry below.
function figmaRequestCode(request) {
  const marker = "\nreturn await WorldbendFigmaEmbedded.executeEmbeddedRuntime(";
  const at = request.code.lastIndexOf(marker);
  if (at < 0) return request.code;
  assert(request.code.endsWith(");"));
  const envelope = JSON.parse(request.code.slice(at + marker.length, -2));
  assert.equal(envelope.encoding, "gzip-base64");
  assert.equal(createHash("sha256").update(envelope.data).digest("hex"), envelope.digest);
  const encoded = Buffer.from(envelope.data, "base64");
  assert.equal(encoded.toString("base64"), envelope.data);
  assert(envelope.decodedBytes > 0 && envelope.decodedBytes <= 256 * 1024);
  const decoded = gunzipSync(encoded, { maxOutputLength: 256 * 1024 });
  assert.equal(decoded.length, envelope.decodedBytes);
  assert.deepEqual(Buffer.from(decoded.toString("utf8")), decoded);
  const code = JSON.parse(decoded.toString("utf8"));
  assert.equal(typeof code, "string");
  assert(Buffer.byteLength(code) <= 128 * 1024);
  return code;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const carrierProfiles = await loadCarrierProfiles();
const agentPackageProfile = carrierProfiles.carriers.agent.package;
const maxToolCatalogBytes = agentPackageProfile.maxToolCatalogBytes;
const maxDirectToolCatalogBytes = agentPackageProfile.maxDirectToolCatalogBytes;
const REQUEST_TIMEOUT_MS = 30_000;
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const pluginRootArgument = process.argv.indexOf("--plugin-root");
assert(
  pluginRootArgument === -1 || process.argv[pluginRootArgument + 1],
  "--plugin-root requires a path",
);
const distributionRoot =
  pluginRootArgument === -1
    ? path.join(root, "plugins", "worldbend")
    : path.resolve(process.argv[pluginRootArgument + 1]);
const cli = path.join(distributionRoot, "bin", `worldbend${executableSuffix}`);
const mcp = path.join(
  distributionRoot,
  "bin",
  `worldbend-mcp${executableSuffix}`,
);
let fixtureRoot;
let stagingRoot;
let pixelSpec;
let normalizedSpec;
let rectifySpec;
let canvasSetSpec;
let mockupSpec;
let mockupExtractSpec;
let meshSpec;
let remapSpec;
let timelineSpec;
let rasterProgramSpec;
let spatialTemplateSpec;
let spatialDocumentSpec;
let spatialDocumentAssemblyInput;
let spatialDocumentAssemblyPlan;
let spatialDocumentUpdateSpec;
let spatialDocumentUpdatePlan;
let spatialDocumentDeliverySpec;
let spatialDocumentDeliveryPlan;
let spatialInteractiveMediaBundleInput;
let spatialInteractiveMediaBundle;
let variationJobSpec;
let surfaceSpec;
let motionSpec;
let mcpComposeResult;
let mcpFlippedComposeResult;
let mcpWarpComposeResult;
let mcpClearWarpComposeResult;
let mcpSolveResult;
let mcpInspectResult;
let mcpCssResult;
let mcpDryRunResult;
let mcpPerceptionResult;
const metrics = {};
const SYNTHETIC_SMART_OBJECT_PSD_GZIP_BASE64 =
  "H4sIANEgmGoCA+0VXU/bQMyUqQImGEI87iHStpdpeQCKxGMLazWkbo2a8vGwlzS5tkGXu+hyYcDTHvY39mP2y5jvcilJ1257gDFtseXYZ199Pp/tHhw6LixBBstIgaYVLRtYR936R71ry1Bfk96zVFMW/NbU9+Dw+D3jIrpFFwBrVu5juxNeyVQQy408Ia3e8IL4EvVqP01ZiOIbtQ06EMIVSEhBAAELXIjAQ1mi3IMhXKDWB6l/dx2qaJ8gvVZrh3Zxvfwlpn5X3ebljgF7F8HeQ7AbCPZ+AdQNDG0i1Zq7WcBTPvic8Ua+/rnewKbxieF98kSMfFWRkl15TQlhaVRSqGypxVGaSD41nXo0JQFPhwXXz5TBISKJMYXh5ax5e8bckxMiZvbok/pcejIPBHqCqfeAd+KGIasPecqCBN/Jn95kw6deknQo92Q/ez2Vehjw2DphsvPCuaLFFHTJSM7TH+L9cn3TudP3xxM5R19PeyIggnI2NifWL2c1W77OWptdEspjcoa3K0U+x25saxFJJg4PmcS7tkTp5daFJ0POPKrtqjjyBJ2wDjXX2szjbO6faGi2DXdKBfGg9lMh/XkxLYKpr0W8/Qtuzl7Es752uerH+vOEd9+ah7pLLrCUqlg3lHwcMDlon6sWegU7M2jDrkEb9gza0DBow/4C1MUTU88nwYP4Bmf8ITJFqEtJYkNRxxuTpKBdHQkvIq4k5YrMr69KahVbkGCt8bykFTwNCONRyO7UtXNUrwRpVpX34m1NB3eErS4LIUOLTde6lAbXMTFr3QIDwUantJvoeHCy5LPyB9nMSC03ivrf36O6l3HWGo1CRgbCY8kI/17+4Ol6fpeyXU30aqL/fxMdwL2xrPLYcZi08iyeBXJiHrCps4qPX1z3E5oVAwrN/tTpEtQeF7/dPi5WGagy8Hd0QoX/Jn69rbDC+8fvHP4MiDwSAAA=";

async function main() {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "worldbend-mcp-smoke-"));
  stagingRoot = await mkdtemp(path.join(tmpdir(), "worldbend-mcp-private-stage-"));
  let fixtureValidated = false;
  let client;
  let catalogClient;
  try {
    assertSafeFixtureRoot(fixtureRoot);
    fixtureValidated = true;
    await mkdir(path.join(fixtureRoot, "out"));
    await writeFile(
      path.join(fixtureRoot, "source.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    );
    // A real (tiny) JPEG exercises the non-PNG decode path the Skill promises.
    await writeFile(
      path.join(fixtureRoot, "source.jpg"),
      Buffer.from(
        "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAADKADAAQAAAABAAAACAAAAAD/wAARCAAIAAwDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD748X3Pj631PUb/QZNXOkCV2h+zrchBGFXICj/AG93XGTntXp/w2eW+8OG88Um4a6lnkZDKbpZzDwE80NjDdhj+Hb3zXoA/wCROm+kv/o1qyNM/wCPVfov/oIr5LFYydGoqUNrfqz7XC4KnicJ9YqL3ua2ll09Nz//2Q==",
        "base64",
      ),
    );
    await writeFile(path.join(fixtureRoot, "source16.png"), makePng16WithIcc());
    await writeFile(path.join(fixtureRoot, "perception.png"), makePerceptionPng());
    await writeFile(
      path.join(fixtureRoot, "source.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>',
    );
    await writeFile(
      path.join(fixtureRoot, "smart-object.psd"),
      gunzipSync(Buffer.from(SYNTHETIC_SMART_OBJECT_PSD_GZIP_BASE64, "base64")),
    );

    pixelSpec = makePixelSpec(64, 64);
    normalizedSpec = makeNormalizedSpec();
    rectifySpec = makeRectifySpec(2, 2);
    canvasSetSpec = makeCanvasSetSpec();
    mockupSpec = makeMockupSpec();
    mockupExtractSpec = makeMockupExtractSpec();
    meshSpec = makeMeshSpec();
    remapSpec = makeRemapSpec();
    timelineSpec = makeTimelineSpec();
    rasterProgramSpec = makeRasterProgramSpec();
    spatialTemplateSpec = makeSpatialTemplateSpec();
    variationJobSpec = makeVariationJobSpec();
    surfaceSpec = makeSurfaceSpec();
    motionSpec = makeMotionSpec();
    await writeFile(
      path.join(fixtureRoot, "pixel.projective.json"),
      JSON.stringify(pixelSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "normalized.projective.json"),
      JSON.stringify(normalizedSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "rectify.projective.json"),
      JSON.stringify(rectifySpec),
    );
    await writeFile(
      path.join(fixtureRoot, "raster-program.json"),
      JSON.stringify(rasterProgramSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "spatial-template.json"),
      JSON.stringify(spatialTemplateSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "variation-job.json"),
      JSON.stringify(variationJobSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "perception-request.json"),
      JSON.stringify({
        schema: "worldbend.perception-plane-request",
        version: "0.1",
        provider: "contrastQuadV1",
        maxCandidates: 2,
        analysisMaxAxis: 256,
      }),
    );
    await writeFile(
      path.join(fixtureRoot, "psd-smart-object-request.json"),
      JSON.stringify({
        schema: "worldbend.psd-smart-object-request",
        version: "0.1",
        action: { operation: "inspect" },
      }),
    );
    await writeFile(
      path.join(fixtureRoot, "surface-deformation.json"),
      JSON.stringify(surfaceSpec),
    );
    await writeFile(
      path.join(fixtureRoot, "motion.json"),
      JSON.stringify(motionSpec),
    );

    catalogClient = new StdioClient(mcp, [
      "--root",
      fixtureRoot,
      "--surface",
      agentPackageProfile.defaultToolSurface,
    ]);
    await catalogClient.initialize();
    await checkProgressiveCatalog(catalogClient);
    await checkLivePerspectiveCatalog(catalogClient);
    await checkFigmaPreparationCatalog(catalogClient);
    await checkProductionMediaCatalog(catalogClient);
    await checkAdvancedSpatialCatalog(catalogClient);
    await checkExtendedFamilyCancellation(catalogClient);
    await catalogClient.close();
    catalogClient = undefined;

    client = new StdioClient(mcp, ["--root", fixtureRoot]);
    await client.initialize();
    await checkToolCatalog(client);
    await checkSpecialFileRecovery(client);
    await checkCompose(client);
    await checkSolveAndStructuredErrors(client);
    await checkEveryToolRejectsUnknownFields(client);
    await checkInspectAndCssNegatives(client);
    await checkRectification(client);
    await checkCanvasRendering(client);
    await checkRenderLifecycle(client);
    await checkCancellationAndRecovery(client);
    await checkBoundedConcurrency(client);
    checkCliAdapter();
    console.log(
      `Built CLI/MCP runtime smoke passed (catalogTools/list=${metrics.catalogToolsListBytes}B, directTools/list=${metrics.toolsListBytes}B, solve=${metrics.solveResponseBytes}B, canvas=${metrics.canvasResponseBytes}B, program=${metrics.programResponseBytes}B, variation=${metrics.variationResponseBytes}B, media=${metrics.mediaResponseBytes}B, perception=${metrics.perceptionResponseBytes}B, psd=${metrics.psdResponseBytes}B, surface=${metrics.surfaceResponseBytes}B, deformation=${metrics.deformationResponseBytes}B, motion=${metrics.motionResponseBytes}B, tiled=${metrics.tiledResponseBytes}B, boundedSchemaError=${metrics.schemaErrorResponseBytes}B, maxRenderWorkers=${metrics.maxConcurrentRenderStages}, overloadRejections=${metrics.overloadRejections}, extendedFamilyCancellations=${metrics.extendedFamilyCancellations}, cancelCleanup=${metrics.cancelCleanupMs}ms, canvasCancelCleanup=${metrics.canvasCancelCleanupMs}ms, programCancelCleanup=${metrics.programCancelCleanupMs}ms, variationCancelCleanup=${metrics.variationCancelCleanupMs}ms)`,
    );
  } finally {
    if (catalogClient) await catalogClient.close();
    if (client) await client.close();
    if (fixtureValidated) await rm(fixtureRoot, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function checkSpecialFileRecovery(activeClient) {
  if (process.platform === "win32") return;
  const fifo = path.join(fixtureRoot, "blocked.fifo");
  const created = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const request = activeClient.beginRequest("tools/call", {
    name: "worldbend.render",
    arguments: {
      source: "blocked.fifo",
      output: "out/fifo.png",
      dryRun: true,
      spec: pixelSpec,
    },
  });
  const started = Date.now();
  const outcome = await Promise.race([
    request.promise.then(response => ({ kind: "response", response })),
    new Promise(resolve => setTimeout(() => resolve({ kind: "timeout" }), 1_500)),
  ]);
  if (outcome.kind === "timeout") {
    // Unblock a regressed read-only FIFO open without risking another blocking
    // writer, then consume the pending response before failing this smoke.
    try {
      const writer = await open(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      await writer.close();
    } catch (error) {
      if (error?.code !== "ENXIO") throw error;
    }
    await request.promise.catch(() => undefined);
    assert.fail("MCP source preflight blocked on a FIFO before returning its type error");
  }
  expectToolError(outcome.response, "E_PATH_OUTSIDE_ROOT");
  assert(Date.now() - started < 1_500, "FIFO rejection exceeded its bounded preflight window");

  const recovered = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/after-fifo.png",
    dryRun: true,
    spec: pixelSpec,
  });
  assert.equal(recovered.result.structuredContent.ok, true);
  assert.equal(recovered.result.structuredContent.result.status, "ready");
}

async function checkFigmaPreparationCatalog(client) {
  // Search is bounded to 20 entries. Verify the current first window and
  // independently discover the rest by exact operation ID.
  const family = [
    "figma_inspect", "figma_native_create", "figma_apply",
    "figma_appearance_inspect", "figma_appearance_apply",
    "figma_texture_inspect", "figma_texture_apply", "figma_foil", "figma_mesh_gradient",
    "figma_effect_inspect", "figma_effect_sources", "figma_linked_results",
    "figma_effect_continuation", "figma_effect_stage", "figma_effect_publish",
    "figma_effect_create", "figma_work_create", "figma_work_revise",
    "figma_work_continuation", "figma_vector_work", "figma_mockup_inspect",
    "figma_templates_inspect", "figma_scene_create", "figma_mockup_publish",
    "figma_publication_step", "figma_composition_continuation", "figma_mockup_stage",
  ];
  const search = await client.callTool("worldbend.search", { query: "figma", limit: 20 });
  assert(search.result.structuredContent.result.totalMatches >= family.length);
  assert.deepEqual(search.result.structuredContent.result.operations.map((x) => x.operation), family.slice(0,20));
  for (const operation of family.slice(20)) {
    const refined = await client.callTool("worldbend.search", { query: operation, limit: 20 });
    // Related operations may mention this exact ID as a continuation lead.
    assert(refined.result.structuredContent.result.operations.some((entry) => entry.operation === operation), `Missing discovery: ${operation}`);
  }
  for (const operation of ["figma_appearance_inspect", "figma_appearance_apply", "figma_inspect", "figma_apply", "figma_effect_create", "figma_effect_inspect", "figma_effect_publish", "figma_effect_sources", "figma_effect_stage", "figma_mockup_inspect", "figma_mockup_publish", "figma_mockup_stage", "figma_publication_step", "figma_scene_create", "figma_templates_inspect", "figma_texture_inspect", "figma_texture_apply"]) {
    const description = await client.callTool("worldbend.describe", { operation });
    const value = description.result.structuredContent.result;
    assert.equal(value.requiresWorkspace, false);
    assert.equal(value.mutatesFiles, false);
    assert.equal(value.inputSchema.additionalProperties, false);
    assert.equal(value.outputSchema.$defs.FigmaRequest.additionalProperties, false);
  }
  const linkedDescription = await client.callTool("worldbend.describe", { operation: "figma_linked_results" });
  const linkedContract = linkedDescription.result.structuredContent.result;
  assert.equal(linkedContract.requiresWorkspace, false);
  assert.equal(linkedContract.mutatesFiles, false);
  assert.equal(linkedContract.outputSchema.$defs.FigmaRequest.additionalProperties, false);
  assert.equal(linkedContract.inputSchema.oneOf.length, 3);
  for (const action of linkedContract.inputSchema.oneOf) assert.equal(action.additionalProperties, false);
  // Recovery preparation must work in a fresh binary session with no media
  // cache. Actual Figma execution is verified separately on the live fixture.
  const scope = { fileKey: "AbC123", pageId: "37:7", nodeId: "48:3" };
  for (const [arguments_, method] of [
    [{ scope, inspect: true }, "inspectPublication"],
    [{ scope, transferId: "a".repeat(64), cancel: true }, "cancelPublication"],
  ]) {
    const response = await client.callTool("worldbend.run", {
      operation: "figma_publication_step", arguments: arguments_,
    });
    const envelope = response.result.structuredContent;
    assert.equal(envelope.ok, true);
    assert(figmaRequestCode(envelope.result).includes(`WorldbendFigmaMedia.${method}(`));
    assert(Buffer.byteLength(JSON.stringify(envelope.result)) <= 48 * 1024);
  }
  const continuationDescription = await client.callTool("worldbend.describe", {
    operation: "figma_effect_continuation",
  });
  assert.equal(continuationDescription.result.structuredContent.ok, true);
  assert.equal(continuationDescription.result.structuredContent.result.requiresWorkspace, false);
  assert.equal(continuationDescription.result.structuredContent.result.mutatesFiles, false);
  assert(
    JSON.stringify(
      continuationDescription.result.structuredContent.result.outputSchema,
    ).includes('"const":"worldbend.figma-effect-continuation"'),
  );
  const compositionContinuationDescription = await client.callTool("worldbend.describe", {
    operation: "figma_composition_continuation",
  });
  assert.equal(compositionContinuationDescription.result.structuredContent.ok, true);
  assert.equal(compositionContinuationDescription.result.structuredContent.result.requiresWorkspace, false);
  assert.equal(compositionContinuationDescription.result.structuredContent.result.mutatesFiles, false);
  assert(
    JSON.stringify(
      compositionContinuationDescription.result.structuredContent.result.outputSchema,
    ).includes('"const":"worldbend.figma-composition-continuation"'),
  );
  const response = await client.callTool("worldbend.run", {
    operation: "figma_inspect", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:3" },
  });
  const packet = response.result.structuredContent.result;
  assert.equal(packet.fileKey, "granted-file");
  assert.equal(packet.skillNames, "figma-use");
  assert(figmaRequestCode(packet).includes("WorldbendFigmaHandoff.inspect"));
  assert(figmaRequestCode(packet).includes("1024/Math.max"));
  assert(Buffer.byteLength(JSON.stringify(packet)) <= 48 * 1024);
  const apply = await client.callTool("worldbend.run", {
    operation: "figma_apply", arguments: {
      snapshot: { schema: "worldbend.figma.handoff", version: "0.1", fileKey: "granted-file",
        pageId: "37:7", nodeId: "48:3", revision: 0, spec: normalizedSpec,
        source: { nodeId: "48:5", width: 520, height: 606 },
        placement: { x: 900, y: 3240, width: 560, height: 640 }, expected: "current-state" },
      spec: normalizedSpec,
    },
  });
  assert.equal(apply.result.structuredContent.ok, true);
  assert(figmaRequestCode(apply.result.structuredContent.result).includes("WorldbendFigmaHandoff.apply"));
  assert(Buffer.byteLength(JSON.stringify(apply.result.structuredContent.result)) <= 48 * 1024);
  const effectInspect = await client.callTool("worldbend.run", {
    operation: "figma_effect_inspect", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:8" },
  });
  assert.equal(effectInspect.result.structuredContent.ok, true);
  assert(figmaRequestCode(effectInspect.result.structuredContent.result).includes("WorldbendFigmaHandoff.inspectEffect"));
  const recipeResponse = await client.callTool("worldbend.run", {
    operation: "effect_recipe", arguments: {
      effect: "multiplane-camera", version: "3", viewport: { width: 600, height: 400 }, intensity: .8,
    },
  });
  assert.equal(recipeResponse.result.structuredContent.ok, true);
  const appearanceSeed = {
    schema: "worldbend.appearance@0.1", version: "0.1",
    recipeId: "clear-lens", recipeVersion: 1,
    material: {
      visible: true, lightIntensity: 0.5, lightAngle: 90,
      refraction: 0.35, depth: 2, dispersion: 0, radius: 12,
    },
  };
  const appearanceState = await client.callTool("worldbend.run", {
    operation: "appearance_inspect", arguments: {
      recipe: appearanceSeed,
      live: { ...appearanceSeed.material, radius: 40 },
      tagged: true,
    },
  });
  assert.equal(appearanceState.result.structuredContent.ok, true);
  const appearanceInspection = appearanceState.result.structuredContent.result;
  assert.equal(appearanceInspection.schema, "worldbend.appearance-inspection@0.1");
  assert.equal(appearanceInspection.state, "customized");
  assert.deepEqual(appearanceInspection.customized, ["radius"]);
  assert.equal(appearanceInspection.material.radius, 40);
  const webDelivery = await client.callTool("worldbend.run", {
    operation: "appearance_delivery", arguments: {
      recipe: appearanceSeed, material: appearanceInspection.material, target: "web",
    },
  });
  assert.equal(webDelivery.result.structuredContent.ok, true);
  const webPlan = webDelivery.result.structuredContent.result;
  assert.equal(webPlan.schema, "worldbend.appearance-delivery@0.1");
  assert(webPlan.web.css.includes("blur(40px)"));
  assert.equal(webPlan.swiftui, null);
  assert(webPlan.fingerprint.startsWith("sha256:"));
  const previousAppearance = {recipe: appearanceSeed, material: appearanceInspection.material, target: "web"};
  const appearanceUpdateArguments = {
    previous: previousAppearance,
    next: {...previousAppearance,material:{...appearanceInspection.material,refraction:.7,radius:6}},
    live: {...appearanceInspection.material,radius:24},
    expectedFingerprint: webPlan.fingerprint,
  };
  const redelivery = await client.callTool("worldbend.run", {operation:"appearance_update",arguments:appearanceUpdateArguments});
  assert.equal(redelivery.result.structuredContent.ok,true);
  const updatePlan = redelivery.result.structuredContent.result;
  assert.equal(updatePlan.delivery.material.radius,24);
  assert.equal(updatePlan.delivery.material.refraction,.7);
  assert.equal(updatePlan.delivery.recipeVersion,1);
  assert.deepEqual(updatePlan.preserved,["radius"]);
  assert.notEqual(updatePlan.sourceFingerprint,updatePlan.delivery.fingerprint);
  const missingLive = {...appearanceUpdateArguments}; delete missingLive.live;
  assert.equal((await client.callTool("worldbend.run", {operation:"appearance_update",arguments:missingLive})).result.structuredContent.ok,false);
  const removedUpdate = await client.callTool("worldbend.run", {operation:"appearance_update",arguments:{...appearanceUpdateArguments,live:null}});
  assert.equal(removedUpdate.result.structuredContent.ok,true);
  assert.equal(removedUpdate.result.structuredContent.result.delivery,null);
  assert.equal((await client.callTool("worldbend.run", {operation:"appearance_update",arguments:{...appearanceUpdateArguments,expectedFingerprint:"stale"}})).result.structuredContent.ok,false);
  const swiftuiDelivery = await client.callTool("worldbend.run", {
    operation: "appearance_delivery", arguments: {
      recipe: appearanceSeed, material: appearanceInspection.material, target: "swiftui",
    },
  });
  assert.equal(swiftuiDelivery.result.structuredContent.ok, true);
  const swiftuiPlan = swiftuiDelivery.result.structuredContent.result;
  assert.equal(swiftuiPlan.web, null);
  assert(swiftuiPlan.swiftui.snippet.includes("glassEffect(true ? .regular.interactive() : .identity"));
  assert.equal(swiftuiPlan.swiftui.fidelity.length, 7);
  const upgraded = await client.callTool("worldbend.run", {
    operation: "appearance_revision", arguments: { previous: appearanceSeed,
      next: { ...appearanceSeed, recipeVersion: 2, material: { ...appearanceSeed.material, radius: 4, depth: 8 } },
      live: appearanceInspection.material },
  });
  assert.equal(upgraded.result.structuredContent.ok, true);
  assert.equal(upgraded.result.structuredContent.result.material.radius, 40);
  assert.equal(upgraded.result.structuredContent.result.material.depth, 8);
  assert.deepEqual(upgraded.result.structuredContent.result.preserved, ["radius"]);
  const nativeInspect = await client.callTool("worldbend.run", {
    operation: "figma_appearance_inspect", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:8" },
  });
  assert.equal(nativeInspect.result.structuredContent.ok, true);
  assert(figmaRequestCode(nativeInspect.result.structuredContent.result).includes("WorldbendFigmaHandoff.inspectAppearance"));
  assert(figmaRequestCode(nativeInspect.result.structuredContent.result).includes("previewNodeId"));
  const nativeApply = await client.callTool("worldbend.run", {
    operation: "figma_appearance_apply", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:8", expected: "current-state", recipe: appearanceSeed, material: appearanceInspection.material },
  });
  assert.equal(nativeApply.result.structuredContent.ok, true);
  assert(figmaRequestCode(nativeApply.result.structuredContent.result).includes("WorldbendFigmaHandoff.applyAppearance"));
  assert(Buffer.byteLength(JSON.stringify(nativeApply.result.structuredContent.result)) <= 48 * 1024);
  const unsafeApply = await client.callTool("worldbend.run", {
    operation: "figma_appearance_apply", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:8", expected: "", recipe: appearanceSeed },
  });
  assert.equal(unsafeApply.result.structuredContent.ok, false);
  const textureSeed = {
    schema: "worldbend.texture@0.1", version: "0.1",
    recipeId: "warm-paper", recipeVersion: 1,
    material: {
      visible: true, grain: 0.35, grainSize: 3, grainColor: "#8a7f72",
      etch: 1.5, etchSize: 4, clipToShape: true,
    },
  };
  const textureState = await client.callTool("worldbend.run", {
    operation: "texture_inspect", arguments: {
      recipe: textureSeed,
      live: { ...textureSeed.material, grain: 0.4, etch: 2.5, etchSize: 5 },
      tagged: true,
    },
  });
  assert.equal(textureState.result.structuredContent.ok, true);
  const textureInspection = textureState.result.structuredContent.result;
  assert.equal(textureInspection.schema, "worldbend.texture-inspection@0.1");
  assert.equal(textureInspection.state, "customized");
  assert.deepEqual(textureInspection.customized, ["grain", "etch", "etch-size"]);
  const textureDelivery = await client.callTool("worldbend.run", {
    operation: "texture_delivery", arguments: {
      recipe: textureSeed, material: textureInspection.material, target: "web",
    },
  });
  assert.equal(textureDelivery.result.structuredContent.ok, true);
  const texturePlan = textureDelivery.result.structuredContent.result;
  assert.equal(texturePlan.schema, "worldbend.texture-delivery@0.1");
  assert(texturePlan.web.grainTile.startsWith("data:image/svg+xml,"));
  assert.equal(texturePlan.web.grainTileSize, 64 * 0.16 * 3);
  assert.equal(texturePlan.web.etch.baseFrequency, 0.2);
  assert.equal(texturePlan.web.etch.surfaceScale, 0.625);
  assert(texturePlan.fingerprint.startsWith("sha256:"));
  const textureUpgraded = await client.callTool("worldbend.run", {
    operation: "texture_revision", arguments: { previous: textureSeed,
      next: { ...textureSeed, recipeVersion: 2, material: { ...textureSeed.material, grain: 0.5 } },
      live: textureInspection.material },
  });
  assert.equal(textureUpgraded.result.structuredContent.ok, true);
  assert.equal(textureUpgraded.result.structuredContent.result.material.grain, 0.4);
  assert.deepEqual(textureUpgraded.result.structuredContent.result.preserved, ["grain", "etch", "etch-size"]);
  const effectTask = {
    kind: "effect",
    recipe: recipeResponse.result.structuredContent.result,
    state: { progress: 1, pointerX: .25, pointerY: -.2, reducedMotion: false },
  };
  const effectSnapshot = {
    schema: "worldbend.figma.effect-handoff", version: "0.1",
    fileKey: "granted-file", pageId: "37:7", nodeId: "48:8", revision: 2,
    task: effectTask, sourceNodeIds: ["48:5", "48:6", "48:7"],
    placement: { x: 900, y: 3240, width: 600, height: 400 }, expected: "current-state",
  };
  const effectStage = await client.callTool("worldbend.run", {
    operation: "figma_effect_stage", arguments: {
      snapshot: effectSnapshot,
      task: { ...effectTask, state: { ...effectTask.state, pointerX: .4 } },
    },
  });
  assert.equal(effectStage.result.structuredContent.ok, true);
  assert(figmaRequestCode(effectStage.result.structuredContent.result).includes("WorldbendFigmaHandoff.stageEffect"));
  assert(Buffer.byteLength(JSON.stringify(effectStage.result.structuredContent.result)) <= 48 * 1024);
  const effectContinuation = await client.callTool("worldbend.run", {
    operation: "figma_effect_continuation",
    arguments: { snapshot: effectSnapshot },
  });
  assert.equal(effectContinuation.result.structuredContent.ok, true);
  const continued = effectContinuation.result.structuredContent.result;
  assert.equal(continued.schema, "worldbend.figma-effect-continuation");
  assert.equal(continued.origin.nodeId, "48:8");
  assert.equal(continued.expressionId, "figma-depth");
  assert.deepEqual(continued.initialState, effectTask.state);
  assert.deepEqual(continued.sourceBindings, [
    { role: "background", assetId: "background", sourceNodeId: "48:5" },
    { role: "middle", assetId: "middle", sourceNodeId: "48:6" },
    { role: "foreground", assetId: "foreground", sourceNodeId: "48:7" },
  ]);
  assert.equal(continued.document.schema, "worldbend.spatial-document");
  assert.equal(continued.deliveryPlan.schema, "worldbend.spatial-document-delivery-plan");
  assert.deepEqual(
    continued.deliveryPlan.deliveries[0].bindings.map((binding) => binding.assetId),
    ["background", "middle", "foreground"],
  );
  assert.deepEqual(continued.losses, [
    "sourceMediaNotEmbedded", "figmaPlacementNotTransferred",
  ]);
  const invalidContinuation = await client.callTool("worldbend.run", {
    operation: "figma_effect_continuation",
    arguments: {
      snapshot: { ...effectSnapshot, sourceNodeIds: ["48:5", "48:6", "48:6"] },
    },
  });
  expectToolError(invalidContinuation, "E_SCHEMA");
  const mockupInspect = await client.callTool("worldbend.run", {
    operation: "figma_mockup_inspect", arguments: { url: "https://www.figma.com/design/grantedfile/Scene?node-id=48-9" },
  });
  assert.equal(mockupInspect.result.structuredContent.ok, true);
  assert(figmaRequestCode(mockupInspect.result.structuredContent.result).includes("WorldbendFigmaHandoff.inspectMockup"));
  const mockupTask = { kind: "mockup", spec: {
    schema: "worldbend.mockup", version: "0.1", canvas: { width: 600, height: 400 },
    background: { kind: "transparent" }, seams: [],
    planes: [
      { id: "artwork", sourceId: "source-1", transform: normalizedSpec, opacity: 1 },
      { id: "scene", sourceId: "source-2", transform: normalizedSpec, opacity: 1 },
    ],
  } };
  const compositionTask = {
    kind: "composition",
    previewOutputId: "wide",
    template: {
      schema: "worldbend.spatial-template", version: "0.1",
      operation: {
        kind: "compositionProgram", composition: mockupTask.spec,
        postprocess: {
          schema: "worldbend.raster-program", version: "0.1", stages: [{
            kind: "transform", id: "whole-result", canvas: "reference",
            target_size: { width: 600, height: 400 },
            spec: { ...normalizedSpec, content: { ...normalizedSpec.content, warp: { preset: "arch", amount: .42 } } },
          }],
        },
      },
      output: { kind: "canvasSet", spec: {
        schema: "worldbend.canvas-set", version: "0.1", variants: [
          { id: "wide", operation: { kind: "stretch", output: { width: 1200, height: 628 } } },
          { id: "square", operation: { kind: "contain", output: { width: 1080, height: 1080 }, anchor: { x: .5, y: .5 }, background: { kind: "transparent" } } },
        ],
      } },
    },
  };
  const mockupSnapshot = {
    schema: "worldbend.figma.mockup-handoff", version: "0.1",
    fileKey: "grantedfile", pageId: "37:7", nodeId: "48:9", revision: 2,
    task: compositionTask, sourceNodeIds: ["48:5", "48:6"],
    sources: [
      { slotId: "source-1", nodeId: "48:5", name: "Artwork", width: 520, height: 606,
        previewFingerprint: "preview32x2:128:aabbccddeeff0011" },
      { slotId: "source-2", nodeId: "48:6", name: "Scene", width: 600, height: 400,
        previewFingerprint: "preview32x2:256:1122334455667788" },
    ],
    placement: { x: 900, y: 3240, width: 600, height: 400 }, expected: "current-state",
  };
  const mockupStage = await client.callTool("worldbend.run", {
    operation: "figma_mockup_stage", arguments: {
      snapshot: mockupSnapshot,
      task: { ...compositionTask, template: { ...compositionTask.template,
        operation: { ...compositionTask.template.operation,
          postprocess: { ...compositionTask.template.operation.postprocess, stages: [{
            ...compositionTask.template.operation.postprocess.stages[0],
            spec: { ...compositionTask.template.operation.postprocess.stages[0].spec,
              content: { ...compositionTask.template.operation.postprocess.stages[0].spec.content,
                warp: { preset: "arch", amount: .6 } } },
          }] },
        },
      } },
    },
  });
  assert.equal(mockupStage.result.structuredContent.ok, true);
  assert(figmaRequestCode(mockupStage.result.structuredContent.result).includes("WorldbendFigmaHandoff.stageMockup"));
  assert(Buffer.byteLength(JSON.stringify(mockupStage.result.structuredContent.result)) <= 48 * 1024);
  const compositionContinuation = await client.callTool("worldbend.run", {
    operation: "figma_composition_continuation",
    arguments: { snapshot: mockupSnapshot },
  });
  assert.equal(compositionContinuation.result.structuredContent.ok, true);
  const compositionContinued = compositionContinuation.result.structuredContent.result;
  assert.equal(compositionContinued.schema, "worldbend.figma-composition-continuation");
  assert.equal(compositionContinued.document.schema, "worldbend.spatial-document");
  assert.equal(compositionContinued.deliveryPlan.schema, "worldbend.spatial-document-delivery-plan");
  assert.equal(compositionContinued.document.expressions[0].template.operation.kind, "compositionProgram");
  assert.equal(compositionContinued.deliveryPlan.deliveries[0].job.template.output.spec.variants.length, 2);
  assert.deepEqual(compositionContinued.sourceBindings.map((binding) => binding.slotId), ["source-1", "source-2"]);
  assert.deepEqual(compositionContinued.losses, [
    "sourceMediaNotEmbedded", "figmaPlacementNotTransferred", "previewFingerprintNotContentDigest",
  ]);
  expectToolError(await client.callTool("worldbend.run", {
    operation: "figma_inspect", arguments: { fileKey: "granted-file", pageId: "37:7", nodeId: "48:3", allowWrite: true },
  }), "E_SCHEMA");
}

async function checkProductionMediaCatalog(activeClient) {
  const mediaDescription = await activeClient.callTool("worldbend.describe", {
    operation: "media_render",
  });
  assert.equal(mediaDescription.result.structuredContent.ok, true);
  assert.equal(
    mediaDescription.result.structuredContent.result.inputSchema.$defs.MediaLimitsInput
      .properties.maxPixels.maximum,
    12 * 1024 * 1024,
  );

  const perceptionDescription = await activeClient.callTool("worldbend.describe", {
    operation: "plane_candidates",
  });
  assert.equal(perceptionDescription.result.structuredContent.ok, true);
  assert.equal(
    perceptionDescription.result.structuredContent.result.mutatesFiles,
    false,
  );
  const perception = await activeClient.callTool("worldbend.run", {
    operation: "plane_candidates",
    arguments: {
      source: "perception.png",
      request: {
        schema: "worldbend.perception-plane-request",
        version: "0.1",
        provider: "contrastQuadV1",
        maxCandidates: 2,
        analysisMaxAxis: 256,
      },
    },
  });
  assert.equal(
    perception.result.structuredContent.ok,
    true,
    JSON.stringify(perception.result.structuredContent),
  );
  const perceptionResult = perception.result.structuredContent.result;
  mcpPerceptionResult = perceptionResult;
  assert.equal(perceptionResult.outcome, "candidates");
  assert(perceptionResult.candidates.length >= 1);
  assert.equal(perceptionResult.provider.automaticExecution, false);
  assert.equal(
    perceptionResult.provider.scoreCalibration,
    "uncalibratedRankingScore",
  );
  assert.equal(perceptionResult.source.width, 96);
  assert.equal(perceptionResult.source.height, 72);
  assert.equal(
    perceptionResult.source.sourceSha256,
    sha256(await readFile(path.join(fixtureRoot, "perception.png"))),
  );
  assert.equal(perceptionResult.candidates[0].sourcePlane.space, "pixel");
  assert.equal(perceptionResult.candidates[0].sourcePlane.reference.width, 96);
  metrics.perceptionResponseBytes = perception.wireBytes;

  const noAlphaCandidate = await activeClient.callTool("worldbend.run", {
    operation: "plane_candidates",
    arguments: {
      source: "perception.png",
      request: {
        schema: "worldbend.perception-plane-request",
        version: "0.1",
        provider: "alphaQuadV1",
      },
    },
  });
  assert.equal(noAlphaCandidate.result.structuredContent.ok, true);
  assert.equal(noAlphaCandidate.result.structuredContent.result.outcome, "noCandidate");
  assert.deepEqual(noAlphaCandidate.result.structuredContent.result.candidates, []);

  const inspection = await activeClient.callTool("worldbend.run", {
    operation: "media_inspect",
    arguments: { source: "source16.png" },
  });
  assert.equal(inspection.result.structuredContent.ok, true);
  assert.equal(inspection.result.structuredContent.result.sampleFormat, "u16");
  assert.equal(inspection.result.structuredContent.result.iccProfileBytes, 128);

  const media = await activeClient.callTool("worldbend.run", {
    operation: "media_render",
    arguments: {
      source: "source16.png",
      spec: makePixelSpec(1, 1),
      output: "out/media16.png",
      options: {
        quality: "standard",
        canvas: "reference",
        output: { format: "png", precision: "preserve", icc: "preserve" },
      },
    },
  });
  assert.equal(media.result.structuredContent.ok, true);
  assert.equal(media.result.structuredContent.result.media.sampleFormat, "u16");
  assert.equal(media.result.structuredContent.result.media.iccEmbedded, true);
  const mediaBytes = await readFile(path.join(fixtureRoot, "out", "media16.png"));
  assert.equal(media.result.structuredContent.result.evidence.outputSha256, sha256(mediaBytes));
  metrics.mediaResponseBytes = media.wireBytes;

  const vector = await activeClient.callTool("worldbend.run", {
    operation: "vector_render",
    arguments: {
      source: "source.svg",
      spec: makePixelSpec(20, 10),
      output: "out/vector.svg",
      options: {
        carrier: "svg",
        elementSize: { width: 10, height: 10 },
        canvas: "reference",
      },
    },
  });
  assert.equal(
    vector.result.structuredContent.ok,
    true,
    JSON.stringify(vector.result.structuredContent),
  );
  assert.equal(vector.result.structuredContent.result.projective, false);
  const vectorBytes = await readFile(path.join(fixtureRoot, "out", "vector.svg"));
  assert.equal(vector.result.structuredContent.result.outputSha256, sha256(vectorBytes));
  assert(vectorBytes.includes(Buffer.from("data:image/svg+xml;base64,")));

  const projective = makePixelSpec(20, 10);
  projective.destination.quad.br.x = 17;
  const invalidSvg = await activeClient.callTool("worldbend.run", {
    operation: "vector_render",
    arguments: {
      source: "source.svg",
      spec: projective,
      output: "out/projective.svg",
      options: {
        carrier: "svg",
        elementSize: { width: 10, height: 10 },
        canvas: "reference",
      },
    },
  });
  expectToolError(invalidSvg, "E_SCHEMA");
  assert.equal(await exists(path.join(fixtureRoot, "out", "projective.svg")), false);

  const tiled = await activeClient.callTool("worldbend.run", {
    operation: "tiled_media_render",
    arguments: {
      source: "source.png",
      spec: makePixelSpec(4, 4),
      outputDirectory: "out/tiles",
      options: {
        quality: "standard",
        canvas: "reference",
        tileWidth: 2,
        tileHeight: 2,
        output: { format: "png", precision: "u8", icc: "discard" },
      },
    },
  });
  assert.equal(
    tiled.result.structuredContent.ok,
    true,
    JSON.stringify(tiled.result.structuredContent),
  );
  assert.equal(tiled.result.structuredContent.result.status, "written");
  assert.equal(tiled.result.structuredContent.result.manifest.rows, 2);
  assert.equal(tiled.result.structuredContent.result.manifest.columns, 2);
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "out", "tiles"))).sort(),
    [
      "tile-r0000-c0000.png",
      "tile-r0000-c0001.png",
      "tile-r0001-c0000.png",
      "tile-r0001-c0001.png",
      "worldbend.tiled-media.json",
    ],
  );
  const manifest = JSON.parse(
    await readFile(path.join(fixtureRoot, "out", "tiles", "worldbend.tiled-media.json"), "utf8"),
  );
  assert(manifest.tiles.every((tile) => !tile.filename.includes("/")));
  for (const tile of tiled.result.structuredContent.result.manifest.tiles) {
    const bytes = await readFile(path.join(fixtureRoot, "out", "tiles", tile.filename));
    assert.equal(tile.sha256, sha256(bytes));
  }
  metrics.tiledResponseBytes = tiled.wireBytes;

  const webpTiles = await activeClient.callTool("worldbend.run", {
    operation: "tiled_media_render",
    arguments: {
      source: "source.png",
      spec: makePixelSpec(2, 1),
      outputDirectory: "out/tiles-webp",
      options: {
        quality: "standard",
        canvas: "reference",
        tileWidth: 1,
        tileHeight: 1,
        output: { format: "webpLossless", icc: "discard" },
      },
    },
  });
  assert.equal(
    webpTiles.result.structuredContent.ok,
    true,
    JSON.stringify(webpTiles.result.structuredContent),
  );
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "out", "tiles-webp"))).sort(),
    ["tile-r0000-c0000.webp", "tile-r0000-c0001.webp", "worldbend.tiled-media.json"],
  );

  const wrongMediaExtension = await activeClient.callTool("worldbend.run", {
    operation: "media_render",
    arguments: {
      source: "source.png",
      spec: makePixelSpec(1, 1),
      output: "out/wrong-media.png",
      options: {
        output: {
          format: "jpeg",
          quality: 90,
          matte: [255, 255, 255],
          icc: "discard",
        },
      },
    },
  });
  expectToolError(wrongMediaExtension, "E_SCHEMA");
  assert.equal(await exists(path.join(fixtureRoot, "out", "wrong-media.png")), false);

  const wrongVectorExtension = await activeClient.callTool("worldbend.run", {
    operation: "vector_render",
    arguments: {
      source: "source.svg",
      spec: makePixelSpec(1, 1),
      output: "out/wrong-vector.svg",
      options: {
        carrier: "html",
        elementSize: { width: 10, height: 10 },
      },
    },
  });
  expectToolError(wrongVectorExtension, "E_SCHEMA");
  assert.equal(await exists(path.join(fixtureRoot, "out", "wrong-vector.svg")), false);

  const missingTiledTarget = await activeClient.callTool("worldbend.run", {
    operation: "tiled_media_render",
    arguments: {
      source: "source.png",
      spec: normalizedSpec,
      outputDirectory: "out/missing-tiled-target",
      options: {
        tileWidth: 1,
        tileHeight: 1,
        output: { format: "png", precision: "u8", icc: "discard" },
      },
    },
  });
  expectToolError(missingTiledTarget, "E_SCHEMA");
  assert.equal(await exists(path.join(fixtureRoot, "out", "missing-tiled-target")), false);
}

async function checkAdvancedSpatialCatalog(activeClient) {
  for (const [operation, schemaName, schemaValue] of [
    ["psd_smart_objects", "PsdSmartObjectRequest", "worldbend.psd-smart-object-request"],
    ["surface_plan", "SurfaceDeformationSpec", "worldbend.surface-deformation"],
    ["deformation_plan", "DeformationWorkSpec", "worldbend.deformation-work"],
    ["deformation_migrate", "DeformationMigrateInput", null],
    ["motion_plan", "MotionSpec", "worldbend.motion"],
  ]) {
    const description = await activeClient.callTool("worldbend.describe", {
      operation,
    });
    assert.equal(description.result.structuredContent.ok, true);
    if (schemaValue !== null) {
      assert.equal(
        description.result.structuredContent.result.inputSchema.$defs[schemaName]
          .properties.schema.const,
        schemaValue,
      );
    }
  }

  for (const [query, expected] of [
    ["PSD Smart Object template", "psd_smart_objects"],
    ["cubic surface deformation", "surface_plan"],
    ["deformation work plane pin mesh views", "deformation_plan"],
    ["migrate mesh warp surface deformation persisted", "deformation_migrate"],
    ["motion easing timebase", "motion_plan"],
    ["document shared assets", "document_inspect"],
    ["assemble projected works asset equivalence", "document_assemble"],
    ["document stale redelivery", "document_update_plan"],
    ["document compile selected publish", "document_delivery_plan"],
    ["interactive media bundle content hash", "interactive_media_bundle_plan"],
  ]) {
    const search = await activeClient.callTool("worldbend.search", { query });
    assert.equal(search.result.structuredContent.ok, true);
    assert(
      search.result.structuredContent.result.operations.some(
        (entry) => entry.operation === expected,
      ),
      `${query} must discover ${expected}`,
    );
  }

  const recipeResponse = await activeClient.callTool("worldbend.run", {
    operation: "effect_recipe",
    arguments: {
      effect: "layered-depth",
      version: "1",
      viewport: { width: 600, height: 400 },
      intensity: 0.8,
    },
  });
  assert.equal(recipeResponse.result.structuredContent.ok, true);
  spatialDocumentSpec = makeSpatialDocumentSpec(
    recipeResponse.result.structuredContent.result,
  );
  await writeFile(
    path.join(fixtureRoot, "spatial-document.json"),
    JSON.stringify(spatialDocumentSpec),
  );
  const documentDescription = await activeClient.callTool("worldbend.describe", {
    operation: "document_inspect",
  });
  assert.equal(documentDescription.result.structuredContent.ok, true);
  assert.equal(
    documentDescription.result.structuredContent.result.inputSchema.$defs
      .SpatialDocumentSpec.properties.schema.const,
    "worldbend.spatial-document",
  );
  const documentInspection = await activeClient.callTool("worldbend.run", {
    operation: "document_inspect",
    arguments: { spec: spatialDocumentSpec },
  });
  assert.equal(documentInspection.result.structuredContent.ok, true);
  assert.equal(documentInspection.result.structuredContent.result.expressions.length, 2);
  assert.deepEqual(
    documentInspection.result.structuredContent.result.unusedAssetIds,
    [],
  );
  assert.equal(
    documentInspection.result.structuredContent.result.expressions[0].bindings[0]
      .assetId,
    "product",
  );
  assert.equal(
    documentInspection.result.structuredContent.result.expressions[1].bindings[2]
      .assetId,
    "product",
  );
  const staticDocument = {
    schema: spatialDocumentSpec.schema,
    version: spatialDocumentSpec.version,
    assets: [{ id: "product" }],
    expressions: [spatialDocumentSpec.expressions[0]],
  };
  const interactiveDocument = {
    schema: spatialDocumentSpec.schema,
    version: spatialDocumentSpec.version,
    assets: [{ id: "backdrop" }, { id: "details" }, { id: "product" }],
    expressions: [spatialDocumentSpec.expressions[1]],
  };
  const [staticInspection, interactiveInspection] = await Promise.all([
    activeClient.callTool("worldbend.run", {
      operation: "document_inspect",
      arguments: { spec: staticDocument },
    }),
    activeClient.callTool("worldbend.run", {
      operation: "document_inspect",
      arguments: { spec: interactiveDocument },
    }),
  ]);
  spatialDocumentAssemblyInput = {
    documents: [
      {
        id: "composition",
        document: staticDocument,
        expectedFingerprint:
          staticInspection.result.structuredContent.result.fingerprint,
      },
      {
        id: "depth",
        document: interactiveDocument,
        expectedFingerprint:
          interactiveInspection.result.structuredContent.result.fingerprint,
      },
    ],
    assets: [
      {
        id: "product",
        contentVersion: "release-1",
        members: [
          { documentId: "depth", assetId: "product" },
          { documentId: "composition", assetId: "product" },
        ],
      },
      {
        id: "backdrop",
        members: [{ documentId: "depth", assetId: "backdrop" }],
      },
      {
        id: "details",
        members: [{ documentId: "depth", assetId: "details" }],
      },
    ],
    expressions: [
      {
        id: "release-still",
        documentId: "composition",
        expressionId: "release-still",
      },
      {
        id: "interactive-hero",
        documentId: "depth",
        expressionId: "interactive-hero",
      },
    ],
  };
  await writeFile(
    path.join(fixtureRoot, "spatial-document-assembly.json"),
    JSON.stringify(spatialDocumentAssemblyInput),
  );
  const assemblyDescription = await activeClient.callTool("worldbend.describe", {
    operation: "document_assemble",
  });
  assert.equal(assemblyDescription.result.structuredContent.ok, true);
  assert(
    JSON.stringify(
      assemblyDescription.result.structuredContent.result.outputSchema,
    ).includes('"const":"worldbend.spatial-document-assembly-plan"'),
  );
  const assemblyResponse = await activeClient.callTool("worldbend.run", {
    operation: "document_assemble",
    arguments: spatialDocumentAssemblyInput,
  });
  assert.equal(assemblyResponse.result.structuredContent.ok, true);
  spatialDocumentAssemblyPlan = assemblyResponse.result.structuredContent.result;
  assert.deepEqual(
    spatialDocumentAssemblyPlan.deliveryPlan.deliveries.map(
      (delivery) => delivery.kind,
    ),
    ["static", "interactive"],
  );
  assert.deepEqual(
    spatialDocumentAssemblyPlan.assets[2].members,
    [
      { documentId: "composition", assetId: "product" },
      { documentId: "depth", assetId: "product" },
    ],
  );
  const staleAssembly = await activeClient.callTool("worldbend.run", {
    operation: "document_assemble",
    arguments: {
      ...spatialDocumentAssemblyInput,
      documents: spatialDocumentAssemblyInput.documents.map((document, index) =>
        index === 0
          ? { ...document, expectedFingerprint: `sha256:${"0".repeat(64)}` }
          : document,
      ),
    },
  });
  expectToolError(staleAssembly, "E_SCHEMA");
  spatialDocumentSpec = spatialDocumentAssemblyPlan.document;
  await writeFile(
    path.join(fixtureRoot, "spatial-document.json"),
    JSON.stringify(spatialDocumentSpec),
  );
  spatialDocumentUpdateSpec = {
    document: spatialDocumentSpec,
    expectedFingerprint:
      spatialDocumentAssemblyPlan.deliveryPlan.documentFingerprint,
    revisions: [{ assetId: "product", contentVersion: "release-2" }],
  };
  await writeFile(
    path.join(fixtureRoot, "spatial-document-update.json"),
    JSON.stringify(spatialDocumentUpdateSpec),
  );
  const updateDescription = await activeClient.callTool("worldbend.describe", {
    operation: "document_update_plan",
  });
  assert.equal(updateDescription.result.structuredContent.ok, true);
  assert(
    JSON.stringify(
      updateDescription.result.structuredContent.result.outputSchema,
    ).includes('"const":"worldbend.spatial-document-update-plan"'),
  );
  const updateResponse = await activeClient.callTool("worldbend.run", {
    operation: "document_update_plan",
    arguments: spatialDocumentUpdateSpec,
  });
  assert.equal(updateResponse.result.structuredContent.ok, true);
  spatialDocumentUpdatePlan = updateResponse.result.structuredContent.result;
  assert.equal(spatialDocumentUpdatePlan.changed, true);
  assert.deepEqual(
    spatialDocumentUpdatePlan.affectedExpressions.map((expression) => expression.id),
    ["release-still", "interactive-hero"],
  );
  assert.notEqual(
    spatialDocumentUpdatePlan.fingerprint,
    spatialDocumentUpdatePlan.previousFingerprint,
  );
  assert.equal(
    spatialDocumentUpdatePlan.document.assets.find((asset) => asset.id === "product")
      .contentVersion,
    "release-2",
  );
  const staleUpdate = await activeClient.callTool("worldbend.run", {
    operation: "document_update_plan",
    arguments: {
      ...spatialDocumentUpdateSpec,
      expectedFingerprint: `sha256:${"0".repeat(64)}`,
    },
  });
  assert.equal(staleUpdate.result.structuredContent.ok, false);
  assert.equal(staleUpdate.result.structuredContent.error.code, "E_SCHEMA");
  spatialDocumentDeliverySpec = {
    document: spatialDocumentUpdatePlan.document,
    expectedFingerprint: spatialDocumentUpdatePlan.fingerprint,
    expressionIds: spatialDocumentUpdatePlan.affectedExpressions.map(
      (expression) => expression.id,
    ),
  };
  await writeFile(
    path.join(fixtureRoot, "spatial-document-delivery.json"),
    JSON.stringify(spatialDocumentDeliverySpec),
  );
  const deliveryDescription = await activeClient.callTool("worldbend.describe", {
    operation: "document_delivery_plan",
  });
  assert.equal(deliveryDescription.result.structuredContent.ok, true);
  assert(
    JSON.stringify(
      deliveryDescription.result.structuredContent.result.outputSchema,
    ).includes('"const":"worldbend.spatial-document-delivery-plan"'),
  );
  const deliveryResponse = await activeClient.callTool("worldbend.run", {
    operation: "document_delivery_plan",
    arguments: spatialDocumentDeliverySpec,
  });
  assert.equal(deliveryResponse.result.structuredContent.ok, true);
  spatialDocumentDeliveryPlan =
    deliveryResponse.result.structuredContent.result;
  assert.equal(
    spatialDocumentDeliveryPlan.documentFingerprint,
    spatialDocumentUpdatePlan.fingerprint,
  );
  assert.deepEqual(
    spatialDocumentDeliveryPlan.deliveries.map((delivery) => delivery.id),
    ["release-still", "interactive-hero"],
  );
  assert.equal(spatialDocumentDeliveryPlan.deliveries[0].kind, "static");
  assert.equal(
    spatialDocumentDeliveryPlan.deliveries[0].job.items[0].bindings[0].assetId,
    "product",
  );
  assert.equal(spatialDocumentDeliveryPlan.deliveries[1].kind, "interactive");
  assert.match(
    spatialDocumentDeliveryPlan.deliveries[1].recipeFingerprint,
    /^sha256:[0-9a-f]{64}$/,
  );
  const bundleRecipeResponse = await activeClient.callTool("worldbend.run", {
    operation: "effect_recipe",
    arguments: {
      effect: "multiplane-camera",
      version: "3",
      viewport: { width: 600, height: 400 },
      intensity: 0.8,
    },
  });
  assert.equal(bundleRecipeResponse.result.structuredContent.ok, true);
  spatialInteractiveMediaBundleInput = {
    expressionId: "web-hero",
    recipe: bundleRecipeResponse.result.structuredContent.result,
    initialState: {
      progress: 1,
      pointerX: 0.25,
      pointerY: -0.2,
      reducedMotion: false,
    },
    bindings: [
      { role: "content", slotId: "background", assetId: "background" },
      { role: "content", slotId: "middle", assetId: "middle" },
      { role: "content", slotId: "foreground", assetId: "foreground" },
    ],
    media: [
      { assetId: "middle", format: "png", sha256: "b".repeat(64), encodedBytes: 1024, width: 720, height: 480 },
      { assetId: "foreground", format: "png", sha256: "c".repeat(64), encodedBytes: 1024, width: 720, height: 480 },
      { assetId: "background", format: "png", sha256: "a".repeat(64), encodedBytes: 1024, width: 720, height: 480 },
    ],
  };
  await writeFile(
    path.join(fixtureRoot, "spatial-interactive-media-bundle.json"),
    JSON.stringify(spatialInteractiveMediaBundleInput),
  );
  const bundleDescription = await activeClient.callTool("worldbend.describe", {
    operation: "interactive_media_bundle_plan",
  });
  assert.equal(bundleDescription.result.structuredContent.ok, true);
  assert.equal(bundleDescription.result.structuredContent.result.mutatesFiles, false);
  assert.equal(bundleDescription.result.structuredContent.result.requiresWorkspace, false);
  assert(
    JSON.stringify(bundleDescription.result.structuredContent.result.outputSchema)
      .includes('"const":"worldbend.spatial-interactive-media-bundle"'),
  );
  const bundleResponse = await activeClient.callTool("worldbend.run", {
    operation: "interactive_media_bundle_plan",
    arguments: spatialInteractiveMediaBundleInput,
  });
  assert.equal(bundleResponse.result.structuredContent.ok, true);
  spatialInteractiveMediaBundle = bundleResponse.result.structuredContent.result;
  assert.equal(spatialInteractiveMediaBundle.expressionId, "web-hero");
  assert.deepEqual(
    spatialInteractiveMediaBundle.media.map((item) => item.assetId),
    ["background", "foreground", "middle"],
  );
  assert.equal(
    spatialInteractiveMediaBundle.document.assets[0].contentVersion,
    `sha256:${"a".repeat(64)}`,
  );
  assert.match(spatialInteractiveMediaBundle.fingerprint, /^sha256:[0-9a-f]{64}$/);
  const invalidBundle = await activeClient.callTool("worldbend.run", {
    operation: "interactive_media_bundle_plan",
    arguments: {
      ...spatialInteractiveMediaBundleInput,
      media: spatialInteractiveMediaBundleInput.media.map((item, index) =>
        index === 0 ? { ...item, sha256: "A".repeat(64) } : item
      ),
    },
  });
  expectToolError(invalidBundle, "E_SCHEMA");
  const incompleteBundle = await activeClient.callTool("worldbend.run", {
    operation: "interactive_media_bundle_plan",
    arguments: {
      ...spatialInteractiveMediaBundleInput,
      media: spatialInteractiveMediaBundleInput.media.slice(1),
    },
  });
  expectToolError(incompleteBundle, "E_SCHEMA");
  const compiledStatic = await activeClient.callTool("worldbend.run", {
    operation: "variation_plan",
    arguments: { spec: spatialDocumentDeliveryPlan.deliveries[0].job },
  });
  assert.equal(compiledStatic.result.structuredContent.ok, true);
  assert.equal(compiledStatic.result.structuredContent.result.outputCount, 2);
  const deliveredStatic = await activeClient.callTool("worldbend.run", {
    operation: "variation_render",
    arguments: {
      assets: [{ id: "product", source: "source.png" }],
      spec: spatialDocumentDeliveryPlan.deliveries[0].job,
      outputDirectory: "out/document-static",
    },
  });
  assert.equal(deliveredStatic.result.structuredContent.ok, true);
  assert.equal(deliveredStatic.result.structuredContent.result.status, "written");
  assert.equal(deliveredStatic.result.structuredContent.result.items.length, 1);
  assert.equal(
    deliveredStatic.result.structuredContent.result.items[0].outputs.length,
    2,
  );
  assert.deepEqual(
    await readdir(path.join(fixtureRoot, "out", "document-static", "release-still")),
    ["hero.png", "thumbnail.png"],
  );

  const psdInspection = await activeClient.callTool("worldbend.run", {
    operation: "psd_smart_objects",
    arguments: {
      source: "smart-object.psd",
      request: {
        schema: "worldbend.psd-smart-object-request",
        version: "0.1",
        action: { operation: "inspect" },
      },
    },
  });
  assert.equal(
    psdInspection.result.structuredContent.ok,
    true,
    JSON.stringify(psdInspection.result.structuredContent),
  );
  const inspection = psdInspection.result.structuredContent.result.inspection;
  assert.equal(psdInspection.result.structuredContent.result.result, "inspection");
  assert.equal(inspection.source.document.width, 100);
  assert.equal(inspection.smartObjects.length, 1);
  assert.equal(inspection.smartObjects[0].importability.status, "eligible");
  metrics.psdResponseBytes = psdInspection.wireBytes;

  const psdTemplate = await activeClient.callTool("worldbend.run", {
    operation: "psd_smart_objects",
    arguments: {
      source: "smart-object.psd",
      request: {
        schema: "worldbend.psd-smart-object-request",
        version: "0.1",
        action: {
          operation: "planTemplate",
          smartObjectIds: [inspection.smartObjects[0].id],
        },
      },
    },
  });
  assert.equal(psdTemplate.result.structuredContent.ok, true);
  assert.equal(psdTemplate.result.structuredContent.result.result, "templatePlan");
  assert.deepEqual(
    psdTemplate.result.structuredContent.result.plan.templateInspection.sourceSlots,
    ["source-0001"],
  );
  expectToolError(
    await activeClient.callTool("worldbend.run", {
      operation: "psd_smart_objects",
      arguments: {
        source: "../smart-object.psd",
        request: {
          schema: "worldbend.psd-smart-object-request",
          version: "0.1",
          action: { operation: "inspect" },
        },
      },
    }),
    "E_PATH_OUTSIDE_ROOT",
  );

  const surfacePlan = await activeClient.callTool("worldbend.run", {
    operation: "surface_plan",
    arguments: { spec: surfaceSpec },
  });
  assert.equal(surfacePlan.result.structuredContent.ok, true);
  assert.equal(
    surfacePlan.result.structuredContent.result.schema,
    "worldbend.surface-deformation-plan",
  );
  assert.equal(surfacePlan.result.structuredContent.result.strokeSampleCount, 1);

  const surfaceDry = await activeClient.callTool("worldbend.run", {
    operation: "surface_render",
    arguments: {
      source: "source.png",
      spec: surfaceSpec,
      output: "out/surface-dry.png",
      dryRun: true,
    },
  });
  assert.equal(surfaceDry.result.structuredContent.ok, true);
  assert.equal(surfaceDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "surface-dry.png")), false);

  const surfaceWritten = await activeClient.callTool("worldbend.run", {
    operation: "surface_render",
    arguments: {
      source: "source.png",
      spec: surfaceSpec,
      output: "out/surface.png",
    },
  });
  assert.equal(surfaceWritten.result.structuredContent.ok, true);
  const surfaceBytes = await readFile(path.join(fixtureRoot, "out", "surface.png"));
  assert.equal(
    surfaceWritten.result.structuredContent.result.evidence.outputSha256,
    sha256(surfaceBytes),
  );
  metrics.surfaceResponseBytes = surfaceWritten.wireBytes;

  const deformationWorkSpec = makeDeformationWorkSpec();
  const deformationPlan = await activeClient.callTool("worldbend.run", {
    operation: "deformation_plan",
    arguments: { spec: deformationWorkSpec },
  });
  assert.equal(deformationPlan.result.structuredContent.ok, true);
  assert.equal(
    deformationPlan.result.structuredContent.result.schema,
    "worldbend.deformation-work-plan",
  );
  assert.equal(
    deformationPlan.result.structuredContent.result.meshEditCount,
    1,
  );
  assert.equal(
    deformationPlan.result.structuredContent.result.pinView.anchors[0].id,
    "center",
  );
  assert.equal(
    deformationPlan.result.structuredContent.result.liquifySampleCount,
    2,
  );

  const deformationWritten = await activeClient.callTool("worldbend.run", {
    operation: "deformation_render",
    arguments: {
      source: "source.png",
      spec: deformationWorkSpec,
      output: "out/deformation-work.png",
    },
  });
  assert.equal(deformationWritten.result.structuredContent.ok, true);
  const deformationBytes = await readFile(
    path.join(fixtureRoot, "out", "deformation-work.png"),
  );
  assert.equal(
    deformationWritten.result.structuredContent.result.evidence.outputSha256,
    sha256(deformationBytes),
  );

  const surfaceMigration = await activeClient.callTool("worldbend.run", {
    operation: "deformation_migrate",
    arguments: { surfaceDeformation: surfaceSpec },
  });
  assert.equal(surfaceMigration.result.structuredContent.ok, true);
  assert.equal(
    surfaceMigration.result.structuredContent.result.schema,
    "worldbend.deformation-work-migration",
  );
  assert.equal(
    surfaceMigration.result.structuredContent.result.sourceSchema,
    "worldbend.surface-deformation",
  );
  assert.deepEqual(
    surfaceMigration.result.structuredContent.result.plan.meshWarp,
    surfacePlan.result.structuredContent.result.meshWarp,
  );

  const migratedWorkWritten = await activeClient.callTool("worldbend.run", {
    operation: "deformation_render",
    arguments: {
      source: "source.png",
      spec: surfaceMigration.result.structuredContent.result.work,
      output: "out/deformation-migrated.png",
    },
  });
  assert.equal(migratedWorkWritten.result.structuredContent.ok, true);
  assert.equal(
    migratedWorkWritten.result.structuredContent.result.evidence.outputSha256,
    surfaceWritten.result.structuredContent.result.evidence.outputSha256,
    "migrated work must render identically to its surface source",
  );
  metrics.deformationResponseBytes = deformationWritten.wireBytes;

  // A valid detailed fit can exceed the response bound while its authored
  // recipe remains small. Exercise the actual private worker and guarded PNG
  // publication through both response views, rather than projecting a fixture.
  const circle = Array.from({length:64},(_,i)=>{
    const angle=i*Math.PI/32;return {x:.5+.45*Math.cos(angle),y:.5+.45*Math.sin(angle)};
  });
  const fittedWork = {schema:"worldbend.deformation-work",version:"0.1",
    transform:makeNormalizedSpec(),targetSize:{width:64,height:64},meshSubdivisions:12,
    shapeFit:{contour:{start:circle[0],segments:circle.slice(1).map(to=>({kind:"line",to}))},refinement:2}};
  const compactPlan = await activeClient.callTool("worldbend.run", {
    operation:"deformation_plan",arguments:{spec:fittedWork,planView:"state"},
  });
  assert.equal(compactPlan.result.structuredContent.ok,true,JSON.stringify(compactPlan.result));
  const state = compactPlan.result.structuredContent.result;
  assert.equal(state.schema,"worldbend.deformation-work-summary");
  assert.deepEqual(state.spec.shapeFit,fittedWork.shapeFit);
  assert(state.vertexCount>128 && state.triangleCount>256);
  assert.equal(Object.hasOwn(state,"meshWarp"),false);
  assert(compactPlan.wireBytes<16*1024);
  const oversizedPlan = await activeClient.callTool("worldbend.run", {
    operation:"deformation_plan",arguments:{spec:fittedWork},
  });
  assert.equal(oversizedPlan.result.structuredContent.ok,false);
  assert.equal(oversizedPlan.result.structuredContent.error.code,"E_OUTPUT_LIMIT");
  assert(oversizedPlan.result.structuredContent.error.message.includes("planView:state"));
  const compactRender = await activeClient.callTool("worldbend.run", {
    operation:"deformation_render",arguments:{source:"source.png",spec:fittedWork,
      output:"out/deformation-state.png",planView:"state"},
  });
  assert.equal(compactRender.result.structuredContent.ok,true,JSON.stringify(compactRender.result));
  assert.deepEqual(compactRender.result.structuredContent.result.plan,state);
  const stateBytes = await readFile(path.join(fixtureRoot,"out/deformation-state.png"));
  assert.equal(compactRender.result.structuredContent.result.evidence.outputSha256,sha256(stateBytes));
  const oversizedRender = await activeClient.callTool("worldbend.run", {
    operation:"deformation_render",arguments:{source:"source.png",spec:fittedWork,
      output:"out/deformation-state.png",overwrite:true},
  });
  assert.equal(oversizedRender.result.structuredContent.ok,false);
  assert.equal(oversizedRender.result.structuredContent.error.code,"E_OUTPUT_LIMIT");
  assert.deepEqual(await readFile(path.join(fixtureRoot,"out/deformation-state.png")),stateBytes,
    "oversized full response replaced the existing PNG before rejection");
  const dryState = await activeClient.callTool("worldbend.run", {
    operation:"deformation_render",arguments:{source:"source.png",spec:fittedWork,
      output:"out/deformation-state.png",overwrite:true,dryRun:true,planView:"state"},
  });
  assert.equal(dryState.result.structuredContent.ok,true);
  assert.equal(dryState.result.structuredContent.result.evidence.outputSha256,sha256(stateBytes));
  assert.deepEqual(await readFile(path.join(fixtureRoot,"out/deformation-state.png")),stateBytes);


  const motionPlan = await activeClient.callTool("worldbend.run", {
    operation: "motion_plan",
    arguments: { spec: motionSpec },
  });
  assert.equal(motionPlan.result.structuredContent.ok, true);
  assert.equal(motionPlan.result.structuredContent.result.schema, "worldbend.motion-plan");
  assert.deepEqual(motionPlan.result.structuredContent.result.duration, {
    numerator: 1001,
    denominator: 15000,
  });

  const motionDry = await activeClient.callTool("worldbend.run", {
    operation: "motion_render",
    arguments: {
      sources: [{ id: "still", source: "source.png" }],
      spec: motionSpec,
      outputDirectory: "out/motion-dry",
      dryRun: true,
    },
  });
  assert.equal(motionDry.result.structuredContent.ok, true);
  assert.equal(motionDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "motion-dry")), false);

  const motionWritten = await activeClient.callTool("worldbend.run", {
    operation: "motion_render",
    arguments: {
      sources: [{ id: "still", source: "source.png" }],
      spec: motionSpec,
      outputDirectory: "out/motion",
    },
  });
  assert.equal(motionWritten.result.structuredContent.ok, true);
  assert.equal(motionWritten.result.structuredContent.result.items.length, 3);
  assert.deepEqual(
    motionWritten.result.structuredContent.result.items[1].presentationTime,
    { numerator: 1001, denominator: 30000 },
  );
  for (const item of motionWritten.result.structuredContent.result.items) {
    const bytes = await readFile(path.join(fixtureRoot, item.output));
    assert.equal(item.sha256, sha256(bytes));
  }
  metrics.motionResponseBytes = motionWritten.wireBytes;
}

async function checkLivePerspectiveCatalog(activeClient) {
  const elementSize = { width: 640, height: 360 };
  const poseInput = { elementSize, pose: { perspective: 1400, rotateX: 3, rotateY: -8 } };
  for (const [query, operation] of [["live card tilt", "pose"], ["collinear cards", "plane_strip"], ["卡片 共线", "plane_strip"]]) {
    const found = await activeClient.callTool("worldbend.search", { query });
    assert(found.result.structuredContent.result.operations.some(item => item.operation === operation), query);
  }
  for (const operation of ["pose", "plane_strip"]) {
    const descriptor = await activeClient.callTool("worldbend.describe", { operation });
    const contract = descriptor.result.structuredContent.result;
    assert.equal(contract.inputSchema.additionalProperties, false);
    // Operation output is the common success/error envelope. The geometry
    // result definition itself must stay closed within that envelope.
    const resultName = operation === "pose" ? "PlanePoseOutput" : "PlaneStripOutput";
    assert.equal(contract.outputSchema.$defs[resultName].additionalProperties, false);
  }
  const response = await activeClient.callTool("worldbend.run", { operation: "pose", arguments: poseInput });
  assert.equal(response.result.structuredContent.ok, true);
  const posed = response.result.structuredContent.result;
  const poseFile = path.join(fixtureRoot, "pose-input.json");
  await writeFile(poseFile, JSON.stringify(poseInput));
  const native = spawnSync(cli, ["pose", "--input", poseFile, "--json"], { encoding: "utf8" });
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(JSON.parse(native.stdout).result, posed);
  for (const [arguments_, code] of [
    [{...poseInput, extra:true}, "E_SCHEMA"],
    [{...poseInput, pose:{...poseInput.pose, cameraEstimate:true}}, "E_SCHEMA"],
    [{...poseInput, pose:{perspective:1400,depth:1400}}, "E_HOMOGRAPHY_HORIZON_CROSSING"],
    [{...poseInput, pose:{perspective:1400,rotateY:180}}, "E_QUAD_ORIENTATION"],
  ]) expectToolError(await activeClient.callTool("worldbend.run", {operation:"pose",arguments:arguments_}), code);
  const panels = Array.from({length:32}, (_,i)=>({id:`card-${i}`,start:i/32,end:(i+.9)/32,elementSize}));
  const stripInput = {spec:posed.spec,panels};
  const strip = await activeClient.callTool("worldbend.run", {operation:"plane_strip",arguments:stripInput});
  assert.equal(strip.result.structuredContent.ok, true);
  assert.deepEqual(strip.result.structuredContent.result.items.map(item=>item.id),panels.map(item=>item.id));
  const stripFile=path.join(fixtureRoot,"strip-input.json");await writeFile(stripFile,JSON.stringify(stripInput));
  const nativeStrip=spawnSync(cli,["plane-strip","--input",stripFile,"--json"],{encoding:"utf8"});
  assert.equal(nativeStrip.status,0,nativeStrip.stderr);
  assert.deepEqual(JSON.parse(nativeStrip.stdout).result,strip.result.structuredContent.result);
  for(const malformed of [[],[...panels,panels[0]],panels.map((panel,i)=>i===31?{...panel,start:0}:panel)]) {
    expectToolError(await activeClient.callTool("worldbend.run",{operation:"plane_strip",arguments:{...stripInput,panels:malformed}}),"E_SCHEMA");
  }
  const recovered=await activeClient.callTool("worldbend.run",{operation:"pose",arguments:poseInput});
  assert.equal(recovered.result.structuredContent.ok,true);
  const rig = {schema:"worldbend.card",version:"0.1",elementSize,
    geometry:{perspective:1400,pivot:{x:.25,y:.7},perspectiveOrigin:{x:.8,y:.2}},
    rest:{rotateY:180},tilt:{maxRotateX:10,maxRotateY:14,idle:{amplitudeX:20,amplitudeY:30,periodMs:5200}},
    action:{axis:"y",turns:2,durationMs:700,easing:{kind:"linear"}}};
  for (const [operation,arguments_,verify] of [
    ["card_pose",{rig,view:{rotateX:12,rotateY:32}},result=>assert.equal(result.face,"front")],
    ["card_pointer",{rig,x:1,y:0},result=>{assert.equal(result.tiltX,10);assert.equal(result.tiltY,14);}],
    ["card_idle",{rig,timeMs:1000},result=>{assert(Math.abs(result.tiltX)<=10);assert(Math.abs(result.tiltY)<=14);}],
    ["card_turn",{rig,progress:.75},result=>{assert.equal(result.angle,540);assert.equal(result.revolutions,1.5);assert.equal(result.face,"front");}],
  ]) {
    const description = await activeClient.callTool("worldbend.describe",{operation});
    assert.equal(description.result.structuredContent.result.inputSchema.additionalProperties,false);
    const sampled = await activeClient.callTool("worldbend.run",{operation,arguments:arguments_});
    assert.equal(sampled.result.structuredContent.ok,true);
    verify(sampled.result.structuredContent.result);
    const file = path.join(fixtureRoot,`${operation}.json`);
    await writeFile(file,JSON.stringify(arguments_));
    const executed = spawnSync(cli,[operation.replaceAll("_","-"),"--input",file,"--json"],{encoding:"utf8"});
    assert.equal(executed.status,0,executed.stderr);
    assert.deepEqual(JSON.parse(executed.stdout).result,sampled.result.structuredContent.result);
    expectToolError(await activeClient.callTool("worldbend.run",{operation,arguments:{...arguments_,extra:true}}),"E_SCHEMA");
  }
  const completed = await activeClient.callTool("worldbend.run",{operation:"card_turn",arguments:{rig,progress:1}});
  assert.equal(completed.result.structuredContent.result.face,"back");
  assert.equal(completed.result.structuredContent.result.angle,720);
  const edge = await activeClient.callTool("worldbend.run",{operation:"card_pose",arguments:{rig:{...rig,geometry:{perspective:1400}},view:{rotateY:90}}});
  assert.equal(edge.result.structuredContent.result.face,"edge");
  metrics.poseResponseBytes=response.wireBytes;metrics.strip32ResponseBytes=strip.wireBytes;
  console.log(`Live perspective CLI/MCP passed (pose=${response.wireBytes}B, strip32=${strip.wireBytes}B; four card operations, two-sided/cumulative turns, closed errors and recovery)`);
}

async function checkProgressiveCatalog(activeClient) {
  const response = await activeClient.request("tools/list", {});
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name).sort(),
    ["worldbend.describe", "worldbend.run", "worldbend.search"],
  );
  assert(
    response.wireBytes <= maxToolCatalogBytes,
    `progressive tools/list is ${response.wireBytes} bytes; budget is ${maxToolCatalogBytes}`,
  );
  metrics.catalogToolsListBytes = response.wireBytes;

  const search = await activeClient.callTool("worldbend.search", {
    query: "flatten plane",
  });
  assert.equal(search.result.structuredContent.ok, true);
  assert.deepEqual(
    search.result.structuredContent.result.operations.map((entry) => entry.operation),
    [
      "rectify",
      "rectify_render",
      "mockup_extract_plan",
      "mockup_extract_render",
    ],
  );

  const describe = await activeClient.callTool("worldbend.describe", {
    operation: "canvas_render",
  });
  assert.equal(describe.result.structuredContent.ok, true);
  assert.equal(describe.result.structuredContent.result.inputSchema.type, "object");
  assert(Array.isArray(describe.result.structuredContent.result.inputSchema.oneOf));
  assert.equal(describe.result.structuredContent.result.outputSchema.type, "object");

  const programDescription = await activeClient.callTool("worldbend.describe", {
    operation: "program_render",
  });
  assert.equal(programDescription.result.structuredContent.ok, true);
  assert.equal(
    programDescription.result.structuredContent.result.inputSchema.$defs.RasterProgramSpec
      .properties.schema.const,
    "worldbend.raster-program",
  );
  assert.equal(
    programDescription.result.structuredContent.result.inputSchema.$defs
      .ProgramRenderOptionsInput.properties.maxCumulativePixels.maximum,
    64 * 1024 * 1024,
  );

  const mockupSearch = await activeClient.callTool("worldbend.search", {
    query: "mockup packaging",
  });
  assert.equal(mockupSearch.result.structuredContent.ok, true);
  assert.deepEqual(
    mockupSearch.result.structuredContent.result.operations.map((entry) => entry.operation),
    [
      "mockup_plan",
      "mockup_render",
      "mockup_extract_plan",
      "mockup_extract_render",
    ],
  );
  const mockupDescription = await activeClient.callTool("worldbend.describe", {
    operation: "mockup_render",
  });
  assert.equal(mockupDescription.result.structuredContent.ok, true);
  assert.equal(
    mockupDescription.result.structuredContent.result.inputSchema.$defs.MockupSpec
      .properties.schema.type,
    "string",
  );

  const run = await activeClient.callTool("worldbend.run", {
    operation: "solve",
    arguments: { destination: pixelSpec.destination },
  });
  assert.equal(run.result.structuredContent.ok, true);
  assert.equal(
    run.result.structuredContent.result.spec.schema,
    "worldbend.transform",
  );
  assert.equal(run.result.structuredContent.result.diagnostics.geometry.convex, true);

  const rejected = await activeClient.callTool("worldbend.run", {
    operation: "solve",
    arguments: { destination: pixelSpec.destination, unexpected: true },
  });
  expectToolError(rejected, "E_SCHEMA");

  const programInspection = await activeClient.callTool("worldbend.run", {
    operation: "program_inspect",
    arguments: { spec: rasterProgramSpec },
  });
  assert.equal(programInspection.result.structuredContent.ok, true);
  assert.deepEqual(
    programInspection.result.structuredContent.result.stages.map((stage) => stage.id),
    ["perspective", "padding"],
  );

  const programDry = await activeClient.callTool("worldbend.run", {
    operation: "program_render",
    arguments: {
      source: "source.png",
      spec: rasterProgramSpec,
      output: "out/program-dry.png",
      dryRun: true,
    },
  });
  assert.equal(programDry.result.structuredContent.ok, true);
  assert.equal(programDry.result.structuredContent.result.status, "ready");
  assert.equal(programDry.result.structuredContent.result.evidence.outputWidth, 3);
  assert.equal(programDry.result.structuredContent.result.evidence.outputHeight, 2);
  assert.deepEqual(
    programDry.result.structuredContent.result.stages.map((stage) => stage.output),
    [{ width: 1, height: 1 }, { width: 3, height: 2 }],
  );
  assert.equal(await exists(path.join(fixtureRoot, "out", "program-dry.png")), false);

  const programWritten = await activeClient.callTool("worldbend.run", {
    operation: "program_render",
    arguments: {
      source: "source.png",
      spec: rasterProgramSpec,
      output: "out/program.png",
    },
  });
  assert.equal(programWritten.result.structuredContent.ok, true);
  assert.equal(programWritten.result.structuredContent.result.status, "written");
  const programBytes = await readFile(path.join(fixtureRoot, "out", "program.png"));
  assert.equal(
    programWritten.result.structuredContent.result.evidence.outputSha256,
    sha256(programBytes),
  );
  metrics.programResponseBytes = programWritten.wireBytes;

  const variationSearch = await activeClient.callTool("worldbend.search", {
    query: "variation job",
  });
  assert.equal(variationSearch.result.structuredContent.ok, true);
  assert.deepEqual(
    variationSearch.result.structuredContent.result.operations.map(
      (entry) => entry.operation,
    ),
    [
      // figma_mockup_publish scores on 渲染/交付-adjacent keywords for this query.
      "figma_mockup_publish",
      "document_delivery_plan",
      "variation_plan",
      "variation_render",
    ],
  );
  const variationDescription = await activeClient.callTool("worldbend.describe", {
    operation: "variation_render",
  });
  assert.equal(variationDescription.result.structuredContent.ok, true);
  assert.equal(
    variationDescription.result.structuredContent.result.inputSchema.$defs
      .VariationJobSpec.properties.schema.const,
    "worldbend.variation-job",
  );
  assert.equal(
    variationDescription.result.structuredContent.result.inputSchema.$defs
      .VariationRenderOptionsInput.properties.maxProcessedPixels.maximum,
    64 * 1024 * 1024,
  );

  const templateInspection = await activeClient.callTool("worldbend.run", {
    operation: "template_inspect",
    arguments: { spec: spatialTemplateSpec },
  });
  assert.equal(templateInspection.result.structuredContent.ok, true);
  assert.deepEqual(
    templateInspection.result.structuredContent.result.sourceSlots,
    ["artwork"],
  );
  assert.deepEqual(
    templateInspection.result.structuredContent.result.outputs.map((output) => output.id),
    ["hero", "thumbnail"],
  );

  const variationPlan = await activeClient.callTool("worldbend.run", {
    operation: "variation_plan",
    arguments: { spec: variationJobSpec },
  });
  assert.equal(variationPlan.result.structuredContent.ok, true);
  assert.equal(variationPlan.result.structuredContent.result.outputCount, 4);
  assert.deepEqual(variationPlan.result.structuredContent.result.assetIds, ["asset-a"]);

  const variationDry = await activeClient.callTool("worldbend.run", {
    operation: "variation_render",
    arguments: {
      assets: [{ id: "asset-a", source: "source.png" }],
      spec: variationJobSpec,
      outputDirectory: "out/variation-dry",
      dryRun: true,
    },
  });
  assert.equal(variationDry.result.structuredContent.ok, true);
  assert.equal(variationDry.result.structuredContent.result.status, "ready");
  assert.equal(variationDry.result.structuredContent.result.items.length, 2);
  assert.equal(
    variationDry.result.content[0].text,
    "Variation Job ready: 2 planned items; 2 rendered, 0 failed; 4 actual outputs validated in out/variation-dry.",
  );
  assert.equal(
    await exists(path.join(fixtureRoot, "out", "variation-dry")),
    false,
  );

  const variationWritten = await activeClient.callTool("worldbend.run", {
    operation: "variation_render",
    arguments: {
      assets: [{ id: "asset-a", source: "source.png" }],
      spec: variationJobSpec,
      outputDirectory: "out/variations",
    },
  });
  assert.equal(variationWritten.result.structuredContent.ok, true);
  assert.equal(variationWritten.result.structuredContent.result.status, "written");
  assert.equal(
    variationWritten.result.content[0].text,
    "Variation Job written: 2 planned items; 2 rendered, 0 failed; 4 actual outputs written in out/variations.",
  );
  assert.equal(
    variationWritten.result.structuredContent.result.items[0].outputs[0].output,
    "out/variations/sku-a/hero.png",
  );
  for (const item of ["sku-a", "sku-b"]) {
    for (const output of ["hero.png", "thumbnail.png"]) {
      const bytes = await readFile(path.join(fixtureRoot, "out", "variations", item, output));
      const reported = variationWritten.result.structuredContent.result.items
        .find((entry) => entry.id === item)
        .outputs.find((entry) => entry.output.endsWith(`/${output}`));
      assert.equal(reported.sha256, sha256(bytes));
    }
  }
  metrics.variationResponseBytes = variationWritten.wireBytes;
  for (const [index, item] of variationWritten.result.structuredContent.result.items.entries()) {
    assert.equal(item.status, "rendered");
    assert.equal(item.index, index);
    assert(item.rootWidth > 0 && item.rootHeight > 0 && item.operationPixels > 0);
    assert.equal(Object.hasOwn(item, "root_width"), false);
  }
  assert(JSON.stringify(variationDescription.result.structuredContent.result.outputSchema).includes("rootWidth"));
  await checkContinueVariation(activeClient);

  const missingVariationAsset = await activeClient.callTool("worldbend.run", {
    operation: "variation_render",
    arguments: {
      assets: [],
      spec: variationJobSpec,
      outputDirectory: "out/variation-missing",
    },
  });
  expectToolError(missingVariationAsset, "E_SCHEMA");
  assert.equal(
    await exists(path.join(fixtureRoot, "out", "variation-missing")),
    false,
  );

  const invalidLateStage = structuredClone(rasterProgramSpec);
  invalidLateStage.stages[1] = {
    kind: "canvas",
    id: "bad-crop",
    spec: {
      schema: "worldbend.canvas",
      version: "0.1",
      operation: { kind: "crop", rect: { x: 1, y: 0, width: 1, height: 1 } },
    },
  };
  const failedProgram = await activeClient.callTool("worldbend.run", {
    operation: "program_render",
    arguments: {
      source: "source.png",
      spec: invalidLateStage,
      output: "out/program-failed.png",
    },
  });
  expectToolError(failedProgram, "E_CROP_BOUNDS");
  assert.equal(await exists(path.join(fixtureRoot, "out", "program-failed.png")), false);
  assert.deepEqual(await programStagingDirectories(), []);

  const slowProgram = {
    schema: "worldbend.raster-program",
    version: "0.1",
    stages: [
      {
        kind: "transform",
        id: "large",
        spec: makePixelSpec(8000, 4000),
        canvas: "reference",
      },
    ],
  };
  const programRequest = activeClient.beginRequest("tools/call", {
    name: "worldbend.run",
    arguments: {
      operation: "program_render",
      arguments: {
        source: "source.png",
        spec: slowProgram,
        output: "out/program-cancelled.png",
        dryRun: true,
        options: { quality: "high" },
      },
    },
  });
  const programOutcomePromise = programRequest.promise.then(
    (response) => ({ kind: "response", response }),
    (error) => ({ kind: "error", error }),
  );
  await waitFor(async () => (await programStagingDirectories()).length > 0, 2_000);
  const programCancelledAt = Date.now();
  activeClient.notify("notifications/cancelled", {
    requestId: programRequest.id,
    reason: "runtime smoke Program cancellation",
  });
  await waitFor(async () => (await programStagingDirectories()).length === 0, 10_000);
  metrics.programCancelCleanupMs = Date.now() - programCancelledAt;
  assert(
    metrics.programCancelCleanupMs < 1_500,
    `Program cancellation cleanup took ${metrics.programCancelCleanupMs}ms`,
  );
  const programOutcome = await Promise.race([
    programOutcomePromise,
    new Promise((resolve) => setTimeout(() => resolve({ kind: "noResponse" }), 100)),
  ]);
  if (programOutcome.kind === "response") {
    assert.equal(programOutcome.response.result?.isError, true);
  }
  assert.equal(await exists(path.join(fixtureRoot, "out", "program-cancelled.png")), false);

  const mockupPlan = await activeClient.callTool("worldbend.run", {
    operation: "mockup_plan",
    arguments: { spec: mockupSpec },
  });
  assert.equal(mockupPlan.result.structuredContent.ok, true);
  assert.deepEqual(
    mockupPlan.result.structuredContent.result.planes.map((plane) => plane.id),
    ["front", "side"],
  );
  assert.equal(mockupPlan.result.structuredContent.result.seams[0].reversed, true);

  const mockupDry = await activeClient.callTool("worldbend.run", {
    operation: "mockup_render",
    arguments: {
      sources: [
        { id: "artwork", source: "source.png" },
        { id: "side-artwork", source: "source.jpg" },
      ],
      spec: mockupSpec,
      output: "out/mockup-dry.png",
      dryRun: true,
    },
  });
  assert.equal(mockupDry.result.structuredContent.ok, true);
  assert.equal(mockupDry.result.structuredContent.result.status, "ready");
  assert.equal(mockupDry.result.structuredContent.result.evidence.outputWidth, 4);
  assert.equal(mockupDry.result.structuredContent.result.evidence.outputHeight, 2);
  assert.equal(await exists(path.join(fixtureRoot, "out", "mockup-dry.png")), false);

  const mockupWritten = await activeClient.callTool("worldbend.run", {
    operation: "mockup_render",
    arguments: {
      sources: [
        { id: "artwork", source: "source.png" },
        { id: "side-artwork", source: "source.jpg" },
      ],
      spec: mockupSpec,
      output: "out/mockup.png",
    },
  });
  assert.equal(mockupWritten.result.structuredContent.ok, true);
  assert.equal(mockupWritten.result.structuredContent.result.status, "written");
  const mockupBytes = await readFile(path.join(fixtureRoot, "out", "mockup.png"));
  assert.deepEqual([...mockupBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(
    mockupWritten.result.structuredContent.result.evidence.outputSha256,
    sha256(mockupBytes),
  );
  assert.deepEqual(await stagingDirectories(), []);

  const extractPlan = await activeClient.callTool("worldbend.run", {
    operation: "mockup_extract_plan",
    arguments: { spec: mockupExtractSpec },
  });
  assert.equal(extractPlan.result.structuredContent.ok, true);
  assert.deepEqual(
    extractPlan.result.structuredContent.result.outputs.map((output) => output.filename),
    ["front.png", "detail.png"],
  );

  const extractDry = await activeClient.callTool("worldbend.run", {
    operation: "mockup_extract_render",
    arguments: {
      source: "source.png",
      spec: mockupExtractSpec,
      outputDirectory: "out/extract-dry",
      dryRun: true,
    },
  });
  assert.equal(extractDry.result.structuredContent.ok, true);
  assert.equal(extractDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "extract-dry")), false);

  const extractWritten = await activeClient.callTool("worldbend.run", {
    operation: "mockup_extract_render",
    arguments: {
      source: "source.png",
      spec: mockupExtractSpec,
      outputDirectory: "out/extracted",
    },
  });
  assert.equal(extractWritten.result.structuredContent.ok, true);
  assert.equal(extractWritten.result.structuredContent.result.status, "written");
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "out", "extracted"))).sort(),
    ["detail.png", "front.png"],
  );
  for (const item of extractWritten.result.structuredContent.result.items) {
    const bytes = await readFile(path.join(fixtureRoot, item.output));
    assert.equal(item.sha256, sha256(bytes));
  }

  const meshPlan = await activeClient.callTool("worldbend.run", {
    operation: "mesh_plan",
    arguments: { spec: meshSpec },
  });
  assert.equal(meshPlan.result.structuredContent.ok, true);
  assert.equal(meshPlan.result.structuredContent.result.spec.mesh.subdivisions, 2);

  const meshDry = await activeClient.callTool("worldbend.run", {
    operation: "mesh_render",
    arguments: {
      source: "source.png",
      spec: meshSpec,
      output: "out/mesh-dry.png",
      dryRun: true,
    },
  });
  assert.equal(meshDry.result.structuredContent.ok, true);
  assert.equal(meshDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "mesh-dry.png")), false);

  const meshWritten = await activeClient.callTool("worldbend.run", {
    operation: "mesh_render",
    arguments: {
      source: "source.png",
      spec: meshSpec,
      output: "out/mesh.png",
    },
  });
  assert.equal(meshWritten.result.structuredContent.ok, true);
  const meshBytes = await readFile(path.join(fixtureRoot, "out", "mesh.png"));
  assert.equal(meshWritten.result.structuredContent.result.evidence.outputSha256, sha256(meshBytes));

  const remapPlan = await activeClient.callTool("worldbend.run", {
    operation: "remap_plan",
    arguments: { spec: remapSpec },
  });
  assert.equal(remapPlan.result.structuredContent.ok, true);
  assert.equal(remapPlan.result.structuredContent.result.requiresMap, false);

  const remapWithUnknownOperationField = structuredClone(remapSpec);
  remapWithUnknownOperationField.operation.unexpected = true;
  expectToolError(
    await activeClient.callTool("worldbend.run", {
      operation: "remap_plan",
      arguments: { spec: remapWithUnknownOperationField },
    }),
    "E_SCHEMA",
  );

  const remapDry = await activeClient.callTool("worldbend.run", {
    operation: "remap_render",
    arguments: {
      source: "source.png",
      spec: remapSpec,
      output: "out/remap-dry.png",
      dryRun: true,
    },
  });
  assert.equal(remapDry.result.structuredContent.ok, true);
  assert.equal(remapDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "remap-dry.png")), false);

  const remapWritten = await activeClient.callTool("worldbend.run", {
    operation: "remap_render",
    arguments: {
      source: "source.png",
      spec: remapSpec,
      output: "out/remap.png",
    },
  });
  assert.equal(remapWritten.result.structuredContent.ok, true);
  const remapBytes = await readFile(path.join(fixtureRoot, "out", "remap.png"));
  assert.equal(
    remapWritten.result.structuredContent.result.evidence.outputSha256,
    sha256(remapBytes),
  );

  const missingMap = await activeClient.callTool("worldbend.run", {
    operation: "remap_render",
    arguments: {
      source: "source.png",
      spec: makeDisplacementSpec(),
      output: "out/missing-map.png",
      dryRun: true,
    },
  });
  expectToolError(missingMap, "E_SCHEMA");

  const timelinePlan = await activeClient.callTool("worldbend.run", {
    operation: "timeline_plan",
    arguments: { spec: timelineSpec },
  });
  assert.equal(timelinePlan.result.structuredContent.ok, true);
  assert.deepEqual(
    timelinePlan.result.structuredContent.result.frames.map((frame) => frame.id),
    ["frame-000000", "frame-000001"],
  );

  const timelineWithUnknownProgramField = structuredClone(timelineSpec);
  timelineWithUnknownProgramField.program.unexpected = true;
  expectToolError(
    await activeClient.callTool("worldbend.run", {
      operation: "timeline_plan",
      arguments: { spec: timelineWithUnknownProgramField },
    }),
    "E_SCHEMA",
  );

  const timelineDry = await activeClient.callTool("worldbend.run", {
    operation: "timeline_render",
    arguments: {
      sources: [{ id: "still", source: "source.png" }],
      spec: timelineSpec,
      outputDirectory: "out/timeline-dry",
      dryRun: true,
    },
  });
  assert.equal(timelineDry.result.structuredContent.ok, true);
  assert.equal(timelineDry.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "timeline-dry")), false);

  const timelineWritten = await activeClient.callTool("worldbend.run", {
    operation: "timeline_render",
    arguments: {
      sources: [{ id: "still", source: "source.png" }],
      spec: timelineSpec,
      outputDirectory: "out/timeline",
    },
  });
  assert.equal(timelineWritten.result.structuredContent.ok, true);
  assert.equal(timelineWritten.result.structuredContent.result.status, "written");
  assert.deepEqual(
    (await readdir(path.join(fixtureRoot, "out", "timeline"))).sort(),
    ["frame-000000.png", "frame-000001.png"],
  );
  for (const item of timelineWritten.result.structuredContent.result.items) {
    const bytes = await readFile(path.join(fixtureRoot, item.output));
    assert.equal(item.sha256, sha256(bytes));
  }

  const timelineSeventeenWritten = await activeClient.callTool("worldbend.run", {
    operation: "timeline_render",
    arguments: {
      sources: [{ id: "still", source: "source.png" }],
      spec: makeTimelineSpec(17),
      outputDirectory: "out/timeline-17",
    },
  });
  assert.equal(timelineSeventeenWritten.result.structuredContent.ok, true);
  assert.equal(timelineSeventeenWritten.result.structuredContent.result.items.length, 17);
  assert.equal((await readdir(path.join(fixtureRoot, "out", "timeline-17"))).length, 17);
}

async function checkContinueVariation(activeClient) {
  const continued = structuredClone(variationJobSpec);
  continued.failurePolicy = "continue";
  continued.items[1].bindings[0].assetId = "unavailable";
  for (const [name, assets, expected] of [
    ["missing", [{ id: "asset-a", source: "source.png" }], "E_SCHEMA"],
    ["corrupt", [{ id: "asset-a", source: "source.png" }, { id: "unavailable", source: "source.svg" }], "E_UNSUPPORTED_MEDIA"],
  ]) {
    const outputDirectory = `out/continue-${name}`;
    const response = await activeClient.callTool("worldbend.run", {
      operation: "variation_render", arguments: { assets, spec: continued, outputDirectory },
    });
    assert.equal(response.result.structuredContent.ok, true);
    const result = response.result.structuredContent.result;
    assert.deepEqual(result.items.map(item => [item.index, item.id, item.status]), [[0, "sku-a", "rendered"], [1, "sku-b", "failed"]]);
    assert.equal(result.items[1].error.code, expected);
    assert.equal(
      response.result.content[0].text,
      `Variation Job written: 2 planned items; 1 rendered, 1 failed; 2 actual outputs written in ${outputDirectory}.`,
    );
    assert.deepEqual(await readdir(path.join(fixtureRoot, outputDirectory)), ["sku-a"]);
  }
  for (const dryRun of [true, false]) {
    const outputDirectory = `out/continue-empty-${dryRun}`;
    const response = await activeClient.callTool("worldbend.run", {
      operation: "variation_render", arguments: { assets: [], spec: continued, outputDirectory, dryRun },
    });
    assert.equal(response.result.structuredContent.ok, true, JSON.stringify(response.result.structuredContent));
    assert.equal(response.result.structuredContent.result.dryRun, dryRun);
    assert(response.result.structuredContent.result.items.every(item => item.status === "failed"));
    assert.equal(
      response.result.content[0].text,
      `Variation Job ${dryRun ? "ready" : "written"}: 2 planned items; 0 rendered, 2 failed; 0 actual outputs ${dryRun ? "validated" : "written"} in ${outputDirectory}.`,
    );
    assert.equal(await exists(path.join(fixtureRoot, outputDirectory)), !dryRun);
    if (!dryRun) assert.deepEqual(await readdir(path.join(fixtureRoot, outputDirectory)), []);
  }
  const emptySpecPath = path.join(fixtureRoot, "continue-empty.json");
  await writeFile(emptySpecPath, JSON.stringify(continued));
  const emptyOutput = path.join(fixtureRoot, "out/continue-empty-cli");
  const emptyCli = runCli(["variation-render", "--spec", emptySpecPath, "--output-directory", emptyOutput, "--json"]);
  assert.equal(emptyCli.status, 0);
  assert.equal(emptyCli.body.ok, true);
  assert(emptyCli.body.result.items.every(item => item.status === "failed"));
  assert.deepEqual(await readdir(emptyOutput), []);
  continued.template.operation = {
    kind: "rasterProgram", sourceSlot: "artwork", program: {
      schema: "worldbend.raster-program", version: "0.1", stages: [
        { kind: "canvas", id: "work", spec: { schema: "worldbend.canvas", version: "0.1", operation: { kind: "stretch", output: { width: 4, height: 4 } } } },
        { kind: "canvas", id: "fail", spec: { schema: "worldbend.canvas", version: "0.1", operation: { kind: "crop", rect: { x: 5, y: 0, width: 1, height: 1 } } } },
      ],
    },
  };
  continued.items = Array.from({ length: 8 }, (_, i) => ({ id: `item-${i}`, bindings: [{ slotId: "artwork", assetId: "asset-a" }] }));
  const response = await activeClient.callTool("worldbend.run", {
    operation: "variation_render", arguments: { assets: [{ id: "asset-a", source: "source.png" }], spec: continued,
      outputDirectory: "out/continue-budget", options: { maxProcessedPixels: 64 } },
  });
  assert.equal(response.result.structuredContent.ok, true);
  const result = response.result.structuredContent.result;
  assert.equal(result.cumulativeProcessedPixels, 64);
  assert.deepEqual(result.items.map(item => item.error.code), Array(4).fill("E_CROP_BOUNDS").concat(Array(4).fill("E_OUTPUT_LIMIT")));
  assert.deepEqual(await privateStagingDirectories(), []);

  const slow = structuredClone(variationJobSpec);
  slow.failurePolicy = "continue";
  slow.template.operation = { kind: "rasterProgram", sourceSlot: "artwork", program: {
    schema: "worldbend.raster-program", version: "0.1", stages: [
      { id: "large", kind: "transform", spec: makePixelSpec(8000, 4000), canvas: "reference" },
    ],
  } };
  const request = activeClient.beginRequest("tools/call", {
    name: "worldbend.run", arguments: { operation: "variation_render", arguments: {
      assets: [{ id: "asset-a", source: "source.png" }], spec: slow,
      outputDirectory: "out/continue-cancelled", options: { quality: "high" },
    } },
  });
  const outcomePromise = request.promise.then(
    response => ({ kind: "response", response }), error => ({ kind: "error", error }),
  );
  // Wait for the worker's inner render directory, not just admission/staging.
  await waitFor(async () => {
    const outer = (await privateStagingDirectories()).find(name => name.startsWith(".worldbend-variation-stage-"));
    return outer !== undefined && (await readdir(path.join(stagingRoot, outer)))
      .some(name => name.startsWith(".worldbend-variation-"));
  }, 2_000);
  const cancelledAt = Date.now();
  activeClient.notify("notifications/cancelled", { requestId: request.id, reason: "active continue variation cancellation" });
  await waitFor(async () => (await privateStagingDirectories()).length === 0, 10_000);
  metrics.variationCancelCleanupMs = Date.now() - cancelledAt;
  assert(metrics.variationCancelCleanupMs < 1_500, `Continue cancellation cleanup took ${metrics.variationCancelCleanupMs}ms`);
  const outcome = await Promise.race([outcomePromise,
    new Promise(resolve => setTimeout(() => resolve({ kind: "noResponse" }), 100)),
  ]);
  if (outcome.kind === "response") assert.equal(outcome.response.result?.isError, true);
  assert.equal(await exists(path.join(fixtureRoot, "out/continue-cancelled")), false);
}

async function checkEveryToolRejectsUnknownFields(activeClient) {
  const calls = [
    [
      "worldbend.compose",
      {
        spec: normalizedSpec,
        targetSize: { width: 100, height: 50 },
        transform: { rotationDegrees: 90 },
        unexpected: true,
      },
    ],
    [
      "worldbend.solve",
      { destination: pixelSpec.destination, unexpected: true },
    ],
    ["worldbend.inspect", { spec: pixelSpec, unexpected: true }],
    ["worldbend.rectify", { spec: rectifySpec, unexpected: true }],
    [
      "worldbend.canvas_render",
      {
        source: "source.png",
        outputDirectory: "out/unknown-canvas",
        dryRun: true,
        spec: canvasSetSpec,
        unexpected: true,
      },
    ],
    [
      "worldbend.render",
      {
        source: "source.png",
        output: "out/unknown.png",
        dryRun: true,
        spec: pixelSpec,
        unexpected: true,
      },
    ],
    [
      "worldbend.rectify_render",
      {
        source: "source.png",
        output: "out/unknown-rectify.png",
        dryRun: true,
        spec: rectifySpec,
        unexpected: true,
      },
    ],
    [
      "worldbend.css",
      {
        spec: pixelSpec,
        elementSize: { width: 100, height: 100 },
        unexpected: true,
      },
    ],
  ];
  for (const [name, arguments_] of calls) {
    const response = await activeClient.callTool(name, arguments_);
    expectToolError(response, "E_SCHEMA");
    assert(
      response.result.content[0].text.length < 2 * 1024,
      `${name} schema error text is not bounded`,
    );
  }
}

async function checkToolCatalog(activeClient) {
  const response = await activeClient.request("tools/list", {});
  assert.deepEqual(
    response.result.tools.map((tool) => tool.name).sort(),
    [
      "worldbend.canvas_render",
      "worldbend.compose",
      "worldbend.css",
      "worldbend.inspect",
      "worldbend.rectify",
      "worldbend.rectify_render",
      "worldbend.render",
      "worldbend.solve",
    ],
  );
  // The profile owns the catalog ceiling so packaging and runtime checks cannot
  // silently drift apart.
  assert(
    response.wireBytes <= maxDirectToolCatalogBytes,
    `direct tools/list is ${response.wireBytes} bytes; budget is ${maxDirectToolCatalogBytes}`,
  );
  metrics.toolsListBytes = response.wireBytes;

  const tools = new Map(response.result.tools.map((tool) => [tool.name, tool]));
  const solveSchema = tools.get("worldbend.solve").inputSchema;
  const destination = solveSchema.$defs.Destination;
  assert.equal(destination.oneOf.length, 2);
  const pixel = destination.oneOf.find(
    (variant) => variant.properties.space.const === "pixel",
  );
  const normalized = destination.oneOf.find(
    (variant) => variant.properties.space.const === "normalized",
  );
  assert.deepEqual(Object.keys(pixel.properties).sort(), ["quad", "reference", "space"]);
  assert.deepEqual([...pixel.required].sort(), ["quad", "reference", "space"]);
  assert.equal(pixel.additionalProperties, false);
  assert.deepEqual(Object.keys(normalized.properties).sort(), ["quad", "space"]);
  assert.deepEqual([...normalized.required].sort(), ["quad", "space"]);
  assert.equal(normalized.additionalProperties, false);

  const transformSpec = tools.get("worldbend.inspect").inputSchema.$defs.TransformSpec;
  assert.equal(transformSpec.properties.schema.const, "worldbend.transform");
  assert.equal(transformSpec.properties.version.const, "0.1");
  const size = tools.get("worldbend.inspect").inputSchema.$defs.Size;
  assert.equal(size.properties.width.exclusiveMinimum, 0);
  assert.equal(size.properties.height.exclusiveMinimum, 0);

  const rectifyInput = tools.get("worldbend.rectify").inputSchema;
  const sourcePlane = rectifyInput.$defs.SourcePlane;
  assert.equal(sourcePlane.oneOf.length, 2);
  const normalizedSource = sourcePlane.oneOf.find(
    (variant) => variant.properties.space.const === "normalized",
  );
  assert.deepEqual(Object.keys(normalizedSource.properties).sort(), ["quad", "space"]);
  assert.equal(normalizedSource.additionalProperties, false);
  const pixelSize = rectifyInput.$defs.PixelSize;
  assert.equal(pixelSize.properties.width.minimum, 1);
  assert.equal(pixelSize.properties.height.minimum, 1);
  const rectifyRenderInput = tools.get("worldbend.rectify_render").inputSchema;
  assert.equal(rectifyRenderInput.properties.options.$ref.endsWith("RectifyRenderOptionsInput"), true);
  assert.equal(JSON.stringify(rectifyRenderInput).includes('"canvas"'), false);
  assert.equal(JSON.stringify(rectifyRenderInput).includes('"targetSize"'), false);

  const canvasInput = tools.get("worldbend.canvas_render").inputSchema;
  assert.deepEqual(canvasInput.oneOf[0].required, ["source", "outputDirectory", "spec"]);
  assert.deepEqual(canvasInput.oneOf[0].not.anyOf, [
    { required: ["plan"] },
    { required: ["sampling"] },
    { required: ["outsideFill"] },
  ]);
  assert.deepEqual(canvasInput.oneOf[1].required, [
    "source",
    "outputDirectory",
    "plan",
    "sampling",
    "outsideFill",
  ]);
  assert.deepEqual(canvasInput.oneOf[1].not.anyOf, [
    { required: ["spec"] },
    { required: ["quality"] },
  ]);
  assert.equal(canvasInput.additionalProperties, false);
  assert.equal(canvasInput.$defs.CanvasSetSpec.properties.variants.minItems, 1);
  assert.equal(canvasInput.$defs.CanvasSetSpec.properties.variants.maxItems, 16);
  assert.equal(canvasInput.$defs.CanvasVariant.properties.id.maxLength, 64);
  assert.equal(
    canvasInput.$defs.CanvasVariant.properties.id.pattern,
    "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",
  );
  assert.equal(canvasInput.$defs.NormalizedAnchor.properties.x.minimum, 0);
  assert.equal(canvasInput.$defs.NormalizedAnchor.properties.x.maximum, 1);
  assert.equal(canvasInput.$defs.NormalizedAnchor.properties.y.minimum, 0);
  assert.equal(canvasInput.$defs.NormalizedAnchor.properties.y.maximum, 1);
  assert.equal(tools.get("worldbend.canvas_render").annotations.readOnlyHint, false);
  assert.equal(tools.get("worldbend.canvas_render").annotations.destructiveHint, false);
  assert.equal(tools.get("worldbend.canvas_render").annotations.idempotentHint, false);

  const renderLimits = tools.get("worldbend.render").inputSchema.$defs.RenderLimitsInput;
  assert.equal(renderLimits.properties.maxWidth.maximum, 8192);
  assert.equal(renderLimits.properties.maxHeight.maximum, 8192);
  // 32 MiP keeps the worst-case decode + mip + output buffers under the
  // 768 MiB worker memory ceiling (see MCP_MAX_PIXELS in the MCP server).
  assert.equal(renderLimits.properties.maxPixels.maximum, 32 * 1024 * 1024);
  assert.equal(renderLimits.properties.maxSourceBytes.maximum, 64 * 1024 * 1024);
  assert.equal(renderLimits.required, undefined);

  const renderOutput = tools.get("worldbend.render").outputSchema;
  const renderOutputDefs = renderOutput.$defs;
  const positiveUint32Outputs = [
    ["placement.width", renderOutputDefs.CanvasPlacement.properties.width],
    ["placement.height", renderOutputDefs.CanvasPlacement.properties.height],
    ["diagnostics.sourceWidth", renderOutputDefs.RenderDiagnostics.properties.sourceWidth],
    ["diagnostics.sourceHeight", renderOutputDefs.RenderDiagnostics.properties.sourceHeight],
    ["evidence.outputWidth", renderOutputDefs.RenderEvidence.properties.outputWidth],
    ["evidence.outputHeight", renderOutputDefs.RenderEvidence.properties.outputHeight],
  ];
  for (const [name, schema] of positiveUint32Outputs) {
    assert.equal(schema.type, "integer", `${name} must remain an integer`);
    assert.equal(schema.minimum, 1, `${name} must be positive`);
    assert.equal(schema.maximum, 2 ** 32 - 1, `${name} must carry the u32 maximum`);
    assert.equal(schema.format, undefined, `${name} must not depend on a custom format`);
    // Ajv-style JavaScript validation must reject the first value outside the
    // Rust u32 domain using standard JSON Schema keywords alone.
    assert.equal(acceptsStandardIntegerKeywords(schema, 2 ** 32 - 1), true);
    assert.equal(acceptsStandardIntegerKeywords(schema, 2 ** 32), false);
  }

  const outputBytes = renderOutputDefs.FileRenderResult.properties.bytes;
  assert.equal(outputBytes.type, "integer");
  assert.equal(outputBytes.minimum, 0);
  assert.equal(outputBytes.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(outputBytes.format, undefined);
  assert.equal(acceptsStandardIntegerKeywords(outputBytes, Number.MAX_SAFE_INTEGER), true);
  assert.equal(acceptsStandardIntegerKeywords(outputBytes, Number.MAX_SAFE_INTEGER + 1), false);
  assert.equal(
    acceptsStandardIntegerKeywords(outputBytes, JSON.parse("18446744073709551616")),
    false,
    "the JavaScript-rounded 2^64 value must still be rejected",
  );

  const composeSchema = tools.get("worldbend.compose").inputSchema.$defs;
  assert.equal(composeSchema.Scale2D.properties.x.exclusiveMinimum, 1e-6);
  assert.equal(composeSchema.Scale2D.properties.y.exclusiveMinimum, 1e-6);
  assert.equal(composeSchema.Skew2D.properties.xDegrees.exclusiveMinimum, -89);
  assert.equal(composeSchema.Skew2D.properties.xDegrees.exclusiveMaximum, 89);
  assert.equal(composeSchema.Skew2D.properties.yDegrees.exclusiveMinimum, -89);
  assert.equal(composeSchema.Skew2D.properties.yDegrees.exclusiveMaximum, 89);
  assert.equal(composeSchema.WarpSpec.properties.amount.minimum, -1);
  assert.equal(composeSchema.WarpSpec.properties.amount.maximum, 1);
  assert.deepEqual(composeSchema.WarpPreset.enum, [
    "arc", "arch", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze", "twist",
  ]);
  const composeOutput = tools.get("worldbend.compose").outputSchema;
  const composeResult = JSON.stringify(composeOutput);
  for (const artifact of ["rawQuad", "rawBounds", "canvas", "spec", "matrix", "diagnostics"]) {
    assert(composeResult.includes(artifact), `compose output schema lacks ${artifact}`);
  }

  for (const tool of tools.values()) {
    assert.equal(tool.outputSchema.type, "object");
    assert.deepEqual(
      tool.outputSchema.anyOf
        .map((variant) => variant.properties.ok.const)
        .sort(),
      [false, true],
    );
  }
}

function acceptsStandardIntegerKeywords(schema, value) {
  return Number.isInteger(value)
    && (schema.minimum === undefined || value >= schema.minimum)
    && (schema.maximum === undefined || value <= schema.maximum);
}

async function checkCompose(activeClient) {
  const composed = await activeClient.callTool("worldbend.compose", {
    spec: normalizedSpec,
    targetSize: { width: 100, height: 50 },
    transform: { rotationDegrees: 90 },
  });
  assert.equal(composed.result.isError, false);
  assert.equal(composed.result.structuredContent.ok, true);
  const result = composed.result.structuredContent.result;
  assert.deepEqual(result.canvas, {
    origin: { x: 25, y: -25 },
    size: { width: 50, height: 100 },
  });
  assert.equal(result.spec.destination.space, "normalized");
  // The MCP result must carry the contract's full six-artifact composition,
  // not a truncated spec+canvas projection.
  assert.equal(result.rawQuad.tl.x, 75);
  assert.equal(result.matrix.length, 9);
  assert.equal(result.diagnostics.geometry.convex, true);
  assert.deepEqual(Object.keys(result.rawBounds).sort(), ["height", "width", "x", "y"]);
  mcpComposeResult = result;

  expectToolError(
    await activeClient.callTool("worldbend.compose", {
      spec: normalizedSpec,
      transform: { rotationDegrees: 90 },
    }),
    "E_SCHEMA",
  );

  // Explicit source flips: geometry is untouched and only the recorded
  // orientation differs. Same rotation recipe with and without the flip.
  const flipped = await activeClient.callTool("worldbend.compose", {
    spec: normalizedSpec,
    targetSize: { width: 100, height: 50 },
    transform: { rotationDegrees: 90, flip: { x: true, y: false } },
  });
  assert.equal(flipped.result.isError, false);
  const flippedResult = flipped.result.structuredContent.result;
  assert.equal(flippedResult.spec.content.orientation, "flipHorizontal");
  assert.deepEqual(flippedResult.rawQuad, result.rawQuad);
  assert.deepEqual(flippedResult.matrix, result.matrix);
  assert.deepEqual(flippedResult.canvas, result.canvas);
  mcpFlippedComposeResult = flippedResult;

  const warped = await activeClient.callTool("worldbend.compose", {
    spec: normalizedSpec,
    targetSize: { width: 100, height: 50 },
    transform: { rotationDegrees: 90, warp: { preset: "arc", amount: 0.75 } },
  });
  assert.equal(warped.result.isError, false);
  const warpedResult = warped.result.structuredContent.result;
  assert.deepEqual(warpedResult.spec.content.warp, { preset: "arc", amount: 0.75 });
  assert.deepEqual(warpedResult.rawQuad, result.rawQuad);
  assert.deepEqual(warpedResult.matrix, result.matrix);
  assert.deepEqual(warpedResult.canvas, result.canvas);
  mcpWarpComposeResult = warpedResult;

  const cleared = await activeClient.callTool("worldbend.compose", {
    spec: warpedResult.spec,
    targetSize: warpedResult.canvas.size,
    transform: { clearWarp: true },
  });
  assert.equal(cleared.result.isError, false);
  const clearedResult = cleared.result.structuredContent.result;
  assert.equal(clearedResult.spec.content.warp, undefined);
  mcpClearWarpComposeResult = clearedResult;
  await writeFile(
    path.join(fixtureRoot, "warped.projective.json"),
    JSON.stringify(warpedResult.spec),
  );

  expectToolError(
    await activeClient.callTool("worldbend.compose", {
      spec: warpedResult.spec,
      targetSize: warpedResult.canvas.size,
      transform: {
        clearWarp: true,
        warp: { preset: "wave", amount: 0.5 },
      },
    }),
    "E_SCHEMA",
  );
}

async function checkSolveAndStructuredErrors(activeClient) {
  expectToolError(
    await activeClient.request("tools/call", { name: "worldbend.solve" }),
    "E_SCHEMA",
  );
  expectToolError(
    await activeClient.request("tools/call", {
      name: "worldbend.solve",
      arguments: null,
    }),
    "E_SCHEMA",
  );

  const solved = await activeClient.callTool("worldbend.solve", {
    destination: pixelSpec.destination,
  });
  assert.equal(solved.result.isError, false);
  assert.equal(solved.result.structuredContent.ok, true);
  assert.equal(solved.result.structuredContent.result.spec.schema, "worldbend.transform");
  assert.equal(solved.result.content[0].text, "Projective plane solved and validated.");
  assert(solved.wireBytes < 256 * 1024);
  metrics.solveResponseBytes = solved.wireBytes;
  mcpSolveResult = solved.result.structuredContent.result;

  const hugeUnknownField = `unknown_${"x".repeat(64 * 1024)}`;
  const malformed = await activeClient.callTool("worldbend.solve", {
    destination: pixelSpec.destination,
    [hugeUnknownField]: true,
  });
  expectToolError(malformed, "E_SCHEMA");
  assert(malformed.wireBytes < 8 * 1024, "schema error response is not bounded");
  assert(malformed.result.content[0].text.length < 2 * 1024);
  metrics.schemaErrorResponseBytes = malformed.wireBytes;
}

async function checkInspectAndCssNegatives(activeClient) {
  const inspected = await activeClient.callTool("worldbend.inspect", { spec: pixelSpec });
  assert.equal(inspected.result.isError, false);
  mcpInspectResult = inspected.result.structuredContent.result;

  const css = await activeClient.callTool("worldbend.css", {
    spec: pixelSpec,
    elementSize: { width: 64, height: 64 },
  });
  assert.equal(css.result.isError, false);
  mcpCssResult = css.result.structuredContent.result;

  const wrongVersion = structuredClone(pixelSpec);
  wrongVersion.version = "0.2";
  expectToolError(
    await activeClient.callTool("worldbend.inspect", { spec: wrongVersion }),
    "E_SCHEMA",
  );

  expectToolError(
    await activeClient.callTool("worldbend.css", {
      spec: normalizedSpec,
      elementSize: { width: 100, height: 100 },
    }),
    "E_SCHEMA",
  );
  expectToolError(
    await activeClient.callTool("worldbend.css", {
      spec: { ...pixelSpec, content: { fit: "stretch", warp: { preset: "wave", amount: 0.5 } } },
      elementSize: { width: 64, height: 64 },
    }),
    "E_SCHEMA",
  );
}

async function checkRectification(activeClient) {
  const planned = await activeClient.callTool("worldbend.rectify", { spec: rectifySpec });
  assert.equal(planned.result.isError, false);
  const plan = planned.result.structuredContent.result;
  assert.equal(plan.spec.schema, "worldbend.rectify");
  assert.equal(plan.outputSpec.schema, "worldbend.transform");
  assert.deepEqual(plan.outputQuad, {
    tl: { x: 0, y: 0 },
    tr: { x: 2, y: 0 },
    br: { x: 2, y: 2 },
    bl: { x: 0, y: 2 },
  });

  const dryRun = await activeClient.callTool("worldbend.rectify_render", {
    source: "source.png",
    output: "out/rectify-dry.png",
    dryRun: true,
    spec: rectifySpec,
  });
  assert.equal(dryRun.result.isError, false);
  const dryRunResult = dryRun.result.structuredContent.result;
  assert.equal(dryRunResult.status, "ready");
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.evidence.outputWidth, 2);
  assert.equal(dryRunResult.evidence.outputHeight, 2);
  assert.equal(await exists(path.join(fixtureRoot, "out", "rectify-dry.png")), false);

  const written = await activeClient.callTool("worldbend.rectify_render", {
    source: "source.png",
    output: "out/rectified.png",
    spec: rectifySpec,
  });
  assert.equal(written.result.isError, false);
  assert.equal(written.result.structuredContent.result.status, "written");
  const bytes = await readFile(path.join(fixtureRoot, "out", "rectified.png"));
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(written.result.structuredContent.result.evidence.outputSha256, sha256(bytes));
  assert.equal(
    dryRunResult.evidence.outputSha256,
    written.result.structuredContent.result.evidence.outputSha256,
  );
  assert.deepEqual(await stagingDirectories(), []);
}

async function checkCanvasRendering(activeClient) {
  const dryRun = await activeClient.callTool("worldbend.canvas_render", {
    source: "source.png",
    outputDirectory: "out/canvas-dry",
    spec: canvasSetSpec,
    quality: "standard",
    dryRun: true,
  });
  assert.equal(dryRun.result.isError, false);
  assert.equal(dryRun.result.structuredContent.ok, true);
  const dryResult = dryRun.result.structuredContent.result;
  assert.equal(dryResult.status, "ready");
  assert.equal(dryResult.dryRun, true);
  assert.equal(dryResult.outputDirectory, "out/canvas-dry");
  assert.equal(dryResult.plan.schema, "worldbend.canvas-set-plan");
  assert.deepEqual(dryResult.plan.sourceSize, { width: 1, height: 1 });
  assert.deepEqual(dryResult.items.map((item) => item.id), ["square", "wide"]);
  assert.deepEqual(
    dryResult.items.map((item) => item.output),
    ["out/canvas-dry/square.png", "out/canvas-dry/wide.png"],
  );
  assert.deepEqual(
    dryResult.items.map((item) => [item.width, item.height]),
    [[2, 2], [3, 2]],
  );
  assert(dryResult.items.every((item) => item.bytes > 0 && /^[0-9a-f]{64}$/.test(item.sha256)));
  assert.equal(await exists(path.join(fixtureRoot, "out", "canvas-dry")), false);
  assert(dryRun.wireBytes < 256 * 1024);
  metrics.canvasResponseBytes = dryRun.wireBytes;

  const written = await activeClient.callTool("worldbend.canvas_render", {
    source: "source.png",
    outputDirectory: "out/canvas-written",
    spec: canvasSetSpec,
    quality: "standard",
  });
  assert.equal(written.result.isError, false);
  const writtenResult = written.result.structuredContent.result;
  assert.equal(writtenResult.status, "written");
  assert.equal(writtenResult.dryRun, false);
  assert.deepEqual((await readdir(path.join(fixtureRoot, "out", "canvas-written"))).sort(), [
    "square.png",
    "wide.png",
  ]);
  for (const item of writtenResult.items) {
    const bytes = await readFile(path.join(fixtureRoot, item.output));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(item.sha256, sha256(bytes));
    assert.equal(item.bytes, bytes.byteLength);
  }

  const replay = await activeClient.callTool("worldbend.canvas_render", {
    source: "source.png",
    outputDirectory: "out/canvas-replay",
    plan: dryResult.plan,
    sampling: "linear",
    outsideFill: { kind: "transparent" },
  });
  assert.equal(replay.result.isError, false);
  const replayResult = replay.result.structuredContent.result;
  assert.deepEqual(replayResult.plan, dryResult.plan);
  assert.deepEqual(replayResult.items.map((item) => item.id), ["square", "wide"]);
  assert.deepEqual(
    replayResult.items.map((item) => item.sha256),
    writtenResult.items.map((item) => item.sha256),
  );

  expectToolError(
    await activeClient.callTool("worldbend.canvas_render", {
      source: "source.png",
      outputDirectory: "out/canvas-written",
      spec: canvasSetSpec,
    }),
    "E_DESTINATION_EXISTS",
  );
  assert.deepEqual((await readdir(path.join(fixtureRoot, "out", "canvas-written"))).sort(), [
    "square.png",
    "wide.png",
  ]);
  expectToolError(
    await activeClient.callTool("worldbend.canvas_render", {
      source: "source.png",
      outputDirectory: "../escaped-canvas",
      spec: canvasSetSpec,
      dryRun: true,
    }),
    "E_PATH_OUTSIDE_ROOT",
  );
  assert.deepEqual(await stagingDirectories(), []);
}

async function checkRenderLifecycle(activeClient) {
  const nonPositiveLimit = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/non-positive-limit.png",
    dryRun: true,
    spec: pixelSpec,
    options: {
      limits: {
        maxWidth: 0,
        maxHeight: 8192,
        maxPixels: 64 * 1024 * 1024,
        maxSourceBytes: 64 * 1024 * 1024,
      },
    },
  });
  expectToolError(nonPositiveLimit, "E_SCHEMA");

  const excessiveLimit = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/excessive-limit.png",
    dryRun: true,
    spec: pixelSpec,
    options: {
      limits: {
        maxWidth: 8193,
        maxHeight: 8192,
        maxPixels: 64 * 1024 * 1024,
        maxSourceBytes: 64 * 1024 * 1024,
      },
    },
  });
  expectToolError(excessiveLimit, "E_OUTPUT_LIMIT");

  const normalizedMissingTarget = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/normalized.png",
    dryRun: true,
    spec: normalizedSpec,
  });
  expectToolError(normalizedMissingTarget, "E_SCHEMA");

  const wrongExtension = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/result.jpg",
    dryRun: true,
    spec: pixelSpec,
  });
  expectToolError(wrongExtension, "E_SCHEMA");

  const dryRun = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/dry.png",
    dryRun: true,
    spec: pixelSpec,
    options: { limits: { maxWidth: 8192 } },
  });
  const dryRunResult = dryRun.result.structuredContent.result;
  mcpDryRunResult = dryRunResult;
  assert.equal(dryRunResult.status, "ready");
  assert.equal(dryRunResult.dryRun, true);
  assert.equal(dryRunResult.output, "out/dry.png");
  assert.equal(dryRunResult.evidence.outputFormat, "png");
  assert.match(dryRunResult.evidence.sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(dryRunResult.evidence.outputSha256, /^[0-9a-f]{64}$/);
  assert.equal(await exists(path.join(fixtureRoot, "out", "dry.png")), false);
  assert.deepEqual(await stagingDirectories(), []);

  const warpDryRun = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/warp-dry.png",
    dryRun: true,
    spec: { ...pixelSpec, content: { fit: "stretch", warp: { preset: "twist", amount: 1 } } },
  });
  assert.equal(warpDryRun.result.isError, false);
  assert.equal(warpDryRun.result.structuredContent.result.status, "ready");
  assert.equal(await exists(path.join(fixtureRoot, "out", "warp-dry.png")), false);

  const write = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/written.png",
    spec: pixelSpec,
  });
  const writeResult = write.result.structuredContent.result;
  assert.equal(writeResult.status, "written");
  assert.equal(writeResult.dryRun, false);
  const firstBytes = await readFile(path.join(fixtureRoot, "out", "written.png"));
  assert.deepEqual([...firstBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(writeResult.bytes, firstBytes.length);
  assert.equal(writeResult.evidence.outputSha256, sha256(firstBytes));
  assert.equal(
    writeResult.evidence.sourceSha256,
    sha256(await readFile(path.join(fixtureRoot, "source.png"))),
  );
  // The dry-run performed the same full-cost render and encode, so its
  // claimed artifact hash must equal the bytes the real write published.
  assert.equal(dryRunResult.evidence.outputSha256, writeResult.evidence.outputSha256);

  // A JPEG source exercises the promised non-PNG decode path end to end.
  const jpegDryRun = await activeClient.callTool("worldbend.render", {
    source: "source.jpg",
    output: "out/jpeg-dry.png",
    dryRun: true,
    spec: pixelSpec,
  });
  assert.equal(jpegDryRun.result.isError, false);
  const jpegResult = jpegDryRun.result.structuredContent.result;
  assert.equal(jpegResult.status, "ready");
  assert.equal(jpegResult.evidence.outputFormat, "png");
  assert.equal(await exists(path.join(fixtureRoot, "out", "jpeg-dry.png")), false);

  const repeat = await activeClient.callTool("worldbend.render", {
    source: "source.png",
    output: "out/written.png",
    spec: pixelSpec,
  });
  expectToolError(repeat, "E_DESTINATION_EXISTS");
  assert.deepEqual(
    await readFile(path.join(fixtureRoot, "out", "written.png")),
    firstBytes,
  );
  assert.deepEqual(await stagingDirectories(), []);
}

async function checkCancellationAndRecovery(activeClient) {
  // Deliberately slow: a 32-megapixel high-quality dry run takes seconds to
  // complete naturally, so a cleanup measured far below that proves the
  // server observed the cancellation instead of merely finishing the render.
  const request = activeClient.beginRequest("tools/call", {
    name: "worldbend.render",
    arguments: {
      source: "source.png",
      output: "out/cancelled.png",
      dryRun: true,
      options: { quality: "high" },
      spec: makePixelSpec(8000, 4000),
    },
  });
  const outcomePromise = request.promise.then(
    (response) => ({ kind: "response", response }),
    (error) => ({ kind: "error", error }),
  );
  await waitFor(async () => (await stagingDirectories()).length > 0, 2_000);
  const cancelledAt = Date.now();
  activeClient.notify("notifications/cancelled", {
    requestId: request.id,
    reason: "runtime smoke cancellation",
  });
  await waitFor(async () => (await stagingDirectories()).length === 0, 10_000);
  metrics.cancelCleanupMs = Date.now() - cancelledAt;
  assert(
    metrics.cancelCleanupMs < 1_500,
    `cancellation cleanup took ${metrics.cancelCleanupMs}ms; the render likely ran to natural completion instead of being aborted`,
  );
  const outcome = await Promise.race([
    outcomePromise,
    new Promise((resolve) =>
      setTimeout(() => resolve({ kind: "noResponse" }), 100),
    ),
  ]);
  // rmcp today answers a cancelled request with nothing; a transport that
  // does answer must report failure, never success.
  if (outcome.kind === "response") {
    assert.equal(
      outcome.response.result?.isError,
      true,
      "cancelled render unexpectedly returned a successful tool response",
    );
  }
  assert.equal(await exists(path.join(fixtureRoot, "out", "cancelled.png")), false);

  const canvasRequest = activeClient.beginRequest("tools/call", {
    name: "worldbend.canvas_render",
    arguments: {
      source: "source.png",
      outputDirectory: "out/cancelled-canvas",
      dryRun: true,
      quality: "high",
      spec: {
        schema: "worldbend.canvas-set",
        version: "0.1",
        variants: [
          {
            id: "large",
            operation: { kind: "stretch", output: { width: 8000, height: 4000 } },
          },
        ],
      },
    },
  });
  const canvasOutcomePromise = canvasRequest.promise.then(
    (response) => ({ kind: "response", response }),
    (error) => ({ kind: "error", error }),
  );
  await waitFor(async () => (await canvasStagingDirectories()).length > 0, 2_000);
  const canvasCancelledAt = Date.now();
  activeClient.notify("notifications/cancelled", {
    requestId: canvasRequest.id,
    reason: "runtime smoke Canvas cancellation",
  });
  await waitFor(async () => (await canvasStagingDirectories()).length === 0, 10_000);
  metrics.canvasCancelCleanupMs = Date.now() - canvasCancelledAt;
  assert(
    metrics.canvasCancelCleanupMs < 1_500,
    `Canvas cancellation cleanup took ${metrics.canvasCancelCleanupMs}ms`,
  );
  const canvasOutcome = await Promise.race([
    canvasOutcomePromise,
    new Promise((resolve) => setTimeout(() => resolve({ kind: "noResponse" }), 100)),
  ]);
  if (canvasOutcome.kind === "response") {
    assert.equal(
      canvasOutcome.response.result?.isError,
      true,
      "cancelled Canvas Set unexpectedly returned a successful tool response",
    );
  }
  assert.equal(await exists(path.join(fixtureRoot, "out", "cancelled-canvas")), false);
  const recovery = await activeClient.request("tools/list", {});
  assert.equal(recovery.result.tools.length, 8);
}

async function checkExtendedFamilyCancellation(activeClient) {
  const cases = [
    {
      name: "media_render",
      output: "out/cancelled-media.png",
      arguments: {
        source: "source.png",
        spec: makePixelSpec(64, 64),
        output: "out/cancelled-media.png",
        options: {
          quality: "high",
          canvas: "reference",
          output: { format: "png", precision: "u8", icc: "discard" },
        },
      },
    },
    {
      name: "vector_render",
      output: "out/cancelled-vector.svg",
      arguments: {
        source: "source.svg",
        spec: makePixelSpec(20, 10),
        output: "out/cancelled-vector.svg",
        options: {
          carrier: "svg",
          elementSize: { width: 10, height: 10 },
          canvas: "reference",
        },
      },
    },
    {
      name: "tiled_media_render",
      output: "out/cancelled-tiles",
      arguments: {
        source: "source.png",
        spec: makePixelSpec(64, 64),
        outputDirectory: "out/cancelled-tiles",
        options: {
          quality: "high",
          canvas: "reference",
          tileWidth: 32,
          tileHeight: 32,
          output: { format: "png", precision: "u8", icc: "discard" },
        },
      },
    },
    {
      name: "surface_render",
      output: "out/cancelled-surface.png",
      arguments: {
        source: "source.png",
        spec: surfaceSpec,
        output: "out/cancelled-surface.png",
      },
    },
    {
      name: "motion_render",
      output: "out/cancelled-motion",
      arguments: {
        sources: [{ id: "still", source: "source.png" }],
        spec: motionSpec,
        outputDirectory: "out/cancelled-motion",
      },
    },
    {
      name: "variation_render",
      output: "out/cancelled-variation",
      arguments: {
        assets: [{ id: "asset-a", source: "source.png" }],
        spec: variationJobSpec,
        outputDirectory: "out/cancelled-variation",
      },
    },
  ];

  for (let start = 0; start < cases.length; start += 2) {
    const blockers = Array.from({ length: 2 }, (_, index) =>
      activeClient.beginRequest("tools/call", {
        name: "worldbend.run",
        arguments: {
          operation: "render",
          arguments: {
            source: "source.png",
            output: `out/family-cancel-blocker-${start}-${index}.png`,
            dryRun: true,
            options: { quality: "high" },
            spec: makePixelSpec(8000, 4000),
          },
        },
      }),
    );
    const blockerOutcomes = blockers.map((request) => request.promise.catch(() => undefined));
    await waitFor(async () => (await stagingDirectories()).length === 2, 2_000);

    const targets = cases.slice(start, start + 2).map((entry) => ({
      entry,
      request: activeClient.beginRequest("tools/call", {
        name: "worldbend.run",
        arguments: { operation: entry.name, arguments: entry.arguments },
      }),
    }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const targetOutcomes = targets.map(({ request }) => request.promise.then(
      (response) => ({ kind: "response", response }),
      (error) => ({ kind: "error", error }),
    ));
    for (const { entry, request } of targets) {
      activeClient.notify("notifications/cancelled", {
        requestId: request.id,
        reason: `runtime smoke ${entry.name} queued cancellation`,
      });
    }
    for (const blocker of blockers) {
      activeClient.notify("notifications/cancelled", {
        requestId: blocker.id,
        reason: "runtime smoke extended-family blocker cleanup",
      });
    }
    await waitFor(async () => (await privateStagingDirectories()).length === 0, 10_000);

    for (let index = 0; index < targets.length; index += 1) {
      const outcome = await Promise.race([
        targetOutcomes[index],
        new Promise((resolve) => setTimeout(() => resolve({ kind: "noResponse" }), 100)),
      ]);
      if (outcome.kind === "response") {
        assert.equal(
          outcome.response.result?.isError,
          true,
          `cancelled ${targets[index].entry.name} unexpectedly returned success`,
        );
      }
      assert.equal(await exists(path.join(fixtureRoot, targets[index].entry.output)), false);
    }
    await Promise.all(blockerOutcomes.map((outcome) => Promise.race([
      outcome,
      new Promise((resolve) => setTimeout(resolve, 100)),
    ])));
  }
  metrics.extendedFamilyCancellations = cases.length;
  const recovery = await activeClient.request("tools/list", {});
  assert.equal(recovery.result.tools.length, 3);
}

async function checkBoundedConcurrency(activeClient) {
  let maximumStages = 0;
  let monitoring = true;
  const monitor = (async () => {
    while (monitoring) {
      maximumStages = Math.max(maximumStages, (await stagingDirectories()).length);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  })();
  try {
    const admittedCalls = Array.from({ length: 4 }, (_, index) =>
      activeClient.callTool("worldbend.render", {
        source: "source.png",
        output: `out/concurrent-${index}.png`,
        dryRun: true,
        // Keep two observable execution waves under the fixed 20 s whole-call
        // deadline on the current development machine. The independent 32 MiP
        // cancellation probe above still exercises the maximum render size.
        spec: makePixelSpec(3000, 3000),
      }),
    );
    await waitFor(async () => (await stagingDirectories()).length === 2, 2_000);
    const overload = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        activeClient.callTool("worldbend.render", {
          source: "source.png",
          output: `out/overload-${index}.png`,
          dryRun: true,
          spec: makePixelSpec(3000, 3000),
        }),
      ),
    );
    for (const response of overload) expectToolError(response, "E_CAPACITY");
    metrics.overloadRejections = overload.length;
    const results = await Promise.all(admittedCalls);
    assert(results.every((response) => response.result.isError === false),
      `Admitted concurrent renders failed: ${JSON.stringify(results.map(response => response.result.structuredContent?.error ?? null))}`);
  } finally {
    monitoring = false;
    await monitor;
  }
  assert(maximumStages > 0, "concurrency probe did not observe a render worker");
  assert(maximumStages <= 2, `observed ${maximumStages} concurrent render workers`);
  metrics.maxConcurrentRenderStages = maximumStages;
  assert.deepEqual(await stagingDirectories(), []);
}

function checkCliAdapter() {
  const perception = runCli([
    "plane-candidates",
    "--source",
    path.join(fixtureRoot, "perception.png"),
    "--request",
    path.join(fixtureRoot, "perception-request.json"),
  ]);
  assert.equal(perception.status, 0);
  assert.deepEqual(perception.body.result, mcpPerceptionResult);

  const composed = runCli([
    "compose",
    "--spec",
    path.join(fixtureRoot, "normalized.projective.json"),
    "--target-size",
    "100x50",
    "--rotate",
    "90",
  ]);
  assert.equal(composed.status, 0);
  assert.equal(composed.body.ok, true);
  // Both transports return the full six-artifact AffineComposition; drift in
  // any field (spec, raw quad/bounds, canvas, matrix, diagnostics) fails here.
  assert.deepEqual(composed.body.result, mcpComposeResult);

  const flipped = runCli([
    "compose",
    "--spec",
    path.join(fixtureRoot, "normalized.projective.json"),
    "--target-size",
    "100x50",
    "--rotate",
    "90",
    "--flip-x",
  ]);
  assert.equal(flipped.status, 0);
  assert.equal(flipped.body.ok, true);
  assert.deepEqual(flipped.body.result, mcpFlippedComposeResult);

  const warped = runCli([
    "compose",
    "--spec",
    path.join(fixtureRoot, "normalized.projective.json"),
    "--target-size",
    "100x50",
    "--rotate",
    "90",
    "--warp",
    "arc",
    "--warp-amount",
    "0.75",
  ]);
  assert.equal(warped.status, 0);
  assert.equal(warped.body.ok, true);
  assert.deepEqual(warped.body.result, mcpWarpComposeResult);

  const cleared = runCli([
    "compose",
    "--spec",
    path.join(fixtureRoot, "warped.projective.json"),
    "--target-size",
    `${mcpWarpComposeResult.canvas.size.width}x${mcpWarpComposeResult.canvas.size.height}`,
    "--clear-warp",
  ]);
  assert.equal(cleared.status, 0);
  assert.equal(cleared.body.ok, true);
  assert.deepEqual(cleared.body.result, mcpClearWarpComposeResult);

  const valid = runCli([
    "solve",
    "--quad",
    "0,0 64,0 64,64 0,64",
    "--reference",
    "64x64",
  ]);
  assert.equal(valid.status, 0);
  assert.equal(valid.body.ok, true);
  assert.deepEqual(valid.body.result, mcpSolveResult);

  const inspect = runCli([
    "inspect",
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
  ]);
  assert.equal(inspect.status, 0);
  assert.deepEqual(inspect.body.result, mcpInspectResult);

  const css = runCli([
    "css",
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--element-size",
    "64x64",
  ]);
  assert.equal(css.status, 0);
  assert.deepEqual(css.body.result, mcpCssResult);

  const dryRun = runCli([
    "render",
    "--source",
    path.join(fixtureRoot, "source.png"),
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli-dry.png"),
    "--dry-run",
  ]);
  assert.equal(dryRun.status, 0);
  assert.equal(dryRun.body.result.status, "ready");
  assert.equal(
    dryRun.body.result.diagnostics.sourceWidth,
    mcpDryRunResult.diagnostics.sourceWidth,
  );
  assert.equal(
    dryRun.body.result.diagnostics.sourceHeight,
    mcpDryRunResult.diagnostics.sourceHeight,
  );
  assert.deepEqual(
    dryRun.body.result.diagnostics.placement,
    mcpDryRunResult.diagnostics.placement,
  );
  assert.deepEqual(
    dryRun.body.result.diagnostics.destinationBounds,
    mcpDryRunResult.diagnostics.destinationBounds,
  );
  assert.equal(dryRun.body.result.diagnostics.quality, mcpDryRunResult.diagnostics.quality);
  assert.equal(dryRun.body.result.diagnostics.canvas, mcpDryRunResult.diagnostics.canvas);
  for (const field of [
    "sourceSha256",
    "outputSha256",
    "outputWidth",
    "outputHeight",
    "outputFormat",
    "warnings",
  ]) {
    assert.deepEqual(dryRun.body.result.evidence[field], mcpDryRunResult.evidence[field]);
  }
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-dry.png")), false);

  const programInspect = runCli([
    "program-inspect",
    "--spec",
    path.join(fixtureRoot, "raster-program.json"),
  ]);
  assert.equal(programInspect.status, 0);
  assert.deepEqual(
    programInspect.body.result.stages.map((stage) => stage.id),
    ["perspective", "padding"],
  );

  const programDry = runCli([
    "program-render",
    "--source",
    path.join(fixtureRoot, "source.png"),
    "--spec",
    path.join(fixtureRoot, "raster-program.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli-program-dry.png"),
    "--dry-run",
  ]);
  assert.equal(programDry.status, 0);
  assert.equal(programDry.body.result.status, "ready");
  assert.equal(programDry.body.result.evidence.outputWidth, 3);
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-program-dry.png")), false);

  const templateInspect = runCli([
    "template-inspect",
    "--spec",
    path.join(fixtureRoot, "spatial-template.json"),
  ]);
  assert.equal(templateInspect.status, 0);
  assert.deepEqual(templateInspect.body.result.sourceSlots, ["artwork"]);
  assert.deepEqual(
    templateInspect.body.result.outputs.map((output) => output.id),
    ["hero", "thumbnail"],
  );

  const documentInspect = runCli([
    "document-inspect",
    "--spec",
    path.join(fixtureRoot, "spatial-document.json"),
  ]);
  assert.equal(documentInspect.status, 0);
  assert.equal(documentInspect.body.result.expressions.length, 2);
  assert.deepEqual(documentInspect.body.result.unusedAssetIds, []);

  const documentAssembly = runCli([
    "document-assemble",
    "--spec",
    path.join(fixtureRoot, "spatial-document-assembly.json"),
  ]);
  assert.equal(documentAssembly.status, 0);
  assert.deepEqual(documentAssembly.body.result, spatialDocumentAssemblyPlan);
  assert.deepEqual(
    documentAssembly.body.result.deliveryPlan.deliveries.map(
      (delivery) => delivery.kind,
    ),
    ["static", "interactive"],
  );

  const documentedAssembly = runCli([
    "document-assemble",
    "--spec",
    path.join(root, "examples", "spatial-document-assembly.worldbend.json"),
  ]);
  assert.equal(documentedAssembly.status, 0);
  assert.deepEqual(
    documentedAssembly.body.result.deliveryPlan.deliveries.map(
      (delivery) => delivery.kind,
    ),
    ["static", "interactive"],
  );

  const documentUpdate = runCli([
    "document-update-plan",
    "--spec",
    path.join(fixtureRoot, "spatial-document-update.json"),
  ]);
  assert.equal(documentUpdate.status, 0);
  assert.equal(documentUpdate.body.result.changed, true);
  assert.equal(
    documentUpdate.body.result.fingerprint,
    spatialDocumentUpdatePlan.fingerprint,
  );
  assert.deepEqual(
    documentUpdate.body.result.affectedExpressions.map((expression) => expression.id),
    ["release-still", "interactive-hero"],
  );

  const documentDelivery = runCli([
    "document-delivery-plan",
    "--spec",
    path.join(fixtureRoot, "spatial-document-delivery.json"),
  ]);
  assert.equal(documentDelivery.status, 0);
  assert.deepEqual(documentDelivery.body.result, spatialDocumentDeliveryPlan);
  assert.deepEqual(
    documentDelivery.body.result.deliveries.map((delivery) => delivery.kind),
    ["static", "interactive"],
  );

  const interactiveMediaBundle = runCli([
    "interactive-media-bundle-plan",
    "--spec",
    path.join(fixtureRoot, "spatial-interactive-media-bundle.json"),
  ]);
  assert.equal(interactiveMediaBundle.status, 0);
  assert.deepEqual(interactiveMediaBundle.body.result, spatialInteractiveMediaBundle);
  assert.equal(
    interactiveMediaBundle.body.result.schema,
    "worldbend.spatial-interactive-media-bundle",
  );

  // Keep the README's committed, fingerprint-guarded request executable. A
  // document edit without the matching fingerprint update must fail this smoke
  // rather than leave users with a stale copy-and-run example.
  const documentedUpdate = runCli([
    "document-update-plan",
    "--spec",
    path.join(root, "examples", "spatial-document-update.worldbend.json"),
  ]);
  assert.equal(documentedUpdate.status, 0);
  assert.equal(documentedUpdate.body.result.changed, true);
  assert.deepEqual(
    documentedUpdate.body.result.affectedExpressions.map((expression) => expression.id),
    ["release-still", "interactive-hero"],
  );
  assert.equal(
    documentedUpdate.body.result.document.assets[0].contentVersion,
    "demo-v2",
  );
  const documentedDelivery = runCli([
    "document-delivery-plan",
    "--spec",
    path.join(root, "examples", "spatial-document-delivery.worldbend.json"),
  ]);
  assert.equal(documentedDelivery.status, 0);
  assert.deepEqual(
    documentedDelivery.body.result.deliveries.map((delivery) => delivery.kind),
    ["static", "interactive"],
  );
  assert.equal(
    documentedDelivery.body.result.documentFingerprint,
    "sha256:db39a948b3e7e62a25b1bdc74a5e8a8e36a8da632ea6be1886a26abc72f9f015",
  );

  const variationDry = runCli([
    "variation-render",
    "--asset",
    `asset-a=${path.join(fixtureRoot, "source.png")}`,
    "--spec",
    path.join(fixtureRoot, "variation-job.json"),
    "--output-directory",
    path.join(fixtureRoot, "out", "cli-variation-dry"),
    "--dry-run",
  ]);
  assert.equal(variationDry.status, 0);
  assert.equal(variationDry.body.result.status, "ready");
  assert.equal(variationDry.body.result.plan.outputCount, 4);
  assert.equal(
    existsSync(path.join(fixtureRoot, "out", "cli-variation-dry")),
    false,
  );

  const mediaInspect = runCli([
    "media-inspect",
    "--source",
    path.join(fixtureRoot, "source16.png"),
  ]);
  assert.equal(mediaInspect.status, 0);
  assert.equal(mediaInspect.body.result.sampleFormat, "u16");

  const mediaDry = runCli([
    "media-render",
    "--source",
    path.join(fixtureRoot, "source16.png"),
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli-media.png"),
    "--format",
    "png",
    "--precision",
    "preserve",
    "--icc",
    "preserve",
    "--dry-run",
  ]);
  assert.equal(mediaDry.status, 0);
  assert.equal(mediaDry.body.result.status, "ready");
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-media.png")), false);

  const vectorDry = runCli([
    "vector-render",
    "--source",
    path.join(fixtureRoot, "source.svg"),
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli-vector.svg"),
    "--carrier",
    "svg",
    "--element-size",
    "10x10",
    "--dry-run",
  ]);
  assert.equal(vectorDry.status, 0);
  assert.equal(vectorDry.body.result.status, "ready");
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-vector.svg")), false);

  const tiledDry = runCli([
    "tiled-media-render",
    "--source",
    path.join(fixtureRoot, "source.png"),
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--output-directory",
    path.join(fixtureRoot, "out", "cli-tiles"),
    "--format",
    "webp",
    "--icc",
    "discard",
    "--tile-width",
    "32",
    "--tile-height",
    "32",
    "--dry-run",
  ]);
  assert.equal(tiledDry.status, 0);
  assert.equal(tiledDry.body.result.status, "ready");
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-tiles")), false);

  const psdInspection = runCli([
    "psd-smart-objects",
    "--source",
    path.join(fixtureRoot, "smart-object.psd"),
    "--request",
    path.join(fixtureRoot, "psd-smart-object-request.json"),
  ]);
  assert.equal(psdInspection.status, 0);
  assert.equal(psdInspection.body.result.result, "inspection");
  assert.equal(psdInspection.body.result.inspection.smartObjects.length, 1);

  const surfaceInspection = runCli([
    "surface-inspect",
    "--spec",
    path.join(fixtureRoot, "surface-deformation.json"),
  ]);
  assert.equal(surfaceInspection.status, 0);
  assert.equal(surfaceInspection.body.result.schema, "worldbend.surface-deformation-plan");
  assert.equal(surfaceInspection.body.result.strokeSampleCount, 1);

  const surfaceDry = runCli([
    "surface-render",
    "--source",
    path.join(fixtureRoot, "source.png"),
    "--spec",
    path.join(fixtureRoot, "surface-deformation.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli-surface-dry.png"),
    "--dry-run",
  ]);
  assert.equal(surfaceDry.status, 0);
  assert.equal(surfaceDry.body.result.status, "ready");
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-surface-dry.png")), false);

  const motionInspection = runCli([
    "motion-inspect",
    "--spec",
    path.join(fixtureRoot, "motion.json"),
  ]);
  assert.equal(motionInspection.status, 0);
  assert.deepEqual(motionInspection.body.result.duration, {
    numerator: 1001,
    denominator: 15000,
  });

  const motionDry = runCli([
    "motion-render",
    "--source",
    `still=${path.join(fixtureRoot, "source.png")}`,
    "--spec",
    path.join(fixtureRoot, "motion.json"),
    "--output-directory",
    path.join(fixtureRoot, "out", "cli-motion-dry"),
    "--dry-run",
  ]);
  assert.equal(motionDry.status, 0);
  assert.equal(motionDry.body.result.status, "ready");
  assert.equal(existsSync(path.join(fixtureRoot, "out", "cli-motion-dry")), false);

  const schema = runCli(["schema"]);
  assert.equal(schema.status, 0);
  assert.equal(
    schema.body.result.transformSpec.properties.schema.const,
    "worldbend.transform",
  );
  assert.equal(schema.body.result.transformSpec.properties.version.const, "0.1");
  assert.equal(
    schema.body.result.spatialTemplateSpec.properties.schema.const,
    "worldbend.spatial-template",
  );
  assert.equal(
    schema.body.result.variationJobSpec.properties.schema.const,
    "worldbend.variation-job",
  );
  assert.equal(
    schema.body.result.surfaceDeformationSpec.properties.schema.const,
    "worldbend.surface-deformation",
  );
  assert.equal(schema.body.result.motionSpec.properties.schema.const, "worldbend.motion");
  assert.equal(
    schema.body.result.psdSmartObjectRequest.properties.schema.const,
    "worldbend.psd-smart-object-request",
  );

  const malformed = runCli([
    "solve",
    "--quad",
    "0,0 64,0 64,64 0,64",
    "--reference",
    "64x64",
    "--unknown",
  ]);
  assert.equal(malformed.status, 2);
  assert.equal(malformed.body.error.code, "E_SCHEMA");

  const normalizedCss = runCli([
    "css",
    "--spec",
    path.join(fixtureRoot, "normalized.projective.json"),
    "--element-size",
    "100x100",
  ]);
  assert.equal(normalizedCss.status, 2);
  assert.equal(normalizedCss.body.error.code, "E_SCHEMA");

  const wrongExtension = runCli([
    "render",
    "--source",
    path.join(fixtureRoot, "source.png"),
    "--spec",
    path.join(fixtureRoot, "pixel.projective.json"),
    "--output",
    path.join(fixtureRoot, "out", "cli.jpg"),
    "--dry-run",
  ]);
  assert.equal(wrongExtension.status, 2);
  assert.equal(wrongExtension.body.error.code, "E_SCHEMA");
}

function runCli(args) {
  const result = spawnSync(cli, args, {
    cwd: root,
    encoding: "utf8",
    // Full carrier schemas include Video and exceed Node's default 1 MiB.
    // Ordinary execution responses retain their existing smaller ceiling.
    maxBuffer: args[0] === "schema" ? 8 * 1024 * 1024 : 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  return { status: result.status, body: JSON.parse(result.stdout) };
}

function expectToolError(response, code) {
  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.ok, false);
  assert.equal(response.result.structuredContent.error.code, code);
  assert(response.wireBytes < 256 * 1024);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function makePng16WithIcc() {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 16;
  ihdr[9] = 6;
  const profile = Buffer.alloc(128);
  profile.writeUInt32BE(128, 0);
  profile.write("acsp", 36, "ascii");
  const iccp = Buffer.concat([
    Buffer.from("worldbend\0", "ascii"),
    Buffer.from([0]),
    deflateSync(profile),
  ]);
  const scanline = Buffer.alloc(9);
  scanline[0] = 0;
  scanline.writeUInt16BE(1000, 1);
  scanline.writeUInt16BE(2000, 3);
  scanline.writeUInt16BE(3000, 5);
  scanline.writeUInt16BE(65535, 7);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("iCCP", iccp),
    pngChunk("IDAT", deflateSync(scanline)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makePerceptionPng() {
  const width = 96;
  const height = 72;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const inside = x >= 18 && x < 78 && y >= 14 && y < 58;
      scanlines[offset] = inside ? 30 : 245;
      scanlines[offset + 1] = inside ? 80 : 245;
      scanlines[offset + 2] = inside ? 210 : 245;
      scanlines[offset + 3] = 255;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makePixelSpec(width, height) {
  return {
    schema: "worldbend.transform",
    version: "0.1",
    destination: {
      space: "pixel",
      reference: { width, height },
      quad: {
        tl: { x: 0, y: 0 },
        tr: { x: width, y: 0 },
        br: { x: width, y: height },
        bl: { x: 0, y: height },
      },
    },
    content: { fit: "stretch" },
  };
}

function makeNormalizedSpec() {
  return {
    schema: "worldbend.transform",
    version: "0.1",
    destination: {
      space: "normalized",
      quad: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    },
    content: { fit: "stretch" },
  };
}

function makeRectifySpec(width, height) {
  return {
    schema: "worldbend.rectify",
    version: "0.1",
    source: {
      space: "normalized",
      quad: {
        tl: { x: 0, y: 0 },
        tr: { x: 1, y: 0 },
        br: { x: 1, y: 1 },
        bl: { x: 0, y: 1 },
      },
    },
    output: { width, height },
  };
}

function makeCanvasSetSpec() {
  return {
    schema: "worldbend.canvas-set",
    version: "0.1",
    variants: [
      {
        id: "square",
        operation: {
          kind: "contain",
          output: { width: 2, height: 2 },
          anchor: { x: 0.5, y: 0.5 },
          background: { kind: "transparent" },
        },
      },
      {
        id: "wide",
        operation: {
          kind: "cover",
          output: { width: 3, height: 2 },
          anchor: { x: 0, y: 0 },
          background: { kind: "color", space: "srgb8", rgba: [12, 34, 56, 255] },
        },
      },
    ],
  };
}

function makeMockupSpec() {
  const plane = (id, sourceId, left, right) => ({
    id,
    sourceId,
    transform: {
      schema: "worldbend.transform",
      version: "0.1",
      destination: {
        space: "pixel",
        reference: { width: 4, height: 2 },
        quad: {
          tl: { x: left, y: 0 },
          tr: { x: right, y: 0 },
          br: { x: right, y: 2 },
          bl: { x: left, y: 2 },
        },
      },
      content: { fit: "stretch" },
    },
    grid: { columns: 2, rows: 2 },
    measurement: { width: 10, height: 20, unit: "cm" },
  });
  return {
    schema: "worldbend.mockup",
    version: "0.1",
    canvas: { width: 4, height: 2 },
    background: { kind: "transparent" },
    planes: [
      plane("front", "artwork", 0, 2),
      plane("side", "side-artwork", 2, 4),
    ],
    seams: [
      {
        first: { planeId: "front", edge: "right" },
        second: { planeId: "side", edge: "left" },
        tolerancePixels: 0,
      },
    ],
  };
}

function makeMockupExtractSpec() {
  return {
    schema: "worldbend.mockup-extract",
    version: "0.1",
    outputs: [
      { id: "front", rectify: makeRectifySpec(2, 2) },
      { id: "detail", rectify: makeRectifySpec(3, 2) },
    ],
  };
}

function makeMeshSpec() {
  const subdivisions = 2;
  const vertices = [];
  for (let y = 0; y <= subdivisions; y += 1) {
    for (let x = 0; x <= subdivisions; x += 1) {
      const source = { x: x / subdivisions, y: y / subdivisions };
      vertices.push({
        source,
        warped: x === 1 && y === 1 ? { x: 0.6, y: 0.5 } : source,
      });
    }
  }
  return {
    schema: "worldbend.mesh-warp",
    version: "0.1",
    transform: makePixelSpec(4, 4),
    mesh: { subdivisions, vertices },
  };
}

function makeRemapSpec() {
  return {
    schema: "worldbend.remap",
    version: "0.1",
    output: { width: 1, height: 1 },
    operation: {
      kind: "lens",
      coefficients: { k1: 0, k2: 0, k3: 0, p1: 0, p2: 0 },
      center: { x: 0.5, y: 0.5 },
      scale: { x: 1, y: 1 },
    },
  };
}

function makeDisplacementSpec() {
  return {
    schema: "worldbend.remap",
    version: "0.1",
    output: { width: 1, height: 1 },
    operation: {
      kind: "displacement",
      xChannel: "red",
      yChannel: "green",
      scaleXPixels: 1,
      scaleYPixels: 1,
      neutral: 128,
      boundary: "transparent",
    },
  };
}

function makeTimelineSpec(frameCount = 2) {
  return {
    schema: "worldbend.timeline",
    version: "0.1",
    output: { width: 1, height: 1 },
    program: {
      kind: "keyframes",
      sourceId: "still",
      frameCount,
      base: makeNormalizedSpec(),
      keyframes: [
        {
          frame: 0,
          quad: makeNormalizedSpec().destination.quad,
        },
        {
          frame: frameCount - 1,
          quad: makeNormalizedSpec().destination.quad,
        },
      ],
      interpolation: "linear",
    },
  };
}

function makeSurfaceSpec() {
  const points = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      points.push({ x: column / 3, y: row / 3 });
    }
  }
  points[5].y += 0.03;
  return {
    schema: "worldbend.surface-deformation",
    version: "0.1",
    transform: makePixelSpec(4, 4),
    targetSize: { width: 4, height: 4 },
    meshSubdivisions: 4,
    envelope: { columns: 1, rows: 1, points },
    anchors: [{ id: "center", column: 2, row: 2 }],
    strokes: [
      {
        id: "nudge",
        samples: [
          {
            position: { x: 0.25, y: 0.5 },
            delta: { x: 0.02, y: 0 },
            radius: 0.3,
            strength: 0.5,
          },
        ],
      },
    ],
  };
}

function makeDeformationWorkSpec() {
  const surface = makeSurfaceSpec();
  return {
    schema: "worldbend.deformation-work",
    version: "0.1",
    transform: surface.transform,
    targetSize: surface.targetSize,
    meshSubdivisions: surface.meshSubdivisions,
    surface: {
      envelope: surface.envelope,
      anchors: surface.anchors,
      strokes: surface.strokes,
    },
    liquify: {
      strokes: [
        {
          id: "smoke-twirl",
          mode: "twirl",
          samples: [{ position: { x: 0.5, y: 0.5 }, radius: 0.3, strength: 0.7 }],
        },
        {
          id: "smoke-push",
          mode: "push",
          samples: [{
            position: { x: 0.7, y: 0.4 },
            delta: { x: -0.03, y: 0.02 },
            radius: 0.15,
            strength: 1,
          }],
        },
      ],
    },
    meshEdits: [{ column: 1, row: 1, warped: { x: 0.24, y: 0.24 } }],
  };
}

function makeMotionSpec() {
  const start = makePixelSpec(1, 1).destination.quad;
  const end = structuredClone(start);
  end.tl.x = 0.1;
  end.bl.x = 0.1;
  return {
    schema: "worldbend.motion",
    version: "0.1",
    output: { width: 1, height: 1 },
    timebase: { numerator: 30000, denominator: 1001 },
    sourceId: "still",
    frameCount: 3,
    base: makePixelSpec(1, 1),
    keyframes: [
      {
        frame: 0,
        quad: start,
        easingToNext: {
          kind: "cubicBezier",
          x1: 0.42,
          y1: 0,
          x2: 0.58,
          y2: 1,
        },
      },
      { frame: 2, quad: end },
    ],
  };
}

function makeRasterProgramSpec() {
  return {
    schema: "worldbend.raster-program",
    version: "0.1",
    stages: [
      {
        kind: "transform",
        id: "perspective",
        spec: makePixelSpec(1, 1),
        canvas: "reference",
      },
      {
        kind: "canvas",
        id: "padding",
        spec: {
          schema: "worldbend.canvas",
          version: "0.1",
          operation: {
            kind: "pad",
            insets: { top: 0, right: 1, bottom: 1, left: 1 },
            background: { kind: "transparent" },
          },
        },
      },
    ],
  };
}

function makeSpatialTemplateSpec() {
  return {
    schema: "worldbend.spatial-template",
    version: "0.1",
    operation: {
      kind: "rasterProgram",
      sourceSlot: "artwork",
      program: rasterProgramSpec,
    },
    output: {
      kind: "canvasSet",
      spec: {
        schema: "worldbend.canvas-set",
        version: "0.1",
        variants: [
          {
            id: "hero",
            operation: {
              kind: "stretch",
              output: { width: 4, height: 3 },
            },
          },
          {
            id: "thumbnail",
            operation: {
              kind: "stretch",
              output: { width: 2, height: 2 },
            },
          },
        ],
      },
    },
  };
}

function makeVariationJobSpec() {
  return {
    schema: "worldbend.variation-job",
    version: "0.1",
    template: spatialTemplateSpec,
    items: ["sku-a", "sku-b"].map((id) => ({
      id,
      bindings: [{ slotId: "artwork", assetId: "asset-a" }],
    })),
  };
}

function makeSpatialDocumentSpec(recipe) {
  return {
    schema: "worldbend.spatial-document",
    version: "0.1",
    assets: ["product", "backdrop", "details"].map((id) => ({ id })),
    expressions: [
      {
        kind: "static",
        id: "release-still",
        template: spatialTemplateSpec,
        bindings: [
          { role: "content", slotId: "artwork", assetId: "product" },
        ],
      },
      {
        kind: "interactive",
        id: "interactive-hero",
        recipe,
        bindings: [
          { role: "content", slotId: "background", assetId: "backdrop" },
          { role: "content", slotId: "middle", assetId: "details" },
          { role: "content", slotId: "foreground", assetId: "product" },
        ],
      },
    ],
  };
}

async function stagingDirectories() {
  return (await readdir(stagingRoot)).filter((name) =>
    name.startsWith(".worldbend-stage-"),
  );
}

async function canvasStagingDirectories() {
  return (await readdir(stagingRoot)).filter((name) =>
    name.startsWith(".worldbend-canvas-stage-"),
  );
}

async function programStagingDirectories() {
  return (await readdir(stagingRoot)).filter((name) =>
    name.startsWith(".worldbend-program-stage-"),
  );
}

async function privateStagingDirectories() {
  return readdir(stagingRoot);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}

function assertSafeFixtureRoot(target) {
  if (
    path.dirname(target) !== path.resolve(tmpdir()) ||
    !path.basename(target).startsWith("worldbend-mcp-smoke-")
  ) {
    throw new Error(`refusing to manage unexpected fixture directory: ${target}`);
  }
}

class StdioClient {
  #child;
  #buffer = "";
  #nextId = 1;
  #pending = new Map();
  #stderr = "";

  constructor(command, args) {
    this.#child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, WORLDBEND_PRIVATE_STAGING_ROOT: stagingRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child.stdout.on("data", (chunk) => this.#read(chunk));
    this.#child.stderr.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${chunk}`.slice(-16_384);
    });
    this.#child.once("exit", (code) => {
      for (const { reject, timer } of this.#pending.values()) {
        clearTimeout(timer);
        reject(new Error(`MCP server exited with ${code}: ${this.#stderr}`));
      }
      this.#pending.clear();
    });
  }

  async initialize() {
    const response = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "worldbend-runtime-smoke", version: "1" },
    });
    assert.equal(response.result.serverInfo.name, "worldbend");
    this.notify("notifications/initialized", {});
  }

  callTool(name, arguments_) {
    return this.request("tools/call", { name, arguments: arguments_ });
  }

  request(method, params) {
    return this.beginRequest(method, params).promise;
  }

  beginRequest(method, params) {
    const id = this.#nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} did not settle within ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return { id, promise };
  }

  notify(method, params) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  async close() {
    if (this.#child.exitCode !== null) return;
    this.#child.kill();
    await new Promise((resolve) => {
      this.#child.once("exit", resolve);
      setTimeout(resolve, 1_000);
    });
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #read(chunk) {
    this.#buffer += chunk;
    let newline;
    while ((newline = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id === undefined) continue;
      const pending = this.#pending.get(message.id);
      if (!pending) continue;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve({ ...message, wireBytes: Buffer.byteLength(line) });
    }
  }
}

await main();
