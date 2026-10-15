// Actual built-package pixels, revision recovery and first-party compositions.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=process.argv.indexOf('--evidence'),evidence=flag<0?undefined:path.resolve(process.argv[flag+1]);
if(evidence)await mkdir(evidence,{recursive:true});
const test=`
import {attachMockupMotion} from '/packages/web/dist/mockup-motion.js';
import {planMockup,planMockupMotion,planCanvas,CanvasRasterRenderer} from '/packages/web/dist/index.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(v,m)=>{if(!v)throw Error(m)};
const pixels=c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];
const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const settle=async s=>{for(let n=0;n<1000&&!s.settled;n++)await wait(10);assert(s.settled,'rapid updates never settled')};
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};
try{
 for(let n=0;n<1000&&!globalThis.shadowStudy;n++){if(globalThis.shadowStudyError)throw Error(globalThis.shadowStudyError);await wait(10)}
 const s=globalThis.shadowStudy;assert(s,'study did not initialize');const c=s.controller,cover=pixels(c.canvas);
 const exports={cover:{spec:s.spec,motion:await planMockupMotion(s.spec),png:c.canvas.toDataURL().split(',')[1]}};
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},'shadow-cover');
 const button=document.getElementById('play').getBoundingClientRect(),click=async()=>{await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:button.x+button.width/2,y:button.y+button.height/2,button:'left',clickCount:1});await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:button.x+button.width/2,y:button.y+button.height/2,button:'left',clickCount:1})};
 await click();await wait(120);assert(!c.getState().paused&&c.getState().timeMs>0,'trusted pointer did not start authored playback');await click();assert(c.getState().paused,'trusted pointer did not pause');c.seek(0);
 c.seek(1900);assert(!equal(cover,pixels(c.canvas)),'authored motion did not change pixels');
 s.change({series:true});await settle(s);c.seek(0);assert(c.getSpec().planes.length===3&&!equal(cover,pixels(c.canvas)),'series composition did not publish');
 exports.series={spec:s.spec,motion:await planMockupMotion(s.spec),png:c.canvas.toDataURL().split(',')[1]};
 document.getElementById('strength').focus();await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});await settle(s);
 assert(c.getSpec().planes.every(p=>p.shadow.opacity===.6),'native range input did not publish shadow strength');s.change({strength:.25});await settle(s);
 const frameCosts=[];for(let frame=0;frame<24;frame++){const began=performance.now();c.seek(frame*1000/24);frameCosts.push(performance.now()-began)}c.seek(0);frameCosts.sort((a,b)=>a-b);
 const sampling={scope:'headless Chromium, 960x720 three-plane series, explicit seek CPU submission cost; not display FPS',frames:24,medianMs:frameCosts[12],maximumMs:frameCosts.at(-1)};
 for(const item of [exports.cover,exports.series])item.samplePlans=await Promise.all([0,47,95].map(index=>planMockup(item.motion.frameSpecs[index])));
 await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},'shadow-series');
 const original=pixels(c.canvas);s.change({strength:.1});s.change({strength:.3});s.change({softness:20});s.change({alternate:true});await settle(s);
 assert(c.getSpec().planes.every(p=>p.shadow.opacity===.3&&p.shadow.blurSigmaPx===20)&&!equal(original,pixels(c.canvas)),'coalesced edits lost last intent or source update');
 const accepted=pixels(c.canvas),revision=c.getState().revision,invalid=structuredClone(s.spec);invalid.planes[0].shadow.blurSigmaPx=65;
 try{await c.update(invalid,s.sources,{expectedRevision:revision});throw Error('invalid shadow accepted')}catch(error){assert(error.message!=='invalid shadow accepted','invalid accepted')}
 assert(c.getState().revision===revision&&equal(accepted,pixels(c.canvas)),'invalid candidate changed accepted work');
 s.change({series:true,strength:.25,softness:12,alternate:false});await settle(s);c.seek(0);
 exports.source=s.sources[0].image.toDataURL().split(',')[1];
 c.seek(1200);const retained=pixels(c.canvas),retainedRevision=JSON.stringify(s.spec);
 window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));assert(c.getState().status==='disposed','page retirement left active receiver');
 window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));await settle(s);
 assert(s.controller!==c&&s.controller.getState().timeMs===1200&&equal(retained,pixels(s.controller.canvas))&&JSON.stringify(s.spec)===retainedRevision,'receiving page return lost work or playhead');
 const image=document.createElement('canvas');image.width=image.height=8;const x=image.getContext('2d');x.fillStyle='blue';x.fillRect(0,0,8,8);x.clearRect(2,2,4,4);
 const q={tl:{x:2,y:2},tr:{x:10,y:2},br:{x:10,y:10},bl:{x:2,y:10}};
 const probe={schema:'worldbend.mockup-motion',version:'0.1',canvas:{width:32,height:20},timebase:{numerator:2,denominator:1},frameCount:2,planes:[{id:'p',sourceId:'p',opacity:1,shadow:{offset:{x:12,y:0},blurSigmaPx:0,color:[255,0,0],opacity:.5},base:{schema:'worldbend.transform',version:'0.1',destination:{space:'pixel',reference:{width:32,height:20},quad:q},content:{fit:'stretch'}},keyframes:[{frame:0,quad:q},{frame:1,quad:q}]}],seams:[]};
 const host=document.createElement('div');host.style.width='320px';document.body.append(host);
 const contexts=[];const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){const v=get.call(this,type,...args);if(type==='webgl2')contexts.push(v);return v};
 const receiver=await attachMockupMotion(host,probe,[{id:'p',image}]);HTMLCanvasElement.prototype.getContext=get;
 let data=pixels(receiver.canvas),at=(a,b)=>(b*32+a)*4;
 assert(data[at(15,3)]===255&&Math.abs(data[at(15,3)+3]-128)<=1&&data[at(17,5)+3]===0,'projected source-alpha hole, tint or opacity failed');
 const off=structuredClone(probe),oq={tl:{x:-10,y:2},tr:{x:-2,y:2},br:{x:-2,y:10},bl:{x:-10,y:10}};off.planes[0].base.destination.quad=oq;off.planes[0].keyframes.forEach(k=>k.quad=oq);off.planes[0].shadow.blurSigmaPx=2;
 await receiver.update(off,[{id:'p',image}],{expectedRevision:receiver.getState().revision});data=pixels(receiver.canvas);
 assert(data[at(3,3)+3]>0&&data[at(12,3)+3]>0,'off-canvas caster or soft edge disappeared');
 const wide=document.createElement('canvas');wide.width=16;wide.height=4;const wc=wide.getContext('2d');wc.fillStyle='blue';wc.fillRect(0,0,16,4);
 const fit=await planCanvas({schema:'worldbend.canvas',version:'0.1',operation:{kind:'contain',output:{width:8,height:8},anchor:{x:.5,y:.5},background:{kind:'transparent'}}},{width:16,height:4});
 const fitted=new CanvasRasterRenderer();fitted.render(wide,fit,'high');
 await receiver.update(probe,[{id:'p',image:fitted.canvas}],{expectedRevision:receiver.getState().revision});data=pixels(receiver.canvas);
 assert(data[at(15,3)+3]===0&&Math.abs(data[at(15,6)+3]-128)<=1,'changed-aspect core fitting did not survive shadow source replacement');fitted.dispose();
 const curved=structuredClone(probe);curved.planes[0].surface={kind:'cylinder',curvature:.7};
 await receiver.update(curved,[{id:'p',image}],{expectedRevision:receiver.getState().revision});data=pixels(receiver.canvas);
 assert(data[at(15,3)+3]>0&&data[at(17,5)+3]===0,'curved caster lost shadow alpha');
 const before=pixels(receiver.canvas);assert(contexts.length===2,'scene did not retain two bounded drawing buffers');const losses=contexts.map(gl=>gl.getExtension('WEBGL_lose_context'));assert(losses.every(Boolean),'GPU loss probe unavailable');losses.forEach(loss=>loss.loseContext());
 for(let n=0;n<200&&receiver.getState().status!=='lost';n++)await wait(5);assert(receiver.getState().status==='lost','loss not reported');losses[0].restoreContext();await wait(80);assert(receiver.getState().status==='lost','partial restoration falsely reported ready');losses[1].restoreContext();
 for(let n=0;n<200&&receiver.getState().status!=='ready';n++)await wait(5);assert(receiver.getState().status==='ready'&&equal(before,pixels(receiver.canvas)),'restoration lost shadow work');receiver.destroy();host.remove();
 await trusted('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},'shadow-mobile');assert(document.documentElement.scrollWidth<=390,'mobile overflow');
 globalThis.__WORLDBEND_PARITY__={ok:true,trustedPointerPlayback:true,trustedKeyboardShadowStrength:true,actualAlphaHole:true,offCanvasCaster:true,gaussianSoftEdge:true,tintAndOpacity:true,rapidLastIntent:true,sourceReplacement:true,changedAspectCoreFit:true,curvedCaster:true,rejectedCandidateRecovery:true,contextRecovery:true,pageLifecycleReturn:true,mobileReflow:true,sampling,exports};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');let file=url.pathname;
 if(file==='/shadow-test.js'){res.setHeader('content-type','text/javascript');res.end(test);return}
 if(!file.startsWith('/packages/web/'))throw Error('outside test assets');
 const absolute=path.resolve(root,'.'+file);if(!absolute.startsWith(path.join(root,'packages/web')+path.sep))throw Error('outside test assets');
 let data=await readFile(absolute);if(file.endsWith('/scene-shadow/index.html'))data=Buffer.from(data.toString().replace('</body>','<script type="module" src="/shadow-test.js"></script></body>'));
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'text/html');res.end(data);
}catch{res.statusCode=404;res.end('missing test asset')}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/packages/web/examples/scene-shadow/index.html';
 browser=await launchChrome(await findChrome());const target=await createPage(browser.debugUrl,url);
 const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:900,url,focus:true,trustedInput:true,allowEmulation:true,screenshotDirectory:evidence,timeoutMs:55000});if(result.error)throw Error(result.error);
 if(evidence){for(const name of ['cover','series']){await writeFile(path.join(evidence,name+'.motion.json'),JSON.stringify(result.exports[name].spec,null,2)+'\n');await writeFile(path.join(evidence,name+'.wasm-plan.json'),JSON.stringify(result.exports[name].motion,null,2)+'\n');await writeFile(path.join(evidence,name+'.wasm-shadow-plans.json'),JSON.stringify(result.exports[name].samplePlans,null,2)+'\n');await writeFile(path.join(evidence,name+'.web.png'),Buffer.from(result.exports[name].png,'base64'))}await writeFile(path.join(evidence,'cover.png'),Buffer.from(result.exports.source,'base64'))}
 delete result.exports;process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve))}
