import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

async function inventory(directory) {
  if (!(await lstat(directory)).isDirectory()) throw new Error('Artifact root must be a directory');
  const files = [];
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const key = path.join(relative, name), file = path.join(directory, key);
      const info = await lstat(file);
      if (info.isDirectory()) { files.push([key, 'directory']); await visit(key); }
      else if (info.isFile()) files.push([key, info.mode & 0o111, createHash('sha256').update(await readFile(file)).digest('hex')]);
      else throw new Error(`Artifact contains a nonregular entry: ${key}`);
    }
  }
  await visit('');
  return JSON.stringify(files);
}

// Identical repeated builds reuse the immutable output. Never overwrite an
// existing artifact whose unpacked files, archives or reports have changed.
export async function publishImmutableArtifact(staging, destination) {
  try { await rename(staging, destination); }
  catch (error) {
    // Windows reports EPERM when the destination directory already exists.
    // It is reusable only after the same complete inventory check as POSIX.
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
    let existing;
    try { existing = await inventory(destination); }
    catch (inspectionError) {
      if (inspectionError.code === 'ENOENT') throw error;
      throw inspectionError;
    }
    if (await inventory(staging) !== existing) {
      throw new Error(`Existing artifact differs; preserved without overwrite: ${destination}`);
    }
    await rm(staging, { recursive: true });
  }
}
