import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {closeChrome,createPage,findChrome,launchChrome,readPageResult} from './remap-native-webgl-parity.mjs';

const packageRootIndex=process.argv.indexOf('--package-root');
if(packageRootIndex!==-1&&!path.isAbsolute(process.argv[packageRootIndex+1]??''))throw Error('--package-root needs an absolute package directory');
const root=packageRootIndex===-1?path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../packages/web'):process.argv[packageRootIndex+1];
let browser,server;
try {
  server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,'http://local'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      assert(file.startsWith(root+path.sep),'Path outside receiving fixture');let bytes=await readFile(file);
      if(file.endsWith('appearance-receiving/index.html')) {
        let html=bytes.toString();
        if(url.searchParams.has('fail-initial'))html=html.replace('<title>',`<script>(${failInitial.toString()})()</script><title>`);
        bytes=Buffer.from(html.replace('</body>',`<script>(${check.toString()})()</script></body>`));
      }
      res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/jpeg'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await launchChrome(await findChrome(),['--window-size=1200,900']);
  for(const width of [1200,320])for(const mode of ['plain','local','removed','startup','personalization']) {
    const target=await createPage(browser.debugUrl,'about:blank');
    const result=await readPageResult(target.webSocketDebuggerUrl,{width,height:900,focus:true,
      url:`http://127.0.0.1:${server.address().port}/examples/appearance-receiving/index.html?mode=${mode}${mode==='startup'?'&fail-initial=1':''}`});
    assert(!result.error,result.error);
    assert(result.checks>=(mode==='startup'?5:mode==='personalization'?14:36),`Incomplete ${mode} flow: ${result.checks}`);
    console.log(`Appearance receiving PASS (${result.checks} checks, ${width}px, ${mode}): ${JSON.stringify(result)}`);
  }
}finally{if(browser)await closeChrome(browser);if(server)await new Promise(resolve=>server.close(resolve));}

async function check() {
  let checks=0;const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async condition=>{const end=Date.now()+3000;while(!condition()&&Date.now()<end)await wait(20);ok(condition(),'Flow did not reach its expected state');};
  const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const errors=[];const reject=event=>errors.push(String(event.reason));addEventListener('unhandledrejection',reject);
  try {
    while(!window.__appearanceReady)await wait(20);await window.__appearanceReady;
    const f=window.__appearanceReceiving,mode=new URL(location.href).searchParams.get('mode');
    if(mode==='startup') {
      ok(!f.group&&document.getElementById('status').textContent.includes('Initial material unavailable'),'Initial failure lost feedback');
      document.getElementById('reserve').click();ok(document.getElementById('reservation').textContent.includes('draft 1'),'Unavailable material blocked the business action');
      document.getElementById('reconnect').click();await until(()=>!!f.group);
      ok(f.group.getState().delivery.material.radius===1,'Retry did not receive the source material');
      ok(errors.length===0,'Startup leaked a rejection');window.__WORLDBEND_PARITY__={checks};return;
    }
    if(mode==='personalization') {
      // Exposure and preference over the Figma-derived entry: the same session, an exposure
      // policy that exposes only the clarity composite, and the consumer-path
      // design update. The storage clear keeps the other modes designer-clean.
      localStorage.removeItem(f.storageKey);await frames();
      const rows=Object.fromEntries(f.exposure.controls.map(row=>[row.field,row.state]));
      ok(rows.radius==='not-exposed'&&rows.clarity==='exposed'&&rows.visible==='exposed','Composite-only policy must expose clarity and hide raw frost');
      ok(f.exposure.clarity?.mapsTo==='radius'&&f.exposure.clarity.version==='1','The composite receipt must own frost through its versioned mapping');
      f.restorePreference(f.fixturePreference);await until(()=>f.group?.getState().preference.record.revision===3);
      ok(f.group.getState().delivery.material.radius===1,'A radius override carried by the exposed composite must drive the display');
      const receipt=await f.receive('revision.json');
      ok(receipt.consumerUpdate.preserved.includes('radius'),'The consumer plan must carry the frost override through the composite');
      ok(receipt.consumerUpdate.preferenceReceipts[0].reason.includes('clarity composite'),'Composite-carried overrides must disclose their route');
      document.getElementById('revision').click();await until(()=>f.group.getState().sourceFingerprint===receipt.source.fingerprint);await frames();
      const updated=f.group.getState();
      ok(updated.delivery.material.radius===1,'Equal-to-default frost must survive the design update');
      ok(updated.delivery.material.lightIntensity===receipt.source.material.lightIntensity,'Untouched fields must take the new source values');
      // Reset reveals the NEW source default, not the previous override.
      document.getElementById('reset-preference').click();await frames();
      ok(f.group.getState().delivery.material.radius===receipt.source.material.radius,'Reset must reveal the new source default frost');
      ok(f.group.getState().preference.record.revision===4&&f.group.getState().preference.record.fields.radius===undefined,'Reset must advance the revision and drop only frost');
      ok(f.group.getState().delivery.fingerprint===receipt.source.fingerprint,'Reset display must be the pure new source');
      let stale=false;try{f.group.update(receipt.consumerUpdate,receipt.source);}catch{stale=true;}
      ok(stale,'A replayed consumer plan must not overwrite the newer human reset');
      const slider=document.getElementById('clarity');
      slider.value='0.4';slider.dispatchEvent(new Event('input',{bubbles:true}));await frames();
      ok(f.group.getState().preference.candidateRevision===5,'Clarity preview must be a candidate');
      slider.dispatchEvent(new Event('change',{bubbles:true}));await frames();
      ok(f.group.getState().preference.record.revision===5&&f.group.getState().delivery.material.radius>4,'Committing clarity must apply the mapped frost');
      document.getElementById('reserve').click();
      ok(document.getElementById('reservation').textContent.includes('draft 1'),'Consumer tuning must not swallow business handlers');
      localStorage.removeItem(f.storageKey);
      ok(errors.length===0,'Personalization flow leaked a rejection: '+errors.join('; '));
      window.__WORLDBEND_PARITY__={checks};return;
    }
    await frames();const owner=f.group,initial=owner.getState(),ids=f.surfaces.map(node=>node.querySelector('filter').id);
    ok(initial.delivery.material.radius===1&&initial.delivery.recipeVersion===2,'Receipt replayed preset defaults instead of live Frost');
    ok(f.sourceInput.material.radius===1&&f.sourceInput.recipe.material.radius===6,'Receipt omitted the source/seed needed for later Agent planning');
    ok(ids[0]!==ids[1],'Shared material collided between controls');
    ok(document.documentElement.scrollWidth<=innerWidth,'Receiving layout overflows');
    owner.setVisible(false);await frames();ok(f.surfaces.every(node=>!node.style.backdropFilter),'Transient visibility did not reach all instances');
    owner.setVisible(undefined);await frames();ok(owner.getState().sourceFingerprint===initial.sourceFingerprint&&f.surfaces.every(node=>node.style.backdropFilter),'Transient visibility rewrote the source or could not restore');
    let invalid=false;try{owner.updateLocal({...initial.delivery,material:{...initial.delivery.material,depth:0}});}catch{invalid=true;}
    ok(invalid&&owner.getState().delivery.fingerprint===initial.delivery.fingerprint,'Invalid local update changed the accepted state');
    const content=document.getElementById('campaign'),save=document.getElementById('save');
    document.getElementById('change').click();save.click();document.getElementById('reserve').click();save.focus();
    ok(content.textContent.includes('11:00')&&save.getAttribute('aria-pressed')==='true','Application controls did not keep their own state');
    const shadow=f.surfaces[0].style.boxShadow;
    save.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await frames();
    ok(f.surfaces[0].style.boxShadow!==shadow,'Keyboard material feedback absent');
    save.dispatchEvent(new FocusEvent('blur',{bubbles:true}));window.dispatchEvent(new PointerEvent('pointercancel'));await frames();
    ok(f.surfaces[0].style.boxShadow===shadow,'Cancellation left material pressed');
    const receipt=await f.receive('revision.json');
    for(const delivery of [undefined,false]) {
      let invalid=false;try{owner.update({...receipt.updates[0],delivery});}catch{invalid=true;}
      ok(invalid&&owner.getState().sourceFingerprint===initial.sourceFingerprint&&owner.getState().delivery.fingerprint===initial.delivery.fingerprint,'Malformed update removed the accepted material');
    }
    if(mode==='local') {
      document.getElementById('local').click();await until(()=>owner.getState().delivery.material.radius===12);
      let stale=false;try{owner.update(receipt.updates[0]);}catch{stale=true;}
      ok(stale&&owner.getState().sourceFingerprint===initial.sourceFingerprint,'Late plan overwrote a newer local material edit');
    } else if(mode==='removed') {document.getElementById('remove').click();ok(owner.getState().delivery===null,'Local removal failed');}
    // A failed receipt retains the project and accepted state, then retries.
    const acceptedBefore=owner.getState(),fetchResource=window.fetch;
    window.fetch=(...args)=>String(args[0]).includes('revision.json')?Promise.reject(Error('Design unavailable; try again.')):fetchResource(...args);
    document.getElementById('revision').click();await until(()=>document.getElementById('status').textContent.includes('Design unavailable'));
    window.fetch=fetchResource;
    ok(JSON.stringify(owner.getState().delivery)===JSON.stringify(acceptedBefore.delivery),'Failed update replaced the accepted material');
    document.getElementById('revision').click();await until(()=>owner.getState().sourceFingerprint===receipt.source.fingerprint);await frames();
    const updated=owner.getState();
    ok(f.sourceInput.material.radius===5&&f.sourceInput.recipe.recipeVersion===2,'Update replaced source history with the local merged material');
    ok(updated.delivery===null?mode==='removed':updated.delivery.material.radius===(mode==='local'?12:5),'Design update lost local override/removal semantics');
    ok(updated.delivery===null||updated.delivery.recipeVersion===2&&updated.delivery.material.refraction===receipt.source.material.refraction,'Native revision invented a preset version or lost current optics');
    ok(f.group===owner&&content.textContent.includes('11:00')&&save.getAttribute('aria-pressed')==='true','Update replaced application state');
    document.getElementById('reserve').click();ok(document.getElementById('reservation').textContent.includes('draft 2'),'Revision replaced business handlers');
    let stale=false;try{owner.update(receipt.updates[0]);}catch{stale=true;}ok(stale,'Repeated old source receipt was accepted');
    // Cache returns keep this DOM-only material and its local state.
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    ok(f.group===owner&&JSON.stringify(owner.getState().delivery)===JSON.stringify(updated.delivery),'Cached return discarded local material state');
    document.getElementById('reconnect').click();await until(()=>f.group!==owner);await frames();
    const connected=f.group;
    ok(connected.getState().delivery.material.radius===5,'Explicit reconnect lost the latest accepted design');
    ok(f.surfaces.every(node=>node.querySelectorAll('filter').length===1),'Reconnection stacked material bindings');
    f.surfaces[0].style.setProperty('border','3px solid rgb(180, 220, 230)','important');
    connected.updateLocal(await f.receive('local.v2.json'));await frames();
    ok(f.surfaces[0].style.getPropertyPriority('border')==='important'&&f.surfaces[0].style.border.startsWith('3px'),'Revision overwrote a later application declaration');
    ok(connected.getState().preservedProperties[0].includes('border'),'Destination declaration ownership is not inspectable');
    const unchangedMap=f.surfaces[0].querySelector('feImage')?.getAttribute('href');
    scrollTo(0,100);await frames();
    ok(f.surfaces[0].querySelector('feImage')?.getAttribute('href')===unchangedMap,'Scroll needlessly regenerated optical geometry');
    connected.destroy();
    ok(f.surfaces.every(node=>!node.querySelector('svg')&&!node.style.backdropFilter),'Disposal left owned optics behind');
    ok(f.surfaces[0].style.getPropertyPriority('border')==='important','Disposal erased the newer declaration priority');
    document.getElementById('reserve').click();ok(document.getElementById('reservation').textContent.includes('draft 3'),'Disposal removed business handlers');
    document.getElementById('reconnect').click();await until(()=>f.group!==connected);
    // A pending artifact cannot reach a replaced group.
    let release;const before=f.group;
    window.fetch=(...args)=>String(args[0]).includes('revision.json')?new Promise(resolve=>{release=resolve;}):fetchResource(...args);
    document.getElementById('revision').click();ok(!!release,'Delayed receipt did not start');
    document.getElementById('reconnect').click();await until(()=>f.group!==before);
    release(new Response(JSON.stringify(receipt)));await wait(100);window.fetch=fetchResource;
    ok(f.group.getState().sourceFingerprint===receipt.source.fingerprint,'Abandoned receipt changed the replacement group');
    ok(errors.length===0,'Receiving flow leaked a rejection: '+errors.join('; '));
    window.__WORLDBEND_PARITY__={checks,mode,sourceFingerprint:f.group.getState().sourceFingerprint};
  }catch(error){window.__WORLDBEND_PARITY__={checks,error:String(error.stack??error)};}
  finally{removeEventListener('unhandledrejection',reject);}
}

function failInitial() {const request=window.fetch;let first=true;window.fetch=(...args)=>{
  if(first&&String(args[0]).includes('initial.json')){first=false;return Promise.reject(Error('Initial material unavailable; reconnect to retry.'));}
  return request(...args);
};}
