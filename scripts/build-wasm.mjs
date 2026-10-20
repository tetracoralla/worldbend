import { access, mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { platformExecutableName } from "./platform-tooling.mjs";
import { assertNoPrivateBuildPaths, rustBuildEnvironment } from "./build-privacy.mjs";
import { wasmProfile } from "./wasm-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindgen = path.join(
  root,
  ".tools",
  "wasm-bindgen",
  "bin",
  platformExecutableName("wasm-bindgen"),
);
const profileArgument = process.argv.find((argument) => argument.startsWith("--profile="));
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== profileArgument);
if (unknownArguments.length > 0) {
  throw new Error(`Unknown build-wasm arguments: ${unknownArguments.join(", ")}`);
}
const profile = profileArgument?.slice("--profile=".length) ?? "full";
const { crate, featureArguments, outputDirectory } = wasmProfile(profile);
const input = path.join(root, "target", "wasm32-unknown-unknown", "release", `${crate.replaceAll("-", "_")}.wasm`);
const output = path.join(root, outputDirectory);

try {
  await access(bindgen);
} catch {
  throw new Error("Missing repo-local wasm-bindgen. Run `pnpm bootstrap:wasm` once.");
}

const cargoArguments = [
  "build",
  "-p",
  crate,
  "--release",
  "--locked",
  "--target",
  "wasm32-unknown-unknown",
];
cargoArguments.push(...featureArguments);
await run("cargo", cargoArguments);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await run(bindgen, [
  input,
  "--target",
  "web",
  "--out-dir",
  output,
  "--out-name",
  "worldbend_wasm",
  "--typescript",
]);
if (profile === "psd-import") {
  // The import carrier always receives its bytes explicitly — from the UI
  // main thread or inside the import worker. Rewrite the generated URL
  // fallback at the source so no bundler can inline the raw WASM as a data
  // URL behind a path the caller never takes (the worker sub-build applies
  // no carrier transform).
  const bindingsPath = path.join(output, "worldbend_wasm.js");
  const bindings = await readFile(bindingsPath, "utf8");
  const fallback = "module_or_path = new URL('worldbend_wasm_bg.wasm', import.meta.url);";
  if (!bindings.includes(fallback)) {
    throw new Error("Generated psd-import WASM loader fallback changed; carrier rewrite stopped");
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(bindingsPath, bindings.replace(
    fallback,
    "throw new Error('The PSD import carrier requires its compressed WASM payload');",
  ));
}
assertNoPrivateBuildPaths(await readFile(path.join(output, "worldbend_wasm_bg.wasm")), [root]);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", env: rustBuildEnvironment(root) });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}
