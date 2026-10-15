// Probe consumer exposure and preference operations through the real MCP binary:
// exposure resolution, preference evaluation and the equal-default update.
import assert from 'node:assert/strict';
import {withAppearancePlanner} from './appearance-planner-client.mjs';
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const recipe = {
  schema: 'worldbend.appearance@0.1', version: '0.1',
  recipeId: 'consumer-probe', recipeVersion: 1,
  material: {visible: true, lightIntensity: 0.5, lightAngle: 90, refraction: 0.35, depth: 2, dispersion: 0, radius: 1},
};

await withAppearancePlanner(async run => {
  const policy = {
    schema: 'worldbend.appearance-exposure-policy@0.1', version: '0.1',
    policyRevision: 3, family: 'glass', target: 'web',
    scopes: ['hero-card'],
    exposed: [
      {field: 'visible'},
      {field: 'clarity', label: 'Clear ↔ more solid', step: 0.05},
      {field: 'radius', min: 0, max: 40, step: 1},
      {field: 'refraction'},
      {field: 'splay'},
    ],
  };
  const svg = await run('appearance_exposure', {policy, runtime: {optics: 'svg-optics'}});
  const frost = await run('appearance_exposure', {policy, runtime: {optics: 'frost-only'}});
  const states = report => Object.fromEntries(report.controls.map(row => [row.field, row.state]));
  assert.equal(states(svg).radius, 'exposed');
  assert.equal(states(svg)['light-angle'], 'not-exposed');
  assert.equal(states(svg).splay, 'unsupported');
  assert.equal(states(frost).refraction, 'adapted');
  assert.equal(svg.clarity.version, '1');
  assert.match(svg.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(svg.fingerprint, frost.fingerprint);

  const base = {recipe, material: recipe.material, target: 'web'};
  const preference = {
    schema: 'worldbend.appearance-preference@0.1', version: '0.1', revision: 4,
    fields: {'radius': {value: 1, actor: 'user'}},
  };
  const resolved = await run('appearance_preference', {base, preference});
  assert.equal(resolved.delivery.material.radius, 1);
  assert.equal(resolved.preferenceRevision, 4);
  assert.equal(resolved.receipts.length, 1);
  assert.equal(resolved.receipts[0].state, 'applied');

  // The equal-default probe end to end: next source raises radius to 5; the
  // explicit fixed value 1 survives the design update.
  const initial = await run('appearance_delivery', base);
  const next = {recipe, material: {...recipe.material, radius: 5}, target: 'web'};
  const update = await run('appearance_update', {
    previous: base, next, live: null,
    expectedFingerprint: initial.fingerprint,
    preference,
  });
  assert.equal(update.delivery.material.radius, 1);
  assert.deepEqual(update.preserved, ['radius']);
  assert.equal(update.preferenceRevision, 4);

  const both = await run('appearance_update', {
    previous: base, next, live: recipe.material,
    expectedFingerprint: initial.fingerprint,
    preference,
  }).then(() => 'accepted', error => String(error));
  assert.match(both, /not both/);

  await mkdir(path.join(root, '.task-notes/material-consumer-check'), {recursive: true});
  await writeFile(
    path.join(root, '.task-notes/material-consumer-check/mcp-probe.json'),
    JSON.stringify({svg, frost, resolved, update}, null, 2) + '\n',
  );
  console.log('appearance_exposure + appearance_preference + consumer update: verified');
});
