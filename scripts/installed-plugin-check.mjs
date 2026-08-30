import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "worldbend");
const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
const install = process.argv.includes("--install");
const runtimeSmoke = process.argv.includes("--runtime-smoke");
const executableSuffix = process.platform === "win32" ? ".exe" : "";

const manifest = JSON.parse(
  await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
const workspacePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const marketplace = JSON.parse(await readFile(marketplacePath, "utf8"));
assert.equal(marketplace.name, "worldbend-local");
assert.equal(marketplace.plugins?.[0]?.name, "worldbend");
assert.deepEqual(marketplace.plugins[0].source, {
  source: "local",
  path: "./plugins/worldbend",
});

let installedPath;
if (install) {
  let registered;
  try {
    registered = await runJson("codex", ["plugin", "marketplace", "add", root, "--json"]);
  } catch (error) {
    // A managed host (for example an Agent Host Suite projection) may own the
    // registration from its own projected copy of this marketplace. The repo
    // cannot re-point that registration; the layout-aware resolution below
    // verifies the registered runtime the host will actually execute.
    if (!String(error.message).includes("already added")) throw error;
    console.log(
      "marketplace is already registered by the host from its projection; verifying the registered runtime instead of re-adding",
    );
  }
  if (registered) {
    assert.equal(registered.marketplaceName, marketplace.name);
    if (registered.installedRoot !== undefined) {
      const registeredRoot = await realpath(registered.installedRoot);
      if (registeredRoot !== (await realpath(root))) {
        // A managed host may project the registered marketplace into its own
        // location instead of registering the checkout in place. That is
        // acceptable as long as the projection carries this marketplace's
        // manifest; the runtime root is still resolved from the live CLI below.
        const projected = existsSync(
          path.join(registeredRoot, ".agents", "plugins", "marketplace.json"),
        );
        assert(
          projected,
          `marketplace registered from an unrecognized location: ${registeredRoot}`,
        );
        console.log(`marketplace projected by the host at ${registeredRoot}`);
      }
    }

    const installed = await runJson("codex", [
      "plugin",
      "add",
      `worldbend@${marketplace.name}`,
      "--json",
    ]);
    assert.equal(installed.version, manifest.version);
    installedPath = installed.installedPath;
  }
} else {
  const codexRoot = process.env.CODEX_HOME
    ? path.resolve(process.env.CODEX_HOME)
    : path.join(homedir(), ".codex");
  installedPath = path.join(
    codexRoot,
    "plugins",
    "cache",
    marketplace.name,
    manifest.name,
    manifest.version,
  );
}

const listing = await runJson("codex", [
  "plugin",
  "list",
  "--marketplace",
  marketplace.name,
  "--json",
]);
const entry = listing.installed?.find((candidate) => candidate.name === manifest.name);
assert(entry, "Worldbend is not installed from the local marketplace");
assert.equal(entry.version, manifest.version);
assert.equal(entry.enabled, true);
if (entry.source?.path !== undefined) {
  const sourcePath = await realpath(entry.source.path).catch(() => undefined);
  if (sourcePath !== undefined && sourcePath !== (await realpath(pluginRoot))) {
    // Accept a host-projected registration when it carries this plugin's
    // manifest; reject anything else rather than guessing.
    const projection = await readFile(
      path.join(sourcePath, ".codex-plugin", "plugin.json"),
      "utf8",
    )
      .then(JSON.parse)
      .catch(() => undefined);
    assert(
      projection?.name === manifest.name && projection?.version === manifest.version,
      `installed plugin source is not the staged distribution: ${sourcePath}`,
    );
  }
}

// Standard Codex installs into $CODEX_HOME/plugins/cache/<marketplace>/
// <plugin>/<version>. A managed host may instead register a projected
// marketplace whose plugin directory carries only the Skill and a rewritten
// .mcp.json that points at the real runtime copy. Resolve the root that the
// host will actually execute from instead of assuming one layout.
let hostManagedLayout = false;
function looksLikePluginRoot(directory) {
  return (
    typeof directory === "string" &&
    existsSync(path.join(directory, "bin", `worldbend-mcp${executableSuffix}`))
  );
}
if (!looksLikePluginRoot(installedPath)) {
  const candidates = [entry.source?.path].filter(Boolean);
  let resolved;
  for (const candidate of candidates) {
    if (looksLikePluginRoot(candidate)) {
      resolved = candidate;
      break;
    }
    try {
      const mcpConfig = JSON.parse(await readFile(path.join(candidate, ".mcp.json"), "utf8"));
      for (const server of Object.values(mcpConfig.mcpServers ?? {})) {
        const runtimeRoot =
          server.cwd && looksLikePluginRoot(server.cwd)
            ? server.cwd
            : typeof server.command === "string" && looksLikePluginRoot(
                path.dirname(path.dirname(server.command)),
              )
            ? path.dirname(path.dirname(server.command))
            : undefined;
        if (runtimeRoot) {
          resolved = runtimeRoot;
          hostManagedLayout = server.cwd !== undefined || server.command !== undefined;
          break;
        }
      }
    } catch {
      // Not a projected layout candidate; keep searching.
    }
    if (resolved) break;
  }
  assert(
    resolved,
    `could not resolve the installed Worldbend runtime root (tried ${installedPath})`,
  );
  installedPath = resolved;
}
const installedPathReal = await realpath(installedPath);
if (!hostManagedLayout) {
  assert.equal(path.basename(installedPathReal), manifest.version);
  assert.equal(path.basename(path.dirname(installedPathReal)), manifest.name);
  assert.equal(
    path.basename(path.dirname(path.dirname(installedPathReal))),
    marketplace.name,
  );
}

const sourceFiles = await inventory(pluginRoot);
const installedFiles = hostManagedLayout
  ? (await inventory(installedPath)).filter((file) => file.path !== ".mcp.json")
  : await inventory(installedPath);
const comparableSource = hostManagedLayout
  ? sourceFiles.filter((file) => file.path !== ".mcp.json")
  : sourceFiles;
assert.deepEqual(
  installedFiles,
  comparableSource,
  hostManagedLayout
    ? "the managed host runtime copy (excluding its rewritten .mcp.json) predates the staged build; refresh the host projection/package copy, then rerun"
    : "installed plugin bytes differ from the staged source distribution",
);
if (hostManagedLayout) {
  console.log(
    "host-managed layout: byte comparison excludes the rewritten .mcp.json; the runtime smoke validates the resolved copy",
  );
}

const cli = path.join(installedPath, "bin", `worldbend${executableSuffix}`);
const mcp = path.join(installedPath, "bin", `worldbend-mcp${executableSuffix}`);
const capabilityRoot = path.join(installedPath, "capabilities");
const provider = JSON.parse(
  await readFile(path.join(capabilityRoot, "provider.json"), "utf8"),
);
const implementation = provider.implementations?.[0];
assert(implementation, "installed Capability provider manifest is missing");
const capability = resolveProviderExecutable(
  capabilityRoot,
  implementation.adapter.command,
);
const schemaProbe = resolveProviderExecutable(
  capabilityRoot,
  implementation.transportSchemaProbe.command,
);
assert.equal(
  (await run(cli, ["--version"])).stdout.trim(),
  `worldbend ${workspacePackage.version}`,
);
assert.equal(
  (await run(mcp, ["--version"])).stdout.trim(),
  `worldbend-mcp ${workspacePackage.version}`,
);
assert.equal(
  (await run(capability, ["--version"])).stdout.trim(),
  `worldbend-capability ${workspacePackage.version}`,
);
assert.equal(
  (await run(schemaProbe, ["--version"])).stdout.trim(),
  `worldbend-transport-schema-probe ${workspacePackage.version}`,
);

const schemaResponse = JSON.parse(
  (
    await run(schemaProbe, [], {
      cwd: capabilityRoot,
      env: { OPENADAM_PROVIDER_ROOT: installedPath },
      input: `${JSON.stringify({
        id: "transport-schema",
        capabilityId: implementation.capabilityId,
        capabilityVersion: implementation.capabilityVersion,
      })}\n`,
    })
  ).stdout,
);
assert.equal(schemaResponse.ok, true);
assert.deepEqual(
  schemaResponse.bindings.map((binding) => binding.operationId),
  ["inspect", "render"],
);

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "worldbend-installed-check-"));
try {
  const specPath = path.join(fixtureRoot, "input.projective.json");
  await writeFile(specPath, JSON.stringify(makePixelSpec()));
  const capabilityInspect = JSON.parse(
    (
      await run(capability, [], {
        cwd: capabilityRoot,
        env: { OPENADAM_CAPABILITY_WORKSPACE_ROOT: fixtureRoot },
        input: `${JSON.stringify({
          id: "installed-check",
          operationId: "inspect",
          input: { spec: makePixelSpec() },
        })}\n`,
      })
    ).stdout,
  );
  assert.equal(capabilityInspect.ok, true);
  assert.equal(capabilityInspect.result.bounds.width, 100);
  const durations = [];
  let result;
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    const response = await run(cli, [
      "compose",
      "--spec",
      specPath,
      "--rotate",
      "90",
      "--json",
    ]);
    durations.push(performance.now() - started);
    result = JSON.parse(response.stdout);
  }
  assert.equal(result.ok, true);
  assert.deepEqual(result.result.canvas, {
    origin: { x: 25, y: -25 },
    size: { width: 50, height: 100 },
  });
  const warped = JSON.parse((await run(cli, [
    "compose",
    "--spec",
    specPath,
    "--warp",
    "arc",
    "--warp-amount",
    "0.75",
    "--json",
  ])).stdout);
  assert.equal(warped.ok, true);
  assert.deepEqual(warped.result.spec.content.warp, { preset: "arc", amount: 0.75 });

  durations.sort((left, right) => left - right);
  console.log(
    JSON.stringify({
      installedPlugin: "PASS",
      version: manifest.version,
      files: sourceFiles.length,
      directRoute: {
        operation: "compose",
        modelCalls: 0,
        modelTokens: 0,
        samples: durations.length,
        p50Ms: percentile(durations, 0.5),
        p95Ms: percentile(durations, 0.95),
      },
    }),
  );
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

if (runtimeSmoke) {
  await run(process.execPath, [
    path.join(root, "scripts", "mcp-runtime-smoke.mjs"),
    "--plugin-root",
    installedPath,
  ], { inherit: true, timeout: 120_000 });
}

async function inventory(directory) {
  const files = [];
  await visit(directory, "", files);
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function visit(directory, relative, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const childRelative = path.join(relative, entry.name);
    const child = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `${childRelative} may not be a symbolic link`);
    if (entry.isDirectory()) {
      await visit(child, childRelative, files);
    } else {
      assert.equal(entry.isFile(), true, `${childRelative} must be a regular file`);
      const metadata = await stat(child);
      const content = await readFile(child);
      files.push({
        path: childRelative,
        bytes: metadata.size,
        executable: process.platform === "win32" ? null : (metadata.mode & 0o111) !== 0,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
  }
}

function percentile(sorted, fraction) {
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1].toFixed(3));
}

function makePixelSpec() {
  return {
    version: "0.1",
    schema: "worldbend.transform",
    content: { fit: "stretch" },
    destination: {
      space: "pixel",
      reference: { width: 100, height: 50 },
      quad: {
        tl: { x: 0, y: 0 },
        tr: { x: 100, y: 0 },
        br: { x: 100, y: 50 },
        bl: { x: 0, y: 50 },
      },
    },
  };
}

function resolveProviderExecutable(base, relative) {
  assert.equal(path.isAbsolute(relative), false, "provider executable must be relative");
  const resolved = path.resolve(base, relative);
  assert(
    resolved.startsWith(`${installedPath}${path.sep}`),
    "provider executable must stay inside the installed distribution",
  );
  return process.platform === "win32" ? `${resolved}.exe` : resolved;
}

async function runJson(command, args) {
  const response = await run(command, args);
  return JSON.parse(response.stdout);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: { ...process.env, ...options.env },
      stdio: options.inherit
        ? "inherit"
        : [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: options.timeout ?? 30_000,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      if (options.input !== undefined) child.stdin.end(options.input);
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else if (signal === "SIGKILL") reject(new Error(`${command} timed out`));
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
