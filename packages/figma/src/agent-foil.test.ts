import {afterEach,expect,it,vi} from 'vitest';
import {readFoil,editFoil} from './agent-foil';
import {FOIL_NATIVE_SOURCE_SHA256} from './foil-resource.generated';
const resource={importId:'shader/build',paintId:'paint/build',sourceSha256:FOIL_NATIVE_SOURCE_SHA256};
const material={visible:true,baseColor:{r:.2,g:.4,b:.6,a:1},highlightColor:{r:.9,g:.8,b:.7,a:1},lightAngle:120,intensity:.6,roughness:.4,flowSpeed:.25};
function fixture() {
  const page={id:'page',type:'PAGE',removed:false,parent:null};
  const props:Record<string,unknown>={},definitions:Record<string,unknown>={};
  Object.entries(material).forEach(([name,value],index)=>{props[`${index}`]=value;definitions[`${index}`]={name,type:typeof value==='boolean'?'BOOLEAN':typeof value==='number'?'NUMBER':'COLOR'};});
  const node={id:'node',name:'箔✨'.repeat(1600),parent:page,type:'RECTANGLE',removed:false,visible:true,locked:false,width:400,height:300,
    resolvedVariableModes:{},fills:[{type:'SHADER',id:resource.paintId,properties:props}],effects:[],
    getSharedPluginData:()=>'',setSharedPluginData:vi.fn()};
  const api={fileKey:'file',currentPage:page,getNodeByIdAsync:vi.fn(async()=>node),
    listAvailableShaders:async()=>[{id:resource.importId,type:'fill',imported:true,propertyDefinitions:definitions}]};
  vi.stubGlobal('figma',api);
  return {api,node,input:{fileKey:'file',pageId:'page',nodeId:'node',resource}};
}
afterEach(()=>vi.unstubAllGlobals());
it('reads exact bounded Unicode state across fresh captures and rejects mixed parts after native edits',async()=>{
  const {node,input}=fixture(), first=await readFoil(input), parts=[first.json];
  expect(first.partCount).toBeGreaterThan(1);
  for(let part=1;part<first.partCount;part++)parts.push((await readFoil({...input,part,token:first.token})).json);
  const state=JSON.parse(parts.join(''));
  expect(state.name).toBe(node.name);expect(state.material).toEqual(material);
  node.name+='later';
  await expect(readFoil({...input,part:1,token:first.token})).rejects.toThrow('E_FIGMA_CONFLICT');
  expect(node.setSharedPluginData).not.toHaveBeenCalled();
});
it('rechecks the granted scope after async acquisition and returns mutation receipts without rereading',async()=>{
  const {api,node,input}=fixture();node.name='short';
  const state=JSON.parse((await readFoil(input)).json),calls=api.getNodeByIdAsync.mock.calls.length;
  const result=await editFoil({...input,expectedState:state.expectedState,change:{action:'edit',material:{...material,intensity:.2},fields:['intensity']}});
  expect(result).toMatchObject({ok:true,nextAction:'read-current-native-state'});
  expect(api.getNodeByIdAsync.mock.calls.length).toBe(calls+1);
  api.getNodeByIdAsync=vi.fn(async()=>{api.fileKey='other';return node;});
  await expect(readFoil(input)).rejects.toThrow('E_FIGMA_SCOPE');
});
