import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'packages/web/examples/appearance-receiving');

/** Generate the example through the real Agent entry, never local optical math. */
export async function generateAppearanceReceipts({check=false}={}) {
  return withAppearancePlanner(async run=> {
    const previous=JSON.parse(await readFile(path.join(root,'examples/appearance-receiving.v1.worldbend.json'),'utf8'));
    const next=JSON.parse(await readFile(path.join(root,'examples/appearance-receiving.v2.worldbend.json'),'utf8'));
    const native=JSON.parse(await readFile(path.join(root,'examples/appearance-receiving-native-extras.json'),'utf8'));
    const initial=await run('appearance_delivery',previous),source=await run('appearance_delivery',next);
    const local1=await run('appearance_delivery',{...previous,material:{...previous.material,radius:12}});
    const local2=await run('appearance_delivery',{...next,material:{...next.material,radius:12}});
    const updates=[];
    for(const live of [previous.material,local1.material,null])updates.push(await run('appearance_update',{
      previous,next,live,expectedFingerprint:initial.fingerprint,
    }));
    // Consumer stream E1/E2 over the same Figma-derived source: the product
    // exposes the concise clarity composite (no raw radius) plus visibility,
    // a saved frost preference rides the composite, and the consumer-path
    // update plan merges by explicit intent instead of value difference.
    const policy={
      schema:'worldbend.appearance-exposure-policy@0.1',version:'0.1',policyRevision:2,
      family:'glass',target:'web',scopes:['ridge-walk'],
      exposed:[
        {field:'clarity',label:'Clear ↔ more solid',step:0.05},
        {field:'visible'},
      ],
    };
    const exposure=await run('appearance_exposure',{policy,runtime:{optics:'svg-optics'}});
    const preference={
      schema:'worldbend.appearance-preference@0.1',version:'0.1',revision:3,
      fields:{radius:{value:previous.material.radius,actor:'user'}},
    };
    const consumerUpdate=await run('appearance_update',{
      previous,next,live:null,expectedFingerprint:initial.fingerprint,preference,policy,
    });
    const files={'initial.json':initial,'source.v1.json':previous,'source.v2.json':next,'local.v1.json':local1,'local.v2.json':local2,'native-extras.json':native,'exposure.json':exposure,'preference.json':preference,'revision.json':{source,sourceInput:next,...native,updates,consumerUpdate,policy,preference}};
    await mkdir(output,{recursive:true});
    for(const [name,value] of Object.entries(files)) {
      const text=JSON.stringify(value,null,2)+'\n',file=path.join(output,name);
      if(check)assertAppearanceReceiptMatches(await readFile(file,'utf8'), value,`Stale receipt ${name}; regenerate the appearance example`);
      else await writeFile(file,text);
    }
    return files;
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  await generateAppearanceReceipts({check:process.argv.includes('--check')});
  console.log('Canonical appearance receiving receipts '+(process.argv.includes('--check')?'match':'generated'));
}
