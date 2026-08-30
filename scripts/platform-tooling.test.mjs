import assert from "node:assert/strict";
import test from "node:test";

import { platformExecutableName } from "./platform-tooling.mjs";

test("uses the Windows executable suffix for repo-local tools", () => {
  assert.equal(platformExecutableName("wasm-bindgen", "win32"), "wasm-bindgen.exe");
});

test("keeps Unix executable names extensionless", () => {
  assert.equal(platformExecutableName("wasm-bindgen", "darwin"), "wasm-bindgen");
  assert.equal(platformExecutableName("wasm-bindgen", "linux"), "wasm-bindgen");
});
