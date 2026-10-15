// Source-MCP artifacts for a real live-backdrop receiving comparison.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,'packages/web/examples/appearance-color-study');
const check=process.argv.includes('--check');
const material={visible:true,lightIntensity:0,lightAngle:90,refraction:0,depth:10,dispersion:0,radius:0};
const recipe={schema:'worldbend.appearance@0.1',version:'0.1',recipeId:'color-study',recipeVersion:1,material};
await withAppearancePlanner(async run=>{
 const original=await run('appearance_delivery',{recipe,material,target:'web'});
 const refracted=await run('appearance_delivery',{recipe,material:{...material,refraction:1},target:'web'});
 const faithfulInput={recipe,material:{...material,refraction:1},target:'web-color-preserving'};
 const faithful=await run('appearance_delivery',faithfulInput);
 assert.notEqual(faithful.fingerprint,refracted.fingerprint);
 const exposure={};
 for(const target of ['web','web-color-preserving']){
  const policy={schema:'worldbend.appearance-exposure-policy@0.1',version:'0.1',policyRevision:1,family:'glass',target,
   scopes:['color-study'],exposed:[{field:'refraction'},{field:'radius',min:0,max:20},{field:'dispersion'}]};
  exposure[target]=await run('appearance_exposure',{policy,runtime:{optics:'svg-optics'}});
 }
 const fallbackPolicy={schema:'worldbend.appearance-exposure-policy@0.1',version:'0.1',policyRevision:1,family:'glass',target:'web-color-preserving',
  scopes:['color-study'],exposed:[{field:'refraction'},{field:'radius',min:0,max:20},{field:'dispersion'}]};
 const fallbackExposure=await run('appearance_exposure',{policy:fallbackPolicy,runtime:{optics:'frost-only'}});
 const result={original,refracted,faithful,faithfulInput,exposure,fallbackExposure};
 await mkdir(directory,{recursive:true});
 const file=path.join(directory,'plans.json'),text=JSON.stringify(result,null,2)+'\n';
 if(check)assertAppearanceReceiptMatches(await readFile(file,'utf8'), result,'Stale color study; regenerate the source receipts');
 else await writeFile(file,text);
});
console.log('Color study receipts '+(check?'match':'generated'));
