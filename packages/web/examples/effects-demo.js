import {discoverEffects,createEffectRecipe,planEffect,attachEffect} from '../dist/effects.js';
import {makeArtwork,createScene} from './effects-art.js';
const $=id=>document.getElementById(id);
const viewport={width:600,height:400};
const descriptions={
  'layered-depth':['让前中后景各有距离','前景响应更明显。留意它与底座、背景之间的相对位移。','需要独立图层。简单视差也可直接使用宿主界面能力；单张图片不会自动分层。'],
  'multiplane-camera':['从另一个视点看同一舞台','三层服从同一台相机：焦点保持稳定，前后景向相反方向移动，平面边缘随视角产生透视变化。','需要明确的前中后景和额外边缘素材。计划会报告视口是否超出源图，但不会生成被遮住的内容，也不会把平面人物重建成立体人物。'],
  'rigid-tilt':['把内容作为一件整体','所有内容在同一平面上。观察它与分层舞台的区别。','适合卡片与整体平面；内容里的物件不会自动获得独立纵深。'],
  'shared-plane':['让相邻内容共享透视','三张卡片保持共面。拖动时观察上下边缘的延续。','卡片内容保持独立；共面关系由同一份几何计划维护。'],
  'hinged-reveal':['折面展开，内容留在原处','拖动进度，观察文字的位置与逐渐清晰的折面。','使用图片、视频或画布。这个窗口不会把原生控件变成可交互的纹理。'],
  'frosted-lens':['通过悬浮窗口观察内容','移动窗口，再把进度拖到最右，让它靠近并变得清晰。','窗口采样提供的素材，不会自动截取应用背景或任意网页内容。'],
};
let catalog=[],intent='',selected=0,content={kind:'builtin',version:'1',theme:0},artwork=makeArtwork();
let state={progress:.35,pointerX:0,pointerY:0,reducedMotion:false};
let candidates=[],generation=0,playing=false,raf,playStart=0,dirty=false,drag;
const pendingWork=new Set();
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const observations=()=>document.querySelectorAll('.observation');
const feedback=(text,error=false)=>{$('feedback').textContent=text;$('feedback').classList.toggle('error',error);};
function track(work){const observed=Promise.resolve(work);pendingWork.add(observed);observed.then(()=>pendingWork.delete(observed),()=>pendingWork.delete(observed));return observed;}
async function finishPending(){while(pendingWork.size)await Promise.allSettled([...pendingWork]);}
function title(recipe){return catalog.find(row=>row.id===recipe.origin?.effect)?.title || '自定义组合';}
function sync(){
  $('progress').value=state.progress;$('pointer-x').value=state.pointerX;$('pointer-y').value=state.pointerY;$('reduce').checked=state.reducedMotion;
  $('progress-value').textContent=Math.round(state.progress*100)+'%';
  for(const [i,c]of candidates.entries()){
    const article=document.querySelector(`.candidate[data-index="${i}"]`);article.classList.toggle('selected',selected===i);article.querySelector('.select-candidate').setAttribute('aria-pressed',selected===i);
    article.querySelector('.name').textContent=(c.preset?'':'自定义 · ')+title(c.recipe);article.querySelector('.tag').textContent=selected===i?'正在编辑':'点击选择';
    observations()[i].textContent=descriptions[c.recipe.origin?.effect]?.[1] || '这是一份保存的空间组合，可继续查看、比较与重放。';
  }
  const c=candidates[selected];$('intensity').disabled=!c?.preset;$('intensity').value=c?.recipe.origin?.intensity ?? .8;
  $('limits').textContent=descriptions[c?.recipe.origin?.effect]?.[2] || '自定义配方按保存的图层和轨道执行。改变组成请修改配方并重新验证。';
  if(reduced.matches||state.reducedMotion)$('hint').textContent='静态查看已开启，画面使用展开、居中的状态。';
  else $('hint').textContent='拖动任一画面，两边同步响应。方向键也可以操作。';
  $('save').textContent=dirty?'保存方案 ·':'保存方案';
}
function select(index){selected=index;sync();renderCatalog();}
function fit(){for(let i=0;i<candidates.length;i++){const box=$(`view-${i}`).getBoundingClientRect(),c=candidates[i];c.stage.style.transform=`scale(${Math.min((box.width-24)/c.recipe.viewport.width,(box.height-26)/c.recipe.viewport.height)})`;}}
function stop(){playing=false;cancelAnimationFrame(raf);$('play').textContent='播放';}
function reportCoverage(){const exposed=candidates.flatMap(c=>c.binding.getPlan().frames).filter(frame=>frame.coverage&&!frame.coverage.viewportCovered);feedback(exposed.length?`当前视点会露出 ${exposed.length} 个图层的源图边缘；请增加 overscan 或减小相机行程。`:'',exposed.length>0);}
async function update(){dirty=true;sync();const ok=await Promise.all(candidates.map(c=>c.binding.update(state)));if(ok.length&&ok.every(Boolean))reportCoverage();return ok.every(Boolean);}
async function build(recipe,art,requestState,fingerprint){
  const {stage,slots}=createScene(recipe,art,()=>feedback('原生按钮保持可用。'));
  const binding=await attachEffect(recipe,slots,requestState,{expectedFingerprint:fingerprint,onError:e=>feedback(e.message||String(e),true)});
  let preset=false;
  if(recipe.origin){try{const original=await createEffectRecipe(recipe.origin);const p=await planEffect({recipe:original,state:requestState});preset=p.fingerprint===binding.getPlan().fingerprint;}catch{/* explicit custom recipe remains usable */}}
  return{recipe:binding.getRecipe(),binding,stage,preset};
}
async function replace(recipes,newArt=artwork,newContent=content,newState=state,fingerprints=[],token=++generation){
  if(token!==generation)return false;
  if(recipes.length!==2)throw Error("请等待两份方案准备完成");stop();let next=[];
  try{
    // Prepare both candidates before replacing either visible result.
    for(let i=0;i<recipes.length;i++)next.push(await build(recipes[i],newArt,newState,fingerprints[i]));
    if(token!==generation){next.forEach(c=>c.binding.dispose());return false;}
    if(!(await Promise.all(next.map(c=>c.binding.update(newState)))).every(Boolean))throw Error('新方案未能完成绘制');
    if(token!==generation){next.forEach(c=>c.binding.dispose());return false;}
    const old=candidates;candidates=next;state={...newState};artwork=newArt;content=newContent;
    candidates.forEach((c,i)=>$(`view-${i}`).replaceChildren(c.stage));old.forEach(c=>c.binding.dispose());
    dirty=true;sync();fit();renderCatalog();reportCoverage();return true;
  }catch(e){next.forEach(c=>c.binding.dispose());if(token===generation)feedback('没有替换当前方案：'+(e.message||e),true);return false;}
}
async function choose(id){
  const token=++generation,index=selected;
  try{const recipe=await createEffectRecipe({effect:id,version:'2',viewport,intensity:.8});const recipes=candidates.map(c=>c.recipe);recipes[index]=recipe;await replace(recipes,artwork,content,state,[],token);}catch(e){feedback(e.message,true);}
}
let searchToken=0;
async function renderCatalog(){
  const token=++searchToken;
  try{
    const result=await discoverEffects({version:'2',carrier:'web',query:$('search').value,...(intent?{intent}:{})});if(token!==searchToken)return;
    $('catalog').replaceChildren();
    for(const row of result.effects){
      const button=document.createElement('button');button.className='effect-option';button.setAttribute('aria-pressed',candidates[selected]?.recipe.origin?.effect===row.id);button.setAttribute('aria-label',`${row.title}，用于方案 ${selected?'B':'A'}`);
      const number=document.createElement('span');number.className='effect-number';number.textContent=String(catalog.findIndex(c=>c.id===row.id)+1).padStart(2,'0');
      const name=document.createElement('strong');name.textContent=row.title;const subtitle=document.createElement('small');subtitle.textContent=descriptions[row.id]?.[0] || row.expresses;
      button.append(number,name,subtitle);button.addEventListener('click',()=>void track(choose(row.id)));$('catalog').append(button);
    }
    if(!result.effects.length){const p=document.createElement('p');p.className='empty';p.textContent='没有匹配的效果。试试“视差”“折叠”，或清空筛选。';$('catalog').append(p);}
  }catch(e){feedback(e.message,true);}
}
const hash=async text=>'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),x=>x.toString(16).padStart(2,'0')).join('');
async function documentValue(){
  stop();await finishPending();
  if(!candidates.length)throw Error('画面尚未准备完成');
  const resolved=await Promise.all(candidates.map(async c=>({recipe:c.binding.getRecipe(),fingerprint:(await planEffect({recipe:c.recipe,state})).fingerprint})));
  return{schema:'worldbend.effect-study',version:'1',candidates:resolved,state:{...state},content:{...content}};
}
function exact(object,keys,label){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).sort().join('|')!==[...keys].sort().join('|'))throw Error(label+'字段不完整或含未知字段');}
async function loadValue(value){
  const token=++generation;value=structuredClone(value);
  exact(value,['schema','version','candidates','state','content'],'方案');if(value.schema!=='worldbend.effect-study'||value.version!=='1')throw Error('不支持的方案版本');
  if(!Array.isArray(value.candidates)||value.candidates.length!==2)throw Error('方案需要两份配方');
  for(const c of value.candidates){exact(c,['recipe','fingerprint'],'配方');if(typeof c.fingerprint!=='string')throw Error('缺少配方指纹');await planEffect({recipe:c.recipe,state:value.state,expectedFingerprint:c.fingerprint});}
  let art;
  if(value.content.kind==='builtin'){
    exact(value.content,['kind','version','theme'],'素材');if(value.content.version!=='1'||!Number.isInteger(value.content.theme)||value.content.theme<0||value.content.theme>2)throw Error('不支持的示例素材');art=makeArtwork(value.content.theme);
  }else if(value.content.kind==='image'){
    exact(value.content,['kind','dataUrl','digest'],'图片');const url=value.content.dataUrl;
    if(typeof url!=='string'||url.length>6_000_000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(url)||await hash(url)!==value.content.digest)throw Error('图片格式或指纹不匹配');
    const header=Uint8Array.from(atob(url.split(',')[1].slice(0,44)),c=>c.charCodeAt(0));
    if(header.length<24||[137,80,78,71,13,10,26,10].some((v,i)=>header[i]!==v)||String.fromCharCode(...header.slice(12,16))!=='IHDR')throw Error('无效的 PNG 头');
    const dims=new DataView(header.buffer),width=dims.getUint32(16),height=dims.getUint32(20);
    if(width<1||height<1||width>2048||height>2048)throw Error('保存图片的尺寸超出限制');
    const image=new Image();image.src=url;await image.decode();if(image.naturalWidth>2048||image.naturalHeight>2048)throw Error('保存图片的尺寸超出限制');art=makeArtwork(0,image);
  }else throw Error('未知素材类型');
  const ok=await replace(value.candidates.map(c=>c.recipe),art,value.content,value.state,value.candidates.map(c=>c.fingerprint),token);
  if(ok){dirty=false;sync();feedback('已打开；两份配方的指纹检查通过。');}return ok;
}
$('save').addEventListener('click',async()=>{try{const value=await documentValue();const blob=new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='worldbend-study.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);dirty=false;sync();feedback('方案已导出，包含素材与当前状态。');}catch(e){feedback(e.message,true);}});
$('load').addEventListener('click',()=>$('load-file').click());
$('load-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(!file)return;void track((async()=>{try{if(file.size>8_000_000)throw Error('方案文件需小于 8 MB');await loadValue(JSON.parse(await file.text()));}catch(e){feedback('打开失败，当前方案已保留：'+e.message,true);}})());});
$('image').addEventListener('click',()=>$('image-file').click());
$('image-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(!file)return;void track((async()=>{const token=++generation;let url;try{
  if(file.size>12_000_000||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('请选择小于 12 MB 的 PNG、JPEG 或 WebP');
  url=URL.createObjectURL(file);const image=new Image();image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>32_000_000)throw Error('图片超过 3200 万像素');
  const c=document.createElement('canvas'),ratio=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));c.width=Math.max(1,Math.round(image.naturalWidth*ratio));c.height=Math.max(1,Math.round(image.naturalHeight*ratio));c.getContext('2d').drawImage(image,0,0,c.width,c.height);
  const dataUrl=c.toDataURL('image/png');if(dataUrl.length>6_000_000)throw Error('图片较复杂，请使用更小的图片');
  const ok=await replace(candidates.map(c=>c.recipe),makeArtwork(0,c),{kind:'image',dataUrl,digest:await hash(dataUrl)},state,[],token);if(ok)feedback('已使用图片。单张图片不会自动分离出前景与背景。');
}catch(e){feedback(e.message,true);}finally{if(url)URL.revokeObjectURL(url);}})());});
$('theme').addEventListener('click',()=>{const theme=content.kind==='builtin'?(content.theme+1)%3:0;void track(replace(candidates.map(c=>c.recipe),makeArtwork(theme),{kind:'builtin',version:'1',theme}));});
document.querySelectorAll('.select-candidate').forEach(button=>button.addEventListener('click',()=>select(+button.dataset.index)));
$('search').addEventListener('input',()=>void renderCatalog());
$('filters').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;intent=button.dataset.intent;for(const b of $('filters').children)b.setAttribute('aria-pressed',b===button);void renderCatalog();});
for(const [id,key]of [['progress','progress'],['pointer-x','pointerX'],['pointer-y','pointerY']])$(id).addEventListener('input',event=>{stop();state[key]=+event.target.value;void update();});
$('reduce').addEventListener('change',event=>{stop();state.reducedMotion=event.target.checked;void update();});reduced.addEventListener('change',()=>{stop();sync();});
$('intensity').addEventListener('input',event=>{stop();const token=++generation,index=selected,c=candidates[index];if(!c?.preset)return;void track((async()=>{try{const recipe=await createEffectRecipe({...c.recipe.origin,intensity:+event.target.value});const recipes=candidates.map(c=>c.recipe);recipes[index]=recipe;await replace(recipes,artwork,content,state,[],token);}catch(e){feedback(e.message,true);}})());});
$('reset').addEventListener('click',()=>{stop();state={...state,progress:.35,pointerX:0,pointerY:0};void update();});
$('play').addEventListener('click',()=>{
  if(playing){stop();return;}if(reduced.matches||state.reducedMotion){feedback('静态查看下不自动播放；关闭后可继续比较。');return;}
  playing=true;playStart=performance.now();$('play').textContent='暂停';
  const tick=now=>{if(!playing)return;const t=(now-playStart)/2400;state.progress=(1-Math.cos(t*Math.PI))/2;state.pointerX=Math.sin(t*Math.PI);state.pointerY=Math.sin(t*Math.PI*.5)*.6;void update();raf=requestAnimationFrame(tick);};raf=requestAnimationFrame(tick);
});
for(let i=0;i<2;i++){
  const view=$(`view-${i}`);
  view.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary||e.target.closest('button'))return;stop();select(i);view.setPointerCapture(e.pointerId);drag={id:e.pointerId,x:e.clientX,y:e.clientY,state:{...state},width:view.clientWidth,height:view.clientHeight};});
  view.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.id)return;state.pointerX=Math.max(-1,Math.min(1,drag.state.pointerX+(e.clientX-drag.x)/drag.width*2));state.pointerY=Math.max(-1,Math.min(1,drag.state.pointerY+(e.clientY-drag.y)/drag.height*2));void update();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])view.addEventListener(name,()=>drag=undefined);
  view.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();stop();select(i);if(e.key==='Home'){state.pointerX=state.pointerY=0;}else{state.pointerX=Math.max(-1,Math.min(1,state.pointerX+(e.key==='ArrowRight'?.1:e.key==='ArrowLeft'?-.1:0)));state.pointerY=Math.max(-1,Math.min(1,state.pointerY+(e.key==='ArrowDown'?.1:e.key==='ArrowUp'?-.1:0)));}void update();});
}
const resize=new ResizeObserver(fit);resize.observe($('view-0'));resize.observe($('view-1'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();drag=undefined;}});window.addEventListener('blur',()=>{stop();drag=undefined;});
window.addEventListener('pagehide',()=>{generation++;stop();resize.disconnect();candidates.forEach(c=>c.binding.dispose());});
window.addEventListener('pageshow',event=>{if(event.persisted){resize.observe($('view-0'));resize.observe($('view-1'));void replace(candidates.map(c=>c.recipe));}});
fetch('../SPATIAL_EFFECTS_CONTRACT.md',{method:'HEAD'}).then(r=>{if(!r.ok)$('contract').href='../../../docs/SPATIAL_EFFECTS_CONTRACT.md';});
// Public demo state is also useful to reproducible browser checks; never evaluates code.
window.worldbendStudy={exportDocument:documentValue,loadDocument:loadValue,getPlans:()=>candidates.map(c=>c.binding.getPlan()),update:async next=>{await Promise.all(candidates.map(c=>planEffect({recipe:c.recipe,state:next})));state={...next};return update();}};
try{catalog=(await discoverEffects({version:'2',carrier:'web',query:''})).effects;const recipes=await Promise.all(['layered-depth','multiplane-camera'].map(effect=>createEffectRecipe({effect,version:'2',viewport,intensity:.8})));await replace(recipes);dirty=false;sync();}catch(e){feedback(e.message,true);}
