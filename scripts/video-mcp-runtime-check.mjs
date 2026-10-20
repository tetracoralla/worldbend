// Source MCP, actual host encoder, workspace authority and real media playback.
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,stat,copyFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkEncodedVideo} from './video-browser-check.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=new Map();
for(let i=2;i<process.argv.length;i+=2){assert(process.argv[i].startsWith('--')&&process.argv[i+1]);args.set(process.argv[i],process.argv[i+1]);}
for(const flag of args.keys())assert(['--mcp','--ffmpeg','--ffprobe','--source','--replacement','--evidence'].includes(flag),'Unknown flag '+flag);
for(const flag of ['--ffmpeg','--ffprobe','--source','--replacement'])assert(args.has(flag)&&path.isAbsolute(args.get(flag)),'Supply absolute '+flag);
const evidence=path.resolve(args.get('--evidence')??path.join(root,'.worldbend-work/video-mcp-runtime'));
assert(evidence.startsWith(root+path.sep)&&evidence.includes(path.sep+'.worldbend-work'+path.sep),'Use ignored private repository evidence');
const workspace=path.join(evidence,'workspace'),privateRoot=path.join(evidence,'private');
await mkdir(workspace,{recursive:true});await mkdir(privateRoot,{recursive:true});
const mcp=path.resolve(args.get('--mcp')??path.join(root,'target/release/worldbend-mcp'));
assert((await stat(mcp)).isFile(),'Build current source MCP');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const harness={sha256:digest(await readFile(fileURLToPath(import.meta.url))),browserHelperSha256:digest(await readFile(path.join(root,'scripts/video-browser-check.mjs')))};
const original=await readFile(args.get('--source')),replacement=await readFile(args.get('--replacement'));
assert(!original.equals(replacement),'Use distinct source bytes');
await writeFile(path.join(workspace,'source.png'),original);
const spec=JSON.parse(await readFile(path.join(root,'examples/video-motion.worldbend.json'),'utf8'));
const metrics=[],clients=[];
const exists=async file=>stat(file).then(()=>true,()=>false);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(check,timeout=15000){const start=Date.now();while(Date.now()-start<timeout){const value=await check();if(value)return value;await sleep(5);}throw Error('Timed out waiting for real execution state');}

class Client {
 pending=new Map();next=1;buffer='';stderr='';
 constructor(extra=[]){const environment={...process.env,WORLDBEND_PRIVATE_STAGING_ROOT:privateRoot};
  for(const key of ['WORLDBEND_WORKSPACE_ROOT','WORLDBEND_FFMPEG','WORLDBEND_FFPROBE'])delete environment[key];
  this.child=spawn(mcp,extra,{cwd:root,env:environment,stdio:['pipe','pipe','pipe']});
  clients.push(this);this.closed=new Promise(resolve=>this.child.once('close',resolve));
  this.child.stdout.on('data',chunk=>{this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>2**21){this.child.kill();return;}
   let newline;while((newline=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,newline);this.buffer=this.buffer.slice(newline+1);if(!line)continue;
    const message=JSON.parse(line),pending=this.pending.get(message.id);if(!pending)continue;
    this.pending.delete(message.id);clearTimeout(pending.timer);this.lastResponseBytes=Buffer.byteLength(line);if(message.error)pending.reject(Error(JSON.stringify(message.error)));else pending.resolve(message.result);}});
  this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk).slice(-16384);});
  this.child.once('error',error=>this.fail(error));this.child.once('exit',code=>this.fail(Error('MCP exit '+code+': '+this.stderr)));
 }
 fail(error){for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();}
 begin(method,params){const id=this.next++;const promise=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Request timeout '+method));},95000);
  this.pending.set(id,{resolve,reject,timer});});this.send({jsonrpc:'2.0',id,method,params});return{id,promise};}
 send(message){this.child.stdin.write(JSON.stringify(message)+'\n');}
 request(method,params){return this.begin(method,params).promise;}
 async initialize(){await this.request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'worldbend-video-runtime',version:'1'}});
  this.send({jsonrpc:'2.0',method:'notifications/initialized',params:{}});}
 beginVideo(input){return this.begin('tools/call',{name:'worldbend.run',arguments:{operation:'video_render',arguments:input}});}
 async run(operation,input){const response=await this.request('tools/call',{name:'worldbend.run',arguments:{operation,arguments:input}});
  const value=response.structuredContent;assert(value,'Missing structured result');return value;}
 cancel(request){this.send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:request.id,reason:'real video cancellation verification'}});
  const pending=this.pending.get(request.id);if(pending){clearTimeout(pending.timer);this.pending.delete(request.id);pending.reject(Error('Client cancelled request'));}}
 async close(){if(this.child.exitCode!==null)return;
  if(this.pending.size){for(const id of this.pending.keys())this.send({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:id,reason:'test cleanup'}});
   await waitFor(async()=>!(await readdir(privateRoot)).length,5000).catch(()=>{});}
  this.fail(Error('Test client closing'));this.child.stdin.end();
  await Promise.race([this.closed,sleep(1000)]);if(this.child.exitCode===null)this.child.kill('SIGTERM');await Promise.race([this.closed,sleep(1000)]);
  if(this.child.exitCode===null){this.child.kill('SIGKILL');await this.closed;}}
}
function renderInput(output,saved=spec,extra={}){return{sources:[{id:saved.motion.sourceId,source:'source.png'}],spec:saved,output,...extra};}
function changedFrames(count,width=960,height=640){const changed=structuredClone(spec);changed.motion.frameCount=count;
 changed.motion.output={width,height};changed.motion.keyframes.forEach((frame,index)=>{frame.frame=Math.round(index*(count-1)/(changed.motion.keyframes.length-1));});return changed;}
async function success(client,input){const start=Date.now(),value=await client.run('video_render',input);assert.equal(value.ok,true,JSON.stringify(value));
 metrics.push({output:input.output,elapsedMillis:Date.now()-start,responseBytes:client.lastResponseBytes});return value.result;}
function processes(){if(process.platform==='win32')return[];const result=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,stat=,comm='],{encoding:'utf8',maxBuffer:2**20});assert.equal(result.status,0);
 return result.stdout.trim().split('\n').map(line=>{const match=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);return match&&{pid:+match[1],parent:+match[2],group:+match[3],state:match[4],command:match[5]};}).filter(Boolean);}
async function workerFor(client){return waitFor(()=>processes().find(process=>process.parent===client.child.pid&&process.command.endsWith('worldbend-mcp')));}
async function noGroup(group){await waitFor(()=>!processes().some(process=>process.group===group&&!process.state.startsWith('Z')),5000);}
async function clean(){await waitFor(async()=>!(await readdir(privateRoot)).length,5000);
 assert(!(await readdir(workspace)).some(name=>name.startsWith('.worldbend-publish-')),'Hidden workspace staging leaked');}
async function encodingStarted(){for(const name of await readdir(privateRoot)){
 if(!name.startsWith('.worldbend-video-worker-'))continue;const directory=path.join(privateRoot,name);
 for(const child of await readdir(directory).catch(()=>[]))if(child.startsWith('.worldbend-video-stage-')&&await exists(path.join(directory,child,'video.mp4')))return true;
 }return false;}

try {
 const unconfigured=new Client(['--surface','catalog','--root',workspace]);await unconfigured.initialize();
 const planned=await unconfigured.run('video_plan',{spec});assert.equal(planned.ok,true);assert.deepEqual(planned.result.duration,{numerator:2,denominator:1});
 const unavailable=await unconfigured.run('video_render',renderInput('unavailable.mp4'));assert.equal(unavailable.error.code,'E_UNSUPPORTED_MEDIA');await unconfigured.close();
 const client=new Client(['--surface','catalog','--root',workspace,'--ffmpeg',args.get('--ffmpeg'),'--ffprobe',args.get('--ffprobe')]);await client.initialize();
 const tools=await client.request('tools/list',{});assert.equal(tools.tools.length,3);
 const descriptor=await client.request('tools/call',{name:'worldbend.describe',arguments:{operation:'video_render'}});
 assert.equal(descriptor.structuredContent.ok,true);
 const first=await success(client,renderInput('motion.mp4',{...spec}, {overwrite:true}));
 assert.deepEqual(first.plan,planned.result);assert.equal(first.sources[0].sourceSha256,digest(original));
 assert.equal(first.sha256,digest(await readFile(path.join(workspace,'motion.mp4'))));assert.equal(first.decodedFrameCount,60);
 const maximumSpec=changedFrames(240,64,64);
 const maximum=await success(client,renderInput('maximum-frames.mp4',maximumSpec,{overwrite:true}));
 assert.equal(maximum.decodedFrameCount,240);assert.equal(maximum.frames.length,240);
 assert.deepEqual(maximum.plan.duration,{numerator:8,denominator:1});
 assert(metrics.at(-1).responseBytes<256*1024,'Legal maximum frame receipt exceeded MCP response budget');
 const singleSpec=changedFrames(1,64,64);singleSpec.motion.keyframes=[singleSpec.motion.keyframes[0]];delete singleSpec.motion.keyframes[0].easingToNext;
 const single=await success(client,renderInput('single-frame.mp4',singleSpec,{overwrite:true}));
 assert.equal(single.decodedFrameCount,1);assert.deepEqual(single.plan.duration,{numerator:1,denominator:30});
 const collision=await client.run('video_render',renderInput('motion.mp4'));assert.equal(collision.error.code,'E_DESTINATION_EXISTS');
 const dry=await success(client,renderInput('dry-run.mp4',spec,{dryRun:true}));assert.equal(dry.status,'ready');assert.equal(await exists(path.join(workspace,'dry-run.mp4')),false);
 await writeFile(path.join(workspace,'source.png'),replacement);
 const stale=await client.run('video_render',{...renderInput('stale.mp4'),sources:[{id:spec.motion.sourceId,source:'source.png',sourceSha256:digest(original)}]});assert.equal(stale.error.code,'E_SCHEMA');
 const revised=structuredClone(spec);revised.motion.timebase={numerator:30000,denominator:1001};
 const second=await success(client,renderInput('retimed.mp4',revised,{overwrite:true}));
 assert.equal(second.sources[0].sourceSha256,digest(replacement));assert.deepEqual(second.plan.duration,{numerator:1001,denominator:500});
 assert.deepEqual(second.plan.motion.timeline.frames.map(frame=>frame.transform),first.plan.motion.timeline.frames.map(frame=>frame.transform));
 for(const output of ['../escaped.mp4','/tmp/escaped.mp4'])assert.equal((await client.run('video_render',renderInput(output))).error.code,'E_PATH_OUTSIDE_ROOT');
 if(process.platform!=='win32'){const escaped=path.join(evidence,'outside');await mkdir(escaped,{recursive:true});
  const link=path.join(workspace,'escape');if(!await exists(link))await symlink(escaped,link);
  assert.equal((await client.run('video_render',renderInput('escape/movie.mp4'))).error.code,'E_PATH_SYMLINK');}
 const deadline=await client.run('video_render',renderInput('timeout.mp4',spec,{options:{timeoutMillis:1}}));assert.equal(deadline.error.code,'E_TIMEOUT');await clean();
 const bounded=await client.run('video_render',renderInput('small-limit.mp4',spec,{options:{maxEncodedBytes:1}}));assert.equal(bounded.ok,false);await clean();
 const interruptions=[];
 if(process.platform!=='win32')for(const phase of ['raster','encoding','worker-death']){
  const saved=phase==='raster'?changedFrames(120,1920,1080):changedFrames(240,960,640);
  const output='interrupted-'+phase+'.mp4';await copyFile(path.join(workspace,'motion.mp4'),path.join(workspace,output));
  const request=client.beginVideo(renderInput(output,saved,{overwrite:true,options:{quality:'high'}}));request.promise.catch(()=>{});
  const worker=await workerFor(client);
  if(phase!=='raster')await waitFor(encodingStarted,90000);
  const start=Date.now();if(phase==='worker-death'){
   // Recheck the owned live worker immediately before injecting interruption.
   assert(processes().some(process=>process.pid===worker.pid&&process.parent===client.child.pid&&process.command.endsWith('worldbend-mcp')));
   process.kill(worker.pid,'SIGKILL');const response=await request.promise;
   assert.equal(response.structuredContent.error.code,'E_INTERNAL');
  }else client.cancel(request);
  await noGroup(worker.group);await clean();
  assert.equal(digest(await readFile(path.join(workspace,output))),first.sha256,'Interrupted work replaced the existing movie');
  interruptions.push({phase,cleanupMillis:Date.now()-start,workerGroup:worker.group});
 }
 const recovered=await success(client,renderInput('recovered.mp4',spec,{overwrite:true}));assert.equal(recovered.sources[0].sourceSha256,digest(replacement));await clean();
 const wrapperChecks=[];
 if(process.platform!=='win32'){
  const wrapper=path.join(evidence,'encoder-output-limit-wrapper.sh');
  const shellQuote=value=>"'"+value.replaceAll("'", "'\\''")+"'";
  await writeFile(wrapper,'#!/bin/sh\nif [ "$1" = "-version" ]; then exec '+shellQuote(args.get('--ffmpeg'))+' "$@"; fi\n/bin/sleep 30 >/dev/null &\nexec /usr/bin/yes overflow\n',{mode:0o700});
  const wrapped=new Client(['--surface','catalog','--root',workspace,'--ffmpeg',wrapper,'--ffprobe',args.get('--ffprobe')]);await wrapped.initialize();
  await copyFile(path.join(workspace,'motion.mp4'),path.join(workspace,'wrapper-limit.mp4'));
  const request=wrapped.beginVideo(renderInput('wrapper-limit.mp4',singleSpec,{overwrite:true,options:{timeoutMillis:3000}}));request.promise.catch(()=>{});
  const worker=await workerFor(wrapped),start=Date.now(),response=await request.promise;
  assert.equal(response.structuredContent.error.code,'E_OUTPUT_LIMIT');
  await noGroup(worker.group);await clean();
  assert.equal(digest(await readFile(path.join(workspace,'wrapper-limit.mp4'))),first.sha256);
  assert(Date.now()-start<1500,'Supervised wrapper diagnostics held the failure open');
  wrapperChecks.push({condition:'output limit with descendant retaining diagnostic pipe',code:response.structuredContent.error.code,elapsedMillis:Date.now()-start});await wrapped.close();
 }
 const browser=await checkEncodedVideo(path.join(workspace,'motion.mp4'),evidence);
 const report={status:'PASS',harness,mcp:{path:mcp,sha256:digest(await readFile(mcp))},metrics,first,second,recovered,maximum:{sha256:maximum.sha256,bytes:maximum.bytes,decodedFrameCount:maximum.decodedFrameCount,duration:maximum.plan.duration},single,interruptions,wrapperChecks,browser,
  scope:'current source MCP/native host encoder/actual Chrome decoding; no installed-host, Figma scene or Windows runtime claim'};
 await writeFile(path.join(evidence,'result.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({status:'PASS',metrics,interruptions,browser,evidence},null,2));
} finally {for(const client of clients)await client.close();}
