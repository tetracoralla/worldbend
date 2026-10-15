// Shared browser-side flows: execute unchanged in Chromium and other engines.

export async function cardRuntimeChecks() {
  let checks = 0;
  const ok = (value, message) => {
    if (!value) throw Error(message);
    checks++;
  };
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const end = Date.now() + 10000;
    while (!window.cardFixtureReady && Date.now() < end) await wait(30);
    const controller = await window.cardFixtureReady;
    const front = document.getElementById('front');
    const back = document.getElementById('back');
    const stage = document.getElementById('stage');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
    const expectedPointer = new URL(location.href).searchParams.get('pointer');
    if (expectedPointer) ok(finePointer.matches === (expectedPointer === 'fine'),
      'native QA pointer device did not establish its prerequisite: '+JSON.stringify({expectedPointer,fine:finePointer.matches,hover:matchMedia('(hover: hover)').matches,coarse:matchMedia('(pointer: coarse)').matches}));
    await frames();

    ok(
      front.style.transform.includes('perspective(1100px)') && front.style.transform.includes('rotateZ(0deg)'),
      'applied transform is not the documented pose order',
    );
    // Firefox includes the zero z coordinate in the inline CSS serialization.
    // Verify the computed origin that actually governs the projection.
    ok(getComputedStyle(front).transformOrigin.split(' ').every(value => parseFloat(value) === 0), 'pivot origin missing');
    ok(front.style.backfaceVisibility === 'hidden' && back.style.backfaceVisibility === 'hidden', 'two-face hiding missing');
    ok(back.style.transform.includes('rotateY(180deg)'), 'authored back layer is not pre-rotated a half turn');
    ok(document.documentElement.scrollWidth<=innerWidth, 'card example overflows the viewport');
    front.focus();
    ok(document.activeElement===front, 'the advertised keyboard surface cannot receive focus');
    const keyboardBaseline=controller.getState().revolutions;
    front.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    ok(reduced.matches ? controller.getState().revolutions===keyboardBaseline+1 : controller.getState().actionActive,
      'the focused card did not accept keyboard activation');
    await wait(800);

    // Pointer tilt follows the declared envelope through the core sampler.
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: stage.getBoundingClientRect().left + stage.clientWidth - 2, clientY: stage.getBoundingClientRect().top + 2, pointerType:'mouse' }));
    await wait(400);
    await frames();
    const pointerState=controller.getState();
    ok(reduced.matches || !finePointer.matches ? pointerState.pointer === undefined :
      pointerState.pointer !== undefined && pointerState.pointer.x > .9 && pointerState.tiltY > 10,
      'pointer response did not respect device/motion preference: '+JSON.stringify({fine:finePointer.matches,reduced:reduced.matches,state:pointerState,style:front.style.transform}));
    stage.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await wait(900);
    await frames();
    ok(!front.style.transform.includes('rotateY(1'), 'tilt did not settle back after leave');

    // One triggered turn runs the rig easing; repeated activation never queues.
    const actionDuration = window.cardRig.action.durationMs ?? 720;
    const singleStart = performance.now();
    controller.activate();
    if (!reduced.matches) ok(controller.activate() === false, 'activation during an action queued a second turn');
    await wait(300);
    await frames();
    // A throttled page (for example an occluded Safari window) can let the
    // wall clock run past the rig duration before frames resume; the
    // mid-action state is only decidable inside the action window.
    ok(performance.now() - singleStart >= actionDuration - 100 ||
      controller.getState().actionActive === !reduced.matches,
      'mid-duration action did not respect the motion preference');
    await wait(600);
    ok(!controller.getState().actionActive, 'action did not complete by its duration');
    ok(Math.abs(controller.getState().turnAngle % 360) < 1e-6, 'completed turn angle is not a whole revolution');

    // Business clicks keep firing alongside the effect. In this demo the
    // card content itself also activates the turn through bubbling; both
    // outcomes must coexist on the same element.
    const before = window.cardClicks;
    document.getElementById('business').click();
    front.click();
    ok(window.cardClicks === before + 2, 'business clicks on the card were swallowed');
    ok(reduced.matches ? controller.getState().revolutions > 1 : controller.getState().actionActive,
      'content click did not reach the surface activation');
    await wait(1000);
    ok(!controller.getState().actionActive && Math.abs(controller.getState().turnAngle % 360) < 1e-6,
      'bubbled activation did not complete');

    // Two revolutions remain distinguishable while sampling the turn, and a
    // rendered action angle wraps while reported revolutions keep accumulating.
    await controller.update({
      ...window.cardRig,
      action: { ...window.cardRig.action, turns: 2 },
    });
    const twoTurnBaseline=controller.getState().turnAngle;
    const twoTurnStart=performance.now();
    controller.activate();
    ok(reduced.matches ? !controller.getState().actionActive : controller.getState().actionActive,
      'two-revolution action did not respect the motion preference');
    // Sample mid-duration: the two-revolution turn passes far beyond the
    // one-revolution envelope while the action is still running.
    await wait(360);
    const midTurn = controller.getState();
    // As above, a throttled page may already be past the action window here.
    ok(performance.now() - twoTurnStart >= actionDuration - 100 ||
      midTurn.actionActive === !reduced.matches,
      'two-revolution progress did not respect the motion preference');
    ok(midTurn.turnAngle-twoTurnBaseline > 360, `two-turn sampling did not pass the first revolution: ${JSON.stringify(midTurn)}`);
    await wait(900);
    const settled = controller.getState();
    ok(Math.abs(settled.turnAngle % 360) < 1e-6 && Math.abs(settled.turnAngle-twoTurnBaseline-720)<1e-6,
      `completed turns lost their count: ${JSON.stringify(settled)}`);
    ok(settled.face === 'front', 'completed turns did not return to the front face');
    // Repeated activation keeps working after many completed turns.
    for (let index = 0; index < 12; index += 1) {
      ok(controller.activate(), `activation stopped working after ${index} turns`);
      await wait(800);
    }

    // Resize keeps the authored perspective; only layout size changes.
    stage.style.width = 'min(380px,100%)';
    await wait(200);
    await frames();
    ok(front.style.transform.includes('perspective(1100px)'), 'resize lost the authored perspective');
    // A delivered revision cannot replace the receiving component's current
    // border box with the original authoring dimensions.
    const {projectCardPose} = await import('../dist/card.js');
    const revisedRig = {...window.cardRig, rest:{rotateX:15,rotateY:32}, tilt:{maxRotateX:0,maxRotateY:0}};
    ok(await controller.update(revisedRig), 'resized design revision rejected');
    // Responsive aspect ratios produce fractional border-box dimensions;
    // offsetWidth/Height round them and would test a different geometry.
    const measuredSize=await new Promise(resolve=>{
      const observer=new ResizeObserver(([entry])=>{
        const box=Array.isArray(entry.borderBoxSize)?entry.borderBoxSize[0]:entry.borderBoxSize;
        observer.disconnect();resolve({width:box.inlineSize,height:box.blockSize});
      });
      observer.observe(front,{box:'border-box'});
    });
    const revisedPose = await projectCardPose({rig:{...revisedRig,elementSize:measuredSize}});
    const expectedStyle = document.createElement('div'); expectedStyle.style.transform = revisedPose.rigidCss;
    ok(front.style.transform===expectedStyle.style.transform, 'design revision replaced the receiving layout size');

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const extremeRig={...window.cardRig,rest:{rotateY:3599},tilt:{maxRotateX:0,maxRotateY:14,smoothingMs:0}};
      ok(await controller.update(extremeRig), 'legal cumulative resting angle rejected');
      const box=stage.getBoundingClientRect();
      const edgeEvent=new PointerEvent('pointermove',{bubbles:true,clientX:box.right,clientY:box.top+box.height/2,pointerType:'mouse'});
      const runtimeErrors=[];const previousConsoleError=console.error;
      console.error=(...args)=>{runtimeErrors.push(args.map(v=>v instanceof Error?v.message:String(v)).join(' '));previousConsoleError.apply(console,args);};
      try{
        stage.dispatchEvent(edgeEvent);await frames();await frames();
        const fourFramePassed=finePointer.matches ? front.style.transform.includes('rotateY(13deg)') && controller.getState().pointer?.x === 1 :
          front.style.transform.includes('rotateY(3599deg)') && controller.getState().pointer === undefined && controller.getState().tiltY === 0;
        const atFourFrames={style:front.style.transform,state:controller.getState(),box:{left:box.left,right:box.right,top:box.top,width:box.width,height:box.height},
          event:{clientX:edgeEvent.clientX,clientY:edgeEvent.clientY,pointerType:edgeEvent.pointerType},runtimeErrors,
          finePointer:matchMedia('(hover: hover) and (pointer: fine)').matches,hidden:document.hidden};
        const late=[];
        if(!fourFramePassed){await wait(100);late.push({afterMs:100,style:front.style.transform,state:controller.getState()});
          await wait(500);late.push({afterMs:600,style:front.style.transform,state:controller.getState()});}
        // Late diagnostics never convert the original four-RAF failure to PASS.
        ok(fourFramePassed,'live tilt froze when it crossed the static view domain: '+JSON.stringify({atFourFrames,late}));
      }finally{console.error=previousConsoleError;}
      stage.dispatchEvent(new PointerEvent('pointerleave',{bubbles:true}));
    }

    // Reduced motion: pointer input stops, activation reaches the final state.
    if (reduced.matches) {
      stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0 }));
      await wait(200);
      ok(!front.style.transform.includes('rotateY(1'), 'reduced motion still tilts with the pointer');
    }

    // Disposal returns the caller's own styles and both layers.
    controller.dispose();
    ok(front.style.transform === '', 'disposal did not restore the front layer transform');
    ok(front.style.backfaceVisibility === '' && back.style.backfaceVisibility === '', 'disposal left face visibility pinned');
    ok(back.style.transform === '', 'disposal did not restore the back layer transform');

    // Browser point positions must match the core with independent origins,
    // combined rotations, translation/depth, and both face orientations.
    for (const angles of [[22,31,12],[35,173,-19],[90,0,0]]) {
      const rig = {...window.cardRig, elementSize:{width:320,height:200}, geometry:{perspective:900,pivot:{x:.23,y:.74},perspectiveOrigin:{x:.8,y:.16}}};
      const pose = await projectCardPose({rig,view:{rotateX:angles[0],rotateY:angles[1],rotateZ:angles[2],depth:30,translate:{x:19,y:-7}}});
      const plane = document.createElement('div');
      plane.style.cssText = `position:fixed;left:0;top:0;width:320px;height:200px;transform-origin:0 0;transform:${pose.rigidCss}`;
      document.body.append(plane);
      for (const [key,x,y] of [['tl',0,0],['tr',320,0],['br',320,200],['bl',0,200]]) {
        const marker=document.createElement('i');marker.style.cssText=`position:absolute;left:${x}px;top:${y}px;width:0;height:0`;plane.append(marker);
        const actual=marker.getBoundingClientRect(), expected=pose.quad[key];
        ok(Math.abs(actual.x-expected.x)<.01 && Math.abs(actual.y-expected.y)<.01, `native/core projection differs at ${key}: ${actual.x},${actual.y} versus ${expected.x},${expected.y}`);
      }
      plane.remove();
    }
    // The shared transform renderer now requests multisampled geometry AA.
    const { TransformWebGLRenderer } = await import('../dist/index.js');
    const canvas=document.createElement('canvas');
    const getContext=canvas.getContext.bind(canvas);
    let antialiasRequested;
    canvas.getContext=(kind,options)=>{
      if(kind==='webgl2')antialiasRequested=options?.antialias;
      return getContext(kind,options);
    };
    const renderer = new TransformWebGLRenderer(canvas);
    ok(typeof renderer.antialiasActive === 'boolean', 'antialias availability is not reported');
    ok(antialiasRequested === true, 'geometry antialiasing was not requested');
    renderer.dispose();
    window.__WORLDBEND_PARITY__ = { checks, reducedMotion: reduced.matches };
  } catch (error) {
    window.__WORLDBEND_PARITY__ = { checks, error: `${String(error.message??error)}\n${error.stack??''}` };
  }
}

export async function cardReceivingChecks() {
  let checks = 0;
  const ok = (value, message) => {
    if (!value) throw Error(message);
    checks++;
  };
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    const end = Date.now() + 10000;
    while (!window.__receivingReady && Date.now() < end) await wait(30);
    const delivered = await window.__receivingReady;
    ok(!!delivered && delivered.schema === 'worldbend.card', 'the receiving app did not load the delivered artifact');
    const card = document.getElementById('card');
    const stage = document.getElementById('stage');
    const receiving = window.__receiving;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    await frames();
    ok(document.documentElement.scrollWidth<=innerWidth, `initial receiving layout overflows the viewport: ${JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll('main,.stage,.panel')].map(e=>({name:e.className||e.tagName,x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width}))})}`);

    // The effect drives the developer's own component without owning it.
    ok(card.style.transform.includes('perspective(950px)')&&!document.getElementById('flip').disabled&&!document.getElementById('revise').disabled,
      'delivered rig did not reach a usable receiving card');
    ok(document.getElementById('cta').dataset.worldbend === undefined, 'the binding marked up the business control');

    // Business clicks and the spatial effect coexist on the same card.
    const signupsBefore = Number(document.getElementById('signups').textContent);
    document.getElementById('cta').click();
    ok(Number(document.getElementById('signups').textContent) === signupsBefore + 1, 'business CTA was swallowed by the effect');

    // The developer-owned trigger activates the delivered turn.
    document.getElementById('flip').click();
    ok(reduced ? receiving.controller.getState().revolutions===1 : receiving.controller.getState().actionActive,
      'developer flip trigger did not reach the delivered turn');
    await wait(800);
    ok(!receiving.controller.getState().actionActive, 'delivered turn did not complete');

    // Pointer tilt follows the delivered envelope on the receiving surface.
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: stage.getBoundingClientRect().right - 2, clientY: stage.getBoundingClientRect().top + 2 }));
    await wait(350);
    await frames();
    ok(reduced ? !card.style.transform.includes('rotateY(1') : card.style.transform.includes('rotateY(1'),
      'pointer tilt ignored the delivered envelope or motion preference');
    stage.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await wait(900);

    // Keyboard activation reaches the card through the focusable component.
    card.focus();
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    ok(reduced ? receiving.controller.getState().revolutions===2 : receiving.controller.getState().actionActive,
      'keyboard activation did not reach the delivered action');
    await wait(800);

    // A source change replaces the project's own content; the behavior keeps
    // driving it without any rebinding or artifact re-fetch.
    const beforeRevision = receiving.currentRig;
    document.getElementById('swap-content').click();
    ok(card.dataset.theme === 'summer', 'campaign content swap failed');
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: stage.getBoundingClientRect().right - 2, clientY: stage.getBoundingClientRect().top + 2 }));
    await wait(350);
    await frames();
    ok(reduced ? !card.style.transform.includes('rotateY(1') : card.style.transform.includes('rotateY(1'),
      'source change dropped the delivered behavior or motion preference');
    stage.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    await wait(900);

    // The later design revision arrives as a new artifact and updates the
    // owned behavior in place; the handlers and content survive untouched.
    document.getElementById('revise').click();
    await wait(200);
    const revised = receiving.currentRig;
    ok(revised !== beforeRevision && revised.action.turns === 2 && revised.action.direction === -1,
      'revision artifact was not applied');
    const turnBaseline = receiving.controller.getState().turnAngle;
    document.getElementById('flip').click();
    ok(reduced ? receiving.controller.getState().turnAngle-turnBaseline===-720 : receiving.controller.getState().actionActive,
      'revised action did not reach the two-turn state');
    await wait(500);
    const midTurn = receiving.controller.getState();
    ok(midTurn.turnAngle - turnBaseline < -80, `revised two-turn direction not in effect: ${JSON.stringify(midTurn)}`);
    await wait(1000);
    ok(!receiving.controller.getState().actionActive, 'revised action did not complete');
    document.getElementById('cta').click();
    ok(Number(document.getElementById('signups').textContent) === signupsBefore + 2, 'business CTA lost after the revision');

    // Resize keeps the delivered perspective on the receiving layout.
    const resize = new Event('resize');
    window.dispatchEvent(resize);
    stage.style.width = 'min(300px, 100%)';
    await wait(250);
    await frames();
    ok(card.style.transform.includes('perspective(950px)'), 'resize lost the delivered perspective');

    // Teardown restores the project's own styles; reattachment rebuilds from
    // the same artifact alone.
    document.getElementById('detach').click();
    await wait(150);
    ok(card.style.transform === ''&&document.getElementById('flip').disabled&&document.getElementById('revise').disabled,
      'detach did not restore the project styles and disable unavailable actions');
    document.getElementById('reattach').click();
    await wait(300);
    ok(window.__receiving && window.__receiving.controller && card.style.transform.includes('perspective(950px)'),
      'reattach did not rebuild the binding from the artifact');

    // Reattaching directly is a visible, enabled route. It must not leave
    // old status-paint loops running against the newest controller.
    for (let i=0;i<3;i++) { document.getElementById('reattach').click(); await wait(150); }
    let paints=0, ticks=0;
    const paint=window.__receiving.paint;
    window.__receiving.paint=()=>{paints++;paint();};
    await new Promise(resolve=>{
      const count=()=>{ticks++;if(ticks<12)requestAnimationFrame(count);else resolve();};
      requestAnimationFrame(count);
    });
    window.__receiving.paint=paint;
    ok(paints<=ticks+1, `reattachment accumulated status-paint loops: ${paints} paints over ${ticks} frames`);

    const ink=document.createElement('canvas').getContext('2d');
    ink.fillStyle=getComputedStyle(document.getElementById('flip')).color;
    ink.fillRect(0,0,1,1);
    const rgba=ink.getImageData(0,0,1,1).data;
    ok(Math.max(...rgba.slice(0,3))<128, 'light flip button has unreadable light text');
    ok(card.querySelector('footer').offsetTop+card.querySelector('footer').offsetHeight<=card.clientHeight,
      'receiving controls overflow the resized card');
    ok(document.documentElement.scrollWidth<=innerWidth, 'receiving layout overflows the viewport');

    // A delayed receipt cannot update a binding created after detachment.
    const fetchArtifact=window.fetch;
    let releaseRevision;
    window.fetch=(...args)=>String(args[0]).includes('card-rig.v2.json')
      ?new Promise(resolve=>{releaseRevision=resolve;}) :fetchArtifact(...args);
    try {
      document.getElementById('revise').click();
      ok(!!releaseRevision,'revision receipt did not start');
      document.getElementById('detach').click();
      document.getElementById('reattach').click();await wait(200);
      const retained=window.__receiving.currentRig;
      releaseRevision(new Response(JSON.stringify({schema:'worldbend.card-delivery',version:'0.1',
        rig:{...retained,geometry:{...retained.geometry,perspective:1600}}})));
      await wait(100);await frames();
      ok(window.__receiving.currentRig===retained&&card.style.transform.includes('perspective(950px)'),
        'abandoned receipt changed the newly attached component');
      window.fetch=(...args)=>String(args[0]).includes('card-rig.v2.json')
        ?Promise.reject(new Error('Design revision unavailable; try again.')):fetchArtifact(...args);
      document.getElementById('revise').click();await wait(100);await frames();
      ok(document.getElementById('status').textContent.includes('Design revision unavailable')&&window.__receiving.currentRig===retained,
        'failed receipt hid recovery feedback or replaced accepted behavior');
    } finally {window.fetch=fetchArtifact;}
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    ok(!window.__receiving.controller,'page exit retained the old binding');
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    await wait(200);await window.__receiving.controller?.ready;
    ok(card.style.transform.includes('perspective(950px)')&&window.__receiving.controller,
      'cached page return did not resume the accepted effect');
    document.getElementById('detach').click();
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
    window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
    await wait(100);
    ok(!window.__receiving.controller&&card.style.transform==='',
      'cached page return undid explicit user detachment');
    document.getElementById('reattach').click();await wait(200);
    ok(window.__receiving.controller&&card.style.transform.includes('perspective(950px)'),
      'explicitly detached page could not reattach after a return');
    window.__WORLDBEND_PARITY__ = { checks };
  } catch (error) {
    window.__WORLDBEND_PARITY__ = { checks, error: `${String(error.message??error)}\n${error.stack??''}` };
  }
}

export async function cardReceivingStartupChecks() {
  let checks=0;
  const ok=(value,message)=>{if(!value)throw Error(message);checks++;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const errors=[];
  const reject=event=>errors.push(String(event.reason));
  addEventListener('unhandledrejection',reject);
  try {
    const end=Date.now()+10000;
    while(!window.__receivingReady&&Date.now()<end)await wait(30);
    ok(await window.__receivingReady===undefined,'failed startup returned an accepted rig');
    await wait(100);
    ok(document.getElementById('status').textContent.includes('Initial artifact unavailable')&&document.getElementById('flip').disabled&&document.getElementById('revise').disabled,
      'failed startup did not explain the missing artifact');
    document.getElementById('reattach').click();
    while(!window.__receiving?.controller&&Date.now()<end)await wait(30);
    await window.__receiving?.controller?.ready;
    ok(document.getElementById('card').style.transform.includes('perspective(950px)'),
      'retry did not recover the initial artifact');
    document.getElementById('cta').click();
    ok(document.getElementById('signups').textContent==='1','recovered card lost business handlers');
    ok(errors.length===0,'failed startup leaked an unhandled rejection: '+errors.join('; '));
    window.__WORLDBEND_PARITY__={checks};
  }catch(error){window.__WORLDBEND_PARITY__={checks,error:`${String(error.message??error)}\n${error.stack??''}`};}
  finally{removeEventListener('unhandledrejection',reject);}
}

export function failInitialCardReceipt() {
  const fetchArtifact=window.fetch;
  let first=true;
  window.fetch=(...args)=>{
    if(first&&String(args[0]).includes('card-rig.v1.json')) {
      first=false;return Promise.reject(new Error('Initial artifact unavailable; reattach to try again.'));
    }
    return fetchArtifact(...args);
  };
}
