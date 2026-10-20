import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeDeterministicZip } from "./deterministic-zip.mjs";
import { assertFigmaRuntimePrivacy } from "./build-privacy.mjs";
import { writeFigmaLegalMaterial } from "./generate-plugin-legal.mjs";
import {figmaRuntimeLicenseBanner} from "./figma-runtime-license.mjs";
import {
  assertByteBudget,
  assertCarrierIsolation,
  listRegularFiles,
  loadCarrierProfiles,
  sumFileBytes,
} from "./carrier-profiles.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const figmaRoot = path.join(repositoryRoot, "packages", "figma");
const manifestPath = path.join(figmaRoot, "manifest.json");
const packageMetadataPath = path.join(figmaRoot, "package.json");
const arguments_ = process.argv.slice(2);
if (arguments_.length > 1 || arguments_.some(value => !value.startsWith("--output-dir=") || !value.slice("--output-dir=".length))) {
  throw new Error("Usage: package-figma-designer.mjs [--output-dir=PATH]");
}
const artifactsRoot = arguments_[0]
  ? path.resolve(arguments_[0].slice("--output-dir=".length))
  : path.join(repositoryRoot, "artifacts", "figma");

const carrierProfiles = await loadCarrierProfiles();
const packageProfile = carrierProfiles.carriers.figma.package;
const runtimeEntries = packageProfile.runtimeEntries;

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
const runtimeLicenseBanner=figmaRuntimeLicenseBanner();
for(const entry of ["dist/main.js","dist/ui.html"]){
  if(!(await readFile(path.join(figmaRoot,entry),"utf8")).includes(runtimeLicenseBanner))
    throw Error(`Figma ${entry} does not retain the complete bundled JavaScript license`);
}
assertFigmaRuntimePrivacy(
  await readFile(path.join(figmaRoot, "dist/ui.html"), "utf8"),
  await readFile(path.join(figmaRoot, "dist/main.js"), "utf8"),
  [repositoryRoot],
);
const runtimeBytes = await sumFileBytes(figmaRoot, runtimeEntries);
assertByteBudget(runtimeBytes, packageProfile.maxRuntimeBytes, "Figma runtime payload");
const safeVersion = String(packageMetadata.version).replace(/[^0-9A-Za-z._-]/g, "-");
const packageName = `worldbend-figma-${safeVersion}`;
const packageRoot = path.join(artifactsRoot, packageName);
const archivePath = path.join(artifactsRoot, `${packageName}.zip`);

await mkdir(artifactsRoot, { recursive: true });
await rm(packageRoot, { recursive: true, force: true });
await rm(archivePath, { force: true });
await writeFigmaLegalMaterial({ destination: packageRoot, version: packageMetadata.version });
const legalFiles = await listRegularFiles(packageRoot);
const requiredLegalFiles = [
  "LICENSE",
  "NOTICE",
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
const designerReadme = `# Worldbend for Figma

This folder is a self-contained Figma Desktop plugin. Keep every file in place.

## Install

1. Extract the entire ZIP.
2. In Figma Desktop, choose Plugins > Development > Import plugin from manifest.
3. Select this folder's manifest.json.
4. Run Worldbend from Plugins > Development.

No source checkout, Node, pnpm, Rust, local server, or product-owned network service is required.

## Output behavior

Select a source on the Figma canvas and adjust its transform in Worldbend.
New Linked HD Image creates a stable image without changing the original. Raster
output is limited to 4096 pixels per axis.

Select two through eight exportable layers to use Depth. Preserve their named
far-to-near planes, adjust the shared camera, convergence, optical focus, depth
of field, motion exposure, and reduced motion, then Apply a linked raster still.
Three layers use the familiar Background, Middle, and Foreground preset. Select
that result alone to reopen its exact recipe and source-role order.

Select a saved result alone to reopen its source and transform. Update Linked HD
Image replaces that image; New Linked HD Image creates another version. Source edits
appear in the reopened preview and reach the image only after Update. Legacy
results without a source binding, or results whose source was deleted, need a
source selected together with them. Invalid saved geometry requires starting
again from the source.

New Editable Frame keeps independent live native content for supported clipped
Frames. Affine placement uses native component and instance transforms.
Projective placement requires access to the matching Worldbend Perspective
companion effect, which is not included in this ZIP; its sampled appearance can
look softer than HD output. Update Frame preserves the selected result; a New
action creates another result. HD image children cannot be edited directly.

New Native Vector is a separate, companion-free output for supported solid
shapes and bounded whole Frames/Groups. It publishes real projected paths, so
native SVG export retains the transform. Text becomes editable outlines, not
live text. Warp, Pin, Mesh, Liquify and fitted guides retain complete saved
controls for later Native Vector updates. Gradient/image paints, effects,
source masks and work beyond the complete geometry budgets retain the
complete-appearance HD route. The completion status
reports exact, bounded approximation or outlined fidelity.

Figma Motion remains the timeline and easing editor for a saved projective
Frame. Compatible Perspective updates and source replacement preserve its native
tracks. While Motion is open, Worldbend keeps the work readable but disables
Edit source and in-place Update Frame; close Motion before changing perspective.
An incompatible size change is refused instead of silently reinterpreting the
keyframes. Worldbend does not add a second timeline.

Choose Editable Frame for continued live text/layout, Native Vector for projected
paths, or Linked HD Image for complete rendered appearance. When reopening a
saved result, Update keeps that result's family; New creates an independent
result. If the vector core refuses freshly captured geometry, the original
Vector stays unchanged and a separate HD image is created with an explicit
fallback notice. Mesh, Pin Warp, Liquify and fitted deformation offer Native
Vector or linked HD output; Lens & maps use linked HD output. Composition, reusable Templates, named Sizes and scene Motion keep
their saved source relationships and support continued editing in Figma.

Companion effect: https://www.figma.com/community/shader/1692554770100764677
Availability depends on Figma approval and the file's access to the effect.
HD output works independently of the companion effect.

## Third-party components

THIRD_PARTY_NOTICES.md, licenses/, and sbom/ describe the locked Rust WebAssembly closures of the designer and PSD import modules, including bundled source dependencies, and the bundled JavaScript runtime with its full license texts.
`;

await writeFile(path.join(packageRoot, "README.md"), designerReadme, "utf8");

const checksummedEntries = await listRegularFiles(packageRoot);
const checksumLines = [];
for (const entry of checksummedEntries) {
  checksumLines.push(`${await sha256(path.join(packageRoot, entry))}  ${entry}`);
}
await writeFile(
  path.join(packageRoot, "SHA256SUMS.txt"),
  `${checksumLines.join("\n")}\n`,
  "utf8",
);

const unpackedFiles = await listRegularFiles(packageRoot);
const expectedFiles = [...checksummedEntries, "SHA256SUMS.txt"].sort();
if (JSON.stringify(unpackedFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Unexpected package inventory: ${JSON.stringify(unpackedFiles)}`,
  );
}
assertCarrierIsolation(unpackedFiles, packageProfile, "Figma package");
const unpackedBytes = await sumFileBytes(packageRoot, unpackedFiles);
assertByteBudget(unpackedBytes, packageProfile.maxUnpackedBytes, "Figma unpacked package");

// ZIP records carry file timestamps even with extra metadata disabled. Pin
// every entry and omit directory records so identical reviewed inputs produce
// the same release asset bytes across repeated packaging runs.
const archiveTimestamp = new Date("1980-01-01T00:00:00.000Z");
for (const entry of unpackedFiles) {
  await utimes(path.join(packageRoot, entry), archiveTimestamp, archiveTimestamp);
}
const archivedEntries = await writeDeterministicZip({
  archivePath,
  sourceRoot: packageRoot,
  rootName: packageName,
  entries: unpackedFiles,
  timestamp: archiveTimestamp,
});
await assertRegularNonemptyFile(archivePath);

const zipInventory = archivedEntries
  .map((entry) => entry.slice(`${packageName}/`.length))
  .sort();
if (JSON.stringify(zipInventory) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `ZIP inventory mismatch: ${JSON.stringify(zipInventory)}`,
  );
}

const archiveMetadata = await stat(archivePath);
assertByteBudget(archiveMetadata.size, packageProfile.maxArchiveBytes, "Figma archive");
const result = {
  package: packageRoot,
  archive: archivePath,
  archiveBytes: archiveMetadata.size,
  archiveSha256: await sha256(archivePath),
  runtimeBytes,
  unpackedBytes,
  files: expectedFiles,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
