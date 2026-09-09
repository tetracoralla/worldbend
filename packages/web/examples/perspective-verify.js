import { attachPlanePose, attachPerspective, attachPerspectiveStrip, attachPointerTilt, projectPlanePose, initializeWorldbend, normalizedSpec } from '../dist/perspective.js';

const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function settled() { for (let i=0;i<4;i++) await frame(); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function markers(element) {
  return [[0,0],[1,0],[1,1],[0,1]].map(([x,y])=>{
    const point=document.createElement('i'); point.className='corner';
    point.style.cssText=`position:absolute;left:${x*100}%;top:${y*100}%;width:0;height:0;pointer-events:none`;
    element.append(point); return point;
  });
}
const positions = (points,host) => {const origin=host.getBoundingClientRect();return points.map(point=>{const p=point.getBoundingClientRect();return {x:p.x-origin.x,y:p.y-origin.y};});};
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const lineError = (a,b,p) => Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/distance(a,b);
const quadPoints = spec => ['tl','tr','br','bl'].map(name=>spec.destination.quad[name]);

/** Runs against real rendered elements; the native browser transform is an independent oracle. */
export async function verifyPerspective({ left,right,leftPlane,rightPlane,errors }) {
  const checks=[]; const samples=[]; const cleanups=[];
  const record=(name,detail)=>checks.push({name,ok:true,...detail});
  await initializeWorldbend(); await settled();
  const startErrors=errors.length;
  const scratch=document.createElement('div'); scratch.className='probe-space';document.body.append(scratch);
  cleanups.push(()=>scratch.remove());
  try {
    let maximumCornerError=0;
    const cases=[
      {perspective:800},
      {perspective:800,rotateX:12,rotateY:-20,rotateZ:4},
      {perspective:1300,rotateX:-32,rotateY:28,rotateZ:-16,depth:45,translate:{x:18,y:-21}},
      {perspective:900,rotateX:20,rotateY:-30,pivot:{x:.15,y:.8},perspectiveOrigin:{x:.75,y:.2}},
      {perspective:1900,rotateX:38,rotateY:34,rotateZ:11,depth:-60,translate:{x:-8,y:12},pivot:{x:0,y:1},perspectiveOrigin:{x:1,y:0}},
    ];
    for(const pose of cases) {
      const size={width:287.5,height:163.25};
      const nativeHost=document.createElement('div'), wbHost=document.createElement('div');
      for(const host of [nativeHost,wbHost]){host.style.cssText=`position:absolute;left:17.25px;top:13.5px;width:${size.width}px;height:${size.height}px`;scratch.append(host);}
      const native=document.createElement('div'), wb=document.createElement('div');
      for(const el of [native,wb]) el.style.cssText='position:absolute;left:0;top:0;width:100%;height:100%';
      nativeHost.append(native);wbHost.append(wb);
      const a=markers(native),b=markers(wb),pivot=pose.pivot??{x:.5,y:.5},origin=pose.perspectiveOrigin??{x:.5,y:.5};
      nativeHost.style.perspective=`${pose.perspective}px`;
      nativeHost.style.perspectiveOrigin=`${origin.x*100}% ${origin.y*100}%`;
      native.style.transformOrigin=`${pivot.x*100}% ${pivot.y*100}%`;
      native.style.transform=`translate3d(${pose.translate?.x??0}px,${pose.translate?.y??0}px,${pose.depth??0}px) rotateZ(${pose.rotateZ??0}deg) rotateY(${pose.rotateY??0}deg) rotateX(${pose.rotateX??0}deg)`;
      const binding=attachPlanePose(wb,pose,{onError:error=>{throw error;}});
      await settled(); assert(binding.getSpec(),'pose initial publication missing');
      const actual=positions(b,wbHost),expected=positions(a,nativeHost);
      for(let i=0;i<4;i++)maximumCornerError=Math.max(maximumCornerError,distance(actual[i],expected[i]));
      binding.dispose();nativeHost.remove();wbHost.remove();
    }
    assert(maximumCornerError<.05,`native CSS mismatch: ${maximumCornerError}px`);
    record('5 poses / 20 rendered corners vs native CSS, independent origins and fractional sizes',{maxErrorPx:maximumCornerError});

    let maxLineError=0,maxPlanError=0;
    for(const [id,binding] of [['left',left],['right',right]]) {
      const host=document.getElementById(id),faces=[...host.querySelectorAll('.face')],points=faces.map(markers);
      cleanups.push(()=>points.flat().forEach(point=>point.remove()));
      const verify=()=>{
        const plan=binding.getSpecs();assert(plan?.length===2,'strip plan missing');
        const actual=points.map(p=>positions(p,host));
        for(let i=0;i<2;i++) for(let j=0;j<4;j++)maxPlanError=Math.max(maxPlanError,distance(actual[i][j],quadPoints(plan[i].spec)[j]));
        for(const edge of [[0,1],[3,2]]) {
          const a=actual[0][edge[0]],b=actual[1][edge[1]];
          for(const card of actual)for(const index of edge)maxLineError=Math.max(maxLineError,lineError(a,b,card[index]));
        }
      };
      verify();
      const before=JSON.stringify(binding.getSpecs()),invalid=structuredClone(id==='left'?leftPlane:rightPlane);
      [invalid.destination.quad.tr,invalid.destination.quad.bl]=[invalid.destination.quad.bl,invalid.destination.quad.tr];
      const styles=faces.map(face=>face.style.transform);
      assert(await binding.update(invalid)===false,'invalid strip was published');
      assert(before===JSON.stringify(binding.getSpecs()),'invalid strip changed exported plan');
      assert(styles.every((style,i)=>style===faces[i].style.transform),'invalid strip partially published');
      assert(await binding.update(id==='left'?leftPlane:rightPlane),'strip recovery failed');
      const hostHeight=host.style.height;host.style.height='271.5px';await settled();verify();host.style.height=hostHeight;await settled();
    }
    assert(maxLineError<.05&&maxPlanError<.05,`strip geometry mismatch ${maxLineError}/${maxPlanError}`);
    record('Both shared planes: collinear edges, real resize, all-or-none invalid update and recovery',{maxLineErrorPx:maxLineError,maxPlanErrorPx:maxPlanError});

    const host=document.createElement('div'),face=document.createElement('div');
    host.style.cssText='position:relative;width:320.5px;height:181.25px';face.style.cssText='position:absolute;width:211.25px;height:143.5px';scratch.append(host);host.append(face);
    face.style.setProperty('transform','translateX(2px)','important');
    const live=document.createElement('button');live.textContent='Original live node';let clicks=0;live.onclick=()=>clicks++;face.append(live);
    const binding=attachPlanePose(face,{perspective:1200},{onError:()=>{}});cleanups.push(()=>binding.dispose());await settled();
    const requests=Array.from({length:120},(_,i)=>binding.update({perspective:1200,rotateY:i/10}));
    const outcomes=await Promise.all(requests);assert(outcomes.filter(Boolean).length===1&&outcomes.at(-1),'updates did not coalesce');
    const exported=binding.getSpec(),original=JSON.stringify(exported);exported.destination.quad.tl.x+=100;
    assert(JSON.stringify(binding.getSpec())===original,'export aliases internal state');
    const style=face.style.transform;
    assert(!await binding.update({perspective:1200,depth:1200}),'horizon update accepted');assert(style===face.style.transform,'failure lost last valid rendering');
    assert(await binding.update({perspective:1200,rotateY:8}),'pose recovery failed');
    const replacement=attachPerspective(face,host,binding.getSpec(),{onError:()=>{}});await settled();
    assert(!await binding.update({perspective:1200}),'replaced binding stayed active');
    assert(face.firstChild===live,'binding replaced content');live.click();assert(clicks===1,'live control handler lost');
    face.style.width='222.75px';await settled();
    const pending=replacement.update(normalizedSpec({tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1}}));replacement.dispose();assert(!await pending,'disposed request succeeded');await settled();
    assert(face.style.getPropertyPriority('transform')==='important'&&face.style.transform==='translateX(2px)','dispose failed to restore previous inline priority');assert(face.style.width==='222.75px','dispose overwrote external layout');
    record('120 updates coalesce; safe snapshots, horizon rejection, recovery, rebind, live content and disposal');

    const member=document.createElement('div');member.style.cssText='position:absolute;width:140px;height:110px';host.append(member);
    const groupPlane=normalizedSpec({tl:{x:0,y:.02},tr:{x:1,y:.1},br:{x:1,y:.9},bl:{x:0,y:.98}});
    const group=attachPerspectiveStrip(host,[{id:'a',element:face,start:0,end:.47},{id:'b',element:member,start:.53,end:1}],groupPlane);
    await settled();assert(group.getSpecs()?.length===2,'group initial publication failed');
    const takeOver=attachPlanePose(face,{perspective:1000});await settled();
    assert(!await group.update(groupPlane),'replaced group remained active');assert(member.style.transform==='','replacing one group member failed to restore its sibling');
    takeOver.dispose();group.dispose();record('Replacing a group member releases all sibling styles and observers');

    const added=document.createElement('div');added.style.cssText='position:absolute;left:0;top:0;width:123.5px;height:117.25px';host.append(added);
    for(const element of [face,member]){element.style.left='0';element.style.top='0';}
    const originalGroup=attachPerspectiveStrip(host,[{id:'a',element:face,start:0,end:.47},{id:'b',element:member,start:.53,end:1}],groupPlane);
    cleanups.push(()=>originalGroup.dispose());await settled();
    const contentStyle=face.style.transform;live.textContent='Updated content in the same slot';live.click();
    assert(clicks===2&&face.style.transform===contentStyle,'fixed-slot content change lost geometry or handlers');
    const superseded=originalGroup.update(groupPlane);originalGroup.dispose();
    const nextPanels=[{id:'b',element:member,start:0,end:.3},{id:'new',element:added,start:.35,end:.65},{id:'a',element:face,start:.7,end:1}];
    const nextGroup=attachPerspectiveStrip(host,nextPanels,groupPlane);cleanups.push(()=>nextGroup.dispose());
    assert(!await superseded,'old group published during membership replacement');await settled();
    const nextPlan=nextGroup.getSpecs();assert(nextPlan?.map(item=>item.id).join(',')==='b,new,a','reordered membership lost correlation');
    const nextMarkers=nextPanels.map(panel=>markers(panel.element));cleanups.push(()=>nextMarkers.flat().forEach(point=>point.remove()));
    const nextPoints=nextMarkers.map(points=>positions(points,host));let replacementError=0;
    for(let i=0;i<3;i++)for(let j=0;j<4;j++)replacementError=Math.max(replacementError,distance(nextPoints[i][j],quadPoints(nextPlan[i].spec)[j]));
    assert(replacementError<.05,`membership replacement geometry mismatch ${replacementError}`);
    nextGroup.dispose();
    const singleGroup=attachPerspectiveStrip(host,[{id:'new',element:added,start:0,end:1}],groupPlane);cleanups.push(()=>singleGroup.dispose());await settled();
    assert(singleGroup.getSpecs()?.length===1,'shrinking membership failed');
    assert(face.style.transform==='translateX(2px)'&&face.style.getPropertyPriority('transform')==='important'&&member.style.transform==='','removed members retained group styles');
    assert(face.firstChild===live,'membership replacement replaced live content');live.click();assert(clicks===3,'membership replacement lost live control handler');
    singleGroup.dispose();
    const disjoint=document.createElement('div');disjoint.style.cssText=added.style.cssText;host.append(disjoint);
    const disjointGroup=attachPerspectiveStrip(host,[{id:'disjoint',element:disjoint,start:0,end:1}],groupPlane);cleanups.push(()=>disjointGroup.dispose());await settled();
    assert(disjointGroup.getSpecs()?.[0].id==='disjoint'&&added.style.transform==='','disjoint replacement leaked the old group');
    record('Fixed-slot content and explicit 2→3→1/disjoint membership rebind preserve geometry, IDs, handlers and released styles',{maxErrorPx:replacementError});

    const card=document.createElement('div');card.style.cssText='position:absolute;width:180px;height:110px';host.append(card);
    const tilt=attachPointerTilt(card,host,{perspective:1200},{rangeX:4,rangeY:6});await settled();const base=card.style.transform;
    const rect=host.getBoundingClientRect();host.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right,clientY:rect.bottom,pointerType:'mouse'}));await settled();
    const interactive=matchMedia('(hover: hover) and (pointer: fine)').matches&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
    assert(interactive?card.style.transform!==base:card.style.transform===base,'pointer motion preference not respected');
    host.dispatchEvent(new PointerEvent('pointerleave'));await settled();assert(card.style.transform===base,'pointer leave did not reset');
    host.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right,clientY:rect.bottom,pointerType:'touch'}));await settled();assert(card.style.transform===base,'touch tilted the card');
    tilt.dispose();await settled();const disposedStyle=card.style.transform;host.dispatchEvent(new PointerEvent('pointermove',{clientX:rect.right,clientY:rect.bottom,pointerType:'mouse'}));await settled();assert(card.style.transform===disposedStyle,'disposed pointer listener wrote a style');
    record('Pointer updates, leave reset, touch exclusion and listener disposal',{pointerEnabled:interactive});

    for(let i=0;i<120;i++){const start=performance.now();await projectPlanePose({elementSize:{width:640,height:360},pose:{perspective:1400,rotateY:i/10}});samples.push(performance.now()-start);}
    samples.sort((a,b)=>a-b);record('Local WASM pose timing (observed, not an SLA)',{samples:samples.length,p50Ms:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],maxMs:samples.at(-1)});
    assert(errors.length-startErrors===2,'unexpected demo errors beyond the two deliberate invalid strips');
    return {ok:true,checks,expectedRejections:errors.slice(startErrors),startupMs:Number(document.getElementById('status').dataset.startupMs)};
  } finally {
    for(const cleanup of cleanups.reverse())cleanup();
    document.getElementById('status').textContent='实时透视已就绪';
  }
}
