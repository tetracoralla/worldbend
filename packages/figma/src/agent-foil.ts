import { nodePage } from './native-document';
import { statePage } from './agent-work-state';
import type { WorkPage, WorkScope } from './agent-work-state';
import { readFoilNative } from './foil-native-read';
import type { FoilResourceEvidence } from './foil-native-read';
import { applyFoilNative } from './foil-native-edit';
import type { FoilNativeChange } from './foil-native-edit';
import {acquireFoilNativeResource,foilResourceExpected,readFoilResourceBinding} from './foil-native-resource';
import type {FoilSourceIdentity} from './foil-native-resource';

export interface FoilNativeScope extends WorkScope {resource:FoilResourceEvidence;paintIndex?:number}
function scope(input:WorkScope) {
  if (figma.fileKey !== input.fileKey || figma.currentPage.id !== input.pageId || figma.currentPage.removed)
    throw Error('E_FIGMA_SCOPE: Read the granted live page');
}
async function surface(input:WorkScope) {
  scope(input);
  const node=await figma.getNodeByIdAsync(input.nodeId);
  scope(input);
  if (!node || node.removed || nodePage(node)?.id !== input.pageId || node.type==='DOCUMENT' || node.type==='PAGE')
    throw Error('E_FIGMA_SOURCE: Read one surface in the granted page');
  return node;
}
export async function foilResources(input:WorkScope) {
  const node=await surface(input);
  let binding:ReturnType<typeof readFoilResourceBinding>=null,issue:string|undefined;
  try{binding=readFoilResourceBinding(node);}catch(error){issue=String(error);}
  return {schema:'worldbend.figma.foil-resources-state' as const,version:'0.1' as const,
    fileKey:input.fileKey,pageId:input.pageId,nodeId:node.id,expectedState:foilResourceExpected(node),binding,
    ...(issue?{issue}:{}),paintIds:'fills' in node&&Array.isArray(node.fills)?node.fills.flatMap(paint=>paint.type==='SHADER'?[paint.id]:[]):[]};
}
export async function acquireFoil(input:WorkScope&{resource:FoilSourceIdentity;expectedState:string;repairRecord?:boolean}) {
  const node=await surface(input);
  const binding=await acquireFoilNativeResource(node,input.resource,input.expectedState,()=>{
    scope(input);
    if(nodePage(node)?.id!==input.pageId)throw Error('E_FIGMA_SCOPE: Surface moved during Foil acquisition');
  },input.repairRecord===true);
  return {schema:'worldbend.figma.foil-acquisition' as const,version:'0.1' as const,nodeId:node.id,binding,
    nextAction:'read-current-native-state' as const};
}
/** Obtain current native values, not caller-supplied material parameters. Large
 * reads preserve exact JSON through the existing guarded continuation paging. */
export async function readFoil(input:FoilNativeScope&WorkPage) {
  const node=await surface(input), snapshot=await readFoilNative(node,input.resource,input.paintIndex);
  scope(input);
  if (nodePage(node)?.id !== input.pageId) throw Error('E_FIGMA_SCOPE: Foil moved out of the granted page');
  return statePage({schema:'worldbend.figma.foil-state' as const,version:'0.1' as const,
    fileKey:input.fileKey,pageId:input.pageId,...snapshot},input);
}
export async function editFoil(input:FoilNativeScope&{expectedState:string;change:FoilNativeChange}) {
  const node=await surface(input);
  const result=await applyFoilNative([{node,resource:input.resource,expectedState:input.expectedState,
    ...(input.paintIndex===undefined?{}:{paintIndex:input.paintIndex})}],input.change,()=>{
    scope(input);
    if (nodePage(node)?.id !== input.pageId) throw Error('E_FIGMA_SCOPE: Foil moved out of the granted page');
  });
  if (!result.ok) return {schema:'worldbend.figma.foil-edit-result' as const,version:'0.1' as const,
    nodeId:node.id,...result};
  // The write receipt is returned without an asynchronous post-write read.
  // Reacquire current values explicitly, so a later read failure cannot masquerade
  // as a failed mutation or invite an unguarded repeated write.
  return {schema:'worldbend.figma.foil-edit-result' as const,version:'0.1' as const,nodeId:node.id,...result,
    nextAction:'read-current-native-state' as const};
}
