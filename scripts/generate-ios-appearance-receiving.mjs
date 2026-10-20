import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';
import {withAppearancePlanner} from './appearance-planner-client.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const example=path.join(root,'examples/ios-material-receiving');
const check=process.argv.includes('--check');
await withAppearancePlanner(async run=>{
  const previous=JSON.parse(await readFile(path.join(example,'source.v1.json'),'utf8'));
  const next=JSON.parse(await readFile(path.join(example,'source.v2.json'),'utf8'));
  const first=await run('appearance_delivery',previous),second=await run('appearance_delivery',next);
  const local=await run('appearance_delivery',{...previous,material:{...previous.material,radius:12}});
  const forward=[],back=[];
  for(const live of [previous.material,local.material,null])forward.push(await run('appearance_update',{
    previous,next,live,expectedFingerprint:first.fingerprint,
  }));
  for(const live of [next.material,{...next.material,radius:12},null])back.push(await run('appearance_update',{
    previous:next,next:previous,live,expectedFingerprint:second.fingerprint,
  }));
  const files={'initial.json':first,'source.json':second,'local.json':local,'revision.json':{updates:forward},'restoration.json':{updates:back}};
  const opticalPrevious=JSON.parse(await readFile(path.join(example,'optical-source.v1.json'),'utf8'));
  const opticalNext=JSON.parse(await readFile(path.join(example,'optical-source.v2.json'),'utf8'));
  const opticalFirst=await run('appearance_delivery',opticalPrevious);
  const opticalSecond=await run('appearance_delivery',opticalNext);
  const opticalLocal=await run('appearance_delivery',{...opticalPrevious,material:{...opticalPrevious.material,radius:7}});
  files['optical-initial.json']=opticalFirst;
  files['optical-source.json']=opticalSecond;
  files['optical-local.json']=opticalLocal;
  files['optical-neutral.json']=await run('appearance_delivery',{...opticalPrevious,material:{...opticalPrevious.material,radius:0,refraction:0,dispersion:0,lightIntensity:0}});
  files['optical-revision.json']={updates:await Promise.all([opticalPrevious.material,opticalLocal.material,null].map(live=>run('appearance_update',{
    previous:opticalPrevious,next:opticalNext,live,expectedFingerprint:opticalFirst.fingerprint,
  })))};
  for(const [field,value] of Object.entries({refraction:0,depth:2,dispersion:1,radius:14,lightIntensity:0,lightAngle:60})) {
    files[`optical-${field}.json`]=await run('appearance_delivery',{...opticalPrevious,material:{...opticalPrevious.material,[field]:value}});
  }
  // Consumer preference fixtures: explicit overrides with their own revision.
  // The user keeps radius at the v1 default and an Agent fixes the highlight;
  // the v2 source raises radius and the update must keep the fixed value.
  const preference={
    schema:'worldbend.appearance-preference@0.1',version:'0.1',revision:3,
    fields:{radius:{value:opticalPrevious.material.radius,actor:'user'},'light-intensity':{value:0.9,actor:'agent'}},
  };
  const preferencePlan=record=>run('appearance_update',{
    previous:opticalPrevious,next:opticalNext,live:null,
    expectedFingerprint:opticalFirst.fingerprint,preference:record,
  });
  files['optical-preference.json']=preference;
  files['optical-preference-revision.json']={current:await preferencePlan(preference),stale:await preferencePlan({...preference,revision:2})};
  const output=path.join(example,'Receipts');
  const tests=path.join(root,'packages/swiftui/Tests/WorldbendAppearanceTests/Receipts');
  for(const folder of [output,tests]){
    await mkdir(folder,{recursive:true});
    for(const [name,value] of Object.entries(files)){
      const text=JSON.stringify(value,null,2)+'\n',file=path.join(folder,name);
      if(check)assertAppearanceReceiptMatches(await readFile(file,'utf8'), value,`Stale iOS receipt ${file}`);
      else await writeFile(file,text);
    }
  }
});
console.log('Canonical iOS appearance receiving receipts '+(check?'match':'generated'));
