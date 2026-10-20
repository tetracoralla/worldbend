import {attachDocumentMotion} from '../../dist/document-motion.js';
import {artwork} from '../scene-motion/artwork.js';
const element=id=>document.getElementById(id),host=element('scene'),play=element('play'),position=element('position'),time=element('time'),next=element('artwork'),timing=element('timing'),status=element('status');
const storageKey='worldbend-document-motion-study-v1';
const original=await (await fetch('./document.json')).json();
let accepted,session,updating=false,reopening;
const assets=alternate=>Object.fromEntries(artwork(alternate).map(source=>[source.id,source.image]));
function display(state){play.textContent=state.paused?'Play scene':'Pause';play.disabled=state.reducedMotion||state.status!=='ready';position.value=String(Math.round(state.timeMs/state.durationMs*1000));time.textContent=(state.timeMs/1000).toFixed(1)+' s';}
function save(){const state=session.getState();accepted={...accepted,timeMs:state.timeMs,paused:state.paused};try{localStorage.setItem(storageKey,JSON.stringify(accepted));}catch{/* Current editing remains available without storage. */}}
function sync(){next.textContent=accepted.alternate?'Original artwork':'Next artwork';timing.textContent=accepted.slow?'Original rhythm':'Slower rhythm';status.textContent=accepted.alternate?'2027 / 02':'2026 / 10';}
async function open(){
 session=await attachDocumentMotion(host,accepted.document,'book',assets(accepted.alternate),{paused:true,onChange:display,onError:error=>status.textContent=error.message});
 session.seek(accepted.timeMs);if(!accepted.paused)session.play();
 position.disabled=next.disabled=timing.disabled=false;sync();
}
try{
 const saved=JSON.parse(localStorage.getItem(storageKey)??'null');
 accepted=saved&&typeof saved.alternate==='boolean'&&typeof saved.slow==='boolean'&&Number.isFinite(saved.timeMs)&&typeof saved.paused==='boolean'?saved:{document:structuredClone(original),alternate:false,slow:false,timeMs:0,paused:true};
 try{await open();}catch(error){if(!saved)throw error;accepted={document:structuredClone(original),alternate:false,slow:false,timeMs:0,paused:true};await open();}
 play.onclick=()=>{session.getState().paused?session.play():session.pause();save();};
 position.oninput=()=>{const requested=Number(position.value);session.pause();session.seek(requested/1000*session.getState().durationMs);save();};
 const update=async kind=>{
  if(updating)return;updating=true;next.disabled=timing.disabled=true;
  const candidate={...accepted,document:session.getDocument()};
  try{
   if(kind==='artwork'){candidate.alternate=!accepted.alternate;for(const asset of candidate.document.assets)asset.contentVersion=candidate.alternate?'2027-02':'2026-10';}
   else{candidate.slow=!accepted.slow;candidate.document.expressions[0].video.mockupMotion.timebase={numerator:candidate.slow?24:32,denominator:1};}
   await session.revise(candidate.document,assets(candidate.alternate),session.getGuard());
   accepted=candidate;save();sync();
  }catch(error){status.textContent=error.message;}finally{updating=false;next.disabled=timing.disabled=false;}
 };
 next.onclick=()=>update('artwork');timing.onclick=()=>update('timing');
 globalThis.documentMotionStudy={get session(){return session;},get accepted(){return accepted;},assets,update,host};
}catch(error){status.textContent=error.message;globalThis.documentMotionError=error.stack;}
window.addEventListener('pagehide',()=>{if(session){save();session.destroy();for(const control of [play,position,next,timing])control.disabled=true;}});
window.addEventListener('pageshow',()=>{if(!session||session.getState().status!=='disposed'||reopening)return;reopening=open().catch(error=>status.textContent=error.message).finally(()=>{reopening=undefined;});});
