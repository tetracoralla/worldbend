import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const captureArgument = process.argv.slice(2).find(value => value.startsWith("--capture="));
assert(process.argv.slice(2).every(value => value === captureArgument), "Unexpected argument");
let capture = null;
if (captureArgument) {
  const input = await readFile(captureArgument.slice("--capture=".length), "utf8");
  assert(Buffer.byteLength(input) <= 128 * 1024, "Capture fixture exceeds its budget");
  capture = JSON.parse(input);
  assert(Array.isArray(capture.bytes) && capture.bytes.length <= 65536, "Invalid bounded capture bytes");
}
const html = `<!doctype html><meta charset="utf-8"><script type="module">
import { TransformWebGLRenderer, buildWarpMesh, planSourceCapture, solveTransformPreview, validateSourceSamplingFrame } from '/web/index.js';
const assert = (condition, message) => { if (!condition) throw Error(message); };
try {
  const source = document.createElement('canvas'); source.width = 128; source.height = 96;
  const context = source.getContext('2d'), pixels = context.createImageData(128, 96);
  for (let y=0;y<96;y++) for (let x=0;x<128;x++) {
    const i=(y*128+x)*4; pixels.data.set([x*2, y*2, 80, 255], i);
  }
  context.putImageData(pixels,0,0);
  const spec={schema:'worldbend.transform',version:'0.1',destination:{space:'normalized',quad:{tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}},content:{fit:'stretch'}};
  const solved=await solveTransformPreview(spec,{width:128,height:96});
  const renderer=new TransformWebGLRenderer(undefined,{preserveDrawingBuffer:true,antialias:false});
  const read=()=>{const c=document.createElement('canvas');c.width=128;c.height=96;const ctx=c.getContext('2d');ctx.drawImage(renderer.canvas,0,0);return ctx.getImageData(0,0,128,96).data;};
  renderer.render(source,solved,undefined,'high'); const baseline=read();
  const measurements=[];
  const nativeCapture=${JSON.stringify(capture).replaceAll("<", "\\u003c")};
  for(const [id,matrix,size,origin] of [
    ['identity',[[1,0,0],[0,1,0]],{width:128,height:96},{x:0,y:0}],
    ['quarter-turn',[[0,-1,96],[1,0,0]],{width:96,height:128},{x:0,y:0}],
    ['reflection',[[-1,0,128],[0,1,0]],{width:128,height:96},{x:0,y:0}],
    ['shear',[[1,.5,0],[0,1,0]],{width:176,height:96},{x:0,y:0}],
  ]) {
    const capture=document.createElement('canvas');capture.width=size.width;capture.height=size.height;
    const ctx=capture.getContext('2d');ctx.setTransform(matrix[0][0],matrix[1][0],matrix[0][1],matrix[1][1],matrix[0][2],matrix[1][2]);ctx.drawImage(source,0,0);
    const view=await planSourceCapture({logicalSize:{width:128,height:96},logicalToCaptureSpace:matrix,captureOrigin:origin,captureScale:1,pixelSize:size,convention:'fixedDensityFromOrigin'});
    assert(JSON.stringify(await validateSourceSamplingFrame(view))===JSON.stringify(view),'core view round trip');
    renderer.render(capture,solved,undefined,'high',undefined,view); const actual=read();
    let max=0,sum=0,count=0;
    for(let y=4;y<92;y++) for(let x=4;x<124;x++) for(let channel=0;channel<4;channel++) {
      const i=(y*128+x)*4+channel,d=Math.abs(actual[i]-baseline[i]);max=Math.max(max,d);sum+=d;count++;
    }
    assert(max<=3,id+' max pixel error '+max); measurements.push({id,maxChannelDelta:max,meanChannelDelta:sum/count});
    // The output is a fresh identity view; applying the old capture again
    // would rotate/shear it twice. Continue through the ordinary render call.
    const next=document.createElement('canvas');next.width=128;next.height=96;next.getContext('2d').drawImage(renderer.canvas,0,0);
    renderer.render(next,solved,undefined,'high');const continued=read();
    assert(continued.every((value,i)=>value===actual[i]),id+' next-stage drift');
  }
  const reflected=await planSourceCapture({logicalSize:{width:128,height:96},logicalToCaptureSpace:[[-1,0,128],[0,1,0]],captureOrigin:{x:0,y:0},captureScale:1,pixelSize:{width:128,height:96},convention:'fixedDensityFromOrigin'});
  const warp=await buildWarpMesh({preset:'flag',amount:.3});
  const rotated=document.createElement('canvas');rotated.width=96;rotated.height=128;
  const rotateContext=rotated.getContext('2d');rotateContext.setTransform(0,1,-1,0,96,0);rotateContext.drawImage(source,0,0);
  const rotatedView=await planSourceCapture({logicalSize:{width:128,height:96},logicalToCaptureSpace:[[0,-1,96],[1,0,0]],captureOrigin:{x:0,y:0},captureScale:1,pixelSize:{width:96,height:128},convention:'fixedDensityFromOrigin'});
  renderer.render(source,solved,warp,'high');const warpedBaseline=read();
  renderer.render(rotated,solved,warp,'high',undefined,rotatedView);const warpedActual=read();
  let warpedDelta=0;for(let i=0;i<warpedActual.length;i++)warpedDelta=Math.max(warpedDelta,Math.abs(warpedActual[i]-warpedBaseline[i]));
  assert(warpedDelta<=2,'captured rotation composed with Warp drifted '+warpedDelta);
  measurements.push({id:'rotation-then-flag-warp',maxChannelDelta:warpedDelta});
  renderer.render(source,solved,undefined,'high',undefined,reflected);const reflectedPixels=read();
  renderer.render(source,solved,undefined,'high');assert(read().every((v,i)=>v===baseline[i]),'view leaked through same-image texture cache');
  assert(reflectedPixels[4*64]!==baseline[4*64] || reflectedPixels[0]!==baseline[0],'reflection did not change samples');
  let refused=false;try{renderer.render(source,solved,undefined,'high',undefined,{...reflected,pixelSize:{width:129,height:96}});}catch{refused=true;}
  assert(refused,'stale capture header accepted');renderer.render(source,solved,undefined,'high');
  if(nativeCapture) {
    const url=URL.createObjectURL(new Blob([new Uint8Array(nativeCapture.bytes)],{type:'image/png'}));
    const image=new Image();image.src=url;await image.decode();
    try {
      const view=await planSourceCapture({logicalSize:nativeCapture.logicalSize,logicalToCaptureSpace:nativeCapture.matrix,
        captureOrigin:{x:nativeCapture.bounds.x,y:nativeCapture.bounds.y},captureScale:nativeCapture.scale,
        pixelSize:{width:image.naturalWidth,height:image.naturalHeight},convention:'fixedDensityFromOrigin'});
      renderer.render(image,solved,undefined,'high',undefined,view);const actual=read();
      const colors={red:[255,0,0,255],green:[0,255,0,255],blue:[0,0,255,255],yellow:[255,255,0,255]};
      const markers=[];
      for(const marker of nativeCapture.markers) {
        const x=Math.floor((marker.x+marker.width/2)/view.logicalSize.width*128);
        const y=Math.floor((marker.y+marker.height/2)/view.logicalSize.height*96);
        const rgba=Array.from(actual.slice((y*128+x)*4,(y*128+x)*4+4));
        assert(rgba.every((v,i)=>Math.abs(v-colors[marker.name][i])<=2),'native marker '+marker.name+' is misplaced');
        markers.push({name:marker.name,x,y,rgba});
      }
      measurements.push({id:'fresh-native-capture',pixelSize:view.pixelSize,markers});
    }finally{URL.revokeObjectURL(url);}
  }
  renderer.dispose();globalThis.__WORLDBEND_PARITY__={ok:true,measurements,cacheIsolation:true,staleHeaderRefused:true};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:String(error.stack||error)};}
</script>`;

let browser;
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
    const prefix = path.join(root, "packages/web/dist") + path.sep;
    const file = path.resolve(prefix, url.pathname.slice(5));
    if (!url.pathname.startsWith("/web/") || !file.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript");
    response.end(await readFile(file));
  } catch { response.writeHead(500); response.end(); }
});
try {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchChrome(await findChrome());
  const tab = await createPage(browser.debugUrl, url);
  const result = await readPageResult(tab.webSocketDebuggerUrl, { url, width: 800, height: 600, timeoutMs: 60000 });
  assert.equal(result.error, undefined, result.error); assert.equal(result.ok, true);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await new Promise(resolve => server.close(resolve));
  if (browser) await closeChrome(browser);
}
