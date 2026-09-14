import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { sha256File } from "./deterministic-tar.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The Worldbend DMG verifier requires macOS arm64");
}

const workspace = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const defaultName = `worldbend-${workspace.version}-macos-arm64.dmg`;
const requested = process.argv.slice(2).find((argument) => argument !== "--");
if (requested === undefined) throw new Error("Pass the Worldbend DMG path to verify");
const dmg = path.resolve(requested);
assert.equal(path.basename(dmg), defaultName, `DMG must be named ${defaultName}`);
const releasePath = path.join(path.dirname(dmg), `worldbend-${workspace.version}-macos-arm64.release.json`);
const checksumPath = `${dmg}.sha256`;
const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-dmg-verify-"));
const mountpoint = path.join(scratch, "mounted");
let mounted = false;

try {
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  assert.equal(release.schema, "worldbend.macos-dmg-release.v1");
  assert.equal(release.dmg, path.basename(dmg));
  assert.equal(release.platform, "darwin-arm64");
  assert.deepEqual(release.trust, {
    developerIdSigned: false,
    notarized: false,
    distribution: "unsigned-public-preview",
  });
  const expectedDmgSha256 = (await readFile(checksumPath, "utf8")).trim().split(/\s+/)[0];
  const dmgSha256 = await sha256File(dmg);
  assert.equal(dmgSha256, expectedDmgSha256, "DMG digest differs from its sidecar");
  assert.equal(release.dmgSha256, `sha256:${dmgSha256}`, "DMG digest differs from release manifest");
  assert.equal((await lstat(dmg)).size, release.dmgBytes, "DMG size differs from release manifest");
  await run("/usr/bin/hdiutil", ["verify", "-quiet", dmg]);

  await mkdir(mountpoint);
  await run("/usr/bin/hdiutil", ["attach", "-quiet", "-readonly", "-nobrowse", "-mountpoint", mountpoint, dmg]);
  mounted = true;

  const payload = JSON.parse(await readFile(path.join(mountpoint, "PACKAGE-MANIFEST.json"), "utf8"));
  assert.equal(payload.schema, "worldbend.macos-dmg-payload.v1");
  assert.equal(payload.platform, "darwin");
  assert.equal(payload.architecture, "arm64");
  assert.deepEqual(payload.component, release.component, "Mounted component identity differs from release manifest");
  assert.deepEqual(payload.trust, release.trust, "Mounted trust disclosure differs from release manifest");

  const expectedFiles = [
    "PACKAGE-MANIFEST.json",
    "README.txt",
    "SHA256SUMS.txt",
    payload.component.archive,
  ].sort();
  const actualFiles = (await readdir(mountpoint)).sort();
  assert.deepEqual(actualFiles, expectedFiles, "DMG contains unexpected or missing entries");
  for (const file of actualFiles) {
    assert((await lstat(path.join(mountpoint, file))).isFile(), `DMG entry must be a regular file: ${file}`);
  }
  const checksums = parseChecksums(await readFile(path.join(mountpoint, "SHA256SUMS.txt"), "utf8"));
  for (const file of [payload.component.archive, "PACKAGE-MANIFEST.json", "README.txt"]) {
    assert.equal(await sha256File(path.join(mountpoint, file)), checksums.get(file), `${file} digest differs`);
  }

  const componentArchive = path.join(mountpoint, payload.component.archive);
  const componentSha256 = await sha256File(componentArchive);
  assert.equal(payload.component.sha256, `sha256:${componentSha256}`);
  assert.equal((await lstat(componentArchive)).size, payload.component.bytes);
  const extracted = path.join(scratch, "component");
  await mkdir(extracted);
  await run("/usr/bin/bsdtar", ["-x", "-z", "-f", componentArchive, "-C", extracted]);
  const descriptor = JSON.parse(await readFile(path.join(extracted, "component.json"), "utf8"));
  assert.equal(descriptor.schemaVersion, payload.component.schema);
  assert.equal(descriptor.id, payload.component.id);
  assert.equal(descriptor.version, payload.component.version);
  assert.equal(descriptor.integration.schemaVersion, payload.component.integrationSchema);
  assert.equal(hash(await readFile(path.join(extracted, "component.json"))), payload.component.descriptorSha256);
  await verifyComponentFiles(extracted, descriptor);

  const pluginRoot = path.join(extracted, descriptor.integration.codex.pluginRoot);
  const mcp = path.join(extracted, descriptor.entrypoints.mcp);
  const kind = await capture("/usr/bin/file", [mcp]);
  assert.match(kind, /Mach-O 64-bit executable arm64/u, "MCP executable is not macOS arm64");
  const signature = await capture("/usr/bin/codesign", ["-dv", "--verbose=4", mcp], { includeStderr: true });
  assert.match(signature, /Signature=adhoc/u, "MCP executable must carry the declared ad-hoc signature");
  assert.doesNotMatch(signature, /Authority=Developer ID/u, "Release incorrectly contains a Developer ID signature");
  await run(process.execPath, [path.join(root, "scripts", "mcp-runtime-smoke.mjs"), "--plugin-root", pluginRoot]);

  console.log(JSON.stringify({
    dmg,
    sha256: dmgSha256,
    mountedInventory: "PASS",
    componentInventory: "PASS",
    signature: "adhoc",
    notarized: false,
    mcp: "tools/list+call PASS",
  }, null, 2));
} finally {
  // A PASS must not turn into a failure through best-effort teardown: a busy
  // detach or a locked temp directory is reported, not thrown.
  if (mounted) await run("/usr/bin/hdiutil", ["detach", "-quiet", mountpoint]).catch(() => {});
  await rm(scratch, { recursive: true, force: true }).catch((error) => {
    console.error(`warning: could not remove verification scratch ${scratch}: ${error.message}`);
  });
}

function parseChecksums(text) {
  const checksums = new Map();
  for (const line of text.trim().split("\n")) {
    const match = line.match(/^([0-9a-f]{64})  ([^/]+)$/u);
    assert(match !== null, `Invalid checksum line: ${line}`);
    assert.equal(checksums.has(match[2]), false, `Duplicate checksum for ${match[2]}`);
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

async function verifyComponentFiles(rootDirectory, descriptor) {
  const actual = [];
  async function visit(relative = "") {
    for (const entry of await readdir(path.join(rootDirectory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(rootDirectory, name);
      const metadata = await lstat(absolute);
      assert.equal(metadata.isSymbolicLink(), false, `Component contains symlink ${name}`);
      if (metadata.isDirectory()) await visit(name);
      else {
        assert.equal(metadata.isFile(), true, `Component contains non-regular file ${name}`);
        if (name !== "component.json") actual.push(name);
      }
    }
  }
  await visit();
  const expected = descriptor.files.map((file) => file.path).sort();
  assert.deepEqual(actual.sort(), expected, "Component archive file set differs from component.json");
  for (const file of descriptor.files) {
    const absolute = path.join(rootDirectory, file.path);
    const metadata = await lstat(absolute);
    assert.equal(metadata.size, file.bytes, `${file.path} byte length differs`);
    assert.equal(hash(await readFile(absolute)), file.sha256, `${file.path} digest differs`);
    assert.equal(Boolean(metadata.mode & 0o111), file.executable, `${file.path} executable mode differs`);
  }
}

function hash(data) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function capture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(options.includeStderr ? `${stdout}${stderr}` : stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}
