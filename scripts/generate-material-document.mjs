// One work, four existing material execution contracts. All receipts come
// from the source MCP; the independent receiving page only consumes artifacts.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'packages/web/examples/material-document');
const check=process.argv.includes('--check');
const rgba=(r,g,b,a=1)=>({r,g,b,a});
const fields={
  'mesh-gradient':{visible:true,colorTl:rgba(.96,.30,.15),colorTr:rgba(.05,.17,.15),colorBl:rgba(.94,.62,.36),colorBr:rgba(.40,.57,.49),warp:.57,softness:.48,durationMs:12000,phaseMs:900,flowSpeed:.32},
  texture:{visible:true,grain:.18,grainSize:1.2,grainColor:'#7b5a39',etch:.4,etchSize:3,clipToShape:true},
  foil:{visible:true,baseColor:rgba(.17,.22,.19),highlightColor:rgba(.87,.94,.56),lightAngle:130,intensity:.8,roughness:.45,flowSpeed:.25},
  glass:{visible:true,lightIntensity:.45,lightAngle:115,refraction:.25,depth:8,dispersion:0,radius:3},
};
const schemas={glass:'worldbend.appearance@0.1',texture:'worldbend.texture@0.1',foil:'worldbend.foil@0.1','mesh-gradient':'worldbend.mesh-gradient@0.1'};
const surfaces={glass:'edition-control',texture:'paper-note',foil:'foil-seal','mesh-gradient':'poster'};
const expressions=Object.entries(fields).map(([family,material])=>({
  kind:'material',id:surfaces[family],material:{family,input:{
    recipe:{schema:schemas[family],version:'0.1',recipeId:'field-notes-'+family,recipeVersion:1,material:structuredClone(material)},
    material:structuredClone(material),target:'web',...(family==='mesh-gradient'?{kernelProfile:'worldbend.mesh-gradient.rgba@0.2'}:{}),
  }},bindings:[{role:'content',slotId:surfaces[family],assetId:'field-notes'}],
}));
const document={schema:'worldbend.spatial-document',version:'0.1',assets:[{id:'field-notes',contentVersion:'edition-01'}],expressions};
await withAppearancePlanner(async run=>{
  const inspected=await run('document_inspect',{spec:document});
  const initial=await run('document_delivery_plan',{document,expectedFingerprint:inspected.fingerprint});
  const revised=structuredClone(expressions.find(e=>e.material.family==='mesh-gradient'));
  revised.material.input.material.colorTl=rgba(.13,.32,.43);
  revised.material.input.material.colorTr=rgba(.80,.23,.13);
  revised.material.input.material.colorBl=rgba(.11,.45,.41);
  revised.material.input.material.colorBr=rgba(.94,.68,.29);
  const update=await run('document_update_plan',{document,expectedFingerprint:inspected.fingerprint,
    revisions:[{assetId:'field-notes',contentVersion:'edition-02'}],expressions:[revised]});
  assert.equal(update.affectedExpressions.length,4);
  const next=await run('document_delivery_plan',{document:update.document,expectedFingerprint:update.fingerprint});
  const files={'document.json':document,'initial.json':initial,'update.json':update,'next.json':next};
  await mkdir(output,{recursive:true});
  for(const [name,value] of Object.entries(files)){
    const text=JSON.stringify(value,null,2)+'\n',file=path.join(output,name);
    if(check)assertAppearanceReceiptMatches(await readFile(file,'utf8'), value,`Stale material document receipt ${name}`);
    else await writeFile(file,text);
  }
});
console.log('Material document receipts '+(check?'match':'generated'));
