import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeFigmaLegalMaterial } from "./generate-plugin-legal.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const figmaRoot = path.join(repositoryRoot, "packages", "figma");
const manifestPath = path.join(figmaRoot, "manifest.json");
const packageMetadataPath = path.join(figmaRoot, "package.json");
const artifactsRoot = path.join(repositoryRoot, "artifacts", "figma");

const runtimeEntries = ["manifest.json", "dist/main.js", "dist/ui.html"];

async function assertRegularNonemptyFile(filePath) {
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error(`Expected a non-empty regular file: ${filePath}`);
  }
}

async function sha256(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolute)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with status ${result.status}: ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const packageMetadata = JSON.parse(await readFile(packageMetadataPath, "utf8"));
if (manifest.main !== "dist/main.js" || manifest.ui !== "dist/ui.html") {
  throw new Error(
    `Unexpected Figma entry points: main=${manifest.main}, ui=${manifest.ui}`,
  );
}

for (const entry of runtimeEntries) {
  await assertRegularNonemptyFile(path.join(figmaRoot, entry));
}
const safeVersion = String(packageMetadata.version).replace(/[^0-9A-Za-z._-]/g, "-");
const packageName = `worldbend-figma-${safeVersion}`;
const packageRoot = path.join(artifactsRoot, packageName);
const archivePath = path.join(artifactsRoot, `${packageName}.zip`);

await mkdir(artifactsRoot, { recursive: true });
await rm(packageRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await writeFigmaLegalMaterial({ destination: packageRoot });
const legalFiles = await listFiles(packageRoot);
const requiredLegalFiles = [
  "THIRD_PARTY_NOTICES.md",
  "sbom/worldbend-figma-wasm.spdx.json",
];
for (const entry of requiredLegalFiles) {
  if (!legalFiles.includes(entry)) throw new Error(`Missing Figma legal file: ${entry}`);
}
if (!legalFiles.some((entry) => entry.startsWith("licenses/"))) {
  throw new Error("Figma legal inventory has no copied dependency licenses");
}
for (const entry of legalFiles) {
  if (!requiredLegalFiles.includes(entry) && !entry.startsWith("licenses/")) {
    throw new Error(`Unexpected Figma legal file: ${entry}`);
  }
}
await mkdir(path.join(packageRoot, "dist"), { recursive: true });

for (const entry of runtimeEntries) {
  await cp(path.join(figmaRoot, entry), path.join(packageRoot, entry));
}
const designerReadme = `# Worldbend for Figma\n\nThis folder is a self-contained Figma Desktop plugin. Keep every file in place.\n\n## Install\n\n1. Extract the entire ZIP.\n2. In Figma Desktop, choose Plugins > Development > Import plugin from manifest.\n3. Select this folder's manifest.json.\n4. Run Worldbend from Plugins > Development.\n\nNo source checkout, Node, pnpm, Rust, local server, or product-owned network service is required.\n\n## Output behavior\n\nSelect one source layer. Worldbend supports locally exportable layers and has been verified with an image-filled Rectangle and a Frame. Applying a transform creates a raster Rectangle with an Image fill; it does not replace the original editable source. Select the original together with one prior Worldbend result to continue editing or replace that result. Raster output is limited to 4096 pixels per axis.\n\n## Third-party components\n\nTHIRD_PARTY_NOTICES.md, licenses/, and sbom/ describe the locked Rust dependency closure used to build the embedded WebAssembly runtime.\n`;
await writeFile(path.join(packageRoot, "README.md"), designerReadme, "utf8");

const checksummedEntries = await listFiles(packageRoot);
const checksumLines = [];
for (const entry of checksummedEntries) {
  checksumLines.push(`${await sha256(path.join(packageRoot, entry))}  ${entry}`);
}
await writeFile(
  path.join(packageRoot, "SHA256SUMS.txt"),
  `${checksumLines.join("\n")}\n`,
  "utf8",
);

const unpackedFiles = await listFiles(packageRoot);
const expectedFiles = [...checksummedEntries, "SHA256SUMS.txt"].sort();
if (JSON.stringify(unpackedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Unexpected package inventory: ${JSON.stringify(unpackedFiles)}`,
  );
}

// ZIP records carry file timestamps even with extra metadata disabled. Pin
// every entry and omit directory records so identical reviewed inputs produce
// the same release asset bytes across repeated packaging runs.
const archiveTimestamp = new Date("1980-01-01T00:00:00.000Z");
for (const entry of unpackedFiles) {
  await utimes(path.join(packageRoot, entry), archiveTimestamp, archiveTimestamp);
}
run("zip", ["-X", "-q", "-D", "-r", archivePath, packageName], {
  cwd: artifactsRoot,
  env: { ...process.env, TZ: "UTC" },
});
await assertRegularNonemptyFile(archivePath);

const zipInventory = run("unzip", ["-Z1", archivePath])
  .split("\n")
  .filter(Boolean)
  .filter((entry) => !entry.endsWith("/"))
  .map((entry) => entry.slice(`${packageName}/`.length))
  .sort();
if (JSON.stringify(zipInventory) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `ZIP inventory mismatch: ${JSON.stringify(zipInventory)}`,
  );
}

const archiveMetadata = await stat(archivePath);
const result = {
  package: packageRoot,
  archive: archivePath,
  archiveBytes: archiveMetadata.size,
  archiveSha256: await sha256(archivePath),
  files: expectedFiles,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
