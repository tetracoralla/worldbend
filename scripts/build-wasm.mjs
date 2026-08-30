import { access, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { platformExecutableName } from "./platform-tooling.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindgen = path.join(
  root,
  ".tools",
  "wasm-bindgen",
  "bin",
  platformExecutableName("wasm-bindgen"),
);
const input = path.join(
  root,
  "target",
  "wasm32-unknown-unknown",
  "release",
  "worldbend_wasm.wasm",
);
const output = path.join(root, "packages", "wasm", "pkg");

try {
  await access(bindgen);
} catch {
  throw new Error("Missing repo-local wasm-bindgen. Run `pnpm bootstrap:wasm` once.");
}

await run("cargo", [
  "build",
  "-p",
  "worldbend-wasm",
  "--release",
  "--locked",
  "--target",
  "wasm32-unknown-unknown",
]);
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

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}
