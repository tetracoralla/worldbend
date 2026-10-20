import { nodePage } from './native-document';
import { statePage } from './agent-work-state';
import type { WorkPage, WorkScope } from './agent-work-state';
import { readMeshGradientNative } from './mesh-gradient-native-read';
import type { MeshGradientResourceEvidence } from './mesh-gradient-native-read';
import { applyMeshGradientNative } from './mesh-gradient-native-edit';
import type { MeshGradientNativeChange } from './mesh-gradient-native-edit';
import { acquireMeshGradientNativeResource, meshGradientResourceExpected, readMeshGradientResourceBinding } from './mesh-gradient-native-resource';
import type { MeshGradientSourceIdentity } from './mesh-gradient-native-resource';

export interface MeshGradientNativeScope extends WorkScope { resource: MeshGradientResourceEvidence; paintIndex?: number }
function scope(input: WorkScope) {
  if (figma.fileKey !== input.fileKey || figma.currentPage.id !== input.pageId || figma.currentPage.removed)
    throw Error('E_FIGMA_SCOPE: Read the granted live page');
}
async function surface(input: WorkScope) {
  scope(input);
  const node = await figma.getNodeByIdAsync(input.nodeId);
  scope(input);
  if (!node || node.removed || nodePage(node)?.id !== input.pageId || node.type === 'DOCUMENT' || node.type === 'PAGE')
    throw Error('E_FIGMA_SOURCE: Read one surface in the granted page');
  return node;
}
export async function meshGradientResources(input: WorkScope) {
  const node = await surface(input);
  let binding: ReturnType<typeof readMeshGradientResourceBinding> = null, issue: string | undefined;
  try { binding = readMeshGradientResourceBinding(node); } catch (error) { issue = String(error); }
  return {
    schema: 'worldbend.figma.mesh-gradient-resources-state' as const, version: '0.1' as const,
    fileKey: input.fileKey, pageId: input.pageId, nodeId: node.id, expectedState: meshGradientResourceExpected(node), binding,
    ...(issue ? { issue } : {}),
    paintIds: 'fills' in node && Array.isArray(node.fills) ? node.fills.flatMap(paint => paint.type === 'SHADER' ? [paint.id] : []) : [],
  };
}
export async function acquireMeshGradient(input: WorkScope & { resource: MeshGradientSourceIdentity; expectedState: string; repairRecord?: boolean }) {
  const node = await surface(input);
  const binding = await acquireMeshGradientNativeResource(node, input.resource, input.expectedState, () => {
    scope(input);
    if (nodePage(node)?.id !== input.pageId) throw Error('E_FIGMA_SCOPE: Surface moved during mesh-gradient acquisition');
  }, input.repairRecord === true);
  return {
    schema: 'worldbend.figma.mesh-gradient-acquisition' as const, version: '0.1' as const, nodeId: node.id, binding,
    nextAction: 'read-current-native-state' as const,
  };
}
export async function readMeshGradient(input: MeshGradientNativeScope & WorkPage) {
  const node = await surface(input), snapshot = await readMeshGradientNative(node, input.resource, input.paintIndex);
  scope(input);
  if (nodePage(node)?.id !== input.pageId) throw Error('E_FIGMA_SCOPE: Mesh-gradient moved out of the granted page');
  return statePage({
    schema: 'worldbend.figma.mesh-gradient-state' as const, version: '0.1' as const,
    fileKey: input.fileKey, pageId: input.pageId, ...snapshot,
  }, input);
}
export async function editMeshGradient(input: MeshGradientNativeScope & { expectedState: string; change: MeshGradientNativeChange }) {
  const node = await surface(input);
  const result = await applyMeshGradientNative([{
    node, resource: input.resource, expectedState: input.expectedState,
    ...(input.paintIndex === undefined ? {} : { paintIndex: input.paintIndex }),
  }], input.change, () => {
    scope(input);
    if (nodePage(node)?.id !== input.pageId) throw Error('E_FIGMA_SCOPE: Mesh-gradient moved out of the granted page');
  });
  if (!result.ok) return { schema: 'worldbend.figma.mesh-gradient-edit-result' as const, version: '0.1' as const, nodeId: node.id, ...result };
  return {
    schema: 'worldbend.figma.mesh-gradient-edit-result' as const, version: '0.1' as const, nodeId: node.id, ...result,
    nextAction: 'read-current-native-state' as const,
  };
}
