import {attachMockupMotion,type MockupMotionController} from "@worldbend/web/mockup-motion";
import {synchronizeCompositionMotion} from "./composition-motion";
import type {LoadedDesignerSource} from "./designer-workspace-common";
import type {FigmaCompositionTask} from "./stored-designer-task";
import type {MainToUiMessage,UiToMainMessage} from "./messages";

export function createCompositionSceneAnimation(input:{
 inspector:HTMLElement;preview:HTMLElement;getTask():FigmaCompositionTask|undefined;getSources():LoadedDesignerSource[];
 getGeneration():number|undefined;hasScene():boolean;isBlocked():boolean;setBusy(value:boolean):void;post(message:UiToMainMessage):void;
 copy():{create:string;cancel:string;save:string};showError(message?:string):void;render():void;
}) {
 const root=document.createElement("div");root.className="designer-action-stack";
 const create=document.createElement("button"),cancel=document.createElement("button"),download=document.createElement("a"),progress=document.createElement("output");
 create.type=cancel.type="button";create.dataset["sceneAnimation"]="create";cancel.dataset["sceneAnimation"]="cancel";download.dataset["sceneAnimation"]="download";
 progress.setAttribute("aria-live","polite");
 root.append(create,cancel,progress,download);input.inspector.prepend(root);
 let epoch=0,nextId=1,active:{generation:number;requestId:number}|undefined,controller:MockupMotionController|undefined,host:HTMLElement|undefined,lifetime:AbortController|undefined,url:string|undefined;
 let waiting:{resolve(message:Extract<MainToUiMessage,{type:"scene-animation-reply"}>):void;reject(error:Error):void;timer:ReturnType<typeof setTimeout>}|undefined;
 function sync(){const copy=input.copy();create.textContent=copy.create;cancel.textContent=copy.cancel;download.textContent=copy.save;
  root.hidden=!input.hasScene();create.disabled=input.isBlocked()||Boolean(active)||input.getTask()?.kind!=="composition"||!((input.getTask() as Extract<FigmaCompositionTask,{kind:"composition"}>|undefined)?.motion);
  cancel.hidden=!active;cancel.disabled=false;download.hidden=!url;}
 function stop(){++epoch;lifetime?.abort();lifetime=undefined;if(active)input.post({type:"scene-animation-cancel",...active});active=undefined;if(waiting){clearTimeout(waiting.timer);waiting.reject(Error("Scene animation cancelled"));waiting=undefined;}controller?.destroy();controller=undefined;host?.remove();host=undefined;input.setBusy(false);progress.value="";sync();}
 function request(message:UiToMainMessage){return new Promise<Extract<MainToUiMessage,{type:"scene-animation-reply"}>>((resolve,reject)=>{
  if(waiting){reject(Error("Scene animation request is already pending"));return;}
  waiting={resolve,reject,timer:setTimeout(()=>{waiting=undefined;reject(Error("Scene animation timed out. The editable scene is retained if it was already created."));},120000)};input.post(message);
 });}
 create.onclick=()=>void (async()=>{
  if(input.isBlocked()||active)return;const original=input.getTask(),generation=input.getGeneration();if(original?.kind!=="composition"||!original.motion||generation===undefined)return;
  const own=++epoch,ownLifetime=new AbortController();let ownController:MockupMotionController|undefined,ownHost:HTMLElement|undefined;lifetime=ownLifetime;active={generation,requestId:nextId++};input.setBusy(true);input.showError();sync();
  const check=()=>{if(own!==epoch||input.getTask()!==original)throw Error("Scene changed. Select artwork and retry.");};
  try{
   const task=await synchronizeCompositionMotion(original);check();
   ownHost=document.createElement("div");ownHost.style.cssText="position:absolute;opacity:0;pointer-events:none";input.preview.append(ownHost);host=ownHost;
   const sources=[...new Set(task.motion!.spec.planes.map(p=>p.sourceId))].map(id=>{const match=/^source-(\d+)$/.exec(id),source=match?input.getSources()[Number(match[1])-1]:undefined;if(!source)throw Error("Animation source binding is unavailable");return {id,image:source.image};});
   ownController=await attachMockupMotion(ownHost,task.motion!.spec,sources,{paused:true,signal:ownLifetime.signal});check();controller=ownController;
   await request({type:"scene-animation-begin",...active!,task,renderWidth:ownController.canvas.width,renderHeight:ownController.canvas.height});check();
   for(let index=0;index<task.motion!.spec.frameCount;index++){
    ownController.seek(index*1000*task.motion!.spec.timebase.denominator/task.motion!.spec.timebase.numerator);
    const blob=await new Promise<Blob>((resolve,reject)=>ownController!.canvas.toBlob(b=>b?resolve(b):reject(Error("Animation frame encoding failed")),"image/png"));check();
    const bytes=new Uint8Array(await blob.arrayBuffer());check();
    const reply=await request({type:"scene-animation-frame",...active!,index,bytes});check();if(reply.index!==index)throw Error("Native animation acknowledged a different frame");progress.value=`${index+1} / ${task.motion!.spec.frameCount}`;
   }
   progress.value="…";const result=await request({type:"scene-animation-finish",...active!});check();
   if(!result.bytes?.length)throw Error("The native scene was created but its video is unavailable. Export it from Motion.");
   if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([new Uint8Array(result.bytes)],{type:"video/mp4"}));download.href=url;download.download=result.name??"scene-animation.mp4";
   active=undefined;progress.value="";
  }catch(error){if(own===epoch){input.showError(error instanceof Error?error.message:String(error));stop();}}
  finally{ownController?.destroy();ownHost?.remove();ownLifetime.abort();if(own===epoch){controller=undefined;host=undefined;lifetime=undefined;input.setBusy(false);sync();input.render();}}
 })();
 cancel.onclick=stop;
 return {sync,suspend:stop,handle(message:MainToUiMessage){if(message.type!=="scene-animation-reply")return false;if(!active||active.generation!==message.generation||active.requestId!==message.requestId||!waiting)return true;
  const callback=waiting;waiting=undefined;clearTimeout(callback.timer);if(message.stage==="error")callback.reject(Error(message.message??"Scene animation failed"));else callback.resolve(message);return true;
 },dispose(){stop();if(url)URL.revokeObjectURL(url);root.remove()}};
}
