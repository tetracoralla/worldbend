// Import and call with an isolated Playwright-compatible page on the served SDK document example.
export default async function checkDocumentWork(page,evidenceDirectory='.worldbend-work') {
  const assert=(value,message)=>{if(!value)throw Error(message);};
  const checks=[];
  await page.setViewportSize({width:1440,height:940});
  await page.reload();
  await page.waitForFunction(()=>window.worldbendDocumentDemo?.getPlan()?.frames?.length===3);
  const initial=await page.evaluate(()=>({
    busy:document.querySelector('main')?.getAttribute('aria-busy'),
    enabled:[...document.querySelectorAll('#replace,#reset')].every(control=>!control.disabled),
    interactive:document.querySelector('#viewport')?.getAttribute('aria-disabled'),
    release:window.worldbendDocumentDemo.getRelease(),
    documentFingerprint:window.worldbendDocumentDemo.getDocumentFingerprint(),
    recipe:window.worldbendDocumentDemo.getRecipe(),
    plan:window.worldbendDocumentDemo.getPlan(),
  }));
  assert(initial.busy==='false'&&initial.enabled&&initial.interactive==='false','Document work must expose readiness before use');
  assert(initial.release===1&&initial.plan.frames.length===3&&initial.recipe.version==='3','Compiled delivery must attach the expected three-plane expression');
  checks.push('core-compiled document delivery reaches a ready three-plane Web work');

  await page.locator('#viewport').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>window.worldbendDocumentDemo.getPlan().state.pointerX===.12&&window.worldbendDocumentDemo.getPlan().frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0));
  assert(await page.evaluate(()=>window.worldbendDocumentDemo.getPlan().frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0)),'Keyboard movement must explicitly settle');
  checks.push('keyboard interaction updates and settles the durable work');

  // A real drag with alternating large and small deltas must accumulate the
  // pointer monotonically; a drag baseline that mixes coordinates with a
  // pre-update state visibly jitters the work instead.
  const drag=await page.evaluate(()=>{const rect=document.getElementById('viewport').getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2,height:rect.height};});
  await page.evaluate(()=>window.worldbendDocumentDemo.update({progress:1,pointerX:0,pointerY:0,reducedMotion:false}));
  await page.mouse.press(drag.x,drag.y);
  const deltas=[6,2,6,2,6,2],pointerY=[];
  let offset=0;
  for(const delta of deltas){
    offset+=delta;
    await page.mouse.move(drag.x,drag.y+offset);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
    pointerY.push(await page.evaluate(()=>window.worldbendDocumentDemo.getPlan().state.pointerY));
  }
  await page.mouse.release(drag.x,drag.y+offset);
  for(let index=1;index<pointerY.length;index++)assert(pointerY[index]>pointerY[index-1],`Drag pointer must accumulate monotonically; saw ${pointerY.map(value=>value.toFixed(5)).join(' -> ')}`);
  const expectedDrag=(6+2+6+2+6+2)*2/drag.height;
  const lastPointerY=pointerY[pointerY.length-1];
  assert(Math.abs(lastPointerY-expectedDrag)<1e-4,`Drag pointer must accumulate every event delta; expected ${expectedDrag.toFixed(5)}, saw ${lastPointerY.toFixed(5)}`);
  checks.push('variable-speed dragging accumulates the viewpoint without jitter');

  const beforeRecipe=JSON.stringify(initial.recipe);
  await page.getByRole('button',{name:'换成 Release 02'}).click();
  await page.waitForFunction(()=>window.worldbendDocumentDemo.getRelease()===2);
  const replaced=await page.evaluate(()=>({
    release:document.querySelector('#release')?.textContent,
    frameRelease:document.querySelector('#frame-release')?.textContent,
    button:document.querySelector('#replace')?.textContent,
    status:document.querySelector('#status')?.textContent,
    recipe:JSON.stringify(window.worldbendDocumentDemo.getRecipe()),
    documentFingerprint:window.worldbendDocumentDemo.getDocumentFingerprint(),
  }));
  assert(replaced.release==='Release 02'&&replaced.frameRelease==='R02'&&replaced.button==='换回 Release 01','Accepted source replacement must update every visible release cue');
  assert(replaced.status.includes('镜头、空间层级与交互没有重建')&&replaced.recipe===beforeRecipe,'Asset replacement must preserve the accepted expression');
  assert(replaced.documentFingerprint!==initial.documentFingerprint&&replaced.documentFingerprint?.startsWith('sha256:'),'The canonical document identity must advance with the source version');
  checks.push('one asset-ID replacement advances the document version without rebuilding spatial relationships');

  const rejected=await page.evaluate(async()=>{
    const before={release:window.worldbendDocumentDemo.getRelease(),recipe:JSON.stringify(window.worldbendDocumentDemo.getRecipe()),documentFingerprint:window.worldbendDocumentDemo.getDocumentFingerprint()};
    const accepted=await window.worldbendDocumentDemo.rejectInvalid();
    return{accepted,before,after:{release:window.worldbendDocumentDemo.getRelease(),recipe:JSON.stringify(window.worldbendDocumentDemo.getRecipe()),documentFingerprint:window.worldbendDocumentDemo.getDocumentFingerprint(),status:document.querySelector('#status')?.textContent}};
  });
  assert(rejected.accepted===false&&rejected.before.release===rejected.after.release&&rejected.before.recipe===rejected.after.recipe&&rejected.before.documentFingerprint===rejected.after.documentFingerprint,'Rejected media must preserve the accepted work');
  assert(rejected.after.status.includes('decoded pixels'),'Rejected media must provide a visible reason');
  assert(await page.evaluate(()=>window.worldbendDocumentDemo.replaceProduct(1)),'A valid retry must remain available after rejection');
  assert(await page.evaluate(()=>window.worldbendDocumentDemo.getDocumentFingerprint())===initial.documentFingerprint,'Returning to the first content version must restore its canonical document identity');
  checks.push('invalid replacement preserves the old result and a valid retry succeeds');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>window.worldbendDocumentDemo.getPlan().state.reducedMotion===true);
  assert(await page.evaluate(()=>window.worldbendDocumentDemo.replaceProduct(2)),'Source replacement must remain available under reduced motion');
  assert(await page.evaluate(()=>window.worldbendDocumentDemo.getPlan().frames.every(frame=>frame.appearance.motionBlur.screenBlurVector.x===0&&frame.appearance.motionBlur.screenBlurVector.y===0)),'Reduced motion must suppress temporal exposure');
  checks.push('reduced motion suppresses movement without disabling continued delivery');
  await page.emulateMedia({reducedMotion:'no-preference'});

  await page.setViewportSize({width:390,height:844});
  await page.reload();await page.waitForFunction(()=>window.worldbendDocumentDemo?.getPlan()?.frames?.length===3);
  const mobileLayout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  assert(mobileLayout.scrollWidth<=mobileLayout.clientWidth,'Long-title mobile work must not overflow horizontally: '+JSON.stringify(mobileLayout));
  await page.screenshot({path:evidenceDirectory+'/document-work-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:940});
  await page.reload();await page.waitForFunction(()=>window.worldbendDocumentDemo?.getPlan()?.frames?.length===3);
  await page.screenshot({path:evidenceDirectory+'/document-work-desktop.png',fullPage:true});
  assert((await page.locator('h1').textContent()).replace(/\s+/g,'').length>20,'The responsive fixture must retain its long product message');
  checks.push('long-title mobile and desktop work renders without overflow');

  const figmaContinuation=await page.evaluate(async()=>{
    const {attachFigmaEffectContinuation,createEffectRecipe,planEffect}=await import('../dist/effects.js');
    const initialState={progress:1,pointerX:.25,pointerY:-.2,reducedMotion:false};
    const recipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
    const recipeFingerprint=(await planEffect({recipe,state:initialState})).fingerprint;
    const sourceBindings=[
      {role:'background',assetId:'background',sourceNodeId:'48:5'},
      {role:'middle',assetId:'middle',sourceNodeId:'48:6'},
      {role:'foreground',assetId:'foreground',sourceNodeId:'48:7'},
    ];
    const documentBindings=sourceBindings.map(binding=>({role:'content',slotId:binding.role,assetId:binding.assetId}));
    const spatialDocument={schema:'worldbend.spatial-document',version:'0.1',assets:['background','foreground','middle'].map(id=>({id})),expressions:[{kind:'interactive',id:'figma-depth',recipe,bindings:documentBindings}]};
    const continuation={schema:'worldbend.figma-effect-continuation',version:'0.1',origin:{fileKey:'granted-file',pageId:'37:7',nodeId:'48:8',revision:2,expected:'current-state'},sourceBindings,expressionId:'figma-depth',initialState,document:spatialDocument,deliveryPlan:{schema:'worldbend.spatial-document-delivery-plan',version:'0.1',documentFingerprint:'sha256:'+'3'.repeat(64),deliveries:[{kind:'interactive',id:'figma-depth',recipe,recipeFingerprint,bindings:documentBindings}]},losses:['sourceMediaNotEmbedded','figmaPlacementNotTransferred']};
    const colored=(color)=>{const canvas=document.createElement('canvas');canvas.width=720;canvas.height=480;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,720,480);return canvas;};
    const original={background:colored('#10162f'),middle:colored('#ff0000'),foreground:colored('#f2b544')},replacement=colored('#00ff00');
    const elements={background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')};
    const errors=[];
    const binding=await attachFigmaEffectContinuation(continuation,{elements,assets:original},{preserveDrawingBuffer:true,onError:error=>errors.push(error.code||String(error))});
    const sample=()=>{const gl=elements.middle.getContext('webgl2'),pixel=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
    try{
      const before=sample();
      const accepted=await binding.replaceAsset('middle',replacement),after=sample();
      const invalid=document.createElement('canvas');invalid.width=0;invalid.height=0;
      const rejected=await binding.replaceAsset('middle',invalid),afterRejected=sample();
      const moved=await binding.update({progress:1,pointerX:-.45,pointerY:.3,reducedMotion:false});
      const reduced=await binding.update({progress:1,pointerX:.8,pointerY:-.8,reducedMotion:true});
      return{before,accepted,after,rejected,afterRejected,moved,reduced,state:binding.getPlan().state,errors};
    } finally {binding.dispose();}
  });
  assert(figmaContinuation.accepted&&figmaContinuation.before[0]>figmaContinuation.before[1]+100&&figmaContinuation.after[1]>figmaContinuation.after[0]+100,`Projected Figma source replacement must render without re-placement: ${JSON.stringify(figmaContinuation)}`);
  assert(!figmaContinuation.rejected&&JSON.stringify(figmaContinuation.afterRejected)===JSON.stringify(figmaContinuation.after)&&figmaContinuation.errors.includes('E_UNSUPPORTED_MEDIA'),`Rejected projected media must preserve accepted pixels: ${JSON.stringify(figmaContinuation)}`);
  assert(figmaContinuation.moved&&figmaContinuation.reduced&&figmaContinuation.state.reducedMotion===true,'Projected reference state must continue through pointer and reduced-motion updates');
  checks.push('projected Figma Depth receipt binds, replaces and recovers on the real Web renderer without layer re-placement');

  const mediaBundle=await page.evaluate(async()=>{
    const {attachSpatialInteractiveMediaBundle,createEffectRecipe,planEffect}=await import('../dist/effects.js');
    const state={progress:1,pointerX:.25,pointerY:-.2,reducedMotion:false};
    const recipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
    const recipeFingerprint=(await planEffect({recipe,state})).fingerprint;
    const bindings=[
      {role:'content',slotId:'background',assetId:'background'},
      {role:'content',slotId:'middle',assetId:'middle'},
      {role:'content',slotId:'foreground',assetId:'foreground'},
    ];
    const media=[
      {assetId:'background',format:'png',sha256:'a'.repeat(64),encodedBytes:1024,width:720,height:480},
      {assetId:'foreground',format:'png',sha256:'c'.repeat(64),encodedBytes:1024,width:720,height:480},
      {assetId:'middle',format:'png',sha256:'b'.repeat(64),encodedBytes:1024,width:720,height:480},
    ];
    const bundle={
      schema:'worldbend.spatial-interactive-media-bundle',version:'0.1',fingerprint:'sha256:'+'4'.repeat(64),expressionId:'hero',initialState:state,media,
      document:{schema:'worldbend.spatial-document',version:'0.1',assets:media.map(item=>({id:item.assetId,contentVersion:'sha256:'+item.sha256})),expressions:[{kind:'interactive',id:'hero',recipe,bindings}]},
      deliveryPlan:{schema:'worldbend.spatial-document-delivery-plan',version:'0.1',documentFingerprint:'sha256:'+'5'.repeat(64),deliveries:[{kind:'interactive',id:'hero',recipe,recipeFingerprint,bindings}]},
    };
    const colored=(width,height,color)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return canvas;};
    const sources={background:colored(720,480,'#10162f'),middle:colored(720,480,'#ff0000'),foreground:colored(720,480,'#f2b544')};
    const elements={background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')};
    const calls=[],errors=[];
    const binding=await attachSpatialInteractiveMediaBundle(bundle,{elements,resolveAsset:item=>{calls.push(item.assetId);return sources[item.assetId];}},{preserveDrawingBuffer:true,onError:error=>errors.push(error.code||String(error))});
    const sample=()=>{const gl=elements.middle.getContext('webgl2'),pixel=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
    try{
      const before=sample(),replacement=colored(720,480,'#00ff00');
      const accepted=await binding.replaceAsset('middle',replacement),after=sample();
      const stale=structuredClone(bundle);stale.document.assets[1].contentVersion='sha256:'+'d'.repeat(64);
      let staleCalls=0,staleCode;
      try{await attachSpatialInteractiveMediaBundle(stale,{elements,resolveAsset:()=>{staleCalls++;return replacement;}});}catch(error){staleCode=error.code;}
      const mismatched=colored(600,400,'#0000ff');let mismatchCode;
      try{await attachSpatialInteractiveMediaBundle(bundle,{elements,resolveAsset:()=>mismatched});}catch(error){mismatchCode=error.code;}
      const afterRejected=sample(),moved=await binding.update({progress:1,pointerX:-.45,pointerY:.3,reducedMotion:false});
      return{before,accepted,after,afterRejected,moved,calls,staleCalls,staleCode,mismatchCode,errors};
    } finally {binding.dispose();}
  });
  assert(mediaBundle.accepted&&mediaBundle.before[0]>mediaBundle.before[1]+100&&mediaBundle.after[1]>mediaBundle.after[0]+100,`Core bundle must resolve and render its role-bound media: ${JSON.stringify(mediaBundle)}`);
  assert(JSON.stringify(mediaBundle.calls)===JSON.stringify(['background','foreground','middle'])&&mediaBundle.staleCalls===0&&mediaBundle.staleCode==='E_SCHEMA',`Bundle validation must precede media resolution: ${JSON.stringify(mediaBundle)}`);
  assert(mediaBundle.mismatchCode==='E_SCHEMA'&&JSON.stringify(mediaBundle.afterRejected)===JSON.stringify(mediaBundle.after)&&mediaBundle.moved&&mediaBundle.errors.length===0,`Rejected bundle media must preserve the accepted live renderer: ${JSON.stringify(mediaBundle)}`);
  checks.push('a content-addressed interactive bundle resolves once, renders, replaces and rejects drift without disturbing accepted Web state');

  const paired=await page.evaluate(async()=>{
    const {attachDocumentEffect,createEffectRecipe,planEffect}=await import('../dist/effects.js');
    const state={progress:1,pointerX:0,pointerY:0,reducedMotion:false};
    const recipe=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
    recipe.origin=null;
    recipe.layers[0].surface.depthMap={nearDistance:900,farDistance:1800};
    const recipeFingerprint=(await planEffect({recipe,state})).fingerprint;
    const delivery={schema:'worldbend.spatial-document-delivery-plan',version:'0.1',documentFingerprint:'sha256:'+'2'.repeat(64),deliveries:[{
      kind:'interactive',id:'paired-media',recipe,recipeFingerprint,bindings:[
        {role:'content',slotId:'background',assetId:'paired'},
        {role:'depthMap',slotId:'background',assetId:'paired'},
        {role:'content',slotId:'middle',assetId:'other'},
        {role:'content',slotId:'foreground',assetId:'other'},
      ],
    }]};
    const colored=(width,height,color)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return canvas;};
    const original=colored(720,480,'#ff0000'),replacement=colored(360,240,'#00ff00');
    const elements={background:document.createElement('canvas'),middle:document.createElement('canvas'),foreground:document.createElement('canvas')};
    const errors=[];
    const binding=await attachDocumentEffect(delivery,'paired-media',{elements,assets:{paired:original,other:original}},state,{preserveDrawingBuffer:true,onError:error=>errors.push(String(error))});
    const sample=()=>{const gl=elements.background.getContext('webgl2'),pixel=new Uint8Array(4);gl.readPixels(Math.floor(gl.drawingBufferWidth/2),Math.floor(gl.drawingBufferHeight/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
    try{const before=sample(),accepted=await binding.replaceAsset('paired',replacement),after=sample();return{before,accepted,after,errors};}
    finally{binding.dispose();}
  });
  assert(paired.accepted&&paired.before[0]>paired.before[1]+100&&paired.after[1]>paired.after[0]+100&&paired.errors.length===0,`Content and depth roles must resize together on a real renderer: ${JSON.stringify(paired)}`);
  checks.push('one asset can resize both content and depth-map roles on the real Web renderer');

  return{outcome:'PASS',checks,documentFingerprint:await page.evaluate(()=>window.worldbendDocumentDemo.getDocumentFingerprint())};
}
