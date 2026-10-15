import { MESH_GRADIENT_PROPERTY_FIELDS, isMeshGradientMaterialWire } from './mesh-gradient-wire';
import type { MeshGradientMaterialWire } from './mesh-gradient-wire';
import { meshGradientNativeState, meshGradientResourceProfile } from './mesh-gradient-native-read';
import type { MeshGradientResourceEvidence } from './mesh-gradient-native-read';
import { fingerprintState } from './state-fingerprint';
import { meshGradientColorValue, meshGradientDefinitions } from './mesh-gradient-native-properties';

export interface MeshGradientSourceIdentity { importId: string; sourceSha256: string }
/** Available means acquired; accepted identifies the actually adopted renderer.
 * Merely acquiring a newer build does not change artwork or seed provenance. */
export interface MeshGradientResourceBinding {
  schema: 'worldbend.mesh-gradient-resources@0.1'; version: '0.1';
  accepted: MeshGradientResourceEvidence | null;
  available: MeshGradientResourceEvidence;
}
export function readMeshGradientResourceBinding(node: SceneNode): MeshGradientResourceBinding | null {
  const text = node.getSharedPluginData('worldbend', 'meshGradientResources');
  if (!text) return null;
  if (text.length > 4096) throw Error('E_FIGMA_PROVENANCE: Mesh-gradient resource record is too large');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error('E_FIGMA_PROVENANCE: Mesh-gradient resource record is unreadable'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('E_FIGMA_PROVENANCE: Invalid mesh-gradient resource record');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || record['schema'] !== 'worldbend.mesh-gradient-resources@0.1' || record['version'] !== '0.1')
    throw Error('E_FIGMA_PROVENANCE: Invalid mesh-gradient resource record');
  const binding = value as MeshGradientResourceBinding;
  meshGradientResourceProfile(binding.available);
  if (binding.accepted !== null) meshGradientResourceProfile(binding.accepted);
  return binding;
}
export function meshGradientResourceExpected(node: SceneNode): string { return fingerprintState(meshGradientNativeState(node)); }
export function sameMeshGradientResource(a: MeshGradientResourceEvidence, b: MeshGradientResourceEvidence): boolean {
  return a.importId === b.importId && a.paintId === b.paintId && a.sourceSha256 === b.sourceSha256;
}
/** Import an exact, source-checked build and observe its actual native paint
 * identity. An owned, short-lived probe establishes the alias; no name/hash-tail
 * inference. Acquisition never applies a material to the user's surface. */
export async function acquireMeshGradientNativeResource(node: SceneNode, source: MeshGradientSourceIdentity,
  expected: string, assertScope: () => void = () => {}, repairRecord = false): Promise<MeshGradientResourceBinding> {
  const identity = { ...source };
  meshGradientResourceProfile({ ...identity, paintId: identity.importId });
  assertScope();
  const initial = meshGradientNativeState(node);
  if (fingerprintState(initial) !== expected) throw Error('E_FIGMA_CONFLICT: Surface changed before mesh-gradient acquisition');
  let previous: MeshGradientResourceBinding | null;
  try { previous = readMeshGradientResourceBinding(node); } catch (error) { if (!repairRecord) throw error; previous = null; }
  if (node.removed || !('fills' in node) || !Array.isArray(node.fills)) throw Error('E_FIGMA_SOURCE: Acquire mesh-gradient for a live fill-capable surface');
  for (let parent: BaseNode | null = node; parent; parent = parent.parent)
    if ('locked' in parent && parent.locked) throw Error('E_FIGMA_SOURCE: The surface or its container is locked');
  let shader = (await figma.listAvailableShaders()).find(candidate => candidate.id === identity.importId && candidate.imported);
  assertScope();
  if (meshGradientNativeState(node) !== initial) throw Error('E_FIGMA_CONFLICT: Surface changed during mesh-gradient acquisition');
  if (!shader) shader = await figma.importShaderById(identity.importId);
  assertScope();
  if (meshGradientNativeState(node) !== initial) throw Error('E_FIGMA_CONFLICT: Surface changed during mesh-gradient acquisition');
  if (shader.id !== identity.importId || shader.type !== 'fill' || !shader.imported || !shader.propertyDefinitions)
    throw Error('E_FIGMA_RESOURCE: The exact mesh-gradient fill build is unavailable');
  const properties: Record<string, ShaderPropertyValue> = {}, values: Record<string, unknown> = {};
  const mapping = meshGradientDefinitions(shader);
  for (const field of MESH_GRADIENT_PROPERTY_FIELDS) {
    const id = mapping[field], definition = shader.propertyDefinitions[id]!;
    if (definition.defaultValue === undefined) throw Error(`E_FIGMA_RESOURCE: Unreadable mesh-gradient ${field} default`);
    const value = meshGradientColorValue(field, definition.defaultValue);
    values[field] = value; properties[id] = value as ShaderPropertyValue;
  }
  if (!isMeshGradientMaterialWire(values)) throw Error('E_FIGMA_RESOURCE: Mesh-gradient defaults do not satisfy its profile');
  const probe = figma.createRectangle();
  let evidence: MeshGradientResourceEvidence;
  try {
    probe.name = 'Worldbend mesh-gradient acquisition probe'; probe.visible = false;
    probe.fills = [{ type: 'SHADER', id: identity.importId, properties }];
    const paint = Array.isArray(probe.fills) && probe.fills.length === 1 ? probe.fills[0] : undefined;
    if (!paint || paint.type !== 'SHADER') throw Error('E_FIGMA_RESOURCE: Mesh-gradient could not produce a native paint');
    evidence = { ...identity, paintId: paint.id };
    meshGradientResourceProfile(evidence);
  } finally { if (!probe.removed) probe.remove(); }
  assertScope();
  if (meshGradientNativeState(node) !== initial) throw Error('E_FIGMA_CONFLICT: Surface changed during mesh-gradient acquisition');
  const matches = (node as SceneNode & { fills: ReadonlyArray<Paint> }).fills.some(paint => paint.type === 'SHADER' &&
    (paint.id === evidence.paintId || paint.id === evidence.importId));
  const binding: MeshGradientResourceBinding = {
    schema: 'worldbend.mesh-gradient-resources@0.1', version: '0.1',
    accepted: matches ? evidence : previous?.accepted ?? null, available: evidence,
  };
  const before = node.getSharedPluginData('worldbend', 'meshGradientResources');
  try { node.setSharedPluginData('worldbend', 'meshGradientResources', JSON.stringify(binding)); }
  catch (error) {
    try { node.setSharedPluginData('worldbend', 'meshGradientResources', before); } catch { throw Error(`E_FIGMA_ROLLBACK: Mesh-gradient resource record could not be restored on ${node.id}: ${String(error)}`); }
    throw error;
  }
  return binding;
}
/** Preserve an alias during adoption only when the requested current value
 * still equals the captured resolved value. Explicit edits become literals. */
export function meshGradientAdoptionValue(name: typeof MESH_GRADIENT_PROPERTY_FIELDS[number], desired: MeshGradientMaterialWire,
  live: MeshGradientMaterialWire, assignment: ShaderPropertyValue | undefined): ShaderPropertyValue {
  const value = desired[name], current = live[name];
  const equal = typeof value === 'object' && typeof current === 'object'
    ? (['r','g','b','a'] as const).every(key => value[key] === current[key] || Math.fround(value[key]) === current[key])
    : value === current || (typeof value === 'number' && typeof current === 'number' && Math.fround(value) === current);
  if (equal && assignment && typeof assignment === 'object' && 'type' in assignment && assignment.type === 'VARIABLE_ALIAS') return { ...assignment };
  return typeof value === 'object' ? { ...value } : value;
}
