import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {closeChrome,createPage,findChrome,launchChrome,readPageResult} from './remap-native-webgl-parity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../packages/web');
let browser,server;
try {
 server=createServer(async(req,res)=>{
  try{const url=new URL(req.url,'http://local');const relative=decodeURIComponent(url.pathname);const file=path.resolve(root,'.'+relative);if(!file.startsWith(root+path.sep))throw Error('Path outside fixture');let bytes=await readFile(file);
  if(file.endsWith('native-glass.html'))bytes=Buffer.from(bytes.toString().replace('</html>',`<script>(${check.toString()})()</script></html>`));
  res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/jpeg'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await launchChrome(await findChrome(),['--window-size=1440,1000']);
 const target=await createPage(browser.debugUrl,`http://127.0.0.1:${server.address().port}/examples/native-glass.html?test=1`);
 const result=await readPageResult(target.webSocketDebuggerUrl);assert(!result.error,result.error);assert(result.checks>=10);console.log(`Native appearance browser PASS (${result.checks} checks): multi-instance, press, visibility, resize, validation, disposal and rebind`);
}finally{if(browser)await closeChrome(browser);if(server)await new Promise(resolve=>server.close(resolve));}
async function check(){
 let checks=0;const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
 const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 try{
  const end=Date.now()+10000;while(!window.nativeAppearanceFixture&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,30));
  const f=window.nativeAppearanceFixture;ok(!!f,'fixture did not load');const {surface,plan,handle,attachAppearance}=f;await frames();
  ok(handle.mode==='svg-optics','Chromium SVG optics unavailable');
  ok(surface.style.backdropFilter.includes('url('),'displacement not attached to backdrop');
  const initialId=surface.querySelector('filter').id;const originalMap=surface.querySelector('feImage').getAttribute('href');
  const other=surface.cloneNode(false);other.className='glass second';surface.parentNode.append(other);const second=attachAppearance(other,plan);await frames();
  ok(initialId!==other.querySelector('filter').id,'filter ID collision');second.destroy();other.remove();
  let duplicate=false;try{attachAppearance(surface,plan);}catch{duplicate=true;}ok(duplicate,'duplicate attachment accepted');
  const shadow=surface.style.boxShadow;surface.dispatchEvent(new PointerEvent('pointerdown'));await frames();ok(surface.style.boxShadow!==shadow,'press response absent');window.dispatchEvent(new PointerEvent('pointercancel'));await frames();ok(surface.style.boxShadow===shadow,'cancel did not release press');
  surface.dispatchEvent(new KeyboardEvent('keydown',{key:' '}));await frames();ok(surface.style.boxShadow!==shadow,'keyboard press absent');surface.dispatchEvent(new FocusEvent('blur'));await frames();ok(surface.style.boxShadow===shadow,'focus loss left press stuck');
  surface.style.width='180px';await frames();await frames();ok(surface.querySelector('feImage').getAttribute('href')!==originalMap,'resize left stale optical geometry');
  handle.setVisible(false);await frames();ok(!surface.style.backdropFilter,'hidden effect still renders');handle.setVisible(undefined);await frames();ok(surface.style.backdropFilter.includes('url('),'visibility restoration failed');
  handle.update({...plan,material:{...plan.material,visible:false}});handle.setVisible(true);await frames();ok(!surface.style.backdropFilter&&!surface.style.border,'host visibility overrode hidden design material');handle.update(plan);handle.setVisible(undefined);await frames();
  const before=surface.style.backdropFilter;let rejected=false;try{handle.update({...plan,material:{...plan.material,depth:0}});}catch{rejected=true;}ok(rejected&&surface.style.backdropFilter===before,'invalid update mutated the effect');
  surface.style.border='2px solid red';handle.destroy();ok(!surface.querySelector('svg')&&!surface.style.backdropFilter,'destroy left optics behind');ok(surface.style.border==='2px solid red','destroy overwrote a later host style');
  const rebound=attachAppearance(surface,plan,{optics:'frost-only'});await frames();ok(rebound.mode==='frost-only'&&!surface.style.backdropFilter.includes('url('),'explicit frost fallback failed');rebound.destroy();
  window.__WORLDBEND_PARITY__={checks};
 }catch(error){window.__WORLDBEND_PARITY__={checks,error:String(error.stack??error)};}
}
