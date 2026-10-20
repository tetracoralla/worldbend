import { mkdtemp, mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { writeWebLegalMaterial } from './generate-plugin-legal.mjs';
import { publishImmutableArtifact } from './immutable-artifact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(await readFile(path.join(root,'plugins/worldbend/.codex-plugin/plugin.json'),'utf8'));
const source=JSON.parse(await readFile(path.join(root,'packages/web/package.json'),'utf8'));
const parent=path.join(root,'artifacts/web');await mkdir(parent,{recursive:true});
const staging=await mkdtemp(path.join(parent,'.stage-'));
let destination;
const packageRoot=path.join(staging,'package');
const run=(command,args,cwd=root)=>{const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});if(r.status!==0)throw new Error(`${command}: ${r.error??r.stderr}`);return r.stdout;};
try {
  await writeWebLegalMaterial({destination:packageRoot,version:manifest.version});
  await cp(path.join(root,'packages/web/dist'),path.join(packageRoot,'dist'),{recursive:true});
  await cp(path.join(root,'packages/web/examples'),path.join(packageRoot,'examples'),{recursive:true});
  await cp(path.join(root,'plugins/worldbend/skills/worldbend/references/live-web.md'),path.join(packageRoot,'README.md'));
  await cp(path.join(root,'docs/PLANE_POSE_CONTRACT.md'),path.join(packageRoot,'PLANE_POSE_CONTRACT.md'));
  await cp(path.join(root,'docs/CARD_CONTRACT.md'),path.join(packageRoot,'CARD_CONTRACT.md'));
  await cp(path.join(root,'docs/SURFACE_WINDOW_CONTRACT.md'),path.join(packageRoot,'SURFACE_WINDOW_CONTRACT.md'));
  await cp(path.join(root,'docs/SPATIAL_EFFECTS_CONTRACT.md'),path.join(packageRoot,'SPATIAL_EFFECTS_CONTRACT.md'));
  await cp(path.join(root,'docs/SPATIAL_APPEARANCE_CONTRACT.md'),path.join(packageRoot,'SPATIAL_APPEARANCE_CONTRACT.md'));
  await cp(path.join(root,'docs/SPATIAL_DOCUMENT_CONTRACT.md'),path.join(packageRoot,'SPATIAL_DOCUMENT_CONTRACT.md'));
  await cp(path.join(root,'docs/NATIVE_APPEARANCE_CONTRACT.md'),path.join(packageRoot,'NATIVE_APPEARANCE_CONTRACT.md'));
  // Vite has bundled every runtime import. Source-only workspace dependencies
  // must not escape into the independently installable local package.
  const pkg={name:source.name,version:manifest.version,private:true,license:'Apache-2.0',type:'module',exports:source.exports,files:['LICENSE','NOTICE','dist','examples','licenses','sbom','README.md','PLANE_POSE_CONTRACT.md','CARD_CONTRACT.md','SURFACE_WINDOW_CONTRACT.md','SPATIAL_EFFECTS_CONTRACT.md','SPATIAL_APPEARANCE_CONTRACT.md','SPATIAL_DOCUMENT_CONTRACT.md','THIRD_PARTY_NOTICES.md','NATIVE_APPEARANCE_CONTRACT.md']};
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  const archive=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',staging],packageRoot))[0];
  const bytes=await readFile(path.join(staging,archive.filename));
  // Keep authoring studies reachable from the installed Skill. They are inert
  // files opened only on request, not imported by any runtime entry. Exclude
  // development harnesses and video fixtures from the Agent archive.
  const studies=['effects.html','effects.css','effects-demo.js','effects-art.js',
    'stage.html','stage.css','stage.js','stage-art.js','stage-study.js','stage-native.js',
    'appearance.html','appearance.css','appearance-demo.js',
    'native-glass.html','native-glass-plan.json','assets/fronalpstock.jpg','assets/NOTICE.md',
    ...['index.html','initial.json','source.v1.json','source.v2.json','local.v1.json','local.v2.json','revision.json','native-extras.json'].map(file=>'appearance-receiving/'+file),
    'document.html','document.css','document-demo.js','document-showcase-plan.json','document-showcase-plan-release02.json'];
  const runtimeDirectory=path.join(staging,'runtime');await mkdir(runtimeDirectory);
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify({...pkg,files:[...pkg.files.filter(file=>file!=='examples'),...studies.map(file=>'examples/'+file)]},null,2)+'\n');
  const runtimeArchive=JSON.parse(run('npm',['pack','--ignore-scripts','--json','--pack-destination',runtimeDirectory],packageRoot))[0];
  const runtimeBytes=await readFile(path.join(runtimeDirectory,runtimeArchive.filename));
  await writeFile(path.join(packageRoot,'package.json'),JSON.stringify(pkg,null,2)+'\n');
  // Report actual static closures separately; importing perspective must not
  // pull the optional sampled-window renderer/WASM into an old consumer.
  async function closure(entry){
    const chunks=[],visited=new Set();
    async function visit(name){if(visited.has(name))return;visited.add(name);const data=await readFile(path.join(packageRoot,'dist',name));chunks.push({path:name,bytes:data.length,gzipBytes:gzipSync(data).length});for(const match of data.toString().matchAll(/from\s*["'](\.[^"']+\.js)["']/g))await visit(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));}
    await visit(entry);return chunks;
  }
  const chunks=await closure('perspective.js'),windowModules=await closure('surface-window.js'),effectModules=await closure('effects.js'),appearanceModules=await closure('appearance.js');
  for(const item of chunks){const code=await readFile(path.join(packageRoot,'dist',item.path),'utf8');if(code.includes('window_plan_json')||code.includes('Spatial window draw')||code.includes('effect_plan_json'))throw Error('Optional window runtime leaked into perspective');}
  const report={schema:'worldbend.web-package-observation.v0.1',version:pkg.version,archive:archive.filename,runtimeArchive:`runtime/${runtimeArchive.filename}`,runtimeArchiveBytes:runtimeBytes.length,runtimeArchiveSha256:createHash('sha256').update(runtimeBytes).digest('hex'),archiveBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),focusedModules:chunks,focusedBytes:chunks.reduce((sum,item)=>sum+item.bytes,0),focusedGzipBytes:chunks.reduce((sum,item)=>sum+item.gzipBytes,0),windowModules,windowBytes:windowModules.reduce((sum,item)=>sum+item.bytes,0),windowGzipBytes:windowModules.reduce((sum,item)=>sum+item.gzipBytes,0),effectModules,effectBytes:effectModules.reduce((sum,item)=>sum+item.bytes,0),effectGzipBytes:effectModules.reduce((sum,item)=>sum+item.gzipBytes,0),appearanceModules,appearanceBytes:appearanceModules.reduce((sum,item)=>sum+item.bytes,0),appearanceGzipBytes:appearanceModules.reduce((sum,item)=>sum+item.gzipBytes,0),productLicense:'Apache-2.0',runtimeDependencies:[]};
  await writeFile(path.join(staging,'package-report.json'),JSON.stringify(report,null,2)+'\n');
  // A disposable consumer outside the workspace proves no workspace:* or hidden
  // package-manager resolution is necessary, and executes the packed WASM.
  const consumer=await mkdtemp(path.join(tmpdir(),'worldbend-web-consumer-'));
  try {
    await writeFile(path.join(consumer,'package.json'),'{"private":true,"type":"module"}');
    run('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund',path.join(runtimeDirectory,runtimeArchive.filename)],consumer);
    for(const file of studies)await readFile(path.join(consumer,'node_modules/@worldbend/web/examples',file));
    await readFile(path.join(consumer,'node_modules/@worldbend/web/SPATIAL_APPEARANCE_CONTRACT.md'));
    await readFile(path.join(consumer,'node_modules/@worldbend/web/SPATIAL_DOCUMENT_CONTRACT.md'));
    await readFile(path.join(consumer,'node_modules/@worldbend/web/NATIVE_APPEARANCE_CONTRACT.md'));
    await readFile(path.join(consumer,'node_modules/@worldbend/web/CARD_CONTRACT.md'));
    const smoke=`import assert from 'node:assert/strict';
import {attachAppearance} from '@worldbend/web/appearance';
assert.equal(typeof attachAppearance,'function');
import {attachAppearanceGroup} from '@worldbend/web/appearance-receiving';
assert.equal(typeof attachAppearanceGroup,'function');
import {attachCardController,projectCardPose,sampleCardTurn,isCardRig} from '@worldbend/web/card';
assert.equal(typeof attachCardController,'function');
const cardRig={schema:'worldbend.card',version:'0.1',elementSize:{width:420,height:280},geometry:{perspective:1000},rest:{rotateY:180},tilt:{maxRotateX:10,maxRotateY:14},action:{turns:2}};
assert(isCardRig(cardRig));assert.equal((await projectCardPose({rig:cardRig})).face,'back');
assert.equal((await sampleCardTurn({rig:cardRig,progress:1})).angle,720);
import {projectPlanePose,projectPlaneStrip} from '@worldbend/web/perspective';
import {planSurfaceWindow} from '@worldbend/web/surface-window';
import {discoverEffects,createEffectRecipe,planEffect} from '@worldbend/web/effects';
const effects=await discoverEffects({version:'1',query:''});assert.equal(effects.effects.length,5);
const cameraEffects=await discoverEffects({version:'2',query:''});assert.equal(cameraEffects.effects.length,6);assert.equal(cameraEffects.effects[1].id,'multiplane-camera');assert.equal(cameraEffects.effects[1].content,'dom');
const currentEffects=await discoverEffects({version:'3',query:''});assert.equal(currentEffects.effects.length,6);assert.equal(currentEffects.effects[1].id,'multiplane-camera');assert.equal(currentEffects.effects[1].content,'texture');
const effectRecipe=await createEffectRecipe({effect:'rigid-tilt',version:'1',viewport:{width:600,height:400},intensity:.8});
const effectState={progress:.5,pointerX:.7,pointerY:-.4,reducedMotion:false};
const effectPlan=await planEffect({recipe:effectRecipe,state:effectState});
assert.deepEqual(await planEffect(JSON.parse(JSON.stringify({recipe:effectRecipe,state:effectState,expectedFingerprint:effectPlan.fingerprint}))),effectPlan);
const cameraRecipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
const cameraState={...effectState,pointerX:1,pointerY:1};
const cameraPlan=await planEffect({recipe:cameraRecipe,state:cameraState,motion:{previousState:{...cameraState,pointerX:-1},elapsedSeconds:.016}});assert(cameraPlan.frames.every(frame=>frame.coverage.viewportCovered));assert(cameraPlan.frames.some(frame=>Math.abs(frame.appearance.motionBlur.screenBlurVector.x)>0));
const windowSpec={schema:'worldbend.surface-window',version:'0.1',windowSize:{width:300,height:400},contentSize:{width:600,height:400},contentOrigin:{x:-300,y:0},pose:{perspective:1500,rotateY:-45,pivot:{x:0,y:.5},perspectiveOrigin:{x:0,y:.5}},frost:{baseRadius:0,spread:.1,maxRadius:30}};
const window=await planSurfaceWindow(windowSpec);assert.equal(window.visibility,'visible');assert.equal(window.mapping.sampleHomography.length,9);
assert.equal((await planSurfaceWindow({...windowSpec,pose:{...windowSpec.pose,rotateY:90}})).visibility,'edge-on');
const pose=await projectPlanePose({elementSize:{width:640,height:360},pose:{perspective:1400,rotateY:-12}});
assert.equal(pose.spec.schema,'worldbend.transform');
const strip=await projectPlaneStrip({spec:pose.spec,panels:[{id:'outer',start:0,end:.47,elementSize:{width:140,height:310}},{id:'inner',start:.53,end:1,elementSize:{width:140,height:310}}]});
assert.equal(strip.items.length,2);assert(strip.items.every(item=>item.css.transform.startsWith('matrix3d(')));
await assert.rejects(projectPlanePose({elementSize:{width:640,height:360},pose:{perspective:1400,depth:1400}}),error=>error.code==='E_HOMOGRAPHY_HORIZON_CROSSING');
console.log('Packed independent Web consumer passed');`;
    await writeFile(path.join(consumer,'smoke.mjs'),smoke);process.stdout.write(run('node',['smoke.mjs'],consumer));
    await writeFile(path.join(consumer,'consumer.ts'),`import {attachPlanePose,attachPerspective,attachPerspectiveStrip,normalizedSpec} from '@worldbend/web/perspective';
const container=document.createElement('div'),element=document.createElement('div');
import {attachCardController,type CardRig} from '@worldbend/web/card';
const cardRig:CardRig={schema:'worldbend.card',version:'0.1',elementSize:{width:420,height:280},geometry:{perspective:1000},tilt:{maxRotateX:10,maxRotateY:14},action:{turns:2}};
const card=attachCardController(element,cardRig);void card.ready;void card.update(cardRig);card.dispose();
import {attachAppearance} from '@worldbend/web/appearance';
import type {AppearanceDeliveryPlan} from '@worldbend/web/appearance';
declare const materialPlan:AppearanceDeliveryPlan;
const materialHandle=attachAppearance(element,materialPlan);materialHandle.update(materialPlan);materialHandle.setVisible(false);materialHandle.destroy();
import {attachAppearanceGroup,AppearanceUpdatePlan} from '@worldbend/web/appearance-receiving';
const materialGroup=attachAppearanceGroup([element],materialPlan);materialGroup.updateLocal(materialPlan);materialGroup.setVisible(undefined);
const materialUpdate:AppearanceUpdatePlan={schema:'worldbend.appearance-update@0.1',version:'0.1',previousFingerprint:materialPlan.fingerprint,previousDeliveryFingerprint:materialPlan.fingerprint,sourceFingerprint:materialPlan.fingerprint,delivery:materialPlan,preserved:[]};
materialGroup.update(materialUpdate);materialGroup.getState();materialGroup.remove();materialGroup.destroy();
// Local removal is an explicit null delivery; the typed contract must express it.
const materialRemoval:AppearanceUpdatePlan={...materialUpdate,delivery:null,previousDeliveryFingerprint:null};
materialGroup.update(materialRemoval);
const pose=attachPlanePose(element,{perspective:1400,rotateY:-8});
const saved=pose.getSpec();if(saved){const binding=attachPerspective(element,container,saved);void binding.update(saved);binding.dispose();}
const plane=normalizedSpec({tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}});
attachPerspectiveStrip(container,[{id:'one',element,start:0,end:1}],plane).dispose();
import {attachSurfaceWindow,SurfaceWindowSpec} from '@worldbend/web/surface-window';
const spec:SurfaceWindowSpec={schema:'worldbend.surface-window',version:'0.1',windowSize:{width:300,height:400},contentSize:{width:600,height:400},contentOrigin:{x:-300,y:0},pose:{perspective:1500},frost:{baseRadius:0,spread:.1,maxRadius:30}};
const live=attachSurfaceWindow(document.createElement('canvas'),document.createElement('canvas'),spec);void live.update(spec);live.pause();live.dispose();
import {createEffectRecipe,planEffect,attachEffect,attachDocumentEffect,attachFigmaEffectContinuation,attachSpatialInteractiveMediaBundle} from '@worldbend/web/effects';
import type {DocumentEffectBinding,FigmaEffectContinuation,SpatialDocumentDeliveryPlan,SpatialInteractiveMediaBundle} from '@worldbend/web/effects';
const recipe=await createEffectRecipe({effect:'rigid-tilt',version:'1',viewport:{width:600,height:400},intensity:.8});
const effect=await attachEffect(recipe,{content:{element}},{progress:1,pointerX:0,pointerY:0,reducedMotion:false});effect.dispose();
const camera=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
const decoded=document.createElement('canvas');decoded.width=720;decoded.height=480;
const cameraEffect=await attachEffect(camera,{background:{element:document.createElement('canvas'),source:decoded},middle:{element:document.createElement('canvas'),source:decoded},foreground:{element:document.createElement('canvas'),source:decoded}},{progress:1,pointerX:0,pointerY:0,reducedMotion:false});
void cameraEffect.update({progress:1,pointerX:.4,pointerY:0,reducedMotion:false},{previousState:{progress:1,pointerX:0,pointerY:0,reducedMotion:false},elapsedSeconds:1/60});cameraEffect.dispose();
const cameraFingerprint=(await planEffect({recipe:camera,state:{progress:1,pointerX:0,pointerY:0,reducedMotion:false}})).fingerprint;
const deliveryPlan:SpatialDocumentDeliveryPlan={schema:'worldbend.spatial-document-delivery-plan',version:'0.1',documentFingerprint:'sha256:'+('0'.repeat(64)),deliveries:[{kind:'interactive',id:'hero',recipe:camera,recipeFingerprint:cameraFingerprint,bindings:[{role:'content',slotId:'background',assetId:'art'},{role:'content',slotId:'middle',assetId:'art'},{role:'content',slotId:'foreground',assetId:'art'}]}]};
const documentEffect:DocumentEffectBinding=await attachDocumentEffect(deliveryPlan,'hero',{elements:{background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')},assets:{art:decoded}},{progress:1,pointerX:0,pointerY:0,reducedMotion:false});void documentEffect.replaceAsset('art',decoded);documentEffect.dispose();
const continuation:FigmaEffectContinuation={schema:'worldbend.figma-effect-continuation',version:'0.1',origin:{fileKey:'file',pageId:'1:1',nodeId:'2:1',revision:1,expected:'current'},sourceBindings:[{role:'background',assetId:'background',sourceNodeId:'3:1'},{role:'middle',assetId:'middle',sourceNodeId:'3:2'},{role:'foreground',assetId:'foreground',sourceNodeId:'3:3'}],expressionId:'figma-depth',initialState:{progress:1,pointerX:0,pointerY:0,reducedMotion:false},document:{schema:'worldbend.spatial-document',version:'0.1',assets:[{id:'background'},{id:'foreground'},{id:'middle'}],expressions:[{kind:'interactive',id:'figma-depth',recipe:camera,bindings:[{role:'content',slotId:'background',assetId:'background'},{role:'content',slotId:'middle',assetId:'middle'},{role:'content',slotId:'foreground',assetId:'foreground'}]}]},deliveryPlan:{...deliveryPlan,deliveries:[{...deliveryPlan.deliveries[0]!,id:'figma-depth',bindings:[{role:'content',slotId:'background',assetId:'background'},{role:'content',slotId:'middle',assetId:'middle'},{role:'content',slotId:'foreground',assetId:'foreground'}]}]},losses:['sourceMediaNotEmbedded','figmaPlacementNotTransferred']};
const continued=await attachFigmaEffectContinuation(continuation,{elements:{background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')},assets:{background:decoded,middle:decoded,foreground:decoded}});continued.dispose();
const media=[{assetId:'background',format:'png' as const,sha256:'a'.repeat(64),encodedBytes:100,width:720,height:480},{assetId:'foreground',format:'png' as const,sha256:'c'.repeat(64),encodedBytes:100,width:720,height:480},{assetId:'middle',format:'png' as const,sha256:'b'.repeat(64),encodedBytes:100,width:720,height:480}] as SpatialInteractiveMediaBundle['media'];
const bundle:SpatialInteractiveMediaBundle={schema:'worldbend.spatial-interactive-media-bundle',version:'0.1',fingerprint:'sha256:'+('4'.repeat(64)),expressionId:'hero',initialState:{progress:1,pointerX:0,pointerY:0,reducedMotion:false},media,document:{schema:'worldbend.spatial-document',version:'0.1',assets:media.map(item=>({id:item.assetId,contentVersion:'sha256:'+item.sha256})) as SpatialInteractiveMediaBundle['document']['assets'],expressions:[{kind:'interactive',id:'hero',recipe:camera,bindings:[{role:'content',slotId:'background',assetId:'background'},{role:'content',slotId:'middle',assetId:'middle'},{role:'content',slotId:'foreground',assetId:'foreground'}]}]},deliveryPlan:{...deliveryPlan,deliveries:[{...deliveryPlan.deliveries[0]!,bindings:[{role:'content',slotId:'background',assetId:'background'},{role:'content',slotId:'middle',assetId:'middle'},{role:'content',slotId:'foreground',assetId:'foreground'}]}]}};
const bundled=await attachSpatialInteractiveMediaBundle(bundle,{elements:{background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')},resolveAsset:()=>decoded});bundled.dispose();`);
    run(path.join(root,'node_modules/.bin/tsc'),['--noEmit','--strict','--target','es2022','--module','esnext','--moduleResolution','bundler','--lib','es2022,dom','consumer.ts'],consumer);
  } finally {await rm(consumer,{recursive:true,force:true});}
  // Versioned output is immutable; do not overwrite an earlier artifact.
  destination=path.join(parent,`${manifest.version}-${report.sha256.slice(0,12)}`);
  await publishImmutableArtifact(staging,destination);
  const output={...report,directory:destination};
  const reportIndex=process.argv.indexOf('--report-file');
  if(reportIndex!==-1){const outputPath=process.argv[reportIndex+1];if(!outputPath||!path.isAbsolute(outputPath))throw new Error('--report-file requires an absolute path');await writeFile(outputPath,JSON.stringify(output,null,2)+'\n');}
  console.log(JSON.stringify(output,null,2));
} catch(error){await rm(staging,{recursive:true,force:true});throw error;}
