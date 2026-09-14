import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertExactArchiveMembers,
  assertPortableArchiveMember,
  assertRegularArchiveListing,
  createDeterministicTarGz,
  normalizeRegularTree,
} from "./deterministic-tar.mjs";

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

test("archive member paths that ustar cannot split are rejected up front", {
  skip: process.platform !== "darwin",
}, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-deterministic-tar-"));
  try {
    const source = path.join(scratch, "source");
    await mkdir(source, { recursive: true });
    const tooLong = `${"a".repeat(101)}.txt`;
    await writeFile(path.join(source, tooLong), "payload");
    await assert.rejects(
      () => createDeterministicTarGz({
        sourceDirectory: source,
        relativeFiles: [tooLong],
        archive: path.join(scratch, "out.tar.gz"),
        scratchDirectory: scratch,
      }),
      /cannot be represented by ustar/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("archive path checks use UTF-8 byte limits and reject control characters", () => {
  assert.throws(() => assertPortableArchiveMember(`${"界".repeat(34)}.txt`), /cannot be represented by ustar/);
  assert.throws(() => assertPortableArchiveMember("safe\nforged.txt"), /Unsafe archive member/);
  assert.throws(() => assertPortableArchiveMember("safe\tmisleading.txt"), /Unsafe archive member/);
  assert.throws(() => assertPortableArchiveMember("C:/escape.txt"), /Unsafe archive member/);
  assert.doesNotThrow(() => assertPortableArchiveMember(`${"p".repeat(150)}/${"n".repeat(95)}.txt`));
});

test("sealed archive inventory rejects duplicates, traversal, and extra members", () => {
  assert.doesNotThrow(() => assertExactArchiveMembers(["component.json", "bin/worldbend"], ["bin/worldbend", "component.json"]));
  assert.throws(() => assertExactArchiveMembers(["component.json", "component.json"], ["component.json"]), /duplicate/);
  assert.throws(() => assertExactArchiveMembers(["../outside"], ["../outside"]), /Unsafe archive member/);
  assert.throws(() => assertExactArchiveMembers(["component.json", "extra"], ["component.json"]), /differ/);
});

test("archive type preflight accepts only regular-file entries", () => {
  assert.doesNotThrow(() => assertRegularArchiveListing(["-rw-r--r-- file"], 1));
  assert.throws(() => assertRegularArchiveListing(["lrwxr-xr-x link -> /tmp"], 1), /not a regular file/);
  assert.throws(() => assertRegularArchiveListing(["-rw-r--r-- file"], 2), /member count/);
});
