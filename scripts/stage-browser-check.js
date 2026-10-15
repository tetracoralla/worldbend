// Run against the source preview or the installed SDK's examples/stage.html.
// The caller supplies a real Playwright page and an optional evidence directory.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
export async function checkStage(page,url,evidence){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.stageStudy?.getPlans().length===2);
  const doc=await page.evaluate(()=>window.stageStudy.exportDocument());
  assert.equal(doc.choice,'host-offsets');assert.equal(doc.candidates.length,2);
  for(const pointerX of [-1,.5,1]){
    await page.evaluate(state=>window.stageStudy.update(state),{...doc.state,pointerX,pointerY:-.7});
    const boxes=await page.evaluate(()=>['host','recipe'].map(id=>[...document.querySelectorAll(`#${id} .scene-layer`)].map(e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};})));
    for(let i=0;i<3;i++)for(const axis of ['width','height'])assert(Math.abs(boxes[0][i][axis]-boxes[1][i][axis])<.05);
    const offsets=await page.evaluate(()=>['host','recipe'].map(id=>[...document.querySelectorAll(`#${id} .scene-layer`)].map(e=>{const b=e.getBoundingClientRect(),r=e.parentElement.getBoundingClientRect();return{x:b.x-r.x,y:b.y-r.y};})));
    for(let i=0;i<3;i++)for(const axis of ['x','y'])assert(Math.abs(offsets[0][i][axis]-offsets[1][i][axis])<.05,'Host and recipe must use the same displacement');
  }
  if(evidence)await page.screenshot({path:evidence+'/stage-desktop.png',fullPage:true});
  await page.locator('#reset').click();
  const box=await page.locator('#host').boundingBox(),center={x:box.x+box.width*.5,y:box.y+box.height*.6};
  await page.mouse.click(center.x,center.y);
  assert.deepEqual(await page.evaluate(()=>window.stageStudy.getCounts()),{taps:1,shakes:0});
  await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+90,center.y-20,{steps:8});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.stageStudy.getCounts()),{taps:1,shakes:1});
  await page.waitForFunction(()=>Math.abs(window.stageStudy.getPlans()[0].state.pointerX)<.0001);
  await page.mouse.move(center.x,center.y);await page.mouse.down();await page.mouse.move(center.x+50,center.y,{steps:3});
  await page.locator('#host').dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
  assert.deepEqual(await page.evaluate(()=>window.stageStudy.getCounts()),{taps:1,shakes:1});
  await page.locator('#recipe').focus();await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.stageStudy.getPlans()[0].state.pointerX>0);
  const changedContent=await page.evaluate(async()=>{document.querySelector('#theme').click();return window.stageStudy.exportDocument();});
  assert.equal(changedContent.content.theme,1,'Immediate export must wait for the requested content replacement');
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('新素材'));
  await page.locator('[data-choice="layered-depth"]').click();
  await page.locator('#observation').fill('接触关系稳定；此处选配方便于后续交换和验证。');
  const expected=await page.evaluate(()=>window.stageStudy.exportDocument());
  const download=page.waitForEvent('download');await page.locator('#save').click();const local=await (await download).path();
  const saved=JSON.parse(await readFile(local,'utf8'));assert.deepEqual(saved,expected);
  await page.reload();await page.waitForFunction(()=>window.stageStudy?.getPlans().length===2);
  await page.locator('#file').setInputFiles(local);await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('指纹检查通过'));
  assert.deepEqual(await page.evaluate(()=>window.stageStudy.exportDocument()),saved);
  const changed=structuredClone(saved);changed.candidates[0].recipe.layers[0].offset.x+=1;
  const result=await page.evaluate(async v=>{try{await window.stageStudy.loadDocument(v);return false;}catch{return true;}},changed);assert(result);
  assert.deepEqual(await page.evaluate(()=>window.stageStudy.exportDocument()),saved,'Invalid replay must preserve current comparison');
  const custom=await page.evaluate(async v=>{
    const {planEffect}=await import('./stage-study.js').then(()=>import('../dist/effects.js'));
    v.candidates[0].recipe.layers[0].offset.x+=2;
    v.candidates[0].fingerprint=(await planEffect({recipe:v.candidates[0].recipe,state:v.state})).fingerprint;
    await window.stageStudy.loadDocument(v);return window.stageStudy.exportDocument();
  },saved);
  assert.equal(custom.candidates[0].recipe.layers[0].offset.x,saved.candidates[0].recipe.layers[0].offset.x+2);
  assert(await page.locator('#recipe').locator('..').getByText('Worldbend 自定义配方').isVisible());
  await page.evaluate(v=>window.stageStudy.loadDocument(v),saved);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>window.stageStudy.getPlans().every(p=>p.state.pointerX===0));
  const transforms=await page.locator('#host .scene-layer').evaluateAll(nodes=>nodes.map(n=>n.style.transform));assert(transforms.every(t=>t==='translate(0px, 0px)'));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>document.querySelector('#host').clientWidth<400);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(evidence)await page.screenshot({path:evidence+'/stage-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  return {result:'PASS',checks:['same-content displacement parity','real tap and drag separation','cancel without gameplay','settle and keyboard','source replacement and immediate export','real download and reload','fingerprint failure preserves comparison','system reduced motion','narrow layout']};
}
