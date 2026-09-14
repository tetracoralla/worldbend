import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const epoch = new Date(0);
// The packaging entry points are darwin-guarded; absolute tool paths keep
// deterministic builds working under sanitized PATH environments.
const BSDTAR = "/usr/bin/bsdtar";
const GZIP = "/usr/bin/gzip";
const USTAR_MAX_PATH = 255;

export async function normalizeRegularTree(root) {
  const metadata = await lstat(root);
  if (metadata.isSymbolicLink()) throw new Error(`Cannot package symlink ${root}`);
  if (metadata.isDirectory()) {
    for (const entry of (await readdir(root, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      await normalizeRegularTree(path.join(root, entry.name));
    }
    await chmod(root, 0o755);
  } else if (metadata.isFile()) {
    await chmod(root, (metadata.mode & 0o111) === 0 ? 0o644 : 0o755);
  } else {
    throw new Error(`Cannot package non-regular entry ${root}`);
  }
  await utimes(root, epoch, epoch);
}

export async function createDeterministicTarGz({ sourceDirectory, relativeFiles, archive, scratchDirectory }) {
  const sourceRoot = path.resolve(sourceDirectory);
  const members = [...new Set(relativeFiles)].sort();
  if (members.length !== relativeFiles.length) throw new Error("Archive file list contains duplicates");

  for (const member of members) {
    if (
      member.length === 0
      || path.isAbsolute(member)
      || member.includes("\\")
      || member.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`Unsafe archive member ${member}`);
    }
    // ustar carries at most 100 name + 155 prefix characters; bsdtar would
    // reject longer members anyway, with a less actionable message.
    if (member.length > USTAR_MAX_PATH) {
      throw new Error(`Archive member exceeds the ustar ${USTAR_MAX_PATH}-character path limit: ${member}`);
    }
    const absolute = path.resolve(sourceRoot, member);
    if (absolute !== sourceRoot && !absolute.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(`Archive member escapes source root: ${member}`);
    }
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Archive member must be one regular file: ${member}`);
    }
  }

  await mkdir(scratchDirectory, { recursive: true });
  const listPath = path.join(scratchDirectory, `.tar-members-${process.pid}.txt`);
  const temporaryTar = path.join(scratchDirectory, `.archive-${process.pid}.tar`);
  const temporaryArchive = `${archive}.tmp-${process.pid}`;
  try {
    await writeFile(listPath, `${members.join("\n")}\n`, "utf8");
    await run(BSDTAR, [
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
      sourceRoot,
      "-T",
      listPath,
    ]);
    await runToFile(GZIP, ["-n", "-c", temporaryTar], temporaryArchive);
    await rename(temporaryArchive, archive);
  } finally {
    await rm(listPath, { force: true });
    await rm(temporaryTar, { force: true });
    await rm(temporaryArchive, { force: true });
  }
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
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
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "inherit"] });
    let childFinished = false;
    let sinkFinished = false;
    let settled = false;
    const finish = () => {
      if (!settled && childFinished && sinkFinished) {
        settled = true;
        resolve();
      }
    };
    const fail = (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    child.stdout.pipe(sink);
    child.once("error", fail);
    child.once("exit", (code) => {
      if (code !== 0) fail(new Error(`${command} exited with ${code}`));
      else {
        childFinished = true;
        finish();
      }
    });
    sink.once("finish", () => {
      sinkFinished = true;
      finish();
    });
    sink.once("error", fail);
  });
}
