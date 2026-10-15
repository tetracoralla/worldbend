import {attachEffect,createEffectRecipe} from '../dist/effects.js';
import {makeArtwork} from './effects-art.js';

const $=id=>document.getElementById(id),viewport={width:600,height:400},artwork=makeArtwork(2),viewIds=['clear','depth','motion'];
const controls=()=>[$('play'),$('pointer-x'),$('pointer-y'),...document.querySelectorAll('[data-focus]'),$('reset')];
let state={progress:.35,pointerX:0,pointerY:0,reducedMotion:false},stateRevision=0,focusDistance=1000,candidates=[],generation=0,focusRequest=0,ready=false,playing=false,raf,drag;
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function initialBusy(value){document.querySelector('main').setAttribute('aria-busy',String(value));for(const control of controls())control.disabled=value;for(const id of viewIds)$(id).setAttribute('aria-disabled',String(value));}
function retryReady(){ready=false;initialBusy(true);$('play').disabled=false;$('play').textContent='重试准备';}

function cameraLayerSource(layer){
  const {size}=layer.surface,scale=2,canvas=document.createElement('canvas');canvas.width=Math.round(size.width*scale);canvas.height=Math.round(size.height*scale);
  const context=canvas.getContext('2d'),source=artwork[layer.id],x=-layer.offset.x*scale,y=-layer.offset.y*scale,w=viewport.width*scale,h=viewport.height*scale;
  if(layer.id==='background'){context.fillStyle='#d5dfe8';context.fillRect(0,0,canvas.width,canvas.height);}
  context.drawImage(source,0,0,source.width,source.height,x,y,w,h);return canvas;
}
function depthMap(size){
  const canvas=document.createElement('canvas');canvas.width=Math.round(size.width*2);canvas.height=Math.round(size.height*2);const context=canvas.getContext('2d');
  const gradient=context.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,'#101010');gradient.addColorStop(.45,'#4d4d4d');gradient.addColorStop(1,'#f5f5f5');context.fillStyle=gradient;context.fillRect(0,0,canvas.width,canvas.height);
  context.fillStyle='#242424';context.beginPath();context.ellipse(canvas.width*.42,canvas.height*.57,canvas.width*.16,canvas.height*.24,-.25,0,Math.PI*2);context.fill();return canvas;
}
async function recipe(mode,requestedFocus=focusDistance){
  const value=await createEffectRecipe({effect:'multiplane-camera',version:'3',viewport,intensity:.82});value.origin=null;
  if(mode==='clear'){value.appearance.depthOfField.maxBlurRadius=0;value.appearance.motionBlur=null;}
  if(mode==='depth'){
    value.appearance.depthOfField.focusDistance=requestedFocus;value.appearance.motionBlur=null;
    value.layers[0].surface.depthMap={nearDistance:900,farDistance:1800};
  }
  if(mode==='motion'){value.appearance.depthOfField.maxBlurRadius=0;}
  return value;
}
async function build(mode,requestedFocus=focusDistance){
  const value=await recipe(mode,requestedFocus),stage=document.createElement('div');stage.className='stage';const slots={};
  for(const layer of value.layers){
    const output=document.createElement('canvas'),source=cameraLayerSource(layer);output.dataset.layer=layer.id;stage.append(output);slots[layer.id]={element:output,source};
    if(layer.surface.depthMap)slots[layer.id].depthMap=depthMap(layer.surface.size);
  }
  const binding=await attachEffect(value,slots,state,{pixelRatio:Math.min(devicePixelRatio||1,1.25),maxPixels:2_097_152,onError:error=>status(error.message||String(error),true)});
  for(const {element} of Object.values(slots))element.addEventListener('webglcontextrestored',()=>status('图形上下文已恢复；画面已用已接受的素材重新生成。'));
  return{mode,stage,binding,recipe:value};
}
function fit(){for(const candidate of candidates){const box=$(candidate.mode).getBoundingClientRect();candidate.stage.style.transform=`translate(-50%,-50%) scale(${Math.min((box.width-2)/viewport.width,(box.height-2)/viewport.height)})`;}}
async function synchronize(values){
  for(;;){const revision=stateRevision,snapshot={...state},results=await Promise.all(values.map(value=>value.binding.update(snapshot)));if(!results.every(Boolean))throw Error('无法把新画面同步到当前观察位置');if(revision===stateRevision)return;}
}
async function rebuild(){
  initialBusy(true);status('正在准备空间成像…');const token=++generation,next=[];try{
    for(const mode of ['clear','depth','motion'])next.push(await build(mode));
    if(token!==generation){next.forEach(value=>value.binding.dispose());return;}
    await synchronize(next);if(token!==generation){next.forEach(value=>value.binding.dispose());return;}
    const previous=candidates;candidates=next;for(const value of next)$(value.mode).replaceChildren(value.stage);previous.forEach(value=>value.binding.dispose());fit();status('已就绪。拖动画面，快速移动时观察右侧；停止后动态模糊归零。');
    ready=true;initialBusy(false);$('play').textContent='播放一次';return true;
  }catch(error){next.forEach(value=>value.binding.dispose());if(token===generation){status('准备失败，当前画面没有改变。可重试：'+(error.message||error),true);retryReady();}return false;}
}
async function rebuildMode(mode,requestedFocus=focusDistance){
  const token=++generation;let next;try{
    next=await build(mode,requestedFocus);if(token!==generation){next.binding.dispose();return false;}
    await synchronize([next]);if(token!==generation){next.binding.dispose();return false;}
    const index=candidates.findIndex(value=>value.mode===mode);if(index<0)throw Error('当前画面尚未准备完成');const previous=candidates[index];candidates[index]=next;$(mode).replaceChildren(next.stage);previous.binding.dispose();fit();status('已就绪。光学焦点已改变，共享相机的会聚平面保持不变。');
    return true;
  }catch(error){next?.binding.dispose();if(token===generation)status('没有替换当前画面：'+(error.message||error),true);return false;}
}
async function update(next,previous=state,elapsedSeconds=1/60){
  if(!ready)return false;state={...next};stateRevision++;$('pointer-x').value=state.pointerX;$('pointer-y').value=state.pointerY;
  const sample={previousState:{...previous},elapsedSeconds:Math.max(.001,Math.min(10,elapsedSeconds))};
  const results=await Promise.all(candidates.map(candidate=>candidate.binding.update(state,candidate.mode==='motion'?sample:undefined)));
  return results.every(Boolean);
}
function settle(){return update(state,state,1/60);}
function stop(){playing=false;cancelAnimationFrame(raf);if(ready)$('play').textContent='播放一次';void settle();}
function pointerState(view,event,start){return{...start.state,pointerX:Math.max(-1,Math.min(1,start.state.pointerX+(event.clientX-start.x)/view.clientWidth*2)),pointerY:Math.max(-1,Math.min(1,start.state.pointerY+(event.clientY-start.y)/view.clientHeight*2))};}

for(const id of ['clear','depth','motion']){
  const view=$(id);view.addEventListener('pointerdown',event=>{if(!ready||event.button!==0||!event.isPrimary)return;stop();view.setPointerCapture(event.pointerId);drag={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,state:{...state}};});
  view.addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const previous={...state},next=pointerState(view,event,drag),elapsed=(event.timeStamp-drag.time)/1000;drag.x=event.clientX;drag.y=event.clientY;drag.time=event.timeStamp;drag.state=previous;void update(next,previous,elapsed);});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(name,()=>{drag=undefined;void settle();});
  view.addEventListener('keydown',event=>{if(!ready||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();stop();const previous={...state},next={...state};if(event.key==='Home')next.pointerX=next.pointerY=0;else{next.pointerX=Math.max(-1,Math.min(1,next.pointerX+(event.key==='ArrowRight'?.12:event.key==='ArrowLeft'?-.12:0)));next.pointerY=Math.max(-1,Math.min(1,next.pointerY+(event.key==='ArrowDown'?.12:event.key==='ArrowUp'?-.12:0)));}void update(next,previous,1/30).then(settle);});
}
for(const [id,key]of [['pointer-x','pointerX'],['pointer-y','pointerY']]){
  $(id).addEventListener('input',event=>{stop();const previous={...state};void update({...state,[key]:+event.target.value},previous,1/60);});
  $(id).addEventListener('change',()=>{void settle();});
}
async function selectFocus(distance){
  if(!ready)return false;stop();const request=++focusRequest,buttons=[...document.querySelectorAll('[data-focus]')],article=$('depth').closest('article');for(const value of buttons)value.disabled=true;article.setAttribute('aria-busy','true');status('正在切换光学焦点…');
  try{const accepted=await rebuildMode('depth',distance);if(!accepted||request!==focusRequest)return false;focusDistance=distance;for(const value of buttons)value.setAttribute('aria-pressed',String(+value.dataset.focus===distance));const selected=buttons.find(value=>+value.dataset.focus===distance);$('depth-focus').textContent=`${selected?.textContent??distance+' 单位'}对焦 · 显式深度图`;return true;}
  finally{if(request===focusRequest){for(const value of buttons)value.disabled=false;article.setAttribute('aria-busy','false');}}
}
for(const button of document.querySelectorAll('[data-focus]'))button.addEventListener('click',()=>{void selectFocus(+button.dataset.focus);});
$('reset').addEventListener('click',()=>{stop();const previous={...state};void update({...state,pointerX:0,pointerY:0},previous,1/30).then(settle);});
$('play').addEventListener('click',()=>{
  if(!ready){$('play').disabled=true;void rebuild();return;}if(playing){stop();return;}if(matchMedia('(prefers-reduced-motion: reduce)').matches){status('系统已减少动态效果；拖动和播放保持静态。');return;}
  playing=true;$('play').textContent='停止';const start=performance.now(),origin={...state};let previous={...state},last=start;
  const tick=now=>{if(!playing)return;const t=Math.min(1,(now-start)/1450),eased=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2,next={...state,pointerX:-.82+1.64*eased,pointerY:Math.sin(t*Math.PI)*.42};void update(next,previous,(now-last)/1000);previous=next;last=now;if(t<1)raf=requestAnimationFrame(tick);else{playing=false;$('play').textContent='播放一次';void update(origin,next,1/30).then(settle);}};raf=requestAnimationFrame(tick);
});
const resize=new ResizeObserver(fit);for(const id of ['clear','depth','motion'])resize.observe($(id));
window.addEventListener('blur',()=>{drag=undefined;stop();});document.addEventListener('visibilitychange',()=>{if(document.hidden){drag=undefined;stop();}});
window.addEventListener('pagehide',()=>{generation++;stop();resize.disconnect();candidates.forEach(value=>value.binding.dispose());});
window.worldbendAppearance={getPlans:()=>candidates.map(value=>value.binding.getPlan()),getRecipes:()=>candidates.map(value=>value.binding.getRecipe()),update,settle,setFocus:selectFocus,getState:()=>({...state})};
await rebuild();
