// Source or installed-runtime check. Explicit roots select the actual artifacts; no installation.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=(flag,fallback)=>{const index=process.argv.indexOf(flag);if(index<0)return fallback;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw Error(flag+' requires a path');return path.resolve(process.argv[index+1]);};
const binRoot=option('--bin-root',path.join(root,'target/debug'));
const sdkRoot=option('--sdk-root',path.join(root,'packages/web'));
const {discoverEffects,createEffectRecipe,planEffect}=await import(pathToFileURL(path.join(sdkRoot,'dist/effects.js')).href);
const extension=process.platform==='win32'?'.exe':'';
const child=spawn(path.join(binRoot,`worldbend-mcp${extension}`),['--surface','catalog'],{cwd:root,stdio:['pipe','pipe','pipe']});
let stderr='';child.stderr.on('data',data=>stderr=(stderr+data).slice(-8000));
const pending=new Map();let id=0;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const response=JSON.parse(line),entry=pending.get(response.id);if(entry){clearTimeout(entry.timer);pending.delete(response.id);if(response.error)entry.reject(Error(JSON.stringify(response.error)));else entry.resolve(response.result);}});
child.on('exit',code=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error(`MCP exited ${code}: ${stderr}`));}pending.clear();});
child.on('error',error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();});
const send=(method,params)=>{const next=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(next);reject(Error(`Timeout: ${method}`));},15000);pending.set(next,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});};
const call=async(name,args)=>(await send('tools/call',{name,arguments:args})).structuredContent;
const fixture=await mkdtemp(path.join(tmpdir(),'worldbend-effects-smoke-'));
try {
  await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'effect-source-check',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  const tools=await send('tools/list',{});assert.deepEqual(tools.tools.map(t=>t.name).sort(),['worldbend.describe','worldbend.run','worldbend.search']);
  const catalogBytes=Buffer.byteLength(JSON.stringify(tools));assert(catalogBytes<=16384);
  const run=(operation,arguments_)=>call('worldbend.run',{operation,arguments:arguments_});
  for(const query of ['spatial expressions','空间 灵感'])assert((await call('worldbend.search',{query})).result.operations.some(o=>o.operation==='effect_catalog'));
  for(const operation of ['effect_catalog','effect_recipe','effect_plan']){
    const description=await call('worldbend.describe',{operation});assert.equal(description.ok,true);assert.equal(description.result.inputSchema.additionalProperties,false);
    if(operation!=='effect_plan')assert.deepEqual(description.result.inputSchema.properties.version.enum,['1','2','3']);
  }
  const query={version:'1',query:'',carrier:'web'},catalog=(await run('effect_catalog',query)).result;
  assert.deepEqual(catalog,await discoverEffects(query));assert.equal(catalog.effects.length,5);
  const currentQuery={...query,version:'2'},currentCatalog=(await run('effect_catalog',currentQuery)).result;
  assert.deepEqual(currentCatalog,await discoverEffects(currentQuery));assert.equal(currentCatalog.effects.length,6);assert.equal(currentCatalog.effects[1].id,'multiplane-camera');
  const appearanceQuery={...query,version:'3'},appearanceCatalog=(await run('effect_catalog',appearanceQuery)).result;
  assert.deepEqual(appearanceCatalog,await discoverEffects(appearanceQuery));assert.equal(appearanceCatalog.effects.length,6);assert.equal(appearanceCatalog.effects[1].content,'texture');
  assert.deepEqual((await run('effect_catalog',{...query,carrier:'figma'})).result.effects,[]);
  const figmaCatalog=(await run('effect_catalog',{...appearanceQuery,carrier:'figma'})).result;
  assert.deepEqual(figmaCatalog,await discoverEffects({...appearanceQuery,carrier:'figma'}));assert.deepEqual(figmaCatalog.effects.map(effect=>effect.id),['multiplane-camera']);assert.deepEqual(figmaCatalog.effects[0].carriers,['web','figma']);
  const swiftuiCatalog=(await run('effect_catalog',{...query,carrier:'swiftui'})).result;
  assert.deepEqual(swiftuiCatalog,await discoverEffects({...query,carrier:'swiftui'}));
  assert.deepEqual(swiftuiCatalog.effects.map(effect=>effect.id),['layered-depth']);
  assert.deepEqual(swiftuiCatalog.effects[0].carriers,['web','swiftui']);
  const swiftuiRecipe=(await run('effect_recipe',{effect:'layered-depth',version:'1',viewport:{width:390,height:844},intensity:.8})).result;
  assert.equal(swiftuiRecipe.layers.length,3);
  for(const layer of swiftuiRecipe.layers){
    assert.equal(layer.surface.kind,'plane');
    assert.deepEqual(layer.tracks.map(track=>track.property).sort(),['translate-x','translate-y']);
    assert(layer.tracks.every(track=>track.curve==='linear'));
  }
  const state={progress:.35,pointerX:.7,pointerY:-.4,reducedMotion:false},fingerprints={};
  const near=(a,b)=>{if(typeof a==='string'&&typeof b==='string'&&a.startsWith('matrix3d(')&&b.startsWith('matrix3d(')){near(a.slice(9,-1).split(',').map(Number),b.slice(9,-1).split(',').map(Number));return;}if(typeof a==='number'&&typeof b==='number'){assert(Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);return;}if(a&&b&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const key of Object.keys(a))near(a[key],b[key]);}else assert.deepEqual(a,b);};
  const cli=async(command,input)=>{const file=path.join(fixture,'request.json');await writeFile(file,JSON.stringify(input));const r=spawnSync(path.join(binRoot,`worldbend${extension}`),[command,'--input',file,'--json'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout).result;};
  for(const row of catalog.effects){
    const input={effect:row.id,version:'1',viewport:{width:600,height:400},intensity:.8};
    const result=await run('effect_recipe',input);assert.equal(result.ok,true);const recipe=result.result;
    assert.deepEqual(recipe,await createEffectRecipe(input));assert.deepEqual(recipe,await cli('effect-recipe',input));
    const zeroRecipe=(await run('effect_recipe',{...input,intensity:0})).result;
    assert.deepEqual(zeroRecipe,await createEffectRecipe({...input,intensity:0}));
    near((await run('effect_plan',{recipe:zeroRecipe,state})).result,await planEffect({recipe:zeroRecipe,state}));
    const first=(await run('effect_plan',{recipe,state})).result;fingerprints[row.id]=first.fingerprint;
    assert.deepEqual(first,await cli('effect-plan',{recipe,state}));
    for(const progress of [0,.35,1,.75,0]){
      const request={recipe,state:{...state,progress},expectedFingerprint:first.fingerprint};const result=await run('effect_plan',request);assert.equal(result.ok,true);near(result.result,await planEffect(request));
      assert.deepEqual(result,await run('effect_plan',JSON.parse(JSON.stringify(request))));
    }
    const changed=structuredClone(recipe);changed.layers[0].offset.x+=1;
    assert.equal((await run('effect_plan',{recipe:changed,state,expectedFingerprint:first.fingerprint})).error.code,'E_SCHEMA');
    assert.equal((await run('effect_plan',{recipe,state:{...state,progress:2}})).error.code,'E_SCHEMA');
    assert.equal((await run('effect_plan',{recipe,state:{...state,unexpected:true}})).error.code,'E_SCHEMA');
    assert.equal((await run('effect_plan',{recipe,state})).ok,true);
  }
  const cameraInput={effect:'multiplane-camera',version:'2',viewport:{width:600,height:400},intensity:.8};
  const cameraRecipe=(await run('effect_recipe',cameraInput)).result;
  assert.deepEqual(cameraRecipe,await createEffectRecipe(cameraInput));assert.deepEqual(cameraRecipe,await cli('effect-recipe',cameraInput));
  assert.deepEqual(cameraRecipe.layers.map(layer=>layer.surface.kind),['camera-plane','camera-plane','camera-plane']);
  for(const pointerX of [-1,0,1])for(const pointerY of [-1,0,1]){
    const request={recipe:cameraRecipe,state:{...state,pointerX,pointerY}};
    const plan=(await run('effect_plan',request)).result;near(plan,await planEffect(request));assert.deepEqual(plan,await cli('effect-plan',request));assert(plan.frames.every(frame=>frame.coverage.viewportCovered));
  }
  const appearanceInput={...cameraInput,version:'3'},appearanceRecipe=(await run('effect_recipe',appearanceInput)).result;
  assert.deepEqual(appearanceRecipe,await createEffectRecipe(appearanceInput));assert.deepEqual(appearanceRecipe,await cli('effect-recipe',appearanceInput));
  assert.equal(appearanceRecipe.camera.focusDistance,1000);assert.equal(appearanceRecipe.appearance.depthOfField.focusDistance,1000);
  const previousState={...state,pointerX:0,pointerY:0},motion={previousState,elapsedSeconds:1/60};
  const appearanceRequest={recipe:appearanceRecipe,state:{...state,pointerX:.9,pointerY:-.5},motion};
  const appearancePlan=(await run('effect_plan',appearanceRequest)).result;near(appearancePlan,await planEffect(appearanceRequest));assert.deepEqual(appearancePlan,await cli('effect-plan',appearanceRequest));
  assert(appearancePlan.frames.every(frame=>frame.appearance&&frame.appearance.motionBlur));assert(appearancePlan.frames.some(frame=>Math.abs(frame.appearance.motionBlur.screenVelocity.x)>0));
  const mapped=structuredClone(appearanceRecipe);mapped.origin=null;mapped.layers[0].surface.depthMap={nearDistance:900,farDistance:1800};
  const mappedPlan=(await run('effect_plan',{recipe:mapped,state})).result;assert.deepEqual(mappedPlan.frames[0].appearance.depthOfField.depthMap,{nearDistance:900,farDistance:1800});
  const focused=structuredClone(appearanceRecipe);focused.origin=null;focused.appearance.depthOfField.focusDistance=650;assert.equal(focused.camera.focusDistance,1000);assert.equal((await run('effect_plan',{recipe:focused,state})).result.frames[2].appearance.depthOfField.blurRadius,0);
  assert.equal((await run('effect_plan',{recipe:appearanceRecipe,state,motion:{previousState,elapsedSeconds:0}})).error.code,'E_SCHEMA');
  assert.equal((await run('effect_recipe',{...cameraInput,version:'1'})).error.code,'E_SCHEMA');
  assert.equal((await run('effect_recipe',{effect:'rigid-tilt',version:'4',viewport:{width:600,height:400},intensity:.8})).error.code,'E_SCHEMA');
  assert.equal((await run('effect_recipe',{effect:'rigid-tilt',version:'1',viewport:{width:1,height:400},intensity:.8})).error.code,'E_OUTPUT_LIMIT');
  const output={outcome:'PASS',catalogTools:tools.tools.length,catalogBytes,fingerprints,cameraFingerprint:(await planEffect({recipe:cameraRecipe,state})).fingerprint,appearanceFingerprint:appearancePlan.fingerprint,checks:['intent discovery','exact closed schemas','version-1 compatibility','version-2 shared-camera discovery','version-3 spatial appearance discovery','Figma version-3 camera discovery','independent optical focus','explicit depth-map metadata','history-free motion exposure','coverage diagnostics','catalog and recipe parity','SwiftUI layered-depth discovery and translation-only recipe','CLI/MCP exact plans','WASM numeric plans','same-input replay','reverse states','fingerprint mismatch','invalid state and recovery','unsupported version and carrier']};
  console.log(JSON.stringify(output,null,2));
} finally {child.kill();lines.close();await rm(fixture,{recursive:true,force:true});}
