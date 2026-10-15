import { MESH_GRADIENT_NATIVE_PROFILE } from './mesh-gradient-resource.generated';
import { meshGradientResourceProfile } from './mesh-gradient-resource-wire';
import type { MeshGradientResourceEvidence } from './mesh-gradient-resource-wire';
import { readMeshGradientResourceBinding } from './mesh-gradient-native-resource';
import { readMeshGradientNative, assertMeshGradientSnapshotFresh, meshGradientNativeState, MeshGradientNativeReadContext } from './mesh-gradient-native-read';
import type { MeshGradientNativeSnapshot } from './mesh-gradient-native-read';
import { applyMeshGradientNative } from './mesh-gradient-native-edit';
import type { MeshGradientNativeTarget, MeshGradientNativeChange } from './mesh-gradient-native-edit';
import type { MeshGradientNodeSnapshot } from './mesh-gradient-material-wire';
import { isMaterialEdit } from './material-edit-wire';
import type { MaterialEditWire, MaterialOutcome } from './material-edit-wire';

const proofs = new WeakMap<MeshGradientNodeSnapshot, { node: SceneNode; state: string; native?: MeshGradientNativeSnapshot }>();
/** Only owned, source-checked records establish identities. A Shader name or
 * resource suffix never grants permission to reinterpret a native fill. */
export async function meshGradientNodeSnapshot(node: SceneNode, context?: MeshGradientNativeReadContext): Promise<MeshGradientNodeSnapshot> {
  const state = meshGradientNativeState(node);
  const result: MeshGradientNodeSnapshot = {
    nodeId: node.id, name: node.name, eligible: false, state: 'absent', live: null, provenance: null,
    customized: [], profile: null, resource: null, available: null, canChoose: false, canAdopt: false, warnings: [],
  };
  let native: MeshGradientNativeSnapshot | undefined;
  try {
    if (node.removed || !('fills' in node) || !Array.isArray(node.fills)) result.reason = 'no-fills';
    else {
      const binding = readMeshGradientResourceBinding(node);
      const seedText = node.getSharedPluginData('worldbend', 'meshGradient');
      let seeded: MeshGradientResourceEvidence | null = null;
      if (seedText) {
        if (seedText.length > 32768) throw Error('Invalid mesh-gradient seed');
        const seed = JSON.parse(seedText);
        if (seed?.schema !== 'worldbend.mesh-gradient-native@0.1' || seed.version !== '0.1') throw Error('Invalid mesh-gradient seed');
        meshGradientResourceProfile(seed.resource); seeded = seed.resource;
      }
      const resource = binding?.accepted ?? seeded ?? binding?.available ?? null;
      result.available = binding?.available ?? seeded;
      result.resource = resource;
      if (!resource) result.reason = node.fills.some(paint => paint.type === 'SHADER') ? 'unverified' : 'unavailable';
      else {
        native = await readMeshGradientNative(node, resource, undefined, context);
        Object.assign(result, {
          eligible: true, state: native.state, live: native.material, provenance: native.recipe,
          customized: native.customized, profile: native.profile, warnings: native.warnings,
          canChoose: native.canApplyCurrentProfile,
          canAdopt: !!native.material && !!result.available && meshGradientResourceProfile(result.available) === MESH_GRADIENT_NATIVE_PROFILE && native.profile !== MESH_GRADIENT_NATIVE_PROFILE,
        });
      }
      for (let parent: BaseNode | null = node; parent; parent = parent.parent) if ('locked' in parent && parent.locked) {
        result.eligible = false; result.reason = 'locked'; result.canChoose = false; result.canAdopt = false; break;
      }
    }
  } catch (error) {
    result.eligible = false; result.reason = String(error).includes('E_FIGMA_AMBIGUOUS') ? 'multiple' : 'invalid';
    result.canChoose = false; result.canAdopt = false;
  }
  if (meshGradientNativeState(node) !== state) throw Error('E_FIGMA_CONFLICT: Material changed during capture');
  proofs.set(result, { node, state, ...(native ? { native } : {}) });
  return result;
}
export function meshGradientNodeSnapshotFresh(snapshot: MeshGradientNodeSnapshot): boolean {
  const proof = proofs.get(snapshot);
  try {
    if (!proof || meshGradientNativeState(proof.node) !== proof.state) return false;
    if (proof.native) assertMeshGradientSnapshotFresh(proof.native);
    return true;
  } catch { return false; }
}
export async function applyMeshGradientMaterialEdit(nodes: readonly SceneNode[], edit: Extract<MaterialEditWire, { family: 'mesh-gradient' }>,
  observed?: ReadonlyMap<string, MeshGradientNodeSnapshot>, assertScope: () => void = () => {}, beforeWrite: () => void = () => {}) {
  const failed = (error: string) => ({ ok: false as const, error, unrestoredNodeIds: [] as string[] });
  if (!isMaterialEdit(edit)) return failed('Invalid mesh-gradient material edit');
  edit = JSON.parse(JSON.stringify(edit));
  const captured: MeshGradientNodeSnapshot[] = [], targets: MeshGradientNativeTarget[] = [], outcomes: MaterialOutcome[] = [];
  try {
    assertScope();
    const context = new MeshGradientNativeReadContext();
    for (const node of nodes) {
      const old = observed?.get(node.id);
      if (observed && (!old || !meshGradientNodeSnapshotFresh(old))) throw Error('E_FIGMA_CONFLICT: Reread the material selection');
      const snapshot = old ?? await meshGradientNodeSnapshot(node, context); captured.push(snapshot);
      assertScope();
      if (!snapshot.eligible || (!snapshot.live && (edit.fields || edit.remove))) {
        outcomes.push({ nodeId: node.id, outcome: 'skipped', reason: snapshot.reason ?? 'absent' }); continue;
      }
      const native = proofs.get(snapshot)?.native;
      if (!native || !snapshot.resource) throw Error('E_FIGMA_RESOURCE: Material resource is unavailable');
      if (edit.adopt ? !snapshot.canAdopt : !edit.fields && !edit.remove && !snapshot.canChoose)
        throw Error('E_FIGMA_RESOURCE: Explicitly adopt the current mesh-gradient renderer before choosing this look');
      targets.push({
        node, resource: snapshot.resource, expectedState: native.expectedState,
        ...(native.paintIndex === null ? {} : { paintIndex: native.paintIndex }), ...(edit.colorChannels ? { colorChannels: edit.colorChannels } : {}),
      });
    }
    const guard = () => {
      assertScope();
      for (const snapshot of captured) if (!meshGradientNodeSnapshotFresh(snapshot))
        throw Error('E_FIGMA_CONFLICT: Material selection changed during editing');
    };
    guard();
    if (!targets.length) return failed('No available mesh-gradient surfaces');
    let change: MeshGradientNativeChange;
    if (edit.remove) change = { action: 'remove' };
    else if (edit.adopt) {
      const available = captured.filter(n => n.eligible)[0]?.available;
      if (!available || targets.some(target => {
        const resource = captured.find(n => n.nodeId === target.node.id)?.available;
        return !resource || resource.importId !== available.importId || resource.paintId !== available.paintId || resource.sourceSha256 !== available.sourceSha256;
      })) return failed('Acquire the same mesh-gradient renderer for all selected surfaces');
      change = { action: 'adopt', material: edit.material, recipe: edit.recipe, resource: available };
    } else if (edit.fields) change = { action: 'edit', material: edit.material, fields: edit.fields };
    else change = { action: 'choose', material: edit.material, recipe: edit.recipe };
    const result = await applyMeshGradientNative(targets, change, guard, beforeWrite);
    return result.ok ? { ok: true as const, outcomes: [...outcomes, ...result.outcomes] } : result;
  } catch (error) { return failed(String(error)); }
}
