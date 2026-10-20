import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertWebSdkIntegrity } from './web-sdk-integrity.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'worldbend-sdk-integrity-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Arbitrary bytes exercise integrity only; the real package has an offline consumer smoke.
  const archive = Buffer.from('SDK bytes');
  const report = { schema: 'worldbend.web-package-observation.v0.1', version: '0.1.0', archive: 'worldbend-web.tgz', runtimeDependencies: [], archiveBytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') };
  const archivePath = path.join(directory, report.archive);
  const writeReport = () => writeFile(path.join(directory, 'package-report.json'), JSON.stringify(report));
  await writeFile(archivePath, archive); await writeReport();
  return { directory, archivePath, report, writeReport };
}

test('accepts exact staged bytes and rejects a missing SDK', async t => {
  const f = await fixture(t);
  await assertWebSdkIntegrity(f.directory, '0.1.0');
  await rm(f.archivePath);
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), { code: 'ENOENT' });
});

test('rejects truncated and same-size altered SDK bytes', async t => {
  const f = await fixture(t);
  await writeFile(f.archivePath, 'short');
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /size differs/);
  await writeFile(f.archivePath, 'BAD bytes');
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /digest differs/);
});

test('rejects stale version, renamed archive and hidden npm dependencies', async t => {
  const f = await fixture(t);
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.1'), /version differs/);
  f.report.archive = '../worldbend-web.tgz'; await f.writeReport();
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /relative name/);
  f.report.archive = 'worldbend-web.tgz'; f.report.runtimeDependencies = ['missing-runtime']; await f.writeReport();
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /no runtime npm dependencies/);
});

test('rejects archive links and unbounded metadata', async t => {
  const f = await fixture(t);
  await rm(f.archivePath); await symlink('package-report.json', f.archivePath);
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /archive must be/);
  await writeFile(path.join(f.directory, 'package-report.json'), ' '.repeat(32769));
  await assert.rejects(assertWebSdkIntegrity(f.directory, '0.1.0'), /report must be/);
});
