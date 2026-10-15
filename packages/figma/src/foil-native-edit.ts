import { FOIL_NATIVE_PROFILE } from './foil-resource.generated';
import { FOIL_WIRE_FIELDS, isFoilMaterialWire, isFoilRecipeWire } from './foil-wire';
import type { FoilColorChannels } from './foil-material-wire';
import type { FoilMaterialWire, FoilRecipeWire, FoilWireField } from './foil-wire';
import { assertFoilSnapshotFresh, readFoilNative, FoilNativeReadContext } from './foil-native-read';
import type { FoilNativeSnapshot, FoilResourceEvidence } from './foil-native-read';
import { foilResourceProfile } from './foil-native-read';
import { foilDefinitions, foilProperty } from './foil-native-properties';
import { foilAdoptionValue, readFoilResourceBinding, sameFoilResource } from './foil-native-resource';

export type FoilNativeChange =
  | { action:'edit'; material:FoilMaterialWire; fields:FoilWireField[] }
  | { action:'choose'; material:FoilMaterialWire; recipe:FoilRecipeWire }
  | { action:'adopt'; material:FoilMaterialWire; recipe:FoilRecipeWire;resource:FoilResourceEvidence }
  | { action:'remove' };
export interface FoilNativeTarget {
  node:SceneNode; resource:FoilResourceEvidence; expectedState:string; paintIndex?:number; colorChannels?:FoilColorChannels;
}
export interface FoilNativeOutcome { nodeId:string; outcome:'applied'|'removed' }
export type FoilNativeResult = {ok:true;outcomes:FoilNativeOutcome[]} |
  {ok:false;error:string;unrestoredNodeIds:string[]};
type FillNode = SceneNode & {fills:ReadonlyArray<Paint>};
export function isFoilNativeChange(value:unknown): value is FoilNativeChange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const change = value as Record<string,unknown>, keys = Object.keys(change);
  if (change['action'] === 'remove') return keys.length === 1;
  if (!isFoilMaterialWire(change['material'])) return false;
  if (change['action'] === 'choose') return keys.length === 3 && isFoilRecipeWire(change['recipe']);
  if (change['action'] === 'adopt') {
    try { return keys.length === 4 && isFoilRecipeWire(change['recipe']) && foilResourceProfile(change['resource'] as FoilResourceEvidence)===FOIL_NATIVE_PROFILE; }
    catch { return false; }
  }
  return change['action'] === 'edit' && keys.length === 3 && Array.isArray(change['fields']) &&
    change['fields'].length > 0 && change['fields'].length <= FOIL_WIRE_FIELDS.length &&
    new Set(change['fields']).size === change['fields'].length &&
    change['fields'].every(field=>(FOIL_WIRE_FIELDS as readonly unknown[]).includes(field));
}
function unlocked(node:SceneNode):boolean {
  for (let current:BaseNode|null = node; current; current = current.parent)
    if (current.removed || ('locked' in current && current.locked)) return false;
  return true;
}
/** Resource acquisition and source verification precede this operation. All
 * asynchronous captures finish before the single synchronous write section.
 * Selective edits preserve unselected aliases, extra properties, composition,
 * other fills/effects and seed provenance. A legacy renderer is never upgraded. */
export async function applyFoilNative(targets:readonly FoilNativeTarget[],change:FoilNativeChange,
  assertScope:()=>void = ()=>{},beforeWrite:()=>void=()=>{}):Promise<FoilNativeResult> {
  const backups:{node:FillNode;fills:ReadonlyArray<Paint>;provenance:string;resources:string}[] = [];
  try {
    if (!isFoilNativeChange(change) || !targets.length || targets.length > 48 ||
      new Set(targets.map(target=>target.node.id)).size !== targets.length) throw Error('E_SCHEMA: Invalid Foil edit or target selection');
    // Retain the requested revision while capture yields to other UI work.
    change = JSON.parse(JSON.stringify(change)) as FoilNativeChange;
    targets = targets.map(target=>({...target,resource:{...target.resource},...(target.colorChannels?{colorChannels:JSON.parse(JSON.stringify(target.colorChannels))}: {})}));
    const context=new FoilNativeReadContext();
    const prepared:{target:FoilNativeTarget;snapshot:FoilNativeSnapshot;fills:ReadonlyArray<Paint>;provenance:string;resources:string}[] = [];
    for (const target of targets) {
      if(target.colorChannels && (change.action!=='edit' || !Object.keys(target.colorChannels).length ||
        Object.entries(target.colorChannels).some(([field,keys])=>!['base-color','highlight-color'].includes(field) ||
          !(change as Extract<FoilNativeChange,{action:'edit'}>).fields.includes(field as FoilWireField) ||
          !Array.isArray(keys)||!keys.length||keys.length>4||new Set(keys).size!==keys.length||keys.some(key=>!['r','g','b','a'].includes(key)))))
        throw Error('E_SCHEMA: Invalid selective Foil color edit');
      assertScope();
      const snapshot = await readFoilNative(target.node,target.resource,target.paintIndex,context);
      assertScope();
      if (snapshot.expectedState !== target.expectedState) throw Error('E_FIGMA_CONFLICT: Foil changed; reread before editing');
      if (!unlocked(target.node)) throw Error('E_FIGMA_SOURCE: The Foil surface or its container is locked');
      if (change.action !== 'choose' && snapshot.paintIndex === null) throw Error('E_FIGMA_SOURCE: No live Foil paint to edit or remove');
      if (change.action === 'choose' && snapshot.profile !== FOIL_NATIVE_PROFILE)
        throw Error('E_FIGMA_RESOURCE: Choosing this recipe requires explicit adoption of the current renderer');
      const writeResource=change.action==='adopt'?change.resource:target.resource;
      const binding=readFoilResourceBinding(target.node);
      if(change.action==='choose'||change.action==='adopt'){
        const identities=[target.resource.importId,target.resource.paintId,writeResource.importId,writeResource.paintId,
          binding?.accepted?.importId,binding?.accepted?.paintId,binding?.available.importId,binding?.available.paintId];
        const count=(target.node as FillNode).fills.filter(paint=>paint.type==='SHADER'&&identities.includes(paint.id)).length;
        if(count>1)throw Error('E_FIGMA_AMBIGUOUS: Independent Foil seeds require separate surfaces; stacked native fill identities cannot be safely reseeded');
      }
      if(change.action==='adopt'&&(!binding||!sameFoilResource(binding.available,writeResource)))
        throw Error('E_FIGMA_RESOURCE: Acquire the exact new renderer before explicitly adopting it');
      const shaders = await context.shaders();
      const shader = shaders.find(candidate=>candidate.id===writeResource.importId);
      if (!shader?.imported || shader.type !== 'fill' || !shader.propertyDefinitions)
        throw Error('E_FIGMA_RESOURCE: Acquire the exact Foil build before editing');
      const oldPaint=snapshot.paintIndex===null?null:(target.node as FillNode).fills[snapshot.paintIndex] as ShaderPaint;
      const properties:Record<string,ShaderPropertyValue> = change.action==='adopt'?{}:{...oldPaint?.properties};
      const mapping=foilDefinitions(shader);
      let oldMapping:ReturnType<typeof foilDefinitions>|null=null;
      if(change.action==='adopt'){
        const oldShader=shaders.find(candidate=>candidate.id===target.resource.importId);
        if(!oldShader)throw Error('E_FIGMA_RESOURCE: The previous renderer is no longer readable');
        oldMapping=foilDefinitions(oldShader);
        if(Object.keys(oldPaint?.properties??{}).some(id=>!Object.values(oldMapping!).includes(id)))
          throw Error('E_FIGMA_RESOURCE: Extra native Shader assignments cannot be silently dropped during renderer adoption');
      }
      const fields = change.action === 'edit' ? change.fields : FOIL_WIRE_FIELDS;
      if (change.action !== 'remove') for (const field of fields) {
        const name = foilProperty(field);
        let value = change.material[name];
        const channels = target.colorChannels?.[field as keyof FoilColorChannels];
        if (change.action==='edit' && channels && (name==='baseColor'||name==='highlightColor')) {
          if(!channels.length || channels.length>4 || new Set(channels).size!==channels.length ||
             channels.some(key=>!['r','g','b','a'].includes(key)) || !snapshot.material)
            throw Error('E_SCHEMA: Invalid selective Foil color edit');
          const color={...snapshot.material[name]};
          for(const key of channels)color[key]=change.material[name][key];
          value=color;
        }
        properties[mapping[name]] = change.action==='adopt'
          ? foilAdoptionValue(name,change.material,snapshot.material!,oldPaint?.properties?.[oldMapping![name]])
          : typeof value === 'object' ? {...value} : value;
      }
      const node = target.node as FillNode, fills = [...node.fills];
      if (change.action === 'remove') fills.splice(snapshot.paintIndex!,1);
      else if (snapshot.paintIndex === null) fills.push({type:'SHADER',id:writeResource.importId,properties});
      else if(change.action==='adopt') fills[snapshot.paintIndex]={type:'SHADER',id:writeResource.importId,properties,
        visible:oldPaint?.visible??true,opacity:oldPaint?.opacity??1,blendMode:oldPaint?.blendMode??'NORMAL'};
      else fills[snapshot.paintIndex] = {...fills[snapshot.paintIndex] as ShaderPaint,properties};
      const reseed=change.action==='choose'||change.action==='adopt';
      const provenance = change.action==='choose'||change.action==='adopt' ? JSON.stringify({schema:'worldbend.foil-native@0.1',version:'0.1',
        recipe:change.recipe,resource:writeResource}) : node.getSharedPluginData('worldbend','foil');
      const resources=reseed?JSON.stringify({schema:'worldbend.foil-resources@0.1',version:'0.1',
        accepted:writeResource,available:binding?.available??writeResource}):node.getSharedPluginData('worldbend','foilResources');
      prepared.push({target,snapshot,fills,provenance,resources});
    }
    assertScope();
    for (const item of prepared) {
      assertFoilSnapshotFresh(item.snapshot);
      if (!unlocked(item.target.node)) throw Error('E_FIGMA_CONFLICT: A Foil container became locked');
    }
    beforeWrite();
    // There is no await between the final guards and completion/rollback.
    for (const item of prepared) {
      const node = item.target.node as FillNode;
      backups.push({node,fills:node.fills,provenance:node.getSharedPluginData('worldbend','foil'),resources:node.getSharedPluginData('worldbend','foilResources')});
      node.fills = item.fills;
      if (node.getSharedPluginData('worldbend','foil') !== item.provenance)
        node.setSharedPluginData('worldbend','foil',item.provenance);
      if(node.getSharedPluginData('worldbend','foilResources')!==item.resources)
        node.setSharedPluginData('worldbend','foilResources',item.resources);
    }
    return {ok:true,outcomes:prepared.map(item=>({nodeId:item.target.node.id,outcome:change.action==='remove'?'removed':'applied'}))};
  } catch (error) {
    const unrestoredNodeIds:string[] = [];
    for (const backup of backups.reverse()) {
      let restored = true;
      try { backup.node.fills = backup.fills; } catch { restored = false; }
      try { backup.node.setSharedPluginData('worldbend','foil',backup.provenance); } catch { restored = false; }
      try { backup.node.setSharedPluginData('worldbend','foilResources',backup.resources); } catch { restored = false; }
      if (!restored) unrestoredNodeIds.push(backup.node.id);
    }
    return {ok:false,error:String(error),unrestoredNodeIds};
  }
}
