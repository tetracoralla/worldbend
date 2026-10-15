import {createQaHttpFailureBoundary} from "./qa-http-failure-boundary.mjs";
// Real source MCP -> independent Web receiver; no Figma account/runtime,
// framework or fixture shader is used by the receiving page.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClient } from './composition-provider-chain-check.mjs';
import { findChrome, launchChrome, closeChrome, createPage, readPageResult } from './remap-native-webgl-parity.mjs';
const httpFailures=createQaHttpFailureBoundary("foil-receiving-check.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFlag = process.argv.indexOf('--source');
const defaultMaterial = {visible:true,baseColor:{r:.14,g:.2,b:.28,a:1},highlightColor:{r:.98,g:.92,b:.78,a:1},lightAngle:120,intensity:.9,roughness:.45,flowSpeed:.25};
// Keep the immutable recipe seed separate from live edits, including nested colors.
const initialInput = sourceFlag < 0 ? {recipe:{schema:'worldbend.foil@0.1',version:'0.1',recipeId:'brand-metal',recipeVersion:1,material:structuredClone(defaultMaterial)},material:structuredClone(defaultMaterial),target:'web'}
  : JSON.parse(await readFile(process.argv[sourceFlag+1], 'utf8'));
const client = new StdioClient(path.join(root,'target/debug/worldbend-mcp'),['--root',root,'--surface','catalog']);
async function run(operation, arguments_, expectOk = true) {
  const response = await client.callTool('worldbend.run',{operation,arguments:arguments_});
  const envelope = response.result?.structuredContent;
  if (envelope?.ok !== expectOk) throw new Error(operation + ': ' + JSON.stringify(envelope));
  return envelope;
}
let plans;
try {
  await client.initialize();
  const initial = (await run('foil_delivery',initialInput)).result;
  const inspected = (await run('foil_inspect',{recipe:initialInput.recipe,live:initialInput.material,tagged:true})).result;
  const localInput = structuredClone(initialInput); localInput.material.baseColor.a = .6; localInput.material.flowSpeed = 0;
  const local = (await run('foil_delivery',localInput)).result;
  const nextInput = structuredClone(initialInput); nextInput.material.intensity = .75; nextInput.material.roughness = .7;
  const updateInput = {previous:initialInput,next:nextInput,live:localInput.material,expectedFingerprint:initial.fingerprint};
  const update = (await run('foil_update',updateInput)).result;
  if (update.delivery.material.baseColor.a !== .6 || update.delivery.material.flowSpeed !== 0 || update.delivery.material.intensity !== .75 || update.delivery.material.roughness !== .7) throw new Error('Source MCP did not merge local edits');
  const stale = await run('foil_update',{...updateInput,expectedFingerprint:'sha256:'+'0'.repeat(64)},false);
  const missingLive = {...updateInput}; delete missingLive.live; await run('foil_update',missingLive,false);
  const removed = (await run('foil_update',{...updateInput,live:null})).result;
  if (removed.delivery !== null || removed.previousDeliveryFingerprint !== null) throw new Error('Native removal was revived');
  const revision = (await run('foil_revision',{previous:initialInput.recipe,next:{...initialInput.recipe,recipeVersion:2,material:{...initialInput.recipe.material,intensity:.4}},live:localInput.material})).result;
  if (revision.material.baseColor.a !== .6 || revision.material.flowSpeed !== 0) throw new Error('Seed upgrade lost local changes');
  const flat = (await run('foil_delivery',{...initialInput,material:{...initialInput.material,intensity:0,baseColor:{r:.2,g:.4,b:.6,a:.5}}})).result;
  const alpha = (await run('foil_delivery',{...initialInput,material:{...initialInput.material,highlightColor:{...initialInput.material.highlightColor,a:0}}})).result;
  plans = {initial,local,update,removed,flat,alpha,inspected,staleError:stale.error};
} finally { await client.close(); }

const html = `<!doctype html><meta charset="utf-8"><title>Worldbend Foil receiving check</title>
<style>body{margin:0;padding:40px;background:#e9e7e0;font:16px system-ui;color:#fff}.row{display:flex;gap:28px}.surface{width:536px;height:400px;border-radius:40px;display:flex;flex-direction:column;justify-content:space-between;box-sizing:border-box;padding:38px}.surface h1{font-size:54px;line-height:1.05;margin:0;max-width:320px}.surface button{align-self:flex-start;background:#fff;color:#172332;border:0;padding:12px 22px;border-radius:22px;font:inherit;cursor:pointer}.note{color:#243447;margin-top:25px}#group-a,#group-b{width:140px;height:80px;margin-top:20px;border-radius:12px}</style>
<div class="row"><article id="a" class="surface"><h1>Objects in motion.</h1><button id="action">Continue</button></article><article id="b" class="surface"><h1>Quiet<br>reflection.</h1><span>Independent material timing</span></article></div>
<div class="row"><div id="group-a">Shared A</div><div id="group-b">Shared B</div></div><p class="note">Editable tint, opacity and motion · original content and interaction retained</p>
<script type="module">
import {attachFoil} from '/foil.js';import {attachFoilGroup} from '/foil-receiving.js';
try {
 const p = await (await fetch('/plans.json')).json();
 const assert = (condition,message) => {if(!condition) throw Error(message)};
 const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
 const a = document.getElementById('a'), b = document.getElementById('b'), button = document.getElementById('action');
 const originalNodes = [...a.childNodes];let clicks=0;button.addEventListener('click',()=>clicks++);
 let deviceDelay=0;const devices=[];const originalAdapter=navigator.gpu.requestAdapter.bind(navigator.gpu);
 navigator.gpu.requestAdapter=async (...args)=>{const adapter=await originalAdapter(...args);if(!adapter)return null;return new Proxy(adapter,{get(target,key){if(key==='requestDevice')return async (...args)=>{const device=await target.requestDevice(...args);devices.push(device);if(deviceDelay)await wait(deviceDelay);return device};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}})};
 const reports=[];
 const trusted=async (method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};

 const first=await attachFoil(a,p.initial,{paused:true,respectReducedMotion:false,onError:error=>reports.push(error.message)});
 let second=await attachFoil(b,p.initial,{paused:true,respectReducedMotion:false});
 const pixels = element => {
  const canvas=element.querySelector('canvas'), copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;
  const context=copy.getContext('2d');context.drawImage(canvas,0,0);return context.getImageData(0,0,copy.width,copy.height).data;
 };
 const equal = (a,b)=>a.length===b.length&&a.every((value,i)=>value===b[i]);
 first.seek(0);const start = await pixels(a);first.seek(2000);const later=await pixels(a);assert(!equal(start,later),'seek did not change actual Foil pixels');
 second.seek(0);const stationary=await pixels(b);assert(equal(start,stationary),'independent instance did not start at t=0: '+JSON.stringify({first:first.getState(),second:second.getState(),start:[...start.slice(0,16)],stationary:[...stationary.slice(0,16)],startNonzero:start.reduce((n,v)=>n+Number(v>0),0),stationaryNonzero:stationary.reduce((n,v)=>n+Number(v>0),0)}));
 first.setPaused(false);await wait(100);first.setPaused(true);const paused=first.getState().time;await wait(100);assert(first.getState().time===paused,'paused clock kept advancing');
 assert(second.getState().time===0,'one surface advanced another clock');
 const hiddenBefore=first.getState().time;first.setVisible(false);await wait(60);assert(first.getState().time===hiddenBefore,'hidden clock advanced');const hidden=await pixels(a);assert(hidden.every(value=>value===0),'hidden output remains painted');first.setVisible(undefined);
 first.update(p.flat);const flat=await pixels(a);let flatDelta=0;for(let i=0;i<flat.length;i+=4){flatDelta=Math.max(flatDelta,Math.abs(flat[i]-51),Math.abs(flat[i+1]-102),Math.abs(flat[i+2]-153),Math.abs(flat[i+3]-128))};assert(flatDelta<=2,'canvas did not convert straight kernel output to premultiplied composition');
 first.update(p.alpha);const alpha=await pixels(a);assert(alpha.some((value,i)=>i%4===3&&value<250),'highlight opacity was ignored by receiver');
 first.update(p.initial);first.seek(0);
 const beforeFailure=JSON.stringify(first.getState());const bad=structuredClone(p.initial);bad.kernel.source+=' ';
 try{first.update(bad);throw Error('bad source accepted')}catch(error){assert(error.message.includes('kernel source changed'),'wrong source validation error')}
 assert(JSON.stringify(first.getState())===beforeFailure,'invalid delivery mutated receiver');
 const invalid=document.createElement('div');document.body.append(invalid);let rejected=false;
 try{await attachFoil(invalid,bad)}catch(error){rejected=error.message.includes('integrity')};assert(rejected&&!invalid.querySelector('canvas')&&!invalid.style.position,'corrupt attachment mutated host');invalid.remove();
 const group=await attachFoilGroup([document.getElementById('group-a'),document.getElementById('group-b')],p.initial,{paused:true});
 group.updateLocal(p.local);group.update(p.update);const state=group.getState();assert(state.sourceFingerprint===p.update.sourceFingerprint&&state.delivery.material.baseColor.a===.6&&state.delivery.material.flowSpeed===0,'group lost local material');
 try{group.update(p.update);throw Error('stale accepted')}catch(error){assert(error.message.includes('Stale'),'wrong stale error')}
 assert(JSON.stringify(group.getState())===JSON.stringify(state),'stale group request changed state');
 group.remove();const removed={...p.update,previousFingerprint:state.sourceFingerprint,previousDeliveryFingerprint:null,delivery:null};group.update(removed);assert(group.getState().delivery===null,'later revision revived local removal');group.destroy();
 a.style.width='300px';await wait(60);assert(first.getState().width===300*devicePixelRatio,'resize did not update backing store');a.style.width='536px';await wait(60);
 const retainedTime=first.getState().time;devices[0].destroy();for(let i=0;i<50&&first.getState().status!=='lost';i++)await wait(10);
 assert(first.getState().status==='lost','real GPU device loss was not reported');await first.recover();assert(first.getState().status==='ready'&&first.getState().time===retainedTime,'device recovery reset or failed');first.seek(retainedTime);assert(equal(start,await pixels(a)),'device recovery did not restore actual pixels');
 assert(originalNodes.every(node=>node.parentNode===a),'material replaced original content');
 const rect=button.getBoundingClientRect();await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x+20,y:rect.y+15,button:'left',clickCount:1});await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+20,y:rect.y+15,button:'left',clickCount:1},'foil-receiving');assert(clicks===1,'material intercepted the original button');
 button.blur();document.body.tabIndex=-1;document.body.focus();await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});assert(document.activeElement===button,'material changed keyboard focus order');await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\\r',unmodifiedText:'\\r'});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});assert(clicks===2,'material blocked keyboard activation');
 assert(a.querySelector('canvas').getAttribute('aria-hidden')==='true'&&!a.querySelector('canvas').hasAttribute('tabindex'),'material exposes a decorative focus target');
 second.setPaused(false);b.style.position='absolute';b.style.top='3000px';await wait(100);const offscreenTime=second.getState().time;await wait(100);assert(second.getState().time===offscreenTime,'offscreen instance kept advancing');b.style.removeProperty('position');b.style.removeProperty('top');await wait(100);assert(second.getState().time>offscreenTime,'reinserted visible instance did not resume');second.setPaused(true);
 const lockStyle=document.createElement('style');lockStyle.textContent='.locked{position:static!important;isolation:auto!important}';document.head.append(lockStyle);const locked=document.createElement('div');locked.className='locked';locked.textContent='Protected';document.body.append(locked);try{await attachFoil(locked,p.initial);throw Error('locked host accepted')}catch(error){assert(error.message.includes('stylesheet'),'wrong locked host error')};assert(!locked.querySelector('canvas')&&!locked.style.position&&!locked.style.isolation&&locked.textContent==='Protected','failed host positioning did not roll back');locked.remove();lockStyle.remove();
 const groupAbort=new AbortController();const abortGroup=await attachFoilGroup([document.getElementById('group-a'),document.getElementById('group-b')],p.initial,{signal:groupAbort.signal});groupAbort.abort();assert(abortGroup.getState().delivery===null&&!document.getElementById('group-a').querySelector('canvas'),'group cancellation left accepted render state');
 const hostAdapter=await originalAdapter(),hostDevice=await hostAdapter.requestDevice();let hostDeviceLost=false;void hostDevice.lost.then(()=>hostDeviceLost=true);const hostOwned=await attachFoil(document.getElementById('group-a'),p.initial,{device:hostDevice,paused:true});hostOwned.destroy();await wait(30);assert(!hostDeviceLost,'material disposal destroyed the host-owned device');const stillUsable=hostDevice.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST});hostDevice.queue.writeBuffer(stillUsable,0,new Uint32Array([1]));await hostDevice.queue.onSubmittedWorkDone();stillUsable.destroy();hostDevice.destroy();
 const abort=new AbortController();const cancelled=document.createElement('div');document.body.append(cancelled);deviceDelay=100;const beforeDevices=devices.length;const attaching=attachFoil(cancelled,p.initial,{signal:abort.signal});for(let i=0;i<100&&devices.length===beforeDevices;i++)await wait(5);assert(devices.length>beforeDevices,'cancellation did not reach actual device acquisition');const lateDevice=devices.at(-1);abort.abort();
 try{await attaching;throw Error('cancel accepted')}catch(error){assert(error.name==='AbortError','wrong cancellation error')};assert(!cancelled.querySelector('canvas')&&!cancelled.style.position,'cancelled attachment mutated host');deviceDelay=0;const lateLost=await lateDevice.lost;assert(lateLost.reason==='destroyed','cancelled device acquisition leaked its late result');const afterCancel=await attachFoil(cancelled,p.initial);afterCancel.destroy();cancelled.remove();
 a.style.position='absolute';first.destroy();first.destroy();assert(a.style.position==='absolute'&&!a.querySelector('canvas')&&originalNodes.every(node=>node.parentNode===a),'disposal lost host edits/content');second.destroy();
 const reduced=await attachFoil(b,p.initial);await wait(70);assert(reduced.getState().reducedMotion===true&&reduced.getState().time===0,'reduced motion animated');reduced.destroy();
 globalThis.__WORLDBEND_PARITY__={ok:true,scope:'source MCP and independent WebGPU receiver; no Figma compositing parity',flatRgbaMaxDelta:flatDelta,deviceLossRecovered:true,independentClocks:true,localEditsPreserved:true,staleRejected:true,contentAndTrustedPointerRetained:true,trustedKeyboardRetained:true,offscreenClock:true,reducedMotion:true,lateDeviceCancellation:true,groupAbort:true,hostOwnedDeviceRetained:true,hostStyleRollback:true,abortAndDisposal:true,reports};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
</script>`;
const screenshotFlag=process.argv.indexOf('--screenshots');
const screenshotDirectory=screenshotFlag<0?undefined:path.resolve(process.argv[screenshotFlag+1]);
const server=createServer(async (request,response)=>{
 try {
  const name=new URL(request.url,'http://127.0.0.1').pathname;
  let content,type;
  if(name==='/'){content=html;type='text/html'}
  else if(name==='/plans.json'){content=JSON.stringify(plans);type='application/json'}
  else if(/^\/[\w-]+\.js$/.test(name)){content=await readFile(path.join(root,'packages/web/dist',name.slice(1)));type='text/javascript'}
  else {response.writeHead(404);response.end();return}
  response.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});response.end(content);
 } catch(error){httpFailures.respond(request,response,error,500)}
});
let browser;
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
 browser=await launchChrome(await findChrome(),['--enable-unsafe-webgpu','--force-prefers-reduced-motion']);
 const target=await createPage(browser.debugUrl,url);
 const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:800,url,focus:true,trustedInput:true,screenshotDirectory,timeoutMs:45000});
 if(result.error)throw Error(result.error);
 process.stdout.write(JSON.stringify({sourceMcpInspection:plans.inspected,...result},null,2)+'\n');
} catch(error){throw httpFailures.decorate(error)} finally {if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve));}
