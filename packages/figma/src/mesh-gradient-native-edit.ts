import { MESH_GRADIENT_NATIVE_PROFILE } from './mesh-gradient-resource.generated';
import { MESH_GRADIENT_WIRE_FIELDS, isMeshGradientMaterialWire, isMeshGradientRecipeWire, meshGradientProperty } from './mesh-gradient-wire';
import type { MeshGradientColorChannels } from './mesh-gradient-material-wire';
import type { MeshGradientMaterialWire, MeshGradientRecipeWire, MeshGradientWireField } from './mesh-gradient-wire';
import { assertMeshGradientSnapshotFresh, readMeshGradientNative, MeshGradientNativeReadContext } from './mesh-gradient-native-read';
import type { MeshGradientNativeSnapshot, MeshGradientResourceEvidence } from './mesh-gradient-native-read';
import { meshGradientResourceProfile } from './mesh-gradient-native-read';
import { meshGradientDefinitions } from './mesh-gradient-native-properties';
import { meshGradientAdoptionValue, readMeshGradientResourceBinding, sameMeshGradientResource } from './mesh-gradient-native-resource';

const COLOR_FIELDS = ['color-tl','color-tr','color-bl','color-br'] as const;
export type MeshGradientNativeChange =
  | { action: 'edit'; material: MeshGradientMaterialWire; fields: MeshGradientWireField[] }
  | { action: 'choose'; material: MeshGradientMaterialWire; recipe: MeshGradientRecipeWire }
  | { action: 'adopt'; material: MeshGradientMaterialWire; recipe: MeshGradientRecipeWire; resource: MeshGradientResourceEvidence }
  | { action: 'remove' };
export interface MeshGradientNativeTarget {
  node: SceneNode; resource: MeshGradientResourceEvidence; expectedState: string; paintIndex?: number; colorChannels?: MeshGradientColorChannels;
}
export interface MeshGradientNativeOutcome { nodeId: string; outcome: 'applied' | 'removed' }
export type MeshGradientNativeResult = { ok: true; outcomes: MeshGradientNativeOutcome[] } |
  { ok: false; error: string; unrestoredNodeIds: string[] };
type FillNode = SceneNode & { fills: ReadonlyArray<Paint> };
export function isMeshGradientNativeChange(value: unknown): value is MeshGradientNativeChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const change = value as Record<string, unknown>, keys = Object.keys(change);
  if (change['action'] === 'remove') return keys.length === 1;
  if (!isMeshGradientMaterialWire(change['material'])) return false;
  if (change['action'] === 'choose') return keys.length === 3 && isMeshGradientRecipeWire(change['recipe']);
  if (change['action'] === 'adopt') {
    try { return keys.length === 4 && isMeshGradientRecipeWire(change['recipe']) && meshGradientResourceProfile(change['resource'] as MeshGradientResourceEvidence) === MESH_GRADIENT_NATIVE_PROFILE; }
    catch { return false; }
  }
  return change['action'] === 'edit' && keys.length === 3 && Array.isArray(change['fields']) &&
    change['fields'].length > 0 && change['fields'].length <= MESH_GRADIENT_WIRE_FIELDS.length &&
    new Set(change['fields']).size === change['fields'].length &&
    change['fields'].every(field => (MESH_GRADIENT_WIRE_FIELDS as readonly unknown[]).includes(field));
}
function unlocked(node: SceneNode): boolean {
  for (let current: BaseNode | null = node; current; current = current.parent)
    if (current.removed || ('locked' in current && current.locked)) return false;
  return true;
}
function colorProperty(field: string): 'colorTl' | 'colorTr' | 'colorBl' | 'colorBr' | null {
  if (field === 'color-tl') return 'colorTl';
  if (field === 'color-tr') return 'colorTr';
  if (field === 'color-bl') return 'colorBl';
  if (field === 'color-br') return 'colorBr';
  return null;
}
/** Resource acquisition and source verification precede this operation. All
 * asynchronous captures finish before the single synchronous write section.
 * Selective edits preserve unselected aliases, extra properties, composition,
 * other fills/effects and seed provenance. A non-current renderer is never upgraded. */
export async function applyMeshGradientNative(targets: readonly MeshGradientNativeTarget[], change: MeshGradientNativeChange,
  assertScope: () => void = () => {}, beforeWrite: () => void = () => {}): Promise<MeshGradientNativeResult> {
  const backups: { node: FillNode; fills: ReadonlyArray<Paint>; provenance: string; resources: string }[] = [];
  try {
    if (!isMeshGradientNativeChange(change) || !targets.length || targets.length > 48 ||
      new Set(targets.map(target => target.node.id)).size !== targets.length) throw Error('E_SCHEMA: Invalid mesh-gradient edit or target selection');
    change = JSON.parse(JSON.stringify(change)) as MeshGradientNativeChange;
    targets = targets.map(target => ({ ...target, resource: { ...target.resource }, ...(target.colorChannels ? { colorChannels: JSON.parse(JSON.stringify(target.colorChannels)) } : {}) }));
    const context = new MeshGradientNativeReadContext();
    const prepared: { target: MeshGradientNativeTarget; snapshot: MeshGradientNativeSnapshot; fills: ReadonlyArray<Paint>; provenance: string; resources: string }[] = [];
    for (const target of targets) {
      if (target.colorChannels && (change.action !== 'edit' || !Object.keys(target.colorChannels).length ||
        Object.entries(target.colorChannels).some(([field, keys]) => !(COLOR_FIELDS as readonly string[]).includes(field) ||
          !(change as Extract<MeshGradientNativeChange, { action: 'edit' }>).fields.includes(field as MeshGradientWireField) ||
          !Array.isArray(keys) || !keys.length || keys.length > 4 || new Set(keys).size !== keys.length || keys.some(key => !['r','g','b','a'].includes(key)))))
        throw Error('E_SCHEMA: Invalid selective mesh-gradient color edit');
      assertScope();
      const snapshot = await readMeshGradientNative(target.node, target.resource, target.paintIndex, context);
      assertScope();
      if (snapshot.expectedState !== target.expectedState) throw Error('E_FIGMA_CONFLICT: Mesh-gradient changed; reread before editing');
      if (!unlocked(target.node)) throw Error('E_FIGMA_SOURCE: The mesh-gradient surface or its container is locked');
      if (change.action !== 'choose' && snapshot.paintIndex === null) throw Error('E_FIGMA_SOURCE: No live mesh-gradient paint to edit or remove');
      if (change.action === 'choose' && snapshot.profile !== MESH_GRADIENT_NATIVE_PROFILE)
        throw Error('E_FIGMA_RESOURCE: Choosing this recipe requires explicit adoption of the current renderer');
      const writeResource = change.action === 'adopt' ? change.resource : target.resource;
      const binding = readMeshGradientResourceBinding(target.node);
      if (change.action === 'choose' || change.action === 'adopt') {
        const identities = [target.resource.importId, target.resource.paintId, writeResource.importId, writeResource.paintId,
          binding?.accepted?.importId, binding?.accepted?.paintId, binding?.available.importId, binding?.available.paintId];
        const count = (target.node as FillNode).fills.filter(paint => paint.type === 'SHADER' && identities.includes(paint.id)).length;
        if (count > 1) throw Error('E_FIGMA_AMBIGUOUS: Independent mesh-gradient seeds require separate surfaces; stacked native fill identities cannot be safely reseeded');
      }
      if (change.action === 'adopt' && (!binding || !sameMeshGradientResource(binding.available, writeResource)))
        throw Error('E_FIGMA_RESOURCE: Acquire the exact new renderer before explicitly adopting it');
      const shaders = await context.shaders();
      const shader = shaders.find(candidate => candidate.id === writeResource.importId);
      if (!shader?.imported || shader.type !== 'fill' || !shader.propertyDefinitions)
        throw Error('E_FIGMA_RESOURCE: Acquire the exact mesh-gradient build before editing');
      const oldPaint = snapshot.paintIndex === null ? null : (target.node as FillNode).fills[snapshot.paintIndex] as ShaderPaint;
      const properties: Record<string, ShaderPropertyValue> = change.action === 'adopt' ? {} : { ...oldPaint?.properties };
      const mapping = meshGradientDefinitions(shader);
      let oldMapping: ReturnType<typeof meshGradientDefinitions> | null = null;
      if (change.action === 'adopt') {
        const oldShader = shaders.find(candidate => candidate.id === target.resource.importId);
        if (!oldShader) throw Error('E_FIGMA_RESOURCE: The previous renderer is no longer readable');
        oldMapping = meshGradientDefinitions(oldShader);
        if (Object.keys(oldPaint?.properties ?? {}).some(id => !Object.values(oldMapping!).includes(id)))
          throw Error('E_FIGMA_RESOURCE: Extra native Shader assignments cannot be silently dropped during renderer adoption');
      }
      const fields = change.action === 'edit' ? change.fields : MESH_GRADIENT_WIRE_FIELDS;
      if (change.action !== 'remove') for (const field of fields) {
        const name = meshGradientProperty(field);
        let value = change.material[name];
        const channels = target.colorChannels?.[field as keyof MeshGradientColorChannels];
        const colorName = colorProperty(field);
        if (change.action === 'edit' && channels && colorName) {
          if (!channels.length || channels.length > 4 || new Set(channels).size !== channels.length ||
             channels.some(key => !['r','g','b','a'].includes(key)) || !snapshot.material)
            throw Error('E_SCHEMA: Invalid selective mesh-gradient color edit');
          const color = { ...snapshot.material[colorName] };
          for (const key of channels) color[key] = change.material[colorName][key];
          value = color;
        }
        properties[mapping[name]] = change.action === 'adopt'
          ? meshGradientAdoptionValue(name, change.material, snapshot.material!, oldPaint?.properties?.[oldMapping![name]])
          : typeof value === 'object' ? { ...value } : value;
      }
      const node = target.node as FillNode, fills = [...node.fills];
      if (change.action === 'remove') fills.splice(snapshot.paintIndex!, 1);
      else if (snapshot.paintIndex === null) fills.push({ type: 'SHADER', id: writeResource.importId, properties });
      else if (change.action === 'adopt') fills[snapshot.paintIndex] = {
        type: 'SHADER', id: writeResource.importId, properties,
        visible: oldPaint?.visible ?? true, opacity: oldPaint?.opacity ?? 1, blendMode: oldPaint?.blendMode ?? 'NORMAL',
      };
      else fills[snapshot.paintIndex] = { ...fills[snapshot.paintIndex] as ShaderPaint, properties };
      const reseed = change.action === 'choose' || change.action === 'adopt';
      const provenance = change.action === 'choose' || change.action === 'adopt' ? JSON.stringify({
        schema: 'worldbend.mesh-gradient-native@0.1', version: '0.1', recipe: change.recipe, resource: writeResource,
      }) : node.getSharedPluginData('worldbend', 'meshGradient');
      const resources = reseed ? JSON.stringify({
        schema: 'worldbend.mesh-gradient-resources@0.1', version: '0.1',
        accepted: writeResource, available: binding?.available ?? writeResource,
      }) : node.getSharedPluginData('worldbend', 'meshGradientResources');
      prepared.push({ target, snapshot, fills, provenance, resources });
    }
    assertScope();
    for (const item of prepared) {
      assertMeshGradientSnapshotFresh(item.snapshot);
      if (!unlocked(item.target.node)) throw Error('E_FIGMA_CONFLICT: A mesh-gradient container became locked');
    }
    beforeWrite();
    for (const item of prepared) {
      const node = item.target.node as FillNode;
      backups.push({
        node, fills: node.fills,
        provenance: node.getSharedPluginData('worldbend', 'meshGradient'),
        resources: node.getSharedPluginData('worldbend', 'meshGradientResources'),
      });
      node.fills = item.fills;
      if (node.getSharedPluginData('worldbend', 'meshGradient') !== item.provenance)
        node.setSharedPluginData('worldbend', 'meshGradient', item.provenance);
      if (node.getSharedPluginData('worldbend', 'meshGradientResources') !== item.resources)
        node.setSharedPluginData('worldbend', 'meshGradientResources', item.resources);
    }
    return { ok: true, outcomes: prepared.map(item => ({ nodeId: item.target.node.id, outcome: change.action === 'remove' ? 'removed' : 'applied' })) };
  } catch (error) {
    const unrestoredNodeIds: string[] = [];
    for (const backup of backups.reverse()) {
      let restored = true;
      try { backup.node.fills = backup.fills; } catch { restored = false; }
      try { backup.node.setSharedPluginData('worldbend', 'meshGradient', backup.provenance); } catch { restored = false; }
      try { backup.node.setSharedPluginData('worldbend', 'meshGradientResources', backup.resources); } catch { restored = false; }
      if (!restored) unrestoredNodeIds.push(backup.node.id);
    }
    return { ok: false, error: String(error), unrestoredNodeIds };
  }
}
