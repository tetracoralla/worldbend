import {canvasReadbackScript} from './webgpu-readback.mjs';
// Canonical source-MCP artifacts -> independent built receiving project.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {withAppearancePlanner} from './appearance-planner-client.mjs';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const webRoot=path.resolve(flag('--web-root')??path.join(root,'packages/web'));
const evidence=flag('--evidence')?path.resolve(flag('--evidence')):undefined;if(evidence)await mkdir(evidence,{recursive:true});
const source=JSON.parse(await readFile(path.join(webRoot,'examples/material-document/document.json'),'utf8'));
const update=JSON.parse(await readFile(path.join(webRoot,'examples/material-document/update.json'),'utf8'));
const plans={};
await withAppearancePlanner(async run=>{
  async function plan(document){const inspection=await run('document_inspect',{spec:document});return run('document_delivery_plan',{document,expectedFingerprint:inspection.fingerprint})}
  plans.initial=await plan(source);plans.next=await plan(update.document);
  const paper=structuredClone(update.document),poster=paper.expressions.find(e=>e.id==='poster'),texture=paper.expressions.find(e=>e.material?.family==='texture');
  poster.material=structuredClone(texture.material);poster.material.input.recipe.recipeId='field-notes-paper-poster';
  plans.paper=await plan(paper);
  const extra=structuredClone(update.document);extra.expressions.find(e=>e.id==='poster').bindings.push({role:'content',slotId:'extra-poster',assetId:'field-notes'});plans.extra=await plan(extra);
});
const test=String.raw`
${canvasReadbackScript}
import {attachMaterialDocument} from '/dist/material-document.js';
import {attachFoil} from '/dist/foil.js';import {attachTexture} from '/dist/texture.js';import {attachMeshGradient} from '/dist/mesh-gradient.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw Error(message)};
const rejected=async(work,message)=>{try{await work()}catch{return}throw Error(message)};
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};
const pixels=host=>readGpuPixels(host.querySelector('canvas'));
const equal=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
try{
  for(let n=0;n<500&&!globalThis.worldbendExample?.getState().ready;n++)await wait(10);
  const app=globalThis.worldbendExample;assert(app?.getState().ready,'The ordinary material work did not open');
  const p=await(await fetch('/plans.json')).json();
  const parent=document.createElement('section');parent.style.cssText='position:absolute;top:0;left:0;z-index:10;display:grid;grid-template-columns:repeat(2,320px)';document.body.append(parent);
  const hosts=new Map();for(const id of ['poster','paper-note','foil-seal','edition-control','extra-poster']){const host=document.createElement('article');host.style.cssText='width:320px;height:240px;background:#ece4d2';host.innerHTML='<button>Keep this action</button>';parent.append(host);hosts.set(id,host)}
  const children=[...hosts].map(([id,h])=>[id,h.firstChild]);let clicks=0;hosts.get('poster').firstChild.addEventListener('click',()=>clicks++);
  const devices=[],realAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter=async(...args)=>{const adapter=await realAdapter(...args);if(!adapter)return null;return new Proxy(adapter,{get(target,key){if(key==='requestDevice')return async(...args)=>{const device=await target.requestDevice(...args);devices.push(device);return device};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})};
  const callbackErrors=[];const trap=event=>{if(event.message?.includes('host material reporter')){event.preventDefault();callbackErrors.push(event.message);}};addEventListener('error',trap);
  const session=await attachMaterialDocument(p.initial,{resolveSurface:b=>hosts.get(b.slotId),paused:true,onError:()=>{throw Error('host material reporter')}});session.setPaused(true);
  const nodes=()=>[...hosts].map(([id,h])=>[id,...h.querySelectorAll('canvas,svg,.worldbend-texture')]);
  const original=nodes(),before=session.getState(),beforePixels=await pixels(hosts.get('poster'));
  const invalid=structuredClone(p.next);invalid.deliveries.find(d=>d.material.family==='texture').material.delivery.material.grain=2;
  await rejected(()=>session.revise(invalid,before.guard),'A malformed late family was accepted');
  assert(session.getState().guard.documentFingerprint===before.guard.documentFingerprint,'Invalid candidate replaced accepted work');
  assert(original.every(([id,...items])=>items.every(n=>n.parentElement===hosts.get(id))),'Preflight removed existing resources');
  await session.revise(p.next,before.guard);
  const afterPixels=await pixels(hosts.get('poster'));assert(!equal(beforePixels,afterPixels),'The canonical material revision changed no actual pixels '+JSON.stringify({beforeNonzero:beforePixels.filter(n=>n!==0).length,afterNonzero:afterPixels.filter(n=>n!==0).length,state:session.getState().surfaces}));
  assert(original.every(([id,...items])=>items.every(n=>n.parentElement===hosts.get(id))),'A compatible revision remounted successful surfaces');
  assert(session.getState().surfaces.filter(s=>s.time!==undefined).every(s=>s.time===0),'A paused revision advanced or restarted clocks');
  await rejected(()=>session.revise(p.initial,before.guard),'An earlier Agent revision was accepted');
  const guard=session.getState().guard;session.setPaused(false);session.setPaused(true);
  await rejected(()=>session.revise(p.initial,guard),'A human runtime change failed to invalidate an earlier guard');
  // Every new family prepares off the host. Failed acquisition keeps the old edition.
  await session.revise(p.paper,session.getState().guard);
  assert(!hosts.get('poster').querySelector('canvas')&&hosts.get('poster').querySelector('.worldbend-texture'),'Family replacement retained the old renderer or lost paper');
  assert(getComputedStyle(hosts.get('poster')).position!=='static','Retiring a GPU binding undid the retained paper positioning');
  const paperState=session.getState(),paperNodes=nodes(),request=navigator.gpu.requestAdapter.bind(navigator.gpu);
  navigator.gpu.requestAdapter=async()=>null;
  await rejected(()=>session.revise(p.next,paperState.guard),'Unavailable new GPU family was accepted');
  navigator.gpu.requestAdapter=request;
  assert(session.getState().guard.documentFingerprint===paperState.guard.documentFingerprint&&paperNodes.every(([id,...items])=>items.every(n=>n.parentElement===hosts.get(id))),'A failed family choice damaged the accepted edition');
  await session.revise(p.next,session.getState().guard);assert(hosts.get('poster').querySelector('canvas'),'Retry failed to restore the requested family');
  let release,requested=false;navigator.gpu.requestAdapter=()=>{requested=true;return new Promise(resolve=>release=resolve)};
  const controller=new AbortController(),pending=session.revise(p.extra,session.getState().guard,controller.signal);
  for(let n=0;n<100&&!requested;n++)await wait(5);assert(requested,'The new receiving surface was not prepared');
  assert(!hosts.get('extra-poster').querySelector('canvas'),'Pending addition became visible before commit');
  await rejected(()=>session.revise(p.initial,session.getState().guard),'Concurrent document writes were accepted');
  controller.abort();await rejected(()=>pending,'Cancelled addition completed');navigator.gpu.requestAdapter=request;release(await request());await wait(20);
  assert(!hosts.get('extra-poster').querySelector('canvas')&&!session.getState().busy,'Cancelled acquisition kept resources or busy state');
  // Recreated receiving components invalidate an in-flight publication target.
  requested=false;navigator.gpu.requestAdapter=()=>{requested=true;return new Promise(resolve=>release=resolve)};
  const redirected=session.revise(p.extra,session.getState().guard);for(let n=0;n<100&&!requested;n++)await wait(5);assert(requested,'Surface replacement fixture did not acquire');
  const oldExtra=hosts.get('extra-poster'),newExtra=document.createElement('article');newExtra.style.cssText=oldExtra.style.cssText;parent.append(newExtra);hosts.set('extra-poster',newExtra);
  navigator.gpu.requestAdapter=request;release(await request());await rejected(()=>redirected,'A replaced surface accepted stale publication');
  assert(!oldExtra.querySelector('canvas')&&!newExtra.querySelector('canvas'),'Rejected target change left a material on either surface');hosts.set('extra-poster',oldExtra);newExtra.remove();
  await session.revise(p.extra,session.getState().guard);assert(hosts.get('extra-poster').querySelector('canvas'),'Cancelled surface could not be retried');
  const kept=hosts.get('poster').querySelector('canvas');await session.revise(p.next,session.getState().guard);
  assert(!hosts.get('extra-poster').querySelector('canvas')&&hosts.get('poster').querySelector('canvas')===kept,'Topology removal damaged an unrelated surface');
  children.find(([id])=>id==='poster')[1].click();assert(clicks===1&&children.every(([id,c])=>c.parentElement===hosts.get(id)),'Material continuation replaced host content/actions');
  await session.recover();assert(hosts.get('poster').querySelector('canvas')===kept,'Ordinary recovery rebuilt a healthy renderer');
  const healthyMesh=hosts.get('poster').querySelector('canvas'),foilCanvas=hosts.get('foil-seal').querySelector('canvas'),beforeLoss=session.getState().guard;
  devices[1].destroy();await wait(30);assert(callbackErrors.length===0,'The material error reporter escaped the receiving boundary');assert(session.getState().surfaces.find(s=>s.family==='foil').status==='lost','Actual owned GPU device loss was hidden');
  await rejected(()=>session.revise(p.initial,beforeLoss),'Device loss did not invalidate the old runtime guard');
  await session.recover();assert(session.getState().surfaces.every(s=>s.status==='ready')&&hosts.get('poster').querySelector('canvas')===healthyMesh&&hosts.get('foil-seal').querySelector('canvas')===foilCanvas,'Device recovery discarded healthy work or failed to restore the owned renderer');
  session.setPaused(true);assert((await pixels(hosts.get('foil-seal'))).some((n,i)=>i%4===3&&n>0),'Recovered GPU material rendered no pixels');
  hosts.get('poster').style.position='sticky';
  // A final destroy during preparation retires late acquisition and leaves host edits intact.
  requested=false;navigator.gpu.requestAdapter=()=>{requested=true;return new Promise(resolve=>release=resolve)};const last=session.revise(p.extra,session.getState().guard);for(let n=0;n<100&&!requested;n++)await wait(5);assert(requested,'Retirement fixture did not start acquisition');session.destroy();await rejected(()=>last,'Destroy failed to cancel pending work');navigator.gpu.requestAdapter=request;release(await request());await wait(20);
  assert(session.getState().destroyed&&[...hosts].every(([id,h])=>!h.querySelector('canvas,svg,.worldbend-texture')&&h.style.position===(id==='poster'?'sticky':'')),'Retirement leaked resources or host positioning');parent.remove();
  // An older empty lease cannot delete the environment owned by a later binding.
  const environment=document.createElement('article');environment.style.cssText='position:relative;width:200px;height:120px;background:#ddd';document.body.append(environment);
  const foilPlan=p.initial.deliveries.find(d=>d.material.family==='foil').material.delivery,texturePlan=p.initial.deliveries.find(d=>d.material.family==='texture').material.delivery,meshPlan=p.initial.deliveries.find(d=>d.material.family==='mesh-gradient').material.delivery;
  const firstEnvironment=await attachFoil(environment,foilPlan,{paused:true}),emptyLease=attachTexture(environment,texturePlan);firstEnvironment.destroy();
  const nextEnvironment=await attachMeshGradient(environment,meshPlan,{paused:true});emptyLease.destroy();
  const survivingEnvironment=await attachFoil(environment,foilPlan,{paused:true});nextEnvironment.destroy();
  assert(getComputedStyle(environment).isolation==='isolate','An older empty lease erased a later material environment');survivingEnvironment.destroy();
  assert(environment.style.position==='relative'&&environment.style.isolation==='','Environment retirement changed authored positioning or kept isolation');environment.remove();
  // Operate the ordinary human entry with trusted input, then reopen its saved edition.
  const button=document.getElementById('next'),box=button.getBoundingClientRect();
  await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x+15,y:box.y+15,button:'left',clickCount:1});await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+15,y:box.y+15,button:'left',clickCount:1});
  for(let n=0;n<200&&app.getState().edition!==2;n++)await wait(10);assert(app.getState().edition===2&&app.getState().originalContentRetained,'Human next edition failed');
  const title=document.getElementById('title'),authoredTitle=title.innerHTML;title.textContent='Continued local title';document.getElementById('pause').click();await wait(10);assert(title.textContent==='Continued local title','Pause rewrote host content');
  const currentCanvas=document.getElementById('poster').querySelector('canvas');document.getElementById('restart').click();await wait(20);assert(currentCanvas===document.getElementById('poster').querySelector('canvas')&&title.textContent==='Continued local title','Human reopen discarded a healthy surface or local content');title.innerHTML=authoredTitle;
  await trusted('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5},'continued-material-work');
  await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(25);assert(app.getState().materialStates.filter(s=>s.time!==undefined).every(s=>s.reducedMotion),'Actual reduced motion did not reach all GPU surfaces');
  await trusted('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},'continued-material-work-mobile');assert(document.documentElement.scrollWidth<=390,'The continued work overflows a narrow receiver');
  globalThis.__WORLDBEND_PARITY__={ok:true,canonicalMcpArtifacts:true,allFamilyPreflight:true,actualRevisedPixels:true,healthySurfacesAndClocksRetained:true,staleAgentRejected:true,humanRuntimeGuard:true,familyReplacement:true,failedFamilyRetained:true,retry:true,topologyAddRemove:true,targetReplacementGuard:true,actualDeviceLossAndRecovery:true,cancelAndLateRetirement:true,concurrentWriteRejected:true,hostContentAndActionsRetained:true,hostStyleEditsRetained:true,environmentLeaseGeneration:true,healthyRecoveryRetained:true,trustedHumanNextEdition:true,actualReducedMotion:true,mobileReflow:true};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
`;
const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');let data,type;
  if(url.pathname==='/test.js'){data=test;type='text/javascript'}else if(url.pathname==='/plans.json'){data=JSON.stringify(plans);type='application/json'}else{
    const file=path.resolve(webRoot,'.'+url.pathname);if(!file.startsWith(webRoot+path.sep))throw Error('outside assets');data=await readFile(file);
    if(file.endsWith('/material-document/index.html'))data=Buffer.from(data.toString().replace('</html>','<script type="module" src="/test.js"></script></html>'));
    type=file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'text/html';
  }res.setHeader('content-type',type);res.end(data)
}catch{res.statusCode=404;res.end('missing asset')}});
let browser;try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/examples/material-document/index.html';
  browser=await launchChrome(await findChrome(),['--enable-unsafe-webgpu']);const target=await createPage(browser.debugUrl,url);
  const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:950,url,focus:true,trustedInput:true,allowEmulation:true,screenshotDirectory:evidence,timeoutMs:55000});if(result.error)throw Error(result.error);
  if(evidence)await writeFile(path.join(evidence,'canonical-plans.json'),JSON.stringify(plans,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve))}
