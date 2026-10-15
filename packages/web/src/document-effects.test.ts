import { readFile } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { initSync } from "@worldbend/wasm/effects";

const renderers = vi.hoisted(() => [] as Array<{
  source?: Canvas;
  depthMap: Canvas | undefined;
  disposed: boolean;
}>);

vi.mock("./appearance-renderer", () => ({
  AppearanceRenderer: class {
    readonly maximumDrawingSize = 4096;
    readonly index = renderers.length;
    source?: Canvas;
    depthMap: Canvas | undefined;
    disposed = false;
    constructor(readonly canvas: Canvas) { renderers.push(this); }
    setSource(source: Canvas & {failAt?:number;failDrawAt?:number}) {
      if (source.failAt === this.index) throw Error("replacement upload failed");
      if (this.depthMap && (this.depthMap.width !== source.width || this.depthMap.height !== source.height)) throw Error("depth map dimensions differ");
      this.source = source;
    }
    setDepthMap(source: Canvas | undefined) {
      if (source && this.source && (this.source.width !== source.width || this.source.height !== source.height)) throw Error("depth map dimensions differ");
      this.depthMap = source;
    }
    draw() { if ((this.source as Canvas & {failDrawAt?:number})?.failDrawAt === this.index) throw Error("replacement draw failed"); }
    refresh() {}
    contextLost() {}
    contextRestored() {}
    dispose() { this.disposed = true; }
  },
}));

import { attachDocumentEffect, attachFigmaEffectContinuation, attachSpatialInteractiveMediaBundle, createEffectRecipe, planEffect } from "./effects";
import type { EffectState, FigmaEffectContinuation, SpatialDocumentAsset, SpatialDocumentBinding, SpatialDocumentDeliveryPlan, SpatialInteractiveMediaBundle } from "./effects";

class Element extends EventTarget {
  declarations = new Map<string, [string, string]>();
  style = {
    getPropertyValue: (name:string) => this.declarations.get(name)?.[0] ?? "",
    getPropertyPriority: (name:string) => this.declarations.get(name)?.[1] ?? "",
    setProperty: (name:string, value:string, priority="") => { this.declarations.set(name, [value, priority]); },
    removeProperty: (name:string) => this.declarations.delete(name),
  };
}
class Canvas extends Element { width=1200;height=800; }

const state:EffectState={progress:1,pointerX:.25,pointerY:-.2,reducedMotion:false};
let bindings:Array<{dispose():void}>=[];

beforeAll(async()=>{
  initSync({module:new WebAssembly.Module(await readFile(new URL("../../wasm/pkg-effects/worldbend_wasm_bg.wasm",import.meta.url)))});
});
beforeEach(()=>{
  renderers.length=0;
  vi.stubGlobal("HTMLElement",Element);
  vi.stubGlobal("HTMLCanvasElement",Canvas);
  vi.stubGlobal("matchMedia",()=>Object.assign(new EventTarget(),{matches:false}));
  vi.stubGlobal("requestAnimationFrame",(callback:FrameRequestCallback)=>setTimeout(()=>callback(0),0));
  vi.stubGlobal("cancelAnimationFrame",clearTimeout);
});
afterEach(()=>{bindings.forEach(binding=>binding.dispose());bindings=[];vi.unstubAllGlobals();});

async function interactiveBundle():Promise<SpatialInteractiveMediaBundle>{
  const recipe=await createEffectRecipe({effect:"multiplane-camera",version:"3",viewport:{width:600,height:400},intensity:.8});
  const recipeFingerprint=(await planEffect({recipe,state})).fingerprint;
  const documentBindings=[
    {role:"content" as const,slotId:"background",assetId:"background"},
    {role:"content" as const,slotId:"middle",assetId:"middle"},
    {role:"content" as const,slotId:"foreground",assetId:"foreground"},
  ] as [SpatialDocumentBinding,SpatialDocumentBinding,SpatialDocumentBinding];
  const media=[
    {assetId:"background",format:"png" as const,sha256:"a".repeat(64),encodedBytes:1024,width:1200,height:800},
    {assetId:"foreground",format:"png" as const,sha256:"c".repeat(64),encodedBytes:1024,width:1200,height:800},
    {assetId:"middle",format:"png" as const,sha256:"b".repeat(64),encodedBytes:1024,width:1200,height:800},
  ] as SpatialInteractiveMediaBundle["media"];
  return {
    schema:"worldbend.spatial-interactive-media-bundle",version:"0.1",
    fingerprint:`sha256:${"4".repeat(64)}`,expressionId:"hero",initialState:state,media,
    document:{
      schema:"worldbend.spatial-document",version:"0.1",
      assets:media.map(item=>({id:item.assetId,contentVersion:`sha256:${item.sha256}`})) as SpatialInteractiveMediaBundle["document"]["assets"],
      expressions:[{kind:"interactive",id:"hero",recipe,bindings:documentBindings}],
    },
    deliveryPlan:{
      schema:"worldbend.spatial-document-delivery-plan",version:"0.1",
      documentFingerprint:`sha256:${"5".repeat(64)}`,
      deliveries:[{kind:"interactive",id:"hero",recipe,recipeFingerprint,bindings:documentBindings}],
    },
  };
}

it("attaches one complete Figma Depth continuation without rebuilding its layer placement",async()=>{
  const recipe=await createEffectRecipe({effect:"multiplane-camera",version:"3",viewport:{width:600,height:400},intensity:.8});
  const recipeFingerprint=(await planEffect({recipe,state})).fingerprint;
  const sourceBindings=[
    {role:"background",assetId:"background",sourceNodeId:"48:5"},
    {role:"middle",assetId:"middle",sourceNodeId:"48:6"},
    {role:"foreground",assetId:"foreground",sourceNodeId:"48:7"},
  ] as const;
  const documentBindings: [SpatialDocumentBinding, SpatialDocumentBinding, SpatialDocumentBinding]=sourceBindings.map(binding=>({role:"content" as const,slotId:binding.role,assetId:binding.assetId})) as [SpatialDocumentBinding, SpatialDocumentBinding, SpatialDocumentBinding];
  const assets: [SpatialDocumentAsset, SpatialDocumentAsset, SpatialDocumentAsset]=["background","foreground","middle"].map(id=>({id})) as [SpatialDocumentAsset, SpatialDocumentAsset, SpatialDocumentAsset];
  const continuation:FigmaEffectContinuation={
    schema:"worldbend.figma-effect-continuation",version:"0.1",
    origin:{fileKey:"granted-file",pageId:"37:7",nodeId:"48:8",revision:2,expected:"current-state"},
    sourceBindings:[...sourceBindings],expressionId:"figma-depth",initialState:state,
    document:{schema:"worldbend.spatial-document",version:"0.1",assets,expressions:[{kind:"interactive",id:"figma-depth",recipe,bindings:documentBindings}]},
    deliveryPlan:{schema:"worldbend.spatial-document-delivery-plan",version:"0.1",documentFingerprint:`sha256:${"3".repeat(64)}`,deliveries:[{kind:"interactive",id:"figma-depth",recipe,recipeFingerprint,bindings:documentBindings}]},
    losses:["sourceMediaNotEmbedded","figmaPlacementNotTransferred"],
  };
  const elements={background:new Canvas(),middle:new Canvas(),foreground:new Canvas()};
  const background=new Canvas(),middle=new Canvas(),foreground=new Canvas(),replacement=new Canvas();
  const binding=await attachFigmaEffectContinuation(continuation,{elements:elements as never,assets:{background:background as never,middle:middle as never,foreground:foreground as never}});
  bindings.push(binding);
  expect(renderers.map(renderer=>renderer.source)).toEqual([background,middle,foreground]);
  expect(binding.getPlan().state).toMatchObject(state);
  expect(await binding.replaceAsset("middle",replacement as never)).toBe(true);
  expect(renderers.map(renderer=>renderer.source)).toEqual([background,replacement,foreground]);

  await expect(attachFigmaEffectContinuation({...continuation,sourceBindings:[continuation.sourceBindings[0]!,continuation.sourceBindings[2]!,continuation.sourceBindings[1]!]},{elements:elements as never,assets:{background,middle,foreground} as never})).rejects.toMatchObject({code:"E_SCHEMA"});

  const staleDocument=structuredClone(continuation);
  const staleExpression=staleDocument.document.expressions[0];
  if(staleExpression?.kind!=="interactive"||!staleExpression.recipe.camera)throw Error("wrong fixture");
  staleExpression.recipe.camera.focalLength+=1;
  await expect(attachFigmaEffectContinuation(staleDocument,{elements:elements as never,assets:{background,middle,foreground} as never})).rejects.toMatchObject({code:"E_SCHEMA"});

  const revisedDocument=structuredClone(continuation);
  revisedDocument.document.assets[1]!.contentVersion="release-02";
  await expect(attachFigmaEffectContinuation(revisedDocument,{elements:elements as never,assets:{background,middle,foreground} as never})).rejects.toMatchObject({code:"E_SCHEMA"});

  const extraDelivery=structuredClone(continuation);
  extraDelivery.deliveryPlan.deliveries.push({...extraDelivery.deliveryPlan.deliveries[0]!,id:"other"});
  await expect(attachFigmaEffectContinuation(extraDelivery,{elements:elements as never,assets:{background,middle,foreground} as never})).rejects.toMatchObject({code:"E_SCHEMA"});

  const malformedRecipe=structuredClone(continuation);
  const malformedExpression=malformedRecipe.document.expressions[0];
  if(malformedExpression?.kind!=="interactive")throw Error("wrong fixture");
  malformedExpression.recipe={} as typeof malformedExpression.recipe;
  await expect(attachFigmaEffectContinuation(malformedRecipe,{elements:elements as never,assets:{background,middle,foreground} as never})).rejects.toMatchObject({code:"E_SCHEMA"});
  expect(renderers).toHaveLength(3);
  expect(await binding.replaceAsset("background",replacement as never)).toBe(true);
});

it("continues five named Figma camera layers without collapsing them to three roles",async()=>{
  const recipe=await createEffectRecipe({effect:"multiplane-camera",version:"3",viewport:{width:600,height:400},intensity:.8});
  recipe.origin=null;
  const template=recipe.layers[0]!;
  recipe.layers=Array.from({length:5},(_,index)=>({
    ...structuredClone(template),
    id:`layer-${index+1}`,
    surface:{...structuredClone(template.surface),kind:"camera-plane" as const,distance:1800-index*250},
  })) as typeof recipe.layers;
  if(recipe.camera)recipe.camera.focusDistance=1300;
  const recipeFingerprint=(await planEffect({recipe,state})).fingerprint;
  const roles=recipe.layers.map(layer=>layer.id);
  const sourceBindings=roles.map((role,index)=>({role,assetId:role,sourceNodeId:`node-${index+1}`}));
  const documentBindings=roles.map(role=>({role:"content" as const,slotId:role,assetId:role})) as [SpatialDocumentBinding,...SpatialDocumentBinding[]];
  const assets=roles.map(id=>({id})).sort((left,right)=>left.id.localeCompare(right.id)) as [SpatialDocumentAsset,...SpatialDocumentAsset[]];
  const continuation:FigmaEffectContinuation={
    schema:"worldbend.figma-effect-continuation",version:"0.1",
    origin:{fileKey:"granted-file",pageId:"37:7",nodeId:"48:8",revision:3,expected:"five-layer-state"},
    sourceBindings,expressionId:"figma-depth",initialState:state,
    document:{schema:"worldbend.spatial-document",version:"0.1",assets,expressions:[{kind:"interactive",id:"figma-depth",recipe,bindings:documentBindings}]},
    deliveryPlan:{schema:"worldbend.spatial-document-delivery-plan",version:"0.1",documentFingerprint:`sha256:${"6".repeat(64)}`,deliveries:[{kind:"interactive",id:"figma-depth",recipe,recipeFingerprint,bindings:documentBindings}]},
    losses:["sourceMediaNotEmbedded","figmaPlacementNotTransferred"],
  };
  const elements=Object.fromEntries(roles.map(role=>[role,new Canvas()]));
  const sources=Object.fromEntries(roles.map(role=>[role,new Canvas()]));
  const binding=await attachFigmaEffectContinuation(continuation,{elements:elements as never,assets:sources as never});
  bindings.push(binding);
  expect(renderers).toHaveLength(5);
  expect(renderers.map(renderer=>renderer.source)).toEqual(roles.map(role=>sources[role]));
  const replacement=new Canvas();
  expect(await binding.replaceAsset("layer-4",replacement as never)).toBe(true);
  expect(renderers[3]!.source).toBe(replacement);
});

it("resolves one canonical interactive media bundle and rejects drift before ownership changes",async()=>{
  const bundle=await interactiveBundle();
  const elements={background:new Canvas(),middle:new Canvas(),foreground:new Canvas()};
  const sources={background:new Canvas(),foreground:new Canvas(),middle:new Canvas()};
  const resolveAsset=vi.fn(({assetId}:{assetId:string})=>sources[assetId as keyof typeof sources] as never);
  const binding=await attachSpatialInteractiveMediaBundle(bundle,{elements:elements as never,resolveAsset});
  bindings.push(binding);
  expect(resolveAsset.mock.calls.map(([media])=>media.assetId)).toEqual(["background","foreground","middle"]);
  expect(renderers.map(renderer=>renderer.source)).toEqual([sources.background,sources.middle,sources.foreground]);
  const replacement=new Canvas();
  expect(await binding.replaceAsset("middle",replacement as never)).toBe(true);
  expect(renderers.map(renderer=>renderer.source)).toEqual([sources.background,replacement,sources.foreground]);

  const stale=structuredClone(bundle);
  stale.document.assets[1]!.contentVersion=`sha256:${"d".repeat(64)}`;
  const staleResolver=vi.fn(()=>new Canvas() as never);
  await expect(attachSpatialInteractiveMediaBundle(stale,{elements:elements as never,resolveAsset:staleResolver})).rejects.toMatchObject({code:"E_SCHEMA"});
  expect(staleResolver).not.toHaveBeenCalled();
  expect(renderers).toHaveLength(3);

  const staleRecipe=structuredClone(bundle);
  const staleExpression=staleRecipe.document.expressions[0];
  const staleDelivery=staleRecipe.deliveryPlan.deliveries[0];
  if(staleExpression?.kind!=="interactive"||staleDelivery?.kind!=="interactive"||!staleExpression.recipe.camera||!staleDelivery.recipe.camera)throw Error("wrong fixture");
  staleExpression.recipe.camera.focalLength+=1;
  staleDelivery.recipe.camera.focalLength+=1;
  const staleRecipeResolver=vi.fn(()=>new Canvas() as never);
  await expect(attachSpatialInteractiveMediaBundle(staleRecipe,{elements:elements as never,resolveAsset:staleRecipeResolver})).rejects.toMatchObject({code:"E_SCHEMA"});
  expect(staleRecipeResolver).not.toHaveBeenCalled();
  expect(renderers).toHaveLength(3);

  const wrongSize=new Canvas();wrongSize.width=600;wrongSize.height=400;
  const dimensionResolver=vi.fn(()=>wrongSize as never);
  await expect(attachSpatialInteractiveMediaBundle(bundle,{elements:elements as never,resolveAsset:dimensionResolver})).rejects.toMatchObject({code:"E_SCHEMA"});
  expect(renderers).toHaveLength(3);

  const failedResolver=vi.fn(async()=>{throw Error("media decode failed");});
  await expect(attachSpatialInteractiveMediaBundle(bundle,{elements:elements as never,resolveAsset:failedResolver})).rejects.toThrow("media decode failed");
  expect(renderers).toHaveLength(3);
  expect(await binding.replaceAsset("background",replacement as never)).toBe(true);
});

it("replaces every texture role for one document asset and rolls back a partial failure",async()=>{
  const recipe=await createEffectRecipe({effect:"multiplane-camera",version:"3",viewport:{width:600,height:400},intensity:.8});
  const fingerprint=(await planEffect({recipe,state})).fingerprint;
  const plan:SpatialDocumentDeliveryPlan={
    schema:"worldbend.spatial-document-delivery-plan",version:"0.1",documentFingerprint:`sha256:${"1".repeat(64)}`,
    deliveries:[{kind:"interactive",id:"hero",recipe,recipeFingerprint:fingerprint,bindings:[
      {role:"content",slotId:"background",assetId:"shared-art"},
      {role:"content",slotId:"middle",assetId:"details"},
      {role:"content",slotId:"foreground",assetId:"shared-art"},
    ]}],
  };
  const elements={background:new Canvas(),middle:new Canvas(),foreground:new Canvas()};
  const original=new Canvas(),details=new Canvas(),replacement=new Canvas();
  const errors:unknown[]=[];
  const binding=await attachDocumentEffect(plan,"hero",{elements:elements as never,assets:{"shared-art":original as never,details:details as never}},state,{onError:error=>errors.push(error)});
  bindings.push(binding);
  expect(renderers.map(renderer=>renderer.source)).toEqual([original,details,original]);

  expect(await binding.replaceAsset("shared-art",replacement as never)).toBe(true);
  expect(renderers.map(renderer=>renderer.source)).toEqual([replacement,details,replacement]);

  const undecoded=new Canvas();undecoded.width=0;undecoded.height=0;
  await expect(binding.replaceAsset("shared-art",undecoded as never)).resolves.toBe(false);
  expect(renderers.map(renderer=>renderer.source)).toEqual([replacement,details,replacement]);
  expect(errors.at(-1)).toMatchObject({code:"E_UNSUPPORTED_MEDIA"});

  const rejected=Object.assign(new Canvas(),{failAt:2});
  expect(await binding.replaceAsset("shared-art",rejected as never)).toBe(false);
  expect(renderers.map(renderer=>renderer.source)).toEqual([replacement,details,replacement]);
  expect(errors.at(-1)).toBeInstanceOf(Error);

  const drawRejected=Object.assign(new Canvas(),{failDrawAt:2});
  expect(await binding.replaceAsset("shared-art",drawRejected as never)).toBe(false);
  expect(renderers.map(renderer=>renderer.source)).toEqual([replacement,details,replacement]);
  expect(errors.some(error=>error instanceof Error&&error.message.includes("draw failed"))).toBe(true);
});

it("changes content and depth dimensions together when one asset owns both roles",async()=>{
  const recipe=await createEffectRecipe({effect:"multiplane-camera",version:"3",viewport:{width:600,height:400},intensity:.8});
  recipe.origin=null;
  if(recipe.layers[0]!.surface.kind!=="camera-plane")throw Error("wrong recipe");
  recipe.layers[0]!.surface.depthMap={nearDistance:900,farDistance:1800};
  const fingerprint=(await planEffect({recipe,state})).fingerprint;
  const plan:SpatialDocumentDeliveryPlan={
    schema:"worldbend.spatial-document-delivery-plan",version:"0.1",documentFingerprint:`sha256:${"2".repeat(64)}`,
    deliveries:[{kind:"interactive",id:"work",recipe,recipeFingerprint:fingerprint,bindings:[
      {role:"content",slotId:"background",assetId:"shared"},
      {role:"depthMap",slotId:"background",assetId:"shared"},
      {role:"content",slotId:"middle",assetId:"middle"},
      {role:"content",slotId:"foreground",assetId:"foreground"},
    ]}],
  };
  const elements={background:new Canvas(),middle:new Canvas(),foreground:new Canvas()};
  const original=new Canvas(),replacement=new Canvas();replacement.width=720;replacement.height=480;
  const binding=await attachDocumentEffect(plan,"work",{elements:elements as never,assets:{shared:original as never,middle:original as never,foreground:original as never}},state);
  bindings.push(binding);
  expect(await binding.replaceAsset("shared",replacement as never)).toBe(true);
  expect(renderers[0]).toMatchObject({source:replacement,depthMap:replacement});
  expect(await binding.replaceAsset("shared",original as never)).toBe(true);
  expect(renderers[0]).toMatchObject({source:original,depthMap:original});
  expect("setSource" in binding).toBe(false);
  expect("setDepthMap" in binding).toBe(false);
});
