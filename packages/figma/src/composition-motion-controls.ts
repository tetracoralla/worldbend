import {attachMockupMotion,type MockupMotionController} from "@worldbend/web/mockup-motion";
import {planMockupMotion,type MockupMotionEdit} from "@worldbend/web";
import {startCompositionMotion,poseComposition,reviseCompositionMotion,synchronizeCompositionMotion,type MotionComposition} from "./composition-motion";
import type {FigmaCompositionTask} from "./stored-designer-task";
import type {LoadedDesignerSource} from "./designer-workspace-common";

export interface CompositionMotionCopy { title:string; enable:string; play:string; pause:string; position:string; duration:string; capture:string; remove:string; easing:string; linear:string; smooth:string; hold:string; reduced:string }
export function createCompositionMotionControls(input:{
  inspector:HTMLElement;preview:HTMLElement;output:HTMLCanvasElement;
  getTask():FigmaCompositionTask|undefined;getPlaneId():string;getEditScope():"whole"|"layers";getTargetLabel():string;isBlocked():boolean;onPresent():void;
  getSources():LoadedDesignerSource[];
  setTask(task:FigmaCompositionTask,record:boolean):void;
  setBusy(value:boolean):void;render():void;showError(message?:string):void;
  copy():CompositionMotionCopy;formatError(error:unknown):string;
}) {
  const root=document.createElement("details");root.className="designer-motion";
  root.innerHTML=`<summary></summary><label class="designer-check"><input data-motion="enable" type="checkbox"><span></span></label><div data-motion="editor" hidden><div class="designer-motion-transport"><button data-motion="play" type="button"></button><input data-motion="position" type="range" min="0" step="1"><output></output></div><label class="designer-field"><span data-motion="duration-label"></span><input data-motion="duration" type="number" min="0.0416666667" max="10" step="any"></label><div class="designer-action-stack"><button data-motion="capture" type="button"></button><button data-motion="remove" type="button"></button></div><label class="designer-field"><span data-motion="easing-label"></span><select data-motion="easing"><option value="linear"></option><option value="smooth"></option><option value="hold"></option></select></label></div>`;
  input.inspector.prepend(root);
  const role=<T extends HTMLElement>(name:string)=>root.querySelector<T>(`[data-motion="${name}"]`)!;
  const enable=role<HTMLInputElement>("enable"),editor=role<HTMLDivElement>("editor"),play=role<HTMLButtonElement>("play"),position=role<HTMLInputElement>("position"),duration=role<HTMLInputElement>("duration"),capture=role<HTMLButtonElement>("capture"),remove=role<HTMLButtonElement>("remove"),easing=role<HTMLSelectElement>("easing"),time=root.querySelector("output")!;
  let lastError:string|undefined;
  const report=(error?:unknown)=>{lastError=error===undefined?undefined:typeof error==="string"?error:input.formatError(error);input.showError(lastError)};
  let epoch=0,pending=false,receiver:MockupMotionController|undefined,host:HTMLDivElement|undefined,paint=0,retired=false,hadMotion=false,seeking=false,wantedFrame:number|undefined,sessionAbort:AbortController|undefined,started=false;
  const smooth={kind:"cubicBezier" as const,x1:.22,y1:0,x2:.35,y2:1};
  function sync(){
    const locked=input.isBlocked()&&!pending&&!receiver;
    const copy=input.copy(),task=input.getTask(),motion=task?.kind==="composition"?task.motion:undefined;
    root.querySelector("summary")!.textContent=copy.title+" · "+input.getTargetLabel();root.querySelector("label span")!.textContent=copy.enable;
    enable.checked=Boolean(motion);enable.disabled=pending||Boolean(receiver)||!task||locked;
    editor.hidden=!motion;play.textContent=receiver?copy.pause:copy.play;play.disabled=pending||!motion||locked;
    role("duration-label").textContent=copy.duration;role("easing-label").textContent=copy.easing;
    capture.textContent=copy.capture;remove.textContent=copy.remove;
    position.setAttribute("aria-label",copy.position);play.setAttribute("aria-pressed",String(Boolean(receiver)));
    for(const option of easing.options)option.textContent=option.value==="smooth"?copy.smooth:option.value==="hold"?copy.hold:copy.linear;
    if(motion&&!hadMotion)root.open=true;hadMotion=Boolean(motion);
    if(!motion)return;
    const frame=receiver?.getState().frameIndex??motion.frame,spec=motion.spec,plane=spec.planes.find(p=>p.id===input.getPlaneId());
    position.max=String(spec.frameCount-1);position.value=String(frame);
    duration.value=String(spec.frameCount*spec.timebase.denominator/spec.timebase.numerator);
    time.value=(frame*spec.timebase.denominator/spec.timebase.numerator).toFixed(2)+" / "+Number(duration.value).toFixed(2)+" s";
    const keys=input.getEditScope()==="whole"?spec.presentation?.keyframes:plane?.keyframes;
    const key=keys?.find(k=>k.frame===frame);easing.value=key?.easingToNext?.kind==="hold"?"hold":key?.easingToNext?.kind==="cubicBezier"?"smooth":"linear";
    for(const control of [position,duration,capture,easing])control.disabled=(pending&&!(control===position&&seeking))||Boolean(receiver)||locked;
    easing.disabled=pending||Boolean(receiver)||locked||frame===spec.frameCount-1;
    remove.disabled=pending||Boolean(receiver)||locked||!key||frame===0||frame===spec.frameCount-1;
  }
  async function change(run:(task:FigmaCompositionTask)=>Promise<FigmaCompositionTask>,record=true){
    if(pending||receiver||retired||input.isBlocked())return;
    const task=input.getTask();if(!task)return;
    const own=++epoch;pending=true;input.setBusy(true);sync();
    try {
      const next=await run(task);
      if(own!==epoch||input.getTask()!==task)return;
      input.setTask(next,record);report();
    }catch(error){if(own===epoch)report(error);}
    finally{if(own===epoch){pending=false;input.setBusy(false);sync();input.render();}}
  }
  const edit=(value:MockupMotionEdit)=>change(task=>{
    if(task.kind!=="composition")throw Error("Enable animation first");
    return reviseCompositionMotion(task,value);
  });
  enable.onchange=()=>{const requested=enable.checked;void change(task=>requested?startCompositionMotion(task):Promise.resolve((()=>{if(task.kind!=="composition")return task;const {motion,...still}=task;return still})()))};
  position.oninput=()=>{wantedFrame=Number(position.value);void seekLatest()};
  async function seekLatest(){
    if(seeking)return;
    if(pending||receiver||retired||input.isBlocked())return;
    const task=input.getTask();if(task?.kind!=="composition"||!task.motion)return;
    const own=++epoch;seeking=true;pending=true;input.setBusy(true);sync();
    try{
      const plan=await planMockupMotion(task.motion.spec);
      if(own!==epoch||input.getTask()!==task)return;
      const frame=wantedFrame??task.motion.frame;wantedFrame=undefined;
      const next=await poseComposition(task,frame,plan);
      if(own===epoch&&input.getTask()===task)input.setTask(next,false);
    }catch(error){if(own===epoch)report(error)}
    finally{if(own===epoch){seeking=false;pending=false;input.setBusy(false);sync();input.render();if(wantedFrame!==undefined)void seekLatest()}}
  }
  duration.onchange=()=>{const task=input.getTask();if(task?.kind!=="composition"||!task.motion)return;void edit({kind:"retime",timebase:task.motion.spec.timebase,frameCount:Math.round(Number(duration.value)*task.motion.spec.timebase.numerator/task.motion.spec.timebase.denominator)})};
  capture.onclick=()=>{const task=input.getTask();if(task?.kind!=="composition"||!task.motion)return;const frame=task.motion.frame,ending=frame===task.motion.spec.frameCount-1;
    if(input.getEditScope()==="whole"){const stage=task.template.operation.postprocess.stages[0];if(stage?.kind==="transform")void edit({kind:"setPresentationKeyframe",keyframe:{frame,quad:stage.spec.destination.quad,...(ending?{}:{easingToNext:smooth})}})}
    else void edit({kind:"capturePose",frame,...(ending?{}:{easingToNext:smooth})});};
  remove.onclick=()=>{const task=input.getTask();if(task?.kind==="composition"&&task.motion)void edit(input.getEditScope()==="whole"?{kind:"removePresentationKeyframe",frame:task.motion.frame}:{kind:"removeKeyframe",planeId:input.getPlaneId(),frame:task.motion.frame})};
  easing.onchange=()=>{const task=input.getTask();if(task?.kind!=="composition"||!task.motion)return;
    const ease=easing.value==="smooth"?smooth:{kind:easing.value as "linear"|"hold"};
    if(input.getEditScope()==="whole"){const stage=task.template.operation.postprocess.stages[0];if(stage?.kind==="transform")void edit({kind:"setPresentationKeyframe",keyframe:{frame:task.motion.frame,quad:stage.spec.destination.quad,easingToNext:ease}})}
    else {const plane=task.template.operation.composition.planes.find(p=>p.id===input.getPlaneId());if(plane)void edit({kind:"setKeyframe",planeId:plane.id,keyframe:{frame:task.motion.frame,quad:plane.transform.destination.quad,easingToNext:ease}})}
  };
  function suspend(clearError=true){if(clearError)lastError=undefined;++epoch;pending=false;seeking=false;wantedFrame=undefined;started=false;sessionAbort?.abort();sessionAbort=undefined;if(paint)cancelAnimationFrame(paint);paint=0;receiver?.destroy();receiver=undefined;host?.remove();host=undefined;input.setBusy(false);sync();}
  async function pause(){
    if(!receiver)return;const task=input.getTask(),frame=receiver.getState().frameIndex;started=false;receiver.pause();suspend();
    if(task?.kind==="composition"&&task.motion)await change(current=>current===task?poseComposition(task,frame):Promise.resolve(current),false);
  }
  play.onclick=()=>void (receiver?pause():start());
  async function start(){
    if(retired||pending||input.isBlocked())return;let task=input.getTask();if(task?.kind!=="composition"||!task.motion)return;
    const original=task,own=++epoch;sessionAbort=new AbortController();pending=true;input.setBusy(true);sync();
    let created:MockupMotionController|undefined;
    try{
      task=await synchronizeCompositionMotion(task);if(own!==epoch||input.getTask()!==original)return;
      const current=task as MotionComposition;
      host=document.createElement("div");host.style.cssText="position:absolute;inset:0;opacity:0;pointer-events:none";host.setAttribute("aria-hidden","true");input.preview.append(host);
      const sources=current.motion!.spec.planes.map(p=>p.sourceId).filter((id,index,ids)=>ids.indexOf(id)===index).map(id=>{
        const match=/^source-(\d+)$/.exec(id),source=match?input.getSources()[Number(match[1])-1]:undefined;
        if(!source)throw Error("Animation source binding is unavailable");return {id,image:source.image};
      });
      const present=async()=>{
        if(own!==epoch||!created||retired)return;
        const result=created.canvas;
        if(own!==epoch||retired)return;
        input.output.width=result.width;input.output.height=result.height;const ctx=input.output.getContext("2d");if(!ctx)throw Error("Canvas 2D is required");ctx.clearRect(0,0,result.width,result.height);ctx.drawImage(result,0,0);input.onPresent();sync();
      };
      const request=()=>{if(started&&created?.getState().paused&&created.getState().status==="ready"){void pause();return}if(paint||own!==epoch)return;paint=requestAnimationFrame(()=>{paint=0;void present().catch(error=>{if(own===epoch){report(error);suspend(false);input.render()}})})};
      created=await attachMockupMotion(host,current.motion!.spec,sources,{paused:true,signal:sessionAbort.signal,onChange:request,onError:error=>report(error)});
      if(own!==epoch||input.getTask()!==original){created.destroy();return;}
      receiver=created;report();input.setTask(current,false);receiver.seek(current.motion!.frame===current.motion!.spec.frameCount-1?0:current.motion!.frame*1000*current.motion!.spec.timebase.denominator/current.motion!.spec.timebase.numerator);
      await present();pending=false;if(!receiver.play()){report(input.copy().reduced);suspend(false);input.render();return;}started=true;sync();
    }catch(error){if(own===epoch){report(error);suspend(false);input.render()}}
    finally{if(own===epoch){pending=false;if(!receiver)input.setBusy(false);sync();}}
  }
  return {sync,suspend,dispose(){retired=true;suspend();root.remove()},get playing(){return Boolean(receiver)},get error(){return lastError}};
}
