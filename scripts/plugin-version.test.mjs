import assert from "node:assert/strict";
import test from "node:test";

import { isWorkspacePluginVersion } from "./plugin-version.mjs";

test("accepts the workspace version and a timestamped Codex cachebuster", () => {
  assert.equal(isWorkspacePluginVersion("0.1.0", "0.1.0"), true);
  assert.equal(
    isWorkspacePluginVersion("0.1.0+codex.20260824051932", "0.1.0"),
    true,
  );
});

test("rejects version drift and malformed cachebusters", () => {
  assert.equal(
    isWorkspacePluginVersion("0.2.0+codex.20260824051932", "0.1.0"),
    false,
  );
  assert.equal(
    isWorkspacePluginVersion("0.1.0+other.20260824051932", "0.1.0"),
    false,
  );
  assert.equal(isWorkspacePluginVersion("0.1.0+codex.latest", "0.1.0"), false);
});
