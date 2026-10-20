import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {closeChrome,createPage,findChrome,launchChrome,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../packages/web');
let browser,server;
try{
 server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://local');const relative=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+relative);if(!file.startsWith(root+path.sep))throw Error('Path outside fixture');let bytes=await readFile(file);
  if(file.endsWith('texture-paper.html'))bytes=Buffer.from(bytes.toString().replace('</html>',`<script>(${check.toString()})()</script></html>`));
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/jpeg'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await launchChrome(await findChrome(),['--window-size=1440,1000']);
 const target=await createPage(browser.debugUrl,`http://127.0.0.1:${server.address().port}/examples/texture-paper.html?test=1`);
 const result=await readPageResult(target.webSocketDebuggerUrl);assert(!result.error,result.error);assert(result.checks>=25);console.log(`Texture runtime browser PASS (${result.checks} checks): grain tile, achromatic etch relief layer, blends, visibility, update, validation, disposal and rebind`);
}finally{if(browser)await closeChrome(browser);if(server)await new Promise(resolve=>server.close(resolve));}
async function check(){
 let checks=0;const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
 const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 try{
  const end=Date.now()+10000;while(!window.nativeTextureFixture&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,30));
  const f=window.nativeTextureFixture;ok(!!f,'fixture did not load');const {surface,plan,handle,attachTexture}=f;await frames();
  const overlay=surface.querySelector('.worldbend-texture');ok(!!overlay,'grain overlay missing');
  ok(overlay.getAttribute('aria-hidden')==='true','overlay must stay out of the accessibility tree');
  ok(overlay.style.backgroundImage.includes('data:image/svg+xml'),'delivered grain tile not applied');
  ok(overlay.style.backgroundSize==='30.72px 30.72px','grain cell size calibration not applied');
  ok(overlay.style.mixBlendMode==='normal','grain blend not applied');
  ok(!overlay.style.filter,'grain overlay must not be replaced by the etch filter');
  const etchLayer=surface.querySelector('.worldbend-texture-etch');ok(!!etchLayer,'etch relief layer missing');
  ok(etchLayer.getAttribute('aria-hidden')==='true','etch layer must stay out of the accessibility tree');
  const filter=surface.querySelector('filter');ok(!!filter&&surface.querySelector('feTurbulence')&&surface.querySelector('feDiffuseLighting'),'etch bump filter missing');
  ok(!!surface.querySelector('feColorMatrix[in="etched"][values="0"]'),'etch relief must be achromatic so the grain tint survives');
  ok(etchLayer.style.filter.includes('url('),'etch filter not bound to the relief layer');
  ok(etchLayer.style.mixBlendMode==='overlay','etch relief must blend over the surface, not replace it');
  ok(etchLayer.style.clipPath.startsWith('inset(')&&etchLayer.style.clipPath.includes('round'),'etch relief overscan must clip to the surface outline');
  ok(parseFloat(overlay.style.borderRadius)>0,'clip-to-shape radius missing');
  handle.setVisible(false);await frames();ok(!overlay.style.backgroundImage,'hidden texture still renders');
  ok(etchLayer.style.display==='none','hidden texture still shows its etch relief');
  handle.setVisible(undefined);await frames();ok(overlay.style.backgroundImage.includes('data:image/svg+xml'),'visibility restoration failed');
  ok(etchLayer.style.display!=='none'&&etchLayer.style.filter.includes('url('),'etch relief did not restore with visibility');
  const before=overlay.style.backgroundSize;const resized={...plan,material:{...plan.material,grainSize:6},web:{...plan.web,grainTileSize:61.44}};handle.update(resized);await frames();ok(overlay.style.backgroundSize==='61.44px 61.44px'&&overlay.style.backgroundSize!==before,'update did not apply the revision');
  let rejected=false;const intact=overlay.style.backgroundSize;try{handle.update({...plan,material:{...plan.material,etchSize:0.1}});}catch{rejected=true;}ok(rejected&&overlay.style.backgroundSize===intact,'invalid update mutated the texture');
  let duplicate=false;try{attachTexture(surface,plan);}catch{duplicate=true;}ok(duplicate,'duplicate attachment accepted');
  const corner={...plan,material:{...plan.material,clipToShape:false}};handle.update(corner);await frames();ok(parseFloat(overlay.style.borderRadius)>0,'etch clip-to-shape=false leaked grain outside the shape');
  ok(etchLayer.style.clipPath==='inset(0px)','clip-to-shape=false kept the etch outline clip');
  handle.update(plan);
  const authoredHidden={...plan,material:{...plan.material,visible:false},web:{...plan.web,css:'',grainTile:'',etch:null,fidelity:[]}};
  handle.update(authoredHidden);handle.setVisible(true);await frames();ok(!overlay.style.backgroundImage&&etchLayer.style.display==='none','host visibility enabled an authored-hidden canonical delivery');
  handle.setVisible(undefined);handle.update(plan);
  surface.style.position='fixed';
  handle.destroy();ok(surface.style.position==='fixed','destroy overwrote a later host positioning change');
  ok(!surface.querySelector('.worldbend-texture')&&!surface.querySelector('.worldbend-texture-etch')&&!surface.querySelector('svg'),'destroy left texture layers behind');
  const rebound=attachTexture(surface,plan);await frames();ok(surface.querySelector('.worldbend-texture')&&surface.querySelector('.worldbend-texture-etch'),'rebind after disposal failed');rebound.destroy();
  const independent=document.createElement('div');independent.style.cssText='width:100px;height:80px;border-radius:12px 24px 8px 0';document.body.append(independent);
  const owned=attachTexture(independent,plan);await frames();ok(independent.style.position==='relative','static host did not acquire a containing block');
  ok(independent.querySelector('.worldbend-texture').style.borderRadius==='12px 24px 8px 0px','nonuniform corners were replaced by one radius');
  owned.destroy();ok(independent.style.position==='','owned positioning was not restored');
  const priority=attachTexture(independent,plan);independent.style.setProperty('position','relative','important');priority.destroy();ok(independent.style.getPropertyPriority('position')==='important','destroy erased the host positioning priority');independent.remove();
  window.__WORLDBEND_PARITY__={checks};
 }catch(error){window.__WORLDBEND_PARITY__={checks,error:String(error.stack??error)};}
}
