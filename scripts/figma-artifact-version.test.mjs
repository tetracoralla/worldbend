import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Figma artifact checker uses the Figma package version", async () => {
  const checker = await readFile(
    new URL("./check-built-artifacts.mjs", import.meta.url),
    "utf8",
  );

  assert.match(checker, /path\.join\(figmaRoot, "package\.json"\)/);
  assert.match(checker, /String\(figmaPackage\.version\)/);
  assert.doesNotMatch(checker, /String\(workspacePackage\.version\)/);
});
