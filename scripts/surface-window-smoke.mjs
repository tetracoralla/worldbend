// Source or installed-runtime check. Explicit roots select the actual artifacts; no installation.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const option=(flag,fallback)=>{const index=process.argv.indexOf(flag);if(index<0)return fallback;if(!process.argv[index+1]||process.argv[index+1].startsWith('--'))throw Error(flag+' requires a path');return path.resolve(process.argv[index+1]);};
const binRoot=option('--bin-root',path.join(root,'target/debug'));
const sdkRoot=option('--sdk-root',path.join(root,'packages/web'));
const {planSurfaceWindow}=await import(pathToFileURL(path.join(sdkRoot,'dist/surface-window.js')).href);
const extension=process.platform==='win32'?'.exe':'';
const child=spawn(path.join(binRoot,`worldbend-mcp${extension}`),['--surface','catalog'],{cwd:root,stdio:['pipe','pipe','pipe']});
let stderr='';child.stderr.on('data',data=>stderr=(stderr+data).slice(-8000));
const pending=new Map();let id=0;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{const response=JSON.parse(line),entry=pending.get(response.id);if(entry){clearTimeout(entry.timer);pending.delete(response.id);if(response.error)entry.reject(Error(JSON.stringify(response.error)));else entry.resolve(response.result);}});
child.on('exit',code=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error(`MCP exited ${code}: ${stderr}`));}pending.clear();});
child.on('error',error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();});
const send=(method,params)=>{const next=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(next);reject(Error(`Timeout: ${method}`));},15000);pending.set(next,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});};
const call=async(name,args)=>(await send('tools/call',{name,arguments:args})).structuredContent;
const fixture=await mkdtemp(path.join(tmpdir(),'worldbend-window-smoke-'));
try{
  await send('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'window-source-check',version:'1'}});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
  const catalog=await send('tools/list',{});assert.deepEqual(catalog.tools.map(t=>t.name).sort(),['worldbend.describe','worldbend.run','worldbend.search']);
  const catalogBytes=Buffer.byteLength(JSON.stringify(catalog));assert(catalogBytes<=16384);
  for(const query of ['folding screen','磨砂 窗口']){const search=await call('worldbend.search',{query});assert(search.result.operations.some(o=>o.operation==='window_plan'));}
  const description=await call('worldbend.describe',{operation:'window_plan'});assert.equal(description.result.inputSchema.additionalProperties,false);
  assert.equal(description.result.inputSchema.properties.schema.const,'worldbend.surface-window');
  assert.equal(description.result.inputSchema.properties.windowSize.properties.width.maximum,8192);
  const base={schema:'worldbend.surface-window',version:'0.1',windowSize:{width:300,height:400},contentSize:{width:600,height:400},contentOrigin:{x:-300,y:0},pose:{perspective:1500,rotateY:-45,pivot:{x:0,y:.5},perspectiveOrigin:{x:0,y:.5}},frost:{baseRadius:0,spread:.13,maxRadius:30}};
  const run=arguments_=>call('worldbend.run',{operation:'window_plan',arguments:arguments_});
  const numericallyEqual=(a,b)=>{if(typeof a==='number'&&typeof b==='number'){assert(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(a),Math.abs(b)),`${a} != ${b}`);return;}if(a&&b&&typeof a==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());for(const key of Object.keys(a))numericallyEqual(a[key],b[key]);}else assert.deepEqual(a,b);};
  for(const rotateY of [-60,0,89.9999,90,91,180]){
    const spec={...base,pose:{...base.pose,rotateY}},response=await run(spec);assert.equal(response.ok,true);
    const file=path.join(fixture,'spec.json');await writeFile(file,JSON.stringify(spec));const native=spawnSync(path.join(binRoot,`worldbend${extension}`),['window-plan','--input',file,'--json'],{encoding:'utf8'});assert.equal(native.status,0,native.stderr);assert.deepEqual(JSON.parse(native.stdout).result,response.result);
    numericallyEqual(await planSurfaceWindow(spec),response.result);
    if(rotateY>=90)assert.equal(response.result.mapping,undefined);
  }
  for(const [spec,code]of[[{...base,extra:1},'E_SCHEMA'],[{...base,pose:{...base.pose,extra:1}},'E_SCHEMA'],[{...base,frost:{...base.frost,spread:2}},'E_SCHEMA'],[{...base,windowSize:{width:8193,height:400}},'E_OUTPUT_LIMIT'],[{...base,pose:{perspective:1500,depth:1500}},'E_HOMOGRAPHY_HORIZON_CROSSING']]){const response=await run(spec);assert.equal(response.ok,false);assert.equal(response.error.code,code);}
  assert.equal((await run(base)).ok,true);
  const legacy=await call('worldbend.run',{operation:'pose',arguments:{elementSize:base.windowSize,pose:{perspective:1500,rotateY:180}}});assert.equal(legacy.error.code,'E_QUAD_ORIENTATION');
  console.log(JSON.stringify({outcome:'PASS',catalogTools:catalog.tools.length,catalogBytes,checks:['search/describe/run','literal schema and limits','CLI/MCP exact parity','WASM numeric parity','six face states','unknown/nested fields','horizon and limits','recovery','legacy backface error']},null,2));
}finally{child.kill();lines.close();await rm(fixture,{recursive:true,force:true});}
