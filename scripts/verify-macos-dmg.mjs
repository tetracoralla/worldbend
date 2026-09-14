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

import {
  assertExactArchiveMembers,
  assertRegularArchiveListing,
  sha256File,
} from "./deterministic-tar.mjs";

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
const CAPTURE_MAX_BYTES = 1024 * 1024;
let mounted = false;

try {
  const release = JSON.parse(await readFile(releasePath, "utf8"));
  assert.equal(release.schema, "worldbend.macos-dmg-release.v1");
  assert.equal(release.product, "Worldbend");
  assert.equal(release.productVersion, workspace.version);
  assert.equal(release.dmg, path.basename(dmg));
  assert.equal(release.platform, "darwin-arm64");
  assert.deepEqual(release.trust, {
    developerIdSigned: false,
    notarized: false,
    distribution: "unsigned-public-preview",
  });
  const expectedDmgSha256 = parseChecksumSidecar(
    await readFile(checksumPath, "utf8"),
    path.basename(dmg),
  );
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
  assert.equal(payload.product, release.product);
  assert.equal(payload.productVersion, release.productVersion);
  assert.equal(payload.platform, "darwin");
  assert.equal(payload.architecture, "arm64");
  assert.deepEqual(payload.component, release.component, "Mounted component identity differs from release manifest");
  assert.deepEqual(payload.trust, release.trust, "Mounted trust disclosure differs from release manifest");
  assert.deepEqual(payload.source, release.source, "Mounted source provenance differs from release manifest");
  assert.match(payload.source.revision, /^[0-9a-f]{40}$/u, "Source revision must be one full Git object id");
  assert.equal(typeof payload.source.dirty, "boolean", "Source dirty state must be explicit");

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
  const payloadChecksumFiles = [payload.component.archive, "PACKAGE-MANIFEST.json", "README.txt"].sort();
  assert.deepEqual([...checksums.keys()].sort(), payloadChecksumFiles, "DMG checksum inventory differs from its payload");
  for (const file of payloadChecksumFiles) {
    assert.equal(await sha256File(path.join(mountpoint, file)), checksums.get(file), `${file} digest differs`);
  }

  const componentArchive = path.join(mountpoint, payload.component.archive);
  const componentSha256 = await sha256File(componentArchive);
  assert.equal(payload.component.sha256, `sha256:${componentSha256}`);
  assert.equal((await lstat(componentArchive)).size, payload.component.bytes);

  const publishedComponent = path.join(path.dirname(dmg), payload.component.archive);
  const publishedComponentSha256 = await sha256File(publishedComponent);
  assert.equal(publishedComponentSha256, componentSha256, "Separate component asset differs from the DMG payload");
  assert.equal((await lstat(publishedComponent)).size, payload.component.bytes);
  assert.equal(
    parseChecksumSidecar(
      await readFile(`${publishedComponent}.sha256`, "utf8"),
      payload.component.archive,
    ),
    componentSha256,
    "Separate component digest differs from its sidecar",
  );

  const archiveMembers = (await captureBuffer("/usr/bin/bsdtar", ["-t", "-z", "-f", componentArchive]))
    .toString("utf8")
    .split("\n")
    .filter((member) => member.length > 0);
  // Read the descriptor without extracting any archive member. Only after its
  // closed inventory agrees with a safe, duplicate-free tar list do we allow
  // bsdtar to materialize the tree.
  const descriptor = JSON.parse(
    (await captureBuffer("/usr/bin/bsdtar", ["-x", "-O", "-z", "-f", componentArchive, "component.json"]))
      .toString("utf8"),
  );
  assert(Array.isArray(descriptor.files), "Component descriptor must contain a file inventory");
  assertExactArchiveMembers(
    archiveMembers,
    [...descriptor.files.map((file) => file.path), "component.json"],
  );
  const verboseArchiveEntries = (await captureBuffer(
    "/usr/bin/bsdtar",
    ["-t", "-v", "-z", "-f", componentArchive],
  )).toString("utf8").split("\n").filter((entry) => entry.length > 0);
  assertRegularArchiveListing(verboseArchiveEntries, archiveMembers.length);
  const extracted = path.join(scratch, "component");
  await mkdir(extracted);
  await run("/usr/bin/bsdtar", ["-x", "-z", "-f", componentArchive, "-C", extracted]);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(extracted, "component.json"), "utf8")),
    descriptor,
    "Extracted descriptor differs from the preflighted archive member",
  );
  assert.equal(descriptor.schemaVersion, payload.component.schema);
  assert.equal(descriptor.id, payload.component.id);
  assert.equal(descriptor.version, payload.component.version);
  assert.equal(descriptor.integration.schemaVersion, payload.component.integrationSchema);
  assert.equal(hash(await readFile(path.join(extracted, "component.json"))), payload.component.descriptorSha256);
  await verifyComponentFiles(extracted, descriptor);

  const pluginRoot = path.join(extracted, descriptor.integration.codex.pluginRoot);
  const binaryPrefix = `${descriptor.integration.codex.pluginRoot}/bin/`;
  const executables = descriptor.files.filter((file) => file.executable);
  const binaries = executables.filter((file) => file.path.startsWith(binaryPrefix));
  assert.deepEqual(
    binaries.map((file) => file.path),
    executables.map((file) => file.path),
    "Every executable component file must remain under the declared plugin bin directory",
  );
  assert(binaries.length > 0, "Component contains no declared native executables");
  for (const binary of binaries) {
    const executable = path.join(extracted, binary.path);
    const kind = await capture("/usr/bin/file", [executable]);
    assert.match(kind, /Mach-O 64-bit executable arm64/u, `${binary.path} is not macOS arm64`);
    const signature = await capture("/usr/bin/codesign", ["-dv", "--verbose=4", executable], { includeStderr: true });
    assert.match(signature, /Signature=adhoc/u, `${binary.path} must carry the declared ad-hoc signature`);
    assert.doesNotMatch(signature, /Authority=Developer ID/u, `${binary.path} unexpectedly contains a Developer ID signature`);
  }
  const mcp = path.join(extracted, descriptor.entrypoints.mcp);
  await run(process.execPath, [path.join(root, "scripts", "mcp-runtime-smoke.mjs"), "--plugin-root", pluginRoot]);

  console.log(JSON.stringify({
    dmg,
    sha256: dmgSha256,
    mountedInventory: "PASS",
    componentInventory: "PASS",
    signedBinaries: binaries.length,
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

function parseChecksumSidecar(text, expectedName) {
  const match = text.match(/^([0-9a-f]{64})  ([^/\r\n]+)\n?$/u);
  assert(match !== null, "Invalid checksum sidecar");
  assert.equal(match[2], expectedName, "Checksum sidecar names the wrong artifact");
  return match[1];
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
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    };
    const append = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? CAPTURE_MAX_BYTES)) {
        fail(new Error(`${command} output exceeded the verification limit`));
        return target;
      }
      return target + chunk;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    child.once("error", fail);
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(options.includeStderr ? `${stdout}${stderr}` : stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

function captureBuffer(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(error);
    };
    const accept = (chunk) => {
      bytes += chunk.length;
      if (bytes > CAPTURE_MAX_BYTES) {
        fail(new Error(`${command} output exceeded the verification limit`));
        return false;
      }
      return true;
    };
    child.stdout.on("data", (chunk) => { if (accept(chunk)) stdout.push(chunk); });
    child.stderr.on("data", (chunk) => { if (accept(chunk)) stderr += chunk; });
    child.once("error", fail);
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(Buffer.concat(stdout));
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
