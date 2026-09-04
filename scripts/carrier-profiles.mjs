import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const carrierProfilesPath = path.join(
  repositoryRoot,
  "config",
  "carrier-profiles.json",
);

const topLevelKeys = ["schema", "version", "features", "carriers"];
const carrierKeys = ["kind", "surfaceFeatureIds", "package"];
const figmaCarrierKeys = [...carrierKeys, "workspace"];
const packageKeys = {
  figma: [
    "runtimeEntries",
    "maxRuntimeBytes",
    "maxArchiveBytes",
    "maxUnpackedBytes",
    "forbiddenSuffixes",
    "forbiddenPrefixes",
  ],
  agent: [
    "defaultToolSurface",
    "nativeCargoFeatures",
    "requiredExecutables",
    "maxToolCatalogBytes",
    "maxDirectToolCatalogBytes",
    "forbiddenSuffixes",
    "forbiddenPrefixes",
  ],
  comfyui: [
    "sourceEntries",
    "exampleEntries",
    "nativeExecutable",
    "nativeCargoFeatures",
    "forbiddenSuffixes",
    "forbiddenPrefixes",
    "forbiddenBasenames",
  ],
};

export async function loadCarrierProfiles(file = carrierProfilesPath) {
  const value = JSON.parse(await readFile(file, "utf8"));
  assertExactKeys(value, topLevelKeys, "carrier profile root");
  if (value.schema !== "worldbend.carrier-profiles" || value.version !== "0.1") {
    throw new Error("Unsupported carrier profile schema or version");
  }
  assertUniqueStrings(value.features, "features");
  assertExactKeys(value.carriers, ["figma", "agent", "comfyui"], "carriers");

  for (const [name, profile] of Object.entries(value.carriers)) {
    assertExactKeys(
      profile,
      name === "figma" ? figmaCarrierKeys : carrierKeys,
      `${name} carrier`,
    );
    assertUniqueStrings(profile.surfaceFeatureIds, `${name}.surfaceFeatureIds`);
    for (const featureId of profile.surfaceFeatureIds) {
      if (!value.features.includes(featureId)) {
        throw new Error(`${name} references unknown surface feature ${featureId}`);
      }
    }
    assertExactKeys(profile.package, packageKeys[name], `${name}.package`);
    validatePackageProfile(name, profile.package);
  }

  assertExactKeys(
    value.carriers.figma.workspace,
    [
      "id",
      "modeControlIds",
      "siblingWorkspaceIds",
      "primaryWorkspaceIds",
      "secondaryWorkspaceIds",
    ],
    "figma.workspace",
  );
  if (value.carriers.figma.workspace.id !== "perspective") {
    throw new Error("The current Figma workspace id must remain perspective");
  }
  assertUniqueStrings(
    value.carriers.figma.workspace.modeControlIds,
    "figma.workspace.modeControlIds",
  );
  assertUniqueStrings(
    value.carriers.figma.workspace.siblingWorkspaceIds,
    "figma.workspace.siblingWorkspaceIds",
  );
  assertUniqueStrings(
    value.carriers.figma.workspace.primaryWorkspaceIds,
    "figma.workspace.primaryWorkspaceIds",
  );
  assertUniqueStrings(
    value.carriers.figma.workspace.secondaryWorkspaceIds,
    "figma.workspace.secondaryWorkspaceIds",
  );
  if (
    JSON.stringify(value.carriers.figma.workspace.siblingWorkspaceIds) !==
    JSON.stringify(["canvas", "templates", "mockup", "mesh", "remap"])
  ) {
    throw new Error("The current Figma sibling workspaces must remain canvas, templates, mockup, mesh, remap");
  }
  if (
    JSON.stringify(value.carriers.figma.workspace.primaryWorkspaceIds) !==
      JSON.stringify(["canvas", "templates"]) ||
    JSON.stringify(value.carriers.figma.workspace.secondaryWorkspaceIds) !==
      JSON.stringify(["mockup", "mesh", "remap"])
  ) {
    throw new Error("The Figma workspace hierarchy must keep Sizes and Templates primary, with Composition, Mesh, and Lens/Maps secondary");
  }
  return value;
}

export function assertByteBudget(actualBytes, maximumBytes, label) {
  if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
    throw new Error(`${label} byte count must be a non-negative safe integer`);
  }
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error(`${label} maximum must be a positive safe integer`);
  }
  if (actualBytes > maximumBytes) {
    throw new Error(`${label} is ${actualBytes} bytes; budget is ${maximumBytes} bytes`);
  }
}

export function assertCarrierIsolation(entries, packageProfile, label) {
  assertUniqueStrings(entries, `${label} entries`);
  for (const entry of entries) {
    const normalized = entry.split(path.sep).join("/");
    const basename = path.posix.basename(normalized);
    if (packageProfile.forbiddenSuffixes?.some((suffix) => normalized.endsWith(suffix))) {
      throw new Error(`${label} contains forbidden file ${normalized}`);
    }
    if (packageProfile.forbiddenPrefixes?.some((prefix) => normalized.startsWith(prefix))) {
      throw new Error(`${label} contains forbidden path ${normalized}`);
    }
    if (packageProfile.forbiddenBasenames?.includes(basename)) {
      throw new Error(`${label} contains forbidden file ${normalized}`);
    }
  }
}

export async function listRegularFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listRegularFiles(root, absolute)));
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    } else {
      throw new Error(`Unexpected non-regular package entry: ${absolute}`);
    }
  }
  return files.sort();
}

export async function sumFileBytes(root, entries) {
  let total = 0;
  for (const entry of entries) {
    const metadata = await stat(path.join(root, entry));
    if (!metadata.isFile()) throw new Error(`Expected regular file: ${entry}`);
    total += metadata.size;
  }
  return total;
}

function validatePackageProfile(name, profile) {
  for (const key of Object.keys(profile)) {
    const value = profile[key];
    if (key.startsWith("max")) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name}.package.${key} must be a positive safe integer`);
      }
    } else if (key === "nativeExecutable") {
      if (typeof value !== "string" || value.length === 0 || value.includes("/")) {
        throw new Error(`${name}.package.${key} must be one executable basename`);
      }
    } else if (key === "defaultToolSurface") {
      if (value !== "catalog") {
        throw new Error(`${name}.package.${key} must be catalog`);
      }
    } else {
      assertUniqueStrings(value, `${name}.package.${key}`);
    }
  }
}

function assertExactKeys(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys are ${actual.join(", ")}; expected ${expected.join(", ")}`);
  }
}

function assertUniqueStrings(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || entry.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(`${label} must contain unique non-empty strings`);
  }
}
