import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginManifest = JSON.parse(
  await readFile(path.join(root, "plugins", "worldbend", ".codex-plugin", "plugin.json"), "utf8"),
);
const artifact = process.argv[2] ?? path.join(
  root,
  "artifacts",
  "codex-plugin",
  `worldbend-${pluginManifest.version}-codex-macos-arm64.tar.gz`,
);
const archive = path.resolve(artifact);
const checksum = `${archive}.sha256`;
const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-plugin-verify-"));

try {
  const expected = (await readFile(checksum, "utf8")).trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(await readFile(archive)).digest("hex");
  assert.equal(actual, expected, "archive SHA-256 does not match its sidecar");
  await run("bsdtar", ["-x", "-z", "-f", archive, "-C", scratch]);
  const extracted = path.join(scratch, "worldbend");
  assert((await lstat(extracted)).isDirectory(), "archive must contain one worldbend root");
  await assertRegularTree(extracted);
  for (const relative of [
    "THIRD_PARTY_NOTICES.md",
    "licenses/_common/Apache-2.0.txt",
    "sbom/worldbend-macos-arm64.spdx.json",
  ]) {
    assert((await stat(path.join(extracted, relative))).size > 0, `${relative} is missing from archive`);
  }
  const mcp = path.join(extracted, "bin", "worldbend-mcp");
  const kind = await capture("file", [mcp]);
  assert(kind.includes("Mach-O 64-bit executable arm64"), "extracted MCP must be macOS arm64");
  const linked = await capture("otool", ["-L", mcp]);
  assert(linked.includes("/usr/lib/libSystem.B.dylib"), "extracted MCP lacks expected macOS system runtime");
  // This starts the copied native binary and exercises initialize, tools/list,
  // every tool's ordinary/negative paths, and render lifecycle. The smoke is
  // intentionally source-independent with respect to the executable itself.
  await run(process.execPath, [path.join(root, "scripts", "mcp-runtime-smoke.mjs"), "--plugin-root", extracted]);
  console.log(JSON.stringify({ archive, sha256: actual, extractedMcp: "tools/list+call PASS" }));
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function assertRegularTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `archive contains symlink ${child}`);
    if (entry.isDirectory()) await assertRegularTree(child);
    else assert.equal(entry.isFile(), true, `archive contains non-regular file ${child}`);
  }
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} exited with ${code}: ${stderr}`)));
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}
