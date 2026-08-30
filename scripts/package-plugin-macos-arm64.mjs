import { createHash } from "node:crypto";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "worldbend");
const artifacts = path.join(root, "artifacts", "codex-plugin");
const epoch = new Date(0);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The macOS arm64 plugin archive must be built on macOS arm64");
}

const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
const baseName = `worldbend-${manifest.version}-codex-macos-arm64`;
const archive = path.join(artifacts, `${baseName}.tar.gz`);
const checksum = `${archive}.sha256`;
const releaseManifest = path.join(artifacts, `${baseName}.release.json`);
const temporaryArchive = `${archive}.tmp-${process.pid}`;
const temporaryTar = `${archive}.tar.tmp-${process.pid}`;
const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-plugin-archive-"));

try {
  await run(process.execPath, [path.join(root, "scripts", "stage-plugin.mjs")]);
  await run(process.execPath, [path.join(root, "scripts", "validate-plugin.mjs")]);
  const archiveRoot = path.join(scratch, "worldbend");
  await cp(pluginRoot, archiveRoot, { recursive: true, verbatimSymlinks: true });
  await assertRegularTree(archiveRoot);
  await normalizeTree(archiveRoot);
  const members = await archiveMembers(scratch, "worldbend");
  const listPath = path.join(scratch, "members.txt");
  await writeFile(listPath, `${members.join("\n")}\n`, "utf8");
  await mkdir(artifacts, { recursive: true });
  await run("bsdtar", [
    "-c",
    "-f",
    temporaryTar,
    "--format",
    "ustar",
    "--uid",
    "0",
    "--gid",
    "0",
    "--numeric-owner",
    "--no-recursion",
    "-C",
    scratch,
    "-T",
    listPath,
  ]);
  // BSD tar's gzip wrapper records wall-clock metadata. Compressing the
  // canonical tar ourselves with -n removes the filename and timestamp.
  await runToFile("gzip", ["-n", "-c", temporaryTar], temporaryArchive);
  await rename(temporaryArchive, archive);
  const sha256 = await sha256File(archive);
  const bytes = (await stat(archive)).size;
  await writeFile(checksum, `${sha256}  ${path.basename(archive)}\n`, "utf8");
  await writeFile(
    releaseManifest,
    `${JSON.stringify({
      format: "worldbend-codex-plugin-release-v1",
      plugin: manifest.name,
      version: manifest.version,
      platform: "darwin",
      architecture: "arm64",
      archive: path.basename(archive),
      sha256,
      bytes,
      archiveRoot: "worldbend",
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({ archive, checksum, releaseManifest, sha256, bytes }));
} finally {
  await rm(scratch, { recursive: true, force: true });
  await rm(temporaryTar, { force: true }).catch(() => {});
  await rm(temporaryArchive, { force: true }).catch(() => {});
}

async function archiveMembers(parent, rootName) {
  const members = [];
  async function visit(relative) {
    const absolute = path.join(parent, relative);
    const metadata = await lstat(absolute);
    members.push(relative);
    if (metadata.isDirectory()) {
      for (const entry of (await readdir(absolute, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(path.join(relative, entry.name));
      }
    }
  }
  await visit(rootName);
  return members;
}

async function normalizeTree(directory) {
  const metadata = await lstat(directory);
  if (metadata.isDirectory()) {
    await chmod(directory, 0o755);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      await normalizeTree(path.join(directory, entry.name));
    }
  } else {
    await chmod(directory, (metadata.mode & 0o111) === 0 ? 0o644 : 0o755);
  }
  await utimes(directory, epoch, epoch);
}

async function assertRegularTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Archive cannot contain symlink ${child}`);
    if (entry.isDirectory()) await assertRegularTree(child);
    else if (!entry.isFile()) throw new Error(`Archive cannot contain special file ${child}`);
  }
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
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

function runToFile(command, args, output) {
  return new Promise((resolve, reject) => {
    const sink = createWriteStream(output, { flags: "wx" });
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.pipe(sink);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
    sink.once("error", reject);
  });
}
