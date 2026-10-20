import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyDeclaredLicenseFiles } from "./generate-plugin-legal.mjs";

test("shared license storage preserves every byte and keeps different copyright notices separate", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "worldbend-license-dedup-"));
  try {
    const destination = path.join(root, "package");
    const licenses = path.join(destination, "licenses");
    const originals = [Buffer.from("License\r\nCopyright A\r\n"), Buffer.from("License\r\nCopyright A\r\n"), Buffer.from("License\nCopyright B\n")];
    const copies = new Map();
    const refs = [];
    for (let i = 0; i < originals.length; i++) {
      const source = path.join(root, `crate-${i}`);
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, "Cargo.toml"), "");
      await writeFile(path.join(source, "LICENSE"), originals[i]);
      refs.push(await copyDeclaredLicenseFiles({ name: `crate-${i}`, version: "1.0.0", manifest_path: path.join(source, "Cargo.toml") }, licenses, copies));
      assert.deepEqual(await readFile(path.join(destination, refs[i][0])), originals[i]);
    }
    assert.deepEqual(refs[0], refs[1]);
    assert.notDeepEqual(refs[0], refs[2]);
    assert.equal(copies.size, 2);
    // Other carriers retain their current independent paths unless they opt in.
    const source = path.join(root, "crate-1");
    const unshared = await copyDeclaredLicenseFiles({ name: "crate-1", version: "1.0.0", manifest_path: path.join(source, "Cargo.toml") }, licenses);
    assert.notDeepEqual(unshared, refs[0]);
    assert.deepEqual(await readFile(path.join(destination, unshared[0])), originals[1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
