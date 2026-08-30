import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLineEndings } from "./text-normalization.mjs";

test("canonicalizes Windows and legacy Mac line endings without changing text", () => {
  assert.equal(
    normalizeLineEndings("first\r\nsecond\rthird\nfourth"),
    "first\nsecond\nthird\nfourth",
  );
});

test("does not erase real generated-contract differences", () => {
  const generated = normalizeLineEndings("export type Value = string;\n");
  const stale = normalizeLineEndings("export type Value = number;\r\n");

  assert.notEqual(stale, generated);
});
