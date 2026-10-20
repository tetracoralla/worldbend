import {receivingInstanceId} from "./receiving-instance-id";
import {attachAppearance,validateAppearanceDelivery,type AppearanceHandle,type AppearanceOptions} from './appearance';
import {attachTexture,validateTextureDelivery,type TextureHandle,type TextureOptions} from './texture';
import {attachFoil,validateFoilDelivery,type FoilHandle,type FoilOptions} from './foil';
import {attachMeshGradient,validateMeshGradientDelivery,type MeshGradientHandle,type MeshGradientOptions} from './mesh-gradient';
import type {SpatialDocumentDeliveryPlan,SpatialMaterialDelivery} from './generated/core-contract';
export type {SpatialDocumentDeliveryPlan} from './generated/core-contract';
type Family=SpatialMaterialDelivery['family'];
type Handle=AppearanceHandle|TextureHandle|FoilHandle|MeshGradientHandle;
export interface MaterialDocumentBinding {expressionId:string;slotId:string;assetId:string;family:Family}
type Entry=MaterialDocumentBinding & {element:HTMLElement;document:Document;material:SpatialMaterialDelivery};
type Active={entry:Entry;handle:Handle;controller:AbortController};
export interface MaterialDocumentGuard {instance:string;documentFingerprint:string;generation:number;runtime:string}
export interface MaterialDocumentState {
  plan:SpatialDocumentDeliveryPlan;guard:MaterialDocumentGuard;busy:boolean;paused:boolean;destroyed:boolean;
  surfaces:Array<MaterialDocumentBinding & {status:string;time?:number;reducedMotion?:boolean}>;
}
export interface MaterialDocumentOptions {
  /** Resolve existing content surfaces; the receiver never replaces their content. */
  resolveSurface(binding:MaterialDocumentBinding):HTMLElement;
  paused?:boolean;signal?:AbortSignal;
  glass?:Omit<AppearanceOptions,'deferPresentation'>;texture?:Omit<TextureOptions,'deferPresentation'>;
  foil?:Omit<FoilOptions,'signal'|'onError'|'deferPresentation'|'paused'>;
  mesh?:Omit<MeshGradientOptions,'signal'|'onError'|'deferPresentation'|'paused'>;
  onError?:(error:Error,binding:MaterialDocumentBinding)=>void;
}
export interface MaterialDocumentSession {
  getState():MaterialDocumentState;
  /** Prepare every addition before publishing. Stale/cancelled revisions keep the accepted work. */
  revise(plan:SpatialDocumentDeliveryPlan,guard:MaterialDocumentGuard,signal?:AbortSignal):Promise<void>;
  setPaused(paused:boolean):void;
  /** Recover only unavailable renderers; successful surfaces and clocks remain attached. */
  recover():Promise<void>;
  destroy():void;
}
const fingerprint=/^sha256:[0-9a-f]{64}$/;
function identity(value:unknown):value is string{return typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=128&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value)}
function validate(material:SpatialMaterialDelivery){
  switch(material?.family){
    case 'glass':validateAppearanceDelivery(material.delivery);break;
    case 'texture':validateTextureDelivery(material.delivery);break;
    case 'foil':validateFoilDelivery(material.delivery);break;
    case 'mesh-gradient':validateMeshGradientDelivery(material.delivery);break;
    default:throw Error('Unsupported material family');
  }
}
function snapshot(plan:SpatialDocumentDeliveryPlan):SpatialDocumentDeliveryPlan{
  if(plan?.schema!=='worldbend.spatial-document-delivery-plan'||plan.version!=='0.1'||!fingerprint.test(plan.documentFingerprint)||
    !Array.isArray(plan.deliveries)||plan.deliveries.length<1||plan.deliveries.length>32)throw Error('Invalid material document delivery');
  const ids=new Set<string>();
  for(const item of plan.deliveries){
    if(item.kind!=='material')throw Error('This receiver executes material expressions; use the owning carrier for other expressions');
    if(!identity(item.id)||ids.has(item.id)||!Array.isArray(item.bindings)||!item.bindings.length||item.bindings.length>64)throw Error('Invalid material expression');ids.add(item.id);
    validate(item.material);const slots=new Set<string>();
    for(const binding of item.bindings){if(binding.role!=='content'||!identity(binding.slotId)||!identity(binding.assetId)||slots.has(binding.slotId))throw Error('Invalid material content binding');slots.add(binding.slotId)}
  }
  const text=JSON.stringify(plan);if(new TextEncoder().encode(text).length>8*1024*1024)throw Error('Material delivery exceeds the receiving record budget');
  return JSON.parse(text) as SpatialDocumentDeliveryPlan;
}
function update(active:Active,material:SpatialMaterialDelivery){
  // This switch preserves the exact family-specific type and owning validator.
  switch(material.family){
    case 'glass':(active.handle as AppearanceHandle).update(material.delivery);break;
    case 'texture':(active.handle as TextureHandle).update(material.delivery);break;
    case 'foil':(active.handle as FoilHandle).update(material.delivery);break;
    case 'mesh-gradient':(active.handle as MeshGradientHandle).update(material.delivery);break;
  }
}
function state(active:Active){return 'getState' in active.handle?active.handle.getState():{status:'ready'}}
function retire(active:Active){active.handle.destroy();active.controller.abort()}

/** Continue a multi-surface material work over the existing family renderers.
 * Source/document meaning remains canonical; host content and storage stay host-owned.
 */
export async function attachMaterialDocument(initial:SpatialDocumentDeliveryPlan,options:MaterialDocumentOptions):Promise<MaterialDocumentSession>{
  let accepted=snapshot(initial),active:Active[]=[],busy=false,destroyed=false,generation=0,paused=options.paused??false;
  if(typeof paused!=='boolean'||typeof options.resolveSurface!=='function')throw Error('Invalid material receiving options');
  let pending:AbortController|undefined;
  const instance=receivingInstanceId(globalThis.crypto);
  function alive(){if(destroyed)throw Error('Material document session is destroyed')}
  function currentGuard():MaterialDocumentGuard{return {instance,documentFingerprint:accepted.documentFingerprint,generation,
    runtime:JSON.stringify(active.map(a=>{const s=state(a);return [s.status,'reducedMotion'in s?s.reducedMotion:false]}))}}
  function check(guard:MaterialDocumentGuard){alive();const now=currentGuard();if(!guard||now.instance!==guard.instance||now.documentFingerprint!==guard.documentFingerprint||now.generation!==guard.generation||now.runtime!==guard.runtime)throw Error('Stale material document state')}
  function entries(plan:SpatialDocumentDeliveryPlan):Entry[]{
    const result:Entry[]=[];const surfaces=new Map<HTMLElement,Set<Family>>();
    for(const item of plan.deliveries){if(item.kind!=='material')continue;
      for(const binding of item.bindings){const ref={expressionId:item.id,slotId:binding.slotId,assetId:binding.assetId,family:item.material.family};
        const element=options.resolveSurface({...ref});
        if(!element?.ownerDocument?.defaultView||!(element instanceof element.ownerDocument.defaultView.HTMLElement))throw Error('A material surface is unavailable');
        const families=surfaces.get(element)??new Set<Family>();
        if(families.has(ref.family))throw Error('One surface cannot own two bindings of the same material family');families.add(ref.family);surfaces.set(element,families);
        result.push({...ref,element,document:element.ownerDocument,material:item.material});
      }
    }return result;
  }
  async function prepare(entry:Entry,signal:AbortSignal):Promise<Active>{
    const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)controller.abort();
    const onError=(error:Error)=>queueMicrotask(()=>{const current=active.find(a=>a.controller===controller);if(!destroyed&&current){
      const {expressionId,slotId,assetId,family}=current.entry;try{options.onError?.(error,{expressionId,slotId,assetId,family});}catch{/* A host reporter cannot escape the receiving lifecycle. */}
    }});
    try{
      let handle:Handle;
      switch(entry.material.family){
        case 'glass':handle=attachAppearance(entry.element,entry.material.delivery,{...options.glass,deferPresentation:true});break;
        case 'texture':handle=attachTexture(entry.element,entry.material.delivery,{...options.texture,deferPresentation:true});break;
        case 'foil':handle=await attachFoil(entry.element,entry.material.delivery,{...options.foil,paused,deferPresentation:true,signal:controller.signal,onError});break;
        case 'mesh-gradient':handle=await attachMeshGradient(entry.element,entry.material.delivery,{...options.mesh,paused,deferPresentation:true,signal:controller.signal,onError});break;
      }
      if(controller.signal.aborted){handle.destroy();throw new DOMException('Material document cancelled','AbortError')}
      return {entry,handle,controller};
    }catch(error){controller.abort();throw error}finally{signal.removeEventListener('abort',abort)}
  }
  async function publish(plan:SpatialDocumentDeliveryPlan,guard:MaterialDocumentGuard|undefined,signal?:AbortSignal){
    alive();if(busy)throw Error('A material document revision is already running');if(guard)check(guard);
    const next=snapshot(plan),start=currentGuard();busy=true;pending=new AbortController();const operation=pending;
    const abort=()=>operation.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted||options.signal?.aborted)operation.abort();
    const additions:Active[]=[],retained:Array<{active:Active;next:Entry}>=[],order:Active[]=[];
    try{
      const resolved=entries(next);
      for(const entry of resolved){
        if(operation.signal.aborted)throw new DOMException('Material document cancelled','AbortError');
        const existing=active.find(a=>a.entry.element===entry.element&&a.entry.family===entry.family);
        if(existing){if(existing.entry.document!==entry.document)throw Error('A receiving surface moved to another document; reattach its current work');retained.push({active:existing,next:entry});order.push(existing)}else{const made=await prepare(entry,operation.signal);additions.push(made);order.push(made)}
      }
      for(const entry of resolved){const {expressionId,slotId,assetId,family}=entry;
        if(entry.element.ownerDocument!==entry.document||options.resolveSurface({expressionId,slotId,assetId,family})!==entry.element)throw Error('A receiving surface changed during preparation');}
      check(start);if(operation.signal.aborted)throw new DOMException('Material document cancelled','AbortError');
      const touched:Array<{active:Active;before:Entry}>=[];
      try{
        // No awaits in this phase: browser paint cannot publish a partial document.
        for(const made of additions)made.handle.present();
        for(const item of retained){touched.push({active:item.active,before:item.active.entry});update(item.active,item.next.material);
          if(state(item.active).status!=='ready')throw Error('A material renderer is unavailable; recover the current work before revising');}
      }catch(error){const failures:unknown[]=[error];for(const item of touched.reverse()){try{update(item.active,item.before.material)}catch(rollback){failures.push(rollback)}}
        if(failures.length>1)throw new AggregateError(failures,'Material revision failed; one or more renderers need recovery');throw error}
      for(const old of active)if(!order.includes(old))retire(old);
      for(const item of retained)item.active.entry=item.next;
      active=order;accepted=next;generation++;
    }catch(error){for(const made of additions)retire(made);throw error}
    finally{signal?.removeEventListener('abort',abort);pending=undefined;busy=false}
  }
  function destroy(){if(destroyed)return;destroyed=true;generation++;pending?.abort();for(const a of active)retire(a);active=[];options.signal?.removeEventListener('abort',destroy)}
  options.signal?.addEventListener('abort',destroy,{once:true});
  try{await publish(accepted,undefined)}catch(error){destroy();throw error}
  return {
    getState:()=>({plan:structuredClone(accepted),guard:currentGuard(),busy,paused,destroyed,
      surfaces:active.map(a=>({expressionId:a.entry.expressionId,slotId:a.entry.slotId,assetId:a.entry.assetId,family:a.entry.family,...state(a)}))}),
    revise:(next,guard,signal)=>publish(next,guard,signal),
    setPaused(value){alive();if(typeof value!=='boolean')throw Error('Paused must be boolean');paused=value;generation++;
      for(const a of active)if('setPaused'in a.handle)a.handle.setPaused(value)},
    async recover(){alive();if(busy)throw Error('A material document revision is already running');busy=true;
      try{const results=await Promise.allSettled(active.map(a=>'recover'in a.handle?a.handle.recover():Promise.resolve()));alive();generation++;
        const failures=results.flatMap(result=>result.status==='rejected'?[result.reason]:[]);if(failures.length)throw new AggregateError(failures,'Some material renderers could not recover')}finally{busy=false}},
    destroy,
  };
}
