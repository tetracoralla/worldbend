import { homedir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export function wasmBuildEnvironment(root, environment = process.env, home = homedir()) {
  const flags = environment.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? environment.CARGO_ENCODED_RUSTFLAGS.split("\x1f").filter(Boolean)
    : (environment.RUSTFLAGS ?? "").split(/\s+/).filter(Boolean);
  const mappings = [
    [home, "builder"],
    [environment.CARGO_HOME ?? path.join(home, ".cargo"), "cargo"],
    [root, "worldbend"],
  ];
  return { ...environment, CARGO_ENCODED_RUSTFLAGS: [
    ...flags, ...mappings.map(([source, replacement]) => `--remap-path-prefix=${source}=${replacement}`),
  ].join("\x1f") };
}

export function assertNoPrivateBuildPaths(bytes, roots = []) {
  const text = Buffer.from(bytes).toString("utf8");
  if (/(?:\/Users\/|\/home\/|\/var\/folders\/|[A-Za-z]:[\\/]Users[\\/])/.test(text)
    || roots.some(root => root && text.includes(root))) {
    throw new Error("Artifact contains a private build path; rebuild with source-path remapping");
  }
}

export function assertFigmaRuntimePrivacy(ui, main, roots = []) {
  assertNoPrivateBuildPaths(Buffer.from(ui), roots);
  assertNoPrivateBuildPaths(Buffer.from(main), roots);
  // Inspect actual embedded bytes, not only the base64 text or a sibling WASM.
  let wasmCount = 0;
  for (const match of ui.matchAll(/["'](H4sI[A-Za-z0-9+/=]+)["']/g)) {
    const decoded = gunzipSync(Buffer.from(match[1], "base64"));
    assertNoPrivateBuildPaths(decoded, roots);
    if (decoded.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) wasmCount++;
  }
  if (wasmCount !== 1) throw new Error("Expected one embedded WASM module for the Figma privacy check");
}
