import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertNoPrivateBuildPaths, assertNoPluginStagingResidue } from "./build-privacy.mjs";
import { createDeterministicTarGz, normalizeRegularTree, sha256File } from "./deterministic-tar.mjs";
import { publishImmutableArtifact } from "./immutable-artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = JSON.parse(
  await readFile(path.join(root, "plugins", "worldbend", ".codex-plugin", "plugin.json"), "utf8"),
);

if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("This native Agent Host component is macOS arm64 only");
}

const resultArgument = process.argv.find((argument) => argument.startsWith("--result-file="));
const resultFile = resultArgument === undefined
  ? null
  : path.resolve(resultArgument.slice("--result-file=".length));
const output = path.join(root, "artifacts", "agent-host");
await mkdir(output, { recursive: true });
const staging = await mkdtemp(path.join(output, ".stage-"));
const component = path.join(staging, "component");

try {
  const pluginRoot = "marketplace/plugins/worldbend";
  await mkdir(path.join(component, "marketplace", ".agents", "plugins"), { recursive: true });
  await cp(path.join(root, "plugins", "worldbend"), path.join(component, pluginRoot), { recursive: true });
  await cp(
    path.join(root, ".agents", "plugins", "marketplace.json"),
    path.join(component, "marketplace", ".agents", "plugins", "marketplace.json"),
  );

  const spdx = JSON.parse(
    await readFile(path.join(component, pluginRoot, "sbom", "worldbend-macos-arm64.spdx.json"), "utf8"),
  );
  const product = spdx.packages.filter((entry) => entry.SPDXID === "SPDXRef-Package-Worldbend");
  if (product.length !== 1 || product[0].licenseDeclared !== "Apache-2.0") {
    throw new Error("Reconcile the product license and artifact notice before packaging");
  }
  for (const file of ["LICENSE", "NOTICE"]) {
    await cp(path.join(root, file), path.join(component, file));
  }

  await normalizeRegularTree(component);
  const files = await inventory(component, pluginRoot);
  const pluginIdentity = [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "bin/worldbend-mcp",
    ...files
      .filter((file) => file.path.startsWith(`${pluginRoot}/skills/`) || file.path.startsWith(`${pluginRoot}/web/`))
      .map((file) => file.path.slice(pluginRoot.length + 1)),
  ];
  const legal = {
    license: "LICENSE",
    notice: "NOTICE",
    thirdPartyNotices: `${pluginRoot}/THIRD_PARTY_NOTICES.md`,
    sbom: `${pluginRoot}/sbom/worldbend-macos-arm64.spdx.json`,
  };
  const descriptor = {
    schemaVersion: "openadam.agent-host-component.v0.1",
    id: "worldbend",
    version: plugin.version,
    kind: "agent-tool",
    files,
    identityFiles: [
      "marketplace/.agents/plugins/marketplace.json",
      ...pluginIdentity.map((file) => `${pluginRoot}/${file}`),
      ...Object.values(legal),
    ],
    entrypoints: {
      mcp: `${pluginRoot}/bin/worldbend-mcp`,
      cli: `${pluginRoot}/bin/worldbend`,
    },
    integration: {
      schemaVersion: "openadam.agent-host-tool-integration.v0.2",
      displayName: "Worldbend",
      summary: plugin.description,
      codex: {
        marketplaceRoot: "marketplace",
        marketplace: "worldbend-local",
        pluginRoot,
        plugin: "worldbend",
        identityFiles: pluginIdentity,
      },
      runtime: {
        transport: "mcp-stdio",
        executor: "component",
        command: `${pluginRoot}/bin/worldbend-mcp`,
        args: ["--surface", "catalog"],
        cwd: pluginRoot,
        workspaceEnvironment: ["WORLDBEND_WORKSPACE_ROOT"],
        expectedTools: ["worldbend.describe", "worldbend.run", "worldbend.search"],
        timeoutMs: 10_000,
      },
      ownership: { uninstall: "agent-host-created-only" },
    },
    legal,
  };
  await writeJson(path.join(component, "component.json"), descriptor);
  await normalizeRegularTree(component);

  const archive = `worldbend-${plugin.version}-macos-arm64.tar.gz`;
  const archivePath = path.join(staging, archive);
  const archiveFiles = [...files.map((file) => file.path), "component.json"].sort();
  await writeFile(path.join(staging, "files.txt"), `${archiveFiles.join("\n")}\n`, "utf8");
  await createDeterministicTarGz({
    sourceDirectory: component,
    relativeFiles: archiveFiles,
    archive: archivePath,
    scratchDirectory: staging,
  });

  const archiveSha256 = await sha256File(archivePath);
  const archiveBytes = (await lstat(archivePath)).size;
  const descriptorSha256 = hash(await readFile(path.join(component, "component.json")));
  const report = {
    schema: "worldbend.agent-host-package.v1",
    id: "worldbend",
    version: plugin.version,
    archive,
    archiveSha256: `sha256:${archiveSha256}`,
    archiveBytes,
    descriptorSha256,
    platform: "darwin-arm64",
    spdx: "Apache-2.0",
    productLicense: "Apache-2.0",
    fileCount: files.length,
  };
  await writeJson(path.join(staging, "package-report.json"), report);
  await rm(component, { recursive: true, force: true });

  const destination = path.join(output, `${plugin.version}-${archiveSha256.slice(0, 12)}`);
  await publishImmutableArtifact(staging, destination);
  const result = { ...report, directory: destination };
  if (resultFile !== null) await writeJson(resultFile, result);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}

async function inventory(directory, pluginRoot) {
  const files = [];
  async function visit(current, prefix = "") {
    for (const entry of (await readdir(current, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      assertNoPluginStagingResidue(entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new Error(`Cannot seal a link: ${name}`);
      if (metadata.isDirectory()) {
        await visit(absolute, name);
      } else if (metadata.isFile()) {
        const data = await readFile(absolute);
        if (name.startsWith(`${pluginRoot}/bin/`)) assertNoPrivateBuildPaths(data, [root]);
        files.push({
          path: name,
          sha256: hash(data),
          bytes: data.length,
          executable: Boolean(metadata.mode & 0o111),
        });
      } else {
        throw new Error(`Cannot seal a non-regular file: ${name}`);
      }
    }
  }
  await visit(directory);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function hash(data) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
