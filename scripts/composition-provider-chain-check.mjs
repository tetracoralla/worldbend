#!/usr/bin/env node

// Explicit Provider-chain verifier for Figma Composition continuation.
// This is deliberately not a Procedure implementation: it consumes the
// already-inspected Figma Provider projection, invokes Worldbend, and prepares
// a small downstream Web page that reads the standard document, delivery plan,
// and rendered artifacts.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function staticCompositionDelivery(continuation) {
  assert.equal(
    continuation?.schema,
    "worldbend.figma-composition-continuation",
    "expected a Figma Composition continuation",
  );
  assert.equal(continuation.document?.schema, "worldbend.spatial-document");
  assert.equal(
    continuation.deliveryPlan?.schema,
    "worldbend.spatial-document-delivery-plan",
  );
  assert.equal(continuation.expressionId, "figma-composition");
  assert.equal(continuation.document.expressions?.length, 1);
  const expression = continuation.document.expressions[0];
  assert.equal(expression.kind, "static");
  assert.equal(expression.id, continuation.expressionId);
  assert.equal(expression.template?.operation?.kind, "compositionProgram");
  const delivery = continuation.deliveryPlan.deliveries?.find(
    (candidate) =>
      candidate.kind === "static" && candidate.id === continuation.expressionId,
  );
  assert(delivery, "continuation is missing its static delivery");
  assert.deepEqual(delivery.bindings, expression.bindings);
  assert.equal(delivery.job?.schema, "worldbend.variation-job");
  assert.deepEqual(
    delivery.job.template,
    expression.template,
    "delivery job template must match the continued expression",
  );
  assert.equal(delivery.job.items?.length, 1);
  assert.equal(delivery.job.items[0].id, continuation.expressionId);
  assert.deepEqual(
    delivery.job.items[0].bindings,
    expression.bindings.map(({ slotId, assetId }) => ({ slotId, assetId })),
    "delivery job bindings must match the continued expression",
  );
  assert.deepEqual(
    continuation.sourceBindings
      ?.map(({ slotId, assetId }) => ({ slotId, assetId }))
      .sort(compareBinding),
    expression.bindings
      .map(({ slotId, assetId }) => ({ slotId, assetId }))
      .sort(compareBinding),
    "Figma source bindings must match the continued expression",
  );
  return delivery;
}

function compareBinding(left, right) {
  return left.slotId.localeCompare(right.slotId) || left.assetId.localeCompare(right.assetId);
}

export function downstreamPage({ continuation, imagePaths }) {
  const metadata = {
    expressionId: continuation.expressionId,
    documentFingerprint: continuation.deliveryPlan.documentFingerprint,
    sourceBindings: continuation.sourceBindings.map((binding) => ({
      slotId: binding.slotId,
      assetId: binding.assetId,
      sourceName: binding.sourceName,
      sourceNodeId: binding.sourceNodeId,
    })),
    losses: continuation.losses,
  };
  const cards = imagePaths
    .map(
      (imagePath) =>
        `<figure><img src="${escapeHtml(imagePath)}" alt="Rendered Composition output"><figcaption>${escapeHtml(path.basename(imagePath))}</figcaption></figure>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Worldbend Composition Provider-chain validation</title>
<style>body{margin:0;background:#111;color:#eee;font:15px/1.45 system-ui;padding:32px}main{max-width:1120px;margin:auto}h1{font-size:28px}p{color:#aaa}.outputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}figure{margin:0;background:#1b1b1b;padding:12px;border-radius:12px}img{display:block;width:100%;height:auto;background:conic-gradient(#333 25%,#222 0 50%,#333 0 75%,#222 0);background-size:24px 24px}figcaption{margin-top:8px}pre{white-space:pre-wrap;background:#181818;padding:16px;border-radius:12px;overflow:auto}</style>
</head><body><main><h1>Composition continuation</h1>
<p data-role="scope">Provider-chain validation, not a formal Procedure.</p>
<section class="outputs" data-role="outputs">${cards}</section>
<h2>Reusable state</h2><pre data-role="metadata">${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>
<script type="module">const [documentState,deliveryPlan]=await Promise.all([fetch("./spatial-document.json").then(r=>r.json()),fetch("./delivery-plan.json").then(r=>r.json())]);if(documentState.schema!=="worldbend.spatial-document"||deliveryPlan.schema!=="worldbend.spatial-document-delivery-plan")throw Error("Invalid continued state");document.documentElement.dataset.worldbendReady="true";</script>
</main></body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function main(argv) {
  if (argv.includes("--help")) {
    process.stdout.write(
      "Usage: node scripts/composition-provider-chain-check.mjs (--snapshot FILE | --continuation FILE) --asset ID=FILE [--asset ID=FILE ...] --output-directory DIR [--worldbend-bin FILE] [--worldbend-mcp-bin FILE]\n",
    );
    return;
  }
  const continuationPath = option(argv, "--continuation");
  const snapshotPath = option(argv, "--snapshot");
  assert(Boolean(continuationPath) !== Boolean(snapshotPath), "pass exactly one of --snapshot or --continuation");
  const outputDirectory = path.resolve(requiredOption(argv, "--output-directory"));
  const worldbend = path.resolve(
    option(argv, "--worldbend-bin") ??
      (await firstExecutable([
        path.join(root, "plugins", "worldbend", "bin", executableName("worldbend")),
        path.join(root, "target", "debug", executableName("worldbend")),
      ])),
  );
  const assetValues = repeatedOptions(argv, "--asset");
  assert(assetValues.length > 0, "at least one --asset ID=FILE is required");
  const assets = new Map(
    assetValues.map((value) => {
      const separator = value.indexOf("=");
      assert(separator > 0 && separator < value.length - 1, "--asset must be ID=FILE");
      return [value.slice(0, separator), path.resolve(value.slice(separator + 1))];
    }),
  );
  const continuation = continuationPath
    ? JSON.parse(await readFile(path.resolve(continuationPath), "utf8"))
    : await projectSnapshot(
        JSON.parse(await readFile(path.resolve(snapshotPath), "utf8")),
        path.resolve(
          option(argv, "--worldbend-mcp-bin") ??
            (await firstExecutable([
              path.join(root, "plugins", "worldbend", "bin", executableName("worldbend-mcp")),
              path.join(root, "target", "debug", executableName("worldbend-mcp")),
            ])),
        ),
      );
  const delivery = staticCompositionDelivery(continuation);
  await assertAuthoritativeDeliveryPlan({ worldbend, continuation });
  assert.deepEqual(
    [...assets.keys()].sort(),
    continuation.document.assets.map((asset) => asset.id).sort(),
    "asset mappings must exactly cover the Spatial Document assets",
  );
  await Promise.all([...assets.values()].map((assetPath) => access(assetPath, fsConstants.R_OK)));
  await assertMissing(outputDirectory);
  await mkdir(outputDirectory, { recursive: false });
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-composition-provider-chain-"));
  const jobPath = path.join(scratch, "variation-job.json");
  await writeFile(jobPath, JSON.stringify(delivery.job, null, 2));
  const artifactDirectory = path.join(outputDirectory, "artifacts");
  let result;
  try {
    result = spawnSync(
      worldbend,
      [
        "variation-render",
        ...[...assets].flatMap(([id, assetPath]) => ["--asset", `${id}=${assetPath}`]),
        "--spec",
        jobPath,
        "--output-directory",
        artifactDirectory,
        "--json",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  const rendered = JSON.parse(result.stdout);
  assert.equal(rendered.result?.status, "written");
  const images = await relativePngPaths(outputDirectory, artifactDirectory);
  assert(images.length > 0, "Worldbend produced no downstream PNG artifacts");
  await writeFile(
    path.join(outputDirectory, "figma-composition-continuation.json"),
    JSON.stringify(continuation, null, 2),
  );
  await writeFile(
    path.join(outputDirectory, "spatial-document.json"),
    JSON.stringify(continuation.document, null, 2),
  );
  await writeFile(
    path.join(outputDirectory, "delivery-plan.json"),
    JSON.stringify(continuation.deliveryPlan, null, 2),
  );
  await writeFile(
    path.join(outputDirectory, "index.html"),
    downstreamPage({ continuation, imagePaths: images }),
  );
  process.stdout.write(
    `${JSON.stringify({
      outcome: "provider-chain-validated",
      procedure: false,
      outputDirectory,
      page: path.join(outputDirectory, "index.html"),
      artifacts: images,
      documentFingerprint: continuation.deliveryPlan.documentFingerprint,
    })}\n`,
  );
}

async function assertAuthoritativeDeliveryPlan({ worldbend, continuation }) {
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-composition-delivery-plan-"));
  try {
    const requestPath = path.join(scratch, "delivery-request.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        document: continuation.document,
        expectedFingerprint: continuation.deliveryPlan.documentFingerprint,
        expressionIds: [continuation.expressionId],
      }),
    );
    const result = spawnSync(
      worldbend,
      ["document-delivery-plan", "--spec", requestPath, "--json"],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error ?? envelope));
    assert.deepEqual(
      envelope.result,
      continuation.deliveryPlan,
      "continuation delivery plan differs from the authoritative Worldbend plan",
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function projectSnapshot(snapshot, mcp) {
  const client = new StdioClient(mcp, ["--root", root, "--surface", "catalog"]);
  try {
    await client.initialize();
    const response = await client.callTool("worldbend.run", {
      operation: "figma_composition_continuation",
      arguments: { snapshot },
    });
    const envelope = response.result?.structuredContent;
    assert.equal(envelope?.ok, true, JSON.stringify(envelope?.error ?? response));
    return envelope.result;
  } finally {
    await client.close();
  }
}

async function relativePngPaths(rootDirectory, directory) {
  const values = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) values.push(...(await relativePngPaths(rootDirectory, absolute)));
    else if (entry.isFile() && entry.name.endsWith(".png")) {
      values.push(`./${path.relative(rootDirectory, absolute).split(path.sep).join("/")}`);
    }
  }
  return values.sort();
}

async function assertMissing(value) {
  try {
    await stat(value);
    assert.fail(`output directory already exists: ${value}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function option(argv, name) {
  const index = argv.indexOf(name);
  return index < 0 ? undefined : argv[index + 1];
}

function requiredOption(argv, name) {
  const value = option(argv, name);
  assert(value, `${name} is required`);
  return value;
}

function repeatedOptions(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name) {
      assert(argv[index + 1], `${name} requires a value`);
      values.push(argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

async function firstExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Continue to the next known development/package binary.
    }
  }
  assert.fail("Worldbend CLI not found; pass --worldbend-bin");
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

export class StdioClient {
  #child;
  #buffer = "";
  #nextId = 1;
  #pending = new Map();
  #stderr = "";

  constructor(command, args) {
    this.#child = spawn(command, args, {
      cwd: root,
      env: process.env,
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
      clientInfo: { name: "composition-provider-chain-check", version: "1" },
    });
    assert.equal(response.result.serverInfo.name, "worldbend");
    this.#send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  }

  callTool(name, arguments_) {
    return this.request("tools/call", { name, arguments: arguments_ });
  }

  request(method, params) {
    const id = this.#nextId++;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timer });
    });
    this.#send({ jsonrpc: "2.0", id, method, params });
    return promise;
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
      else pending.resolve(message);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main(process.argv.slice(2));
}
