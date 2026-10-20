import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { platformExecutableName } from "./platform-tooling.mjs";
import { loadCarrierProfiles } from "./carrier-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON
  ?? (process.platform === "win32" ? "python" : "python3");
const carrierProfiles = await loadCarrierProfiles();
const comfyCargoFeatures =
  carrierProfiles.carriers.comfyui.package.nativeCargoFeatures.join(",");

await run("cargo", [
  "build",
  "--locked",
  "-p",
  "worldbend-cli",
  "--bin",
  "worldbend",
  "--no-default-features",
  "--features",
  comfyCargoFeatures,
]);
const executable = path.join(
  root,
  "target",
  "debug",
  platformExecutableName("worldbend"),
);
await run(python, [
  "-m",
  "unittest",
  "discover",
  "-s",
  "packages/comfyui/tests",
  "-v",
], {
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  WORLDBEND_CLI: executable,
});

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}
