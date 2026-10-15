import { afterEach, expect, it, vi } from 'vitest';
import { editMeshGradient, readMeshGradient } from './agent-mesh-gradient';
import { MESH_GRADIENT_NATIVE_SOURCE_SHA256 } from './mesh-gradient-resource.generated';
import { BUILTIN_MESH_GRADIENT_RECIPES } from './mesh-gradient-material-wire';
const resource = { importId: 'shader/build', paintId: 'paint/build', sourceSha256: MESH_GRADIENT_NATIVE_SOURCE_SHA256 };
const material = structuredClone(BUILTIN_MESH_GRADIENT_RECIPES[0]!.material);
function fixture() {
  const page = { id: 'page', type: 'PAGE', removed: false, parent: null };
  const props: Record<string, unknown> = {}, definitions: Record<string, unknown> = {};
  Object.entries(material).forEach(([name, value], index) => { props[`${index}`] = value; definitions[`${index}`] = { name, type: typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'NUMBER' : 'COLOR' }; });
  const node = {
    id: 'node', name: 'mesh', parent: page, type: 'RECTANGLE', removed: false, visible: true, locked: false, width: 400, height: 300,
    resolvedVariableModes: {}, fills: [{ type: 'SHADER', id: resource.paintId, properties: props }], effects: [],
    getSharedPluginData: () => '', setSharedPluginData: vi.fn(),
  };
  const api = {
    fileKey: 'file', currentPage: page, getNodeByIdAsync: vi.fn(async () => node),
    listAvailableShaders: async () => [{ id: resource.importId, type: 'fill', imported: true, propertyDefinitions: definitions }],
  };
  vi.stubGlobal('figma', api);
  return { api, node, input: { fileKey: 'file', pageId: 'page', nodeId: 'node', resource } };
}
afterEach(() => vi.unstubAllGlobals());
it('returns a mutation receipt without rereading and rechecks the granted page', async () => {
  const { api, node, input } = fixture();
  const state = JSON.parse((await readMeshGradient(input)).json);
  expect(state.material).toEqual(material);
  const result = await editMeshGradient({ ...input, expectedState: state.expectedState, change: { action: 'edit', material: { ...material, warp: .2 }, fields: ['warp'] } });
  expect(result).toMatchObject({ ok: true, nextAction: 'read-current-native-state' });
  expect((node.fills[0] as { properties: Record<string, unknown> }).properties[Object.keys(material).indexOf('warp').toString()]).toBe(.2);
  api.getNodeByIdAsync = vi.fn(async () => { api.fileKey = 'other'; return node; });
  await expect(readMeshGradient(input)).rejects.toThrow('E_FIGMA_SCOPE');
});
