import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeDeterministicZip } from "./deterministic-zip.mjs";
import { writeComfyLegalMaterial } from "./generate-plugin-legal.mjs";
import { platformExecutableName } from "./platform-tooling.mjs";
import {
  assertCarrierIsolation,
  listRegularFiles,
  loadCarrierProfiles,
} from "./carrier-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "packages", "comfyui");
const workspacePackage = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const carrierProfiles = await loadCarrierProfiles();
const comfyPackageProfile = carrierProfiles.carriers.comfyui.package;
const version = String(workspacePackage.version).replace(/[^0-9A-Za-z._-]/g, "-");
const packageName = `worldbend-comfyui-${version}-${process.platform}-${process.arch}`;
const artifactsRoot = path.join(root, "artifacts", "comfyui");
const outputRoot = path.join(artifactsRoot, packageName);
const archivePath = path.join(artifactsRoot, `${packageName}.zip`);
const binaryName = platformExecutableName(comfyPackageProfile.nativeExecutable);

await run("cargo", [
  "build",
  "--locked",
  "--release",
  "-p",
  "worldbend-cli",
  "--bin",
  "worldbend",
  "--no-default-features",
  "--features",
  comfyPackageProfile.nativeCargoFeatures.join(","),
]);
await mkdir(artifactsRoot, { recursive: true });
await rm(outputRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await writeComfyLegalMaterial({ destination: outputRoot });
await mkdir(path.join(outputRoot, "bin"), { recursive: true });
await mkdir(path.join(outputRoot, "examples"), { recursive: true });

for (const entry of comfyPackageProfile.sourceEntries) {
  await copyFile(path.join(sourceRoot, entry), path.join(outputRoot, entry));
}
for (const entry of comfyPackageProfile.exampleEntries) {
  await copyFile(path.join(sourceRoot, entry), path.join(outputRoot, entry));
}
const stagedBinary = path.join(outputRoot, "bin", binaryName);
await copyFile(path.join(root, "target", "release", binaryName), stagedBinary);
if (process.platform !== "win32") await chmod(stagedBinary, 0o755);

const binaryVersion = (
  await run(stagedBinary, ["--version"], { capture: true })
).trim();
if (binaryVersion !== `worldbend ${workspacePackage.version}`) {
  throw new Error(`Unexpected staged Worldbend version: ${binaryVersion}`);
}
const binaryHelp = await run(stagedBinary, ["--help"], { capture: true });
for (const command of [
  "inspect",
  "render",
  "rectify",
  "rectify-render",
  "canvas-inspect",
  "canvas-render",
  "remap-inspect",
  "remap-render",
]) {
  if (!binaryHelp.includes(`  ${command}`)) {
    throw new Error(`ComfyUI runtime is missing required command: ${command}`);
  }
}
for (const command of [
  "compose",
  "solve",
  "css",
  "schema",
  "mockup-inspect",
  "mockup-render",
  "mockup-extract-inspect",
  "mockup-extract-render",
  "mesh-inspect",
  "mesh-render",
  "timeline-inspect",
  "timeline-render",
  "program-inspect",
  "program-render",
]) {
  if (binaryHelp.includes(`  ${command}`)) {
    throw new Error(`ComfyUI runtime unexpectedly contains full CLI command: ${command}`);
  }
}

const payloadFiles = await listRegularFiles(outputRoot);
assertCarrierIsolation(payloadFiles, comfyPackageProfile, "ComfyUI package");
for (const required of ["THIRD_PARTY_NOTICES.md", "licenses", "sbom"]) {
  if (!payloadFiles.some((entry) => entry === required || entry.startsWith(`${required}/`))) {
    throw new Error(`ComfyUI local package is missing legal inventory: ${required}`);
  }
}
const manifest = {
  schema: "worldbend.comfyui.local-package",
  version: "0.1",
  packageVersion: workspacePackage.version,
  platform: process.platform,
  architecture: process.arch,
  nativeExecutable: `bin/${binaryName}`,
  nativeVersion: binaryVersion,
  files: Object.fromEntries(
    await Promise.all(
      payloadFiles.map(async (entry) => [
        entry,
        {
          bytes: (await stat(path.join(outputRoot, entry))).size,
          sha256: await sha256(path.join(outputRoot, entry)),
        },
      ]),
    ),
  ),
};
await writeFile(
  path.join(outputRoot, "PACKAGE-MANIFEST.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

const entries = await listRegularFiles(outputRoot);
assertCarrierIsolation(entries, comfyPackageProfile, "ComfyUI package");
const archivedEntries = await writeDeterministicZip({
  archivePath,
  sourceRoot: outputRoot,
  rootName: packageName,
  entries,
  executableEntries: [`bin/${binaryName}`],
});
const expectedArchiveEntries = entries
  .map((entry) => `${packageName}/${entry}`)
  .sort();
if (JSON.stringify(archivedEntries) !== JSON.stringify(expectedArchiveEntries)) {
  throw new Error("ComfyUI local ZIP inventory does not match the staged package");
}

process.stdout.write(`${JSON.stringify({
  package: outputRoot,
  archive: archivePath,
  archiveBytes: (await stat(archivePath)).size,
  archiveSha256: await sha256(archivePath),
  files: entries,
}, null, 2)}\n`);

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.trim()}`));
    });
  });
}
