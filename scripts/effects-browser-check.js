// Import and call with an isolated Playwright page on the served SDK effects example.
export default async function checkEffects(page, evidenceDirectory='.worldbend-work') {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const checks=[],metrics={};
  // Poll resolved documents explicitly: some automation hosts consider a
  // Promise-returning page predicate truthy before its async result settles.
  const waitDocument=async predicate=>{
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){if(predicate(await page.evaluate(()=>window.worldbendStudy.exportDocument())))return;await page.waitForTimeout(25);}
    throw Error('Document state did not settle');
  };
  await page.reload();
  await page.waitForFunction(()=>window.worldbendStudy?.getPlans().length===2);
  const read=()=>page.evaluate(()=>window.worldbendStudy.getPlans());
  const initial=await read();
  assert(initial[0].fingerprint!==initial[1].fingerprint,'Distinct expressions must have distinct recipes');
  await page.getByRole('searchbox',{name:'查找效果'}).fill('不存在的效果');
  await page.getByText('没有匹配的效果。',{exact:false}).waitFor();
  assert(JSON.stringify(await read())===JSON.stringify(initial),'Empty search must preserve current work');
  await page.getByRole('searchbox',{name:'查找效果'}).fill('');
  await page.getByRole('button',{name:'分层纵深，用于方案 A'}).waitFor();
  checks.push('discovery and empty-search recovery');

  await page.locator('#pointer-x').focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.pointerX===1));
  const moved=await read();
  assert(moved[0].fingerprint===initial[0].fingerprint,'State must not change recipe identity');
  const front=moved[0].frames[2].surface.plan.spec.destination.quad.tl.x;
  const back=moved[0].frames[0].surface.plan.spec.destination.quad.tl.x;
  assert(front>back && back>0,'Real DOM layers must have distinct depth response');
  const camera=moved[1];
  assert(camera.version==='2'&&camera.frames.every(frame=>frame.coverage?.viewportCovered),'Shared-camera built-in must cover the viewport');
  const cameraCenters=camera.frames.map(frame=>{const q=frame.surface.plan.spec.destination.quad;return frame.offset.x+(q.tl.x+q.tr.x+q.br.x+q.bl.x)/4;});
  assert((cameraCenters[0]-300)*(cameraCenters[2]-300)<0,'Near and far planes must separate across the focus plane');
  assert(Math.abs(camera.frames[2].surface.plan.css.matrix3d[3])>0,'Shared camera must produce projective deformation');
  await page.locator('#view-0 .native-touch').click();
  await page.getByText('原生按钮保持可用。').waitFor();
  const box=await page.locator('#view-0').boundingBox();
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.45);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.3,box.y+box.height*.6,{steps:6});await page.mouse.up();
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.pointerX<1&&p.state.pointerY>0));
  checks.push('keyboard, native button and synchronized real drag');

  for(const [title,kind]of [['整体倾斜','plane'],['共面画廊','strip'],['折面显现','window'],['悬浮磨砂窗','window']]){
    await page.getByRole('button',{name:title+'，用于方案 A'}).click();
    await page.waitForFunction(({title,kind})=>document.querySelector('.candidate .name').textContent===title && window.worldbendStudy.getPlans()[0].frames[0].surface.kind===kind,{title,kind});
    await page.locator('#progress').focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.progress===1));
    await page.locator('#progress').focus();await page.keyboard.press('Home');
    await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.progress===0));
  }
  checks.push('all six expressions, endpoints and reversal');
  await page.locator('#intensity').focus();await page.keyboard.press('Home');
  await waitDocument(value=>value.candidates[0].recipe.origin?.intensity===0);
  const zeroFrames=await page.evaluate(async()=>{
    const state=(await window.worldbendStudy.exportDocument()).state;
    await window.worldbendStudy.update({...state,pointerX:-1,pointerY:1,progress:0});
    const first=window.worldbendStudy.getPlans()[0].frames;
    await window.worldbendStudy.update({...state,pointerX:1,pointerY:-1,progress:1});
    return[first,window.worldbendStudy.getPlans()[0].frames];
  });
  assert(JSON.stringify(zeroFrames[0])===JSON.stringify(zeroFrames[1]),'Zero intensity must remove all frosted-lens motion');
  await page.locator('#intensity').fill('0.8');
  await waitDocument(value=>value.candidates[0].recipe.origin?.intensity===.8);
  checks.push('zero intensity removes every tracked response');
  const changedContent=await page.evaluate(async()=>{document.querySelector('#theme').click();return window.worldbendStudy.exportDocument();});
  assert(changedContent.content.theme===1,'Immediate export must wait for the requested content replacement');
  await page.getByRole('checkbox',{name:'静态查看'}).check();
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.reducedMotion&&p.state.progress===1&&p.state.pointerX===0));
  await page.getByRole('button',{name:'播放',exact:true}).click();
  await page.getByText('静态查看下不自动播放',{exact:false}).waitFor();
  await page.getByRole('checkbox',{name:'静态查看'}).uncheck();
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>!p.state.reducedMotion));
  checks.push('content replacement, immediate export and reduced-motion continuation');

  const saved=await page.evaluate(()=>window.worldbendStudy.exportDocument());
  const plans=await read();
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:/保存方案/}).click();const download=await downloadPromise;
  const savedPath=await download.path();assert(savedPath,'Actual save must yield a file');
  await page.reload();await page.waitForFunction(()=>window.worldbendStudy?.getPlans().length===2);
  const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开方案',exact:true}).click();
  await (await chooserPromise).setFiles(savedPath);
  await page.getByText('已打开；两份配方的指纹检查通过。').waitFor();
  assert(JSON.stringify(await read())===JSON.stringify(plans),'Reload/open must reproduce the saved plans');
  assert(JSON.stringify(await page.evaluate(()=>window.worldbendStudy.exportDocument()))===JSON.stringify(saved),'Study document must roundtrip');
  checks.push('actual file save, page reload, file open and exact replay');

  const bad=structuredClone(saved);bad.candidates[0].recipe.layers[0].offset.x+=1;
  const badDownload=page.waitForEvent('download');
  await page.evaluate(value=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='invalid-study.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},bad);
  const badPath=await (await badDownload).path();
  const badChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开方案',exact:true}).click();await (await badChooser).setFiles(badPath);
  await page.getByText('打开失败，当前方案已保留：',{exact:false}).waitFor();
  assert(JSON.stringify(await read())===JSON.stringify(plans),'Corrupt fingerprint must preserve both candidates');
  await page.locator('#pointer-y').focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.pointerY===1));
  checks.push('fingerprint rejection and continued interaction');

  // Deliberate overlapping operations challenge async replacement, not visual quality.
  await page.evaluate(()=>{
    document.querySelectorAll('.effect-option')[4].click();
    document.querySelectorAll('.effect-option')[1].click();
    document.querySelectorAll('.effect-option')[3].click();
  });
  await page.waitForFunction(()=>document.querySelector('.candidate .name').textContent==='共面画廊');
  assert((await read())[0].frames[0].surface.kind==='strip','Latest selection must win');
  checks.push('overlapping selection preserves latest request');

  // Supply a real PNG through the chooser, then replay it from its saved bytes.
  const imageUrl=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=320;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#203b43';ctx.fillRect(0,0,320,200);ctx.fillStyle='#f7b34a';ctx.fillRect(40,35,150,110);return c.toDataURL('image/png');});
  const imageChooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'使用图片',exact:true}).click();
  await (await imageChooser).setFiles({name:'study.png',mimeType:'image/png',buffer:Buffer.from(imageUrl.split(',')[1],'base64')});
  await page.getByText('已使用图片。',{exact:false}).waitFor();
  const imageDocument=await page.evaluate(()=>window.worldbendStudy.exportDocument());
  assert(imageDocument.content.kind==='image'&&imageDocument.content.digest.startsWith('sha256:'),'Image must be embedded with a digest');
  await page.reload();await page.waitForFunction(()=>window.worldbendStudy?.getPlans().length===2);
  assert(await page.evaluate(value=>window.worldbendStudy.loadDocument(value),imageDocument),'Embedded image must reopen after reload');
  assert(JSON.stringify(await page.evaluate(()=>window.worldbendStudy.exportDocument()))===JSON.stringify(imageDocument),'Image study must replay without external files');
  const invalidImage=structuredClone(imageDocument);invalidImage.content.digest='sha256:'+'0'.repeat(64);
  assert(await page.evaluate(async value=>{try{await window.worldbendStudy.loadDocument(value);return false;}catch{return true;}},invalidImage),'Tampered media must be rejected');
  assert(JSON.stringify(await page.evaluate(()=>window.worldbendStudy.exportDocument()))===JSON.stringify(imageDocument),'Media rejection must retain the current study');
  checks.push('image upload, portable media replay and digest rejection');

  const custom=structuredClone(imageDocument);
  custom.candidates[0].recipe.layers[0].offset.x+=12;
  custom.candidates[0].fingerprint=await page.evaluate(async value=>{const {planEffect}=await import('../dist/effects.js');return(await planEffect({recipe:value.candidates[0].recipe,state:value.state})).fingerprint;},custom);
  assert(await page.evaluate(value=>window.worldbendStudy.loadDocument(value),custom),'Explicit custom composition must load');
  assert(await page.locator('#intensity').isDisabled(),'Custom composition must not be silently replaced by preset editing');
  assert(JSON.stringify(await page.evaluate(()=>window.worldbendStudy.exportDocument()))===JSON.stringify(custom),'Custom layer data must survive roundtrip');
  await page.getByRole('button',{name:'换一组内容'}).click();
  await waitDocument(value=>value.content.kind==='builtin');
  assert((await read())[0].fingerprint===custom.candidates[0].fingerprint,'Changing artwork must preserve custom geometry');
  checks.push('custom recipe replay and continued content replacement');

  metrics.interactionMs=await page.evaluate(async()=>{
    const original=(await window.worldbendStudy.exportDocument()).state,times=[];
    for(let i=0;i<60;i++){const begin=performance.now();if(!await window.worldbendStudy.update({...original,pointerX:Math.sin(i/8)}))throw Error('Interaction failed: '+JSON.stringify({i,feedback:document.querySelector('#feedback').textContent,plans:window.worldbendStudy.getPlans().map(p=>p.state)}));times.push(performance.now()-begin);}
    await window.worldbendStudy.update(original);times.sort((a,b)=>a-b);
    return{median:times[30],p95:times[57],max:times.at(-1)};
  });
  checks.push('sustained synchronized interaction and exact state restoration');

  await page.evaluate(async()=>{
    const {attachEffect,createEffectRecipe}=await import('../dist/effects.js');
    const canvas=document.createElement('canvas');canvas.width=9;canvas.height=7;canvas.style.left='3px';document.body.append(canvas);
    const source=document.createElement('canvas');source.width=64;source.height=64;source.getContext('2d').fillRect(0,0,64,64);
    const errors=[];const recipe=await createEffectRecipe({effect:'hinged-reveal',version:'1',viewport:{width:64,height:64},intensity:.8});
    const binding=await attachEffect(recipe,{window:{element:canvas,source}},{progress:1,pointerX:0,pointerY:0,reducedMotion:false},{onError:e=>errors.push(e.code)});
    try {
      const extension=canvas.getContext('webgl2').getExtension('WEBGL_lose_context');if(!extension)throw Error('Context loss testing is unavailable');
      const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Timed out: '+name)),3000);canvas.addEventListener(name,()=>{clearTimeout(timer);resolve();},{once:true});});
      const lost=event('webglcontextlost');extension.loseContext();await lost;
      if(await binding.resume())throw Error('Resume must report lost context');
      // Let the injected loss finish its host event before requesting restoration.
      await new Promise(resolve=>setTimeout(resolve,50));
      const restored=event('webglcontextrestored');extension.restoreContext();await restored;
      if(!await binding.resume())throw Error('Restored context must resume');
      binding.pause();const pending=binding.resume();binding.dispose();
      if(await pending)throw Error('Disposed resume must not succeed');
      if(canvas.width!==9||canvas.height!==7||canvas.style.left!=='3px')throw Error('Late resume changed restored styles or backing size');
      if(errors.length!==1||errors[0]!=='E_RENDER')throw Error('Unexpected context recovery errors');
    } finally {binding.dispose();canvas.remove();}
  });
  checks.push('effect context recovery and disposal during asynchronous resume');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>p.state.reducedMotion));
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(p=>!p.state.reducedMotion));
  await page.setViewportSize({width:390,height:844});
  const mobileLayout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  assert(mobileLayout.scrollWidth<=mobileLayout.clientWidth,'Mobile viewport must not overflow horizontally: '+JSON.stringify(mobileLayout));
  await page.screenshot({path:evidenceDirectory+'/effects-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:980});
  await page.reload();await page.waitForFunction(()=>window.worldbendStudy?.getPlans().length===2);
  await page.evaluate(()=>window.worldbendStudy.update({progress:.35,pointerX:.75,pointerY:-.35,reducedMotion:false}));
  await page.waitForFunction(()=>window.worldbendStudy.getPlans().every(plan=>plan.state.pointerX===.75&&plan.state.pointerY===-.35));
  assert(!await page.locator('#feedback').evaluate(element=>element.classList.contains('error')),'Successful continuation must clear failure feedback');
  await page.screenshot({path:evidenceDirectory+'/effects-desktop.png',fullPage:true});
  checks.push('system motion preference and responsive layout');
  return {outcome:'PASS',checks,metrics,recipeFingerprints:saved.candidates.map(c=>c.fingerprint)};
}
