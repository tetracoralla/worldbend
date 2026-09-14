import { rustBuildEnvironment, assertNoPrivateBuildPaths } from "./build-privacy.mjs";
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { writePluginLegalMaterial } from "./generate-plugin-legal.mjs";
import {
  assertCarrierIsolation,
  listRegularFiles,
  loadCarrierProfiles,
} from "./carrier-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "plugins", "worldbend");
const workspacePackage = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const carrierProfiles = await loadCarrierProfiles();
const agentPackageProfile = carrierProfiles.carriers.agent.package;
const output = path.join(pluginRoot, "bin");
const staging = await mkdtemp(path.join(pluginRoot, ".bin-stage-"));
const backup = path.join(pluginRoot, `.bin-backup-${randomUUID()}`);
const capabilityOutput = path.join(pluginRoot, "capabilities");
const capabilityStaging = path.join(pluginRoot, `.capabilities-stage-${randomUUID()}`);
const capabilityBackup = path.join(pluginRoot, `.capabilities-backup-${randomUUID()}`);
const legalStaging = path.join(pluginRoot, `.legal-stage-${randomUUID()}`);
const webStaging = path.join(pluginRoot, `.web-stage-${randomUUID()}`);
const webBackup = path.join(pluginRoot, `.web-backup-${randomUUID()}`);
assertGeneratedPath(output, "bin");
assertGeneratedPath(staging, ".bin-stage-");
assertGeneratedPath(backup, ".bin-backup-");
assertGeneratedPath(capabilityOutput, "capabilities");
assertGeneratedPath(capabilityStaging, ".capabilities-stage-");
assertGeneratedPath(capabilityBackup, ".capabilities-backup-");
assertGeneratedPath(legalStaging, ".legal-stage-");
assertGeneratedPath(webStaging, ".web-stage-");
assertGeneratedPath(webBackup, ".web-backup-");

try {
  await run("node", ["scripts/build-figma-handoff-runtime.mjs", "--check"]);
  await run("cargo", [
    "build",
    "--locked",
    "--release",
    "-p",
    "worldbend-cli",
    "-p",
    "worldbend-mcp",
    "--no-default-features",
    "--features",
    agentPackageProfile.nativeCargoFeatures.join(","),
  ]);
  for (const name of agentPackageProfile.requiredExecutables) {
    const executable = executableName(name);
    const destination = path.join(staging, executable);
    await copyFile(path.join(root, "target", "release", executable), destination);
    assertNoPrivateBuildPaths(await readFile(destination), [root]);
    if (process.platform !== "win32") await chmod(destination, 0o755);
    const version = (
      await run(destination, ["--version"], { capture: true, timeout: 5_000 })
    ).trim();
    if (version !== `${name} ${workspacePackage.version}`) {
      throw new Error(`Unexpected staged ${name} version: ${version}`);
    }
  }
  await mkdir(capabilityStaging);
  for (const name of ["README.md", "provider.json"]) {
    await copyFile(
      path.join(root, "capabilities", name),
      path.join(capabilityStaging, name),
    );
  }
  await cp(
    path.join(root, "capabilities", "schemas"),
    path.join(capabilityStaging, "schemas"),
    {
    recursive: true,
    errorOnExist: true,
    },
  );
  await writePluginLegalMaterial({ destination: legalStaging });
  // The Agent may install the self-contained Web SDK into a frontend without
  // locating this development checkout or guessing an unpublished npm URL.
  await run("pnpm", ["build:web"]);
  await mkdir(webStaging);
  const webReportPath = path.join(webStaging, "package-report.json");
  await run("node", ["scripts/package-web.mjs", "--report-file", webReportPath]);
  const webReport = JSON.parse(await readFile(webReportPath, "utf8"));
  await copyFile(path.join(webReport.directory, webReport.runtimeArchive), path.join(webStaging, "worldbend-web.tgz"));
  // Strip machine-specific paths from the installed product's data.
  delete webReport.directory;
  webReport.archive = "worldbend-web.tgz";
  webReport.archiveBytes = webReport.runtimeArchiveBytes;
  webReport.sha256 = webReport.runtimeArchiveSha256;
  delete webReport.runtimeArchive;
  delete webReport.runtimeArchiveBytes;
  delete webReport.runtimeArchiveSha256;
  await writeFile(webReportPath, JSON.stringify(webReport, null, 2) + "\n");

  const replacements = [
    { backup, output, staging },
    { backup: webBackup, output: path.join(pluginRoot, "skills/worldbend/assets/web"), staging: webStaging },
    {
      backup: capabilityBackup,
      output: capabilityOutput,
      staging: capabilityStaging,
    },
    ...[
      "LICENSE",
      "NOTICE",
      "licenses",
      "sbom",
      "THIRD_PARTY_NOTICES.md",
    ].map((name) => ({
      staging: path.join(legalStaging, name),
      output: path.join(pluginRoot, name),
      backup: path.join(pluginRoot, `.${name}.backup-${randomUUID()}`),
    })),
  ];
  await mkdir(path.join(pluginRoot, "skills/worldbend/assets"), { recursive: true });
  try {
    for (const replacement of replacements) {
      try {
        await rename(replacement.output, replacement.backup);
        replacement.backupCreated = true;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const replacement of replacements) {
      await rename(replacement.staging, replacement.output);
      replacement.committed = true;
    }
  } catch (error) {
    for (const replacement of replacements.reverse()) {
      if (replacement.committed) {
        await rm(replacement.output, { recursive: true, force: true });
      }
      if (replacement.backupCreated) {
        await rename(replacement.backup, replacement.output);
      }
    }
    throw error;
  }
  for (const replacement of replacements) {
    // The replacement is already committed. Backup cleanup must not turn a
    // successful stage into an ordinary failure that hides the new plugin.
    await rm(replacement.backup, { recursive: true, force: true }).catch(() => {});
  }
  await rm(legalStaging, { recursive: true, force: true }).catch(() => {});
  await rm(webStaging, { recursive: true, force: true }).catch(() => {});
  assertCarrierIsolation(
    await listRegularFiles(pluginRoot),
    agentPackageProfile,
    "Agent plugin",
  );
} catch (error) {
  await rm(staging, { recursive: true, force: true }).catch(() => {});
  await rm(capabilityStaging, { recursive: true, force: true }).catch(() => {});
  await rm(legalStaging, { recursive: true, force: true }).catch(() => {});
  await rm(webStaging, { recursive: true, force: true }).catch(() => {});
  throw error;
}

function executableName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function assertGeneratedPath(target, expectedPrefix) {
  if (
    path.dirname(target) !== pluginRoot ||
    !path.basename(target).startsWith(expectedPrefix)
  ) {
    throw new Error(`Refusing to replace unexpected plugin path: ${target}`);
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: command === "cargo" ? rustBuildEnvironment(root) : process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      timeout: options.timeout,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout);
      else if (signal === "SIGKILL" && options.timeout) {
        reject(new Error(`${command} timed out after ${options.timeout}ms`));
      } else {
        reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
      }
    });
  });
}
