import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishImmutableArtifact } from './immutable-artifact.mjs';

for (const scenario of ['identical', 'modified', 'symlink']) {
  test(`immutable artifact publication: ${scenario}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'worldbend-artifact-'));
    const staged = path.join(root, 'stage'), output = path.join(root, 'output');
    const prepare = async () => { await mkdir(staged); await writeFile(path.join(staged, 'sdk.tgz'), 'verified bytes'); };
    try {
      await prepare(); await publishImmutableArtifact(staged, output); await prepare();
      if (scenario === 'identical') {
        await publishImmutableArtifact(staged, output);
        await assert.rejects(readFile(path.join(staged, 'sdk.tgz')), { code: 'ENOENT' });
      } else {
        if (scenario === 'modified') await writeFile(path.join(output, 'sdk.tgz'), 'owner modification');
        else await symlink('sdk.tgz', path.join(output, 'unexpected-link'));
        await assert.rejects(publishImmutableArtifact(staged, output), /preserved|nonregular/);
        assert.equal(await readFile(path.join(staged, 'sdk.tgz'), 'utf8'), 'verified bytes');
      }
      assert.equal(await readFile(path.join(output, 'sdk.tgz'), 'utf8'), scenario === 'modified' ? 'owner modification' : 'verified bytes');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
