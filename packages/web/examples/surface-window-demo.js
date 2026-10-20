import {attachSurfaceWindow} from '../dist/surface-window.js';
const $=id=>document.getElementById(id);
const W=620,H=400,half=W/2;
const source=document.createElement('canvas');source.width=W*2;source.height=H*2;
const ctx=source.getContext('2d');const base=$('base').getContext('2d');
let theme=0, mode='fold',angle=130,distance=90,dx=0,dy=0,playing=false,frame,previous,bindings=[];
let failed=false;
function content(){
  const c=ctx;c.save();c.scale(2,2);
  c.fillStyle=theme%2?'#ddf0e3':'#e8dcfa';c.fillRect(0,0,W,H);
  c.fillStyle=theme%2?'#a3cbb2':'#b79add';c.beginPath();c.arc(530,72,180,0,Math.PI*2);c.fill();
  c.strokeStyle=theme%2?'#78a48c':'#a78acb';c.lineWidth=1;
  for(let i=0;i<10;i++){c.beginPath();c.arc(510,78,110+i*22,0,Math.PI*2);c.stroke();}
  c.fillStyle='#3c3151';c.font='600 13px system-ui';c.fillText('WORLDBEND   /   FIELD NOTES',30,40);
  c.font='500 43px system-ui';c.fillText(theme%2?'A little closer.':'Stay right here.',30,120);
  c.font='16px system-ui';c.fillText(theme%2?'靠近一点，细节重新浮现。':'每个字，都有自己的坐标。',32,155);
  c.fillStyle='#fff9';c.beginPath();c.roundRect(30,196,560,171,14);c.fill();
  c.fillStyle='#5b4976';c.font='600 12px system-ui';c.fillText(theme%2?'02 / ANOTHER VIEW':'01 / A FIXED PLANE',50,226);
  c.font='500 26px system-ui';c.fillText(theme%2?'近处与远方':'片刻与永恒',50,272);
  c.fillStyle='#797084';c.font='13px system-ui';c.fillText('移动的是这扇窗，内容依然在这里。',50,305);
  c.fillText('LIVE CONTENT  ·  '+String(theme+1).padStart(2,'0'),50,343);
  c.fillStyle=theme%2?'#edb068':'#e09c8d';c.beginPath();c.arc(510,280,48,0,Math.PI*2);c.fill();
  c.strokeStyle='#fff';c.lineWidth=2;c.beginPath();c.moveTo(490,280);c.lineTo(530,280);c.moveTo(510,260);c.lineTo(510,300);c.stroke();
  c.restore();base.clearRect(0,0,W,H);base.drawImage(source,0,0,W,H);
  bindings.forEach(binding=>void binding.refresh());
}
content();
const frost={baseRadius:0,spread:.13,maxRadius:30};
function spec(kind){
  const common={schema:'worldbend.surface-window',version:'0.1',contentSize:{width:W,height:H},frost};
  if(kind==='glass')return{...common,windowSize:{width:320,height:210},contentOrigin:{x:-150,y:-95},pose:{perspective:1800,depth:distance,rotateX:distance*.055,rotateY:-distance*.08,translate:{x:dx,y:dy},perspectiveOrigin:{x:.5,y:.5}}};
  const inner=kind==='inner';return{...common,windowSize:{width:half,height:H},contentOrigin:{x:inner?-half:0,y:0},pose:{perspective:1500,rotateY:inner?angle-180:angle,pivot:{x:inner?0:1,y:.5},perspectiveOrigin:{x:inner?0:1,y:.5}}};
}
function error(error){failed=true;$('feedback').textContent='画面暂时不可用。复位可重试；'+(error.message||String(error));$('feedback').classList.add('error');}
let outer,inner,glass;
function create(){
  for(const b of bindings)b.dispose();bindings=[];
  try{
    outer=attachSurfaceWindow($('outer'),source,spec('outer'),{onError:error});
    inner=attachSurfaceWindow($('inner'),source,spec('inner'),{onError:error});
    glass=attachSurfaceWindow($('glass'),source,spec('glass'),{onError:error});
    bindings=[outer,inner,glass];failed=false;$('feedback').classList.remove('error');
    switchMode(mode);
  }catch(e){error(e);}
}
function draw(){
  if(bindings.length!==3)return;
  if(mode==='fold'){void outer.update(spec('outer'));void inner.update(spec('inner'));}
  else void glass.update(spec('glass'));
  $('angle').value=angle;$('distance').value=distance;
  $('value').textContent=mode==='fold'?`${Math.round(angle)}°`:`${Math.round(distance)} px`;
  if(mode==='fold')$('stage').setAttribute('aria-valuenow',angle);
  if(!failed)$('feedback').textContent=mode==='fold'?(angle===180?'已经铺平，内容清晰对齐。':'可以停在任意角度，也可以直接反向拖动。'):'拖动磨砂窗口；把距离降到零，观察内容重新对齐。';
}
function switchMode(next){
  stop();mode=next;const fold=mode==='fold';
  $('fold-tab').setAttribute('aria-pressed',fold);$('glass-tab').setAttribute('aria-pressed',!fold);
  $('stage').classList.toggle('is-glass',!fold);
  $('stage').setAttribute('aria-label',fold?'拖动或用方向键改变开合':'拖动窗口；方向键移动窗口');
  $('stage').setAttribute('role',fold?'slider':'group');
  for(const name of ['aria-valuenow','aria-valuemin','aria-valuemax'])if(!fold)$('stage').removeAttribute(name);
  if(fold){$('stage').setAttribute('aria-valuemin','0');$('stage').setAttribute('aria-valuemax','180');}
  $('fold-controls').hidden=!fold;$('glass-controls').hidden=fold;$('play').hidden=!fold;
  $('hint').textContent=fold?'左右拖动屏幕，或使用下方滑杆':'拖动窗口，或聚焦后使用方向键';
  if(bindings.length===3){
    for(const [b,node,visible]of[[outer,$('outer'),fold],[inner,$('inner'),fold],[glass,$('glass'),!fold]]){
      node.style.display=visible?'block':'none';if(visible)void b.resume();else b.pause();
    }
  }
  draw();
}
function stop(){playing=false;cancelAnimationFrame(frame);$('play').textContent='播放开合';}
function play(){
  if(playing){stop();return;}
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){angle=angle<90?180:0;draw();return;}
  playing=true;$('play').textContent='暂停';previous=performance.now();let direction=angle>=180?-1:1;
  const step=now=>{if(!playing)return;angle+=direction*Math.min(now-previous,40)*.042;previous=now;if(angle>=180||angle<=0){angle=Math.max(0,Math.min(180,angle));direction*=-1;}draw();frame=requestAnimationFrame(step);};
  frame=requestAnimationFrame(step);
}
$('play').addEventListener('click',play);$('fold-tab').addEventListener('click',()=>switchMode('fold'));$('glass-tab').addEventListener('click',()=>switchMode('glass'));
$('angle').addEventListener('input',event=>{stop();angle=+event.target.value;draw();});$('distance').addEventListener('input',event=>{distance=+event.target.value;draw();});
$('content').addEventListener('click',()=>{theme++;content();});
$('reset').addEventListener('click',()=>{stop();angle=130;distance=90;dx=dy=0;if(failed)create();draw();});
let drag;
$('stage').addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary)return;stop();$('stage').setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,angle,dx,dy};});
$('stage').addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;const scale=$('stage').getBoundingClientRect().width/W;if(mode==='fold')angle=Math.max(0,Math.min(180,drag.angle+(e.clientX-drag.x)/scale*.5));else{dx=Math.max(-140,Math.min(140,drag.dx+(e.clientX-drag.x)/scale));dy=Math.max(-90,Math.min(90,drag.dy+(e.clientY-drag.y)/scale));}draw();});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('stage').addEventListener(name,()=>drag=undefined);
$('stage').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();stop();if(mode==='fold')angle=e.key==='Home'?0:e.key==='End'?180:Math.max(0,Math.min(180,angle+(['ArrowRight','ArrowUp'].includes(e.key)?5:-5)));else{dx=Math.max(-140,Math.min(140,dx+(e.key==='ArrowRight'?8:e.key==='ArrowLeft'?-8:0)));dy=Math.max(-90,Math.min(90,dy+(e.key==='ArrowDown'?8:e.key==='ArrowUp'?-8:0)));}draw();});
const observer=new ResizeObserver(()=>{const box=$('viewport').getBoundingClientRect();$('stage').style.transform=`scale(${Math.min((box.width-42)/W,(box.height-32)/(H*1.28),1)})`;});observer.observe($('viewport'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.addEventListener('pagehide',()=>{stop();observer.disconnect();bindings.forEach(b=>b.dispose());});
// Both the source checkout and the packed SDK can open the matching contract.
fetch('../SURFACE_WINDOW_CONTRACT.md',{method:'HEAD'}).then(r=>{if(!r.ok)$('contract').href='../../../docs/SURFACE_WINDOW_CONTRACT.md';});
create();
