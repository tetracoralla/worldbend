import {attachDocumentEffect} from '../dist/effects.js';

const $=id=>document.getElementById(id),viewport={width:600,height:400};
const outputElements={background:$('background'),middle:$('middle'),foreground:$('foreground')};
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let binding,deliveryPlan,deliveryPlans,release=1,state={progress:1,pointerX:0,pointerY:0,reducedMotion:false},drag,busy=true;
const canonical=value=>JSON.stringify(value,(_,part)=>part&&typeof part==='object'&&!Array.isArray(part)?Object.fromEntries(Object.entries(part).sort(([a],[b])=>a.localeCompare(b))):part);
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
const setBusy=value=>{busy=value;if(value)drag=undefined;document.querySelector('main').setAttribute('aria-busy',String(value));$('replace').disabled=value;$('reset').disabled=value;$('viewport').setAttribute('aria-disabled',String(value));};

function canvas(draw){const value=document.createElement('canvas');value.width=1440;value.height=960;const context=value.getContext('2d');context.scale(2,2);draw(context);return value;}
function rounded(context,x,y,width,height,radius){context.beginPath();context.roundRect(x,y,width,height,radius);}
function backdrop(){return canvas(context=>{
  const gradient=context.createLinearGradient(0,0,720,480);gradient.addColorStop(0,'#e9f0df');gradient.addColorStop(.55,'#c4d8c1');gradient.addColorStop(1,'#7c9f8c');context.fillStyle=gradient;context.fillRect(0,0,720,480);
  context.strokeStyle='#173c2d22';context.lineWidth=1;for(let i=0;i<11;i++){context.beginPath();context.arc(545,165,45+i*25,0,Math.PI*2);context.stroke();}
  context.fillStyle='#173c2d';context.font='700 11px system-ui';context.letterSpacing='2px';context.fillText('FIELD NOTES / 2026',52,62);
  context.fillStyle='#173c2d99';context.font='12px system-ui';context.fillText('ONE COMPOSITION · MANY RELEASES',443,423);
});}
function details(){return canvas(context=>{
  context.save();context.translate(113,114);context.rotate(-.07);context.fillStyle='#f4f1e8d9';rounded(context,0,0,176,222,18);context.fill();context.strokeStyle='#183c2d22';context.stroke();
  context.fillStyle='#16392b';context.font='700 10px system-ui';context.fillText('SYSTEM HEALTH',18,26);context.fillStyle='#d8ff62';rounded(context,18,43,140,62,10);context.fill();context.fillStyle='#173c2d';context.font='500 25px system-ui';context.fillText('98.7%',31,82);context.fillStyle='#173c2d99';context.font='10px system-ui';context.fillText('ALL SERVICES NOMINAL',18,128);for(let i=0;i<5;i++){context.fillStyle=i<4?'#4f775f':'#b7c4b8';rounded(context,18+i*27,150,19,48-i*6,5);context.fill();}context.restore();
  context.fillStyle='#ffffffaa';context.beginPath();context.arc(596,116,31,0,Math.PI*2);context.fill();context.fillStyle='#173c2d';context.font='700 11px system-ui';context.fillText('LIVE',582,120);
});}
function product(version){return canvas(context=>{
  const accent=version===1?'#ef785d':'#795cff',dark=version===1?'#20251f':'#171526',title=version===1?'Signal Atlas':'Signal Atlas 2';
  context.save();context.shadowColor='#173c2d66';context.shadowBlur=32;context.shadowOffsetY=22;context.fillStyle='#f8f7ef';rounded(context,260,76,350,310,24);context.fill();context.shadowColor='transparent';context.strokeStyle='#ffffffaa';context.stroke();
  context.fillStyle=dark;rounded(context,278,94,314,274,15);context.fill();context.fillStyle='#ffffffd9';context.font='700 11px system-ui';context.fillText(title.toUpperCase(),298,119);
  context.fillStyle='#ffffff66';context.font='10px system-ui';context.textAlign='right';context.fillText(version===1?'RELEASE 01 / OBSERVE':'RELEASE 02 / COMPOSE',572,119);context.textAlign='left';
  context.strokeStyle='#ffffff18';context.beginPath();context.moveTo(298,140);context.lineTo(572,140);context.stroke();
  const gradient=context.createLinearGradient(310,160,558,330);gradient.addColorStop(0,accent);gradient.addColorStop(1,version===1?'#f6c56c':'#4fd9c5');context.fillStyle=gradient;rounded(context,298,157,274,130,17);context.fill();
  context.fillStyle='#ffffffcc';context.font='500 31px ui-serif, Georgia';context.fillText(version===1?'Find the signal.':'Shape the field.',318,210);context.fillStyle='#ffffffaa';context.font='11px system-ui';context.fillText(version===1?'Spatial monitoring for calm decisions.':'A clearer release, on the same foundation.',319,239);
  context.fillStyle='#ffffff';rounded(context,298,307,112,34,17);context.fill();context.fillStyle=dark;context.font='700 10px system-ui';context.fillText('OPEN WORKSPACE',313,328);context.fillStyle='#ffffff55';context.font='10px system-ui';context.fillText(version===1?'14 SOURCES CONNECTED':'23 SOURCES CONNECTED',438,328);context.restore();
  context.fillStyle=accent;context.beginPath();context.arc(625,317,39,0,Math.PI*2);context.fill();context.fillStyle='#fff';context.font='700 13px system-ui';context.fillText(version===1?'R01':'R02',612,322);
});}
function assets(version){return{'showcase-backdrop':backdrop(),'showcase-details':details(),'showcase-product':product(version)};}
function fit(){const box=$('viewport').getBoundingClientRect();$('stage').style.transform=`translate(-50%,-50%) scale(${Math.min(box.width/viewport.width,box.height/viewport.height)})`;}
async function update(next,previous=state,elapsedSeconds=1/60){if(!binding)return false;state={...next};return binding.update(state,{previousState:{...previous},elapsedSeconds:Math.max(.001,Math.min(10,elapsedSeconds))});}
async function settle(){return binding?.update(state,{previousState:{...state},elapsedSeconds:1/60})??false;}
async function replaceProduct(nextRelease){
  if(!binding||!deliveryPlans?.[nextRelease]||nextRelease===release)return false;setBusy(true);status(`正在把产品素材替换为 Release 0${nextRelease}…`);
  try{const accepted=await binding.replaceAsset('showcase-product',product(nextRelease));if(!accepted){status('替换没有被接受，当前作品仍保持原样。',true);return false;}deliveryPlan=deliveryPlans[nextRelease];release=nextRelease;$('release').textContent=`Release 0${release}`;$('frame-release').textContent=`R0${release}`;$('replace').textContent=release===1?'换成 Release 02':'换回 Release 01';status(`Release 0${release} 已交付；作品版本已更新，镜头、空间层级与交互没有重建。`);return true;}
  finally{setBusy(false);}
}
function pointerState(event,start){const box=$('viewport').getBoundingClientRect();return{...start.state,pointerX:Math.max(-1,Math.min(1,start.state.pointerX+(event.clientX-start.x)/box.width*2)),pointerY:Math.max(-1,Math.min(1,start.state.pointerY+(event.clientY-start.y)/box.height*2))};}

$('replace').addEventListener('click',()=>void replaceProduct(release===1?2:1));
$('reset').addEventListener('click',()=>{const previous={...state};void update({...state,pointerX:0,pointerY:0},previous,1/30).then(settle);});
$('viewport').addEventListener('pointerdown',event=>{if(!binding||busy||event.button!==0||!event.isPrimary)return;$('viewport').setPointerCapture(event.pointerId);drag={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,state:{...state}};});
// The drag baseline must pair the event coordinates with the pointer state at
// those coordinates; storing the pre-update state mixes two moments and drops
// every other event's delta, which visibly jitters the work during a drag.
$('viewport').addEventListener('pointermove',event=>{if(!drag||event.pointerId!==drag.id)return;const previous={...state},next=pointerState(event,drag),elapsed=(event.timeStamp-drag.time)/1000;drag={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp,state:next};void update(next,previous,elapsed);});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('viewport').addEventListener(name,()=>{drag=undefined;if(!busy)void settle();});
$('viewport').addEventListener('keydown',event=>{if(!binding||busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return;event.preventDefault();const previous={...state},next={...state};if(event.key==='Home')next.pointerX=next.pointerY=0;else{next.pointerX=Math.max(-1,Math.min(1,next.pointerX+(event.key==='ArrowRight'?.12:event.key==='ArrowLeft'?-.12:0)));next.pointerY=Math.max(-1,Math.min(1,next.pointerY+(event.key==='ArrowDown'?.12:event.key==='ArrowUp'?-.12:0)));}void update(next,previous,1/30).then(settle);});
reduced.addEventListener('change',()=>status(reduced.matches?'系统已减少动态效果；换源仍可用，视点保持静止。':'动态效果已恢复；可以继续拖动观察。'));
const resize=new ResizeObserver(fit);resize.observe($('viewport'));
window.addEventListener('blur',()=>{drag=undefined;void settle();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){drag=undefined;binding?.pause();}else void binding?.resume();});
window.addEventListener('pagehide',event=>{drag=undefined;if(event.persisted){binding?.pause();return;}resize.disconnect();binding?.dispose();binding=undefined;});
window.addEventListener('pageshow',event=>{if(event.persisted)void binding?.resume().then(accepted=>accepted&&fit());});

window.worldbendDocumentDemo={
  getPlan:()=>binding?.getPlan(),
  getRecipe:()=>binding?.getRecipe(),
  getDocumentFingerprint:()=>deliveryPlan?.documentFingerprint,
  getRelease:()=>release,
  update,
  settle,
  replaceProduct,
  async rejectInvalid(){const invalid=document.createElement('canvas');invalid.width=0;invalid.height=0;return binding?.replaceAsset('showcase-product',invalid)??false;},
};

try{
  setBusy(true);const paths=['document-showcase-plan.json','document-showcase-plan-release02.json'];
  const plans=await Promise.all(paths.map(async path=>{const response=await fetch(path);if(!response.ok)throw Error(`交付计划读取失败（${response.status}）`);return response.json();}));
  if(plans[0].schema!==plans[1].schema||plans[0].version!==plans[1].version||!plans.every(plan=>/^sha256:[0-9a-f]{64}$/.test(plan.documentFingerprint))||canonical(plans[0].deliveries)!==canonical(plans[1].deliveries)||plans[0].documentFingerprint===plans[1].documentFingerprint)throw Error('两版作品的表达或文档版本不一致');
  deliveryPlans={1:plans[0],2:plans[1]};deliveryPlan=deliveryPlans[release];
  binding=await attachDocumentEffect(deliveryPlan,'showcase-hero',{elements:outputElements,assets:assets(release)},state,{pixelRatio:Math.min(devicePixelRatio||1,1.5),maxPixels:2_097_152,onError:error=>status(error.message||String(error),true)});
  fit();setBusy(false);status(reduced.matches?'已就绪。系统已减少动态效果；换源仍然可用。':'已就绪。拖动观察，或直接换成下一版产品素材。');
}catch(error){setBusy(true);status('作品没有替换当前页面：'+(error.message||error),true);}
