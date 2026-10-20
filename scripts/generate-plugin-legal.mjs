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
import {readFigmaRuntimeLicense} from "./figma-runtime-license.mjs";
import { figmaWasmModules, wasmProfile } from "./wasm-profiles.mjs";
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
  await appendFigmaJavaScriptLegalMaterial(destination,"worldbend-macos-arm64.spdx.json");
}

export async function writeFigmaLegalMaterial({ destination, version = workspaceVersion() }) {
  await writeCargoLegalMaterial({
    destination,
    deduplicateLicenses: true,
    artifactVersion: version,
    target: wasmTarget,
    rootPackageNames: ["worldbend-wasm"],
    runtimeProfiles: figmaWasmModules.map(({ profile }) => wasmProfile(profile)),
    artifactName: "Worldbend Figma plugin WebAssembly runtime",
    documentName: "worldbend-figma-wasm",
    sbomFile: "worldbend-figma-wasm.spdx.json",
    noticeIntroduction:
      "This self-contained Figma plugin embeds its designer and PSD import WebAssembly modules built from Rust crates.",
    noticeClosure:
      "the union of the locked wasm32-unknown-unknown non-dev Cargo dependency closures of the embedded Figma designer and PSD import profiles",
  });
  await appendFigmaJavaScriptLegalMaterial(destination);
}

/** The self-contained main/UI also bundle the pinned exact-data codec. Cargo
 * metadata cannot describe npm code; verify its own installed/locked identity. */
export async function appendFigmaJavaScriptLegalMaterial(destination,sbomFile="worldbend-figma-wasm.spdx.json") {
  const {version,license,copyright,lock}=readFigmaRuntimeLicense();
  const licensePath=`licenses/npm-fflate-${version}/LICENSE`;
  await mkdir(path.join(destination,path.dirname(licensePath)),{recursive:true});
  await writeFile(path.join(destination,licensePath),license);
  await writeFile(path.join(destination,"THIRD_PARTY_NOTICES.md"),
    `${await readFile(path.join(destination,"THIRD_PARTY_NOTICES.md"),"utf8")}\n## Bundled JavaScript runtime\n\n- [fflate ${version}](https://www.npmjs.com/package/fflate/v/${version}) — MIT; ${copyright}; ${licensePath}. Its complete upstream license is copied byte-for-byte.\n\nThis runtime entry is verified against packages/figma/package.json, pnpm-lock.yaml and the installed locked package.\n`);
  const file=path.join(destination,"sbom",sbomFile),sbom=JSON.parse(await readFile(file,"utf8"));
  const id=`SPDXRef-Npm-fflate-${version}`;
  sbom.packages.push({SPDXID:id,name:"fflate",versionInfo:version,downloadLocation:`https://registry.npmjs.org/fflate/-/fflate-${version}.tgz`,
    filesAnalyzed:false,licenseConcluded:"NOASSERTION",licenseDeclared:"MIT",copyrightText:copyright,
    externalRefs:[{referenceCategory:"PACKAGE-MANAGER",referenceType:"purl",referenceLocator:`pkg:npm/fflate@${version}`}],
    comment:`License ${licensePath}; SHA256 ${createHash("sha256").update(license).digest("hex")}`});
  sbom.relationships.push({spdxElementId:"SPDXRef-Package-Worldbend",relationshipType:"DEPENDS_ON",relatedSpdxElement:id});
  const inputHash=createHash("sha256").update(await readFile(path.join(root,"Cargo.lock"))).update(lock).update(license).digest("hex");
  sbom.documentNamespace=sbom.documentNamespace.replace(/[a-f0-9]{64}$/,inputHash);
  await writeFile(file,`${JSON.stringify(sbom,null,2)}\n`);
}

export async function writeWebLegalMaterial({ destination, version = workspaceVersion() }) {
  await writeCargoLegalMaterial({
    destination,
    artifactVersion: version,
    target: wasmTarget,
    rootPackageNames: ["worldbend-wasm", "worldbend-perspective-wasm"],
    artifactName: "Worldbend Web package",
    documentName: "worldbend-web",
    sbomFile: "worldbend-web.spdx.json",
    noticeIntroduction: "This Web package embeds the full and focused perspective WebAssembly modules built from locked Rust crates. Worldbend is licensed under Apache-2.0.",
    noticeClosure: "the locked wasm32-unknown-unknown non-dev Cargo dependency closure of worldbend-wasm and worldbend-perspective-wasm (union across packaged modules)",
  });
}

/** The standalone scene example embeds only the full Web WASM module. */
export async function writeSceneLegalMaterial({ destination, version = workspaceVersion() }) {
  await writeCargoLegalMaterial({
    destination,
    artifactVersion: version,
    target: wasmTarget,
    rootPackageNames: ["worldbend-wasm"],
    artifactName: "Worldbend Three scene receiving example",
    documentName: "worldbend-scene-example",
    sbomFile: "worldbend-scene-example.spdx.json",
    noticeIntroduction: "This standalone scene example embeds the full Worldbend WebAssembly module and the pinned Three.js renderer. Worldbend is licensed under Apache-2.0.",
    noticeClosure: "the locked wasm32-unknown-unknown non-dev Cargo dependency closure of worldbend-wasm",
  });
}

export async function writeComfyLegalMaterial({ destination }) {
  const target = await currentRustHostTarget();
  const safeTarget = safeSegment(target);
  await writeCargoLegalMaterial({
    destination,
    target,
    rootPackageNames: ["worldbend-cli"],
    artifactName: `Worldbend ComfyUI local node pack (${target})`,
    documentName: `worldbend-comfyui-${safeTarget}`,
    sbomFile: `worldbend-comfyui-${safeTarget}.spdx.json`,
    noticeIntroduction:
      `This ${target} ComfyUI local node pack bundles the native Worldbend CLI built from locked Rust crates.`,
    noticeClosure:
      `the locked ${target} non-dev Cargo dependency closure of \`worldbend-cli\``,
  });
}

async function writeCargoLegalMaterial({
  destination,
  deduplicateLicenses = false,
  target,
  rootPackageNames,
  runtimeProfiles,
  artifactName,
  documentName,
  sbomFile,
  noticeIntroduction,
  noticeClosure,
  systemLibraryNote,
  artifactVersion = workspaceVersion(),
}) {
  const closure = new Map();
  for (const profile of runtimeProfiles ?? [{ rootPackageNames, featureArguments: [] }]) {
    const names = profile.crate ? [profile.crate] : profile.rootPackageNames;
    const metadata = JSON.parse(await run("cargo", [
      "metadata", "--locked", "--format-version", "1", "--filter-platform", target,
      ...(profile.crate ? ["--manifest-path", path.join(root, "crates", profile.crate, "Cargo.toml")] : []),
      ...profile.featureArguments,
    ]));
    const packagesById = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
    const nodesById = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
    const roots = metadata.packages.filter(pkg => names.includes(pkg.name)).map(pkg => pkg.id);
    if (roots.length !== names.length) throw new Error(`Missing Cargo package root for ${names.join(", ")}`);
    for (const id of collectRuntimeClosure(roots, nodesById)) {
      const pkg = packagesById.get(id);
      if (!pkg) throw new Error(`Cargo metadata is missing package ${id}`);
      // Local vendored and git dependencies carry obligations too. Only the
      // repository's own named crates are covered by its root LICENSE/NOTICE.
      const owned = !pkg.source && pkg.name.startsWith("worldbend-") &&
        path.resolve(pkg.manifest_path) === path.join(root, "crates", pkg.name, "Cargo.toml");
      if (!owned) closure.set(id, pkg);
    }
  }
  const crates = [...closure.values()].sort(comparePackage);

  if (crates.length === 0) throw new Error("No third-party crates found in runtime closure");
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of ["LICENSE", "NOTICE"]) await copyFile(path.join(root, file), path.join(destination, file));
  const licensesRoot = path.join(destination, "licenses");
  await mkdir(licensesRoot);

  const noticeEntries = [];
  const licenseCopies = deduplicateLicenses ? new Map() : undefined;
  for (const crate of crates) {
    const copied = await copyDeclaredLicenseFiles(crate, licensesRoot, licenseCopies);
    if (!crate.source?.startsWith("registry+") && copied.length === 0) {
      throw new Error(`Bundled source has no license text: ${crate.name} ${crate.version}`);
    }
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
      deduplicateLicenses,
    }),
    "utf8",
  );
  const sbomRoot = path.join(destination, "sbom");
  await mkdir(sbomRoot);
  await writeFile(
    path.join(sbomRoot, sbomFile),
    `${JSON.stringify(await makeSpdx(crates, { artifactName, documentName, artifactVersion }), null, 2)}\n`,
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

/** Keep the upstream bytes and every package's notice mapping. A caller may
 * share byte-identical license files within one generated distribution. */
export async function copyDeclaredLicenseFiles(crate, licensesRoot, licenseCopies) {
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
    const bytes = await readFile(source);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const existing = licenseCopies?.get(digest);
    if (existing && existing.bytes.equals(bytes)) {
      copied.push(existing.path);
    } else {
      const relative = `licenses/${safeSegment(`${crate.name}-${crate.version}`)}/${name}`;
      await writeFile(path.join(destination, name), bytes);
      copied.push(relative);
      licenseCopies?.set(digest, { path: relative, bytes });
    }
  }
  return copied;
}

function makeNotices(
  entries,
  { noticeIntroduction, noticeClosure, sbomFile, systemLibraryNote, deduplicateLicenses },
) {
  const lines = [
    "# Worldbend third-party notices",
    "",
    `${noticeIntroduction} The SPDX 2.3 inventory is \`sbom/${sbomFile}\`; copied license texts are below \`licenses/\`.`,
    ...(deduplicateLicenses ? ["", "Byte-identical license texts are stored once. Each package entry links to its complete, unchanged upstream text."] : []),
    "",
    "This inventory covers bundled third-party components only. Worldbend is Apache-2.0; see LICENSE and NOTICE.",
    ...(sbomFile.includes("figma") ? ["Figma UI SVG icons are adapted from ByteDance IconPark (https://github.com/bytedance/IconPark), Apache-2.0. See LICENSE for the terms."] : []),
  ];
  if (systemLibraryNote) lines.push("", systemLibraryNote);
  lines.push("", "## Rust non-development dependency closure", "");
  for (const { crate, copied } of entries) {
    const identity = `${crate.name} ${crate.version}`;
    const upstream = crate.source?.startsWith("registry+")
      ? `https://crates.io/crates/${crate.name}/${crate.version}` : publicRepository(crate.repository);
    lines.push(
      `- ${upstream ? `[${identity}](${upstream})` : identity} — ${normalizeSpdx(crate.license)}; ${copied.length > 0 ? copied.join(", ") : "upstream registry archive carries no license file; canonical Apache-2.0 terms are in licenses/_common/Apache-2.0.txt"}${crate.source?.startsWith("registry+") ? "" : "; bundled source tree, which may contain modifications"}`,
    );
  }
  lines.push("", `This inventory is generated from ${noticeClosure}.`, "");
  return lines.join("\n");
}

async function makeSpdx(crates, { artifactName, documentName, artifactVersion }) {
  const lockHash = createHash("sha256").update(await readFile(path.join(root, "Cargo.lock"))).digest("hex");
  const documentId = "SPDXRef-DOCUMENT";
  const rootPackageId = "SPDXRef-Package-Worldbend";
  const packages = [
    {
      SPDXID: rootPackageId,
      name: artifactName,
      versionInfo: artifactVersion,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "Apache-2.0",
      primaryPackagePurpose: "APPLICATION",
    },
    ...crates.map((crate) => ({
      SPDXID: crateSpdxId(crate),
      name: crate.name,
      versionInfo: crate.version,
      downloadLocation: crate.source?.startsWith("registry+") ? `https://crates.io/crates/${crate.name}/${crate.version}` : "NOASSERTION",
      ...(!crate.source?.startsWith("registry+") ? { comment: `Bundled source tree, which may contain modifications.${publicRepository(crate.repository) ? ` Upstream repository: ${publicRepository(crate.repository)}` : ""}` } : {}),
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
    documentNamespace: `https://spdx.org/spdxdocs/${documentName}-${artifactVersion}-${lockHash}`,
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

function publicRepository(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}

function comparePackage(left, right) {
  return left.name.localeCompare(right.name) || left.version.localeCompare(right.version);
}

async function currentRustHostTarget() {
  const verboseVersion = await run("rustc", ["-vV"]);
  const host = verboseVersion
    .split(/\r?\n/)
    .find((line) => line.startsWith("host: "))
    ?.slice("host: ".length)
    .trim();
  if (!host || !/^[A-Za-z0-9._-]+$/.test(host)) {
    throw new Error(`Could not determine the current Rust host target: ${host}`);
  }
  return host;
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
