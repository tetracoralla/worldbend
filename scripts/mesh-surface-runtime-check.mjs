import {createQaHttpFailureBoundary} from "./qa-http-failure-boundary.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

// Real native CLI output compared with the built WASM/WebGL carrier. Sources
// and plans are served from this checkout; no application runtime is mocked.
const httpFailures=createQaHttpFailureBoundary("mesh-surface-runtime-check.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(path.join(tmpdir(), "worldbend-mesh-surface-"));
const cli = path.join(root, "target", "debug", "worldbend");
const point = (x,y) => ({x,y});
const contour = points => ({start:point(...points[0]),segments:points.slice(1).map(p=>({kind:"line",to:point(...p)}))});
const quad = {tl:point(0,0),tr:point(1,0),br:point(1,1),bl:point(0,1)};
const transform = {schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad},content:{fit:"stretch"}};
const outer = contour([[0,0],[1,0],[1,1/3],[.6875,1/3],[.6875,1],[0,1]]);
const fit = {schema:"worldbend.deformation-work",version:"0.1",transform,targetSize:{width:96,height:96},meshSubdivisions:4,
  meshEdits:[{column:2,row:2,warped:point(.52,.49)}],shapeFit:{contour:outer,clip:{contours:[outer,
    contour([[.1,.55],[.4,.55],[.4,.8],[.1,.8]]),contour([[.2,.6],[.3,.6],[.3,.7],[.2,.7]])],
  fillRule:"evenOdd",regions:[{contourIndices:[0,1],fillRule:"evenOdd"},{contourIndices:[2],fillRule:"nonZero"}]}}};
const mockup = surface => ({schema:"worldbend.mockup",version:"0.1",canvas:{width:96,height:96},background:{kind:"transparent"},
  planes:[{id:"plane",sourceId:"art",transform,opacity:1,...(surface ? {surface} : {})}],seams:[]});
const freeOutline = {schema:"worldbend.deformation-work",version:"0.1",transform,targetSize:{width:96,height:96},
  boundary:"free",meshSubdivisions:12,surface:{envelope:{columns:1,rows:1,
    points:Array.from({length:16},(_,i)=>point((i%4)/3,Math.floor(i/4)===0 && (i%4===1||i%4===2)?.2:Math.floor(i/4)/3))},anchors:[],strokes:[]},
  meshEdits:[{column:6,row:0,warped:point(.5,.16)}]};
const cases = [
  {id:"fit",kind:"deformation",spec:fit},
  {id:"cylinder",kind:"mockup",spec:mockup({kind:"cylinder",curvature:1,tilt:.3,light:{strength:.65,direction:-.45}})},
  {id:"fabric",kind:"mockup",spec:mockup({kind:"fabric",folds:3,depth:1,phase:.27,light:{strength:.65,direction:.4}})},
  {id:"plain",kind:"mockup",spec:mockup()},
  {id:"free-outline",kind:"deformation",spec:freeOutline},
  {id:"free-fitted-outline",kind:"deformation",spec:{...freeOutline,shapeFit:{contour:outer}}},
];
let server, browser;
try {
  // Repository fixture has visible details, so the comparison also observes
  // texture relocation rather than only agreement of silhouettes.
  await writeFile(path.join(scratch,"source.png"),await readFile(path.join(root,"examples","worldbend-demo-source.png")));
  for (const coordinate of [1e308,1e155]) {
    const spec={...mockup(),clip:{contours:[contour([[coordinate,coordinate],[coordinate,-coordinate],[-coordinate,-coordinate]])]}};
    const file=path.join(scratch,"overflow.json");await writeFile(file,JSON.stringify(spec));
    const rejected=spawnSync(cli,["mockup-inspect","--spec",file,"--json"],{cwd:root,encoding:"utf8"});
    assert.notEqual(rejected.status,0);assert.equal(JSON.parse(rejected.stdout).error.code,"E_NON_FINITE_COORDINATE");
  }
  for (const test of cases) {
    const specPath=path.join(scratch,test.id+".json");await writeFile(specPath,JSON.stringify(test.spec));
    const args=[test.kind === "mockup" ? "mockup-render" : "deformation-render","--source",
      (test.kind === "mockup" ? "art=" : "")+path.join(scratch,"source.png"),"--spec",specPath,"--output",path.join(scratch,test.id+".png"),"--quality","standard","--json"];
    const output=spawnSync(cli,args,{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024});
    assert.equal(output.status,0,output.stderr+output.stdout);
    test.native=JSON.parse(output.stdout).result.plan;
  }
  const html=page(cases);
  server=createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,"http://localhost").pathname;
      if(pathname==="/") {res.setHeader("Content-Type","text/html");res.end(html);return;}
      const files=new Map([["/source.png",path.join(scratch,"source.png")],...cases.map(t=>["/"+t.id+".png",path.join(scratch,t.id+".png")])]);
      const asset=pathname.startsWith("/web/") ? path.resolve(root,"packages/web/dist",pathname.slice(5)) : undefined;
      const wasm=pathname.startsWith("/wasm/") ? path.resolve(root,"packages/wasm/pkg-figma",pathname.slice(6)) : undefined;
      const file=files.get(pathname) ?? (wasm?.startsWith(path.join(root,"packages/wasm/pkg-figma")+path.sep) ? wasm : undefined) ?? (asset?.startsWith(path.join(root,"packages/web/dist")+path.sep) ? asset : undefined);
      if(!file){res.writeHead(404);res.end();return;}
      res.setHeader("Content-Type",file.endsWith(".js")?"text/javascript":file.endsWith(".wasm")?"application/wasm":"image/png");
      res.end(await readFile(file));
    } catch(error){httpFailures.respond(req,res,error,500);}
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await launchChrome(await findChrome());const tab=await createPage(browser.debugUrl,url);
  const result=await readPageResult(tab.webSocketDebuggerUrl,{url,width:820,height:660,focus:true,trustedInput:true,timeoutMs:60000,
    ...(process.env.WORLDBEND_SCREENSHOTS ? {screenshotDirectory:process.env.WORLDBEND_SCREENSHOTS} : {})});
  assert.equal(result.error,undefined,JSON.stringify(result));
  assert.equal(result.ok,true);process.stdout.write(JSON.stringify({ok:true,...result},null,2)+"\n");
} catch(error){throw httpFailures.decorate(error)} finally {
  if(browser) await closeChrome(browser);
  if(server) await new Promise(resolve=>server.close(resolve));
  await rm(scratch,{recursive:true,force:true});
}

function page(cases) {
return `<!doctype html><title>Worldbend mesh and surface verification</title><style>
body{margin:24px;font:14px system-ui;background:#eee;color:#222}section{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0}canvas{width:240px;height:240px;background:repeating-conic-gradient(#fff 0% 25%,#ddd 0% 50%) 50%/16px 16px}button{margin:12px 8px 12px 0}#status{margin:12px 0}
</style><h1>Mesh and surface verification</h1><div id="status">Loading</div><div id="controls"></div><section id="images"></section>
<script>
window.addEventListener('error',event=>{globalThis.__WORLDBEND_PARITY__={error:String(event.error?.stack??event.message)}});
window.addEventListener('unhandledrejection',event=>{globalThis.__WORLDBEND_PARITY__={error:String(event.reason?.stack??event.reason)}});
</script><script type="module">
import {TransformWebGLRenderer,planDeformationWork,buildMockupPlaneMesh,createMeshCoordinateMap} from '/web/index.js';
import initializeFigmaWasm,{mockup_plan_json} from '/wasm/worldbend_wasm.js';
await initializeFigmaWasm();
const planMockup=spec=>JSON.parse(mockup_plan_json(JSON.stringify(spec)));
const cases=${JSON.stringify(cases)},measurements=[],fail=(message)=>{throw Error(message)},check=(value,message)=>{if(!value)fail(message)};
const canvas=document.createElement('canvas');document.querySelector('#images').innerHTML='<figure><figcaption>WebGL</figcaption></figure><figure><figcaption>Native</figcaption><canvas id="native"></canvas></figure>';
document.querySelector('figure').append(canvas);
const retained=[],maskCanvases=new Set(),create=document.createElement.bind(document);document.createElement=(...args)=>{const element=create(...args);if(args[0]==='canvas')retained.push(element);return element};
const renderer=new TransformWebGLRenderer(canvas,{preserveDrawingBuffer:true}),source=await image('/source.png');
const rgba=element=>{const c=create('canvas');c.width=96;c.height=96;const context=c.getContext('2d');context.drawImage(element,0,0);return context.getImageData(0,0,96,96).data};
const alpha=(bytes,x,y)=>bytes[(y*96+x)*4+3];
function equivalent(a,b){
 if(typeof a==='number'&&typeof b==='number')return Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
 if(a===b)return true;if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>key in b&&equivalent(a[key],b[key]));
}
const next=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function image(url){const image=new Image();image.src=url;await image.decode();return image;}
async function draw(test){
 const plan=test.kind==='deformation' ? await planDeformationWork(test.spec) : await planMockup(test.spec);
 check(equivalent(plan,test.native),test.id+' CLI/WASM plan drift');
 const solve=test.kind==='deformation' ? plan.meshWarp.solve : plan.planes[0].solve;
 const mesh=test.kind==='deformation' ? plan.meshWarp.spec.mesh : await buildMockupPlaneMesh(plan.planes[0]);
 renderer.render(source,solve,mesh,'preview',plan.clip);
 const native=await image('/'+test.id+'.png'),nc=document.querySelector('#native');nc.width=96;nc.height=96;nc.getContext('2d').drawImage(native,0,0);
 const actual=rgba(canvas),expected=rgba(native);let total=0,alphaTotal=0,interior=0,maxInterior=0;
 for(let i=0;i<actual.length;i+=4){const a=actual[i+3]/255,e=expected[i+3]/255;alphaTotal+=Math.abs(actual[i+3]-expected[i+3]);
   for(let c=0;c<3;c++)total+=Math.abs(actual[i+c]*a-expected[i+c]*e);total+=Math.abs(actual[i+3]-expected[i+3]);
   if(actual[i+3]===255&&expected[i+3]===255){interior++;for(let c=0;c<3;c++)maxInterior=Math.max(maxInterior,Math.abs(actual[i+c]-expected[i+c]));}}
 const mean=total/actual.length,meanAlpha=alphaTotal/(96*96);measurements.push({id:test.id,meanPremultipliedDelta:mean,meanAlphaDelta:meanAlpha,maxInteriorDelta:maxInterior,interiorPixels:interior});
 check(mean<3.5,test.id+' visible native/WebGL color drift: '+mean);check(meanAlpha<2.5,test.id+' silhouette drift: '+meanAlpha);
 if(test.id==='fit'){
   for(const offscreen of retained.filter(c=>c.width===96&&c.height===96))maskCanvases.add(offscreen);
   check(alpha(actual,14,60)===0,'EVENODD hole filled');check(alpha(actual,24,62)>245,'independent region lost');check(alpha(actual,85,62)===0,'concave notch filled');
   const map=await createMeshCoordinateMap(plan.shapeFitView.fit.mesh),original={x:.5,y:.5},warped=map.map(original),back=map.map(warped,true);
   check(Math.hypot(back.x-original.x,back.y-original.y)<1e-8,'real WASM coordinate roundtrip failed');check(!map.map({x:.95,y:.8},true),'notch gained an inverse');map.dispose();
   let rejected=false;try{map.map(original)}catch{rejected=true}check(rejected,'disposed coordinate map accepted query');
 }
 if(test.id==='free-outline')check(alpha(actual,48,2)===0 && alpha(expected,48,2)===0,'curved top silhouette was flattened');
 if(test.id==='plain')check([...maskCanvases].every(c=>c.width===1&&c.height===1),'plain retained a full-size offscreen mask');
 document.querySelector('#status').textContent=test.id;return {solve,mesh,clip:plan.clip};
}
async function trusted(button,name){const box=button.getBoundingClientRect();
 for(const type of ['mouseMoved','mousePressed','mouseReleased']){
  globalThis.__WORLDBEND_INPUT_DONE__=false;globalThis.__WORLDBEND_INPUT__={method:'Input.dispatchMouseEvent',params:{type,x:box.x+box.width/2,y:box.y+box.height/2,...(type==='mouseMoved'?{}:{button:'left',clickCount:1})},...(name&&type==='mouseReleased'?{screenshot:name}:{})};
  while(!globalThis.__WORLDBEND_INPUT_DONE__)await next();
 }
}
try{
 for(const coordinate of [1e308,1e155]){
   const bad={...cases[3].spec,clip:{contours:[{start:{x:coordinate,y:coordinate},segments:[{kind:'line',to:{x:coordinate,y:-coordinate}},{kind:'line',to:{x:-coordinate,y:-coordinate}}]}]}};
   let code;try{await planMockup(bad)}catch(error){code=typeof error==='string'?JSON.parse(error).code:error.code}
   check(code==='E_NON_FINITE_COORDINATE','WASM returned nonrepresentable clip geometry');
 }
 let invalidZero=false;try{await buildMockupPlaneMesh({...cases[3].spec.planes[0],surface:{kind:'cylinder',curvature:0,light:{strength:2,direction:0}}})}catch(error){invalidZero=error.code==='E_SCHEMA'}
 check(invalidZero,'zero surface bypassed canonical control validation');
 for(const test of cases)await draw(test);
 let last,pending;for(const test of cases){const b=create('button');b.textContent=test.id;b.addEventListener('click',()=>{pending=draw(test).then(value=>last=value)});document.querySelector('#controls').append(b);}
 const buttons=document.querySelectorAll('button');await trusted(buttons[0],'mesh-fit');await pending;
 const masked=retained.filter(c=>c.width===96);check(masked.length>0,'mask was not allocated');
 const extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');check(extension,'context restore extension missing');
 const event=(name)=>Promise.race([new Promise(resolve=>canvas.addEventListener(name,resolve,{once:true})),new Promise((_,reject)=>setTimeout(()=>reject(Error(name+' timed out; lost='+canvas.getContext('webgl2').isContextLost())),5000))]);
 const lost=event('webglcontextlost');extension.loseContext();await lost;
 let rejected=false;try{renderer.render(source,last.solve,last.mesh,'preview',last.clip)}catch{rejected=true}check(rejected,'lost context accepted render');
 await new Promise(resolve=>setTimeout(resolve,100));
 const restored=event('webglcontextrestored');extension.restoreContext();await restored;
 await draw(cases[0]);await trusted(buttons[1],'mesh-cylinder');await pending;await trusted(buttons[2],'mesh-fabric');await pending;
 await trusted(buttons[3]);await pending;check(masked.every(c=>c.width===1&&c.height===1),'removed mask retained pixel backing');
 await draw(cases[0]);renderer.dispose();check([...maskCanvases].every(c=>c.width===1&&c.height===1),'disposed renderer retained pixel backing');
 globalThis.__WORLDBEND_PARITY__={ok:true,measurements,contextRestored:true,maskRemoval:true,disposed:true};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack,measurements};}
</script>`;
}
