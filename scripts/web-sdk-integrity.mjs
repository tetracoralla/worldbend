import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';

/** Check the staged SDK bytes; package-web separately proves offline installation/execution. */
export async function assertWebSdkIntegrity(directory, version) {
  const directoryInfo = await lstat(directory);
  assert(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), 'Web SDK directory must be regular');
  const reportPath = path.join(directory, 'package-report.json');
  const archivePath = path.join(directory, 'worldbend-web.tgz');
  const reportInfo = await lstat(reportPath);
  const archiveInfo = await lstat(archivePath);
  assert(reportInfo.isFile() && !reportInfo.isSymbolicLink() && reportInfo.size > 0 && reportInfo.size <= 32768, 'Web SDK report must be a bounded regular file');
  assert(archiveInfo.isFile() && !archiveInfo.isSymbolicLink() && archiveInfo.size > 0 && archiveInfo.size <= 16 * 1024 * 1024, 'Web SDK archive must be a bounded regular file');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(report.schema, 'worldbend.web-package-observation.v0.1', 'Unknown Web SDK report');
  assert.equal(report.version, version, 'Web SDK version differs from plugin');
  assert.equal(report.archive, 'worldbend-web.tgz', 'Web SDK archive must use the installed relative name');
  assert.deepEqual(report.runtimeDependencies, [], 'Web SDK must have no runtime npm dependencies');
  assert.equal(report.archiveBytes, archiveInfo.size, 'Web SDK archive size differs from report');
  assert.equal(report.sha256, createHash('sha256').update(await readFile(archivePath)).digest('hex'), 'Web SDK archive digest differs from report');
}
