// Import and call with an isolated Playwright page on the served SDK appearance example.
export default async function checkSpatialAppearance(page,evidenceDirectory='.task-notes') {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const checks=[],metrics={};
  await page.setViewportSize({width:1440,height:980});
  await page.reload();
  await page.waitForFunction(()=>window.worldbendAppearance?.getPlans().length===3);
  assert(await page.evaluate(()=>document.querySelector('main')?.getAttribute('aria-busy')==='false'&&[...document.querySelectorAll('#play,#pointer-x,#pointer-y,[data-focus],#reset')].every(control=>!control.disabled)&&[...document.querySelectorAll('.viewport')].every(view=>view.getAttribute('aria-disabled')==='false')),'The fixture must expose readiness and enable every interaction only after all candidates are accepted');
  checks.push('readiness is exposed before interaction becomes available');
  const read=()=>page.evaluate(()=>({
    plans:window.worldbendAppearance.getPlans(),
    recipes:window.worldbendAppearance.getRecipes(),
    state:window.worldbendAppearance.getState(),
  }));
  const initial=await read();
  assert(initial.plans.every(plan=>plan.version==='3'),'Every comparison must execute version 3');
  assert(initial.plans[0].frames.every(frame=>frame.appearance?.depthOfField?.blurRadius===0),'Clear baseline must keep zero depth blur');
  assert(initial.plans[1].frames.some(frame=>frame.appearance?.depthOfField?.blurRadius>0),'Depth comparison must contain visible blur');
  assert(initial.plans[1].frames[0].appearance.depthOfField.depthMap,'Depth comparison must plan the declared map');
  assert(initial.plans[2].frames.every(frame=>frame.appearance?.motionBlur),'Motion comparison must expose an explicit temporal plan');
  assert(initial.recipes[1].layers[0].surface.depthMap,'Only caller-authored depth metadata may request the bound map');
  checks.push('clear, depth-map and motion plans share version-3 camera geometry');

  await page.locator('#clear').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.worldbendAppearance.getState().pointerX===.12&&window.worldbendAppearance.getPlans().every(plan=>plan.state.pointerX===.12)&&window.worldbendAppearance.getPlans()[2].frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0));
  assert((await read()).plans[2].frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0),'Keyboard movement must explicitly settle');
  checks.push('keyboard input continues and settles motion');

  const moving=await page.evaluate(async()=>{
    const previous=window.worldbendAppearance.getState();
    const current={...previous,pointerX:-.92,pointerY:.48};
    await window.worldbendAppearance.update(current,previous,.016);
    return window.worldbendAppearance.getPlans()[2];
  });
  assert(moving.frames.some(frame=>Math.hypot(frame.appearance.motionBlur.screenBlurVector.x,frame.appearance.motionBlur.screenBlurVector.y)>1),'Explicit previous/current states must yield a visible trail');
  await page.screenshot({path:evidenceDirectory+'/appearance-motion.png',fullPage:true});
  await page.evaluate(()=>window.worldbendAppearance.settle());
  await page.waitForFunction(()=>window.worldbendAppearance.getPlans()[2].frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0));
  checks.push('motion uses explicit sample and returns to sharp after stopping');

  const focusRecovery=await page.evaluate(async()=>{
    const before={recipe:window.worldbendAppearance.getRecipes()[1],label:document.querySelector('#depth-focus').textContent,pressed:[...document.querySelectorAll('[data-focus]')].map(value=>value.getAttribute('aria-pressed'))};
    const accepted=await window.worldbendAppearance.setFocus(Number.NaN);
    return{accepted,before,after:{recipe:window.worldbendAppearance.getRecipes()[1],label:document.querySelector('#depth-focus').textContent,pressed:[...document.querySelectorAll('[data-focus]')].map(value=>value.getAttribute('aria-pressed')),enabled:[...document.querySelectorAll('[data-focus]')].every(value=>!value.disabled),status:document.querySelector('#status').textContent}};
  });
  assert(focusRecovery.accepted===false,'An invalid optical focus must be rejected');
  assert(JSON.stringify(focusRecovery.before.recipe)===JSON.stringify(focusRecovery.after.recipe)&&focusRecovery.before.label===focusRecovery.after.label&&JSON.stringify(focusRecovery.before.pressed)===JSON.stringify(focusRecovery.after.pressed),'A rejected optical focus must preserve the accepted picture, label and selection');
  assert(focusRecovery.after.enabled&&focusRecovery.after.status.includes('没有替换当前画面'),'Focus rejection must report recovery and allow another attempt');
  checks.push('rejected optical focus preserves the accepted result and remains retryable');

  await page.getByRole('button',{name:'前景'}).click();
  await page.waitForFunction(()=>window.worldbendAppearance.getRecipes()[1].appearance.depthOfField.focusDistance===650);
  const focused=await read();
  assert(focused.recipes.every(recipe=>recipe.camera.focusDistance===1000),'Optical focus must not change camera convergence');
  assert(focused.plans[1].frames.find(frame=>frame.id==='foreground').appearance.depthOfField.blurRadius===0,'Selected foreground must be sharp');
  assert(focused.plans[1].frames.find(frame=>frame.id==='middle').appearance.depthOfField.blurRadius>0,'Changing optical focus must affect another plane');
  assert(await page.locator('#depth-focus').textContent()==='前景对焦 · 显式深度图','Visible focus label must match the accepted recipe');
  checks.push('optical focus changes independently and reports the selected plane');

  const recovery=await page.evaluate(async()=>{
    const canvas=document.querySelector('#motion canvas[data-layer=foreground]');
    const gl=canvas.getContext('webgl2'),extension=gl.getExtension('WEBGL_lose_context');
    if(!extension)return{supported:false};
    extension.loseContext();await new Promise(resolve=>setTimeout(resolve,150));
    const lost={status:document.querySelector('#status').textContent,visibility:canvas.style.visibility};
    extension.restoreContext();await new Promise(resolve=>setTimeout(resolve,750));
    return{supported:true,lost,restored:{status:document.querySelector('#status').textContent,visibility:canvas.style.visibility,contextLost:gl.isContextLost()}};
  });
  assert(recovery.supported,'Browser must expose the WebGL context-loss test hook');
  assert(recovery.lost.visibility==='hidden'&&recovery.lost.status.includes('context lost'),'Lost content must be hidden and reported');
  assert(!recovery.restored.contextLost&&recovery.restored.visibility===''&&recovery.restored.status.includes('已恢复'),'Restoration must redraw and become visible');
  checks.push('WebGL context loss preserves and restores the accepted result');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>window.worldbendAppearance.getPlans().every(plan=>plan.state.reducedMotion));
  const reduced=await page.evaluate(async()=>{
    const previous={...window.worldbendAppearance.getState(),reducedMotion:false,pointerX:-1};
    const current={...previous,pointerX:1};
    await window.worldbendAppearance.update(current,previous,.016);
    return window.worldbendAppearance.getPlans()[2].frames.map(frame=>frame.appearance.motionBlur.screenBlurVector);
  });
  assert(reduced.every(vector=>vector.x===0&&vector.y===0),'Host motion preference must zero temporal appearance');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>window.worldbendAppearance.getPlans().every(plan=>!plan.state.reducedMotion));
  assert(await page.evaluate(()=>window.worldbendAppearance.getPlans()[2].frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0)),'Leaving reduced motion must not replay an old temporal sample');
  checks.push('system reduced-motion preference suppresses motion exposure');

  const guards=await page.evaluate(async()=>{
    const {createEffectRecipe,attachEffect}=await import('/dist/effects.js');
    const state={progress:1,pointerX:0,pointerY:0,reducedMotion:false},decoded=document.createElement('canvas');decoded.width=64;decoded.height=48;
    const makeSlots=(source,depthMap)=>{const slots={};for(const layer of recipe.layers){const canvas=document.createElement('canvas');canvas.width=77;canvas.height=77;slots[layer.id]={element:canvas,source};if(depthMap&&layer.id==='background')slots[layer.id].depthMap=depthMap;}return slots;};
    const recipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.82});
    recipe.origin=null;recipe.layers[0].surface.depthMap={nearDistance:900,farDistance:1800};
    const code=error=>error?.code??String(error);
    const mismatchDepth=document.createElement('canvas');mismatchDepth.width=32;mismatchDepth.height=48;
    const mismatchSlots=makeSlots(decoded,mismatchDepth);
    let mismatched;try{await attachEffect(recipe,mismatchSlots,state,{pixelRatio:1});}catch(error){mismatched=code(error);}
    const unchanged=recipe.layers.every(layer=>mismatchSlots[layer.id].element.width===77);
    const huge=document.createElement('canvas');huge.width=8193;huge.height=2;
    const plain=structuredClone(recipe);if(plain.layers[0].surface.kind!=='camera-plane')throw Error('wrong recipe');plain.layers[0].surface.depthMap=null;
    const oversizedSlots=makeSlots(decoded);oversizedSlots.background.source=huge;
    let oversized;try{await attachEffect(plain,oversizedSlots,state,{pixelRatio:1});}catch(error){oversized=code(error);}
    const oversizedUntouched=oversizedSlots.background.element.width===77;
    const retainedSlots=makeSlots(decoded),retained=await attachEffect(plain,retainedSlots,state,{pixelRatio:1});
    const invalidRebind={...retainedSlots,background:{...retainedSlots.background,source:huge}};
    let rebindError;try{await attachEffect(plain,invalidRebind,state,{pixelRatio:1});}catch(error){rebindError=code(error);}
    const retainedAfterRejection=await retained.update({...state,pointerX:.25});retained.dispose();
    const depth=document.createElement('canvas');depth.width=64;depth.height=48;
    const keptSlots=makeSlots(decoded,depth);
    const binding=await attachEffect(recipe,keptSlots,state,{pixelRatio:1});
    const drawn=keptSlots.background.element.width!==77&&keptSlots.middle.element.width!==77;
    binding.dispose();
    const restored=keptSlots.background.element.width===77&&keptSlots.middle.element.width===77;
    return{mismatched,unchanged,oversized,oversizedUntouched,rebindError,retainedAfterRejection,drawn,restored};
  });
  assert(guards.mismatched==='E_SCHEMA','Mismatched depth-map dimensions must reject before any element changes');
  assert(guards.unchanged&&guards.oversizedUntouched,'Rejected attachments must leave slot canvases untouched');
  assert(guards.oversized==='E_OUTPUT_LIMIT','Sources beyond the texture limit must reject with the resource error');
  assert(guards.rebindError==='E_OUTPUT_LIMIT'&&guards.retainedAfterRejection,'A rejected replacement must leave the prior binding usable');
  assert(guards.drawn&&guards.restored,'Disposal must release the drawing buffer and restore caller canvas sizes');
  checks.push('dimension parity, resource limits and disposal restore are enforced');

  const pixels=await page.evaluate(async()=>{
    const {createEffectRecipe,attachEffect}=await import('/dist/effects.js');
    const recipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:64,height:64},intensity:1});
    recipe.origin=null;recipe.appearance.motionBlur=null;
    recipe.appearance.depthOfField={focusDistance:1000,focusRange:50,maxBlurRadius:12};
    recipe.layers[0].surface.depthMap={nearDistance:1000,farDistance:1500};
    const source=document.createElement('canvas');source.width=77;source.height=77;
    const content=source.getContext('2d');
    for(let x=0;x<source.width;x++){content.fillStyle=Math.floor(x/4)%2?'white':'black';content.fillRect(x,0,1,source.height);}
    const depth=document.createElement('canvas');depth.width=source.width;depth.height=source.height;
    const map=depth.getContext('2d');map.fillStyle='black';map.fillRect(0,0,39,depth.height);map.fillStyle='white';map.fillRect(39,0,38,depth.height);
    const slots={};for(const layer of recipe.layers){const element=document.createElement('canvas');slots[layer.id]={element,source};if(layer.id==='background')slots[layer.id].depthMap=depth;}
    const binding=await attachEffect(recipe,slots,{progress:1,pointerX:0,pointerY:0,reducedMotion:false},{pixelRatio:1,preserveDrawingBuffer:true});
    const canvas=slots.background.element,gl=canvas.getContext('webgl2'),rgba=new Uint8Array(canvas.width*canvas.height*4);
    gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
    const y=Math.floor(canvas.height/2),sample=x=>{const offset=(y*canvas.width+x)*4;return{value:rgba[offset],alpha:rgba[offset+3]};};
    let sharp=0,sharpCount=0,blurred=0,blurredCount=0;
    for(let x=8;x<32;x++){sharp+=Math.abs(sample(x).value-sample(x-1).value);sharpCount++;}
    for(let x=46;x<70;x++){blurred+=Math.abs(sample(x).value-sample(x-1).value);blurredCount++;}
    const result={sharpContrast:sharp/sharpCount,blurredContrast:blurred/blurredCount,edgeAlpha:sample(canvas.width-1).alpha,insideAlpha:sample(57).alpha};
    binding.dispose();return result;
  });
  assert(pixels.sharpContrast>pixels.blurredContrast*4,'Black near-depth pixels must stay materially sharper than white far-depth pixels');
  assert(pixels.edgeAlpha<pixels.insideAlpha,'Blur sampling beyond the source must remain transparent instead of clamping edge color');
  checks.push('depth-map pixels control blur and outside samples remain transparent');

  metrics.interactionMs=await page.evaluate(async()=>{
    const start={progress:.35,pointerX:0,pointerY:0,reducedMotion:false},times=[];let previous=start;
    for(let i=0;i<40;i++){
      const current={...start,pointerX:Math.sin(i/6),pointerY:Math.cos(i/8)*.5},begin=performance.now();
      if(!await window.worldbendAppearance.update(current,previous,1/60))throw Error('Appearance update failed');
      times.push(performance.now()-begin);previous=current;
    }
    await window.worldbendAppearance.settle();times.sort((a,b)=>a-b);
    return{median:times[20],p95:times[38],max:times.at(-1)};
  });
  checks.push('sustained explicit temporal updates remain usable');

  await page.setViewportSize({width:390,height:844});
  await page.reload();await page.waitForFunction(()=>window.worldbendAppearance?.getPlans().length===3);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'Mobile viewport must not overflow horizontally');
  await page.screenshot({path:evidenceDirectory+'/appearance-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:980});
  await page.reload();await page.waitForFunction(()=>window.worldbendAppearance?.getPlans().length===3);
  await page.screenshot({path:evidenceDirectory+'/appearance-desktop.png',fullPage:true});
  checks.push('responsive mobile and desktop fixtures render without overflow');
  return{outcome:'PASS',checks,metrics,fingerprints:(await read()).plans.map(plan=>plan.fingerprint)};
}
