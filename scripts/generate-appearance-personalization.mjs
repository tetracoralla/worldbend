// Fixtures for the consumer personalization example: one no-Figma authored
// recipe, one exposure policy with both runtime resolutions, and the
// preference-based update plans (current + stale) used to verify revision
// guards and equal-to-default survival in a real browser.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'packages/web/examples/appearance-personalization');
const check=process.argv.includes('--check');

const sourceV1={
  recipe:{schema:'worldbend.appearance@0.1',version:'0.1',recipeId:'consumer-hero',recipeVersion:1,
    material:{visible:true,lightIntensity:0.5,lightAngle:90,refraction:0.35,depth:2,dispersion:0,radius:1}},
  material:{visible:true,lightIntensity:0.5,lightAngle:90,refraction:0.35,depth:2,dispersion:0,radius:1},
  target:'web',
};
const sourceV2={
  ...sourceV1,
  material:{...sourceV1.material,radius:5,refraction:0.55,depth:6},
};
const policy={
  schema:'worldbend.appearance-exposure-policy@0.1',version:'0.1',policyRevision:3,
  family:'glass',target:'web',scopes:['hero','toolbar'],
  exposed:[
    {field:'visible'},
    {field:'clarity',label:'Clear ↔ more solid',step:0.05},
    {field:'radius',min:0,max:40,step:1},
    {field:'refraction'},
    {field:'light-intensity'},
    {field:'splay'},
  ],
};
const preference={
  schema:'worldbend.appearance-preference@0.1',version:'0.1',revision:4,
  fields:{radius:{value:1,actor:'user'},'light-intensity':{value:0.8,actor:'agent'}},
};

await withAppearancePlanner(async run=>{
  const initial=await run('appearance_delivery',sourceV1);
  const sourceV2Delivery=await run('appearance_delivery',sourceV2);
  const exposure=await run('appearance_exposure',{policy,runtime:{optics:'svg-optics'}});
  const exposureFrost=await run('appearance_exposure',{policy,runtime:{optics:'frost-only'}});
  const planFor=record=>run('appearance_update',{
    previous:sourceV1,next:sourceV2,live:null,
    expectedFingerprint:initial.fingerprint,preference:record,policy,
  });
  const current=await planFor(preference);
  const stale=await planFor({...preference,revision:3});
  const files={
    'source.v1.json':sourceV1,'source.v2.json':sourceV2,
    'policy.json':policy,'preference.json':preference,
    'exposure.json':exposure,'exposure-frost.json':exposureFrost,
    'initial.json':initial,'source.v2.delivery.json':sourceV2Delivery,
    'update.json':{current,stale},
  };
  await mkdir(output,{recursive:true});
  for(const [name,value] of Object.entries(files)){
    const text=JSON.stringify(value,null,2)+'\n',file=path.join(output,name);
    if(check)assertAppearanceReceiptMatches(await readFile(file,'utf8'), value,`Stale personalization receipt ${name}; regenerate with scripts/generate-appearance-personalization.mjs`);
    else await writeFile(file,text);
  }
});
console.log('Consumer personalization receipts '+(check?'match':'generated'));
