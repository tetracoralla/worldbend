import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeTarget = "aarch64-apple-darwin";
const wasmTarget = "wasm32-unknown-unknown";
const workspace = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(root, "plugins", "worldbend");
  await writePluginLegalMaterial({ destination });
}

/**
 * Generates the legal material from Cargo.lock's resolved, non-dev closure for
 * the two native executables that ship in the macOS arm64 plugin.  This keeps
 * a notice or SBOM from accidentally describing a developer-only dependency.
 */
export async function writePluginLegalMaterial({ destination }) {
  await writeCargoLegalMaterial({
    destination,
    target: nativeTarget,
    rootPackageNames: ["worldbend-cli", "worldbend-mcp"],
    artifactName: "Worldbend Codex plugin (macOS arm64)",
    documentName: "worldbend-codex-plugin-macos-arm64",
    sbomFile: "worldbend-macos-arm64.spdx.json",
    noticeIntroduction:
      "This macOS arm64 Codex plugin is built from locked Rust crates; runtime crates are statically linked into its native executables.",
    noticeClosure:
      "the locked macOS arm64 non-dev Cargo dependency closure of `worldbend-cli` and `worldbend-mcp`",
    systemLibraryNote:
      "The macOS binaries dynamically link only to Apple-provided `/usr/lib/libSystem.B.dylib` and `/usr/lib/libiconv.2.dylib`. Those system libraries are not redistributed in this archive; their terms are supplied with the host operating system.",
  });
}

export async function writeFigmaLegalMaterial({ destination }) {
  await writeCargoLegalMaterial({
    destination,
    target: wasmTarget,
    rootPackageNames: ["worldbend-wasm"],
    artifactName: "Worldbend Figma plugin WebAssembly runtime",
    documentName: "worldbend-figma-wasm",
    sbomFile: "worldbend-figma-wasm.spdx.json",
    noticeIntroduction:
      "This self-contained Figma plugin embeds a WebAssembly module built from Rust crates.",
    noticeClosure:
      "the locked wasm32-unknown-unknown non-dev Cargo dependency closure of `worldbend-wasm`",
  });
}

async function writeCargoLegalMaterial({
  destination,
  target,
  rootPackageNames,
  artifactName,
  documentName,
  sbomFile,
  noticeIntroduction,
  noticeClosure,
  systemLibraryNote,
}) {
  const metadata = JSON.parse(
    await run("cargo", [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      target,
    ]),
  );
  const packagesById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodesById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const roots = metadata.packages
    .filter((pkg) => rootPackageNames.includes(pkg.name))
    .map((pkg) => pkg.id);
  if (roots.length !== rootPackageNames.length) {
    throw new Error(`Missing Cargo package root for ${rootPackageNames.join(", ")}`);
  }
  const reachable = collectRuntimeClosure(roots, nodesById);
  const crates = [...reachable]
    .map((id) => packagesById.get(id))
    .filter((pkg) => pkg?.source?.startsWith("registry+"))
    .sort(comparePackage);

  if (crates.length === 0) throw new Error("No registry crates found in native runtime closure");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const licensesRoot = path.join(destination, "licenses");
  await mkdir(licensesRoot);

  const noticeEntries = [];
  for (const crate of crates) {
    const copied = await copyDeclaredLicenseFiles(crate, licensesRoot);
    noticeEntries.push({ crate, copied });
  }
  // A few registry packages (including rmcp) declare Apache-2.0 without
  // carrying a separate license file. Keep the canonical terms in the
  // distribution rather than silently pretending the upstream archive did.
  const apacheSource = noticeEntries
    .flatMap(({ copied }) => copied)
    .find((relative) => /license-apache$/i.test(relative));
  if (apacheSource) {
    const commonRoot = path.join(licensesRoot, "_common");
    await mkdir(commonRoot, { recursive: true });
    await copyFile(
      path.join(destination, apacheSource),
      path.join(commonRoot, "Apache-2.0.txt"),
    );
  }

  await writeFile(
    path.join(destination, "THIRD_PARTY_NOTICES.md"),
    makeNotices(noticeEntries, {
      noticeIntroduction,
      noticeClosure,
      sbomFile,
      systemLibraryNote,
    }),
    "utf8",
  );
  const sbomRoot = path.join(destination, "sbom");
  await mkdir(sbomRoot);
  await writeFile(
    path.join(sbomRoot, sbomFile),
    `${JSON.stringify(await makeSpdx(crates, { artifactName, documentName }), null, 2)}\n`,
    "utf8",
  );
}

function collectRuntimeClosure(roots, nodesById) {
  const visited = new Set();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodesById.get(id);
    if (!node) throw new Error(`Cargo metadata is missing resolve node ${id}`);
    for (const dependency of node.deps) {
      if (dependency.dep_kinds.some((kind) => kind.kind !== "dev")) {
        pending.push(dependency.pkg);
      }
    }
  }
  return visited;
}

async function copyDeclaredLicenseFiles(crate, licensesRoot) {
  const crateRoot = path.dirname(crate.manifest_path);
  const crateRootReal = await realpath(crateRoot);
  const candidates = new Set();
  if (crate.license_file) candidates.add(crate.license_file);
  for (const entry of await readdir(crateRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^(license|copying|copyright|unlicense)([._-].*)?$/i.test(entry.name)) {
      candidates.add(entry.name);
    }
  }
  const destination = path.join(licensesRoot, safeSegment(`${crate.name}-${crate.version}`));
  await mkdir(destination, { recursive: true });
  const copied = [];
  for (const candidate of [...candidates].sort()) {
    const source = path.resolve(crateRoot, candidate);
    if (!source.startsWith(`${crateRoot}${path.sep}`)) {
      throw new Error(`License path escapes crate root for ${crate.name}: ${candidate}`);
    }
    const metadata = await lstat(source).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) continue;
    const sourceReal = await realpath(source);
    if (!sourceReal.startsWith(`${crateRootReal}${path.sep}`)) {
      throw new Error(`License real path escapes crate root for ${crate.name}: ${candidate}`);
    }
    const name = path.basename(source);
    await copyFile(source, path.join(destination, name));
    copied.push(`licenses/${safeSegment(`${crate.name}-${crate.version}`)}/${name}`);
  }
  return copied;
}

function makeNotices(
  entries,
  { noticeIntroduction, noticeClosure, sbomFile, systemLibraryNote },
) {
  const lines = [
    "# Worldbend third-party notices",
    "",
    `${noticeIntroduction} The SPDX 2.3 inventory is \`sbom/${sbomFile}\`; copied license texts are below \`licenses/\`.`,
    "",
    "This inventory covers bundled third-party components only.",
  ];
  if (systemLibraryNote) lines.push("", systemLibraryNote);
  lines.push("", "## Rust non-development dependency closure", "");
  for (const { crate, copied } of entries) {
    lines.push(
      `- [${crate.name} ${crate.version}](https://crates.io/crates/${crate.name}/${crate.version}) — ${normalizeSpdx(crate.license)}; ${copied.length > 0 ? copied.join(", ") : "upstream registry archive carries no license file; canonical Apache-2.0 terms are in licenses/_common/Apache-2.0.txt"}`,
    );
  }
  lines.push("", `This inventory is generated from ${noticeClosure}.`, "");
  return lines.join("\n");
}

async function makeSpdx(crates, { artifactName, documentName }) {
  const lockHash = createHash("sha256").update(await readFile(path.join(root, "Cargo.lock"))).digest("hex");
  const documentId = "SPDXRef-DOCUMENT";
  const rootPackageId = "SPDXRef-Package-Worldbend";
  const packages = [
    {
      SPDXID: rootPackageId,
      name: artifactName,
      versionInfo: workspaceVersion(),
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      primaryPackagePurpose: "APPLICATION",
    },
    ...crates.map((crate) => ({
      SPDXID: crateSpdxId(crate),
      name: crate.name,
      versionInfo: crate.version,
      downloadLocation: `https://crates.io/crates/${crate.name}/${crate.version}`,
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: normalizeSpdx(crate.license),
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: `pkg:cargo/${crate.name}@${crate.version}`,
        },
      ],
    })),
  ];
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: documentId,
    name: documentName,
    documentNamespace: `https://spdx.org/spdxdocs/${documentName}-${workspaceVersion()}-${lockHash}`,
    creationInfo: {
      created: "1970-01-01T00:00:00Z",
      creators: ["Tool: worldbend-plugin-legal-generator-1"],
    },
    packages,
    relationships: crates.map((crate) => ({
      spdxElementId: rootPackageId,
      relationshipType: "DEPENDS_ON",
      relatedSpdxElement: crateSpdxId(crate),
    })),
  };
}

function workspaceVersion() {
  // The staged binary version is checked separately. This source value makes
  // the SBOM reproducible for an unchanged locked release input.
  return workspace.version;
}

function crateSpdxId(crate) {
  return `SPDXRef-Crate-${safeSegment(crate.name)}-${safeSegment(crate.version)}`;
}

function safeSegment(value) {
  return value.replace(/[^A-Za-z0-9.-]+/g, "-");
}

function normalizeSpdx(license) {
  if (!license) return "NOASSERTION";
  return license.replace(/\s*\/\s*/g, " OR ");
}

function comparePackage(left, right) {
  return left.name.localeCompare(right.name) || left.version.localeCompare(right.version);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}
