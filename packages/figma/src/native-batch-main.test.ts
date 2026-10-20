import {afterEach,expect,it,vi} from "vitest";
import {planVectorArtwork,planVectorProjection,solveTransform} from "@worldbend/web";
import type {TransformSpec} from "@worldbend/web/types";
import {nativeVectorTestHost} from "./test-native-vector-host";
import {buildNativeVectorProjectionInput} from "./native-vector";
import {nativeVectorArtworkFromInputs,isNativeVectorStoredOperation,resolveNativeVectorOperation} from "./native-vector-operation";
import {nativeVectorDocumentParts,publishNativeVectorResult} from "./native-vector-document";
import {readStoredBinding} from "./stored-binding";
import {captureDocumentShapeForSource} from "./native-shape-document";
import {normalizedDocumentShape} from "./native-shape";
import {refreshNativeShapeFit} from "./native-shape-fit";
import type {LinkedBatchItem,NativeVectorProjectionPayload} from "./messages";

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.resetModules();});

async function fixture(deformed=false){
  const h=nativeVectorTestHost(),posts:any[]=[],events=new Map<string,(e?:any)=>void>();
  const plane:TransformSpec={schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad:{
    tl:{x:0,y:0},tr:{x:1,y:0},br:{x:.8,y:1},bl:{x:.1,y:1}}},content:{fit:"stretch"}};
  const independent=h.makeVector("Independent artwork");
  async function result(source:VectorNode,x:number,spec=plane){
    const solved=await solveTransform(spec,{width:200,height:100});
    const projection=await planVectorProjection(buildNativeVectorProjectionInput({source,matrix:solved.homography.matrix,
      reference:{width:200,height:100},placement:{width:200,height:100}}));
    return publishNativeVectorResult({source,spec,matrix:solved.homography.matrix,projection,
      placement:{x,y:200,width:200,height:100},renderWidth:200,renderHeight:100});
  }
  const planeB:TransformSpec=structuredClone(plane);planeB.destination.quad.tr={x:.9,y:.08};
  let second:FrameNode;
  if(deformed){
    const candidate:unknown={kind:"task" as const,task:{kind:"deformation" as const,view:"mesh" as const,spec:{
      schema:"worldbend.deformation-work" as const,version:"0.1" as const,transform:planeB,meshSubdivisions:4,
      meshEdits:[{column:2,row:2,warped:{x:.53,y:.48}}],surface:{anchors:[],strokes:[],envelope:{columns:1,rows:1,
        points:Array.from({length:16},(_,i)=>({x:i%4/3,y:Math.floor(i/4)/3+(i===5?.06:0)}))}}}}};
    if(!isNativeVectorStoredOperation(candidate))throw Error("Invalid deformation fixture");const operation=candidate;
    const solved=await solveTransform(planeB,{width:200,height:100});
    const input=buildNativeVectorProjectionInput({source:h.source,matrix:solved.homography.matrix,reference:{width:200,height:100},placement:{width:200,height:100}});
    const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolveNativeVectorOperation(operation).core,[input]));
    second=await publishNativeVectorResult({source:h.source,spec:planeB,operation,sourceNodeIds:[h.source.id],
      sourceView:{policy:"logical",selection:"explicit",bounds:h.source.absoluteBoundingBox!},
      parts:[{geometry:h.source,projection:projected.outputs[0]!}],matrix:projected.plan.homography,
      placement:{x:550,y:200,width:200,height:100},renderWidth:200,renderHeight:100});
  }else second=await result(h.source,550,planeB);
  const results=[await result(h.source,300),second,await result(independent,800)];
  for(const node of [h.source,independent,...results]){
    Object.assign(node,{exportAsync:vi.fn(async()=>new Uint8Array([1,2,3])),getPluginData:vi.fn(()=>""),
      getSharedPluginDataKeys:vi.fn(()=>[]),setRelaunchData:vi.fn()});
  }
  h.page.selection=[h.source];h.page.on=vi.fn((name:string,fn:any)=>events.set(name,fn));h.page.off=vi.fn();
  h.page.loadAsync=vi.fn(async()=>{});
  h.page.findAllWithCriteria=vi.fn(()=>results);
  Object.assign(h.api,{root:{children:[h.page]},clientStorage:{getAsync:vi.fn(async()=>undefined),setAsync:vi.fn(async()=>{})},
    showUI:vi.fn(),on:vi.fn((name:string,fn:any)=>events.set(name,fn)),commitUndo:vi.fn(),notify:vi.fn(),
    viewport:{scrollAndZoomIntoView:vi.fn()},ui:{on:vi.fn(),onmessage:undefined,postMessage:vi.fn((msg:any)=>posts.push(msg))}});
  h.source.fills=[{type:"SOLID",color:{r:0,g:0,b:1}}];
  vi.stubGlobal("__html__","");
  await import("./main");
  const send=(m:unknown)=>(h.api as any).ui.onmessage(m);
  send({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"batch-test-session"});
  await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({linkedResults:expect.objectContaining({total:2})})})));
  const sourceMessage=()=>posts.findLast(m=>m.type==="source");
  async function prepare(){const generation=sourceMessage().generation;
    const mark=posts.length;send({type:"prepare-linked-batch",generation});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({type:"linked-batch"})));
    return posts.slice(mark).find(m=>m.type==="linked-batch") as {generation:number;items:LinkedBatchItem[]};}
  async function refresh(item:LinkedBatchItem,generation:number,change?:()=>void){
    const operation=item.operationKind==="task"?{kind:"task" as const,task:JSON.parse(item.operationJson)}:{kind:"transform" as const,spec:JSON.parse(item.operationJson)},resolved=resolveNativeVectorOperation(operation);
    const solved=await solveTransform(resolved.plane,{width:item.width,height:item.height});
    const request:NativeVectorProjectionPayload={generation,batchResultId:item.nodeId,batchRunId:item.batchRunId!,targetNodeId:item.nodeId,sourceNodeId:h.source.id,
      sourceNodeIds:[h.source.id],operation,spec:resolved.plane,matrix:solved.homography.matrix,placement:item.placement,
      renderWidth:item.width,renderHeight:item.height,sourceView:item.nativeVectorSourceView!};
    let mark=posts.length;send({type:"request-native-vector-projection",payload:request});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({batchResultId:item.nodeId})));
    const relay=posts.slice(mark).find(m=>m.type==="native-vector-projection"||m.type==="native-vector-projection-error");
    if(relay.type==="native-vector-projection-error")return relay;
    const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolved.core,relay.inputs,relay.sourceView.policy==="appearance"));
    change?.();mark=posts.length;
    send({type:"apply-native-vector",payload:{...request,matrix:projected.plan.homography,placement:relay.placement,
      sourceView:relay.sourceView,operationExpected:relay.operationExpected,
      projection:{outputs:projected.outputs,sourceFingerprint:relay.sourceFingerprint}}});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({batchResultId:item.nodeId})));
    return posts.slice(mark).find(m=>m.type==="apply-complete"||m.type==="apply-error");
  }
  return {...h,posts,events,results,independent,send,prepare,refresh,sourceMessage};
}

it("refreshes two native results while retaining distinct transforms, an independent source and cold-reopen records",async()=>{
  const h=await fixture(),[a,b,c]=h.results,beforeC=await nativeVectorDocumentParts(c!);
  const batch=await h.prepare();expect(batch.items).toHaveLength(2);
  expect(batch.items.every(i=>i.nativeVector&&i.updatable!==false)).toBe(true);
  const oldA=a!.children.map(n=>n.id),beforeSpec=await nativeVectorDocumentParts(a!);
  expect(await h.refresh(batch.items[0]!,batch.generation)).toMatchObject({type:"apply-complete",targetNodeId:a!.id});
  // Delayed child swaps from our own publication must not invalidate the next item.
  h.events.get("nodechange")?.({nodeChanges:[...oldA.map(id=>({id,type:"DELETE",node:{removed:true}})),
    {id:a!.id,type:"PROPERTY_CHANGE",node:a,properties:["pluginData"]}]});
  expect(await h.refresh(batch.items[1]!,batch.generation)).toMatchObject({type:"apply-complete",targetNodeId:b!.id});
  for(const r of [a!,b!]){expect(readStoredBinding(r)?.revision).toBe(2);expect(((await nativeVectorDocumentParts(r)).contents[0]! as VectorNode).fills).toMatchObject([{color:{b:1}}]);}
  expect((await nativeVectorDocumentParts(a!)).spec).toEqual(beforeSpec.spec);
  expect((await nativeVectorDocumentParts(c!)).record).toEqual(beforeC.record);
  expect(h.page.selection).toEqual([h.source]);expect((h.api as any).viewport.scrollAndZoomIntoView).not.toHaveBeenCalled();
  vi.resetModules();h.page.selection=[a];await import("./main");h.send({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"reopen-test-session"});
  await vi.waitFor(()=>expect(h.sourceMessage().payload).toMatchObject({targetNodeId:a!.id,nativeVectorTarget:true}));
});

it("preserves a directly edited result and continues an independent branch",async()=>{
  const h=await fixture(),a=h.results[0]!;
  const before=readStoredBinding(a);(a.children[0]! as VectorNode).fills=[{type:"SOLID",color:{r:0,g:1,b:0}}];
  const batch=await h.prepare();
  expect(await h.refresh(batch.items[0]!,batch.generation)).toMatchObject({type:"native-vector-projection-error",message:{key:"nativeVectorResultChanged"}});
  expect(readStoredBinding(a)).toEqual(before);expect((a.children[0]! as VectorNode).fills).toMatchObject([{color:{g:1}}]);
  expect(await h.refresh(batch.items[1]!,batch.generation)).toMatchObject({type:"apply-complete"});
});

it("refreshes through the host switching an unpainted frame between equivalent empty fills",async()=>{
  const h=await fixture(),a=h.results[0]!,before=await nativeVectorDocumentParts(a!);
  const batch=await h.prepare();
  // The real host has been observed returning a single field-less paint for an
  // unpainted frame between prepare and the publication write boundary; the
  // batch must not mistake that equivalent empty representation for an edit.
  expect(await h.refresh(batch.items[0]!,batch.generation,()=>{(a as unknown as {fills:unknown[]}).fills=[{}];})).toMatchObject({type:"apply-complete",targetNodeId:a!.id});
  expect(readStoredBinding(a)?.revision).toBe(2);
  expect((await nativeVectorDocumentParts(a!)).spec).toEqual(before.spec);
});

it("rejects source and result edits between the projection and native publication",async()=>{
  for(const target of ["source","result"]){
    vi.resetModules();const h=await fixture(),batch=await h.prepare(),a=h.results[0]!;
    const before=readStoredBinding(a),edit=()=>{(target==="source"?h.source:a.children[0]).fills=[{type:"SOLID",color:{r:1,g:1,b:0}}];};
    expect(await h.refresh(batch.items[0]!,batch.generation,edit)).toMatchObject({type:"apply-error"});
    expect(readStoredBinding(a)).toEqual(before);
  }
});

it("refreshes complete deformation controls and rejects a retired batch admission",async()=>{
  const h=await fixture(true),before=await nativeVectorDocumentParts(h.results[1]!),old=await h.prepare(),current=await h.prepare();
  expect(current.items[0]!.batchRunId).not.toBe(old.items[0]!.batchRunId);
  expect(await h.refresh(old.items[0]!,old.generation)).toMatchObject({type:"native-vector-projection-error"});
  const item=current.items.find(i=>i.operationKind==="task")!;
  expect(await h.refresh(item,current.generation)).toMatchObject({type:"apply-complete",batchRunId:item.batchRunId});
  const after=await nativeVectorDocumentParts(h.results[1]!);
  expect(after.operation).toEqual(before.operation);expect(after.binding.revision).toBe(2);
});

/** One native Vector result bound to artwork + a native shape guide in order. */
async function guideFixture(){
  const h=nativeVectorTestHost(),posts:any[]=[],events=new Map<string,(e?:any)=>void>();
  const guide=h.makeVector("Fitting guide");
  guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 100 50 L 0 50 Z"}];
  const plane:TransformSpec={schema:"worldbend.transform",version:"0.1",destination:{space:"normalized",quad:{
    tl:{x:0,y:0},tr:{x:1,y:0},br:{x:.9,y:.95},bl:{x:.05,y:1}}},content:{fit:"stretch"}};
  const shape=await captureDocumentShapeForSource(guide);
  if(!shape)throw Error("guide shape unavailable");
  const clip=normalizedDocumentShape(shape);
  const work={schema:"worldbend.deformation-work" as const,version:"0.1" as const,transform:plane,
    targetSize:{width:100,height:50},meshSubdivisions:4,meshEdits:[{column:1,row:1,warped:{x:.4,y:.4}}],
    shapeFit:{contour:structuredClone(clip.contours[0]!),clip:structuredClone(clip)}};
  const operation={kind:"task" as const,task:{kind:"deformation" as const,view:"mesh" as const,spec:work,
    shapeGuideSourceIndex:1,shapeGuideDomain:{kind:"nativeContour" as const,contourIndex:0}}};
  if(!isNativeVectorStoredOperation(operation))throw Error("Invalid guide fixture");
  const {planDeformationWork}=await import("./designer-plan");
  const planned=await planDeformationWork(work);
  const input=buildNativeVectorProjectionInput({source:h.source,matrix:planned.meshWarp.solve.homography.matrix,
    reference:{width:100,height:50},placement:{width:100,height:50}});
  const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolveNativeVectorOperation(operation).core,[input]));
  const result=await publishNativeVectorResult({source:h.source,spec:plane,operation,sourceNodeIds:[h.source.id,guide.id],
    sourceView:{policy:"logical",selection:"explicit",bounds:h.source.absoluteBoundingBox!},
    parts:[{geometry:h.source,projection:projected.outputs[0]!}],matrix:projected.plan.homography,
    ...(projected.clip?{clip:projected.clip}:{}),
    placement:{x:300,y:200,width:100,height:50},renderWidth:100,renderHeight:50});
  for(const node of [h.source,guide,result,...result.children]){
    Object.assign(node,{exportAsync:vi.fn(async()=>new Uint8Array([1,2,3])),getPluginData:vi.fn(()=>""),
      getSharedPluginDataKeys:vi.fn(()=>[]),setRelaunchData:vi.fn()});
  }
  h.page.selection=[h.source];h.page.on=vi.fn((name:string,fn:any)=>events.set(name,fn));h.page.off=vi.fn();
  h.page.loadAsync=vi.fn(async()=>{});
  h.page.findAllWithCriteria=vi.fn(()=>[result]);
  Object.assign(h.api,{root:{children:[h.page]},clientStorage:{getAsync:vi.fn(async()=>undefined),setAsync:vi.fn(async()=>{})},
    showUI:vi.fn(),on:vi.fn((name:string,fn:any)=>events.set(name,fn)),commitUndo:vi.fn(),notify:vi.fn(),
    viewport:{scrollAndZoomIntoView:vi.fn()},ui:{on:vi.fn(),onmessage:undefined,postMessage:vi.fn((msg:any)=>posts.push(msg))}});
  h.source.fills=[{type:"SOLID",color:{r:0,g:0,b:1}}];
  vi.stubGlobal("__html__","");
  await import("./main");
  const send=(m:unknown)=>(h.api as any).ui.onmessage(m);
  send({type:"ready",systemLocales:["en-US"],sceneDraftSessionId:"guide-batch-session"});
  await vi.waitFor(()=>expect(posts).toContainEqual(expect.objectContaining({type:"source",payload:expect.objectContaining({linkedResults:expect.objectContaining({total:1})})})));
  const sourceMessage=()=>posts.findLast(m=>m.type==="source");
  async function prepare(){const generation=sourceMessage().generation;
    const mark=posts.length;send({type:"prepare-linked-batch",generation});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({type:"linked-batch"})));
    return posts.slice(mark).find(m=>m.type==="linked-batch") as {generation:number;items:LinkedBatchItem[]};}
  async function exportGuide(item:LinkedBatchItem,generation:number){
    const mark=posts.length;
    send({type:"export-batch-source",generation,batchRunId:item.batchRunId,requestId:posts.filter((m:any)=>m.type==="batch-source").length+1,
      resultNodeId:item.nodeId,nodeId:guide.id,desiredWidth:item.width,desiredHeight:item.height});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({type:"batch-source",nodeId:guide.id})));
    return posts.slice(mark).find(m=>m.type==="batch-source");
  }
  async function refreshWith(item:LinkedBatchItem,generation:number,task:unknown){
    const operation=task as never,resolved=resolveNativeVectorOperation(operation);
    const planned=await planDeformationWork(resolved.core.kind==="deformationWork"?resolved.core.spec:undefined as never);
    const request:NativeVectorProjectionPayload={generation,batchResultId:item.nodeId,batchRunId:item.batchRunId,targetNodeId:item.nodeId,
      sourceNodeId:h.source.id,sourceNodeIds:[h.source.id,guide.id],operation,spec:resolved.plane,
      matrix:planned.meshWarp.solve.homography.matrix,placement:item.placement,
      renderWidth:item.width,renderHeight:item.height,sourceView:item.nativeVectorSourceView!};
    let mark=posts.length;send({type:"request-native-vector-projection",payload:request});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({batchResultId:item.nodeId})));
    const relay=posts.slice(mark).find(m=>m.type==="native-vector-projection"||m.type==="native-vector-projection-error");
    if(relay.type==="native-vector-projection-error")return relay;
    const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolved.core,relay.inputs,relay.sourceView.policy==="appearance"));
    mark=posts.length;
    send({type:"apply-native-vector",payload:{...request,matrix:projected.plan.homography,placement:relay.placement,
      sourceView:relay.sourceView,operationExpected:relay.operationExpected,
      projection:{outputs:projected.outputs,sourceFingerprint:relay.sourceFingerprint,...(projected.clip?{clip:projected.clip}:{})}}});
    await vi.waitFor(()=>expect(posts.slice(mark)).toContainEqual(expect.objectContaining({batchResultId:item.nodeId})));
    return posts.slice(mark).find(m=>m.type==="apply-complete"||m.type==="apply-error");
  }
  return {...h,posts,events,result,guide,send,prepare,exportGuide,refreshWith,operation};
}

it("admits a guide-bound native Vector result and refreshes its fit from the changed live guide",async()=>{
  const h=await guideFixture();
  const batch=await h.prepare();
  expect(batch.items).toHaveLength(1);
  expect(batch.items[0]).toMatchObject({nativeVector:true,kind:"deformation",sourceNodeIds:[h.source.id,h.guide.id]});
  expect(batch.items[0]!.updatable).toBeUndefined();
  // The designer reshapes the guide (a notch in the outline, not just a
  // uniform rescale); the batch reads the current guide shape and refits.
  await h.guide.setVectorNetworkAsync({vertices:[{x:0,y:0},{x:60,y:0},{x:60,y:40},{x:30,y:50},{x:0,y:50}],
    segments:[{start:0,end:1},{start:1,end:2},{start:2,end:3},{start:3,end:4},{start:4,end:0}],
    regions:[{windingRule:"NONZERO",loops:[[0,1,2,3,4]]}]});
  h.guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 60 0 L 60 40 L 30 50 L 0 50 Z"}];
  const exported=await h.exportGuide(batch.items[0]!,batch.generation);
  const refreshed=await refreshNativeShapeFit(h.operation.task,exported.shapeGuide);
  expect(refreshed.spec.shapeFit).not.toEqual(h.operation.task.spec.shapeFit);
  const reply=await h.refreshWith(batch.items[0]!,batch.generation,{kind:"task",task:refreshed});
  expect(reply).toMatchObject({type:"apply-complete",targetNodeId:h.result.id});
  const after=await nativeVectorDocumentParts(h.result);
  expect(after.operation).toEqual({kind:"task",task:refreshed});
  expect(after.binding).toMatchObject({revision:2,sourceNodeIds:[h.source.id,h.guide.id]});
});

it("keeps the old guide-bound result when the relayed task no longer describes the live guide",async()=>{
  const h=await guideFixture();
  const batch=await h.prepare(),before=await nativeVectorDocumentParts(h.result);
  // The guide becomes a triangle: its normalized contour genuinely differs
  // from the stored rectangular fit, so the stale task no longer describes
  // the guide that is live right now.
  await h.guide.setVectorNetworkAsync({vertices:[{x:0,y:0},{x:100,y:0},{x:0,y:50}],
    segments:[{start:0,end:1},{start:1,end:2},{start:2,end:0}],
    regions:[{windingRule:"NONZERO",loops:[[0,1,2]]}]});
  h.guide.vectorPaths=[{windingRule:"NONZERO",data:"M 0 0 L 100 0 L 0 50 Z"}];
  // The stale stored task (fit of the ORIGINAL guide) is refused at the read
  // boundary: its clip does not describe the guide that is live right now.
  const reply=await h.refreshWith(batch.items[0]!,batch.generation,h.operation);
  expect(reply).toMatchObject({type:"native-vector-projection-error"});
  expect(await nativeVectorDocumentParts(h.result)).toEqual(before);
});
