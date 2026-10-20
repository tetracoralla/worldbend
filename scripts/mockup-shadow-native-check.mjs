// Same authored browser programs through source CLI/MCP and native output.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StdioClient} from './composition-provider-chain-check.mjs';
import {createServer} from 'node:http';
import {findChrome,launchChrome,closeChrome,createPage,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flag=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1]};
const evidence=path.resolve(flag('--evidence')??'.worldbend-work/scene-shadow');
const cli=flag('--cli')??path.join(root,'target/debug/worldbend');
const ffmpeg=flag('--ffmpeg'),ffprobe=flag('--ffprobe');
if(!ffmpeg||!ffprobe)throw Error('Provide exact ffmpeg and ffprobe paths');
function run(bin,args){const r=spawnSync(bin,args,{encoding:'utf8',maxBuffer:32<<20});if(r.status!==0)throw Error(r.stderr||r.stdout||r.error?.message);return JSON.parse(r.stdout)}
const client=new StdioClient(path.join(root,'target/debug/worldbend-mcp'),['--root',root,'--surface','catalog']);
const reports=[];
let maximumDiagnosticDifference=0;
function comparePlans(actual,expected,key='plan'){
 if(typeof actual==='number'&&typeof expected==='number'&&key.includes('.diagnostics.')){
   const difference=Math.abs(actual-expected);assert(difference<=1e-12*Math.max(1,Math.abs(expected)),key+' diagnostic drift');maximumDiagnosticDifference=Math.max(maximumDiagnosticDifference,difference);return;
 }
 // Saved Web evidence uses JSON.stringify, which writes either signed zero
 // as 0. Require identical numerical matrix/geometry values, without treating
 // that JSON representation change as a projection difference.
 if(typeof actual==='number'&&typeof expected==='number'){assert(actual===expected,key);return}
 if(Array.isArray(expected)){assert(Array.isArray(actual));assert.equal(actual.length,expected.length,key);expected.forEach((v,i)=>comparePlans(actual[i],v,key+'['+i+']'));return}
 if(expected&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort(),key);for(const name of Object.keys(expected))comparePlans(actual[name],expected[name],key+'.'+name);return}
 assert.deepEqual(actual,expected,key);
}
try{await client.initialize();
const discovery=await client.callTool('worldbend.search',{query:'mockup_plan',limit:20});assert(discovery.result?.structuredContent?.result?.operations?.some(row=>row.operation==='mockup_plan'));
for(const name of ['cover','series']){
 const motion=JSON.parse(await readFile(path.join(evidence,name+'.motion.json'),'utf8'));
 const wasm=JSON.parse(await readFile(path.join(evidence,name+'.wasm-plan.json'),'utf8'));
 const video={schema:'worldbend.mockup-video',version:'0.1',backgroundRgb:[233,229,219],encoding:{format:'mp4H264',crf:18},mockupMotion:motion};
 const specPath=path.join(evidence,name+'.video.json');await writeFile(specPath,JSON.stringify(video,null,2)+'\n');
 const native=run(cli,['mockup-video-inspect','--spec',specPath,'--json']);
 const plan=native.result??native;
 // CLI returns the common video plan; its expanded motion is byte-meaningful.
 const nativeMotion=plan.mockupMotion;
 assert.deepEqual(nativeMotion,wasm,'native/WASM expanded motion diverged');
 const still=wasm.frameSpecs[0],stillPath=path.join(evidence,name+'.still.json');await writeFile(stillPath,JSON.stringify(still,null,2)+'\n');
 const wasmShadows=JSON.parse(await readFile(path.join(evidence,name+'.wasm-shadow-plans.json'),'utf8')),mcpPlans=[];
 for(const [sample,index]of [0,47,95].entries()){
   const mcp=await client.callTool('worldbend.run',{operation:'mockup_plan',arguments:{spec:wasm.frameSpecs[index]}});assert(mcp.result?.structuredContent?.ok,JSON.stringify(mcp));
   const resolved=mcp.result.structuredContent.result;assert(resolved.planes.every(plane=>plane.shadow?.profile==='worldbend.projected-alpha-shadow@0.1'));
   // Projection/spec/matrix values stay exact. Diagnostic lengths use platform
   // hypot/sqrt and may differ by one f64 rounding unit across native/WASM.
   comparePlans(resolved,wasmShadows[sample]);mcpPlans.push(resolved);
 }
 await writeFile(path.join(evidence,name+'.mcp-plans.json'),JSON.stringify(mcpPlans,null,2)+'\n');
 const source='cover='+path.join(evidence,'cover.png');
 const png=run(cli,['mockup-render','--source',source,'--spec',stillPath,'--output',path.join(evidence,name+'.native.png'),'--overwrite','--json']);
 const miniature=structuredClone(still);miniature.canvas={width:160,height:120};for(const plane of miniature.planes){plane.shadow.offset.x/=6;plane.shadow.offset.y/=6;plane.shadow.blurSigmaPx/=6}
 const miniSpec=path.join(evidence,name+'.miniature.json');await writeFile(miniSpec,JSON.stringify(miniature,null,2)+'\n');
 const mcpPath=path.join(evidence,name+'.mcp-miniature.png'),cliPath=path.join(evidence,name+'.cli-miniature.png');
 const mcpImage=await client.callTool('worldbend.run',{operation:'mockup_render',arguments:{sources:[{id:'cover',source:path.relative(root,path.join(evidence,'cover.png'))}],spec:miniature,output:path.relative(root,mcpPath),overwrite:true}});
 assert(mcpImage.result?.structuredContent?.ok,JSON.stringify(mcpImage));
 run(cli,['mockup-render','--source',source,'--spec',miniSpec,'--output',cliPath,'--overwrite','--json']);
 assert.deepEqual(await readFile(mcpPath),await readFile(cliPath),'source MCP/CLI miniature rendered bytes differ');
 const rendered=run(cli,['mockup-video-render','--source',source,'--spec',specPath,'--output',path.join(evidence,name+'.mp4'),'--ffmpeg',ffmpeg,'--ffprobe',ffprobe,'--overwrite','--json']);
 const probe=run(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate:format=duration','-of','json',path.join(evidence,name+'.mp4')]);
 assert.equal(Number(probe.streams[0].nb_read_frames),96);assert.equal(probe.streams[0].width,960);assert.equal(probe.streams[0].height,720);assert.equal(Number(probe.format.duration),4);
 await writeFile(path.join(evidence,name+'.native-output.json'),JSON.stringify({png,mcpMiniature:mcpImage.result.structuredContent.result,rendered,probe},null,2)+'\n');reports.push({name,nativeWasmFrames:96,sourceMcpPlan:true,sourceMcpHighResolutionArtworkMiniature:true,width:960,height:720,decodedFrames:96,durationSeconds:4});
}
}finally{await client.close()}
const playback=`<!doctype html><script type="module">
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{const reports=[];for(const name of ['cover','series']){const video=document.createElement('video');video.muted=true;video.controls=true;video.src='/'+name+'.mp4';document.body.append(video);await video.play();for(let n=0;n<200&&video.currentTime<.35;n++)await wait(10);if(video.videoWidth!==960||video.videoHeight!==720||video.currentTime<.35||video.getVideoPlaybackQuality().totalVideoFrames<2)throw Error(name+' did not play');video.pause();video.currentTime=2;for(let n=0;n<200&&video.seeking;n++)await wait(10);if(video.seeking||Math.abs(video.currentTime-2)>.05)throw Error(name+' did not seek: '+JSON.stringify({time:video.currentTime,duration:video.duration,seeking:video.seeking,ready:video.readyState,error:video.error?.message,seekable:[...Array(video.seekable.length)].map((_,i)=>[video.seekable.start(i),video.seekable.end(i)])}));reports.push({name,actualPlayback:true,actualSeeking:true,decodedFrames:video.getVideoPlaybackQuality().totalVideoFrames});video.remove()}globalThis.__WORLDBEND_PARITY__={ok:true,reports}}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack}}
</script>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end(playback);return}
 if(!['/cover.mp4','/series.mp4'].includes(req.url))throw Error('unknown movie');
 const bytes=await readFile(path.join(evidence,req.url.slice(1)));res.setHeader('content-type','video/mp4');res.setHeader('accept-ranges','bytes');
 const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'');
 if(match){const start=Number(match[1]),end=Math.min(bytes.length-1,match[2]?Number(match[2]):bytes.length-1);if(start>end||start>=bytes.length){res.writeHead(416,{'content-range':'bytes */'+bytes.length});res.end();return}res.statusCode=206;res.setHeader('content-range','bytes '+start+'-'+end+'/'+bytes.length);res.setHeader('content-length',end-start+1);res.end(bytes.subarray(start,end+1));return}
 res.setHeader('content-length',bytes.length);res.end(bytes);
 }catch{res.statusCode=404;res.end('missing')}});
let browser,played;
try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';browser=await launchChrome(await findChrome());const target=await createPage(browser.debugUrl,url);played=await readPageResult(target.webSocketDebuggerUrl,{width:960,height:720,url,focus:true,timeoutMs:20000});if(played.error)throw Error(played.error)}finally{if(browser)await closeChrome(browser);await new Promise(resolve=>server.close(resolve))}
process.stdout.write(JSON.stringify({ok:true,scope:'source CLI/MCP shadow rendering and playback',maximumDiagnosticDifference,reports,playback:played},null,2)+'\n');
