import assert from "node:assert/strict";
import {readFile,stat} from "node:fs/promises";
import {createServer} from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {closeChrome,createPage,findChrome,launchChrome,readPageResult} from "./remap-native-webgl-parity.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const fixture=process.argv.find(a=>a.startsWith("--fixture="));assert(process.argv.slice(2).every(a=>a===fixture));
const spec={schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:"stretch"}};
function polygon(count){return {path:{vertices:Array.from({length:count},(_,i)=>({x:.5+.4*Math.cos(i/count*Math.PI*2),y:.5+.4*Math.sin(i/count*Math.PI*2)})),segments:Array.from({length:count},(_,i)=>({start:i,end:(i+1)%count})),regions:[{windingRule:"NONZERO",loops:[Array.from({length:count},(_,i)=>i)]}]},sourceTransform:[1,0,0,0,1,0]};}
let input={schema:"worldbend.vector-artwork",version:"0.1",operation:{kind:"transform",spec},reference:{width:700,height:420},placement:{width:700,height:420},sourceBounds:{x:0,y:0,width:1,height:1},parts:[polygon(669),polygon(4)],tolerancePx:.25};
if(fixture){const file=fixture.slice("--fixture=".length);assert((await stat(file)).size<=8*1024*1024);input=JSON.parse(await readFile(file,"utf8"));assert.equal(input.schema,"worldbend.vector-artwork");}
const transform=input.operation.spec;assert.equal(input.operation.kind,"transform");
const jobs=[
  input,
  ...["arc","arch","flag","wave","fish","rise","fisheye","inflate","squeeze","twist"].map(preset=>
    ({...input,operation:{kind:"transform",spec:{...transform,content:{...transform.content,warp:{preset,amount:.35}}}}})),
  {...input,operation:{kind:"deformationWork",spec:{
    schema:"worldbend.deformation-work",version:"0.1",transform,meshSubdivisions:12,
    meshEdits:[{column:6,row:6,warped:{x:.54,y:.47}}],
    liquify:{strokes:[{id:"brush",mode:"push",samples:[{position:{x:.7,y:.7},radius:.2,strength:.5,delta:{x:.01,y:0}}]}]},
  }}},
];
const rows=[],expected=[];
for(const directory of ["pkg","pkg-figma"]){
  const wasm=await import(new URL(`../packages/wasm/${directory}/worldbend_wasm.js`,import.meta.url));wasm.initSync({module:new WebAssembly.Module(await readFile(path.join(root,"packages/wasm",directory,"worldbend_wasm_bg.wasm")))});
  for(const method of ["vector_artwork_json","vector_operation_json"]){let issue;try{wasm[method](" ".repeat(8*1024*1024+1));}catch(e){issue=JSON.parse(String(e));}assert.equal(issue?.code,"E_OUTPUT_LIMIT");
    try{wasm[method](JSON.stringify({["x".repeat(4096)]:1}));}catch(e){issue=JSON.parse(String(e));}assert.equal(issue?.code,"E_SCHEMA");assert(issue.message.length<400);}
  for(const [index,job] of jobs.entries()){
    const start=performance.now(),wire=wasm.vector_artwork_json(JSON.stringify(job)),out=JSON.parse(wire);
    assert.equal(out.outputs.length,job.parts.length);assert.equal(out.usage.outputBytes,Buffer.byteLength(wire));
    assert.equal(out.usage.inputVertices,job.parts.reduce((n,p)=>n+p.path.vertices.length,0));
    assert(out.usage.workUnits<=8000000);assert(out.outputs.every(p=>(p.report.maxError??0)<=job.tolerancePx));
    if(directory==="pkg")expected.push(out);else assert.deepEqual(out,expected[index]);
    rows.push({profile:directory,case:index,ms:performance.now()-start,parts:out.usage.parts,inputVertices:out.usage.inputVertices,outputVertices:out.usage.outputVertices,workUnits:out.usage.workUnits,outputBytes:out.usage.outputBytes});
  }
  const excessive={...input,parts:Array.from({length:9},()=>polygon(1024))};let refused;try{wasm.vector_artwork_json(JSON.stringify(excessive));}catch(e){refused=JSON.parse(String(e));}
  assert.equal(refused?.code,"E_OUTPUT_LIMIT");assert.equal(refused.details.resource,"input vertices");
  assert.deepEqual(JSON.parse(wasm.vector_artwork_json(JSON.stringify(input))),expected[0]);
  // Individually valid, proved curved stroke outlines must share the whole
  // job's intersection/subdivision meter, rather than resetting it per part.
  const k = .3 * .5522847498307936;
  const curvedStroke = {path: {
    vertices: [{x:.8,y:.5},{x:.5,y:.8},{x:.2,y:.5},{x:.5,y:.2}],
    segments: [
      {start:0,end:1,tangentStart:{x:0,y:k},tangentEnd:{x:k,y:0}},
      {start:1,end:2,tangentStart:{x:-k,y:0},tangentEnd:{x:0,y:k}},
      {start:2,end:3,tangentStart:{x:0,y:-k},tangentEnd:{x:-k,y:0}},
      {start:3,end:0,tangentStart:{x:k,y:0},tangentEnd:{x:0,y:-k}},
    ], regions: [{windingRule:"EVENODD",loops:[[0,1,2,3]]}],
  },sourceTransform:[1,0,0,0,1,0],stroke:{weight:.01,cap:"NONE",join:"MITER",miterLimit:4}};
  const strokeJob = {...input,operation:{kind:"transform",spec},reference:{width:700,height:700},
    placement:{width:700,height:700},sourceBounds:{x:0,y:0,width:1,height:1},parts:[curvedStroke],tolerancePx:.25};
  const one = JSON.parse(wasm.vector_artwork_json(JSON.stringify(strokeJob)));
  assert(one.usage.strokePairs > 500000);
  assert(one.outputs[0].report.maxError <= .25);
  const admitted = JSON.parse(wasm.vector_artwork_json(JSON.stringify({...strokeJob,parts:Array(15).fill(curvedStroke)})));
  assert.equal(admitted.usage.parts,15);assert(admitted.usage.workUnits < 8000000);
  const start = performance.now();let computeRefusal;
  try {wasm.vector_artwork_json(JSON.stringify({...strokeJob,parts:Array(16).fill(curvedStroke)}));}
  catch (error) {computeRefusal=JSON.parse(String(error));}
  assert.equal(computeRefusal?.code,"E_OUTPUT_LIMIT");
  assert.deepEqual(computeRefusal.details,{maximum:8000000,observed:8000001,resource:"work units"});
  assert.deepEqual(JSON.parse(wasm.vector_artwork_json(JSON.stringify(strokeJob))),one);
  rows.push({profile:directory,case:"whole-job-stroke-meter",admittedParts:15,
    admittedWorkUnits:admitted.usage.workUnits,admittedOutputBytes:admitted.usage.outputBytes,
    refusedParts:16,refusalMs:performance.now()-start,recovered:true});

  // Increasing a complete multiline paint layer must not enable quadratic
  // standalone stroke work that escapes the cumulative artwork entry point.
  // This straight open chain plus a separate painted triangle is valid, with
  // distinct vertices and no outline intersection; only the work budget stops it.
  const chainCount=3072;
  const vertices=Array.from({length:chainCount},(_,i)=>({x:i*10,y:1}));
  vertices.push({x:-100,y:-100},{x:-90,y:-100},{x:-95,y:-90});
  const segments=Array.from({length:chainCount-1},(_,i)=>({start:i,end:i+1}));
  const triangle=segments.length;
  segments.push({start:chainCount,end:chainCount+1},{start:chainCount+1,end:chainCount+2},{start:chainCount+2,end:chainCount});
  const standalone={schema:"worldbend.vector-projection",version:"0.1",
    path:{vertices,segments,regions:[{windingRule:"NONZERO",loops:[[triangle,triangle+1,triangle+2]]}]},
    sourceTransform:[1,0,0,0,1,0],sourceBounds:{x:-1000,y:-1000,width:32000,height:2000},
    homography:[100,0,0,0,100,0,0,0,1],reference:{width:100,height:100},placement:{width:100,height:100},
    tolerancePx:.25,stroke:{weight:.1,cap:"NONE",join:"MITER",miterLimit:4}};
  const plain={...standalone,path:polygon(4).path,sourceBounds:{x:0,y:0,width:1,height:1},stroke:undefined};
  const plainResult=wasm.vector_projection_json(JSON.stringify(plain));
  const guardStart=performance.now();let standaloneRefusal;
  try{wasm.vector_projection_json(JSON.stringify(standalone));}catch(error){standaloneRefusal=JSON.parse(String(error));}
  assert.equal(standaloneRefusal?.code,"E_OUTPUT_LIMIT");
  assert.deepEqual(standaloneRefusal.details,{maximum:17000000,observed:17000001,resource:"work units"});
  assert.equal(wasm.vector_projection_json(JSON.stringify(plain)),plainResult);
  rows.push({profile:directory,case:"standalone-stroke-meter",inputBytes:Buffer.byteLength(JSON.stringify(standalone)),
    refusalMs:performance.now()-guardStart,recovered:true});
}
let server,browser;
try{
  const html=`<!doctype html><title>Complete canonical vector artwork bridge</title><script type="module">import {planVectorArtwork,planVectorOperation} from '/web/index.js';try{const jobs=${JSON.stringify(jobs)},outputs=[];for(const job of jobs){const out=await planVectorArtwork(job);const plan=await planVectorOperation({schema:'worldbend.vector-operation',version:'0.1',operation:job.operation,reference:job.reference});if(JSON.stringify(plan)!==JSON.stringify(out.plan))throw Error('operation drift');outputs.push(out);}let refused;try{await planVectorArtwork({...jobs[0],parts:[]})}catch(e){refused=e.code;}globalThis.__WORLDBEND_PARITY__={ok:true,outputs,refused};}catch(e){globalThis.__WORLDBEND_PARITY__={error:String(e.stack??e)}};</script>`;
  server=createServer(async(req,res)=>{try{const url=new URL(req.url,"http://localhost");if(url.pathname==="/"){res.setHeader("Content-Type","text/html");res.end(html);return;}const prefix=path.join(root,"packages/web/dist")+path.sep,file=path.resolve(prefix,url.pathname.slice(5));if(!url.pathname.startsWith("/web/")||!file.startsWith(prefix)){res.writeHead(404);res.end();return;}res.setHeader("Content-Type",file.endsWith(".wasm")?"application/wasm":"text/javascript");res.end(await readFile(file));}catch{res.writeHead(500);res.end();}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await launchChrome(await findChrome());const tab=await createPage(browser.debugUrl,url);const result=await readPageResult(tab.webSocketDebuggerUrl,{url,width:820,height:660,timeoutMs:60000});
  assert.equal(result.error,undefined,result.error);assert.equal(result.ok,true);assert.equal(result.refused,"E_OUTPUT_LIMIT");assert.deepEqual(result.outputs,expected);
}finally{if(browser)await closeChrome(browser);if(server)await new Promise(resolve=>server.close(resolve));}
console.log(JSON.stringify({ok:true,fixture:Boolean(fixture),bridge:"actual-built-Web/WASM",rows},null,2));
