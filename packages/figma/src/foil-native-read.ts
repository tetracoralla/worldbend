import { FOIL_NATIVE_PROFILE } from './foil-resource.generated';
import { foilResourceProfile } from './foil-resource-wire';
import type { FoilResourceEvidence, FoilNativeProfile } from './foil-resource-wire';
export { foilResourceProfile } from './foil-resource-wire';
export type { FoilResourceEvidence, FoilNativeProfile } from './foil-resource-wire';
import { FOIL_PROPERTY_FIELDS, isFoilMaterialWire, isFoilRecipeWire, changedFoilFields } from './foil-wire';
import type { FoilMaterialWire, FoilRecipeWire, FoilWireField } from './foil-wire';
import { fingerprintState } from './state-fingerprint';
import { foilColorValue, foilDefinitions, foilPropertyType } from './foil-native-properties';

export interface FoilNativeBinding {
  field: typeof FOIL_PROPERTY_FIELDS[number];
  variableId: string;
  resolvedType: VariableResolvedDataType;
  value: VariableValue;
}
export interface FoilNativeSnapshot {
  nodeId: string;
  name: string;
  profile: FoilNativeProfile;
  /** Prototype capture is useful, but cannot silently become a new profile. */
  canApplyCurrentProfile: boolean;
  paintIndex: number | null;
  state: 'absent' | 'removed' | 'untagged-native' | 'tagged' | 'customized';
  material: FoilMaterialWire | null;
  recipe: FoilRecipeWire | null;
  customized: FoilWireField[];
  bindings: FoilNativeBinding[];
  /** Instance composition is retained separately from the seven shader params. */
  paintModifiers: { visible: boolean; opacity: number; blendMode: string } | null;
  warnings: string[];
  resource: FoilResourceEvidence;
  expectedState: string;
}
type PaintNode = SceneNode & { fills: ReadonlyArray<Paint>; resolvedVariableModes: Record<string,string> };
const proofs = new WeakMap<FoilNativeSnapshot,{node:SceneNode;state:string;variables:{variable:Variable;binding:FoilNativeBinding}[]}>();
function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function isRecord(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
/** Complete native source state, including variable-mode context. This is a
 * compare-before-write token, not a cryptographic attestation of file access. */
export function foilNativeState(node: SceneNode): string {
  const ancestors: unknown[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) ancestors.push({id:parent.id,removed:parent.removed,
    locked:'locked' in parent ? parent.locked : null,
    modes:'resolvedVariableModes' in parent ? parent.resolvedVariableModes : null});
  return JSON.stringify({id:node.id,removed:node.removed,parent:node.parent?.id,
    name:node.name,width:node.width,height:node.height,locked:node.locked,visible:node.visible,ancestors,
    transform:'relativeTransform' in node ? node.relativeTransform : null,
    fills:'fills' in node ? node.fills : null,effects:'effects' in node ? node.effects : null,
    modes:'resolvedVariableModes' in node ? node.resolvedVariableModes : null,
    provenance:node.getSharedPluginData('worldbend','foil'),resourceBinding:node.getSharedPluginData('worldbend','foilResources')});
}
/** Native edits are synchronous only after all asynchronous reads complete.
 * Recheck cached variable consumers as well as assignments at that write edge. */
export function assertFoilSnapshotFresh(snapshot: FoilNativeSnapshot): void {
  const proof = proofs.get(snapshot);
  try {
    if (!proof || foilNativeState(proof.node) !== proof.state || proof.variables.some(({variable,binding}) => {
      const now = variable.resolveForConsumer(proof.node);
      return now.resolvedType !== binding.resolvedType || JSON.stringify(now.value) !== JSON.stringify(binding.value);
    })) fail('E_FIGMA_CONFLICT','Foil or its variable context changed; reread');
  } catch (error) { fail('E_FIGMA_CONFLICT',`Foil capture is no longer current: ${String(error)}`); }
}
function capture(snapshot: Omit<FoilNativeSnapshot,'expectedState'>,node:SceneNode,state:string,
  variables: {variable:Variable;binding:FoilNativeBinding}[] = []): FoilNativeSnapshot {
  const result = {...snapshot,expectedState:fingerprintState(JSON.stringify({state,profile:snapshot.profile,
    slot:snapshot.paintIndex,bindings:snapshot.bindings,material:snapshot.material}))};
  proofs.set(result,{node,state,variables:variables.map(({variable,binding})=>({variable,binding:{...binding,
    value:binding.value && typeof binding.value === 'object' ? {...binding.value} : binding.value}}))});
  assertFoilSnapshotFresh(result);
  return result;
}
function storedRecipe(node: SceneNode, resource: FoilResourceEvidence): FoilRecipeWire | null {
  const text = node.getSharedPluginData('worldbend','foil');
  if (!text) return null;
  if (text.length > 32768) fail('E_FIGMA_PROVENANCE','Foil provenance is too large');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return fail('E_FIGMA_PROVENANCE','Foil provenance is unreadable'); }
  if (!isRecord(parsed) || parsed['schema'] !== 'worldbend.foil-native@0.1' ||
      parsed['version'] !== '0.1' || !isFoilRecipeWire(parsed['recipe']) || !isRecord(parsed['resource']) ||
      parsed['resource']['sourceSha256'] !== resource.sourceSha256 ||
      parsed['resource']['importId'] !== resource.importId || parsed['resource']['paintId'] !== resource.paintId) {
    fail('E_FIGMA_PROVENANCE','Foil provenance or renderer changed; inspect before adoption');
  }
  return parsed['recipe'];
}

/** Request-local metadata reuse. Native values are resolved separately for
 * each consumer and guarded again at the write edge; no cache survives a read
 * or write operation. In particular, this never caches a resolved color. */
export class FoilNativeReadContext {
  private shaderRead:Promise<ReadonlyArray<Shader>>|undefined;
  private variables=new Map<string,Promise<Variable|null>>();
  shaders():Promise<ReadonlyArray<Shader>> {return this.shaderRead??=figma.listAvailableShaders();}
  variable(id:string):Promise<Variable|null> {
    let value=this.variables.get(id);
    if(!value){value=figma.variables.getVariableByIdAsync(id);this.variables.set(id,value);}
    return value;
  }
}

/** Read actual assignments by definition ID and resolve variable aliases in
 * this surface's context. Reads do not import resources, apply a seed or
 * replace a legacy renderer. A failed capture never becomes removal. */
export async function readFoilNative(node: SceneNode, resource: FoilResourceEvidence, paintIndex?: number,context=new FoilNativeReadContext()): Promise<FoilNativeSnapshot> {
  const rendererProfile = foilResourceProfile(resource), initialState = foilNativeState(node);
  if (node.removed || !('fills' in node) || !Array.isArray(node.fills)) fail('E_FIGMA_SOURCE','Foil needs one live surface with readable fills');
  const surface = node as PaintNode;
  const stored = storedRecipe(node,resource);
  const paints = surface.fills;
  const matching = paints.flatMap((paint,index) => paint.type === 'SHADER' &&
    (paint.id === resource.paintId || paint.id === resource.importId) ? [index] : []);
  if (paintIndex !== undefined && (!Number.isInteger(paintIndex) || paintIndex < 0 || !matching.includes(paintIndex))) fail('E_FIGMA_SOURCE','The requested Foil paint slot changed');
  if (paintIndex === undefined && matching.length > 1) fail('E_FIGMA_AMBIGUOUS','Select the Foil paint slot; multiple matching fills exist');
  const slot = paintIndex ?? matching[0] ?? null;
  const warnings: string[] = rendererProfile === FOIL_NATIVE_PROFILE ? [] : ['legacy-highlight-opacity-ignored','explicit-renderer-adoption-required'];
  // Native paints have a resource id and array position, but no persistent
  // per-paint instance id in this profile. A per-surface seed cannot safely
  // identify separate stacked fills after native reordering.
  const recipe = matching.length > 1 ? null : stored;
  if(stored&&matching.length>1)warnings.push('seed-provenance-ambiguous');
  const base = {nodeId:node.id,name:node.name,profile:rendererProfile,canApplyCurrentProfile:rendererProfile===FOIL_NATIVE_PROFILE,
    recipe,customized:[] as FoilWireField[],bindings:[] as FoilNativeBinding[],resource:{...resource},warnings};
  if (slot === null) return capture({...base,paintIndex:null,state:recipe?'removed':'absent',material:null,paintModifiers:null},node,initialState);
  const shader = (await context.shaders()).find(candidate => candidate.id === resource.importId);
  if (!shader || shader.type !== 'fill' || !shader.imported || !shader.propertyDefinitions) {
    fail('E_FIGMA_RESOURCE','The exact Foil build is not available with readable definitions; acquire it before capture');
  }
  const paint = paints[slot] as ShaderPaint;
  const definitions = foilDefinitions(shader);
  const resolved: Record<string,unknown> = {};
  const variables: { field: typeof FOIL_PROPERTY_FIELDS[number]; variable: Variable; binding: FoilNativeBinding }[] = [];
  for (const field of FOIL_PROPERTY_FIELDS) {
    const expectedType = foilPropertyType(field), id = definitions[field];
    if (!paint.properties || !Object.hasOwn(paint.properties,id)) fail('E_FIGMA_SOURCE',`Foil ${field} assignment is unreadable`);
    let value: unknown = paint.properties[id];
    if (isRecord(value) && value['type'] === 'VARIABLE_ALIAS') {
      if (typeof value['id'] !== 'string') fail('E_FIGMA_SOURCE',`Foil ${field} variable binding is invalid`);
      const variable = await context.variable(value['id']);
      if (!variable) fail('E_FIGMA_SOURCE',`Foil ${field} variable is unavailable`);
      const result = variable.resolveForConsumer(surface);
      const binding = {field,variableId:variable.id,resolvedType:result.resolvedType,
        value:result.value && typeof result.value === 'object' ? {...result.value} : result.value};
      const requiredType = expectedType === 'NUMBER' ? 'FLOAT' : expectedType;
      if (result.resolvedType !== requiredType) fail('E_FIGMA_SOURCE',`Foil ${field} variable has an incompatible type`);
      variables.push({field,variable,binding}); value = result.value;
    }
    value = foilColorValue(field,value);
    resolved[field] = value && typeof value === 'object' ? {...value} : value;
  }
  if (!isFoilMaterialWire(resolved)) fail('E_FIGMA_SOURCE','Current Foil parameters are invalid; no values were guessed or clamped');
  if (foilNativeState(node) !== initialState || variables.some(({variable,binding}) => {
    const now = variable.resolveForConsumer(surface);
    return now.resolvedType !== binding.resolvedType || JSON.stringify(now.value) !== JSON.stringify(binding.value);
  })) fail('E_FIGMA_CONFLICT','Foil or its variable context changed during capture; reread');
  const opacity = paint.opacity ?? 1;
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail('E_FIGMA_SOURCE','Foil paint opacity is invalid');
  const modifiers = {visible:paint.visible !== false,opacity,blendMode:paint.blendMode ?? 'NORMAL'};
  if (!modifiers.visible || modifiers.opacity !== 1 || modifiers.blendMode !== 'NORMAL') warnings.push('paint-composition-separate-from-material');
  const customized = recipe ? changedFoilFields(resolved,recipe.material) : [];
  return capture({...base,paintIndex:slot,material:resolved,bindings:variables.map(item=>item.binding),paintModifiers:modifiers,customized,
    state:recipe ? customized.length ? 'customized' : 'tagged' : 'untagged-native'},node,initialState,variables);
}
