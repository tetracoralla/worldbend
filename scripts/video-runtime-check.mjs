// Current native CLI + configured host encoder + actual browser decoder.
// No encoder download, publication or installation. The authored program and
// source evidence survive retiming/source replacement; MP4 pixels are lossy.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkEncodedVideo} from './video-browser-check.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map();
for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--')&&process.argv[i+1],'Use --flag value');args.set(process.argv[i],process.argv[i+1]);}
for(const flag of args.keys())assert(['--cli','--ffmpeg','--ffprobe','--source','--replacement','--evidence'].includes(flag),'Unknown flag '+flag);
for(const key of ['--ffmpeg','--ffprobe'])assert(args.has(key)&&path.isAbsolute(args.get(key)),'Configure absolute host '+key+' path');
const evidence=path.resolve(args.get('--evidence')??path.join(root,'.worldbend-work/video-runtime'));
assert(evidence.startsWith(root+path.sep)&&evidence.includes(path.sep+'.worldbend-work'+path.sep),'Evidence must be in this repository’s ignored .worldbend-work');
await mkdir(evidence,{recursive:true});
const source=path.resolve(args.get('--source')??path.join(root,'examples/worldbend-demo-source.png'));
assert(args.has('--replacement'),'Provide a distinct --replacement PNG to verify continued source use');
const replacement=path.resolve(args.get('--replacement'));
const original=await readFile(source),replacementBytes=await readFile(replacement);
assert(!original.equals(replacementBytes),'Source replacement must change actual bytes');
assert(original.subarray(1,4).toString()==='PNG','Use an explicit PNG fixture');
const width=original.readUInt32BE(16),height=original.readUInt32BE(20);
const base={schema:'worldbend.transform',version:'0.1',destination:{space:'pixel',reference:{width:960,height:640},
 quad:{tl:{x:150,y:80},tr:{x:785,y:120},br:{x:750,y:565},bl:{x:115,y:505}}},
 content:{fit:'stretch',orientation:'native'}};
const specification={schema:'worldbend.video',version:'0.1',backgroundRgb:[16,22,34],encoding:{format:'mp4H264',crf:18},
 motion:{schema:'worldbend.motion',version:'0.1',output:{width:960,height:640},timebase:{numerator:30,denominator:1},sourceId:'art',
 frameCount:60,base,keyframes:[
  {frame:0,quad:base.destination.quad,easingToNext:{kind:'cubicBezier',x1:0.42,y1:0,x2:0.58,y2:1}},
  {frame:59,quad:{tl:{x:90,y:65},tr:{x:870,y:65},br:{x:870,y:575},bl:{x:90,y:575}}}
 ]}};
const wire=path.join(evidence,'authored-video.json');await writeFile(wire,JSON.stringify(specification,null,2)+'\n');
// Verify the optimized shipping path: debug rasterization is intentionally
// unoptimized and cannot establish this bounded video's execution latency.
const cli=path.resolve(args.get('--cli')??path.join(root,'target/release/worldbend'));
assert((await stat(cli)).isFile(),'Build the current CLI before this runtime check');
const cliSha256=createHash('sha256').update(await readFile(cli)).digest('hex');
const executions=[];
const activeChildren=new Map();
function launch(parameters){const child=spawn(cli,parameters,{cwd:root,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',overflow=false;const capture=(current,chunk)=>{
  if(Buffer.byteLength(current)+chunk.length>2**20){overflow=true;child.kill('SIGTERM');return current;}return current+chunk;};
 child.stdout.on('data',chunk=>{stdout=capture(stdout,chunk);});
 child.stderr.on('data',chunk=>{stderr=capture(stderr,chunk);});
 const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{
  if(overflow){reject(new Error('Bounded CLI response exceeded'));return;}
  try{resolve({code,signal,result:JSON.parse(stdout),stderr});}catch(error){reject(new Error('CLI did not return JSON: '+stderr+' '+error.message));}
 });});activeChildren.set(child,done);done.then(()=>activeChildren.delete(child),()=>activeChildren.delete(child));return{child,done};}
async function call(parameters){const started=performance.now();const response=await launch(parameters).done;assert.equal(response.code,0,JSON.stringify(response));assert(response.result.ok);
 executions.push({operation:parameters[0],elapsedMillis:Math.round(performance.now()-started)});return response.result.result;}
function render(output,spec=wire,input=source,extra=[]){return['video-render','--source','art='+input,'--spec',spec,'--output',output,
 '--ffmpeg',args.get('--ffmpeg'),'--ffprobe',args.get('--ffprobe'),'--json',...extra];}
try{
const inspect=await call(['video-inspect','--spec',wire,'--json']);assert.deepEqual(inspect.duration,{numerator:2,denominator:1});
const movie=path.join(evidence,'motion.mp4');const first=await call(render(movie,wire,source,['--overwrite']));
assert.equal(first.decodedFrameCount,60);assert.deepEqual(first.plan,inspect);
assert.equal(first.sources[0].sourceSha256,createHash('sha256').update(original).digest('hex'));
assert.equal(first.sha256,createHash('sha256').update(await readFile(movie)).digest('hex'));
const dry=path.join(evidence,'dry-run.mp4');await call(render(dry,wire,source,['--dry-run']));
assert.equal(await stat(dry).then(()=>true,()=>false),false,'Dry run published a movie');
const collision=await launch(render(movie)).done;assert.equal(collision.result.error?.code,'E_DESTINATION_EXISTS');
assert.equal(createHash('sha256').update(await readFile(movie)).digest('hex'),first.sha256);

const revised=structuredClone(specification);revised.motion.timebase={numerator:30000,denominator:1001};
const revision=path.join(evidence,'retimed-video.json');await writeFile(revision,JSON.stringify(revised,null,2)+'\n');
const next=path.join(evidence,'retimed.mp4');const second=await call(render(next,revision,replacement,['--overwrite']));
assert.equal(second.decodedFrameCount,60);assert.deepEqual(second.plan.duration,{numerator:1001,denominator:500});
assert.equal(second.sources[0].sourceSha256,createHash('sha256').update(replacementBytes).digest('hex'));
assert.deepEqual(second.plan.motion.frames.map(f=>f.presentationTime),revised.motion.frameCount===60?
 Array.from({length:60},(_,index)=>{let n=index*1001,d=30000;function gcd(a,b){while(b)[a,b]=[b,a%b];return a;}const g=gcd(n,d);return{numerator:n/g,denominator:d/g};}):[]);
assert.deepEqual(second.plan.motion.timeline.frames.map(f=>f.transform),first.plan.motion.timeline.frames.map(f=>f.transform),'Retiming changed geometry');

// A real external interrupt must return a typed cancellation and retire its
// owned staging. Use the higher-density execution to leave a rendering window.
if(process.platform!=='win32'){
 const dense=structuredClone(specification);dense.motion.output={width:1920,height:1080};dense.motion.frameCount=120;dense.motion.keyframes[1].frame=119;
 const densePath=path.join(evidence,'cancel-video.json');await writeFile(densePath,JSON.stringify(dense,null,2)+'\n');
 const cancelledOutput=path.join(evidence,'cancelled.mp4');const running=launch(render(cancelledOutput,densePath));
 const deadline=Date.now()+10000;
 while(!(await readdir(evidence)).some(name=>name.startsWith('.worldbend-video-stage-'))){
  assert(Date.now()<deadline,'No owned video staging before interrupt');await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert(running.child.kill('SIGINT'));const cancellation=await running.done;
 assert.equal(cancellation.result.error?.code,'E_CANCELLED');assert.equal(await stat(cancelledOutput).then(()=>true,()=>false),false);
 assert(!(await readdir(evidence)).some(name=>name.startsWith('.worldbend-video-stage-')),'Cancelled staging remained');
 const recovered=path.join(evidence,'recovered.mp4');await call(render(recovered,wire,source,['--overwrite']));
 // Interrupt the real encoder after it has created the private MP4. The
 // destination already exists: failed replacement must retain its bytes.
 const long=structuredClone(specification);long.motion.frameCount=240;long.motion.keyframes[1].frame=239;
 const longPath=path.join(evidence,'cancel-encoding.json');await writeFile(longPath,JSON.stringify(long,null,2)+'\n');
 const interrupted=path.join(evidence,'interrupted-replacement.mp4');await writeFile(interrupted,await readFile(movie));
 const encoding=launch(render(interrupted,longPath,source,['--overwrite']));let exited=false;
 encoding.done.finally(()=>{exited=true;}).catch(()=>{});
 const encodingDeadline=Date.now()+90000;let startedEncoding=false;
 while(!startedEncoding){
  for(const name of await readdir(evidence))if(name.startsWith('.worldbend-video-stage-')){
   startedEncoding=await stat(path.join(evidence,name,'video.mp4')).then(()=>true,()=>false);if(startedEncoding)break;
  }
  assert(!exited,'Encoding completed before the interruption was observed');
  assert(Date.now()<encodingDeadline,'No real encoder output before interrupt');
  if(!startedEncoding)await new Promise(resolve=>setTimeout(resolve,10));
 }
 const cancelledAt=performance.now();assert(encoding.child.kill('SIGTERM'));const encodedCancellation=await encoding.done;
 assert.equal(encodedCancellation.result.error?.code,'E_CANCELLED');
 assert(performance.now()-cancelledAt<2000,'Encoder cancellation did not retire promptly');
 assert.equal(createHash('sha256').update(await readFile(interrupted)).digest('hex'),first.sha256,'Interrupted replacement changed the destination');
 assert(!(await readdir(evidence)).some(name=>name.startsWith('.worldbend-video-stage-')),'Encoder staging remained');
}
assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'),first.sources[0].sourceSha256,'Source changed');
 const runtime=await checkEncodedVideo(movie,evidence);
 const report={cli:{path:cli,sha256:cliSha256},executions,source:{width,height,sha256:first.sources[0].sourceSha256},first,second,browser:runtime,scope:'current CLI, native encoder and Chrome video decoder'};
 await writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',frames:60,retimedDuration:second.plan.duration,browser:runtime,evidence},null,2));
}finally{
 for(const child of activeChildren.keys())child.kill('SIGTERM');
 await Promise.allSettled([...activeChildren.values()]);
}
