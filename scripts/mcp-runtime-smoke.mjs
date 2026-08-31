import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadCarrierProfiles } from "./carrier-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const carrierProfiles = await loadCarrierProfiles();
const maxToolCatalogBytes = carrierProfiles.carriers.agent.package.maxToolCatalogBytes;
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
let mcpComposeResult;
let mcpFlippedComposeResult;
let mcpWarpComposeResult;
let mcpClearWarpComposeResult;
let mcpSolveResult;
let mcpInspectResult;
let mcpCssResult;
let mcpDryRunResult;
const metrics = {};

async function main() {
  fixtureRoot = await mkdtemp(path.join(tmpdir(), "worldbend-mcp-smoke-"));
  stagingRoot = await mkdtemp(path.join(tmpdir(), "worldbend-mcp-private-stage-"));
  let fixtureValidated = false;
  let client;
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

    pixelSpec = makePixelSpec(64, 64);
    normalizedSpec = makeNormalizedSpec();
    rectifySpec = makeRectifySpec(2, 2);
    canvasSetSpec = makeCanvasSetSpec();
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

    client = new StdioClient(mcp, ["--root", fixtureRoot]);
    await client.initialize();
    await checkToolCatalog(client);
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
      `Built CLI/MCP runtime smoke passed (tools/list=${metrics.toolsListBytes}B, solve=${metrics.solveResponseBytes}B, canvas=${metrics.canvasResponseBytes}B, boundedSchemaError=${metrics.schemaErrorResponseBytes}B, maxRenderWorkers=${metrics.maxConcurrentRenderStages}, overloadRejections=${metrics.overloadRejections}, cancelCleanup=${metrics.cancelCleanupMs}ms, canvasCancelCleanup=${metrics.canvasCancelCleanupMs}ms)`,
    );
  } finally {
    if (client) await client.close();
    if (fixtureValidated) await rm(fixtureRoot, { recursive: true, force: true });
    await rm(stagingRoot, { recursive: true, force: true });
  }
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
    response.wireBytes <= maxToolCatalogBytes,
    `tools/list is ${response.wireBytes} bytes; budget is ${maxToolCatalogBytes}`,
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
    assert(results.every((response) => response.result.isError === false));
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

  const schema = runCli(["schema"]);
  assert.equal(schema.status, 0);
  assert.equal(
    schema.body.result.transformSpec.properties.schema.const,
    "worldbend.transform",
  );
  assert.equal(schema.body.result.transformSpec.properties.version.const, "0.1");

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
    maxBuffer: 1024 * 1024,
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
