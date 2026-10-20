// Generate canonical receipts that pin the Web local evaluation mirror
// (packages/web/src/appearance-local.ts) to the real core compile. Run with
// --check in CI-style flows to fail on drift instead of silently regenerating.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'packages/web/src/generated/appearance-parity.json');

const recipe = {
  schema: 'worldbend.appearance@0.1', version: '0.1',
  recipeId: 'parity-seed', recipeVersion: 2,
  material: {visible: true, lightIntensity: 0.5, lightAngle: 90, refraction: 0.35, depth: 2, dispersion: 0, radius: 12},
};

const materials = [
  recipe.material,
  {...recipe.material, visible: false},
  {...recipe.material, radius: 0},
  {...recipe.material, radius: 1000},
  {...recipe.material, radius: 0.4},
  {...recipe.material, radius: 0.00001},
  {...recipe.material, radius: 0.000001},
  {...recipe.material, radius: 9.9e-7},
  {...recipe.material, radius: 1.5e-6},
  {...recipe.material, radius: 24.68, depth: 1},
  {...recipe.material, depth: 10},
  {...recipe.material, depth: 20},
  {...recipe.material, depth: 100},
  {...recipe.material, depth: 1000},
  {...recipe.material, depth: 55.55},
  {...recipe.material, refraction: 1, depth: 10, dispersion: 1},
  {...recipe.material, refraction: 0.35, dispersion: 1},
  {...recipe.material, refraction: 0, dispersion: 0.5, depth: 7.5},
  {...recipe.material, lightIntensity: 0},
  {...recipe.material, lightIntensity: 1, refraction: 0},
  {...recipe.material, lightIntensity: 0.575},
  {...recipe.material, lightIntensity: 0.0575, lightAngle: 90},
  {...recipe.material, lightAngle: 0, refraction: 0},
  {...recipe.material, lightAngle: 45, refraction: 0.4},
  {...recipe.material, lightAngle: 180, refraction: 0},
  {...recipe.material, lightAngle: 270, refraction: 0.6, dispersion: 0.2},
  {...recipe.material, lightAngle: 359.9, refraction: 0},
  {...recipe.material, lightAngle: 137.777},
  {...recipe.material, lightAngle: 66.5, lightIntensity: 0.62, radius: 24.68, depth: 33.3, refraction: 0.77, dispersion: 0.31},
];

const policy = {
  schema: 'worldbend.appearance-exposure-policy@0.1', version: '0.1',
  policyRevision: 5, family: 'glass', target: 'web',
  scopes: ['parity'],
  exposed: [{field: 'radius', min: 0, max: 40, step: 1}, {field: 'clarity'}, {field: 'visible'}],
};

export async function generateAppearanceParity({check = false} = {}) {
  return withAppearancePlanner(async run => {
    const plans = [];
    for (const material of materials) {
      const plan = await run('appearance_delivery', {recipe, material, target: 'web'});
      plans.push({material, plan});
    }
    for (const material of [recipe.material, {...recipe.material,visible:false},
      {...recipe.material,radius:0,refraction:1,depth:100},
      {...recipe.material,radius:1000,dispersion:1},
      {...recipe.material,lightAngle:137.777,refraction:0.77,dispersion:0.31}]) {
      const plan = await run('appearance_delivery', {recipe, material, target:'web-color-preserving'});
      plans.push({material,plan});
    }
    const preference = {
      schema: 'worldbend.appearance-preference@0.1', version: '0.1', revision: 6,
      fields: {
        radius: {value: 1, actor: 'user'},
        'light-intensity': {value: 0.9, actor: 'agent'},
        // depth is not exposed by the policy above: stays saved, not effective.
        depth: {value: 60, actor: 'user'},
      },
    };
    const base = {recipe, material: recipe.material, target: 'web'};
    const resolvedNoPolicy = await run('appearance_preference', {base, preference});
    const resolvedWithPolicy = await run('appearance_preference', {base, preference, policy});
    const exposure = await run('appearance_exposure', {policy, runtime: {optics: 'svg-optics'}});
    const colorPolicy={...policy,target:'web-color-preserving'};
    const colorExposure=await run('appearance_exposure',{policy:colorPolicy,runtime:{optics:'svg-optics'}});
    const colorPreference=await run('appearance_preference',{base:{...base,target:'web-color-preserving'},preference,policy:colorPolicy});
    const fixture = {
      schema: 'worldbend.appearance-parity@1',
      recipe,
      policy,
      plans,
      preference,
      resolvedNoPolicy,
      resolvedWithPolicy,
      exposure,
      colorExposure,
      colorPreference,
    };
    const text = JSON.stringify(fixture, null, 2) + '\n';
    if (check) {
      assertAppearanceReceiptMatches(await readFile(output, 'utf8'), fixture, 'Stale appearance parity fixture; regenerate with scripts/generate-appearance-parity.mjs');
    } else {
      await mkdir(path.dirname(output), {recursive: true});
      await writeFile(output, text);
    }
    return fixture;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === pathURL()) {
  await generateAppearanceParity({check: process.argv.includes('--check')});
  console.log('Appearance parity fixture ' + (process.argv.includes('--check') ? 'matches' : 'generated'));
}
function pathURL() { return fileURLToPath(import.meta.url); }
