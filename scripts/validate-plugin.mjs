import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { isWorkspacePluginVersion } from "./plugin-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "worldbend");
// A crashed stage-plugin run leaves whole-directory swap residue behind. It
// must never ship, and byte-comparing residue to residue would pass.
const STAGING_RESIDUE_PREFIXES = [
  ".bin-stage-",
  ".bin-backup-",
  ".capabilities-stage-",
  ".capabilities-backup-",
  ".legal-stage-",
];
const pluginRootReal = await realpath(pluginRoot);
const pluginRootMetadata = await lstat(pluginRoot);
assert(
  pluginRootMetadata.isDirectory() && !pluginRootMetadata.isSymbolicLink(),
  "plugin root must be a real directory",
);
await assertRegularTree(pluginRoot, "plugin root");

const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
await assertContainedRegularFile(manifestPath, "plugin manifest");
const manifest = await readJson(manifestPath);
const workspacePackage = await readJson(path.join(root, "package.json"));

assert(manifest.name === "worldbend", "plugin name must remain worldbend");
assert(
  isWorkspacePluginVersion(manifest.version, workspacePackage.version),
  "plugin version must match the workspace version, with only an optional timestamped Codex cachebuster",
);
assert(!Object.hasOwn(manifest, "license"), "private plugin manifest must not declare a product license");
assert(
  typeof manifest.description === "string" && manifest.description.length > 0,
  "plugin description is required",
);
assert(
  Array.isArray(manifest.interface?.defaultPrompt) &&
    manifest.interface.defaultPrompt.length > 0 &&
    manifest.interface.defaultPrompt.length <= 3,
  "plugin must declare one to three starter prompts",
);
assert(
  new Set(manifest.interface.defaultPrompt).size ===
    manifest.interface.defaultPrompt.length,
  "plugin starter prompts must be unique",
);
assert(manifest.skills === "./skills/", "plugin skills path must remain ./skills/");
assert(
  manifest.mcpServers === "./.mcp.json",
  "plugin MCP path must remain ./.mcp.json",
);

const skillsRoot = resolveInside(pluginRoot, manifest.skills, "skills");
await assertContainedDirectory(skillsRoot, "skills root");
const skillPath = path.join(skillsRoot, "worldbend", "SKILL.md");
await assertContainedRegularFile(skillPath, "Worldbend Skill");
const skill = await readFile(skillPath, "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert(frontmatter, "Worldbend Skill must have YAML frontmatter");
assert(/^name:\s*worldbend\s*$/m.test(frontmatter[1]), "Skill name must be worldbend");
assert(
  /^description:\s*\S.+$/m.test(frontmatter[1]),
  "Skill description must be non-empty",
);

const mcpPath = resolveInside(pluginRoot, manifest.mcpServers, "mcpServers");
await assertContainedRegularFile(mcpPath, "MCP configuration");
const mcpConfig = await readJson(mcpPath);
const serverEntries = Object.entries(mcpConfig.mcpServers ?? {});
assert(serverEntries.length === 1, "plugin must declare exactly one MCP server");
const [serverName, server] = serverEntries[0];
assert(serverName === "worldbend", "MCP server name must be worldbend");
assert(
  server.command === "./bin/worldbend-mcp",
  "MCP command must remain the staged plugin-local executable",
);
assert(server.cwd === ".", "MCP server cwd must remain plugin-local");
assert(
  Array.isArray(server.args) && server.args.length === 0,
  "MCP server must not add implicit command arguments",
);
assert(
  Array.isArray(server.env_vars) &&
    server.env_vars.length === 1 &&
    server.env_vars[0] === "WORLDBEND_WORKSPACE_ROOT",
  "MCP server must request only WORLDBEND_WORKSPACE_ROOT",
);

const configuredMcpExecutable = resolveInside(pluginRoot, server.command, "MCP command");
const mcpExecutable =
  process.platform === "win32"
    ? `${configuredMcpExecutable}.exe`
    : configuredMcpExecutable;
const cliExecutable = path.join(pluginRoot, "bin", executableName("worldbend"));
const capabilityExecutable = path.join(
  pluginRoot,
  "bin",
  executableName("worldbend-capability"),
);
const probeExecutable = path.join(
  pluginRoot,
  "bin",
  executableName("worldbend-transport-schema-probe"),
);
await assertExecutable(mcpExecutable, "staged MCP executable");
await assertExecutable(cliExecutable, "staged CLI executable");
await assertExecutable(capabilityExecutable, "staged Capability executable");
await assertExecutable(probeExecutable, "staged transport-schema probe");
await assertVersion(cliExecutable, `worldbend ${workspacePackage.version}`);
await assertVersion(mcpExecutable, `worldbend-mcp ${workspacePackage.version}`);
await assertVersion(
  capabilityExecutable,
  `worldbend-capability ${workspacePackage.version}`,
);
await assertVersion(
  probeExecutable,
  `worldbend-transport-schema-probe ${workspacePackage.version}`,
);

const capabilitiesRoot = path.join(pluginRoot, "capabilities");
await assertContainedDirectory(capabilitiesRoot, "Capability distribution");
const providerPath = path.join(capabilitiesRoot, "provider.json");
await assertContainedRegularFile(providerPath, "Capability provider manifest");
const provider = await readJson(providerPath);
const implementation = provider.implementations?.[0];
assert(implementation, "Capability provider must declare one implementation");
assert(
  implementation.adapter?.command === "../bin/worldbend-capability" &&
    implementation.adapter?.args?.length === 0,
  "Capability adapter must be binary-relative and argument-free",
);
assert(
  implementation.transportSchemaProbe?.command ===
    "../bin/worldbend-transport-schema-probe" &&
    implementation.transportSchemaProbe?.args?.length === 0,
  "transport schema probe must be binary-relative and argument-free",
);
for (const operation of ["inspect", "render"]) {
  await assertContainedRegularFile(
    path.join(capabilitiesRoot, "schemas", `projective.${operation}.input.schema.json`),
    `${operation} input schema`,
  );
  await assertContainedRegularFile(
    path.join(capabilitiesRoot, "schemas", `projective.${operation}.output.schema.json`),
    `${operation} output schema`,
  );
  // The staged manifest's contract digests must match the staged schema
  // bytes themselves, not merely the source tree they were copied from.
  assert(
    implementation.bindings?.find((binding) => binding.operationId === operation)
      ?.contractSchemaDigests?.input ===
      canonicalDigest(
        await readFile(
          path.join(capabilitiesRoot, "schemas", `projective.${operation}.input.schema.json`),
        ),
      ),
    `${operation} staged input schema digest differs from the staged provider manifest`,
  );
  assert(
    implementation.bindings?.find((binding) => binding.operationId === operation)
      ?.contractSchemaDigests?.output ===
      canonicalDigest(
        await readFile(
          path.join(capabilitiesRoot, "schemas", `projective.${operation}.output.schema.json`),
        ),
      ),
    `${operation} staged output schema digest differs from the staged provider manifest`,
  );
}

for (const relative of [
  "THIRD_PARTY_NOTICES.md",
  "licenses/_common/Apache-2.0.txt",
  "sbom/worldbend-macos-arm64.spdx.json",
]) {
  await assertContainedRegularFile(path.join(pluginRoot, relative), `legal material ${relative}`);
}
const sbom = await readJson(path.join(pluginRoot, "sbom", "worldbend-macos-arm64.spdx.json"));
assert(sbom.spdxVersion === "SPDX-2.3", "SBOM must use SPDX 2.3");
assert(sbom.dataLicense === "CC0-1.0", "SBOM data license must be CC0-1.0");
assert(
  sbom.packages?.[0]?.licenseDeclared === "NOASSERTION" && sbom.packages.length > 1,
  "SBOM must leave Worldbend licensing undecided and identify its third-party runtime closure",
);
const notices = await readFile(path.join(pluginRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
assert(notices.includes("/usr/lib/libiconv.2.dylib"), "notices must identify the macOS native dependency");

if (process.platform === "darwin" && process.arch === "arm64") {
  for (const executable of [mcpExecutable, cliExecutable, capabilityExecutable, probeExecutable]) {
    const fileDescription = await run("file", [executable]);
    assert(fileDescription.includes("Mach-O 64-bit executable arm64"), `${path.basename(executable)} must be macOS arm64`);
    const linked = await run("otool", ["-L", executable]);
    const paths = linked.split("\n").slice(1).map((line) => line.trim().split(" ")[0]).filter(Boolean);
    assert(
      paths.every((entry) => entry === "/usr/lib/libSystem.B.dylib" || entry === "/usr/lib/libiconv.2.dylib"),
      `${path.basename(executable)} has an undeclared non-system native dependency`,
    );
  }
}

console.log(`Plugin validation passed: ${pluginRoot}`);

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function resolveInside(base, relative, label) {
  assert(typeof relative === "string" && relative.length > 0, `${label} path is required`);
  assert(!path.isAbsolute(relative), `${label} path must be relative`);
  const resolved = path.resolve(base, relative);
  assert(
    resolved === base || resolved.startsWith(`${base}${path.sep}`),
    `${label} path must stay inside the plugin`,
  );
  return resolved;
}

async function readJson(file) {
  const text = await readFile(file, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path.relative(root, file)}: ${error.message}`);
  }
}

async function assertContainedDirectory(directory, label) {
  await assertNoSymlinkComponents(directory, label);
  const metadata = await lstat(directory);
  assert(metadata.isDirectory(), `${label} must be a directory`);
  await assertRealpathInsidePlugin(directory, label);
}

async function assertContainedRegularFile(file, label) {
  await assertNoSymlinkComponents(file, label);
  const metadata = await lstat(file);
  assert(
    metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0,
    `${label} must be a non-empty regular file, not a symbolic link`,
  );
  await assertRealpathInsidePlugin(file, label);
  return metadata;
}

async function assertRegularTree(directory, label) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    assert(!entry.isSymbolicLink(), `${label} may not contain a symbolic link: ${child}`);
    assert(
      !STAGING_RESIDUE_PREFIXES.some((prefix) => entry.name.startsWith(prefix)),
      `${label} contains staging residue from an interrupted stage: ${child}`,
    );
    if (entry.isDirectory()) await assertRegularTree(child, label);
    else assert(entry.isFile(), `${label} must contain only regular files and directories: ${child}`);
  }
}

async function assertNoSymlinkComponents(target, label) {
  const relative = path.relative(pluginRoot, target);
  assert(
    relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative),
    `${label} must stay below the plugin root`,
  );
  let current = pluginRoot;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const metadata = await lstat(current);
    assert(!metadata.isSymbolicLink(), `${label} may not cross a symbolic link`);
  }
}

async function assertRealpathInsidePlugin(target, label) {
  const canonical = await realpath(target);
  assert(
    canonical.startsWith(`${pluginRootReal}${path.sep}`),
    `${label} real path must stay inside the plugin root`,
  );
}

async function assertExecutable(file, label) {
  const metadata = await assertContainedRegularFile(file, label);
  if (process.platform !== "win32") {
    assert((metadata.mode & 0o111) !== 0, `${label} must be executable`);
  }
}

async function assertVersion(executable, expected) {
  const output = await run(executable, ["--version"]);
  assert(output.trim() === expected, `${path.basename(executable)} version must be ${expected}`);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: pluginRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5_000,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 16_384) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 16_384) child.kill("SIGKILL");
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout);
      else if (signal === "SIGKILL") {
        reject(new Error(`${command} did not return its version within 5000ms`));
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalDigest(bytes) {
  return `sha256:${createHash("sha256").update(canonicalJson(JSON.parse(bytes))).digest("hex")}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
