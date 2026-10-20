import { afterEach, expect, it, vi } from 'vitest';
import { MESH_GRADIENT_NATIVE_SOURCE_SHA256 } from './mesh-gradient-resource.generated';
import { MESH_GRADIENT_LEGACY_PROFILE, MESH_GRADIENT_LEGACY_SOURCE_SHA256 } from './mesh-gradient-resource-wire';
import { acquireMeshGradientNativeResource, meshGradientResourceExpected, readMeshGradientResourceBinding } from './mesh-gradient-native-resource';
import { readMeshGradientNative } from './mesh-gradient-native-read';
import { applyMeshGradientNative } from './mesh-gradient-native-edit';
import type { MeshGradientMaterialWire, MeshGradientRecipeWire } from './mesh-gradient-wire';
import { BUILTIN_MESH_GRADIENT_RECIPES } from './mesh-gradient-material-wire';

const material: MeshGradientMaterialWire = structuredClone(BUILTIN_MESH_GRADIENT_RECIPES[0]!.material);
const recipe: MeshGradientRecipeWire = { ...BUILTIN_MESH_GRADIENT_RECIPES[0]!, recipeId: 'mesh-next' };
const old = { importId: 'old/build', paintId: 'observed-old/build', sourceSha256: MESH_GRADIENT_LEGACY_SOURCE_SHA256 };
const next = { importId: 'next/build', paintId: 'observed-next/build', sourceSha256: MESH_GRADIENT_NATIVE_SOURCE_SHA256 };
function definitions(prefix: string) {
  return Object.fromEntries(Object.entries(material).map(([name, value], index) => [prefix + index, {
    name, type: typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'NUMBER' : 'COLOR', defaultValue: value,
  }]));
}
function idNamed(defs: Record<string, { name: string }>, name: string) {
  return Object.entries(defs).find(([, definition]) => definition.name === name)![0];
}
function fixture() {
  const data = new Map<string, string>(), oldDefinitions = definitions('p'), nextDefinitions = definitions('q');
  const props = Object.fromEntries(Object.entries(material).map(([, value], index) => ['p' + index, structuredClone(value)]));
  const page = { id: 'page', type: 'PAGE', parent: null, removed: false, locked: false, resolvedVariableModes: {} };
  const node = {
    id: 'node', name: 'Native', parent: page, removed: false, visible: true, locked: false, width: 400, height: 300, type: 'RECTANGLE',
    resolvedVariableModes: {}, relativeTransform: [[1, 0, 0], [0, 1, 0]], effects: [{ type: 'DROP_SHADOW', radius: 4 }],
    fills: [{ type: 'SHADER', id: old.paintId, properties: props, opacity: .6, visible: true, blendMode: 'SCREEN' },
      { type: 'SOLID', color: { r: .1, g: .2, b: .3 } }],
    getSharedPluginData: (_ns: string, key: string) => data.get(key) ?? '',
    setSharedPluginData: (_ns: string, key: string, value: string) => { data.set(key, value); },
  };
  const oldShader = { id: old.importId, type: 'fill', imported: true, propertyDefinitions: oldDefinitions };
  const nextShader = { id: next.importId, type: 'fill', imported: false, propertyDefinitions: nextDefinitions };
  const probes: { removed: boolean; visible: boolean; name: string; fills: unknown[]; remove: () => void }[] = [];
  const api = {
    listAvailableShaders: vi.fn(async () => [oldShader, nextShader]),
    importShaderById: vi.fn(async (id: string) => { expect(id).toBe(next.importId); nextShader.imported = true; return nextShader; }),
    createRectangle: vi.fn(() => {
      let paints: unknown[] = [];
      const probe = {
        removed: false, visible: true, name: 'probe', get fills() { return paints; }, set fills(value: unknown[]) {
          paints = value.map(paint => ({ ...(paint as object), id: (paint as { id: string }).id === next.importId ? next.paintId : old.paintId }));
        },
        remove() { probe.removed = true; },
      };
      probes.push(probe); return probe;
    }), variables: { getVariableByIdAsync: vi.fn(async () => null as unknown) },
  };
  vi.stubGlobal('figma', api);
  return { node: node as unknown as SceneNode, mutable: node, data, api, probes, nextShader, oldShader, props, oldDefinitions, nextDefinitions };
}
afterEach(() => vi.unstubAllGlobals());

it('observes native aliases with an owned probe and keeps the accepted renderer until explicit adoption', async () => {
  const f = fixture();
  f.data.set('meshGradientResources', JSON.stringify({ schema: 'worldbend.mesh-gradient-resources@0.1', version: '0.1', accepted: old, available: old }));
  const before = JSON.stringify({ fills: f.mutable.fills, effects: f.mutable.effects });
  const result = await acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, meshGradientResourceExpected(f.node));
  expect(result.accepted).toEqual(old); expect(result.available).toEqual(next);
  expect(JSON.stringify({ fills: f.mutable.fills, effects: f.mutable.effects })).toBe(before);
  expect(f.api.importShaderById).toHaveBeenCalledExactlyOnceWith(next.importId);
  expect(f.probes).toHaveLength(1); expect(f.probes[0]).toMatchObject({ removed: true, visible: false, name: 'Worldbend mesh-gradient acquisition probe' });
  expect(readMeshGradientResourceBinding(f.node)).toEqual(result);
  expect((await readMeshGradientNative(f.node, old)).profile).toBe(MESH_GRADIENT_LEGACY_PROFILE);
  await expect(acquireMeshGradientNativeResource(f.node, { importId: 'other', sourceSha256: 'sha256:' + 'ab'.repeat(32) }, meshGradientResourceExpected(f.node))).rejects.toThrow('E_FIGMA_RESOURCE');
});
it('checks scope before import and removes a failed owned probe', async () => {
  const f = fixture(), expected = meshGradientResourceExpected(f.node);
  f.api.listAvailableShaders.mockImplementation(async () => { f.mutable.width = 410; return [f.oldShader, f.nextShader]; });
  await expect(acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, expected)).rejects.toThrow('E_FIGMA_CONFLICT');
  expect(f.api.importShaderById).not.toHaveBeenCalled(); expect(f.probes).toHaveLength(0);
});
it('refuses unreadable defaults and rolls back a resource record that throws after writing', async () => {
  const f = fixture();
  delete f.nextShader.propertyDefinitions[idNamed(f.nextDefinitions, 'warp')]!.defaultValue;
  await expect(acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, meshGradientResourceExpected(f.node))).rejects.toThrow('default');
  expect(f.probes).toHaveLength(0); expect(f.data.size).toBe(0);
  f.nextShader.propertyDefinitions[idNamed(f.nextDefinitions, 'warp')]!.defaultValue = material.warp;
  const set = f.mutable.setSharedPluginData; let fail = true;
  f.mutable.setSharedPluginData = (ns, key, value) => { set(ns, key, value); if (fail) { fail = false; throw Error('record'); } };
  await expect(acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, meshGradientResourceExpected(f.node))).rejects.toThrow('record');
  expect(f.data.get('meshGradientResources')).toBe('');
  expect(f.probes.every(probe => probe.removed)).toBe(true);
});
it('requires acquisition then explicit adoption and remaps definition ids without dropping aliases', async () => {
  const f = fixture();
  const tint = idNamed(f.oldDefinitions, 'colorTl'), flow = idNamed(f.oldDefinitions, 'flowSpeed'), softness = idNamed(f.oldDefinitions, 'softness');
  f.props[tint] = { type: 'VARIABLE_ALIAS', id: 'tint' };
  f.props[flow] = { type: 'VARIABLE_ALIAS', id: 'flow' };
  f.api.variables.getVariableByIdAsync.mockImplementation(async (id?: string) => ({
    id, resolveForConsumer: () => id === 'tint' ? { resolvedType: 'COLOR', value: material.colorTl } : { resolvedType: 'FLOAT', value: .2 },
  }));
  const before = await readMeshGradientNative(f.node, old), desired = { ...before.material!, softness: .2 };
  expect((await applyMeshGradientNative([{ node: f.node, resource: old, expectedState: before.expectedState }], { action: 'adopt', resource: next, material: desired, recipe })))
    .toMatchObject({ ok: false, error: expect.stringContaining('Acquire') });
  await acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, meshGradientResourceExpected(f.node));
  const fresh = await readMeshGradientNative(f.node, old);
  const extras = structuredClone({ fill: f.mutable.fills[1], effects: f.mutable.effects });
  expect((await applyMeshGradientNative([{ node: f.node, resource: old, expectedState: fresh.expectedState }], { action: 'adopt', resource: next, material: desired, recipe })).ok).toBe(true);
  const paint = f.mutable.fills[0] as { id: string; opacity: number; blendMode: string; properties: Record<string, unknown> };
  expect(paint.id).toBe(next.importId);
  expect(paint.opacity).toBe(.6); expect(paint.blendMode).toBe('SCREEN');
  expect(paint.properties[idNamed(f.nextDefinitions, 'colorTl')]).toEqual({ type: 'VARIABLE_ALIAS', id: 'tint' });
  expect(paint.properties[idNamed(f.nextDefinitions, 'flowSpeed')]).toEqual({ type: 'VARIABLE_ALIAS', id: 'flow' });
  expect(paint.properties[idNamed(f.nextDefinitions, 'softness')]).toBe(.2);
  expect(Object.keys(paint.properties).some(key => key.startsWith('p'))).toBe(false);
  expect({ fill: f.mutable.fills[1], effects: f.mutable.effects }).toEqual(extras);
  expect(readMeshGradientResourceBinding(f.node)?.accepted).toEqual(next);
  expect(softness).toBeTruthy();
});
it('refuses to drop extra native assignments during adoption', async () => {
  const f = fixture();
  await acquireMeshGradientNativeResource(f.node, { importId: next.importId, sourceSha256: next.sourceSha256 }, meshGradientResourceExpected(f.node));
  f.props.extra = 17;
  const current = await readMeshGradientNative(f.node, old), before = JSON.stringify(f.mutable.fills);
  expect((await applyMeshGradientNative([{ node: f.node, resource: old, expectedState: current.expectedState }], { action: 'adopt', resource: next, material: current.material!, recipe })))
    .toMatchObject({ ok: false, error: expect.stringContaining('Extra native') });
  expect(JSON.stringify(f.mutable.fills)).toBe(before);
});
it('repairs a damaged resource record only through explicit reacquisition', async () => {
  const f = fixture(); f.data.set('meshGradientResources', 'damaged');
  expect(() => readMeshGradientResourceBinding(f.node)).toThrow('unreadable');
  const expected = meshGradientResourceExpected(f.node), before = JSON.stringify(f.mutable.fills);
  await expect(acquireMeshGradientNativeResource(f.node, { importId: old.importId, sourceSha256: old.sourceSha256 }, expected)).rejects.toThrow('unreadable');
  expect(f.api.createRectangle).not.toHaveBeenCalled();
  const result = await acquireMeshGradientNativeResource(f.node, { importId: old.importId, sourceSha256: old.sourceSha256 }, expected, () => {}, true);
  expect(result.accepted).toEqual(old); expect(JSON.stringify(f.mutable.fills)).toBe(before);
});
