import { MESH_GRADIENT_NATIVE_PROFILE } from './mesh-gradient-resource.generated';
import { MESH_GRADIENT_LEGACY_PROFILE, meshGradientResourceProfile } from './mesh-gradient-resource-wire';
import type { MeshGradientResourceEvidence, MeshGradientNativeProfile } from './mesh-gradient-resource-wire';
export { meshGradientResourceProfile } from './mesh-gradient-resource-wire';
export type { MeshGradientResourceEvidence, MeshGradientNativeProfile } from './mesh-gradient-resource-wire';
import { MESH_GRADIENT_PROPERTY_FIELDS, isMeshGradientMaterialWire, isMeshGradientRecipeWire, changedMeshGradientFields } from './mesh-gradient-wire';
import type { MeshGradientMaterialWire, MeshGradientRecipeWire, MeshGradientWireField } from './mesh-gradient-wire';
import { fingerprintState } from './state-fingerprint';
import { meshGradientColorValue, meshGradientDefinitions, meshGradientPropertyType } from './mesh-gradient-native-properties';

export interface MeshGradientNativeBinding {
  field: typeof MESH_GRADIENT_PROPERTY_FIELDS[number];
  variableId: string;
  resolvedType: VariableResolvedDataType;
  value: VariableValue;
}
export interface MeshGradientNativeSnapshot {
  nodeId: string;
  name: string;
  profile: MeshGradientNativeProfile;
  /** A non-current capture is useful, but cannot silently become the current profile. */
  canApplyCurrentProfile: boolean;
  paintIndex: number | null;
  state: 'absent' | 'removed' | 'untagged-native' | 'tagged' | 'customized';
  material: MeshGradientMaterialWire | null;
  recipe: MeshGradientRecipeWire | null;
  customized: MeshGradientWireField[];
  bindings: MeshGradientNativeBinding[];
  paintModifiers: { visible: boolean; opacity: number; blendMode: string } | null;
  warnings: string[];
  resource: MeshGradientResourceEvidence;
  expectedState: string;
}
type PaintNode = SceneNode & { fills: ReadonlyArray<Paint>; resolvedVariableModes: Record<string, string> };
const proofs = new WeakMap<MeshGradientNativeSnapshot, { node: SceneNode; state: string; variables: { variable: Variable; binding: MeshGradientNativeBinding }[] }>();
function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
/** Complete native source state, including variable-mode context. This is a
 * compare-before-write token, not a cryptographic attestation of file access. */
export function meshGradientNativeState(node: SceneNode): string {
  const ancestors: unknown[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) ancestors.push({
    id: parent.id, removed: parent.removed,
    locked: 'locked' in parent ? parent.locked : null,
    modes: 'resolvedVariableModes' in parent ? parent.resolvedVariableModes : null,
  });
  return JSON.stringify({
    id: node.id, removed: node.removed, parent: node.parent?.id,
    name: node.name, width: node.width, height: node.height, locked: node.locked, visible: node.visible, ancestors,
    transform: 'relativeTransform' in node ? node.relativeTransform : null,
    fills: 'fills' in node ? node.fills : null, effects: 'effects' in node ? node.effects : null,
    modes: 'resolvedVariableModes' in node ? node.resolvedVariableModes : null,
    provenance: node.getSharedPluginData('worldbend', 'meshGradient'),
    resourceBinding: node.getSharedPluginData('worldbend', 'meshGradientResources'),
  });
}
export function assertMeshGradientSnapshotFresh(snapshot: MeshGradientNativeSnapshot): void {
  const proof = proofs.get(snapshot);
  try {
    if (!proof || meshGradientNativeState(proof.node) !== proof.state || proof.variables.some(({ variable, binding }) => {
      const now = variable.resolveForConsumer(proof.node);
      return now.resolvedType !== binding.resolvedType || JSON.stringify(now.value) !== JSON.stringify(binding.value);
    })) fail('E_FIGMA_CONFLICT', 'Mesh-gradient or its variable context changed; reread');
  } catch (error) { fail('E_FIGMA_CONFLICT', `Mesh-gradient capture is no longer current: ${String(error)}`); }
}
function capture(snapshot: Omit<MeshGradientNativeSnapshot, 'expectedState'>, node: SceneNode, state: string,
  variables: { variable: Variable; binding: MeshGradientNativeBinding }[] = []): MeshGradientNativeSnapshot {
  const result = {
    ...snapshot, expectedState: fingerprintState(JSON.stringify({
      state, profile: snapshot.profile, slot: snapshot.paintIndex, bindings: snapshot.bindings, material: snapshot.material,
    })),
  };
  proofs.set(result, {
    node, state, variables: variables.map(({ variable, binding }) => ({
      variable, binding: { ...binding, value: binding.value && typeof binding.value === 'object' ? { ...binding.value } : binding.value },
    })),
  });
  assertMeshGradientSnapshotFresh(result);
  return result;
}
function storedRecipe(node: SceneNode, resource: MeshGradientResourceEvidence): MeshGradientRecipeWire | null {
  const text = node.getSharedPluginData('worldbend', 'meshGradient');
  if (!text) return null;
  if (text.length > 32768) fail('E_FIGMA_PROVENANCE', 'Mesh-gradient provenance is too large');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('E_FIGMA_PROVENANCE', 'Mesh-gradient provenance is unreadable'); }
  if (!isRecord(parsed) || parsed['schema'] !== 'worldbend.mesh-gradient-native@0.1' ||
      parsed['version'] !== '0.1' || !isMeshGradientRecipeWire(parsed['recipe']) || !isRecord(parsed['resource']) ||
      parsed['resource']['sourceSha256'] !== resource.sourceSha256 ||
      parsed['resource']['importId'] !== resource.importId || parsed['resource']['paintId'] !== resource.paintId) {
    fail('E_FIGMA_PROVENANCE', 'Mesh-gradient provenance or renderer changed; inspect before adoption');
  }
  return parsed['recipe'];
}
export class MeshGradientNativeReadContext {
  private shaderRead: Promise<ReadonlyArray<Shader>> | undefined;
  private variables = new Map<string, Promise<Variable | null>>();
  shaders(): Promise<ReadonlyArray<Shader>> { return this.shaderRead ??= figma.listAvailableShaders(); }
  variable(id: string): Promise<Variable | null> {
    let value = this.variables.get(id);
    if (!value) { value = figma.variables.getVariableByIdAsync(id); this.variables.set(id, value); }
    return value;
  }
}
/** Read actual assignments by definition ID and resolve variable aliases in
 * this surface's context. Reads do not import resources, apply a seed or
 * replace a non-current renderer. A failed capture never becomes removal. */
export async function readMeshGradientNative(node: SceneNode, resource: MeshGradientResourceEvidence, paintIndex?: number, context = new MeshGradientNativeReadContext()): Promise<MeshGradientNativeSnapshot> {
  const rendererProfile = meshGradientResourceProfile(resource), initialState = meshGradientNativeState(node);
  if (node.removed || !('fills' in node) || !Array.isArray(node.fills)) fail('E_FIGMA_SOURCE', 'Mesh-gradient needs one live surface with readable fills');
  const surface = node as PaintNode;
  const stored = storedRecipe(node, resource);
  const paints = surface.fills;
  const matching = paints.flatMap((paint, index) => paint.type === 'SHADER' &&
    (paint.id === resource.paintId || paint.id === resource.importId) ? [index] : []);
  if (paintIndex !== undefined && (!Number.isInteger(paintIndex) || paintIndex < 0 || !matching.includes(paintIndex))) fail('E_FIGMA_SOURCE', 'The requested mesh-gradient paint slot changed');
  if (paintIndex === undefined && matching.length > 1) fail('E_FIGMA_AMBIGUOUS', 'Select the mesh-gradient paint slot; multiple matching fills exist');
  const slot = paintIndex ?? matching[0] ?? null;
  const warnings: string[] = rendererProfile === MESH_GRADIENT_NATIVE_PROFILE ? [] : ['explicit-renderer-adoption-required'];
  if (rendererProfile === MESH_GRADIENT_LEGACY_PROFILE) warnings.unshift('legacy-renderer');
  const recipe = matching.length > 1 ? null : stored;
  if (stored && matching.length > 1) warnings.push('seed-provenance-ambiguous');
  const base = {
    nodeId: node.id, name: node.name, profile: rendererProfile, canApplyCurrentProfile: rendererProfile === MESH_GRADIENT_NATIVE_PROFILE,
    recipe, customized: [] as MeshGradientWireField[], bindings: [] as MeshGradientNativeBinding[], resource: { ...resource }, warnings,
  };
  if (slot === null) return capture({ ...base, paintIndex: null, state: recipe ? 'removed' : 'absent', material: null, paintModifiers: null }, node, initialState);
  const shader = (await context.shaders()).find(candidate => candidate.id === resource.importId);
  if (!shader || shader.type !== 'fill' || !shader.imported || !shader.propertyDefinitions) {
    fail('E_FIGMA_RESOURCE', 'The exact mesh-gradient build is not available with readable definitions; acquire it before capture');
  }
  const paint = paints[slot] as ShaderPaint;
  const definitions = meshGradientDefinitions(shader);
  const resolved: Record<string, unknown> = {};
  const variables: { field: typeof MESH_GRADIENT_PROPERTY_FIELDS[number]; variable: Variable; binding: MeshGradientNativeBinding }[] = [];
  for (const field of MESH_GRADIENT_PROPERTY_FIELDS) {
    const expectedType = meshGradientPropertyType(field), id = definitions[field];
    if (!paint.properties || !Object.hasOwn(paint.properties, id)) fail('E_FIGMA_SOURCE', `Mesh-gradient ${field} assignment is unreadable`);
    let value: unknown = paint.properties[id];
    if (isRecord(value) && value['type'] === 'VARIABLE_ALIAS') {
      if (typeof value['id'] !== 'string') fail('E_FIGMA_SOURCE', `Mesh-gradient ${field} variable binding is invalid`);
      const variable = await context.variable(value['id']);
      if (!variable) fail('E_FIGMA_SOURCE', `Mesh-gradient ${field} variable is unavailable`);
      const result = variable.resolveForConsumer(surface);
      const binding = {
        field, variableId: variable.id, resolvedType: result.resolvedType,
        value: result.value && typeof result.value === 'object' ? { ...result.value } : result.value,
      };
      const requiredType = expectedType === 'NUMBER' ? 'FLOAT' : expectedType;
      if (result.resolvedType !== requiredType) fail('E_FIGMA_SOURCE', `Mesh-gradient ${field} variable has an incompatible type`);
      variables.push({ field, variable, binding }); value = result.value;
    }
    value = meshGradientColorValue(field, value);
    resolved[field] = value && typeof value === 'object' ? { ...value } : value;
  }
  if (!isMeshGradientMaterialWire(resolved)) fail('E_FIGMA_SOURCE', 'Current mesh-gradient parameters are invalid; no values were guessed or clamped');
  if (meshGradientNativeState(node) !== initialState || variables.some(({ variable, binding }) => {
    const now = variable.resolveForConsumer(surface);
    return now.resolvedType !== binding.resolvedType || JSON.stringify(now.value) !== JSON.stringify(binding.value);
  })) fail('E_FIGMA_CONFLICT', 'Mesh-gradient or its variable context changed during capture; reread');
  const opacity = paint.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail('E_FIGMA_SOURCE', 'Mesh-gradient paint opacity is invalid');
  const modifiers = { visible: paint.visible !== false, opacity, blendMode: paint.blendMode ?? 'NORMAL' };
  if (!modifiers.visible || modifiers.opacity !== 1 || modifiers.blendMode !== 'NORMAL') warnings.push('paint-composition-separate-from-material');
  const customized = recipe ? changedMeshGradientFields(resolved, recipe.material) : [];
  return capture({
    ...base, paintIndex: slot, material: resolved, bindings: variables.map(item => item.binding), paintModifiers: modifiers, customized,
    state: recipe ? customized.length ? 'customized' : 'tagged' : 'untagged-native',
  }, node, initialState, variables);
}
