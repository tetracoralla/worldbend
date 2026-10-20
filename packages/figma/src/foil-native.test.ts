import { afterEach, describe, expect, it, vi } from 'vitest';
import { FOIL_NATIVE_SOURCE_SHA256 } from './foil-resource.generated';
import { changedFoilFields, isFoilMaterialWire, isFoilRecipeWire, sameFoilMaterial } from './foil-wire';
import type { FoilMaterialWire, FoilRecipeWire } from './foil-wire';
import { assertFoilSnapshotFresh, readFoilNative } from './foil-native-read';
import type { FoilResourceEvidence } from './foil-native-read';
import { applyFoilNative } from './foil-native-edit';
import { foilNodeSnapshot, foilNodeSnapshotFresh, applyFoilMaterialEdit } from './foil-material';
const material:FoilMaterialWire = {visible:true,baseColor:{r:.72,g:.71,b:.68,a:1},
  highlightColor:{r:.98,g:.92,b:.78,a:.6},lightAngle:120,intensity:.6,roughness:.45,flowSpeed:.25};
const recipe:FoilRecipeWire = {schema:'worldbend.foil@0.1',version:'0.1',recipeId:'warm-fold',recipeVersion:1,material};
const resource:FoilResourceEvidence = {importId:'import/build',paintId:'paint/build',sourceSha256:FOIL_NATIVE_SOURCE_SHA256};
const legacy:FoilResourceEvidence = {...resource,sourceSha256:'sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6'};
function fixture(id='node') {
  const data = new Map<string,string>(), props:Record<string,unknown> = {}, definitions:Record<string,unknown> = {};
  for (const [index,[name,value]] of Object.entries(material).entries()) {
    const key = `definition:${index}`; props[key] = structuredClone(value);
    definitions[key] = {name,type:typeof value==='boolean'?'BOOLEAN':typeof value==='number'?'NUMBER':'COLOR',defaultValue:value};
  }
  const parent = {id:'page',parent:null,removed:false,locked:false,resolvedVariableModes:{}};
  const node = {id,name:id,type:'RECTANGLE',parent,removed:false,locked:false,visible:true,width:400,height:250,
    relativeTransform:[[1,0,10],[0,1,20]],resolvedVariableModes:{collection:'mode-a'},
    fills:[{type:'SOLID',color:{r:.1,g:.1,b:.1}},
      {type:'SHADER',id:resource.paintId,properties:props,visible:true,opacity:.8,blendMode:'SCREEN'},
      {type:'SOLID',color:{r:1,g:1,b:1},opacity:.1}],effects:[{type:'DROP_SHADOW',radius:4}],
    getSharedPluginData:(_namespace:string,key:string)=>data.get(key)??'',
    setSharedPluginData:(_namespace:string,key:string,value:string)=>{data.set(key,value);}};
  const shader = {id:resource.importId,type:'fill',imported:true,propertyDefinitions:definitions};
  vi.stubGlobal('figma',{listAvailableShaders:async()=>[shader],variables:{getVariableByIdAsync:async()=>null}});
  return {node:node as unknown as SceneNode,mutable:node,data,props,definitions,shader};
}
afterEach(()=>vi.unstubAllGlobals());
function managed(f:ReturnType<typeof fixture>,evidence=resource) {
  f.data.set('foilResources',JSON.stringify({schema:'worldbend.foil-resources@0.1',version:'0.1',accepted:evidence,available:evidence}));
}
describe('Foil material chooser native boundary',()=>{
  it('reads only source-checked identities, distinguishes the legacy profile and reports unavailable states',async()=>{
    const f=fixture();
    expect(await foilNodeSnapshot(f.node)).toMatchObject({eligible:false,reason:'unverified',live:null});
    managed(f,legacy);
    expect(await foilNodeSnapshot(f.node)).toMatchObject({eligible:true,canChoose:false,canAdopt:false,profile:'worldbend.foil.prototype@0.1',live:material});
    f.mutable.fills=[];
    expect(await foilNodeSnapshot(f.node)).toMatchObject({eligible:true,state:'absent',live:null,canChoose:false});
    f.data.set('foilResources','broken');
    expect(await foilNodeSnapshot(f.node)).toMatchObject({eligible:false,reason:'invalid',live:null});
  });
  it('edits only opacity across independently colored native surfaces, preserving other assignments and recovering removal',async()=>{
    const a=fixture('a'),b=fixture('b');managed(a);managed(b);
    b.props['definition:1']={r:.1,g:.2,b:.3,a:.4};
    const observed=new Map(await Promise.all([a,b].map(async f=>[f.node.id,await foilNodeSnapshot(f.node)] as const)));
    expect((await applyFoilMaterialEdit([a.node,b.node],{family:'foil',recipe,material:{...material,baseColor:{...material.baseColor,a:.25}},
      fields:['base-color'],colorChannels:{'base-color':['a']}},observed)).ok).toBe(true);
    expect((a.mutable.fills[1] as any).properties['definition:1']).toEqual({...material.baseColor,a:.25});
    expect((b.mutable.fills[1] as any).properties['definition:1']).toEqual({r:.1,g:.2,b:.3,a:.25});
    expect((b.mutable.fills[1] as any).properties['definition:2']).toEqual(material.highlightColor);
    expect(b.mutable.effects).toEqual([{type:'DROP_SHADOW',radius:4}]);
    expect(await applyFoilMaterialEdit([a.node],{family:'foil',recipe,material,remove:true})).toMatchObject({ok:true,outcomes:[{nodeId:'a',outcome:'removed'}]});
    expect(await applyFoilMaterialEdit([a.node],{family:'foil',recipe,material})).toMatchObject({ok:true});
    expect((await foilNodeSnapshot(a.node)).provenance).toEqual(recipe);
  });
  it('refuses a changed variable before any multi-selection write, and rolls back the full selection on a failed later setter',async()=>{
    const a=fixture('a'),b=fixture('b');managed(a);managed(b);
    let intensity=.3;
    a.props['definition:4']={type:'VARIABLE_ALIAS',id:'shared-intensity'};
    (figma.variables.getVariableByIdAsync as any)=async()=>({id:'shared-intensity',resolveForConsumer:()=>({resolvedType:'FLOAT',value:intensity})});
    const old=await foilNodeSnapshot(a.node),observed=new Map([['a',old],['b',await foilNodeSnapshot(b.node)]]);
    const before=JSON.stringify([a.mutable.fills,b.mutable.fills]);
    intensity=.4;expect(foilNodeSnapshotFresh(old)).toBe(false);
    const edit={family:'foil' as const,recipe,material:{...material,roughness:.2},fields:['roughness' as const]};
    expect(await applyFoilMaterialEdit([a.node,b.node],edit,observed)).toMatchObject({ok:false,error:expect.stringContaining('E_FIGMA_CONFLICT')});
    expect(JSON.stringify([a.mutable.fills,b.mutable.fills])).toBe(before);
    const set=b.mutable.setSharedPluginData;let fail=true;
    b.mutable.setSharedPluginData=(ns,key,value)=>{set(ns,key,value);if(key==='foil'&&fail){fail=false;throw Error('failed after writing');}};
    expect(await applyFoilMaterialEdit([a.node,b.node],{family:'foil',recipe,material})).toMatchObject({ok:false,unrestoredNodeIds:[]});
    expect(JSON.stringify([a.mutable.fills,b.mutable.fills])).toBe(before);
    expect(a.data.get('foil')).toBe('');expect(b.data.get('foil')).toBe('');
  });
  it('rejects selection changes at the final async write edge without starting publication',async()=>{
    const f=fixture();managed(f);const observed=new Map([['node',await foilNodeSnapshot(f.node)]]),before=JSON.stringify(f.mutable.fills),publish=vi.fn();
    let current=true;
    (figma.listAvailableShaders as any)=async()=>{current=false;return[f.shader];};
    const result=await applyFoilMaterialEdit([f.node],{family:'foil',recipe,material},observed,()=>{if(!current)throw Error('selection changed');},publish);
    expect(result).toMatchObject({ok:false,error:expect.stringContaining('selection changed')});
    expect(publish).not.toHaveBeenCalled();expect(JSON.stringify(f.mutable.fills)).toBe(before);
  });
  it('reuses metadata only inside one operation while resolving shared variables independently for each consumer',async()=>{
    const a=fixture('a'),b=fixture('b');managed(a);managed(b);
    a.props['definition:4']=b.props['definition:4']={type:'VARIABLE_ALIAS',id:'shared'};
    const resolve=vi.fn((node:SceneNode)=>({resolvedType:'FLOAT',value:node.id==='a'?.2:.8}));
    const get=vi.fn(async()=>({id:'shared',resolveForConsumer:resolve})),list=vi.fn(async()=>[a.shader]);
    (figma.variables.getVariableByIdAsync as any)=get;(figma.listAvailableShaders as any)=list;
    const edit={family:'foil' as const,recipe,material:{...material,roughness:.15},fields:['roughness' as const]};
    expect((await applyFoilMaterialEdit([a.node,b.node],edit)).ok).toBe(true);
    // One read context and one independently fresh write context.
    expect(list).toHaveBeenCalledTimes(2);expect(get).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenCalledWith(a.node);expect(resolve).toHaveBeenCalledWith(b.node);
    expect((a.mutable.fills[1] as any).properties['definition:4']).toEqual({type:'VARIABLE_ALIAS',id:'shared'});
    expect((b.mutable.fills[1] as any).properties['definition:4']).toEqual({type:'VARIABLE_ALIAS',id:'shared'});
    expect((await foilNodeSnapshot(a.node)).live?.intensity).toBe(.2);
    expect((await foilNodeSnapshot(b.node)).live?.intensity).toBe(.8);
    expect(list).toHaveBeenCalledTimes(4);
  });
});
describe('Foil actual native capture and editing',()=>{
  it('validates RGBA, independent seed roundtrips and transported colors by value',()=>{
    expect(isFoilMaterialWire(material)).toBe(true);
    expect(isFoilMaterialWire({...material,highlightColor:{...material.highlightColor,a:1.1}})).toBe(false);
    expect(isFoilRecipeWire({...recipe,recipeVersion:2**32})).toBe(false);
    expect(sameFoilMaterial(material,JSON.parse(JSON.stringify(material)))).toBe(true);
    const roundtrip = structuredClone(material); roundtrip.baseColor.r=Math.fround(material.baseColor.r);
    expect(changedFoilFields(roundtrip,material)).toEqual([]);
    roundtrip.baseColor.a=.99999;
    expect(changedFoilFields(roundtrip,material)).toEqual(['base-color']);
  });
  it('reads definition IDs and actual assignments while separating paint composition and legacy semantics',async()=>{
    const f=fixture(); f.props['definition:4']=.9;
    const before=JSON.stringify(f.mutable);
    const result=await readFoilNative(f.node,legacy);
    expect(result.material?.intensity).toBe(.9);
    expect(result.paintIndex).toBe(1);
    expect(result.canApplyCurrentProfile).toBe(false);
    expect(result.paintModifiers).toEqual({visible:true,opacity:.8,blendMode:'SCREEN'});
    expect(result.warnings).toContain('legacy-highlight-opacity-ignored');
    expect(JSON.stringify(f.mutable)).toBe(before);
    delete f.props['definition:4'];
    await expect(readFoilNative(f.node,legacy)).rejects.toThrow('assignment is unreadable');
  });
  it('rejects unavailable resources and ambiguous slots without importing or choosing a default',async()=>{
    const f=fixture(); (figma.listAvailableShaders as any)=async()=>[];
    await expect(readFoilNative(f.node,resource)).rejects.toThrow('E_FIGMA_RESOURCE');
    (figma.listAvailableShaders as any)=async()=>[f.shader];
    f.mutable.fills.push(structuredClone(f.mutable.fills[1]!));
    await expect(readFoilNative(f.node,resource)).rejects.toThrow('E_FIGMA_AMBIGUOUS');
    expect((await readFoilNative(f.node,resource,3)).paintIndex).toBe(3);
  });
  it('accepts the API opaque RGB form while rejecting unreadable aliases and incompatible variables',async()=>{
    const f=fixture(); f.props['definition:1']={r:.2,g:.4,b:.6};
    expect((await readFoilNative(f.node,resource)).material?.baseColor).toEqual({r:.2,g:.4,b:.6,a:1});
    f.props['definition:1']={type:'VARIABLE_ALIAS',id:'missing'};
    await expect(readFoilNative(f.node,resource)).rejects.toThrow('variable is unavailable');
    (figma.variables.getVariableByIdAsync as any)=async()=>({id:'missing',resolveForConsumer:()=>({resolvedType:'FLOAT',value:.2})});
    await expect(readFoilNative(f.node,resource)).rejects.toThrow('incompatible type');
  });
  it('resolves aliases in the consumer mode, retains independent copies and catches in-place color edits',async()=>{
    const f=fixture(), color={r:.2,g:.4,b:.6}, variable={id:'color-var',resolveForConsumer:vi.fn(()=>({resolvedType:'COLOR',value:color}))};
    f.props['definition:1']={type:'VARIABLE_ALIAS',id:variable.id};
    (figma.variables.getVariableByIdAsync as any)=async()=>variable;
    const result=await readFoilNative(f.node,resource);
    expect(variable.resolveForConsumer).toHaveBeenCalledWith(f.node);
    expect(result.material?.baseColor).toEqual({...color,a:1});
    expect(result.bindings[0]?.value).toEqual(color);
    color.r=.8;
    expect(result.bindings[0]?.value).toEqual({r:.2,g:.4,b:.6});
    // Editing a transported presentation value cannot alter the cached proof.
    (result.bindings[0]!.value as {r:number}).r=.8;
    expect(()=>assertFoilSnapshotFresh(result)).toThrow('E_FIGMA_CONFLICT');
    const write=await applyFoilNative([{node:f.node,resource,expectedState:result.expectedState}],
      {action:'edit',material:{...material,intensity:.1},fields:['intensity']});
    expect(write).toMatchObject({ok:false,error:expect.stringContaining('E_FIGMA_CONFLICT')});
  });
  it('refuses a source or variable mode change while an asynchronous capture is pending',async()=>{
    const f=fixture(); f.props['definition:1']={type:'VARIABLE_ALIAS',id:'color-var'};
    (figma.variables.getVariableByIdAsync as any)=async()=>{
      f.mutable.resolvedVariableModes.collection='mode-b';
      return {id:'color-var',resolveForConsumer:()=>({resolvedType:'COLOR',value:material.baseColor})};
    };
    await expect(readFoilNative(f.node,resource)).rejects.toThrow('E_FIGMA_CONFLICT');
  });
  it('edits only selected values and keeps aliases, native extras, other fills/effects and the legacy build',async()=>{
    const f=fixture(); f.props['definition:1']={type:'VARIABLE_ALIAS',id:'color-var'}; f.props.extra=17;
    (figma.variables.getVariableByIdAsync as any)=async()=>({id:'color-var',resolveForConsumer:()=>({resolvedType:'COLOR',value:material.baseColor})});
    const result=await readFoilNative(f.node,legacy), before=JSON.parse(JSON.stringify(f.mutable));
    expect((await applyFoilNative([{node:f.node,resource:legacy,expectedState:result.expectedState}],
      {action:'edit',material:{...material,intensity:.2},fields:['intensity']})).ok).toBe(true);
    const paint=f.mutable.fills[1] as any;
    expect(paint.id).toBe(resource.paintId);
    expect(paint.properties['definition:4']).toBe(.2);
    expect(paint.properties['definition:1']).toEqual({type:'VARIABLE_ALIAS',id:'color-var'});
    expect(paint.properties.extra).toBe(17);
    expect({...paint,properties:before.fills[1]!.properties}).toEqual(before.fills[1]);
    expect(f.mutable.fills[0]).toEqual(before.fills[0]);
    expect(f.mutable.effects).toEqual(before.effects);
    expect(f.data.size).toBe(0);
    expect((await applyFoilNative([{node:f.node,resource:legacy,expectedState:(await readFoilNative(f.node,legacy)).expectedState}],
      {action:'choose',recipe,material}))).toMatchObject({ok:false,error:expect.stringContaining('explicit adoption')});
  });
  it('keeps current seed provenance through selective edits, native removal, reopen and reapplication',async()=>{
    const f=fixture(); let snapshot=await readFoilNative(f.node,resource);
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState}],{action:'choose',recipe,material})).ok).toBe(true);
    snapshot=await readFoilNative(f.node,resource);
    expect(snapshot.state).toBe('tagged');
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState}],
      {action:'edit',material:{...material,highlightColor:{...material.highlightColor,a:.3}},fields:['highlight-color']})).ok).toBe(true);
    snapshot=await readFoilNative(f.node,resource);
    expect(snapshot.customized).toEqual(['highlight-color']);
    expect(snapshot.recipe).toEqual(recipe);
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState}],{action:'remove'})).ok).toBe(true);
    snapshot=await readFoilNative(f.node,resource);
    expect(snapshot.state).toBe('removed');
    expect(snapshot.material).toBe(null);
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState}],{action:'choose',recipe,material})).ok).toBe(true);
    expect((await readFoilNative(f.node,resource)).state).toBe('tagged');
  });
  it('rechecks the first target after subsequent async reads and respects locked containers',async()=>{
    const a=fixture('a'),b=fixture('b');
    b.props['definition:4']={type:'VARIABLE_ALIAS',id:'b-intensity'};
    let concurrentChange=false;
    (figma.variables.getVariableByIdAsync as any)=async()=>{
      if(concurrentChange)a.props['definition:4']=.8;
      return {id:'b-intensity',resolveForConsumer:()=>({resolvedType:'FLOAT',value:.6})};
    };
    const snapshots=await Promise.all([readFoilNative(a.node,resource),readFoilNative(b.node,resource)]);
    concurrentChange=true;
    expect((await applyFoilNative([a,b].map((f,index)=>({node:f.node,resource,expectedState:snapshots[index]!.expectedState})),
      {action:'edit',material:{...material,intensity:.2},fields:['intensity']}))).toMatchObject({ok:false,error:expect.stringContaining('E_FIGMA_CONFLICT')});
    expect((b.mutable.fills[1] as any).properties['definition:4']).toEqual({type:'VARIABLE_ALIAS',id:'b-intensity'});
    a.mutable.parent.locked=true;
    const current=await readFoilNative(a.node,resource);
    expect((await applyFoilNative([{node:a.node,resource,expectedState:current.expectedState}],{action:'remove'}))).toMatchObject({ok:false,error:expect.stringContaining('locked')});
  });
  it('rolls back every target including a host setter that throws after modifying the current target',async()=>{
    const a=fixture('a'),b=fixture('b'), before=[a,b].map(f=>JSON.stringify(f.mutable.fills));
    const snapshots=await Promise.all([readFoilNative(a.node,resource),readFoilNative(b.node,resource)]);
    const set=b.mutable.setSharedPluginData; let fail=true;
    b.mutable.setSharedPluginData=(ns,key,value)=>{set(ns,key,value);if(fail){fail=false;throw Error('host setter');}};
    const result=await applyFoilNative([a,b].map((f,index)=>({node:f.node,resource,expectedState:snapshots[index]!.expectedState})),{action:'choose',recipe,material});
    expect(result).toMatchObject({ok:false,unrestoredNodeIds:[]});
    expect([a,b].map(f=>JSON.stringify(f.mutable.fills))).toEqual(before);
    expect([a,b].map(f=>f.data.get('foil'))).toEqual(['','']);
  });
  it('retains the requested values and resource while an async read yields to a later draft edit',async()=>{
    const f=fixture(), snapshot=await readFoilNative(f.node,resource), target={node:f.node,resource:{...resource},expectedState:snapshot.expectedState};
    const change={action:'edit' as const,material:structuredClone(material),fields:['intensity' as const]};
    change.material.intensity=.2;
    (figma.listAvailableShaders as any)=async()=>{
      change.material.intensity=12;target.resource.paintId='later/unrelated';target.expectedState='later';
      return [f.shader];
    };
    expect((await applyFoilNative([target],change)).ok).toBe(true);
    expect((f.mutable.fills[1] as any).properties['definition:4']).toBe(.2);
  });
  it('reads and edits explicit stacked slots without misassigning a per-surface seed or reseeding another fill',async()=>{
    const f=fixture();
    f.data.set('foil',JSON.stringify({schema:'worldbend.foil-native@0.1',version:'0.1',recipe,resource}));
    f.mutable.fills.push(structuredClone(f.mutable.fills[1]!));
    const snapshot=await readFoilNative(f.node,resource,3);
    expect(snapshot.recipe).toBe(null);expect(snapshot.warnings).toContain('seed-provenance-ambiguous');
    const before=JSON.stringify(f.mutable.fills);
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState,paintIndex:3}],{action:'choose',recipe,material})))
      .toMatchObject({ok:false,error:expect.stringContaining('E_FIGMA_AMBIGUOUS')});
    expect(JSON.stringify(f.mutable.fills)).toBe(before);
    expect((await applyFoilNative([{node:f.node,resource,expectedState:snapshot.expectedState,paintIndex:3}],
      {action:'edit',material:{...material,intensity:.2},fields:['intensity']})).ok).toBe(true);
    expect((f.mutable.fills[1] as any).properties['definition:4']).toBe(.6);
    expect((f.mutable.fills[3] as any).properties['definition:4']).toBe(.2);
  });
});
