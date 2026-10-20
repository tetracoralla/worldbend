import {afterEach,expect,it,vi} from 'vitest';
import {FOIL_NATIVE_SOURCE_SHA256} from './foil-resource.generated';
import {acquireFoilNativeResource,foilResourceExpected,readFoilResourceBinding} from './foil-native-resource';
import {readFoilNative} from './foil-native-read';
import {applyFoilNative} from './foil-native-edit';
import type {FoilMaterialWire,FoilRecipeWire} from './foil-wire';
const material:FoilMaterialWire={visible:true,baseColor:{r:.2,g:.4,b:.6,a:1},highlightColor:{r:.98,g:.92,b:.78,a:1},lightAngle:120,intensity:.6,roughness:.45,flowSpeed:.25};
const recipe:FoilRecipeWire={schema:'worldbend.foil@0.1',version:'0.1',recipeId:'foil-next',recipeVersion:1,material};
const old={importId:'old/build',paintId:'observed-old/build',sourceSha256:'sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6'};
const next={importId:'next/build',paintId:'observed-next/build',sourceSha256:FOIL_NATIVE_SOURCE_SHA256};
function definitions(prefix:string){return Object.fromEntries(Object.entries(material).map(([name,value],index)=>[prefix+index,{name,
  type:typeof value==='boolean'?'BOOLEAN':typeof value==='number'?'NUMBER':'COLOR',defaultValue:value}]));}
function fixture(){
  const data=new Map<string,string>(),oldDefinitions=definitions('p'),nextDefinitions=definitions('q');
  const props=Object.fromEntries(Object.entries(material).map(([,value],index)=>['p'+index,structuredClone(value)]));
  const page={id:'page',type:'PAGE',parent:null,removed:false,locked:false,resolvedVariableModes:{}};
  const node={id:'node',name:'Native',parent:page,removed:false,visible:true,locked:false,width:400,height:300,type:'RECTANGLE',
    resolvedVariableModes:{},relativeTransform:[[1,0,0],[0,1,0]],effects:[{type:'DROP_SHADOW',radius:4}],
    fills:[{type:'SHADER',id:old.paintId,properties:props,opacity:.6,visible:true,blendMode:'SCREEN'},
      {type:'SOLID',color:{r:.1,g:.2,b:.3}}],
    getSharedPluginData:(_ns:string,key:string)=>data.get(key)??'',
    setSharedPluginData:(_ns:string,key:string,value:string)=>{data.set(key,value);}};
  const oldShader={id:old.importId,type:'fill',imported:true,propertyDefinitions:oldDefinitions};
  const nextShader={id:next.importId,type:'fill',imported:false,propertyDefinitions:nextDefinitions};
  const probes:{removed:boolean;visible:boolean;name:string;fills:unknown[];remove:()=>void}[]=[];
  const api={
    listAvailableShaders:vi.fn(async()=>[oldShader,nextShader]),
    importShaderById:vi.fn(async(id:string)=>{expect(id).toBe(next.importId);nextShader.imported=true;return nextShader;}),
    createRectangle:vi.fn(()=>{
      let paints:unknown[]=[];
      const probe={removed:false,visible:true,name:'probe',get fills(){return paints;},set fills(value:unknown[]){
        paints=value.map(paint=>({...paint as any,id:(paint as any).id===next.importId?next.paintId:old.paintId}));},
        remove(){probe.removed=true;}};
      probes.push(probe);return probe;
    }),variables:{getVariableByIdAsync:vi.fn(async()=>null as any)}};
  vi.stubGlobal('figma',api);
  return {node:node as unknown as SceneNode,mutable:node,data,api,probes,nextShader,oldShader,props};
}
afterEach(()=>vi.unstubAllGlobals());
it('observes native aliases with an owned probe and separates acquired availability from the retained renderer',async()=>{
  const f=fixture();f.data.set('foilResources',JSON.stringify({schema:'worldbend.foil-resources@0.1',version:'0.1',accepted:old,available:old}));
  const before=JSON.stringify({fills:f.mutable.fills,effects:f.mutable.effects});
  const result=await acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node));
  expect(result.accepted).toEqual(old);expect(result.available).toEqual(next);
  expect(JSON.stringify({fills:f.mutable.fills,effects:f.mutable.effects})).toBe(before);
  expect(f.api.importShaderById).toHaveBeenCalledExactlyOnceWith(next.importId);
  expect(f.probes).toHaveLength(1);expect(f.probes[0]).toMatchObject({removed:true,visible:false});
  expect(readFoilResourceBinding(f.node)).toEqual(result);
  expect((await readFoilNative(f.node,old)).profile).toBe('worldbend.foil.prototype@0.1');
});
it('keeps already imported builds and records exact existing paint acceptance without another import',async()=>{
  const f=fixture();
  const result=await acquireFoilNativeResource(f.node,{importId:old.importId,sourceSha256:old.sourceSha256},foilResourceExpected(f.node));
  expect(f.api.importShaderById).not.toHaveBeenCalled();expect(result.accepted).toEqual(old);
});
it('checks scope and target state after discovery before import, and removes a failed owned probe',async()=>{
  const f=fixture(),expected=foilResourceExpected(f.node);
  f.api.listAvailableShaders.mockImplementation(async()=>{f.mutable.width=410;return [f.oldShader,f.nextShader];});
  await expect(acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},expected)).rejects.toThrow('E_FIGMA_CONFLICT');
  expect(f.api.importShaderById).not.toHaveBeenCalled();expect(f.probes).toHaveLength(0);
  f.api.listAvailableShaders.mockImplementation(async()=>[f.oldShader,f.nextShader]);
  f.api.createRectangle.mockImplementation(()=>{
    const probe={removed:false,visible:true,name:'probe',get fills(){return [];},set fills(_value:unknown[]){throw Error('native paint refusal');},remove(){probe.removed=true;}};
    f.probes.push(probe);return probe;
  });
  await expect(acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node))).rejects.toThrow('native paint refusal');
  expect(f.probes[0]?.removed).toBe(true);expect(f.data.size).toBe(0);
});
it('refuses unreadable defaults and rolls back a resource-record setter that throws after writing',async()=>{
  const f=fixture();delete (f.nextShader.propertyDefinitions.q4 as any).defaultValue;
  await expect(acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node))).rejects.toThrow('default');
  expect(f.probes).toHaveLength(0);expect(f.data.size).toBe(0);
  f.nextShader.propertyDefinitions.q4!.defaultValue=.6;
  const set=f.mutable.setSharedPluginData;let fail=true;
  f.mutable.setSharedPluginData=(ns,key,value)=>{set(ns,key,value);if(fail){fail=false;throw Error('record');}};
  await expect(acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node))).rejects.toThrow('record');
  expect(f.data.get('foilResources')).toBe('');expect(f.probes.every(probe=>probe.removed)).toBe(true);
});
it('requires acquisition then explicit adoption, remaps definition ids and retains unedited variable aliases',async()=>{
  const f=fixture();f.props.p1={type:'VARIABLE_ALIAS',id:'tint'};f.props.p4={type:'VARIABLE_ALIAS',id:'intensity'};
  f.api.variables.getVariableByIdAsync.mockImplementation(async(id?:string)=>({id,resolveForConsumer:()=>id==='tint'
    ?{resolvedType:'COLOR',value:material.baseColor}:{resolvedType:'FLOAT',value:.9}}));
  const before=await readFoilNative(f.node,old),desired={...before.material!,roughness:.2};
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:before.expectedState}],{action:'adopt',resource:next,material:desired,recipe})))
    .toMatchObject({ok:false,error:expect.stringContaining('Acquire')});
  await acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node));
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:before.expectedState}],{action:'adopt',resource:next,material:desired,recipe})))
    .toMatchObject({ok:false,error:expect.stringContaining('CONFLICT')});
  const fresh=await readFoilNative(f.node,old),extras=structuredClone({fill:f.mutable.fills[1],effects:f.mutable.effects});
  // Transport key order does not alter resource equality.
  const reordered={sourceSha256:next.sourceSha256,paintId:next.paintId,importId:next.importId};
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:fresh.expectedState}],{action:'adopt',resource:reordered,material:desired,recipe})).ok).toBe(true);
  const paint=f.mutable.fills[0] as any;
  expect(paint).toMatchObject({id:next.importId,opacity:.6,blendMode:'SCREEN',properties:{q1:{type:'VARIABLE_ALIAS',id:'tint'},q4:{type:'VARIABLE_ALIAS',id:'intensity'},q5:.2}});
  expect(Object.keys(paint.properties).some(key=>key.startsWith('p'))).toBe(false);
  expect({fill:f.mutable.fills[1],effects:f.mutable.effects}).toEqual(extras);
  expect(readFoilResourceBinding(f.node)?.accepted).toEqual(next);
  const after=await readFoilNative(f.node,next);expect(after.recipe).toEqual(recipe);expect(after.material).toEqual(desired);
  expect(after.customized).toEqual(['intensity','roughness']);
});
it('preserves explicit edits during adoption and refuses to silently discard extra native assignments',async()=>{
  const f=fixture();f.props.p4={type:'VARIABLE_ALIAS',id:'intensity'};
  f.api.variables.getVariableByIdAsync.mockImplementation(async()=>({id:'intensity',resolveForConsumer:()=>({resolvedType:'FLOAT',value:.9})}));
  await acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node));
  f.props.extra=17;
  let current=await readFoilNative(f.node,old);
  const before=JSON.stringify(f.mutable.fills);
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:current.expectedState}],{action:'adopt',resource:next,material:{...current.material!,intensity:.2},recipe})))
    .toMatchObject({ok:false,error:expect.stringContaining('Extra native')});
  expect(JSON.stringify(f.mutable.fills)).toBe(before);
  delete f.props.extra;current=await readFoilNative(f.node,old);
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:current.expectedState}],{action:'adopt',resource:next,material:{...current.material!,intensity:.2},recipe})).ok).toBe(true);
  expect((f.mutable.fills[0] as any).properties.q4).toBe(.2);
});
it('rolls back old paints, seed and resource records when adoption fails after writing the accepted renderer',async()=>{
  const f=fixture();await acquireFoilNativeResource(f.node,{importId:next.importId,sourceSha256:next.sourceSha256},foilResourceExpected(f.node));
  const current=await readFoilNative(f.node,old),beforeFills=JSON.stringify(f.mutable.fills),beforeResource=f.data.get('foilResources');
  const set=f.mutable.setSharedPluginData;let fail=true;
  f.mutable.setSharedPluginData=(ns,key,value)=>{set(ns,key,value);if(key==='foilResources'&&fail){fail=false;throw Error('accepted record');}};
  expect((await applyFoilNative([{node:f.node,resource:old,expectedState:current.expectedState}],{action:'adopt',resource:next,material:current.material!,recipe})))
    .toMatchObject({ok:false,unrestoredNodeIds:[]});
  expect(JSON.stringify(f.mutable.fills)).toBe(beforeFills);expect(f.data.get('foilResources')).toBe(beforeResource);expect(f.data.get('foil')).toBe('');
});
it('reports damaged resource records and repairs them only through explicit source-checked reacquisition',async()=>{
  const f=fixture();f.data.set('foilResources','damaged');
  expect(()=>readFoilResourceBinding(f.node)).toThrow('unreadable');
  const expected=foilResourceExpected(f.node),before=JSON.stringify(f.mutable.fills);
  await expect(acquireFoilNativeResource(f.node,{importId:old.importId,sourceSha256:old.sourceSha256},expected)).rejects.toThrow('unreadable');
  expect(f.api.createRectangle).not.toHaveBeenCalled();
  const result=await acquireFoilNativeResource(f.node,{importId:old.importId,sourceSha256:old.sourceSha256},expected,()=>{},true);
  expect(result.accepted).toEqual(old);expect(JSON.stringify(f.mutable.fills)).toBe(before);
});
