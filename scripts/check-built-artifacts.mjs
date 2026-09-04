import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  assertByteBudget,
  assertCarrierIsolation,
  listRegularFiles,
  loadCarrierProfiles,
  sumFileBytes,
} from "./carrier-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootReal = await realpath(root);
const carrierProfiles = await loadCarrierProfiles();
const figmaProfile = carrierProfiles.carriers.figma;
const agentPackageProfile = carrierProfiles.carriers.agent.package;
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const required = [
  "packages/web/dist/index.js",
  "packages/web/demo-dist/index.html",
  "packages/figma/dist/main.js",
  "packages/figma/dist/ui.html",
  ...agentPackageProfile.requiredExecutables.map(
    (name) => `plugins/worldbend/bin/${name}${executableSuffix}`,
  ),
  "plugins/worldbend/capabilities/provider.json",
  "plugins/worldbend/capabilities/schemas/projective.inspect.input.schema.json",
  "plugins/worldbend/capabilities/schemas/projective.inspect.output.schema.json",
  "plugins/worldbend/capabilities/schemas/projective.render.input.schema.json",
  "plugins/worldbend/capabilities/schemas/projective.render.output.schema.json",
];

for (const relative of required) {
  const absolute = path.join(root, relative);
  await assertBuildFile(absolute, `build artifact ${relative}`, rootReal);
}

for (const packageDirectory of ["packages/web", "packages/wasm"]) {
  const manifestPath = path.join(root, packageDirectory, "package.json");
  const packageManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const exportTargets = collectExportTargets(packageManifest.exports);
  if (exportTargets.length === 0) {
    throw new Error(`${packageDirectory}/package.json must declare concrete exports`);
  }
  for (const target of exportTargets) {
    if (!target.startsWith("./")) {
      throw new Error(`${packageDirectory} export must be package-relative: ${target}`);
    }
    const absolute = path.resolve(root, packageDirectory, target);
    const packageRoot = path.resolve(root, packageDirectory);
    if (!absolute.startsWith(`${packageRoot}${path.sep}`)) {
      throw new Error(`${packageDirectory} export escapes its package: ${target}`);
    }
    await assertBuildFile(
      absolute,
      `${packageDirectory} export ${target}`,
      await realpath(packageRoot),
    );
  }
}

const manifest = JSON.parse(
  await readFile(path.join(root, "packages/figma/manifest.json"), "utf8"),
);
if (typeof manifest.id !== "string" || manifest.id.length === 0) {
  throw new Error("Figma plugin must declare a stable id before using private plugin data");
}
if (manifest.networkAccess?.allowedDomains?.join(",") !== "none") {
  throw new Error("Figma plugin must remain networkAccess: none");
}
if (!Array.isArray(manifest.permissions) || manifest.permissions.length !== 0) {
  throw new Error("Free Figma plugin must not request payment or other extra permissions");
}
const ui = await readFile(path.join(root, "packages/figma/dist/ui.html"), "utf8");
if (!ui.includes("worldbend_wasm_bg.wasm") && !ui.includes("application/wasm")) {
  throw new Error("Figma UI does not contain the bundled local WASM core");
}
if (/<script[^>]+src=/.test(ui)) {
  throw new Error("Figma UI must be a single-file build without external scripts");
}
for (const sliderId of [
  "scale-x-slider",
  "scale-y-slider",
  "rotation-slider",
  "skew-x-slider",
  "skew-y-slider",
]) {
  if (!ui.includes(`id="${sliderId}"`)) {
    throw new Error(`Figma UI is missing coarse transform control ${sliderId}`);
  }
}
for (const controlId of [
  "workspace-navigation",
  "workspace-strip-viewport",
  "workspace-backward",
  "workspace-forward",
  "control-dock",
  "dock-primary",
  "operation-cluster",
  "mode-strip-viewport",
  "mode-backward",
  "mode-forward",
  "mode-transform",
  "mode-distort",
  "mode-warp",
  "distort-options",
  "distort-free",
  "distort-perspective",
  "context-controls",
  "warp-preset",
  "warp-amount-slider",
  "warp-amount",
  "link-scale",
  "size-controls",
  "skew-controls",
  "rotation-command-row",
  "transform-command-cluster",
  "transform-actions",
  "zoom-level",
  "action-dock",
  "action-flip-x",
  "action-flip-y",
  "action-rotate-cw",
  "action-transform-again",
  "action-apply-copy",
  "placement-toggle",
  "placement-close",
  "advanced-placement",
  "pivot-grid",
  "position-x",
  "position-y",
  "source-name",
]) {
  if (!ui.includes(`id="${controlId}"`)) {
    throw new Error(`Figma UI is missing product workspace control ${controlId}`);
  }
}
for (const iconId of [
  "icon-park:right-small",
  "icon-park:more",
  "icon-park:close",
  "icon-park:link-one",
  "icon-park:check",
  "icon-park:flip-horizontally",
  "icon-park:flip-vertically",
  "icon-park:rotate",
  "icon-park:redo",
  "icon-park:perspective",
]) {
  if (!ui.includes(`data-icon-id="${iconId}"`)) {
    throw new Error(`Figma UI is missing tool-rendered product icon ${iconId}`);
  }
}
for (const removedControl of [
  "object-group",
  "task-launcher-button",
  "task-menu",
  "action-undo",
  "action-redo",
]) {
  if (ui.includes(`id="${removedControl}"`)) {
    throw new Error(`Figma UI restored superseded control ${removedControl}`);
  }
}
if (!ui.includes("workspace-navigation-tooltip")) {
  throw new Error("Figma workspace navigation must retain a tooltip outside clipped overflow strips");
}
if (
  ui.indexOf('id="more-options"') > ui.indexOf('id="workspace-navigation"') +
    ui.slice(ui.indexOf('id="workspace-navigation"')).indexOf("</nav>")
) {
  throw new Error("Figma global options must remain in the product workspace navigation");
}
for (const canvasControlId of [
  "canvas-workspace",
  "canvas-back",
  "canvas-add-variant",
  "canvas-variants",
  "canvas-preview",
  "canvas-variant-id",
  "canvas-operation",
  "canvas-width",
  "canvas-height",
  "canvas-crop-group",
  "canvas-trim-group",
  "canvas-pad-group",
  "canvas-anchor-grid",
  "canvas-background",
  "canvas-background-color",
  "canvas-remove-variant",
  "canvas-reset",
  "canvas-apply-new",
  "canvas-apply",
]) {
  if (!ui.includes(`id="${canvasControlId}"`)) {
    throw new Error(`Figma UI is missing Canvas workspace control ${canvasControlId}`);
  }
}
for (const workspaceId of figmaProfile.workspace.siblingWorkspaceIds) {
  if (!new RegExp(`<section\\b[^>]*\\bid="${workspaceId}-workspace"[^>]*\\bhidden(?:\\s|=|>)`).test(ui)) {
    throw new Error(`Figma ${workspaceId} must remain a hidden sibling workspace until explicitly opened`);
  }
}
for (const workspaceId of figmaProfile.workspace.primaryWorkspaceIds) {
  if (!ui.includes(`id="workspace-tab-${workspaceId}"`)) {
    throw new Error(`Figma primary workspace ${workspaceId} must remain in the persistent navigation`);
  }
}
for (const workspaceId of figmaProfile.workspace.secondaryWorkspaceIds) {
  if (!ui.includes(`id="workspace-menu-${workspaceId}"`)) {
    throw new Error(`Figma advanced workspace ${workspaceId} must remain available from More`);
  }
  if (ui.includes(`id="workspace-tab-${workspaceId}"`)) {
    throw new Error(`Figma advanced workspace ${workspaceId} must not compete with the release loop`);
  }
}
assertIdOrder(ui, figmaProfile.workspace.modeControlIds);
assertIdOrder(ui, ["distort-free", "distort-perspective"]);
assertIdOrder(ui, [
  "scale-x-label",
  "scale-y-label",
  "link-scale",
  "skew-x-label",
  "skew-y-label",
  "rotation-label",
  "placement-toggle",
  "transform-actions",
]);
for (const redundantRotation of ["action-rotate-ccw", "action-rotate-180"]) {
  if (ui.includes(`id="${redundantRotation}"`)) {
    throw new Error(`Figma UI restored redundant rotation command ${redundantRotation}`);
  }
}
if (ui.includes('data-icon-id="icon-park:rotating-forward"')) {
  throw new Error("Figma UI restored a cyclic metaphor for the single 90-degree action");
}
if (!ui.includes('id="transform-actions" role="toolbar"') || !ui.includes('class="action-tooltip" aria-hidden="true"')) {
  throw new Error("Figma transform icon actions must retain toolbar and tooltip semantics");
}
for (const removedChrome of [
  "plugin-title",
  "object-bar",
  "parameter-toggle",
  "parameter-panel",
  "preview-zoom",
  "zoom-out",
  "zoom-in",
  "zoom-fit",
]) {
  if (ui.includes(`id="${removedChrome}"`)) {
    throw new Error(`Figma UI restored secondary chrome ${removedChrome}`);
  }
}
if (!ui.includes("worldbend-editor__pivot")) {
  throw new Error("Figma UI is missing the movable transform reference point");
}

const workspacePackageText = await readFile(path.join(root, "package.json"), "utf8");
if (/\/Users\/|[A-Za-z]:\\\\Users\\/.test(workspacePackageText)) {
  throw new Error("workspace scripts must not depend on a machine-specific user path");
}

const figmaRoot = path.join(root, "packages", "figma");
const figmaRuntimeBytes = await sumFileBytes(
  figmaRoot,
  figmaProfile.package.runtimeEntries,
);
assertByteBudget(
  figmaRuntimeBytes,
  figmaProfile.package.maxRuntimeBytes,
  "Figma runtime payload",
);

const workspacePackage = JSON.parse(workspacePackageText);
const safeVersion = String(workspacePackage.version).replace(/[^0-9A-Za-z._-]/g, "-");
const figmaPackageName = `worldbend-figma-${safeVersion}`;
const figmaPackageRoot = path.join(root, "artifacts", "figma", figmaPackageName);
const figmaArchive = path.join(root, "artifacts", "figma", `${figmaPackageName}.zip`);
const figmaPackageFiles = await listRegularFiles(figmaPackageRoot);
assertCarrierIsolation(figmaPackageFiles, figmaProfile.package, "Figma package");
assertByteBudget(
  await sumFileBytes(figmaPackageRoot, figmaPackageFiles),
  figmaProfile.package.maxUnpackedBytes,
  "Figma unpacked package",
);
assertByteBudget(
  (await stat(figmaArchive)).size,
  figmaProfile.package.maxArchiveBytes,
  "Figma archive",
);

assertCarrierIsolation(
  await listRegularFiles(path.join(root, "plugins", "worldbend")),
  agentPackageProfile,
  "Agent plugin",
);

console.log("Built artifact checks passed");

function assertIdOrder(contents, ids) {
  let previous = -1;
  for (const id of ids) {
    const next = contents.indexOf(`id="${id}"`);
    if (next < 0 || next <= previous) {
      throw new Error(`Figma UI control order is invalid at ${id}`);
    }
    previous = next;
  }
}

function collectExportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(collectExportTargets);
}

async function assertBuildFile(file, label, containmentRoot) {
  const metadata = await lstat(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`${label} must be a non-empty regular file, not a symbolic link`);
  }
  const canonical = await realpath(file);
  if (!canonical.startsWith(`${containmentRoot}${path.sep}`)) {
    throw new Error(`${label} real path escapes its expected root`);
  }
}
