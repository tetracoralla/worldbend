import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const argument=process.argv.slice(2).find(value=>value.startsWith("--capture="));
assert(process.argv.slice(2).every(value=>value===argument),"Unexpected argument");
const capture=argument?JSON.parse(await readFile(argument.slice(10),"utf8")):null;
const html=`<!doctype html><meta charset="utf-8"><script type="module">
import {decodeSourceRaster} from '/packages/figma/src/source-raster-decode.ts';
const assert=(ok,message)=>{if(!ok)throw Error(message)};
const pixels=image=>{const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return {width:c.width,height:c.height,data:ctx.getImageData(0,0,c.width,c.height).data}};
const encode=canvas=>new Promise(resolve=>canvas.toBlob(async blob=>resolve(new Uint8Array(await blob.arrayBuffer())),'image/png'));
try {
 const source=document.createElement('canvas');source.width=128;source.height=96;
 const ctx=source.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,128,96);
 const markers=[{x:12,y:14,width:24,height:20,color:[255,0,0]},{x:88,y:58,width:28,height:24,color:[0,0,255]}];
 for(const m of markers){ctx.fillStyle='rgb('+m.color.join(',')+')';ctx.fillRect(m.x,m.y,m.width,m.height)}
 const measurements=[];
 const check=(decoded,list,logicalSize,id)=>{
  const p=pixels(decoded.image);
  for(const m of list){const x=Math.floor((m.x+m.width/2)/logicalSize.width*p.width),y=Math.floor((m.y+m.height/2)/logicalSize.height*p.height);
   const actual=Array.from(p.data.slice((y*p.width+x)*4,(y*p.width+x)*4+4));
   assert(actual[3]===255&&m.color.every((v,i)=>Math.abs(v-actual[i])<=3),id+' marker '+actual);
  }
  measurements.push({id,width:p.width,height:p.height,markers:list.length});
 };
 for(const [id,matrix,width,height] of [['rotate',[[0,-1,96],[1,0,0]],96,128],['reflect-shear',[[-1,.5,128],[0,1,0]],176,96]]) {
  const c=document.createElement('canvas');c.width=width;c.height=height;const cx=c.getContext('2d');cx.setTransform(matrix[0][0],matrix[1][0],matrix[0][1],matrix[1][1],matrix[0][2],matrix[1][2]);cx.drawImage(source,0,0);
  const bytes=await encode(c),facts={logicalSize:{width:128,height:96},logicalToCaptureSpace:matrix,captureOrigin:{x:0,y:0},captureScale:1,pixelSize:{width,height},convention:'fixedDensityFromOrigin'};
  const decoded=await decodeSourceRaster(bytes,facts);check(decoded,markers,facts.logicalSize,id);
  const continued=await decodeSourceRaster(decoded.bytes);check(continued,markers,facts.logicalSize,id+'-continued');
  let refused=false;try{await decodeSourceRaster(bytes,{...facts,pixelSize:{width:width+1,height}})}catch{refused=true}assert(refused,'wrong header was accepted');
 }
 const native=${JSON.stringify(capture).replaceAll('<','\\u003c')};let normalizedPng;
 if(native){const bytes=Uint8Array.from(atob(native.png),c=>c.charCodeAt(0));const image=await decodeSourceRaster(bytes);const facts={logicalSize:native.logicalSize,logicalToCaptureSpace:native.matrix,captureOrigin:{x:native.bounds.x,y:native.bounds.y},captureScale:1,pixelSize:{width:image.image.naturalWidth,height:image.image.naturalHeight},convention:'fixedDensityFromOrigin'};
  const decoded=await decodeSourceRaster(bytes,facts);check(decoded,native.markers.map(m=>({...m,color:Object.values(m.color).map(v=>Math.round(v*255))})),native.logicalSize,'native-affine-content');
  normalizedPng=btoa(Array.from(decoded.bytes,b=>String.fromCharCode(b)).join(''));
 }
 globalThis.__WORLDBEND_PARITY__={ok:true,measurements,wrongHeaderRefused:true,...(normalizedPng?{normalizedPng}:{})};
}catch(error){globalThis.__WORLDBEND_PARITY__={error:String(error.stack||error)}}
</script>`;
let browser;
const server=await createServer({configFile:false,root,appType:"custom",optimizeDeps:{noDiscovery:true},logLevel:"error",server:{host:"127.0.0.1",port:0},resolve:{alias:{"@worldbend/web":path.join(root,"packages/web/src/index.ts"),"@worldbend/wasm/perspective":path.join(root,"packages/wasm/pkg-perspective/worldbend_wasm.js"),"@worldbend/wasm":path.join(root,"packages/wasm/pkg/worldbend_wasm.js")}}});
server.middlewares.use((req,res,next)=>{if(req.url!=="/__capture-check"){next();return}res.setHeader("Content-Type","text/html");res.end(html)});
try {
 await server.listen();const port=server.httpServer.address().port,url=`http://127.0.0.1:${port}/__capture-check`;
 browser=await launchChrome(await findChrome());const tab=await createPage(browser.debugUrl,url);
 const result=await readPageResult(tab.webSocketDebuggerUrl,{url,width:800,height:600,timeoutMs:60000});
 assert.equal(result.error,undefined,result.error);assert.equal(result.ok,true);
 if(result.normalizedPng&&argument){await writeFile(path.join(path.dirname(argument.slice(10)),"native-source-logical.png"),Buffer.from(result.normalizedPng,"base64"));delete result.normalizedPng;}
 console.log(JSON.stringify(result,null,2));
}finally{await server.close();if(browser)await closeChrome(browser)}
