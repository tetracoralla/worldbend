import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { assertFigmaRuntimePrivacy, assertNoPrivateBuildPaths, assertNoPluginStagingResidue, rustBuildEnvironment } from "./build-privacy.mjs";

test("Rust path remapping preserves encoded flags and paths containing spaces", () => {
  const env = rustBuildEnvironment("/workspace/our product", {
    CARGO_ENCODED_RUSTFLAGS: '--cfg\x1ffeature="with space"', CARGO_HOME: "/cache/cargo",
  }, "/builder-account");
  assert.deepEqual(env.CARGO_ENCODED_RUSTFLAGS.split("\x1f"), [
    "--cfg", 'feature="with space"', "--remap-path-prefix=/builder-account=builder",
    "--remap-path-prefix=/cache/cargo=cargo", "--remap-path-prefix=/workspace/our product=worldbend",
  ]);
  assert(rustBuildEnvironment("/workspace", { RUSTFLAGS: "-C opt-level=3" }, "/builder-account")
    .CARGO_ENCODED_RUSTFLAGS.startsWith("-C\x1fopt-level=3\x1f"));
});

test("Figma package privacy checks the compressed WASM, not only visible HTML", () => {
  const ui = suffix => `const wasm="${gzipSync(Buffer.concat([Buffer.from([0, 97, 115, 109]), Buffer.from(suffix)])).toString("base64")}"`;
  assert.doesNotThrow(() => assertFigmaRuntimePrivacy(ui("cargo/registry/dependency.rs"), ""));
  assert.throws(() => assertFigmaRuntimePrivacy(ui("/builder-account/dependency.rs"), "", ["/builder-account"]), /private build path/);
  assert.throws(() => assertFigmaRuntimePrivacy("<html>No module</html>", ""), /Expected one/);
});

test("native artifact privacy rejects embedded paths and accepts remapped diagnostics", () => {
  assert.doesNotThrow(() => assertNoPrivateBuildPaths(Buffer.from("cargo/registry/core.rs\0worldbend/crates/main.rs")));
  assert.throws(() => assertNoPrivateBuildPaths(Buffer.from("binary\0/build-account/source.rs"), ["/build-account"]), /private build path/);
});

test("plugin scratch checks include legal-file rollback copies", () => {
  for (const name of [".bin-stage-interrupted", ".web-backup-old", ".LICENSE.backup-old", ".NOTICE.backup-old", ".licenses.backup-old", ".sbom.backup-old", ".THIRD_PARTY_NOTICES.md.backup-old"]) {
    assert.throws(() => assertNoPluginStagingResidue(name), /staging residue/);
  }
  for (const name of [".codex-plugin", ".mcp.json", "LICENSE", "NOTICE"]) assert.doesNotThrow(() => assertNoPluginStagingResidue(name));
});
