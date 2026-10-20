import { readFile, writeFile, mkdir, readdir, lstat, mkdtemp, rename, rm, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { withAppearancePlanner } from './appearance-planner-client.mjs';

const flag = name => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw Error('Pass ' + name);
  return process.argv[i + 1];
};
const documentFile = path.resolve(flag('--document')), receiptFile = path.resolve(flag('--frame-receipt')),
  frames = path.resolve(flag('--frames')), indexFile = path.resolve(flag('--asset-index')),
  sourceIndexFile = path.resolve(flag('--source-index')), output = path.resolve(flag('--output')),
  workID = flag('--work-id');
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const fileLimit = 64 * 1024 * 1024, packageLimit = 512 * 1024 * 1024;
if (!workID || [...workID].length > 128 || Buffer.byteLength(workID) > 256 || /\p{Cc}/u.test(workID))
  throw Error('Use a bounded work ID');
const existing = await lstat(output).catch(error => { if (error.code !== 'ENOENT') throw error; });
if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(output)).length))
  throw Error('Candidate output must be a new or empty regular directory');

async function readBounded(file, limit = fileLimit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > limit) throw Error('Use bounded regular resource files');
    const chunks = []; let size = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(1024 * 1024, limit - size + 1));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw Error('Resource exceeds byte budget');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
async function readRelative(relative, directory) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw Error('Use package-relative resources');
  const parts = relative.replace(/^\.\//, '').split('/');
  if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\')))
    throw Error('Use regular package-relative resources');
  const base = await realpath(directory);
  let file = base;
  for (const [i, part] of parts.entries()) {
    file = path.join(file, part);
    const info = await lstat(file);
    if (info.isSymbolicLink() || (i === parts.length - 1 ? !info.isFile() : !info.isDirectory()))
      throw Error('Use regular package-relative resources without symlinks');
  }
  const canonical = await realpath(file);
  if (!canonical.startsWith(base + path.sep)) throw Error('Resource escaped its package directory');
  return readBounded(canonical);
}
const readRecord = async file => JSON.parse((await readBounded(file, 8 * 1024 * 1024)).toString('utf8'));
const documentRecord = await readRecord(documentFile), document = documentRecord.document ?? documentRecord,
  record = await readRecord(receiptFile), receipt = record.receipt ?? record;
const refs = await readRecord(indexFile), sourceRefs = await readRecord(sourceIndexFile);
if (receipt.schema !== 'worldbend.scene3d-frames' || receipt.version !== '0.1')
  throw Error('Use an actual scene frame receipt');
let plan;
await withAppearancePlanner(async run => {
  const delivered = await run('document_delivery_plan', { document, expectedFingerprint: receipt.documentFingerprint });
  plan = delivered.deliveries.find(d => d.kind === 'scene3d' && d.scene.fingerprint === receipt.sceneFingerprint)?.scene;
});
if (!plan || plan.spec.frameCount !== receipt.frameCount || plan.durationMs !== receipt.durationMs ||
    plan.spec.canvas.width !== receipt.canvas.width || plan.spec.canvas.height !== receipt.canvas.height ||
    plan.spec.timebase.numerator !== receipt.timebase.numerator || plan.spec.timebase.denominator !== receipt.timebase.denominator)
  throw Error('Frames do not match current canonical work');

// Only this private sibling directory can contain partial work. Failed input
// leaves the requested destination untouched, so the same command can retry.
await mkdir(path.dirname(output), { recursive: true });
const staging = await mkdtemp(path.join(path.dirname(output), '.raster-work-'));
let published = false;
try {
  await mkdir(path.join(staging, 'frames'));
  await mkdir(path.join(staging, 'sources'));
  const sources = [], sourceFiles = new Set(); let total = 0;
  const writeResource = async (file, bytes) => {
    if (bytes.length > fileLimit || total + bytes.length > packageLimit) throw Error('Package exceeds byte budget');
    total += bytes.length;
    await writeFile(path.join(staging, file), bytes);
    return { file, sha256: hash(bytes) };
  };
  const put = async (file, bytes) => {
    if (sourceFiles.has(file) || sources.length >= 32) throw Error('Duplicate or excessive source resources');
    sourceFiles.add(file);
    const entry = await writeResource(file, bytes); sources.push(entry); return entry;
  };
  await put('sources/document.json', Buffer.from(JSON.stringify(document, null, 2) + '\n'));
  await put('sources/scene-plan.json', Buffer.from(JSON.stringify(plan, null, 2) + '\n'));
  const packedAssets = {}, packedSources = {};
  for (const [n, asset] of document.assets.entries()) {
    const relative = refs[asset.contentVersion];
    if (!relative) throw Error('Missing exact content ' + asset.id);
    const name = n + '-' + path.basename(relative), bytes = await readRelative(relative, path.dirname(indexFile));
    if (hash(bytes) !== asset.contentVersion) throw Error('Asset version changed');
    await put('sources/' + name, bytes); packedAssets[asset.contentVersion] = name;
    const editable = sourceRefs[asset.contentVersion];
    if (editable) {
      const editableName = n + '-' + path.basename(editable);
      await put('sources/' + editableName, await readRelative(editable, path.dirname(sourceIndexFile)));
      packedSources[asset.contentVersion] = editableName;
    }
  }
  await put('sources/asset-index.json', Buffer.from(JSON.stringify(packedAssets, null, 2) + '\n'));
  await put('sources/source-index.json', Buffer.from(JSON.stringify(packedSources, null, 2) + '\n'));
  const samples = [];
  for (const sample of plan.samples) {
    const name = String(sample.frame).padStart(4, '0') + '.png', bytes = await readRelative(name, frames);
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a ||
        bytes.readUInt32BE(12) !== 0x49484452 || bytes.readUInt32BE(16) !== receipt.canvas.width ||
        bytes.readUInt32BE(20) !== receipt.canvas.height) throw Error('Frame dimensions/header mismatch');
    samples.push({ frame: sample.frame, milliseconds: sample.milliseconds, ...await writeResource('frames/' + name, bytes) });
  }
  const manifest = {
    schema: 'worldbend.raster-work-package', version: '0.1', workID, receipt,
    colorSpace: 'srgb', alpha: 'premultiplied-bgra8', frames: samples, sources,
    losses: [
      'Pixels retain the selected receiving camera/material/lighting; native camera/material/print edits require rebaking the canonical source work.',
      'PNG decode/color conversion and CPU writing to CVPixelBuffer precede publication; no end-to-end zero-copy claim.',
      'No stochastic simulation, seed-driven behavior or event-history replay is supplied by this baked frame profile.',
    ],
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  await writeResource('manifest.json', bytes);
  const info = {
    schema: 'worldbend.raster-work-candidate@0.1', manifestSHA256: hash(bytes), workID,
    documentFingerprint: receipt.documentFingerprint, frameCount: receipt.frameCount, durationMs: receipt.durationMs, output,
  };
  await writeResource('candidate-receipt.json', Buffer.from(JSON.stringify(info, null, 2) + '\n'));
  // rename cannot overwrite a populated directory, including a concurrently
  // created destination. An existing empty destination is supported.
  await rename(staging, output); published = true;
  console.log(JSON.stringify(info));
} finally {
  if (!published) await rm(staging, { recursive: true, force: true });
}
