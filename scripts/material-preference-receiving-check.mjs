// Source-MCP canonical plans -> independently copied built Web material sessions.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioClient} from './composition-provider-chain-check.mjs';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const webRoot=path.resolve(flag('--web-root')??path.join(root,'packages/web'));
const evidence=flag('--evidence')?path.resolve(flag('--evidence')):undefined;
if(evidence)await mkdir(evidence,{recursive:true});
const inputs=JSON.parse(await readFile(path.join(webRoot,'examples/material-preferences/inputs.json'),'utf8'));
const client=new StdioClient(path.join(root,'target/debug/worldbend-mcp'),['--root',root,'--surface','catalog']);
const plans={};
try{await client.initialize();
const search=await client.callTool('worldbend.search',{query:'material_preference',limit:20});
if(!search.result?.structuredContent?.result?.operations?.some(row=>row.operation==='material_preference'))throw Error('Personal material operation is not discoverable');
const described=await client.callTool('worldbend.describe',{operation:'material_preference'});const schema=described.result?.structuredContent?.result?.inputSchema;
const branches=schema?.oneOf??schema?.anyOf;
if(schema?.type!=='object'||branches?.length!==3||branches.some(branch=>branch.additionalProperties!==false||!branch.required?.includes('family')))throw Error('Material preference schema lost its closed typed family branches');
for(const [family,input]of Object.entries(inputs)){
 const response=await client.callTool('worldbend.run',{operation:'material_preference',arguments:input});
 const envelope=response.result?.structuredContent;if(!envelope?.ok)throw Error(JSON.stringify(response));plans[family]=envelope.result;
}}finally{await client.close()}
const test=`
import {attachMaterialPreference} from '/packages/web/dist/material-preference.js';
import {resolveMaterialPreference} from '/packages/web/dist/index.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),assert=(value,message)=>{if(!value)throw Error(message)};
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};
const pixelData=host=>{const canvas=host.querySelector('canvas');if(!canvas)return null;const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);return [...copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data]};
const equal=(a,b)=>a?.length===b?.length&&a?.every((v,i)=>v===b[i]);
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
try{
 for(let n=0;n<500&&!globalThis.materialStudy;n++)await wait(10);const app=globalThis.materialStudy;assert(app,'material example did not initialize');
 const native=await(await fetch('/native-plans.json')).json();let parity=true;
 for(const [family,input]of Object.entries(app.fixtures)){const local=await resolveMaterialPreference(input);assert(JSON.stringify(stable(local))===JSON.stringify(stable(native[family])),family+' native/WASM preference mismatch '+JSON.stringify({local:local.plan.sourceFingerprint,native:native[family].plan.sourceFingerprint}))}
 const results=[];
 for(const [family,field,key]of [['texture','grain','grain'],['foil','roughness','roughness'],['mesh-gradient','softness','softness']]){
  const host=document.createElement('article');host.style.cssText='width:320px;height:240px;background:#d8d1bf';host.innerHTML='<button>Continue</button>';document.body.append(host);const content=host.firstChild;
  const input=structuredClone(app.fixtures[family]);input.runtime.motionAllowed=false;
  let session=await attachMaterialPreference(host,input),state=session.getState();const defaultValue=input.source.material[key],oldGuard=state.guard;
  if(family==='texture')assert(host.querySelector('svg').getAttribute('aria-hidden')==='true'&&host.querySelector('svg').getAttribute('focusable')==='false','texture resource became an accessible image');
  const changes={[field]:{kind:'number',value:defaultValue}};
  session.preview(changes,state.guard);assert(session.getState().input.preference.revision===0&&session.getState().preview,'preview committed preference early');
  try{session.commit(changes,oldGuard,'agent');throw Error('stale agent accepted')}catch(error){assert(error.message.includes('Stale'),'wrong stale preview error')}
  session.applyPreview(session.getState().guard);state=session.getState();const saved=session.exportPreference();
  const nextSource=app.sourceFor(family,true);session.revise(nextSource,input.policy,state.guard);
  assert(session.getState().output.plan.delivery.material[key]===defaultValue,family+' equal-to-default preference lost on source update');
  session.preview({[field]:{kind:'number',value:.1}},session.getState().guard);session.cancelPreview();assert(session.getState().output.plan.delivery.material[key]===defaultValue,'cancel lost latest accepted material');
  session.preview({[field]:{kind:'number',value:.7}},session.getState().guard);
  session.preview({visible:{kind:'toggle',value:false}},session.getState().guard);
  assert(session.getState().preview.plan.delivery.material[key]===.7&&!session.getState().preview.plan.delivery.material.visible,'multi-control preview lost an earlier draft field');session.cancelPreview();
  const policy=structuredClone(input.policy);policy.revision=2;policy.exposed=policy.exposed.filter(row=>row.field!==field);
  session.revise(nextSource,policy,session.getState().guard);assert(session.getState().output.plan.delivery.material[key]===.85&&session.getState().input.preference.fields[field].value.value===defaultValue,'policy hide destroyed saved intent');
  policy.revision=3;policy.exposed=input.policy.exposed;session.revise(nextSource,policy,session.getState().guard);assert(session.getState().output.plan.delivery.material[key]===defaultValue,'policy restore did not restore saved intent');
  const bad=JSON.parse(saved);bad.preference.scope='other';try{session.restorePreference(JSON.stringify(bad),session.getState().guard);throw Error('wrong scope accepted')}catch(error){assert(error.message!=='wrong scope accepted','wrong scope was restored')}
  const keptState=JSON.stringify(session.getState());try{session.commit({[field]:{kind:'number',value:2}},session.getState().guard);throw Error('range accepted')}catch(error){assert(error.message!=='range accepted','out-of-range preference accepted')};assert(keptState===JSON.stringify(session.getState()),'invalid preference changed accepted state');
  const beforePixels=pixelData(host);session.commit({[field]:{kind:'number',value:.95}},session.getState().guard);await wait(40);const changedPixels=pixelData(host);
  if(beforePixels)assert(!equal(beforePixels,changedPixels),family+' preference changed no actual GPU pixels');
  session.destroy();assert(content===host.firstChild&&!host.querySelector('canvas')&&!host.querySelector('.worldbend-texture'),'retirement damaged host content or kept material');
  const restoreInput=structuredClone(input);restoreInput.source=nextSource;session=await attachMaterialPreference(host,restoreInput);session.restorePreference(saved,session.getState().guard);
  assert(session.getState().output.plan.delivery.material[key]===defaultValue,'cold restoration lost explicit preference');
  session.reset(session.getState().guard);assert(session.getState().output.plan.delivery.material[key]===.85&&!Object.keys(session.getState().input.preference.fields).length,'reset did not follow current source');session.destroy();host.remove();results.push(family);
 }
 // Exercise actual range input, preview/apply/cancel and persistence on the normal page.
 await app.choose('mesh-gradient');let session=app.session;const range=document.getElementById('amount');range.focus();
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
 assert(session.getState().previewing&&session.getState().preview.plan.delivery.material.softness===1,'human range did not preview material');
 const button=document.getElementById('apply'),box=button.getBoundingClientRect();await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x+20,y:box.y+20,button:'left',clickCount:1});await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+20,y:box.y+20,button:'left',clickCount:1});
 assert(!session.getState().previewing&&session.getState().input.preference.fields.softness.value.value===1&&localStorage.getItem('worldbend.material-study.preference.mesh-gradient'),'human apply did not save explicit preference');
 const originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('worldbend.material-study.preference.'))throw new DOMException('full','QuotaExceededError');return originalSet.call(this,key,value)};
 range.focus();await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});button.click();assert(!document.getElementById('retry').hidden&&document.getElementById('status').textContent.includes('saving failed'),'storage failure claimed saved material');Storage.prototype.setItem=originalSet;document.getElementById('retry').click();assert(document.getElementById('retry').hidden,'save retry did not finish');
 await app.choose('texture');await app.choose('mesh-gradient');session=app.session;assert(session.getState().input.preference.fields.softness.value.value===0,'ordinary reopen lost saved preference');
 const original=app.host.querySelector('h1');await trusted('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5},'personal-fluid-material');
 const first=app.choose('foil');const latest=app.choose('mesh-gradient');await Promise.all([first,latest]);assert(app.family==='mesh-gradient'&&app.host.querySelectorAll('canvas').length===1&&app.host.querySelector('h1')===original,'rapid family choice left stale surface/content');
 const requestAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);navigator.gpu.requestAdapter=async()=>null;
 await app.choose('foil');assert(!app.session&&!app.host.classList.contains('mesh')&&app.host.querySelector('h1')===original,'unavailable family left unreadable previous styling or lost content');
 navigator.gpu.requestAdapter=requestAdapter;await app.choose('texture');assert(app.session&&app.family==='texture','unavailable GPU family could not recover to paper');await app.choose('mesh-gradient');
 const beforeReduced=app.session.getState();await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(40);
 const adapted=app.session.getState();assert(!adapted.input.runtime.motionAllowed&&adapted.output.plan.controls.find(row=>row.field==='flow-speed').state==='adapted'&&adapted.output.plan.preferenceFingerprint===beforeReduced.output.plan.preferenceFingerprint,'actual reduced motion was hidden or rewrote preference');
 try{app.session.commit({softness:{kind:'number',value:.5}},beforeReduced.guard,'agent');throw Error('stale runtime proposal accepted')}catch(error){assert(error.message.includes('Stale'),'runtime change did not reject old guard')}
 await trusted('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},'personal-material-mobile');assert(document.documentElement.scrollWidth<=390,'personal material page overflows on mobile');
 globalThis.__WORLDBEND_PARITY__={ok:true,sourceMcpWasmParity:parity,families:results,equalToDefaultIntent:true,staleAgentAfterHumanPreview:true,composedPreview:true,sourceAndPolicyRevision:true,cancelAndReset:true,coldRestore:true,scopeGuard:true,actualGpuPixels:true,hostContentRetained:true,trustedRangeAndApply:true,storageFailureAndRetry:true,rapidFamilyCancellation:true,unavailableFamilyRecovery:true,actualReducedMotion:true,decorativeResourcesHidden:true,mobileReflow:true};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
`;
const server=createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname;
 if(file==='/native-plans.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(plans));return}
 if(file==='/test.js'){res.setHeader('content-type','text/javascript');res.end(test);return}
 if(!file.startsWith('/packages/web/'))throw Error('outside assets');const absolute=path.resolve(webRoot,'.'+file.slice('/packages/web'.length));if(!absolute.startsWith(webRoot+path.sep))throw Error('outside assets');let data=await readFile(absolute);
 if(file.endsWith('/material-preferences/index.html'))data=Buffer.from(data.toString().replace('</body>','<script type="module" src="/test.js"></script></body>'));
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'text/html');res.end(data)
}catch{res.statusCode=404;res.end('missing asset')}});
let browser;try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/packages/web/examples/material-preferences/index.html';browser=await launchChrome(await findChrome(),['--enable-unsafe-webgpu']);const target=await createPage(browser.debugUrl,url);
const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:900,url,focus:true,trustedInput:true,allowEmulation:true,screenshotDirectory:evidence,timeoutMs:55000});if(result.error)throw Error(result.error);if(evidence)await writeFile(path.join(evidence,'source-mcp-plans.json'),JSON.stringify(plans,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve))}
