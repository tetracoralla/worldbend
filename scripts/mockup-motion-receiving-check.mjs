// Built-package receiving flow with actual pixels and trusted browser input.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const webRootFlag=process.argv.indexOf('--web-root');
const webRoot=webRootFlag<0?path.join(root,'packages/web'):path.resolve(process.argv[webRootFlag+1]);
const evidenceFlag=process.argv.indexOf('--evidence');
const evidence=evidenceFlag<0?undefined:path.resolve(process.argv[evidenceFlag+1]);
if(evidence)await mkdir(evidence,{recursive:true});
const test=`
import {attachMockupMotion} from '/packages/web/dist/mockup-motion.js';
import {planMockupMotion} from '/packages/web/dist/index.js';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(value,message)=>{if(!value)throw Error(message)};
const pixels=c=>[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];
const equal=(a,b)=>a.length===b.length&&a.every((value,index)=>value===b[index]);
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};
try{
 for(let n=0;n<500&&!globalThis.sceneStudy;n++){if(globalThis.sceneStudyError)throw Error(globalThis.sceneStudyError);await wait(10)}
 const s=globalThis.sceneStudy;assert(s,'receiving example did not initialize');
 const c=s.controller,first=pixels(c.canvas), reports=[];
 assert(first.some((value,index)=>index%4!==3&&value>0),'initial scene is blank');
 c.seek(3000);document.getElementById('position').focus();
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
 await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
 assert(c.getState().timeMs===0&&document.getElementById('position').value==='0','native range input lost requested time during pause callback');
 c.seek(1450);const middle=pixels(c.canvas);assert(!equal(first,middle),'seek did not change actual scene pixels');
 const before=JSON.stringify(c.getState());
 try{await c.update(s.spec,s.sources,{expectedRevision:0});throw Error('stale accepted')}catch(error){assert(error.message.includes('Stale'),'wrong stale error')}
 assert(before===JSON.stringify(c.getState())&&equal(middle,pixels(c.canvas)),'stale update changed accepted work');
 try{await c.update(s.spec,s.sources.slice(1),{expectedRevision:1});throw Error('missing source accepted')}catch(error){assert(error.message.includes('exactly match'),'wrong source failure')}
 const invalid=structuredClone(s.spec);invalid.planes[0].keyframes[0].quad.tr.x=NaN;
 try{await c.update(invalid,s.sources,{expectedRevision:1});throw Error('invalid geometry accepted')}catch(error){assert(error.message!=='invalid geometry accepted','invalid core geometry accepted')}
 assert(before===JSON.stringify(c.getState())&&equal(middle,pixels(c.canvas)),'failed preparation damaged last valid scene');
 const revision=c.getState().revision, nodes=[...document.querySelector('aside').childNodes];
 const button=document.getElementById('artwork'),box=button.getBoundingClientRect();
 await trusted('Input.dispatchMouseEvent',{type:'mousePressed',x:box.x+20,y:box.y+20,button:'left',clickCount:1});
 await trusted('Input.dispatchMouseEvent',{type:'mouseReleased',x:box.x+20,y:box.y+20,button:'left',clickCount:1},'book-scene-revised');
 for(let n=0;n<300&&c.getState().revision===revision;n++)await wait(10);
 assert(c.getState().revision===revision+1&&c.getState().timeMs===1450&&c.getState().paused,'trusted artwork replacement lost playhead or pause');
 await trusted('Input.dispatchMouseEvent',{type:'mouseMoved',x:5,y:5},'book-scene-revised');
 assert(!equal(middle,pixels(c.canvas))&&nodes.every(node=>node.parentNode===document.querySelector('aside')),'replacement changed no pixels or replaced application content');
 const timing=document.getElementById('timing');timing.focus();
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\\r'});
 await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 for(let n=0;n<300&&c.getState().revision===revision+1;n++)await wait(10);
 assert(c.getState().revision===revision+2&&Math.abs(c.getState().timeMs/4000-1450/3000)<1e-9,'keyboard retiming lost relative position');
 c.play();await wait(160);c.pause();const paused=c.getState().timeMs;await wait(80);assert(c.getState().timeMs===paused&&paused>1450,'play/pause clock failed');
 c.play();const liveTime=c.getState().timeMs;await c.update(s.spec,s.sources,{expectedRevision:c.getState().revision});
 assert(!c.getState().paused&&c.getState().timeMs>=liveTime,'live source update reset playhead or paused playback');c.pause();
 c.setVisible(false);c.play();const hidden=c.getState().timeMs;await wait(90);assert(c.getState().timeMs===hidden,'hidden scene advanced');c.pause();c.setVisible(true);
 const previousCreate=createImageBitmap;let blocked,release;
 globalThis.createImageBitmap=async(...args)=>{const bitmap=await previousCreate(...args);blocked=bitmap;await new Promise(resolve=>release=resolve);return bitmap};
 const abort=new AbortController(),state=JSON.stringify(c.getState()),beforeCancel=pixels(c.canvas);
 const pending=c.update(s.spec,s.sources,{expectedRevision:c.getState().revision,signal:abort.signal});
 for(let n=0;n<300&&!blocked;n++)await wait(5);assert(blocked,'snapshot acquisition did not start');abort.abort();release();
 try{await pending;throw Error('abort accepted')}catch(error){assert(error.name==='AbortError','wrong cancellation error')}
 globalThis.createImageBitmap=previousCreate;
 assert(blocked.width===0&&state===JSON.stringify(c.getState())&&equal(beforeCancel,pixels(c.canvas)),'cancelled update leaked image or changed accepted work');
 await c.update(s.spec,s.sources,{expectedRevision:c.getState().revision});
 const authoredHost=document.createElement('div');authoredHost.style.width='320px';document.body.append(authoredHost);
 const authored=await attachMockupMotion(authoredHost,s.spec,s.sources);
 const baseGuard=authored.getAuthoringGuard(),initialAuthoring=authored.getAuthoring();
 try{await authored.author({kind:'capturePose',frame:20},c.getAuthoringGuard());throw Error('foreign guard accepted')}catch(error){assert(error.message.includes('another receiving instance'),'wrong instance guard failure')}
 const noop=await authored.author({kind:'reorderPlanes',ids:authored.getSpec().planes.map(p=>p.id)},baseGuard);
 assert(!noop.authoring.changed&&noop.guard.expectedRevision===baseGuard.expectedRevision,'no-op authoring changed runtime revision');
 const receipt=await authored.author({kind:'capturePose',frame:20},baseGuard);
 assert(receipt.authoring.keyframeFrames.includes(20)&&receipt.guard.fingerprint===authored.getAuthoring().fingerprint,'authoring receipt lost canonical pose');
 try{await authored.author({kind:'capturePose',frame:25},baseGuard);throw Error('stale author accepted')}catch(error){assert(error.message.includes('Stale'),'wrong author stale failure')}
 const guarded=authored.getAuthoringGuard(),acceptedPixels=pixels(authored.canvas),acceptedSpec=JSON.stringify(authored.getSpec());blocked=undefined;release=undefined;
 globalThis.createImageBitmap=async(...args)=>{const bitmap=await previousCreate(...args);blocked=bitmap;await new Promise(resolve=>release=resolve);return bitmap};
 const authorAbort=new AbortController(),pendingAuthor=authored.author({kind:'capturePose',frame:25},{...guarded,signal:authorAbort.signal});
 for(let n=0;n<300&&!blocked;n++)await wait(5);assert(blocked,'authoring image snapshot did not begin');authorAbort.abort();
 const promptly=await Promise.race([pendingAuthor.then(()=>false,error=>error.name==='AbortError'),wait(250).then(()=>false)]);
 assert(promptly,'cancelled authoring waited for blocked image acquisition');release();await wait(30);globalThis.createImageBitmap=previousCreate;
 assert(blocked.width===0&&JSON.stringify(authored.getSpec())===acceptedSpec&&equal(acceptedPixels,pixels(authored.canvas)),'cancelled authoring damaged accepted work or leaked late bitmap');
 await authored.author({kind:'capturePose',frame:25},guarded);
 await authored.update(initialAuthoring.spec,s.sources,{expectedRevision:authored.getState().revision});
 assert(authored.getAuthoring().fingerprint===initialAuthoring.fingerprint,'history restore lost canonical work');authored.destroy();authoredHost.remove();
 const exported={spec:s.spec,motion:await planMockupMotion(s.spec),sources:s.sources.map(source=>({id:source.id,png:source.image.toDataURL('image/png').split(',')[1]}))};
 const presentedHost=document.createElement('div');presentedHost.style.width='400px';document.body.prepend(presentedHost);
 const presentedSpec=structuredClone(s.spec),presentedSources=s.artwork();
 presentedSpec.background={kind:"transparent"};presentedHost.style.background="#ede9df";
 presentedSpec.presentation={transform:{schema:'worldbend.transform',version:'0.1',destination:{space:'normalized',quad:{tl:{x:.04,y:.03},tr:{x:.96,y:.08},br:{x:.92,y:.98},bl:{x:.08,y:.94}}},content:{fit:'stretch',orientation:'native'}},size:{width:800,height:600},output:{kind:'canvasSet',spec:{schema:'worldbend.canvas-set',version:'0.1',variants:[{id:'square',operation:{kind:'crop',rect:{x:100,y:0,width:600,height:600}}},{id:'wide',operation:{kind:'stretch',output:{width:800,height:400}}}]}},outputId:'square'};
 const wholeStart=structuredClone(presentedSpec.presentation.transform.destination.quad);
 const wholeMiddle={tl:{x:.13,y:.10},tr:{x:.87,y:.01},br:{x:.98,y:.88},bl:{x:.03,y:.99}};
 const wholeEnd={tl:{x:.07,y:.07},tr:{x:.97,y:.02},br:{x:.93,y:.95},bl:{x:.05,y:.89}};
 presentedSpec.presentation.keyframes=[{frame:0,quad:wholeStart,easingToNext:{kind:'hold'}},{frame:12,quad:wholeStart,easingToNext:{kind:'cubicBezier',x1:.22,y1:0,x2:.35,y2:1}},{frame:60,quad:wholeMiddle,easingToNext:{kind:'cubicBezier',x1:.22,y1:0,x2:.35,y2:1}},{frame:84,quad:wholeEnd,easingToNext:{kind:'hold'}},{frame:95,quad:wholeEnd}];
 const presentationContexts=[];const beforePresentationContext=HTMLCanvasElement.prototype.getContext;
 HTMLCanvasElement.prototype.getContext=function(type,...args){const value=beforePresentationContext.call(this,type,...args);if(type==='webgl2')presentationContexts.push(value);return value};
 const presented=await attachMockupMotion(presentedHost,presentedSpec,presentedSources);HTMLCanvasElement.prototype.getContext=beforePresentationContext;
 assert(presented.canvas.width===600&&presented.canvas.height===600,'named presentation output was not rendered');
 const presentationFrames=[];
 for(const index of [0,48,95]){presented.seek(index*1000*presentedSpec.timebase.denominator/presentedSpec.timebase.numerator);presentationFrames.push({index,png:presented.canvas.toDataURL('image/png').split(',')[1]})}
 assert(presentationFrames[0].png!==presentationFrames[1].png,'presentation dropped animated layer poses');
 const completePlan=await planMockupMotion(presentedSpec);
 assert(completePlan.presentationFrames.length===96&&JSON.stringify(completePlan.presentationFrames[60].spec.transform.destination.quad)===JSON.stringify(wholeMiddle),'whole-view motion did not use canonical authored poses');
 presented.seek(2000);const animatedMiddle=pixels(presented.canvas);
 const frozenWhole=structuredClone(presentedSpec);frozenWhole.presentation.transform.destination.quad=completePlan.presentationFrames[48].spec.transform.destination.quad;delete frozenWhole.presentation.keyframes;
 const comparisonHost=document.createElement('div');document.body.append(comparisonHost);
 const frozenReceiver=await attachMockupMotion(comparisonHost,frozenWhole,presentedSources);frozenReceiver.seek(2000);
 assert(equal(animatedMiddle,pixels(frozenReceiver.canvas)),'whole-view frame disagrees with ordinary static presentation');frozenReceiver.destroy();comparisonHost.remove();
 const beforeRetime=presented.getAuthoringGuard();try{await presented.author({kind:'retime',timebase:presentedSpec.timebase,frameCount:2},beforeRetime);throw Error('merged whole poses accepted')}catch(error){assert(error.message.includes('merge authored poses'),'wrong whole retime refusal')}
 assert(equal(animatedMiddle,pixels(presented.canvas))&&JSON.stringify(beforeRetime)===JSON.stringify(presented.getAuthoringGuard()),'failed whole retime changed accepted work');
 presented.seek(95*1000/24);

 const presentationExport={spec:presentedSpec,motion:await planMockupMotion(presentedSpec),sources:presentedSources.map(source=>({id:source.id,png:source.image.toDataURL('image/png').split(',')[1]})),frames:presentationFrames};
 const facing=pixels(presented.canvas),mirroredPresentation=structuredClone(presentedSpec.presentation);mirroredPresentation.transform.content.orientation='flipHorizontal';
 await presented.author({kind:'setPresentation',presentation:mirroredPresentation},presented.getAuthoringGuard());assert(!equal(facing,pixels(presented.canvas)),'whole-scene orientation was ignored');
 await presented.author({kind:'setPresentation',presentation:presentedSpec.presentation},presented.getAuthoringGuard());assert(equal(facing,pixels(presented.canvas)),'whole-scene orientation undo changed work');
 const presentationRevision=presented.getState().revision;
 const badPresentation=structuredClone(presentedSpec);badPresentation.presentation.outputId='missing';const priorPresentation=pixels(presented.canvas);
 try{await presented.update(badPresentation,presentedSources,{expectedRevision:presented.getState().revision});throw Error('bad presentation accepted')}catch(error){assert(error.message.includes('named motion presentation output'),'wrong presentation refusal')}
 assert(equal(priorPresentation,pixels(presented.canvas))&&presented.getState().revision===presentationRevision,'bad presentation changed accepted scene');
 const controls=presentationContexts.map(gl=>gl.getExtension('WEBGL_lose_context'));assert(controls.length===2&&controls.every(Boolean),'whole presentation did not reuse two tracked contexts');
 controls.forEach(extension=>extension.loseContext());await wait(50);assert(presented.getState().status==='lost','presentation loss was ignored');
 controls[0].restoreContext();await wait(70);assert(presented.getState().status==='lost','partial presentation restoration resumed');
 controls[1].restoreContext();await wait(130);assert(presented.getState().status==='ready'&&equal(priorPresentation,pixels(presented.canvas)),'presentation restoration lost accepted pixels');
 await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9},'presented-book-square');
 const changedPresentation=structuredClone(presentedSpec);changedPresentation.presentation.outputId='wide';await presented.update(changedPresentation,presentedSources,{expectedRevision:presentationRevision});
 assert(presented.canvas.width===800&&presented.canvas.height===400&&presented.getSpec().presentation.output.spec.variants.length===2,'output change discarded sibling framing');
 const beforeArtwork=pixels(presented.canvas),beforeArtworkTime=presented.getState().timeMs,beforeArtworkFingerprint=presented.getAuthoring().fingerprint;
 const revisedSources=presentedSources.map(source=>{if(source.id!=='cover')return source;const image=document.createElement('canvas');image.width=source.image.width;image.height=source.image.height;const context=image.getContext('2d');context.drawImage(source.image,0,0);context.fillStyle='#cc8053';context.fillRect(40,380,510,180);return {id:source.id,image}});
 await presented.update(changedPresentation,revisedSources,{expectedRevision:presented.getState().revision});
 assert(!equal(beforeArtwork,pixels(presented.canvas))&&presented.getAuthoring().fingerprint===beforeArtworkFingerprint&&presented.getState().timeMs===beforeArtworkTime,'continued artwork lost presentation, timing or source refresh');

 presented.destroy();assert(!presentedHost.querySelector('canvas'),'presentation disposal kept visible work');presentedHost.remove();

 c.seek(0);const retained=pixels(c.canvas);s.sources.find(source=>source.id==='cover').image.getContext('2d').clearRect(0,0,600,800);c.seek(100);c.seek(0);assert(equal(retained,pixels(c.canvas)),'caller-owned pixel mutation changed delivered snapshot');
 const immutable=c.getSpec();immutable.timebase.numerator=1;assert(c.getSpec().timebase.numerator===24,'caller mutation changed retained scene');
 const paintSource=color=>{const image=document.createElement('canvas');image.width=image.height=16;const x=image.getContext('2d');x.fillStyle=color;x.fillRect(0,0,16,16);return image};
 const unit={tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}};
 const contour=(a,b)=>({start:{x:a,y:a},segments:[{kind:'line',to:{x:b,y:a}},{kind:'line',to:{x:b,y:b}},{kind:'line',to:{x:a,y:b}}]});
 const clipped=structuredClone(s.spec);clipped.canvas={width:160,height:120};clipped.frameCount=2;clipped.timebase={numerator:10,denominator:1};
 clipped.planes=['bottom','top'].map((id,index)=>({id,sourceId:id,opacity:index===0?1:.5,base:{schema:'worldbend.transform',version:'0.1',destination:{space:'normalized',quad:unit},content:{fit:'stretch'}},keyframes:[{frame:0,quad:unit},{frame:1,quad:unit}]}));
 clipped.clip={contours:[contour(0,1),contour(.3,.7)],fillRule:'evenOdd'};
 const clipHost=document.createElement('div');clipHost.style.width='160px';document.body.append(clipHost);
 const clipSources=[{id:'bottom',image:paintSource('white')},{id:'top',image:paintSource('red')}];
 const clipReceiver=await attachMockupMotion(clipHost,clipped,clipSources),compositionSamples=[];
 const reference=document.createElement('canvas');reference.width=160;reference.height=120;
 const referenceContext=reference.getContext('2d');
 const checkComposition=(opacity,reversed=false)=>{
  referenceContext.globalAlpha=1;referenceContext.clearRect(0,0,160,120);
  for(const source of reversed?[...clipSources].reverse():clipSources){
   referenceContext.globalAlpha=source.id==='top'?opacity:1;
   referenceContext.drawImage(source.image,0,0,160,120);
  }
  const expected=[...referenceContext.getImageData(10,10,1,1).data],clipPx=pixels(clipReceiver.canvas),corner=(10*160+10)*4,hole=(60*160+80)*4;
  const actual=clipPx.slice(corner,corner+4);compositionSamples.push({opacity,reversed,actual,expected});
  // GPU sampling and Canvas2D composition have separate 8-bit rounding.
  // Compare RGB with the independent Canvas2D reference within two values;
  // keep fully opaque output and the compound mask's transparent hole exact.
  assert(actual[0]===255&&[1,2].every(index=>Math.abs(actual[index]-expected[index])<=2)&&actual[3]===255&&clipPx[hole+3]===0,
   'ordered opacity or compound whole-scene clip failed: '+JSON.stringify({opacity,reversed,actual,expected,hole:clipPx.slice(hole,hole+4),size:[clipReceiver.canvas.width,clipReceiver.canvas.height]}));
 };
 checkComposition(.5);
 for(const opacity of [0,.25,.75,1]){
  const next=structuredClone(clipped);next.planes[1].opacity=opacity;
  await clipReceiver.update(next,clipSources,{expectedRevision:clipReceiver.getState().revision});checkComposition(opacity);
 }
 const reversedClip=structuredClone(clipped);reversedClip.planes.reverse();
 await clipReceiver.update(reversedClip,clipSources,{expectedRevision:clipReceiver.getState().revision});checkComposition(.5,true);
 clipReceiver.destroy();clipHost.remove();
 const host=document.createElement('div');host.style.width='400px';document.body.append(host);
 const originalGetContext=HTMLCanvasElement.prototype.getContext;let sceneGl;
 HTMLCanvasElement.prototype.getContext=function(type,...args){const value=originalGetContext.call(this,type,...args);if(type==='webgl2')sceneGl=value;return value};
 const extra=await attachMockupMotion(host,s.spec,s.artwork(),{onChange:()=>{throw Error('host callback')},onError:error=>reports.push(error.message)});
 HTMLCanvasElement.prototype.getContext=originalGetContext;
 assert(reports.length&&extra.getState().status==='ready','host callback corrupted attachment');
 extra.seek(1200);const beforeLoss=pixels(extra.canvas),lossTime=extra.getState().timeMs;
 const loss=sceneGl.getExtension('WEBGL_lose_context');assert(loss,'context loss probe unavailable');loss.loseContext();
 for(let n=0;n<200&&extra.getState().status!=='lost';n++)await wait(5);
 assert(extra.getState().status==='lost','actual GL context loss was not reported');loss.restoreContext();
 for(let n=0;n<200&&extra.getState().status!=='ready';n++)await wait(5);
 assert(extra.getState().status==='ready'&&extra.getState().timeMs===lossTime&&equal(beforeLoss,pixels(extra.canvas)),'GL restoration lost actual work or playhead');
 blocked=undefined;release=undefined;
 globalThis.createImageBitmap=async(...args)=>{const bitmap=await previousCreate(...args);blocked=bitmap;await new Promise(resolve=>release=resolve);return bitmap};
 const retiring=extra.update(s.spec,s.artwork(),{expectedRevision:extra.getState().revision});
 for(let n=0;n<200&&!blocked;n++)await wait(5);assert(blocked,'retirement snapshot did not begin');extra.destroy();release();
 try{await retiring;throw Error('retired update accepted')}catch(error){assert(error.name==='AbortError','wrong retirement failure')}
 globalThis.createImageBitmap=previousCreate;
 extra.destroy();assert(blocked.width===0&&!host.querySelector('canvas'),'retirement retained late image/canvas');host.remove();
 const reducedHost=document.createElement('div');reducedHost.style.width='400px';document.body.append(reducedHost);
 const reduced=await attachMockupMotion(reducedHost,s.spec,s.artwork(),{paused:false});
 globalThis.__WORLDBEND_INPUT__={method:'Emulation.setEmulatedMedia',params:{features:[{name:'prefers-reduced-motion',value:'reduce'}]}};
 while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__;
 await wait(50);const reducedTime=reduced.getState().timeMs;await wait(70);
 assert(reduced.getState().reducedMotion&&reduced.getState().timeMs===reducedTime&&!reduced.play(),'reduced motion kept playing');reduced.seek(1000);assert(reduced.getState().timeMs===1000,'reduced motion disabled explicit seeking');reduced.destroy();reducedHost.remove();
 await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await trusted('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},'book-scene-mobile');
 assert(document.documentElement.scrollWidth<=390,'mobile receiving page overflows horizontally');
 globalThis.__WORLDBEND_PARITY__={ok:true,scope:'built Web package: scene playback, updates and recovery',guardedAuthoring:true,promptAuthoringCancellation:true,actualSeeking:true,artworkRevision:true,relativeRetiming:true,trustedPointer:true,trustedKeyboard:true,trustedRangeInput:true,liveSourceRevision:true,cancellationAndRetry:true,immutableSourceSnapshot:true,orderedOpacityAndCompoundClip:true,compositionSamples,contextRestored:true,lateRetirement:true,reducedMotion:true,mobileReflow:true,frames:c.getState().frameCount,wholePresentation:true,presentationContextRecovery:true,presentationExport,exported};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}}
`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');let file=url.pathname==='/'?'/packages/web/examples/scene-motion/index.html':url.pathname;
 if(file==='/receiving-test.js'){res.setHeader('content-type','text/javascript');res.end(test);return}
 if(!file.startsWith('/packages/web/'))throw Error('outside test assets');
 const absolute=path.resolve(webRoot,'.'+file.slice('/packages/web'.length));if(!absolute.startsWith(webRoot+path.sep))throw Error('outside test assets');
 let data=await readFile(absolute);if(file.endsWith('/scene-motion/index.html'))data=Buffer.from(data.toString().replace('</body>','<script type="module" src="/receiving-test.js"></script></body>'));
 res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.wasm')?'application/wasm':'text/html');res.end(data);
}catch{res.statusCode=404;res.end('missing test asset')}});
let browser;
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port+'/packages/web/examples/scene-motion/index.html';
 browser=await launchChrome(await findChrome());const target=await createPage(browser.debugUrl,url);
 const result=await readPageResult(target.webSocketDebuggerUrl,{width:1280,height:900,url,focus:true,trustedInput:true,allowEmulation:true,screenshotDirectory:evidence,timeoutMs:55000});
 if(result.error)throw Error(result.error);
 if(evidence){await writeFile(path.join(evidence,'scene.json'),JSON.stringify(result.exported.spec,null,2)+'\n');await writeFile(path.join(evidence,'wasm-motion.json'),JSON.stringify(result.exported.motion,null,2)+'\n');for(const source of result.exported.sources)await writeFile(path.join(evidence,source.id+'.png'),Buffer.from(source.png,'base64'))}
 if(evidence&&result.presentationExport){const item=result.presentationExport;await writeFile(path.join(evidence,'presented-scene.json'),JSON.stringify(item.spec,null,2)+'\n');await writeFile(path.join(evidence,'presented-wasm-motion.json'),JSON.stringify(item.motion,null,2)+'\n');for(const source of item.sources)await writeFile(path.join(evidence,'presented-'+source.id+'.png'),Buffer.from(source.png,'base64'));for(const frame of item.frames)await writeFile(path.join(evidence,'presented-frame-'+frame.index+'.png'),Buffer.from(frame.png,'base64'))}
 delete result.presentationExport;delete result.exported;process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve))}
