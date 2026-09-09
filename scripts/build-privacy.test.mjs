import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { assertFigmaRuntimePrivacy, wasmBuildEnvironment } from "./build-privacy.mjs";

test("WASM path remapping preserves encoded flags and paths containing spaces", () => {
  const env = wasmBuildEnvironment("/workspace/our product", {
    CARGO_ENCODED_RUSTFLAGS: '--cfg\x1ffeature="with space"', CARGO_HOME: "/cache/cargo",
  }, "/builder-account");
  assert.deepEqual(env.CARGO_ENCODED_RUSTFLAGS.split("\x1f"), [
    "--cfg", 'feature="with space"', "--remap-path-prefix=/builder-account=builder",
    "--remap-path-prefix=/cache/cargo=cargo", "--remap-path-prefix=/workspace/our product=worldbend",
  ]);
  assert(wasmBuildEnvironment("/workspace", { RUSTFLAGS: "-C opt-level=3" }, "/builder-account")
    .CARGO_ENCODED_RUSTFLAGS.startsWith("-C\x1fopt-level=3\x1f"));
});

test("Figma package privacy checks the compressed WASM, not only visible HTML", () => {
  const ui = suffix => `const wasm="${gzipSync(Buffer.concat([Buffer.from([0, 97, 115, 109]), Buffer.from(suffix)])).toString("base64")}"`;
  assert.doesNotThrow(() => assertFigmaRuntimePrivacy(ui("cargo/registry/dependency.rs"), ""));
  assert.throws(() => assertFigmaRuntimePrivacy(ui("/builder-account/dependency.rs"), "", ["/builder-account"]), /private build path/);
  assert.throws(() => assertFigmaRuntimePrivacy("<html>No module</html>", ""), /Expected one/);
});
