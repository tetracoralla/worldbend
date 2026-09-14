import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDeterministicTarGz, normalizeRegularTree } from "./deterministic-tar.mjs";

test("macOS component archives reproduce from equivalent trees", {
  skip: process.platform !== "darwin",
}, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-deterministic-tar-"));
  try {
    const archives = [];
    for (const name of ["first", "second"]) {
      const source = path.join(scratch, name, "source");
      await mkdir(path.join(source, "bin"), { recursive: true });
      await writeFile(path.join(source, "bin", "worldbend"), "same executable bytes");
      await writeFile(path.join(source, "component.json"), "{\"same\":true}\n");
      await normalizeRegularTree(source);
      const archive = path.join(scratch, `${name}.tar.gz`);
      await createDeterministicTarGz({
        sourceDirectory: source,
        relativeFiles: ["component.json", "bin/worldbend"],
        archive,
        scratchDirectory: path.join(scratch, name),
      });
      archives.push(await readFile(archive));
    }
    assert.deepEqual(archives[0], archives[1]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("archive member paths beyond the ustar limit are rejected up front", {
  skip: process.platform !== "darwin",
}, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-deterministic-tar-"));
  try {
    const source = path.join(scratch, "source");
    await mkdir(source, { recursive: true });
    const longSegment = "a".repeat(200);
    await writeFile(path.join(source, `${longSegment}.txt`), "payload");
    const tooLong = `${longSegment}/${longSegment}.txt`;
    await assert.rejects(
      () => createDeterministicTarGz({
        sourceDirectory: source,
        relativeFiles: [tooLong],
        archive: path.join(scratch, "out.tar.gz"),
        scratchDirectory: scratch,
      }),
      /ustar 255-character path limit/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
