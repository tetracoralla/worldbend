import {createQaHttpFailureBoundary} from "./qa-http-failure-boundary.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { unzipSync } from "fflate";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findChrome,
  launchChrome,
  closeChrome,
  createPage,
  readPageResult,
} from "./remap-native-webgl-parity.mjs";
const httpFailures=createQaHttpFailureBoundary("scene-example-package-check.mjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  evidence = path.join(
    root,
    ".worldbend-work/verification/scene-example-package",
  );
const moved = path.join(evidence, "moved-work");
await mkdir(moved, { recursive: true });
for (const [name, bytes] of Object.entries(
  unzipSync(
    await readFile(
      path.join(root, ".worldbend-work/scene-example-package/field-notes.zip"),
    ),
  ),
)) {
  const file = path.resolve(moved, name);
  if (!file.startsWith(moved + path.sep)) throw Error("Invalid package path");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
}
for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "licenses/three-MIT.txt", "sbom/worldbend-scene-example.spdx.json"])
  await readFile(path.join(moved, name));
const inventory = JSON.parse(await readFile(path.join(moved, "sbom/worldbend-scene-example.spdx.json"), "utf8"));
if (!inventory.packages.some(p => p.name === "three" && p.versionInfo === "0.186.1") ||
    inventory.packages.some(p => p.name === "worldbend-cli" || p.name === "worldbend-mcp"))
  throw Error("Scene package runtime inventory is unavailable or mismatched");
const script = String.raw`
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),assert=(value,message)=>{if(!value)throw Error(message)};
const rejected=async work=>{try{await work();return true}catch{return false}};
const trusted=async(method,params,screenshot)=>{globalThis.__WORLDBEND_INPUT__={method,params,...(screenshot?{screenshot}:{})};while(!globalThis.__WORLDBEND_INPUT_DONE__)await wait(10);delete globalThis.__WORLDBEND_INPUT_DONE__};
const click=async id=>{document.getElementById(id).scrollIntoView({block:'center'});const r=document.getElementById(id).getBoundingClientRect();for(const type of ['mousePressed','mouseReleased'])await trusted('Input.dispatchMouseEvent',{type,x:r.x+r.width/2,y:r.y+r.height/2,button:'left',clickCount:1});await settled()};
const settled=async()=>{for(let n=0;n<400&&(globalThis.worldbendSceneExample?.getSession()?.getState().busy||(document.getElementById('cover').disabled&&document.getElementById('source-panel').hidden)||(!document.getElementById('source-panel').hidden&&document.getElementById('apply-source').disabled));n++)await wait(10);};
try{
 for(let n=0;n<500&&!globalThis.worldbendSceneExample?.getSession();n++)await wait(10);
 const app=globalThis.worldbendSceneExample;assert(app?.getSession(),'Moved package did not open');
 assert(document.documentElement.scrollWidth<=innerWidth,'Horizontal overflow');
 await app.open(app.getInitial(),1625);
 if(new URL(location.href).searchParams.has('recovery')){assert(localStorage.getItem('worldbend.paper-theatre.v1.recovery')===globalThis.__BROKEN_RECORD__,'Failed startup overwrote recoverable work');assert(!document.getElementById('record').hidden,'Recovery record is undiscoverable');globalThis.__WORLDBEND_PARITY__={ok:true,width:innerWidth,checks:['startup failure retained exact original record','recovery download available','healthy fallback opened']};}else{
 const first=app.getSession().getState();await click('cover');assert(document.getElementById('edition').textContent==='02','Trusted cover change failed');
 await click('scene');await click('apply-source');await click('retime');assert(app.getSession().getState().durationMs===6000,'Trusted source/retime failed '+JSON.stringify({duration:app.getSession().getState().durationMs,status:document.getElementById('status').textContent}));
 await click('view');assert(app.getSession().getDocument().expressions[0].scene.camera==='FrontCamera','Front view failed');
 const expected=app.getSession().getDocument();await click('undo');assert(app.getSession().getDocument().expressions[0].scene.camera==='RevealCamera','Undo did not restore view');await click('view');
 const encoded=JSON.stringify(expected);await app.open(JSON.parse(encoded),2200);assert(JSON.stringify(app.getSession().getDocument())===encoded,'Fresh opening changed work');
 const bad=JSON.parse(encoded);bad.assets[0].contentVersion='sha256:'+('0'.repeat(64));assert(!await rejected(()=>app.open(bad)),'Missing source incorrectly opened');assert(JSON.stringify(app.getSession().getDocument())===encoded,'Failed open damaged accepted work');
 await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await wait(50);assert(document.getElementById('play').disabled,'Reduced motion affordance active');
 await click('time');await trusted('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});await trusted('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home'});assert(app.getSession().getState().timeMs===0,'Keyboard scrubbing failed');
 await trusted('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await click('play');await wait(120);await click('play');assert(app.getSession().getState().timeMs>0&&app.getSession().getState().paused,'Actual playback/pause failed');
 await click('scene');assert(document.querySelectorAll('#source-conflicts fieldset').length===2,'Third source should expose camera/rhythm conflicts');
 assert(document.documentElement.scrollWidth<=innerWidth,'Source preview overflow');await click('apply-source');
 const continued=app.getSaved();assert(continued.sourceDocument.expressions[0].scene.camera==='Reveal Camera.003','Third source baseline lost renamed camera');
 assert(continued.sourceDocument.expressions[0].scene.timebase.numerator===30&&continued.document.expressions[0].scene.timebase.numerator===24,'Local rhythm silently adopted author rate');
 assert(continued.document.expressions[0].scene.camera==='FrontCamera'&&app.getSession().getState().durationMs===6000,'Third source overwrote local adjustments');
 await app.openSaved(JSON.parse(JSON.stringify(continued)));assert(JSON.stringify(app.getSaved().document)===JSON.stringify(continued.document),'Saved continuation changed accepted document');
 const acceptedFingerprint=app.getSession().getState().guard.documentFingerprint;
 assert(!await rejected(()=>app.openSaved({...continued,version:'999'})),'Unknown file version accepted');
 assert(!await rejected(()=>app.openSaved({...continued,history:[{document:{schema:'wrong'}}]})),'Invalid undo history accepted');
 const incompatible=structuredClone(continued.document);incompatible.assets.find(a=>a.id==='paper-stage').id='renamed-scene';for(const e of incompatible.expressions)for(const b of e.bindings)if(b.assetId==='paper-stage')b.assetId='renamed-scene';
 assert(!await rejected(()=>app.openSaved(incompatible)),'Incompatible receiving host structure accepted');
 assert(app.getSession().getState().guard.documentFingerprint===acceptedFingerprint,'Invalid handoff damaged accepted work');
 await click('undo');assert(app.getSaved().sourceDocument.expressions[0].scene.frameCount===120,'Undo did not restore earlier author baseline');
 const legacyWork=app.getSession().getDocument();await app.openSaved({schema:'worldbend.paper-theatre-file',version:'0.1',document:legacyWork,timeMs:1800});
 assert(JSON.stringify(app.getSession().getDocument())===JSON.stringify(legacyWork),'Legacy migration changed accepted values');
 assert(app.getSaved().localFields.includes('/assets/field-notes/contentVersion')&&app.getSaved().localFields.includes('/expressions/paper-theatre/scene/timing'),'Legacy settings were not retained as local choices');
 await trusted('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10},innerWidth<600?'moved-mobile':'moved-desktop');
 globalThis.__WORLDBEND_PARITY__={ok:true,width:innerWidth,documentFingerprint:app.getSession().getState().guard.documentFingerprint,checks:['moved standalone package','trusted print/source/retime/view/undo','fresh document reopen','failed-open preservation','reduced motion','trusted keyboard scrubbing','real playback pause','third real Blender source with camera/rhythm conflicts','manual cadence preserved across new author rate','saved source baseline and history reopen','invalid handoff version/history rejected','source undo restores baseline','legacy migration preserves current settings','no horizontal overflow']};
}
}catch(error){globalThis.__WORLDBEND_PARITY__={error:error.stack??String(error)}};
`;
const server = createServer(async (req, res) => {
  try {
    const route = new URL(req.url, "http://localhost").pathname;
    const file = path.resolve(
      moved,
      route === "/" ? "index.html" : "." + route,
    );
    if (!file.startsWith(moved + path.sep)) throw Error("Invalid fixture");
    let body = await readFile(file);
    if (
      file.endsWith(".html") &&
      new URL(req.url, "http://localhost").searchParams.has("recovery")
    ) {
      const fixture = JSON.parse(
        await readFile(path.join(moved, "document.json"), "utf8"),
      );
      fixture.assets[0].contentVersion = "sha256:" + "0".repeat(64);
      const broken = JSON.stringify({ document: fixture, timeMs: 2000 });
      body = Buffer.from(
        body
          .toString()
          .replace(
            '<script type="module"',
            `<script>globalThis.__BROKEN_RECORD__=${JSON.stringify(broken)};localStorage.setItem('worldbend.paper-theatre.v1',globalThis.__BROKEN_RECORD__);</script><script type="module"`,
          ),
      );
    }
    if (file.endsWith(".html"))
      body = Buffer.from(
        body
          .toString()
          .replace(
            "</html>",
            `<script type="module">${script}</script></html>`,
          ),
      );
    const mime = file.endsWith(".html")
      ? "text/html"
      : file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".json")
          ? "application/json"
          : file.endsWith(".png")
            ? "image/png"
            : "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
    res.end(body);
  } catch (error) {
    httpFailures.respond(req,res,error,400);
  }
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await launchChrome(await findChrome());
  const results = [];
  for (const size of [
    { width: 1280, height: 1120 },
    { width: 390, height: 844 },
    { width: 1280, height: 1120, recovery: true },
  ]) {
    const url =
        "http://127.0.0.1:" +
        server.address().port +
        "/index.html?qa=" +
        size.width +
        (size.recovery ? "&recovery=1" : ""),
      target = await createPage(browser.debugUrl, url);
    const result = await readPageResult(target.webSocketDebuggerUrl, {
      ...size,
      url,
      focus: true,
      trustedInput: true,
      allowEmulation: true,
      screenshotDirectory: evidence,
      timeoutMs: 60000,
    });
    if (result.error) throw Error(result.error);
    results.push(result);
  }
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify({ ok: true, results }, null, 2) + "\n",
  );
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} catch(error){throw httpFailures.decorate(error)} finally {
  if (browser) await closeChrome(browser);
  await new Promise((resolve) => server.close(resolve));
}
