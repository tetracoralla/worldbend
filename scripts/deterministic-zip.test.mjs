import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeDeterministicZip } from "./deterministic-zip.mjs";

test("writes a stable ZIP with portable forward-slash entries", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "worldbend-zip-"));
  try {
    const sourceRoot = path.join(temporaryRoot, "source");
    await mkdir(path.join(sourceRoot, "nested"), { recursive: true });
    await writeFile(path.join(sourceRoot, "a.txt"), "alpha\n");
    await writeFile(path.join(sourceRoot, "nested", "b.txt"), "beta\n");

    const entries = ["nested/b.txt", "a.txt"];
    const firstArchive = path.join(temporaryRoot, "first.zip");
    const secondArchive = path.join(temporaryRoot, "second.zip");
    const firstInventory = await writeDeterministicZip({
      archivePath: firstArchive,
      sourceRoot,
      rootName: "worldbend",
      entries,
    });

    await utimes(
      path.join(sourceRoot, "a.txt"),
      new Date("2026-08-30T00:00:00.000Z"),
      new Date("2026-08-30T00:00:00.000Z"),
    );
    const secondInventory = await writeDeterministicZip({
      archivePath: secondArchive,
      sourceRoot,
      rootName: "worldbend",
      entries,
    });

    assert.deepEqual(firstInventory, [
      "worldbend/a.txt",
      "worldbend/nested/b.txt",
    ]);
    assert.deepEqual(secondInventory, firstInventory);
    assert.deepEqual(await readFile(secondArchive), await readFile(firstArchive));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("preserves Unix executable mode only for declared entries", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "worldbend-zip-mode-"));
  try {
    const sourceRoot = path.join(temporaryRoot, "source");
    await mkdir(path.join(sourceRoot, "bin"), { recursive: true });
    await writeFile(path.join(sourceRoot, "README.md"), "read me\n");
    await writeFile(path.join(sourceRoot, "bin", "worldbend"), "binary\n");
    const archivePath = path.join(temporaryRoot, "package.zip");
    await writeDeterministicZip({
      archivePath,
      sourceRoot,
      rootName: "worldbend",
      entries: ["README.md", "bin/worldbend"],
      executableEntries: ["bin/worldbend"],
    });

    const archive = await readFile(archivePath);
    assert.deepEqual(readCentralMode(archive, "worldbend/bin/worldbend"), {
      os: 3,
      mode: 0o755,
    });
    assert.deepEqual(readCentralMode(archive, "worldbend/README.md"), {
      os: 0,
      mode: 0,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("rejects traversal and platform-specific archive paths", async () => {
  await assert.rejects(
    writeDeterministicZip({
      archivePath: "unused.zip",
      sourceRoot: ".",
      rootName: "worldbend",
      entries: ["../escape.txt"],
    }),
    /Unsafe ZIP entry/,
  );
  await assert.rejects(
    writeDeterministicZip({
      archivePath: "unused.zip",
      sourceRoot: ".",
      rootName: "worldbend",
      entries: ["nested\\file.txt"],
    }),
    /Unsafe ZIP entry/,
  );
});

function readCentralMode(archive, expectedName) {
  const signature = 0x02014b50;
  for (let offset = 0; offset <= archive.length - 46; offset += 1) {
    if (archive.readUInt32LE(offset) !== signature) continue;
    const filenameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const filename = archive
      .subarray(offset + 46, offset + 46 + filenameLength)
      .toString("utf8");
    if (filename === expectedName) {
      return {
        os: archive.readUInt16LE(offset + 4) >> 8,
        mode: (archive.readUInt32LE(offset + 38) >>> 16) & 0o777,
      };
    }
    offset += 45 + filenameLength + extraLength + commentLength;
  }
  throw new Error(`Missing central ZIP entry: ${expectedName}`);
}
