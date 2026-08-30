import { lstat, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootReal = await realpath(root);
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const required = [
  "packages/web/dist/index.js",
  "packages/web/demo-dist/index.html",
  "packages/figma/dist/main.js",
  "packages/figma/dist/ui.html",
  `plugins/worldbend/bin/worldbend${executableSuffix}`,
  `plugins/worldbend/bin/worldbend-capability${executableSuffix}`,
  `plugins/worldbend/bin/worldbend-mcp${executableSuffix}`,
  `plugins/worldbend/bin/worldbend-transport-schema-probe${executableSuffix}`,
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
  "control-dock",
  "dock-primary",
  "object-group",
  "operation-cluster",
  "mode-transform",
  "mode-warp",
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
]) {
  if (!ui.includes(`id="${controlId}"`)) {
    throw new Error(`Figma UI is missing Free Transform control ${controlId}`);
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
]) {
  if (!ui.includes(`data-icon-id="${iconId}"`)) {
    throw new Error(`Figma UI is missing tool-rendered product icon ${iconId}`);
  }
}
assertIdOrder(ui, [
  "mode-transform",
  "distort-free",
  "distort-perspective",
  "mode-warp",
  "more-options",
]);
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

const workspacePackage = await readFile(path.join(root, "package.json"), "utf8");
if (/\/Users\/|[A-Za-z]:\\\\Users\\/.test(workspacePackage)) {
  throw new Error("workspace scripts must not depend on a machine-specific user path");
}

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
