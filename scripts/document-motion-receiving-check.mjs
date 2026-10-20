// Built receiving package, actual core/WASM, canonical CLI parity and browser pixels.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:path.resolve(process.argv[i+1]);};
const webRoot=arg('--web-root')??path.join(root,'packages/web'),evidence=arg('--evidence'),movie=arg('--movie');
if(evidence)await mkdir(evidence,{recursive:true});
const documentFile=path.join(webRoot,'examples/document-motion/document.json');
const scratch=await mkdtemp(path.join(root,'.worldbend-work/document-motion-cli-'));
let envelope;
try{
 const input=path.join(scratch,'input.json');await writeFile(input,JSON.stringify({document:JSON.parse(await readFile(documentFile,'utf8'))}));
 envelope=JSON.parse(execFileSync(path.join(root,'target/debug/worldbend'),['document-delivery-plan','--spec',input,'--json'],{encoding:'utf8',maxBuffer:8*1024*1024}));
}finally{await rm(scratch,{recursive:true,force:true});}
if(!envelope.ok)throw Error(JSON.stringify(envelope));
const canonicalPlan=envelope.result;
const test=`
import {attachDocumentMotion} from '/packages/web/dist/document-motion.js';
import {attachMockupMotion} from '/packages/web/dist/mockup-motion.js';
import {planSpatialDocumentDelivery} from '/packages/web/dist/spatial-document.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw Error(message)};
const pixels=c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__;};
try{
 for(let i=0;i<600&&!globalThis.documentMotionStudy;i++){if(globalThis.documentMotionError)throw Error(globalThis.documentMotionError);await wait(10);}
 const study=globalThis.documentMotionStudy;assert(study,'shared scene did not initialize');let session=study.session;
 const initialDocument=session.getDocument(),canonical=await (await fetch('/canonical-plan.json')).json();
 const normalize=value=>Array.isArray(value)?value.map(normalize):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])])):value;
 const wasm=await planSpatialDocumentDelivery({document:initialDocument});assert(equal(normalize(wasm),normalize(canonical)),'WASM document plan differs from native canonical planner: '+wasm.documentFingerprint+' vs '+canonical.documentFingerprint);
 const initial=pixels(session.canvas);assert(initial.some((value,index)=>index%4!==3&&value>0),'initial scene blank');assert(initial[3]===255,'final video matte missing');
 session.seek(1200);const middle=pixels(session.canvas),guard=session.getGuard(),aside=[...document.querySelector('aside').childNodes];
 const button=document.getElementById('artwork'),bounds=button.getBoundingClientRect();
 await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:bounds.x+20,y:bounds.y+20,button:'left',clickCount:1});
 await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:bounds.x+20,y:bounds.y+20,button:'left',clickCount:1},'document-edition');
 for(let i=0;i<400&&session.getState().revision===guard.revision;i++)await wait(10);
 assert(session.getState().revision===guard.revision+1&&session.getState().timeMs===1200&&session.getState().paused,'content version revision lost playback state');
 assert(session.getGuard().documentFingerprint!==guard.documentFingerprint&&!equal(middle,pixels(session.canvas)),'edition did not change identity and pixels');
 assert(aside.every(n=>n.parentNode===document.querySelector('aside')),'receiving replaced host content/actions');
 const accepted=JSON.stringify(session.getDocument()),acceptedPixels=pixels(session.canvas);
 try{await session.revise(initialDocument,study.assets(false),guard);throw Error('stale accepted');}catch(error){assert(error.message.includes('Stale'),'wrong stale error');}
 const invalid=session.getDocument();invalid.expressions[0].video.encoding.crf=99;
 try{await session.revise(invalid,study.assets(true),session.getGuard());throw Error('bad encoding accepted');}catch(error){assert(error.message!=='bad encoding accepted','core video validation bypassed');}
 const broken=session.getDocument();delete broken.assets[0].id;
 try{await session.revise(broken,study.assets(true),session.getGuard());throw Error('bad asset accepted');}catch(error){assert(error.message!=='bad asset accepted','core document validation bypassed');}
 try{await session.revise(session.getDocument(),{},session.getGuard());throw Error('missing media accepted');}catch(error){assert(error.message.includes('exactly'),'wrong missing media error');}
 assert(JSON.stringify(session.getDocument())===accepted&&equal(acceptedPixels,pixels(session.canvas)),'failed candidate damaged accepted work');
 document.getElementById('timing').focus();
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\\r'});
 await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 for(let i=0;i<400&&session.getState().durationMs===3000;i++)await wait(10);
 assert(session.getState().durationMs===4000&&session.getState().timeMs===1600,'shared timing revision lost relative position');
 session.seek(1800);const saved=session.getDocument(),state=session.getState();
 dispatchEvent(new Event('pagehide'));assert(session.getState().status==='disposed'&&!study.host.querySelector('canvas'),'pagehide retained renderer');
 dispatchEvent(new Event('pageshow'));for(let i=0;i<500&&study.session===session;i++)await wait(10);session=study.session;
 assert(session.getState().timeMs===1800&&session.getState().paused&&equal(session.getDocument(),saved),'later reopen lost saved work/state');
 const previousCreate=globalThis.createImageBitmap;let release,blocked;
 globalThis.createImageBitmap=async(...args)=>{const bitmap=await previousCreate(...args);if(!blocked){blocked=bitmap;await new Promise(resolve=>release=resolve);}return bitmap;};
 const cancel=new AbortController(),before=session.getGuard(),retainedPixels=pixels(session.canvas);
 const cancelled=session.revise(session.getDocument(),study.assets(true),before,cancel.signal);
 for(let i=0;i<500&&!blocked;i++)await wait(5);assert(blocked,'source preparation did not begin');cancel.abort();
 try{await cancelled;throw Error('cancel accepted');}catch(error){assert(error.name==='AbortError','wrong cancellation error');}
 assert(equal(before,session.getGuard())&&equal(retainedPixels,pixels(session.canvas))&&!session.getState().busy,'cancel changed accepted identity/pixels');
 release();globalThis.createImageBitmap=previousCreate;await wait(30);assert(blocked.width===0,'late snapshot was not retired');
 await session.revise(session.getDocument(),study.assets(true),session.getGuard());
 // The final matte belongs after whole clipping/output, not inside a clipped layer.
 const clipped=session.getDocument(),video=clipped.expressions[0].video;
 video.backgroundRgb=[23,47,71];video.mockupMotion.background={kind:'transparent'};
 const contour=(a,b)=>({start:{x:a,y:a},segments:[{kind:'line',to:{x:b,y:a}},{kind:'line',to:{x:b,y:b}},{kind:'line',to:{x:a,y:b}}]});
 video.mockupMotion.clip={contours:[contour(0,1),contour(.3,.7)],fillRule:'evenOdd'};
 await session.revise(clipped,study.assets(true),session.getGuard());
 const matte=pixels(session.canvas),center=((Math.floor(session.canvas.height/2)*session.canvas.width)+Math.floor(session.canvas.width/2))*4;
 assert(equal(matte.slice(center,center+4),[23,47,71,255]),'compound clip did not receive final opaque video matte');
 const matteHost=document.createElement('div');document.body.append(matteHost);
 const matteSources=Object.entries(study.assets(true)).map(([id,image])=>({id,image}));
 const direct=await attachMockupMotion(matteHost,video.mockupMotion,matteSources,{backgroundRgb:[23,47,71]});
 await direct.update(video.mockupMotion,matteSources,{expectedRevision:direct.getState().revision},{});
 assert(pixels(direct.canvas)[center+3]===0,'removing the final matte did not repaint immediately');
 const directGuard=direct.getState().revision;
 try{await direct.update(video.mockupMotion,matteSources,{expectedRevision:directGuard},{backgroundRgb:[-1,0,0]});throw Error('bad matte accepted');}catch(error){assert(error.message.includes('matte'),'wrong matte rejection');}
 assert(direct.getState().revision===directGuard&&pixels(direct.canvas)[center+3]===0,'invalid matte changed accepted output');direct.destroy();matteHost.remove();
 await session.revise(saved,study.assets(true),session.getGuard());session.seek(1800);
 const nativeSpec=session.getDelivery().video,sources=Object.entries(study.assets(true)).map(([id,image])=>({id,png:image.toDataURL().split(',')[1]}));
 const image=study.host;await trusted('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5},'document-continued');
 await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(50);
 assert(session.getState().reducedMotion&&session.play()===false,'reduced motion bypassed');session.seek(1000);
 await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await trusted('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:false});await wait(50);
 assert(document.documentElement.scrollWidth<=390,'receiving example overflows mobile');
 const last=JSON.stringify(session.getDocument()),fingerprint=session.getGuard().documentFingerprint;session.destroy();
 const reopened=await attachDocumentMotion(study.host,JSON.parse(last),'book',study.assets(true),{onChange:()=>{throw Error('host callback');},onError:()=>{throw Error('host reporter');}});
 assert(reopened.getGuard().documentFingerprint===fingerprint&&reopened.getState().status==='ready','independent saved reconstruction/callback isolation failed');reopened.destroy();
 globalThis.__WORLDBEND_PARITY__={ok:true,canonicalDocumentParity:true,durableAssetRevision:true,latestPlaybackRetained:true,staleRejected:true,invalidCandidateRetained:true,cancelRetry:true,lateSnapshotRetired:true,reopen:true,trustedHumanInput:true,finalMatte:true,reducedMotion:true,mobile:true,exported:{video:nativeSpec,sources}};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)};}
`;
const playback=`<!doctype html><video muted controls src="/movie"></video><script type="module">
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{const video=document.querySelector('video');await video.play();for(let i=0;i<300&&video.currentTime<.3;i++)await wait(10);
if(video.videoWidth!==960||video.videoHeight!==720||video.getVideoPlaybackQuality().totalVideoFrames<2)throw Error('Delivered movie did not play');
video.pause();video.currentTime=1.8;for(let i=0;i<300&&video.seeking;i++)await wait(10);
if(video.seeking||Math.abs(video.currentTime-1.8)>.05||Math.abs(video.duration-4)>.001)throw Error('Delivered movie did not seek');
globalThis.__WORLDBEND_PARITY__={ok:true,actualPlayback:true,actualSeeking:true,width:video.videoWidth,height:video.videoHeight,duration:video.duration};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)};}</script>`;
const server=createServer(async(req,res)=>{try{
 const file=new URL(req.url,'http://localhost').pathname;
 if(movie&&file==='/movie-player'){res.setHeader('content-type','text/html');res.end(playback);return;}
 if(movie&&file==='/movie'){
  const bytes=await readFile(movie);res.setHeader('content-type','video/mp4');res.setHeader('accept-ranges','bytes');
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
  if(range){const start=Number(range[1]),end=Math.min(bytes.length-1,range[2]?Number(range[2]):bytes.length-1);if(start>end||start>=bytes.length){res.writeHead(416,{'content-range':'bytes */'+bytes.length});res.end();return;}res.writeHead(206,{'content-range':'bytes '+start+'-'+end+'/'+bytes.length,'content-length':end-start+1});res.end(bytes.subarray(start,end+1));return;}
  res.setHeader('content-length',bytes.length);res.end(bytes);return;
 }
 if(file==='/receiving-test.js'){res.setHeader('content-type','text/javascript');res.end(test);return;}
 if(file==='/canonical-plan.json'){res.setHeader('content-type','application/json');res.end(JSON.stringify(canonicalPlan));return;}
 if(!file.startsWith('/packages/web/'))throw Error('outside assets');
 const absolute=path.resolve(webRoot,'.'+file.slice('/packages/web'.length));if(!absolute.startsWith(webRoot+path.sep))throw Error('outside assets');
 let data=await readFile(absolute);if(file.endsWith('/document-motion/index.html'))data=Buffer.from(data.toString().replace('</body>','<script type="module" src="/receiving-test.js"></script></body>'));
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html');res.end(data);
}catch{res.statusCode=404;res.end('missing test asset');}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+(movie?'/movie-player':'/packages/web/examples/document-motion/index.html');
 browser=await launchChrome(await findChrome());const target=await createPage(browser.debugUrl,url);
 const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:900,url,focus:true,trustedInput:true,allowEmulation:true,screenshotDirectory:evidence,timeoutMs:55000});
 if(result.ok!==true)throw Error(result.error??'Runtime check did not return a completed result');
 if(evidence&&result.exported){await writeFile(path.join(evidence,'video.json'),JSON.stringify(result.exported.video,null,2)+'\n');for(const source of result.exported.sources)await writeFile(path.join(evidence,source.id+'.png'),Buffer.from(source.png,'base64'));}
 delete result.exported;process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve));}
