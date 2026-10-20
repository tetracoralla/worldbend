// Consumer personalization evidence in a real browser over the built SDK:
// exposure state distinction (E1), preference/preview/revision semantics
// (E2), and two entry routes over one implementation with offline restore
// and per-instance scope (E3). No MCP, model or per-frame tool calls.
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
    try {
      const url=new URL(req.url,'http://local'),file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
      assert(file.startsWith(root+path.sep),'Path outside personalization fixture');let bytes=await readFile(file);
      if(file.endsWith('appearance-personalization/index.html')) {
        bytes=Buffer.from(bytes.toString().replace('</body>',`<script>(${check.toString()})()</script></body>`));
      }
      res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'image/jpeg'});res.end(bytes);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await launchChrome(await findChrome(),['--window-size=1200,900']);
  const base=`http://127.0.0.1:${server.address().port}/examples/appearance-personalization/index.html`;
  for(const [phase,width] of [['main',1200],['restored',1200],['main',360]]) {
    const target=await createPage(browser.debugUrl,'about:blank');
    const result=await readPageResult(target.webSocketDebuggerUrl,{width,height:900,focus:true,url:`${base}?phase=${phase}`});
    assert(!result.error,result.error);
    assert(result.checks>=(phase==='restored'?14:24),`Incomplete ${phase} flow: ${JSON.stringify(result)}`);
    console.log(`Appearance personalization PASS (${result.checks} checks, ${width}px, ${phase}): ${JSON.stringify(result)}`);
  }
}finally{if(browser)await closeChrome(browser);if(server)await new Promise(resolve=>server.close(resolve));}

async function check() {
  let checks=0;const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async condition=>{const end=Date.now()+4000;while(!condition()&&Date.now()<end)await wait(20);ok(condition(),'Flow did not reach its expected state');};
  const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const errors=[];addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  try {
    while(!window.__appearanceReady)await wait(20);await window.__appearanceReady;await frames();
    const hook=window.__appearancePersonalization,phase=new URL(location.href).searchParams.get('phase');
    const hero=()=>hook.hero,blur=()=>parseFloat((hook.heroSurfaces[0].style.backdropFilter.match(/blur\(([\d.]+)px\)/)||[])[1]??'');
    const state=()=>hero().getState();

    // E1: the receiver distinguishes unsupported, not-exposed and adapted.
    const rows=Object.fromEntries(hook.exposure.controls.map(row=>[row.field,row.state]));
    ok(rows.radius==='exposed'&&rows.clarity==='exposed','Policy-selected controls must resolve as exposed');
    ok(rows['light-angle']==='not-exposed','Unselected controls must stay not-exposed');
    ok(rows.splay==='unsupported','Splay must stay unsupported, not silently off');
    ok(hook.exposureFrost.controls.find(row=>row.field==='refraction').state==='adapted','Frost-only runtime must mark displacement adapted');
    ok(hook.exposure.clarity.version==='1','Clarity composite must carry its mapping version');

    if(phase==='main') {
      const toolbarBase=hook.toolbar.getState().delivery;
      hook.toolbar.propose([{field:'radius',value:9,actor:'user'}]);
      let localError='';try{hook.toolbar.updateLocal(toolbarBase);}catch(error){localError=String(error);}
      ok(localError.includes('pending preview'),'A local designer edit must not replace a consumer preview');
      ok(hook.toolbar.getState().delivery.material.radius===9,'Rejected local edit must keep the preview display');
      hook.toolbar.cancelPreview();await frames();
      // E2: restore an explicit equal-to-default preference (radius=1).
      const record=await hook.receive('preference.json');
      hero().destroy(); // restorePreference re-attaches with the saved record
      hook.restorePreference(record);
      await frames();
      ok(state().preference.record.revision===4,'Restored preference revision must load');
      ok(state().delivery.material.radius===1,'Explicit equal-to-default override must drive the display');
      ok(state().delivery.material.lightIntensity===0.8,'Agent override must drive the display');

      // E2: a stale Agent plan cannot overwrite the accepted state. Driven
      // through the page action while the session still holds the same
      // source, the revision guard is what rejects it.
      const staleBefore=state().delivery.fingerprint;
      document.getElementById('stale-agent').click();await frames();
      ok(document.getElementById('status').textContent.includes('Stale preference proposal'),'Stale plan must be rejected with the revision reason');
      ok(state().delivery.fingerprint===staleBefore,'Rejected plan must leave the display untouched');

      // An equal-valued preview has the same display fingerprint but carries
      // unsaved intent. Committed-only source plans must not discard it.
      hero().propose([{field:'radius',value:1,actor:'user'}]);await frames();
      document.getElementById('design-update').click();await frames();
      ok(document.getElementById('status').textContent.includes('pending preview'),'A source update must reject while unsaved intent is being previewed');
      ok(state().preference.candidateRevision===5,'Rejected update must keep the unsaved candidate');
      ok(state().sourceFingerprint===hook.updateReceipt.current.previousFingerprint,'Rejected update must keep the accepted source');
      hero().cancelPreview();await frames();
      // Rejecting a malformed delivery must not advance the hidden evaluation
      // base. A later, unrelated preview still uses the accepted source.
      const badUpdate=structuredClone(hook.updateReceipt.current);
      badUpdate.delivery.fingerprint='invalid';
      let invalidError='';try{hero().update(badUpdate,await hook.receive('source.v2.delivery.json'));}catch(error){invalidError=String(error);}
      ok(invalidError.length>0,'Invalid update must be rejected');
      hero().propose([{field:'refraction',value:0.7,actor:'user'}]);await frames();
      ok(state().delivery.material.depth===hook.initial.material.depth,'Rejected update must leave the evaluation base untouched');
      hero().cancelPreview();await frames();
      // E3: design revision through the same session (source default rises to 5).
      document.getElementById('design-update').click();await frames();
      ok(state().delivery.material.radius===1,'Equal-to-default explicit preference must survive the design update');
      ok(state().delivery.material.depth===6,'Untouched fields must take the new source values');
      ok(state().sourceFingerprint===hook.updateReceipt.current.sourceFingerprint,'Accepted source identity must advance');
      // After the source advanced, replaying the plan reports the state.
      document.getElementById('design-update').click();await frames();
      ok(document.getElementById('status').textContent.includes('already received'),'A replayed plan must not reapply the design revision');

      // E2: a continuous-session reset must reveal the new source default,
      // not the previous override value — the session keeps the pure source
      // a consumer update delivered, exactly like the offline-restore path.
      document.getElementById('reset-radius').click();await frames();
      ok(state().preference.record.revision===5&&state().preference.record.fields.radius===undefined,'Reset must remove only the selected override');
      ok(blur()===5,'Continuous-session reset must reveal the new source default frost');
      ok(state().delivery.material.lightIntensity===0.8,'Reset must keep unrelated overrides');
      // Re-pin the equal-to-default override for the tuning flows below.
      hero().propose([{field:'radius',value:1,actor:'user'}]);
      hero().commitCandidate();await frames();
      ok(state().delivery.material.radius===1&&state().preference.record.revision===6,'Re-pinned override must restore the display');

      // E1+E2: clarity changes actual background presentation only.
      const foreground=hook.heroSurfaces[1].querySelector('p');
      const booking=hook.heroSurfaces[1];
      const foreStyle=getComputedStyle(booking.querySelector('p'));
      const beforeColor=foreStyle.color,beforeOpacity=foreStyle.opacity;
      const fetchBefore=hook.fetchCount,toolbarBefore=hook.toolbar.getState().delivery.fingerprint;
      const slider=document.getElementById('clarity');
      slider.value='0.4';
      slider.dispatchEvent(new Event('input',{bubbles:true}));await frames();
      slider.dispatchEvent(new Event('change',{bubbles:true}));await frames();
      const tunedBlur=blur();
      ok(tunedBlur>4,'Clarity below 1 must increase measured backdrop blur');
      ok(hook.fetchCount===fetchBefore,'Local tuning must not fetch anything (no per-frame MCP/model calls)');
      const afterStyle=getComputedStyle(booking.querySelector('p'));
      ok(afterStyle.color===beforeColor&&afterStyle.opacity===beforeOpacity,'Clarity must not fade foreground content');
      ok(hook.toolbar.getState().delivery.fingerprint===toolbarBefore,'A second instance must keep its own scope');
      ok(state().preference.record.revision===7,'Committing the slider must advance the preference revision');
      ok(state().preference.candidateRevision===null,'Commit must clear the candidate');

      // E2: cancel restores the latest committed state, not an older snapshot.
      hero().propose([{field:'refraction',value:0.8,actor:'agent'}]);await frames();
      ok(state().preference.candidateRevision===8,'Agent preview must be tracked as a candidate');
      hero().cancelPreview();await frames();
      ok(blur()===tunedBlur&&state().delivery.material.refraction===hook.updateReceipt.current.delivery.material.refraction,'Cancel must restore the committed evaluation');
      ok(state().preference.record.revision===7,'Cancel must not roll the committed revision back');

      // E2: hidden fields reject with the policy reason.
      let hiddenError='';try{hero().propose([{field:'light-angle',value:120,actor:'user'}]);}catch(error){hiddenError=String(error.message??error);}
      ok(hiddenError.includes('not-exposed'),'A hidden field must reject with its exposure reason');

      // E3: application content and handlers survive every material change.
      const clicksBefore=hook.businessClicks;
      document.getElementById('book').click();document.getElementById('later').click();
      ok(hook.businessClicks===clicksBefore+2,'Material changes must not swallow business handlers');
      ok(document.getElementById('report').textContent.includes('11:00'),'Application content must keep its own state');

      // E2: persistence for the offline-restore phase.
      hook.persist();
      localStorage.setItem(hook.storageKey('hero')+'/expected',state().delivery.fingerprint);
      ok(errors.length===0,'Personalization flow leaked a rejection');
      window.__WORLDBEND_PARITY__={checks};return;
    }

    // Restored phase: fresh page load, preference back from storage.
    const stored=JSON.parse(localStorage.getItem(hook.storageKey('hero')));
    ok(stored&&stored.preference.revision===7,'Storage must carry the committed preference across sessions');
    ok(state().preference.record.revision===7,'Fresh launch must restore the committed revision');
    ok(state().delivery.material.radius===blur()&&blur()>4,'Offline restore must reproduce the tuned frost');
    ok(state().delivery.fingerprint===localStorage.getItem(hook.storageKey('hero')+'/expected'),'Offline restore must reproduce the exact committed display: '+state().delivery.fingerprint+' vs '+localStorage.getItem(hook.storageKey('hero')+'/expected')+' material='+JSON.stringify(state().delivery.material));
    ok(state().sourceFingerprint===hook.updateReceipt.current.sourceFingerprint,'Restored session must still reference the accepted design revision');
    // Retune after restart continues the same preference history.
    document.getElementById('reset-radius').click();await frames();
    ok(state().preference.record.revision===8&&state().preference.record.fields.radius===undefined,'Reset must remove only the selected override');
    ok(blur()===5,'Reset must reveal the current source default frost');
    ok(state().delivery.material.lightIntensity===0.8,'Reset must keep unrelated overrides');

    // E1: temporarily adapted runtime keeps clarity honest.
    document.getElementById('frost-only').click();await frames();
    ok(hook.frostOnly===true,'Frost-only runtime toggle must reach the session');
    const adapted=hook.exposureFrost.controls.find(row=>row.field==='refraction');
    ok(adapted.state==='adapted'&&adapted.reason.includes('temporary'),'Adapted rows must explain the temporary degradation');
    const slider=document.getElementById('clarity');
    slider.value='0.2';slider.dispatchEvent(new Event('input',{bubbles:true}));await frames();
    slider.dispatchEvent(new Event('change',{bubbles:true}));await frames();
    ok(blur()>10,'Clarity must keep changing actual backdrop blur in the adapted runtime');
    ok(errors.length===0,'Restored flow leaked a rejection');
    window.__WORLDBEND_PARITY__={checks};
  }catch(error){window.__WORLDBEND_PARITY__={error:String(error.stack??error),checks};}
}
