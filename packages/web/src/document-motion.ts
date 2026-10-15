import {attachMockupMotion,type MockupMotionController,type MockupMotionOptions,type MockupMotionState} from './mockup-motion';
import {planSpatialDocumentDelivery} from './spatial-document';
import {receivingInstanceId} from './receiving-instance-id';
import type {SpatialDocumentSpec,SpatialDocumentDelivery} from './generated/core-contract';
export type {SpatialDocumentSpec} from './generated/core-contract';
type Temporal=Extract<SpatialDocumentDelivery,{kind:'temporal'}>;
export type DocumentMotionAssets=Readonly<Record<string,CanvasImageSource>>;
export interface DocumentMotionGuard {instanceId:string;documentFingerprint:string;revision:number}
export interface DocumentMotionState extends MockupMotionState {
  documentFingerprint:string;expressionId:string;busy:boolean;
}
export interface DocumentMotionSession {
  readonly canvas:HTMLCanvasElement;
  getState():DocumentMotionState;
  getDocument():SpatialDocumentSpec;
  getDelivery():Temporal;
  getGuard():DocumentMotionGuard;
  /** Source/design revision preserves the latest local playback state. */
  revise(document:SpatialDocumentSpec,assets:DocumentMotionAssets,guard:DocumentMotionGuard,signal?:AbortSignal):Promise<void>;
  play():boolean;pause():void;seek(timeMs:number):void;setVisible(visible:boolean):void;destroy():void;
}
export interface DocumentMotionOptions extends Omit<MockupMotionOptions,'backgroundRgb'|'onChange'> {
 onChange?:(state:DocumentMotionState)=>void;
}
function snapshot(document:SpatialDocumentSpec):SpatialDocumentSpec {
  const json=JSON.stringify(document);
  if(new TextEncoder().encode(json).length>8*1024*1024)throw Error('Document exceeds the Web receiving record budget');
  return JSON.parse(json) as SpatialDocumentSpec;
}
function bind(delivery:Temporal,assets:DocumentMotionAssets){
  const expected=new Set(delivery.bindings.map(b=>b.assetId)),keys=Object.keys(assets);
  if(keys.length!==expected.size||keys.some(id=>!expected.has(id)))throw Error('Provide exactly the temporal expression’s content assets');
  return delivery.bindings.map(binding=>{
    if(binding.role!=='content'||!assets[binding.assetId])throw Error('Temporal content asset is unavailable');
    return {id:binding.slotId,image:assets[binding.assetId]!};
  });
}

/** Receive one temporal expression of a durable work. Geometry, final output
 * matte and lifecycle use the existing motion renderer; the core owns planning. */
export async function attachDocumentMotion(host:HTMLElement,document:SpatialDocumentSpec,expressionId:string,assets:DocumentMotionAssets,
 options:DocumentMotionOptions={}):Promise<DocumentMotionSession>{
 const instanceId=receivingInstanceId(crypto),lifetime=new AbortController(),initialAssets={...assets};
 let accepted=snapshot(document),fingerprint='',acceptedRevision=1,delivery:Temporal,busy=false,destroyed=false,controller:MockupMotionController|undefined;
 let pending:AbortController|undefined;
 const abort=()=>destroy();
 const state=(motion:MockupMotionState):DocumentMotionState=>({...motion,revision:acceptedRevision,documentFingerprint:fingerprint,expressionId,busy});
 function notify(motion:MockupMotionState){
  if(destroyed||busy)return;
  try{options.onChange?.(state(motion));}catch(error){try{options.onError?.(error instanceof Error?error:Error(String(error)));}catch{/* Host callbacks cannot corrupt publication. */}}
 }
 function alive(signal?:AbortSignal){if(destroyed||options.signal?.aborted||signal?.aborted)throw new DOMException('Document motion cancelled','AbortError');}
 async function compile(candidate:SpatialDocumentSpec){
  const plan=await planSpatialDocumentDelivery({document:candidate,expressionIds:[expressionId]});
  const next=plan.deliveries[0];if(next?.kind!=='temporal')throw Error('Select a temporal document expression');
  return {fingerprint:plan.documentFingerprint,delivery:next};
 }
 function guard():DocumentMotionGuard{return {instanceId,documentFingerprint:fingerprint,revision:acceptedRevision};}
 function check(expected:DocumentMotionGuard){alive();const now=guard();if(!expected||now.instanceId!==expected.instanceId||now.documentFingerprint!==expected.documentFingerprint||now.revision!==expected.revision)throw Error('Stale temporal document state');}
 function destroy(){if(destroyed)return;destroyed=true;pending?.abort();lifetime.abort();controller?.destroy();options.signal?.removeEventListener('abort',abort);}
 options.signal?.addEventListener('abort',abort,{once:true});
 try{
  alive();const prepared=await compile(accepted);alive();delivery=prepared.delivery;fingerprint=prepared.fingerprint;
  controller=await attachMockupMotion(host,delivery.video.mockupMotion,bind(delivery,initialAssets),{...options,onChange:notify,signal:lifetime.signal,backgroundRgb:delivery.video.backgroundRgb});
  alive();
 }catch(error){destroy();throw error;}
 return {
  canvas:controller.canvas,
  getState:()=>state(controller!.getState()),
  getDocument:()=>structuredClone(accepted),getDelivery:()=>structuredClone(delivery),getGuard:guard,
  async revise(nextDocument,nextAssets,expected,signal){
   check(expected);if(busy)throw Error('A temporal document revision is already running');
   const next=snapshot(nextDocument),ownedAssets={...nextAssets};busy=true;pending=new AbortController();const operation=pending;
   const cancel=()=>operation.abort();signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)operation.abort();
   try{
    alive(operation.signal);const prepared=await compile(next);alive(operation.signal);check(expected);
    const sources=bind(prepared.delivery,ownedAssets);
    await controller!.update(prepared.delivery.video.mockupMotion,sources,{expectedRevision:expected.revision,signal:operation.signal},{backgroundRgb:prepared.delivery.video.backgroundRgb});
    // The renderer has committed. Publish its matching durable identity without
    // another async barrier that could leave media newer than the document.
    acceptedRevision=controller!.getState().revision;accepted=next;fingerprint=prepared.fingerprint;delivery=prepared.delivery;
   }finally{signal?.removeEventListener('abort',cancel);if(pending===operation)pending=undefined;busy=false;notify(controller!.getState());}
  },
  play:()=>{alive();return controller!.play();},pause:()=>{alive();controller!.pause();},seek:time=>{alive();controller!.seek(time);},setVisible:value=>{alive();controller!.setVisible(value);},destroy,
 };
}
