import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeRegularTree, sha256File } from "./deterministic-tar.mjs";
import { publishImmutableArtifact } from "./immutable-artifact.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin" || process.arch !== "arm64") {
  throw new Error("The Worldbend DMG must be built on macOS arm64");
}

const workspace = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const artifactRoot = path.join(root, "artifacts", "macos");
await mkdir(artifactRoot, { recursive: true });
const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-macos-dmg-"));
const staging = await mkdtemp(path.join(artifactRoot, ".stage-"));

try {
  const componentResultPath = path.join(scratch, "component-result.json");
  await run(process.execPath, [
    path.join(root, "scripts", "package-agent-host.mjs"),
    `--result-file=${componentResultPath}`,
  ]);
  const component = JSON.parse(await readFile(componentResultPath, "utf8"));
  const componentArchive = path.join(component.directory, component.archive);
  const componentSha256 = await sha256File(componentArchive);
  if (`sha256:${componentSha256}` !== component.archiveSha256) {
    throw new Error("Agent Host component digest changed after packaging");
  }

  const source = await sourceProvenance();
  const layout = path.join(scratch, "layout");
  await mkdir(layout);
  await cp(componentArchive, path.join(layout, component.archive));
  const readme = installationReadme({
    version: workspace.version,
    componentVersion: component.version,
    archive: component.archive,
  });
  await writeFile(path.join(layout, "README.txt"), readme, "utf8");
  const payloadManifest = {
    schema: "worldbend.macos-dmg-payload.v1",
    product: "Worldbend",
    productVersion: workspace.version,
    platform: "darwin",
    architecture: "arm64",
    installationManager: "Agent Host",
    component: {
      id: component.id,
      version: component.version,
      archive: component.archive,
      sha256: component.archiveSha256,
      bytes: component.archiveBytes,
      descriptorSha256: component.descriptorSha256,
      schema: "openadam.agent-host-component.v0.1",
      integrationSchema: "openadam.agent-host-tool-integration.v0.2",
    },
    trust: {
      developerIdSigned: false,
      notarized: false,
      distribution: "unsigned-public-preview",
    },
    source,
  };
  await writeJson(path.join(layout, "PACKAGE-MANIFEST.json"), payloadManifest);
  const layoutChecksums = [];
  for (const file of [component.archive, "PACKAGE-MANIFEST.json", "README.txt"]) {
    layoutChecksums.push(`${await sha256File(path.join(layout, file))}  ${file}`);
  }
  await writeFile(path.join(layout, "SHA256SUMS.txt"), `${layoutChecksums.join("\n")}\n`, "utf8");
  await normalizeRegularTree(layout);

  const baseName = `worldbend-${workspace.version}-macos-arm64`;
  const dmgName = `${baseName}.dmg`;
  const dmgPath = path.join(staging, dmgName);
  const temporaryDmg = path.join(scratch, dmgName);
  await run("/usr/bin/hdiutil", [
    "create",
    "-quiet",
    "-fs",
    "HFS+",
    "-format",
    "UDZO",
    "-imagekey",
    "zlib-level=9",
    "-volname",
    `Worldbend ${workspace.version}`,
    "-srcfolder",
    layout,
    temporaryDmg,
  ], { ...process.env, COPYFILE_DISABLE: "1" });
  await rename(temporaryDmg, dmgPath);
  await run("/usr/bin/hdiutil", ["verify", "-quiet", dmgPath]);

  const dmgSha256 = await sha256File(dmgPath);
  const dmgBytes = (await lstat(dmgPath)).size;
  await writeFile(path.join(staging, `${dmgName}.sha256`), `${dmgSha256}  ${dmgName}\n`, "utf8");
  await cp(componentArchive, path.join(staging, component.archive));
  await writeFile(
    path.join(staging, `${component.archive}.sha256`),
    `${componentSha256}  ${component.archive}\n`,
    "utf8",
  );
  const release = {
    schema: "worldbend.macos-dmg-release.v1",
    product: "Worldbend",
    productVersion: workspace.version,
    dmg: dmgName,
    dmgSha256: `sha256:${dmgSha256}`,
    dmgBytes,
    platform: "darwin-arm64",
    component: payloadManifest.component,
    trust: payloadManifest.trust,
    source,
  };
  const releaseName = `${baseName}.release.json`;
  await writeJson(path.join(staging, releaseName), release);

  const destination = path.join(artifactRoot, `${workspace.version}-${dmgSha256.slice(0, 12)}`);
  await publishImmutableArtifact(staging, destination);
  console.log(JSON.stringify({ ...release, releaseManifest: releaseName, directory: destination }, null, 2));
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
} finally {
  await rm(scratch, { recursive: true, force: true });
}

function installationReadme({ version, componentVersion, archive }) {
  return `Worldbend ${version} for macOS (Apple Silicon)
===================================================

This disk image contains the complete Worldbend ${componentVersion} Agent Host
component: ${archive}

Recommended installation
------------------------
Install or open Agent Host, then import the enclosed component archive. Agent
Host verifies the archive, installs it into private versioned storage, connects
supported Agent apps, and owns update, rollback, and removal.

Current Agent Host CLI flow
---------------------------
Copy the archive from this disk image to a writable folder. Replace the two
example absolute paths below, then run:

  agent-host component preview \\
    --artifact "/absolute/path/${archive}" \\
    --license-spdx Apache-2.0 \\
    --workspace-root "/absolute/path/to/your/workspace" \\
    --json > "/absolute/path/worldbend-binding.json"

  agent-host component import \\
    --artifact "/absolute/path/${archive}" \\
    --binding "/absolute/path/worldbend-binding.json" \\
    --activate \\
    --workspace-root "/absolute/path/to/your/workspace"

Trust boundary
--------------
This preview package is ad-hoc signed, not Developer ID signed, and not
notarized. macOS may require you to approve the downloaded software. Do not
disable Gatekeeper globally. SHA256SUMS.txt and PACKAGE-MANIFEST.json describe
the exact enclosed payload.

中文说明
--------
这是适用于 Apple 芯片 Mac 的 Worldbend ${version} 安装镜像。推荐使用 Agent Host
导入镜像中的 ${archive}；Agent Host 会校验文件、安装到私有版本目录，并负责连接、
更新、回滚和卸载。Worldbend 需要你明确选择一个工作区目录。

此预览包只有 ad-hoc 签名，没有 Apple Developer ID 签名，也没有经过公证；macOS
可能要求你手动确认信任。不要全局关闭 Gatekeeper。可用 SHA256SUMS.txt 和
PACKAGE-MANIFEST.json 核对镜像内的准确内容。
`;
}

async function sourceProvenance() {
  const revision = (await capture("git", ["rev-parse", "HEAD"])).trim();
  const dirty = (await capture("git", ["status", "--porcelain"])).trim().length > 0;
  return { revision, dirty };
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
