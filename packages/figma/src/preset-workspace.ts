import { PRESET_EFFECT_IDS, defaultPresetEffect, type PresetEffectSpec } from "./preset-effect";
import { renderPresetEffect } from "./preset-effect-render";
import type { MainToUiMessage, UiToMainMessage } from "./messages";
import type { DesignerTaskWorkspace } from "./designer-workspace-common";
import { createLatestAsyncQueue } from "./latest-async-queue";

export interface PresetWorkspaceCopy {
  title:string; names:Record<PresetEffectSpec["effect"],string>; amount:string;
  apply:string; applying:string; applied:string; cancel:string; editSource:string;
  loading:string; selectionEmpty:string; previewNote:string;
}
export function createPresetWorkspace(input:{root:HTMLElement;copy():PresetWorkspaceCopy;post(message:UiToMainMessage):void;formatError(error:unknown):string}):DesignerTaskWorkspace {
  const root=input.root;
  root.classList.add("preset-workspace");
  root.innerHTML=`<header class="designer-header"><h1></h1></header><div class="preset-choices" role="group"></div>
    <div class="preset-preview"><canvas aria-label="" role="img"></canvas><p data-role="empty"></p></div>
    <div class="preset-adjust"><label><span></span><input type="range" min="0" max="100" value="100" step="1"></label><p data-role="note"></p></div>
    <footer class="designer-footer"><span role="status"></span><button data-role="edit-source" type="button"></button><button data-role="cancel" type="button"></button><button class="primary" data-role="apply" type="button"></button></footer>
    <p class="designer-error" role="alert" hidden></p>`;
  const el=<T extends HTMLElement>(selector:string):T=>root.querySelector<T>(selector)!;
  const canvas=el<HTMLCanvasElement>("canvas"), choices=el(".preset-choices"), amount=el<HTMLInputElement>("input");
  let active=false,busy=false,generation:number|undefined,requestId=0,ticket=0;
  let node:Extract<MainToUiMessage,{type:"preset-state"}>["node"];
  let owner:typeof node;
  let source:{image:HTMLImageElement;width:number;height:number;state:string}|undefined;
  let spec=defaultPresetEffect(),accepted=defaultPresetEffect();
  let result:Awaited<ReturnType<typeof renderPresetEffect>>|undefined;
  const error=(text?:string)=>{const box=el(".designer-error");box.textContent=text??"";box.hidden=!text;};
  for (const id of PRESET_EFFECT_IDS) {
    const button=document.createElement("button");button.type="button";button.dataset.effect=id;
    button.addEventListener("click",()=>{if(busy)return;spec={...spec,effect:id};void preview();render();});choices.append(button);
  }
  function render():void {
    const c=input.copy();el("h1").textContent=node?.name??c.title;choices.setAttribute("aria-label",c.title);
    for(const button of choices.querySelectorAll<HTMLButtonElement>("button")) {
      const id=button.dataset.effect as PresetEffectSpec["effect"];button.textContent=c.names[id];button.disabled=busy||!source;
      button.setAttribute("aria-pressed",String(spec.effect===id));
    }
    amount.value=String(spec.amount*100);amount.disabled=busy||!source;el(".preset-adjust label span").textContent=c.amount;
    el("[data-role=note]").textContent=c.previewNote;
    el<HTMLButtonElement>("[data-role=apply]").textContent=busy?c.applying:c.apply;
    el<HTMLButtonElement>("[data-role=apply]").disabled=busy||!result||!source;
    el<HTMLButtonElement>("[data-role=edit-source]").textContent=c.editSource;
    el<HTMLButtonElement>("[data-role=edit-source]").hidden=!node?.resultNodeId;
    el<HTMLButtonElement>("[data-role=edit-source]").disabled=busy;
    el<HTMLButtonElement>("[data-role=cancel]").textContent=c.cancel;el<HTMLButtonElement>("[data-role=cancel]").disabled=busy;
    canvas.hidden=!result;canvas.setAttribute("aria-label",`${c.names[spec.effect]} · ${node?.name??c.title}`);
    el("[data-role=empty]").hidden=Boolean(result);el("[data-role=empty]").textContent=node?c.loading:c.selectionEmpty;
  }
  const previews=createLatestAsyncQueue(async ({current,snapshot,next}:{current:number;snapshot:NonNullable<typeof source>;next:PresetEffectSpec})=>{
    try {
      const rendered=await renderPresetEffect(snapshot.image,{width:snapshot.width,height:snapshot.height},next);
      if(!active||current!==ticket||source!==snapshot)return;
      result=rendered;canvas.width=rendered.canvas.width;canvas.height=rendered.canvas.height;
      canvas.getContext("2d")!.drawImage(rendered.canvas,0,0);render();
    } catch(e){if(active&&current===ticket){error(input.formatError(e));render();}}
  });
  function preview():void {
    const current=++ticket;result=undefined;error();render();
    if(active&&source)previews.request({current,snapshot:source,next:{...spec}});
  }
  amount.addEventListener("input",()=>{spec={...spec,amount:Number(amount.value)/100};void preview();});
  el("[data-role=cancel]").addEventListener("click",()=>{spec={...accepted};void preview();});
  el("[data-role=edit-source]").addEventListener("click",()=>{if(generation!==undefined&&!busy)input.post({type:"edit-preset-source",generation});});
  el("[data-role=apply]").addEventListener("click",()=>{
    if(!active||busy||!result||!source||!node||generation===undefined)return;
    busy=true;render();input.post({type:"apply-preset-effect",generation,sourceNodeId:node.nodeId,sourceState:source.state,spec:{...spec},raster:result.raster});
  });
  function clear():void {++ticket;previews.cancel();source=undefined;result=undefined;busy=false;error();el('[role="status"]').textContent="";render();}
  function request():void {if(active)input.post({type:"request-preset-state"});}
  return {
    enter(){active=true;root.hidden=false;clear();request();},
    leave(){active=false;++ticket;previews.cancel();busy=false;root.hidden=true;source=undefined;result=undefined;},
    setSource(){clear();request();},selectionLoading(){clear();},clearSource(){node=undefined;clear();},updateLocale(){render();},
    handleMainMessage(raw){
      if(!active)return false;
      const message=raw as MainToUiMessage;
      if(message.type==="preset-state") {
        if(generation!==undefined&&message.generation<generation)return true;
        const same=owner?.nodeId===message.node?.nodeId&&owner?.resultNodeId===message.node?.resultNodeId;
        const authored=JSON.stringify(spec)!==JSON.stringify(accepted);
        generation=message.generation;node=message.node;owner=message.node;clear();
        accepted={...(node?.spec??defaultPresetEffect())};
        if(!same||!authored)spec={...accepted};
        if(message.message)error(input.formatError(message.message));
        if(node)input.post({type:"request-preset-source",generation,requestId:++requestId,nodeId:node.nodeId});render();return true;
      }
      if(message.type==="preset-source") {
        if(message.generation!==generation||message.requestId!==requestId)return true;
        const current=++ticket;const image=new Image();image.src=`data:image/png;base64,${message.bytes}`;
        void image.decode().then(()=>{if(!active||current!==ticket)return;source={image,width:message.width,height:message.height,state:message.sourceState};void preview();},e=>{if(active&&current===ticket)error(input.formatError(e));});return true;
      }
      if(message.type==="preset-applied") {
        if(message.generation!==generation)return true;busy=false;accepted={...spec};el('[role="status"]').textContent=input.copy().applied;render();return true;
      }
      if(message.type==="preset-error") {
        if(message.generation!==generation||(message.requestId!==undefined&&message.requestId!==requestId))return true;
        busy=false;error(input.formatError(message.message));render();return true;
      }
      return false;
    },
    handleKeydown(event){if(event.key!=="Escape"||busy)return false;spec={...accepted};preview();return true;},
    dispose(){active=false;++ticket;previews.cancel();source=undefined;result=undefined;root.replaceChildren();},
  };
}
