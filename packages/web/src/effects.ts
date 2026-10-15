/** Optional data-driven spatial effects. All geometry/interpolation belongs to the Rust core. */
import { planEffect } from "./effects-bridge";
import { perspectiveOwners } from "./binding-ownership";
import { latestFrame } from "./latest-frame";
import { attachPlannedWindow, windowBackingSize } from "./surface-window-binding";
import type { PlannedWindowBinding, SurfaceWindowOptions } from "./surface-window-binding";
import { windowFailure, windowSourceSize } from "./window-renderer";
import type { WindowSource } from "./window-renderer";
import { AppearanceRenderer } from "./appearance-renderer";
import { TransformError } from "./transform-error";
import type { EffectRecipe, EffectState, EffectPlan, EffectMotionSample, EffectFrameAppearance, CssTransform, SurfaceWindowPlan, SpatialDocumentDelivery, SpatialDocumentDeliveryPlan, SpatialDocumentSpec, SpatialInteractiveMedia, SpatialInteractiveMediaBundle } from "./generated/core-contract";
export { discoverEffects, createEffectRecipe, planEffect } from "./effects-bridge";
export { TransformError } from "./transform-error";
export type {
  EffectCatalogInput, EffectCatalog, EffectDescriptor, EffectRecipeInput,
  EffectRecipe, EffectState, EffectMotionSample, EffectPlanInput, EffectPlan,
  EffectLayer, EffectTrack, EffectSpatialAppearance, EffectDepthOfField,
  EffectMotionBlur, EffectDepthMap, EffectFrameAppearance,
  EffectDepthOfFieldPlan, EffectMotionBlurPlan,
  SpatialDocumentAsset, SpatialDocumentBinding, SpatialDocumentSpec,
  SpatialDocumentUpdateInput, SpatialDocumentUpdatePlan,
  SpatialDocumentExpressionRevisionResult,
  SpatialDocumentDeliveryInput, SpatialDocumentDelivery,
  SpatialDocumentDeliveryPlan,
  SpatialMaterialInput, SpatialMaterialDelivery,
  SpatialInteractiveMedia, SpatialInteractiveMediaBundle,
  SpatialInteractiveMediaBundleInput, SpatialInteractiveMediaFormat,
} from "./generated/core-contract";
export type SpatialMaterialFamily = import("./generated/core-contract").SpatialMaterialInput["family"];

export interface EffectSlot { element: HTMLElement; source?: WindowSource; depthMap?: WindowSource; }
export interface EffectBindingOptions extends SurfaceWindowOptions {
  /** Check a saved recipe before touching any bound elements. */
  expectedFingerprint?: string;
  /** Defaults to true: combine host preference with the explicit state and report the effective state. */
  respectReducedMotion?: boolean;
}
export interface EffectBinding {
  update(state: EffectState, motion?: EffectMotionSample): Promise<boolean>;
  /** Refresh caller-owned canvas sources; videos use the existing local media lifecycle. */
  refresh(): Promise<boolean>;
  /** Replace a single decoded window source. DOM contents remain caller-owned. */
  setSource(slot: string, source: WindowSource): Promise<boolean>;
  /** Replace the explicit grayscale depth map declared by one camera plane. */
  setDepthMap(slot: string, source: WindowSource): Promise<boolean>;
  pause(): void;
  resume(): Promise<boolean>;
  getRecipe(): EffectRecipe;
  getPlan(): EffectPlan;
  dispose(): void;
}
export interface DocumentEffectBinding extends Omit<EffectBinding, "setSource" | "setDepthMap"> {
  /** Replace every texture role bound to one durable document asset ID. */
  replaceAsset(assetId: string, source: WindowSource): Promise<boolean>;
}
export interface DocumentEffectResources {
  /** Host elements keyed by the recipe slot IDs preserved in the document. */
  elements: Record<string, HTMLElement>;
  /** Decoded media keyed by durable document asset ID. DOM-only effects may omit it. */
  assets?: Record<string, WindowSource>;
}
export interface SpatialInteractiveMediaBundleResources {
  /** Host elements keyed by the recipe slot IDs preserved in the bundle. */
  elements: Record<string, HTMLElement>;
  /** Decode or otherwise resolve each declared, content-addressed media item. */
  resolveAsset(media: SpatialInteractiveMedia): WindowSource | Promise<WindowSource>;
}
export interface FigmaEffectContinuation {
  schema: "worldbend.figma-effect-continuation";
  version: "0.1";
  origin: {fileKey:string;pageId:string;nodeId:string;revision:number;expected:string};
  sourceBindings: Array<{
    role:string;
    assetId:string;
    sourceNodeId:string;
  }>;
  expressionId:string;
  initialState:EffectState;
  document:SpatialDocumentSpec;
  deliveryPlan:SpatialDocumentDeliveryPlan;
  losses:Array<"sourceMediaNotEmbedded"|"figmaPlacementNotTransferred"|"stagedDraftExcluded">;
}
type FrameItem = { id:string; size:{width:number;height:number}; offset:{x:number;y:number}; css?:CssTransform; window?:SurfaceWindowPlan; appearance?:EffectFrameAppearance };
const ownedStyles = ["position", "left", "top", "width", "height", "box-sizing", "z-index", "transform", "transform-origin", "visibility"];
const attachTickets = new WeakMap<HTMLElement, object>();
function fail(message:string):never { throw new TransformError({code:"E_SCHEMA",message}); }
function record(value:unknown):value is Record<string,unknown> { return typeof value==="object"&&value!==null&&!Array.isArray(value); }
function figmaIdentity(value:unknown):value is string {
  if(typeof value!=="string")return false;
  const bytes=new TextEncoder().encode(value).byteLength;
  return bytes>=1&&bytes<=256&&!/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function spatialId(value:unknown):value is string {
  return typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
function canonicalJson(value:unknown):string {
  return JSON.stringify(value,(_key,nested)=>record(nested)
    ? Object.fromEntries(Object.keys(nested).sort().map(key=>[key,nested[key]]))
    : nested);
}
function validateEffectState(value:unknown):value is EffectState {
  return record(value)
    && typeof value.progress==="number"&&Number.isFinite(value.progress)&&value.progress>=0&&value.progress<=1
    && typeof value.pointerX==="number"&&Number.isFinite(value.pointerX)&&value.pointerX>=-1&&value.pointerX<=1
    && typeof value.pointerY==="number"&&Number.isFinite(value.pointerY)&&value.pointerY>=-1&&value.pointerY<=1
    && typeof value.reducedMotion==="boolean";
}
function validateAppearanceMedia(source:WindowSource,canvas:HTMLCanvasElement) {
  const value=windowSourceSize(source);
  if(value.width<1||value.height<1)windowFailure("E_UNSUPPORTED_MEDIA","A spatial-appearance source must have nonzero dimensions");
  if(value.width>8192||value.height>8192||value.width*value.height>16_777_216)windowFailure("E_OUTPUT_LIMIT","Spatial-appearance source exceeds 8192 pixels per axis or 16 megapixels");
  if(source===canvas)windowFailure("E_UNSUPPORTED_MEDIA","A spatial-appearance canvas cannot sample itself");
  return value;
}
function items(plan:EffectPlan, recipe:EffectRecipe):FrameItem[] {
  return plan.frames.flatMap((frame,index):FrameItem[] => {
    if(frame.surface.kind === "plane") return [{id:frame.id,size:frame.size,offset:frame.offset,css:frame.surface.plan.css,...(frame.appearance?{appearance:frame.appearance}:{})}];
    if(frame.surface.kind === "window") return [{id:frame.id,size:frame.size,offset:frame.offset,window:frame.surface.plan}];
    const layer=recipe.layers[index]!;
    if(layer.surface.kind !== "strip") return fail("Effect strip plan differs from its recipe");
    const panels=layer.surface.panels;
    return frame.surface.plan.items.map((item,i)=>({id:item.id,size:panels[i]!.elementSize,offset:frame.offset,css:item.css}));
  });
}

/** Host owns content, event recognition and elapsed time. Supply absolute states, not deltas. */
type InternalEffectBinding = EffectBinding & {
  setTexturePair(slot: string, source: WindowSource, depthMap: WindowSource): Promise<boolean>;
};

export async function attachEffect(
  sourceRecipe:EffectRecipe, sourceSlots:Record<string,EffectSlot>, initial:EffectState,
  options:EffectBindingOptions = {},
):Promise<EffectBinding> {
  const recipe=structuredClone(sourceRecipe);
  const slots=new Map(Object.entries(sourceSlots).map(([id,slot])=>[id,{...slot}]));
  if(new Set([...slots.values()].map(slot=>slot.element)).size!==slots.size) fail("Each effect slot needs a distinct element");
  const ticket={};
  for(const {element} of slots.values()) {
    if(!(element instanceof HTMLElement)) fail("Effect slots require HTML elements");
    attachTickets.set(element,ticket);
  }
  const media=options.respectReducedMotion===false ? undefined : globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  let requested=structuredClone(initial);
  let requestedMotion:EffectMotionSample|undefined;
  const effective=():EffectState=>({...requested,reducedMotion:requested.reducedMotion || !!media?.matches});
  let accepted=await planEffect({recipe,state:effective(),motion:null,expectedFingerprint:options.expectedFingerprint ?? null});
  const first=items(accepted,recipe);
  if(first.length!==slots.size || first.some(item=>!slots.has(item.id))) fail("Provide exactly the recipe's named slots");
  for(const item of first) {
    const slot=slots.get(item.id)!;
    if(attachTickets.get(slot.element)!==ticket) fail("Effect attachment was superseded");
    if(item.window) {
      if(!(slot.element instanceof HTMLCanvasElement) || !slot.source) fail("A window slot requires a canvas and decoded source");
      const s=windowSourceSize(slot.source);
      if(s.width<1 || s.height<1) fail("A window source must have nonzero dimensions");
      if(slot.depthMap)fail("Window slots do not accept depth maps");
    } else if(item.appearance) {
      if(!(slot.element instanceof HTMLCanvasElement)||!slot.source)fail("Spatial appearance requires a canvas and decoded source for every camera plane");
      const sourceSize=validateAppearanceMedia(slot.source,slot.element);
      const needsDepth=!!item.appearance.depthOfField?.depthMap;
      if(needsDepth!==!!slot.depthMap)fail(needsDepth?"This camera plane requires its declared depth map":"This camera plane does not declare a depth map");
      if(slot.depthMap){const depthSize=validateAppearanceMedia(slot.depthMap,slot.element);if(depthSize.width!==sourceSize.width||depthSize.height!==sourceSize.height)fail("Depth map dimensions must match the content source");}
    } else if(slot.source||slot.depthMap) fail("Only window or spatial-appearance slots accept texture sources; DOM content stays live");
  }
  const report=(error:unknown)=> {
    if(options.onError) options.onError(error);
    else slots.values().next().value?.element.dispatchEvent(new CustomEvent("worldbenderror",{detail:error}));
  };
  const pixelRatio=options.pixelRatio??Math.min(globalThis.devicePixelRatio||1,2),maxPixels=options.maxPixels??4_194_304;
  if(!Number.isFinite(pixelRatio)||pixelRatio<0.25||pixelRatio>4||!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>16_777_216)fail("pixelRatio must be in [0.25,4] and maxPixels an integer in [1,16777216]");
  // Validation completes before ownership changes or style writes.
  const oldOwners=new Set([...slots.values()].map(slot=>perspectiveOwners.get(slot.element)).filter(Boolean));
  for(const owner of oldOwners) owner!.dispose();
  const saved=new Map([...slots.values()].map(({element})=>[element,ownedStyles.map(name=>({name,value:element.style.getPropertyValue(name),priority:element.style.getPropertyPriority(name)}))]));
  const savedCanvasSizes=new Map([...slots.values()].filter(({element})=>element instanceof HTMLCanvasElement).map(({element})=>[element as HTMLCanvasElement,{width:(element as HTMLCanvasElement).width,height:(element as HTMLCanvasElement).height}]));
  const windows=new Map<string,PlannedWindowBinding>();
  const appearances=new Map<string,{renderer:AppearanceRenderer;lost:boolean;onLost:(event:Event)=>void;onRestored:()=>void}>();
  let disposed=false,paused=false;
  const restoreVisibility=(element:HTMLElement)=>{const style=saved.get(element)?.find(value=>value.name==="visibility");if(style?.value)element.style.setProperty("visibility",style.value,style.priority);else element.style.removeProperty("visibility");};
  const restore=()=>{for(const [element,styles]of saved)for(const {name,value,priority}of styles){if(value)element.style.setProperty(name,value,priority);else element.style.removeProperty(name);}for(const [canvas,size]of savedCanvasSizes){canvas.width=size.width;canvas.height=size.height;}};
  const drawAppearance=(item:FrameItem)=>{
    if(!item.appearance)return;const entry=appearances.get(item.id);if(!entry||entry.lost)return;
    const backing=windowBackingSize(item.size.width,item.size.height,pixelRatio,maxPixels,entry.renderer.maximumDrawingSize);
    entry.renderer.draw(item.appearance,backing.width,backing.height,item.size.width,item.size.height);
  };
  const publish=(next:EffectPlan)=>{
    if(paused){accepted=next;return;}
    const nextItems=items(next,recipe);
    try {
      // Window draws are synchronous here, from a fully validated core plan.
      // GPU/context failure is reported; there is no cross-canvas GPU transaction.
      for(const item of nextItems) if(item.window) windows.get(item.id)!.applyPlan(item.window);
      for(const item of nextItems)drawAppearance(item);
      for(const [index,item]of nextItems.entries()) {
        const e=slots.get(item.id)!.element;
        e.style.setProperty("position","absolute");e.style.setProperty("box-sizing","border-box");
        e.style.setProperty("left",`${item.offset.x}px`);e.style.setProperty("top",`${item.offset.y}px`);
        e.style.setProperty("width",`${item.size.width}px`);e.style.setProperty("height",`${item.size.height}px`);
        e.style.setProperty("z-index",String(index));
        if(item.css){e.style.setProperty("transform",item.css.transform);e.style.setProperty("transform-origin",item.css.transformOrigin);}
      }
      accepted=next;
    } catch(error) {
      for(const item of items(accepted,recipe)) if(item.window){try{windows.get(item.id)?.applyPlan(item.window);}catch{/* context restoration owns recovery */}}
      for(const item of items(accepted,recipe))if(item.appearance){try{drawAppearance(item);}catch{/* context restoration owns recovery */}}
      throw error;
    }
  };
  const queue=latestFrame(()=>planEffect({recipe,state:effective(),motion:requestedMotion??null,expectedFingerprint:accepted.fingerprint}),publish,report);
  const onMotion=()=>{requestedMotion=undefined;if(!disposed)void queue.request();};
  const binding:InternalEffectBinding={
    update(state,motion){if(disposed)return Promise.resolve(false);try{requested=structuredClone(state);requestedMotion=motion?structuredClone(motion):undefined;}catch(error){return queue.reject(error);}return queue.request();},
    async refresh(){if(disposed||paused)return false;try{for(const entry of appearances.values())entry.renderer.refresh();const refreshed=await Promise.all([...windows.values()].map(window=>window.refresh()));publish(accepted);return refreshed.every(Boolean)&&[...appearances.values()].every(entry=>!entry.lost);}catch(error){report(error);return false;}},
    setSource(id,source){
      if(disposed)return Promise.resolve(false);const window=windows.get(id);if(window)return window.setSource(source);
      const entry=appearances.get(id);if(!entry){report(new TransformError({code:"E_SCHEMA",message:"Unknown texture slot"}));return Promise.resolve(false);}
      try{entry.renderer.setSource(source);publish(accepted);return Promise.resolve(true);}catch(error){report(error);return Promise.resolve(false);}
    },
    setDepthMap(id,source){
      if(disposed)return Promise.resolve(false);const entry=appearances.get(id),frame=items(accepted,recipe).find(item=>item.id===id);
      if(!entry||!frame?.appearance?.depthOfField?.depthMap){report(new TransformError({code:"E_SCHEMA",message:"Unknown or undeclared depth-map slot"}));return Promise.resolve(false);}
      try{entry.renderer.setDepthMap(source);publish(accepted);return Promise.resolve(true);}catch(error){report(error);return Promise.resolve(false);}
    },
    setTexturePair(id,source,depthMap){
      if(disposed)return Promise.resolve(false);
      const entry=appearances.get(id),slot=slots.get(id),frame=items(accepted,recipe).find(item=>item.id===id);
      if(!entry||!slot?.source||!slot.depthMap||!frame?.appearance?.depthOfField?.depthMap){
        report(new TransformError({code:"E_SCHEMA",message:"A texture pair requires a declared content and depth-map slot"}));
        return Promise.resolve(false);
      }
      const previousSource=slot.source,previousDepthMap=slot.depthMap;
      try{
        // Clearing the old map permits both roles to change dimensions together.
        entry.renderer.setDepthMap(undefined);
        entry.renderer.setSource(source);
        entry.renderer.setDepthMap(depthMap);
        publish(accepted);
        slot.source=source;slot.depthMap=depthMap;
        return Promise.resolve(true);
      }catch(error){
        report(error);
        try{
          entry.renderer.setDepthMap(undefined);
          entry.renderer.setSource(previousSource);
          entry.renderer.setDepthMap(previousDepthMap);
          publish(accepted);
        }catch(restoreError){report(new TransformError({code:"E_RENDER",message:`Worldbend could not fully restore the previous texture pair: ${String(restoreError)}`}));}
        return Promise.resolve(false);
      }
    },
    pause(){if(disposed)return;paused=true;for(const window of windows.values())window.pause();},
    async resume(){if(disposed)return false;paused=false;try{const resumed=await Promise.all([...windows.values()].map(window=>window.resume()));if(disposed)return false;for(const entry of appearances.values())entry.renderer.refresh();publish(accepted);return resumed.every(Boolean)&&[...appearances.values()].every(entry=>!entry.lost);}catch(error){report(error);return false;}},
    getRecipe(){return structuredClone(recipe);},
    getPlan(){return structuredClone(accepted);},
    dispose(){if(disposed)return;disposed=true;queue.dispose();media?.removeEventListener("change",onMotion);for(const window of windows.values())window.dispose();for(const [id,entry]of appearances){const canvas=slots.get(id)!.element as HTMLCanvasElement;canvas.removeEventListener("webglcontextlost",entry.onLost);canvas.removeEventListener("webglcontextrestored",entry.onRestored);entry.renderer.dispose();}restore();for(const {element}of slots.values())if(perspectiveOwners.get(element)===binding)perspectiveOwners.delete(element);},
  };
  try {
    for(const item of first) if(item.window) {
      const slot=slots.get(item.id)!;
      windows.set(item.id,attachPlannedWindow(slot.element as HTMLCanvasElement,slot.source!,item.window,{...options,onError:report}));
    }
    for(const item of first)if(item.appearance){
      const slot=slots.get(item.id)!,canvas=slot.element as HTMLCanvasElement,renderer=new AppearanceRenderer(canvas,options.preserveDrawingBuffer);
      renderer.setSource(slot.source!);if(slot.depthMap)renderer.setDepthMap(slot.depthMap);
      const entry={renderer,lost:false,onLost:(event:Event)=>{event.preventDefault();entry.lost=true;renderer.contextLost();canvas.style.setProperty("visibility","hidden");report(new TransformError({code:"E_RENDER",message:"Spatial-appearance graphics context lost; waiting for restoration"}));},onRestored:()=>{if(disposed)return;try{renderer.contextRestored();entry.lost=false;drawAppearance(items(accepted,recipe).find(value=>value.id===item.id)!);restoreVisibility(canvas);}catch(error){entry.lost=true;canvas.style.setProperty("visibility","hidden");report(error);}}};
      appearances.set(item.id,entry);canvas.addEventListener("webglcontextlost",entry.onLost);canvas.addEventListener("webglcontextrestored",entry.onRestored);
    }
    publish(accepted);
    for(const {element}of slots.values())perspectiveOwners.set(element,binding);
    media?.addEventListener("change",onMotion);
  } catch(error) {binding.dispose();throw error;}
  return binding;
}

function validateInteractiveDelivery(
  document: SpatialDocumentSpec,
  plan: SpatialDocumentDeliveryPlan,
  expressionId: string,
): SpatialDocumentDelivery & {kind:"interactive"} {
  if(
    !record(document)
    || document.schema!=="worldbend.spatial-document"
    || document.version!=="0.1"
    || !Array.isArray(document.assets)
    || !Array.isArray(document.expressions)
    || !record(plan)
    || plan.schema!=="worldbend.spatial-document-delivery-plan"
    || plan.version!=="0.1"
    || !/^sha256:[0-9a-f]{64}$/.test(plan.documentFingerprint)
    || !Array.isArray(plan.deliveries)
    || document.expressions.length!==1
    || plan.deliveries.length!==1
  )fail("Expected one complete version-0.1 interactive Spatial delivery");
  const expression=document.expressions[0];
  const delivery=plan.deliveries[0];
  if(
    !record(expression)
    || !record(delivery)
    || expression.kind!=="interactive"
    || expression.id!==expressionId
    || delivery.kind!=="interactive"
    || delivery.id!==expressionId
    || !record(expression.recipe)
    || !record(delivery.recipe)
    || !Array.isArray(expression.recipe.layers)
    || !Array.isArray(delivery.recipe.layers)
    || !/^sha256:[0-9a-f]{64}$/.test(delivery.recipeFingerprint)
    || !Array.isArray(expression.bindings)
    || !Array.isArray(delivery.bindings)
    || expression.bindings.length<1
    || expression.bindings.length>64
    || canonicalJson(expression.bindings)!==canonicalJson(delivery.bindings)
    || canonicalJson(expression.recipe)!==canonicalJson(delivery.recipe)
  )fail("Spatial document and delivery no longer describe the same interactive expression");
  const assetIds=new Set<string>();
  let previousAssetId:string|undefined;
  for(const asset of document.assets){
    if(!record(asset)||!spatialId(asset.id)||assetIds.has(asset.id)||(previousAssetId!==undefined&&previousAssetId>=asset.id)){
      fail("Spatial document assets must have unique canonical IDs");
    }
    assetIds.add(asset.id);previousAssetId=asset.id;
  }
  if(assetIds.size<1||assetIds.size>64)fail("Spatial document must declare 1..64 assets");
  const usedAssets=new Set<string>(),rolesBySlot=new Set<string>();
  for(const binding of expression.bindings){
    if(
      !record(binding)
      || (binding.role!=="content"&&binding.role!=="depthMap")
      || !spatialId(binding.slotId)
      || !spatialId(binding.assetId)
      || !assetIds.has(binding.assetId)
      || rolesBySlot.has(`${binding.role}:${binding.slotId}`)
    )fail("Spatial delivery contains an invalid, missing or duplicate asset binding");
    rolesBySlot.add(`${binding.role}:${binding.slotId}`);usedAssets.add(binding.assetId);
  }
  if(usedAssets.size!==assetIds.size)fail("Spatial delivery contains an unbound asset");
  return delivery;
}

/** Resolve and attach a core-prepared, content-addressed interactive media bundle. */
export async function attachSpatialInteractiveMediaBundle(
  bundle: SpatialInteractiveMediaBundle,
  resources: SpatialInteractiveMediaBundleResources,
  options: Omit<EffectBindingOptions,"expectedFingerprint">={},
):Promise<DocumentEffectBinding>{
  if(
    !record(bundle)
    || bundle.schema!=="worldbend.spatial-interactive-media-bundle"
    || bundle.version!=="0.1"
    || !/^sha256:[0-9a-f]{64}$/.test(bundle.fingerprint)
    || !spatialId(bundle.expressionId)
    || !validateEffectState(bundle.initialState)
    || !Array.isArray(bundle.media)
    || bundle.media.length<1
    || bundle.media.length>64
    || !record(resources)
    || !record(resources.elements)
    || typeof resources.resolveAsset!=="function"
  )fail("Expected a complete version-0.1 Worldbend interactive media bundle");
  const delivery=validateInteractiveDelivery(bundle.document,bundle.deliveryPlan,bundle.expressionId);
  if(delivery.recipe.version!=="3")fail("Interactive media bundles require a version-3 texture recipe");
  await planEffect({recipe:delivery.recipe,state:bundle.initialState,expectedFingerprint:delivery.recipeFingerprint});
  const mediaIds=new Set<string>();
  let previousMediaId:string|undefined;
  for(const media of bundle.media){
    if(
      !record(media)
      || !spatialId(media.assetId)
      || mediaIds.has(media.assetId)
      || (previousMediaId!==undefined&&previousMediaId>=media.assetId)
      || (media.format!=="png"&&media.format!=="jpeg"&&media.format!=="webp")
      || typeof media.sha256!=="string"
      || !/^[0-9a-f]{64}$/.test(media.sha256)
      || !Number.isSafeInteger(media.encodedBytes)
      || media.encodedBytes<1
      || media.encodedBytes>67_108_864
      || !Number.isSafeInteger(media.width)
      || !Number.isSafeInteger(media.height)
      || media.width<1||media.width>8192||media.height<1||media.height>8192
      || media.width*media.height>16_777_216
    )fail("Interactive bundle media facts are invalid, duplicate, unbounded or not canonical");
    mediaIds.add(media.assetId);previousMediaId=media.assetId;
  }
  if(
    bundle.document.assets.length!==bundle.media.length
    || bundle.document.assets.some((asset,index)=>
      !record(asset)
      || asset.id!==bundle.media[index]!.assetId
      || asset.contentVersion!==`sha256:${bundle.media[index]!.sha256}`
    )
  )fail("Interactive bundle media facts no longer match its Spatial document");
  const contentSlots=delivery.bindings.filter(binding=>binding.role==="content").map(binding=>binding.slotId);
  const providedSlots=Object.keys(resources.elements);
  if(contentSlots.length<1||providedSlots.length!==contentSlots.length||providedSlots.some(slot=>!contentSlots.includes(slot))){
    fail("Provide exactly the interactive bundle's named elements");
  }
  const elementSet=new Set(Object.values(resources.elements));
  if(elementSet.size!==providedSlots.length||[...elementSet].some(element=>!(element instanceof HTMLElement))){
    fail("Interactive bundle elements must be distinct HTML elements");
  }
  const resolved=await Promise.all(bundle.media.map(async media=>{
    const source=await resources.resolveAsset(media);
    const size=windowSourceSize(source);
    if(size.width!==media.width||size.height!==media.height){
      return fail(`Decoded media dimensions do not match the bundle for asset ${media.assetId}`);
    }
    if(elementSet.has(source as unknown as HTMLElement)){
      return fail("An interactive bundle output element cannot be its own media source");
    }
    return [media.assetId,source] as const;
  }));
  return attachDocumentEffect(
    bundle.deliveryPlan,
    bundle.expressionId,
    {elements:resources.elements,assets:Object.fromEntries(resolved)},
    bundle.initialState,
    options,
  );
}

/** Consume one complete Agent-projected Figma Depth continuation receipt. */
export async function attachFigmaEffectContinuation(
  continuation:FigmaEffectContinuation,
  resources:DocumentEffectResources,
  options:Omit<EffectBindingOptions,"expectedFingerprint">={},
):Promise<DocumentEffectBinding> {
  if(
    !record(continuation)
    || continuation.schema!=="worldbend.figma-effect-continuation"
    || continuation.version!=="0.1"
    || !record(continuation.origin)
    || !record(continuation.document)
    || !record(continuation.deliveryPlan)
    || !Array.isArray(continuation.sourceBindings)
    || !Array.isArray(continuation.losses)
    || !Array.isArray(continuation.document.assets)
    || !Array.isArray(continuation.document.expressions)
    || !Array.isArray(continuation.deliveryPlan.deliveries)
    || continuation.document.schema!=="worldbend.spatial-document"
    || continuation.document.version!=="0.1"
  )fail("Expected a version-0.1 Worldbend Figma Depth continuation");
  if(
    !figmaIdentity(continuation.origin.fileKey)
    || !figmaIdentity(continuation.origin.pageId)
    || !figmaIdentity(continuation.origin.nodeId)
    || !Number.isSafeInteger(continuation.origin.revision)
    || continuation.origin.revision<1
    || typeof continuation.origin.expected!=="string"
    || continuation.origin.expected.length<1
    || new TextEncoder().encode(continuation.origin.expected).byteLength>8192
    || continuation.expressionId!=="figma-depth"
  )fail("Figma Depth continuation has invalid origin or expression identity");
  const document=continuation.document;
  const plan=continuation.deliveryPlan;
  const delivery=validateInteractiveDelivery(document,plan,continuation.expressionId);
  await planEffect({recipe:delivery.recipe,state:continuation.initialState,expectedFingerprint:delivery.recipeFingerprint});
  const documentExpression=continuation.document.expressions[0];
  if(documentExpression?.kind!=="interactive")fail("Figma Depth continuation requires one interactive expression");
  const roles=delivery.recipe.layers.map(layer=>layer.id);
  if(
    roles.length<2
    || roles.length>8
    || roles.some(role=>!spatialId(role))
    || new Set(roles).size!==roles.length
    || continuation.sourceBindings.length!==roles.length
    || continuation.sourceBindings.some((binding,index)=>
      !record(binding)
      || binding.role!==roles[index]
      || binding.assetId!==roles[index]
      || !figmaIdentity(binding.sourceNodeId)
    )
    || new Set(continuation.sourceBindings.map(binding=>binding.sourceNodeId)).size!==roles.length
  )fail("Figma Depth continuation requires distinct source bindings in recipe layer order");
  const requiredLosses=["sourceMediaNotEmbedded","figmaPlacementNotTransferred"] as const;
  const allowedLosses=new Set([...requiredLosses,"stagedDraftExcluded"]);
  if(
    requiredLosses.some(loss=>!continuation.losses.includes(loss))
    || continuation.losses.some(loss=>!allowedLosses.has(loss))
    || new Set(continuation.losses).size!==continuation.losses.length
  )fail("Figma Depth continuation has an invalid carrier-loss receipt");
  const expectedBindings=roles.map(role=>({role:"content",slotId:role,assetId:role}));
  const canonicalAssets=[...roles].sort();
  if(
    document.assets.length!==roles.length
    || document.assets.some((asset,index)=>
      !record(asset)
      || asset.id!==canonicalAssets[index]
      || (asset.contentVersion!==undefined&&asset.contentVersion!==null)
    )
    || documentExpression?.kind!=="interactive"
    || canonicalJson(documentExpression.bindings)!==canonicalJson(expectedBindings)
  ) {
    fail("Figma Depth document and delivery no longer describe the projected ordered-layer relationship");
  }
  return attachDocumentEffect(
    plan,
    continuation.expressionId,
    resources,
    continuation.initialState,
    options,
  );
}

/** Attach one interactive expression from a core-validated document delivery plan. */
export async function attachDocumentEffect(
  plan: SpatialDocumentDeliveryPlan,
  expressionId: string,
  resources: DocumentEffectResources,
  initial: EffectState,
  options: Omit<EffectBindingOptions, "expectedFingerprint"> = {},
): Promise<DocumentEffectBinding> {
  if (
    plan.schema !== "worldbend.spatial-document-delivery-plan"
    || plan.version !== "0.1"
    || !/^sha256:[0-9a-f]{64}$/.test(plan.documentFingerprint)
  ) {
    return fail("Expected a version-0.1 Worldbend Spatial Document delivery plan");
  }
  const matches = plan.deliveries.filter((candidate) => candidate.id === expressionId);
  if (matches.length === 0) return fail("The delivery plan does not contain the requested expression");
  if (matches.length !== 1) return fail("The delivery plan contains the requested expression more than once");
  const delivery = matches[0]!;
  if (delivery.kind !== "interactive") {
    return fail("Only an interactive document delivery can attach to live Web elements");
  }
  const content = new Map<string, string>();
  const depthMaps = new Map<string, string>();
  for (const binding of delivery.bindings) {
    if (binding.role !== "content" && binding.role !== "depthMap") {
      return fail("Document delivery contains an unsupported binding role");
    }
    const target = binding.role === "content" ? content : depthMaps;
    if (target.has(binding.slotId)) return fail("Document delivery contains a duplicate role and slot binding");
    target.set(binding.slotId, binding.assetId);
  }
  const expectedSlots = [...content.keys()];
  const providedSlots = Object.keys(resources.elements);
  if (providedSlots.length !== expectedSlots.length || providedSlots.some((id) => !content.has(id))) {
    return fail("Provide exactly the interactive expression's named elements");
  }
  for (const slot of depthMaps.keys()) {
    if (!content.has(slot)) return fail("A depth-map binding must belong to a content slot");
  }
  const contentSlotsByAsset = new Map<string, string[]>();
  const depthSlotsByAsset = new Map<string, string[]>();
  for (const [slotId, assetId] of content) {
    const slots = contentSlotsByAsset.get(assetId) ?? [];
    slots.push(slotId);
    contentSlotsByAsset.set(assetId, slots);
  }
  for (const [slotId, assetId] of depthMaps) {
    const slots = depthSlotsByAsset.get(assetId) ?? [];
    slots.push(slotId);
    depthSlotsByAsset.set(assetId, slots);
  }
  const currentSources = new Map<string, WindowSource>();
  const currentDepthMaps = new Map<string, WindowSource>();
  const sourceSlots = Object.fromEntries(expectedSlots.map((slotId) => {
    const assetId = content.get(slotId)!;
    const depthMapAssetId = depthMaps.get(slotId);
    const source = resources.assets?.[assetId];
    const depthMap = depthMapAssetId ? resources.assets?.[depthMapAssetId] : undefined;
    if (source) currentSources.set(slotId, source);
    if (depthMap) currentDepthMaps.set(slotId, depthMap);
    return [slotId, {
      element: resources.elements[slotId]!,
      ...(source ? {source} : {}),
      ...(depthMap ? {depthMap} : {}),
    } satisfies EffectSlot];
  }));
  const binding = await attachEffect(delivery.recipe, sourceSlots, initial, {
    ...options,
    expectedFingerprint: delivery.recipeFingerprint,
  }) as InternalEffectBinding;
  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else resources.elements[expectedSlots[0]!]!.dispatchEvent(new CustomEvent("worldbenderror", {detail:error}));
  };
  const rejectReplacement = (message: string, code: "E_SCHEMA" | "E_UNSUPPORTED_MEDIA" | "E_OUTPUT_LIMIT" = "E_SCHEMA") => {
    report(new TransformError({code, message}));
    return false;
  };
  const validateSource = (source: WindowSource, slotIds: string[]) => {
    const size = windowSourceSize(source);
    if (size.width < 1 || size.height < 1) {
      return rejectReplacement("A replacement asset must have decoded pixels", "E_UNSUPPORTED_MEDIA");
    }
    if (size.width > 8192 || size.height > 8192 || size.width * size.height > 16_777_216) {
      return rejectReplacement("A replacement asset exceeds 8192 pixels per axis or 16 megapixels", "E_OUTPUT_LIMIT");
    }
    if (slotIds.some((slotId) => resources.elements[slotId] === source)) {
      return rejectReplacement("An effect output canvas cannot be its own replacement asset", "E_UNSUPPORTED_MEDIA");
    }
    return true;
  };
  let documentDisposed=false;
  const replace = async (assetId: string, source: WindowSource): Promise<boolean> => {
    if(documentDisposed)return false;
    try {
      const contentSlots = contentSlotsByAsset.get(assetId) ?? [];
      const depthSlots = depthSlotsByAsset.get(assetId) ?? [];
      const targetSlots = [...new Set([...contentSlots, ...depthSlots])];
      if (targetSlots.length === 0) return rejectReplacement("The interactive expression does not bind the requested asset");
      if (contentSlots.some((slotId) => !currentSources.has(slotId))) {
        return rejectReplacement("This asset is bound to live DOM content; update that host content instead of supplying decoded media");
      }
      if (depthSlots.some((slotId) => !currentDepthMaps.has(slotId))) {
        return rejectReplacement("The document delivery has no accepted source for this depth-map asset");
      }
      if (!validateSource(source, targetSlots)) return false;

      const proposedSources = new Map(currentSources);
      const proposedDepthMaps = new Map(currentDepthMaps);
      for (const slotId of contentSlots) proposedSources.set(slotId, source);
      for (const slotId of depthSlots) proposedDepthMaps.set(slotId, source);
      for (const [slotId, depthMap] of proposedDepthMaps) {
        const contentSource = proposedSources.get(slotId);
        if (!contentSource) return rejectReplacement("A depth-map replacement has no accepted content source");
        const contentSize = windowSourceSize(contentSource);
        const depthSize = windowSourceSize(depthMap);
        if (contentSize.width !== depthSize.width || contentSize.height !== depthSize.height) {
          return rejectReplacement("A replacement depth map must match its content asset dimensions");
        }
      }

      const applied: {role:"content"|"depthMap"|"pair";slotId:string;previous:WindowSource;previousDepthMap:WindowSource|undefined}[] = [];
      const rollback = async () => {
        let restored = true;
        for (const change of applied.reverse()) {
          const accepted = change.role === "content"
            ? await binding.setSource(change.slotId, change.previous)
            : change.role === "depthMap"
              ? await binding.setDepthMap(change.slotId, change.previous)
              : await binding.setTexturePair(change.slotId, change.previous, change.previousDepthMap!);
          restored = accepted && restored;
        }
        if (!restored) report(new TransformError({code:"E_RENDER",message:"Worldbend could not fully restore the previous asset after a replacement failure"}));
      };
      for (const slotId of targetSlots) {
        if(documentDisposed)return false;
        const changesContent=contentSlots.includes(slotId),changesDepth=depthSlots.includes(slotId);
        const previous=currentSources.get(slotId)!,previousDepthMap=currentDepthMaps.get(slotId);
        const accepted=changesContent&&changesDepth
          ? await binding.setTexturePair(slotId,source,source)
          : changesContent
            ? await binding.setSource(slotId,source)
            : await binding.setDepthMap(slotId,source);
        if (!accepted) {
          const currentRestored=changesContent&&changesDepth
            ? await binding.setTexturePair(slotId,previous,previousDepthMap!)
            : changesContent
              ? await binding.setSource(slotId,previous)
              : await binding.setDepthMap(slotId,previousDepthMap!);
          if (!currentRestored) report(new TransformError({code:"E_RENDER",message:"Worldbend could not restore the rejected asset source"}));
          await rollback();
          return false;
        }
        applied.push({role:changesContent&&changesDepth?"pair":changesContent?"content":"depthMap",slotId,previous,previousDepthMap});
      }
      for (const slotId of contentSlots) currentSources.set(slotId, source);
      for (const slotId of depthSlots) currentDepthMaps.set(slotId, source);
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  };
  let replacements = Promise.resolve();
  return {
    update:binding.update,refresh:binding.refresh,pause:binding.pause,resume:binding.resume,
    getRecipe:binding.getRecipe,getPlan:binding.getPlan,
    dispose(){documentDisposed=true;binding.dispose();},
    replaceAsset(assetId, source) {
      const pending = replacements.then(() => replace(assetId, source));
      replacements = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
}
