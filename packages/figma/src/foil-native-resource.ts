import { FOIL_PROPERTY_FIELDS, isFoilMaterialWire } from './foil-wire';
import type { FoilMaterialWire } from './foil-wire';
import { foilNativeState, foilResourceProfile } from './foil-native-read';
import type { FoilResourceEvidence } from './foil-native-read';
import { fingerprintState } from './state-fingerprint';
import { foilColorValue, foilDefinitions } from './foil-native-properties';

export interface FoilSourceIdentity {importId:string;sourceSha256:string}
/** Available means acquired; accepted identifies the actually adopted renderer.
 * Merely acquiring a newer build does not change artwork or seed provenance. */
export interface FoilResourceBinding {
  schema:'worldbend.foil-resources@0.1';version:'0.1';
  accepted:FoilResourceEvidence|null;
  available:FoilResourceEvidence;
}
export function readFoilResourceBinding(node:SceneNode):FoilResourceBinding|null {
  const text=node.getSharedPluginData('worldbend','foilResources');
  if(!text)return null;
  if(text.length>4096)throw Error('E_FIGMA_PROVENANCE: Foil resource record is too large');
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw Error('E_FIGMA_PROVENANCE: Foil resource record is unreadable');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('E_FIGMA_PROVENANCE: Invalid Foil resource record');
  const record=value as Record<string,unknown>;
  if(Object.keys(record).length!==4||record['schema']!=='worldbend.foil-resources@0.1'||record['version']!=='0.1')
    throw Error('E_FIGMA_PROVENANCE: Invalid Foil resource record');
  const binding=value as FoilResourceBinding;
  foilResourceProfile(binding.available);
  if(binding.accepted!==null)foilResourceProfile(binding.accepted);
  return binding;
}
export function foilResourceExpected(node:SceneNode):string {return fingerprintState(foilNativeState(node));}
export function sameFoilResource(a:FoilResourceEvidence,b:FoilResourceEvidence):boolean {
  return a.importId===b.importId&&a.paintId===b.paintId&&a.sourceSha256===b.sourceSha256;
}

/** Import an exact, source-checked build and observe its actual native paint
 * identity. An owned, short-lived probe establishes the alias; no name/hash-tail
 * inference. Acquisition never applies a material to the user's surface. */
export async function acquireFoilNativeResource(node:SceneNode,source:FoilSourceIdentity,
  expected:string,assertScope:()=>void = ()=>{},repairRecord=false):Promise<FoilResourceBinding> {
  const identity={...source};
  foilResourceProfile({...identity,paintId:identity.importId});
  assertScope();
  const initial=foilNativeState(node);
  if(fingerprintState(initial)!==expected)throw Error('E_FIGMA_CONFLICT: Surface changed before Foil acquisition');
  let previous:FoilResourceBinding|null;
  try{previous=readFoilResourceBinding(node);}catch(error){if(!repairRecord)throw error;previous=null;}
  if(node.removed||!('fills' in node)||!Array.isArray(node.fills))throw Error('E_FIGMA_SOURCE: Acquire Foil for a live fill-capable surface');
  for(let parent:BaseNode|null=node;parent;parent=parent.parent)
    if('locked' in parent&&parent.locked)throw Error('E_FIGMA_SOURCE: The surface or its container is locked');
  let shader=(await figma.listAvailableShaders()).find(candidate=>candidate.id===identity.importId&&candidate.imported);
  assertScope();
  if(foilNativeState(node)!==initial)throw Error('E_FIGMA_CONFLICT: Surface changed during Foil acquisition');
  if(!shader)shader=await figma.importShaderById(identity.importId);
  assertScope();
  if(foilNativeState(node)!==initial)throw Error('E_FIGMA_CONFLICT: Surface changed during Foil acquisition');
  if(shader.id!==identity.importId||shader.type!=='fill'||!shader.imported||!shader.propertyDefinitions)
    throw Error('E_FIGMA_RESOURCE: The exact Foil fill build is unavailable');
  const properties:Record<string,ShaderPropertyValue>={},values:Record<string,unknown>={};
  const mapping=foilDefinitions(shader);
  for(const field of FOIL_PROPERTY_FIELDS){
    const id=mapping[field],definition=shader.propertyDefinitions[id]!;
    if(definition.defaultValue===undefined)throw Error(`E_FIGMA_RESOURCE: Unreadable Foil ${field} default`);
    const value=foilColorValue(field,definition.defaultValue);
    values[field]=value;properties[id]=value as ShaderPropertyValue;
  }
  if(!isFoilMaterialWire(values))throw Error('E_FIGMA_RESOURCE: Foil defaults do not satisfy its profile');
  const probe=figma.createRectangle();
  let evidence:FoilResourceEvidence;
  try{
    probe.name='Worldbend Foil acquisition probe';probe.visible=false;
    probe.fills=[{type:'SHADER',id:identity.importId,properties}];
    const paint=Array.isArray(probe.fills)&&probe.fills.length===1?probe.fills[0]:undefined;
    if(!paint||paint.type!=='SHADER')throw Error('E_FIGMA_RESOURCE: Foil could not produce a native paint');
    evidence={...identity,paintId:paint.id};
    foilResourceProfile(evidence);
  }finally{if(!probe.removed)probe.remove();}
  assertScope();
  if(foilNativeState(node)!==initial)throw Error('E_FIGMA_CONFLICT: Surface changed during Foil acquisition');
  const matches=(node as SceneNode&{fills:ReadonlyArray<Paint>}).fills.some(paint=>paint.type==='SHADER'&&
    (paint.id===evidence.paintId||paint.id===evidence.importId));
  const binding:FoilResourceBinding={schema:'worldbend.foil-resources@0.1',version:'0.1',
    accepted:matches?evidence:previous?.accepted??null,available:evidence};
  const before=node.getSharedPluginData('worldbend','foilResources');
  try{node.setSharedPluginData('worldbend','foilResources',JSON.stringify(binding));}
  catch(error){
    try{node.setSharedPluginData('worldbend','foilResources',before);}catch{throw Error(`E_FIGMA_ROLLBACK: Foil resource record could not be restored on ${node.id}: ${String(error)}`);}
    throw error;
  }
  return binding;
}

/** Preserve an alias during adoption only when the requested current value
 * still equals the captured resolved value. Explicit edits become literals. */
export function foilAdoptionValue(name:typeof FOIL_PROPERTY_FIELDS[number],desired:FoilMaterialWire,
  live:FoilMaterialWire,assignment:ShaderPropertyValue|undefined):ShaderPropertyValue {
  const value=desired[name],current=live[name];
  const equal=typeof value==='object'&&typeof current==='object'
    ?(['r','g','b','a'] as const).every(key=>value[key]===current[key]||Math.fround(value[key])===current[key])
    :value===current||(typeof value==='number'&&typeof current==='number'&&Math.fround(value)===current);
  if(equal&&assignment&&typeof assignment==='object'&&'type' in assignment&&assignment.type==='VARIABLE_ALIAS')return {...assignment};
  return typeof value==='object'?{...value}:value;
}
