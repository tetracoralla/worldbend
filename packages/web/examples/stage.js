import {createEffectRecipe,planEffect,attachEffect} from '../dist/effects.js';
import {stageArt,mountStage} from './stage-art.js';
import {moveNativeStage} from './stage-native.js';
import {makeStageStudy,validateStageStudy} from './stage-study.js';

const $=id=>document.getElementById(id), views=['host','recipe','rigid'].map($);
const media=matchMedia('(prefers-reduced-motion: reduce)');
let state={progress:1,pointerX:0,pointerY:0,reducedMotion:false},theme=0,choice='host-offsets';
let scenes=[],bindings=[],recipes=[],generation=0,drag,returnFrame,ready=false;
let taps=0,shakes=0;
const pendingWork=new Set();
const presetFingerprints=[];
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function track(work){const observed=Promise.resolve(work);pendingWork.add(observed);observed.then(()=>pendingWork.delete(observed),()=>pendingWork.delete(observed));return observed;}
async function finishPending(){while(pendingWork.size)await Promise.allSettled([...pendingWork]);}
const effective=()=>({...state,reducedMotion:state.reducedMotion||media.matches});
const clamp=n=>Math.max(-1,Math.min(1,n));
const stopReturn=()=>cancelAnimationFrame(returnFrame);
function sync(){
  $('x').value=state.pointerX;$('y').value=state.pointerY;$('reduce').checked=state.reducedMotion||media.matches;
  $('reduce').disabled=media.matches;
  for(const button of document.querySelectorAll('.choose'))button.setAttribute('aria-pressed',button.dataset.choice===choice);
  $('decision-title').textContent={'host-offsets':'简单晃动，先选 A。','layered-depth':'保留可复用的配方，选 B。','rigid-tilt':'表达一张藏品卡，选 C。'}[choice];
  for(const [i,id]of ['recipe','rigid'].entries()){
    const article=$(id).closest('article'),custom=bindings[i]&&bindings[i].getPlan().fingerprint!==presetFingerprints[i];
    article.querySelector('.method').textContent=custom?'Worldbend 自定义配方':i?'Worldbend 整体透视':'Worldbend 配方';
    article.querySelector('article > p').textContent=custom?'这是已修改的配方。使用相同素材与操作，重新观察和判断。':i?'整体朝向发生变化。更适合藏品卡，场景里的物件仍在一个平面。':'相同的分层幅度。差别在于配方可以验证、保存和重放。';
  }
}
function fit(){
  for(const [i,scene]of scenes.entries())scene.root.style.transform=`translate(-50%,-50%) scale(${views[i].clientWidth/600*1.07})`;
}
async function update(){
  sync();if(!ready)return false;
  const frame=effective();moveNativeStage(scenes[0].slots,frame);
  return (await Promise.all(bindings.map(binding=>binding.update(frame)))).every(Boolean);
}
async function replace(nextRecipes,nextTheme,nextState,fingerprints=[],token=++generation){
  const art=stageArt(nextTheme),nextScenes=[],nextBindings=[];
  const frame={...nextState,reducedMotion:nextState.reducedMotion||media.matches};
  try{
    for(let i=0;i<3;i++){
      const root=document.createElement('div');root.className='scene';
      const slots=mountStage(root,i===2?['content']:['background','middle','foreground'],art);nextScenes.push({root,slots});
      if(i)nextBindings.push(await attachEffect(nextRecipes[i-1],Object.fromEntries(Object.entries(slots).map(([id,element])=>[id,{element}])),frame,{expectedFingerprint:fingerprints[i-1],onError:e=>status(e.message,true)}));
    }
    if(token!==generation){nextBindings.forEach(b=>b.dispose());return false;}
    if(!(await Promise.all(nextBindings.map(b=>b.update(frame)))).every(Boolean))throw Error('配方绘制未完成');
    if(token!==generation){nextBindings.forEach(b=>b.dispose());return false;}
    stopReturn();cancelDrag();bindings.forEach(b=>b.dispose());bindings=nextBindings;scenes=nextScenes;
    recipes=nextRecipes.map(r=>structuredClone(r));theme=nextTheme;state={...nextState};ready=true;
    scenes.forEach((scene,i)=>views[i].replaceChildren(scene.root));moveNativeStage(scenes[0].slots,frame);fit();sync();return true;
  }catch(e){nextBindings.forEach(b=>b.dispose());throw e;}
}
function cancelDrag(){
  if(!drag)return;
  const previous=drag;drag=undefined;previous.view.classList.remove('dragging');
  if(previous.view.hasPointerCapture(previous.id))previous.view.releasePointerCapture(previous.id);
}
function settle(){
  stopReturn();const from={...state},started=performance.now();
  const tick=now=>{const t=Math.min(1,(now-started)/240),left=(1-t)**3;state.pointerX=from.pointerX*left;state.pointerY=from.pointerY*left;void update();if(t<1)returnFrame=requestAnimationFrame(tick);};
  if(effective().reducedMotion){state.pointerX=0;state.pointerY=0;void update();}else returnFrame=requestAnimationFrame(tick);
}
for(const view of views){
  view.addEventListener('pointerdown',e=>{
    if(!ready||drag||e.button!==0||!e.isPrimary)return;
    stopReturn();view.setPointerCapture(e.pointerId);drag={id:e.pointerId,view,x:e.clientX,y:e.clientY,width:view.clientWidth,height:view.clientHeight,from:{...state},moved:false};
  });
  view.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(Math.hypot(dx,dy)>8){drag.moved=true;view.classList.add('dragging');}
    if(drag.moved){state.pointerX=clamp(drag.from.pointerX+dx/drag.width*3);state.pointerY=clamp(drag.from.pointerY+dy/drag.height*3);void update();}
  });
  view.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const moved=drag.moved;cancelDrag();
    if(moved){shakes++;status(`晃一晃 · ${shakes} 次。松手回到中间。`);settle();}
    else{taps++;status(`戳一戳 · ${taps} 次。轻点与拖动分别响应。`);}
  });
  const cancelled=e=>{if(drag?.id===e.pointerId){cancelDrag();settle();status('操作已取消，回到中间；没有触发玩法。');}};
  view.addEventListener('pointercancel',cancelled);view.addEventListener('lostpointercapture',cancelled);
  view.addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','Enter',' '].includes(e.key)){
      e.preventDefault();stopReturn();
      if(e.key==='Enter'||e.key===' '){taps++;status(`戳一戳 · ${taps} 次。`);return;}
      if(e.key==='Home'){state.pointerX=state.pointerY=0;}
      else{const axis=e.key==='ArrowLeft'||e.key==='ArrowRight'?'pointerX':'pointerY';state[axis]=clamp(state[axis]+(['ArrowLeft','ArrowUp'].includes(e.key)?-.15:.15));}
      void update();
    }
  });
}
for(const [id,axis]of [['x','pointerX'],['y','pointerY']])$(id).addEventListener('input',e=>{stopReturn();cancelDrag();state[axis]=+e.target.value;void update();});
$('reset').addEventListener('click',()=>{cancelDrag();stopReturn();state.pointerX=state.pointerY=0;void update();status('已回到中间。');});
$('reduce').addEventListener('change',e=>{cancelDrag();stopReturn();state.reducedMotion=e.target.checked;void update();status(effective().reducedMotion?'静态查看：仍可轻点，空间运动已停止。':'已恢复空间响应。');});
media.addEventListener('change',()=>{cancelDrag();stopReturn();void update();status(media.matches?'跟随系统，已减少动态效果。':'系统动态偏好已更新。');});
window.addEventListener('blur',()=>{if(drag){cancelDrag();settle();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelDrag();stopReturn();state.pointerX=state.pointerY=0;void update();}});
$('theme').addEventListener('click',()=>{if(!ready)return;void track((async()=>{try{const token=++generation;if(await replace(recipes,1-theme,{...state},[],token))status('同一组新素材已应用到三个方案。');}catch(e){status('素材替换失败，原方案已保留：'+e.message,true);}})());});
for(const button of document.querySelectorAll('.choose'))button.addEventListener('click',()=>{choice=button.dataset.choice;sync();status('选择已更新。保存比较即可保留状态与观察。');});
async function exportDocument(){
  await finishPending();
  if(!ready)throw Error('画面尚未准备完成');
  stopReturn();cancelDrag();await update();
  return makeStageStudy({recipes,state:effective(),theme,choice,observation:$('observation').value});
}
async function loadDocument(input){
  const token=++generation,v=await validateStageStudy(input);
  if(token!==generation)return false;
  if(!await replace(v.candidates.map(c=>c.recipe),v.content.theme,v.state,v.candidates.map(c=>c.fingerprint),token))return false;
  choice=v.choice;$('observation').value=v.observation;sync();status('比较已恢复；配方指纹检查通过。');return true;
}
$('save').addEventListener('click',async()=>{try{const value=await exportDocument(),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='worldbend-stage-study.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('比较与反馈已导出到本地。');}catch(e){status(e.message,true);}});
$('open').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',e=>{const file=e.target.files[0];e.target.value='';if(!file)return;void track((async()=>{try{if(file.size>1_000_000)throw Error('比较文件需小于 1 MB');await loadDocument(JSON.parse(await file.text()));}catch(error){status('打开失败，当前比较已保留：'+error.message,true);}})());});
new ResizeObserver(fit).observe(document.querySelector('.cards'));
window.stageStudy={exportDocument,loadDocument,getPlans:()=>bindings.map(b=>b.getPlan()),getCounts:()=>({taps,shakes}),update:async next=>{
  // Validate explicit states through the canonical recipe before touching UI.
  const doc=await exportDocument();doc.state=next;return loadDocument(doc);
}};
try{
  const initial=await Promise.all(['layered-depth','rigid-tilt'].map(effect=>createEffectRecipe({effect,version:'2',viewport:{width:600,height:400},intensity:effect==='layered-depth'?.4:.8})));
  for(const recipe of initial)presetFingerprints.push((await planEffect({recipe,state})).fingerprint);
  if(await replace(initial,0,state))status('拖动、轻点或使用方向键；触控纵向滑动保留页面滚动。');
}catch(e){status('无法准备比较：'+e.message,true);}
