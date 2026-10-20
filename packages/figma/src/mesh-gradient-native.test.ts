import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESH_GRADIENT_NATIVE_PROFILE, MESH_GRADIENT_NATIVE_SOURCE_SHA256, MESH_GRADIENT_V1_NATIVE_PROFILE, MESH_GRADIENT_V1_NATIVE_SOURCE_SHA256 } from './mesh-gradient-resource.generated';
import { MESH_GRADIENT_LEGACY_PROFILE, MESH_GRADIENT_LEGACY_SOURCE_SHA256 } from './mesh-gradient-resource-wire';
import { BUILTIN_MESH_GRADIENT_RECIPES } from './mesh-gradient-material-wire';
import { changedMeshGradientFields, isMeshGradientMaterialWire, isMeshGradientRecipeWire, sameMeshGradientMaterial } from './mesh-gradient-wire';
import type { MeshGradientMaterialWire, MeshGradientRecipeWire } from './mesh-gradient-wire';
import { readMeshGradientNative } from './mesh-gradient-native-read';
import type { MeshGradientResourceEvidence } from './mesh-gradient-native-read';
import { applyMeshGradientNative } from './mesh-gradient-native-edit';
import { meshGradientNodeSnapshot, meshGradientNodeSnapshotFresh, applyMeshGradientMaterialEdit } from './mesh-gradient-material';

const material: MeshGradientMaterialWire = structuredClone(BUILTIN_MESH_GRADIENT_RECIPES[0]!.material);
const recipe: MeshGradientRecipeWire = { schema: 'worldbend.mesh-gradient@0.1', version: '0.1', recipeId: 'soft-fluid', recipeVersion: 1, material };
const resource: MeshGradientResourceEvidence = { importId: 'import/build', paintId: 'paint/build', sourceSha256: MESH_GRADIENT_NATIVE_SOURCE_SHA256 };
const legacy: MeshGradientResourceEvidence = { ...resource, sourceSha256: MESH_GRADIENT_LEGACY_SOURCE_SHA256 };

function fixture(id = 'node') {
  const data = new Map<string, string>(), props: Record<string, unknown> = {}, definitions: Record<string, unknown> = {};
  for (const [index, [name, value]] of Object.entries(material).entries()) {
    const key = `definition:${index}`; props[key] = structuredClone(value);
    definitions[key] = { name, type: typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'NUMBER' : 'COLOR', defaultValue: value };
  }
  const parent = { id: 'page', parent: null, removed: false, locked: false, resolvedVariableModes: {} };
  const node = {
    id, name: id, type: 'RECTANGLE', parent, removed: false, locked: false, visible: true, width: 400, height: 250,
    relativeTransform: [[1, 0, 10], [0, 1, 20]], resolvedVariableModes: { collection: 'mode-a' },
    fills: [{ type: 'SOLID', color: { r: .1, g: .1, b: .1 } },
      { type: 'SHADER', id: resource.paintId, properties: props, visible: true, opacity: .8, blendMode: 'SCREEN' },
      { type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: .1 }], effects: [{ type: 'DROP_SHADOW', radius: 4 }],
    getSharedPluginData: (_namespace: string, key: string) => data.get(key) ?? '',
    setSharedPluginData: (_namespace: string, key: string, value: string) => { data.set(key, value); },
  };
  const shader = { id: resource.importId, type: 'fill', imported: true, propertyDefinitions: definitions };
  vi.stubGlobal('figma', { listAvailableShaders: async () => [shader], variables: { getVariableByIdAsync: async () => null } });
  return { node: node as unknown as SceneNode, mutable: node, data, props, definitions, shader };
}
afterEach(() => vi.unstubAllGlobals());
function managed(f: ReturnType<typeof fixture>, evidence = resource) {
  f.data.set('meshGradientResources', JSON.stringify({ schema: 'worldbend.mesh-gradient-resources@0.1', version: '0.1', accepted: evidence, available: evidence }));
}

describe('mesh-gradient chooser wire', () => {
  it('publishes three builtin looks and compares transported RGBA by value', () => {
    expect(BUILTIN_MESH_GRADIENT_RECIPES.map(item => item.recipeId)).toEqual(['soft-fluid', 'dawn-wash', 'night-current']);
    expect(BUILTIN_MESH_GRADIENT_RECIPES.every(isMeshGradientRecipeWire)).toBe(true);
    expect(isMeshGradientMaterialWire({ ...material, durationMs: 50 })).toBe(false);
    expect(isMeshGradientRecipeWire({ ...recipe, recipeVersion: 2 ** 32 })).toBe(false);
    expect(sameMeshGradientMaterial(material, JSON.parse(JSON.stringify(material)))).toBe(true);
    const roundtrip = structuredClone(material); roundtrip.colorTl.r = Math.fround(material.colorTl.r);
    expect(changedMeshGradientFields(roundtrip, material)).toEqual([]);
    roundtrip.colorBr.a = .5;
    expect(changedMeshGradientFields(roundtrip, material)).toEqual(['color-br']);
  });
});

describe('mesh-gradient material chooser native boundary', () => {
  it('reads only source-checked identities and keeps a non-current profile from silent preset choice', async () => {
    const f = fixture();
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({ eligible: false, reason: 'unverified', live: null, canChoose: false });
    managed(f, legacy);
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({
      eligible: true, canChoose: false, canAdopt: false, profile: MESH_GRADIENT_LEGACY_PROFILE, live: material,
    });
    f.data.set('meshGradientResources', JSON.stringify({ schema: 'worldbend.mesh-gradient-resources@0.1', version: '0.1', accepted: legacy, available: resource }));
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({ canChoose: false, canAdopt: true, profile: MESH_GRADIENT_LEGACY_PROFILE });
    managed(f);
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({ canChoose: true, canAdopt: false, profile: MESH_GRADIENT_NATIVE_PROFILE });
    f.mutable.fills = [];
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({
      eligible: true, state: 'absent', live: null, canChoose: true, profile: MESH_GRADIENT_NATIVE_PROFILE,
    });
    f.data.set('meshGradientResources', 'broken');
    expect(await meshGradientNodeSnapshot(f.node)).toMatchObject({ eligible: false, reason: 'invalid', live: null });
  });
  it('edits one corner opacity across surfaces and refuses a stale selection before writing', async () => {
    const a = fixture('a'), b = fixture('b'); managed(a); managed(b);
    b.props['definition:1'] = { r: .1, g: .2, b: .3, a: .4 };
    const observed = new Map(await Promise.all([a, b].map(async f => [f.node.id, await meshGradientNodeSnapshot(f.node)] as const)));
    expect((await applyMeshGradientMaterialEdit([a.node, b.node], {
      family: 'mesh-gradient', recipe, material: { ...material, colorTl: { ...material.colorTl, a: .25 } },
      fields: ['color-tl'], colorChannels: { 'color-tl': ['a'] },
    }, observed)).ok).toBe(true);
    expect((a.mutable.fills[1] as { properties: Record<string, unknown> }).properties['definition:1']).toEqual({ ...material.colorTl, a: .25 });
    expect((b.mutable.fills[1] as { properties: Record<string, unknown> }).properties['definition:1']).toEqual({ r: .1, g: .2, b: .3, a: .25 });
    expect((b.mutable.fills[1] as { properties: Record<string, unknown> }).properties['definition:2']).toEqual(material.colorTr);
    expect(b.mutable.effects).toEqual([{ type: 'DROP_SHADOW', radius: 4 }]);
    const stale = await meshGradientNodeSnapshot(a.node);
    a.mutable.width = 410;
    expect(meshGradientNodeSnapshotFresh(stale)).toBe(false);
    const before = JSON.stringify(a.mutable.fills);
    expect(await applyMeshGradientMaterialEdit([a.node], { family: 'mesh-gradient', recipe, material, fields: ['warp'] }, new Map([['a', stale]])))
      .toMatchObject({ ok: false, error: expect.stringContaining('E_FIGMA_CONFLICT') });
    expect(JSON.stringify(a.mutable.fills)).toBe(before);
  });
  it('refuses current presets on a non-current renderer and chooses them after the current profile is live', async () => {
    const f = fixture(); managed(f, legacy);
    const current = await readMeshGradientNative(f.node, legacy);
    expect((await applyMeshGradientNative([{ node: f.node, resource: legacy, expectedState: current.expectedState }], { action: 'choose', recipe, material })))
      .toMatchObject({ ok: false, error: expect.stringContaining('explicit adoption') });
    managed(f);
    const fresh = await readMeshGradientNative(f.node, resource);
    expect((await applyMeshGradientNative([{ node: f.node, resource, expectedState: fresh.expectedState }], { action: 'choose', recipe, material })).ok).toBe(true);
    expect((await meshGradientNodeSnapshot(f.node)).provenance?.recipeId).toBe('soft-fluid');
    expect((await meshGradientNodeSnapshot(f.node)).state).toBe('tagged');
  });
  it('continues exact v1 native state and edits without silently adopting the loop renderer', async () => {
    const f=fixture(),v1={...resource,sourceSha256:MESH_GRADIENT_V1_NATIVE_SOURCE_SHA256};managed(f,v1);
    const before=await readMeshGradientNative(f.node,v1);
    expect(before).toMatchObject({profile:MESH_GRADIENT_V1_NATIVE_PROFILE,canApplyCurrentProfile:false,material});
    const snapshot=await meshGradientNodeSnapshot(f.node);
    expect((await applyMeshGradientMaterialEdit([f.node],{family:'mesh-gradient',recipe,material:{...material,warp:.8},fields:['warp']},new Map([[f.node.id,snapshot]]))).ok).toBe(true);
    expect(await readMeshGradientNative(f.node,v1)).toMatchObject({profile:MESH_GRADIENT_V1_NATIVE_PROFILE,material:{...material,warp:.8}});
    expect(JSON.parse(f.data.get('meshGradientResources')!).accepted.sourceSha256).toBe(MESH_GRADIENT_V1_NATIVE_SOURCE_SHA256);
  });
});
