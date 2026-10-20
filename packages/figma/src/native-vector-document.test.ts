import {nativeVectorTestHost as host} from "./test-native-vector-host";
import {decodeExactJson,encodeExactJson} from "./exact-json-codec";
import type {NativeVectorStoredOperation} from "./native-vector-operation";
import {isNativeVectorStoredOperation,resolveNativeVectorOperation,nativeVectorArtworkFromInputs,nativeVectorOperationDigest,nativeVectorExecutionFrame} from "./native-vector-operation";
import * as vectorInitialize from "./agent-vector-initialize";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NineNumbers, TransformSpec, VectorProjectionOutput } from "@worldbend/web/types";
import { planVectorArtwork, planVectorProjection, solveTransform } from "@worldbend/web";
import { readStoredBinding } from "./stored-binding";
import { readStoredOperation,writeStoredOperation } from "./stored-operation";
import {resolvedNativeVectorSourceView} from "./native-vector-view";
import {vectorSourcesProof} from "./agent-vector-proof";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as vectorCreate from "./agent-vector-create";
import * as vectorRead from "./agent-vector-read";
import * as vectorState from "./agent-vector-state";
import * as vectorPublish from "./agent-vector-publish";
import * as vectorValidate from "./agent-vector-validate";
import * as vectorFinalize from "./agent-vector-finalize";
import * as media from "./agent-handoff-media";
import * as nativeContinuation from "./agent-native-continuation-vector";
import * as nativeRevision from "./agent-native-continuation-revise-vector";
import type { VectorPublicationInput } from "./agent-vector-publish-prepared";
import { buildNativeVectorProjectionInput } from "./native-vector";
import {
  nativeVectorDocumentParts,
  NativeVectorRollbackIncompleteError,
  publishNativeVectorResult,
} from "./native-vector-document";

const spec: TransformSpec = {
  schema: "worldbend.transform", version: "0.1",
  destination: { space: "normalized", quad: {
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
  } },
  content: { fit: "stretch" },
};

const perspectiveSpec: TransformSpec = {
  schema: "worldbend.transform", version: "0.1",
  destination: { space: "normalized", quad: {
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 0.82, y: 1 }, bl: { x: 0.06, y: 1 },
  } },
  content: { fit: "stretch" },
};


afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Project through the real shared WASM core, exactly as the UI relay does. */
async function project(
  source: VectorNode,
  matrix: NineNumbers,
  renderWidth: number,
  renderHeight: number,
  placement: { width: number; height: number },
): Promise<VectorProjectionOutput> {
  return planVectorProjection(buildNativeVectorProjectionInput({
    source,
    matrix,
    reference: { width: renderWidth, height: renderHeight },
    placement: { width: placement.width, height: placement.height },
  }));
}

const input = (source: VectorNode, existing?: FrameNode, placement = { x: 300, y: 400, width: 200, height: 100 }) => ({
  source, ...(existing ? { existing } : {}), spec,
  matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] as NineNumbers,
  renderWidth: 200, renderHeight: 100,
  placement,
});

function vectorAgentEntry(kind:"source"|"bundled") {
  if(kind==="source")return withVectorWorkflow({...vectorCreate,...vectorRead,...vectorState,...vectorPublish,...vectorValidate,...vectorFinalize,...vectorInitialize,...media});
  const names=["vector-create","vector-read","vector-state","vector-publish","vector-validate","vector-finalize","vector-initialize"];
  const declarations=names.map((name,i)=>`${readFileSync(new URL(`../../../crates/worldbend-mcp/src/figma-runtime-${name}.js`,import.meta.url),"utf8")}\nconst e${i}=WorldbendFigmaHandoff;`).join("\n");
  const transport=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-media.js",import.meta.url),"utf8");
  return withVectorWorkflow(new Function(`${declarations}\n${transport}\nreturn {...e0,...e1,...e2,...e3,...e4,...e5,...e6,...WorldbendFigmaMedia};`)() as ReturnType<typeof vectorAgentEntryRaw>);
}
function vectorAgentEntryRaw(){return {...vectorCreate,...vectorRead,...vectorState,...vectorPublish,...vectorValidate,...vectorFinalize,...vectorInitialize,...media};}
function withVectorWorkflow(raw:ReturnType<typeof vectorAgentEntryRaw>){
  async function createCompleteVectorWork(creation:{fileKey:string;pageId:string;sourceNodeIds:string[];requestId:string;operation:NativeVectorStoredOperation;width:number;height:number;sourceViewPolicy?:"logical"|"appearance"}){
    const creationJson=JSON.stringify(creation),identity=createHash("sha256").update(Buffer.from(creationJson).toString("base64")).digest("hex");
    const made=await raw.createVectorWork({...creation,sourceNodeId:creation.sourceNodeIds[resolveNativeVectorOperation(creation.operation).artworkSourceIndex]!,identity});
    const scope=await stageVector(raw,{...made.reference,creationJson} as unknown as VectorPublicationInput,"f".repeat(64));
    const initialized=await raw.initializeVectorWork(scope);expect(initialized.status).toBe("initialized");
    const snapshot=await raw.vectorState(made.reference);return {...made,status:snapshot.published?"published" as const:"needs-projection" as const,snapshot};
  }
  return {...raw,reserveVectorWork:raw.createVectorWork,createCompleteVectorWork,
    async createVectorWork(input:{fileKey:string;pageId:string;sourceNodeId:string;requestId:string;spec:TransformSpec;width:number;height:number}){
      return createCompleteVectorWork({fileKey:input.fileKey,pageId:input.pageId,sourceNodeIds:[input.sourceNodeId],requestId:input.requestId,
        operation:{kind:"transform",spec:input.spec},width:input.width,height:input.height});
    },
    async publishVectorRevision(input:VectorPublicationInput){const result=await raw.publishVectorRevision(input);
      return {...result,snapshot:await raw.vectorState({fileKey:input.fileKey,pageId:input.pageId,nodeId:result.nodeId})};},
  };
}
function vectorAgentEntrySource(){return withVectorWorkflow(vectorAgentEntryRaw());}
async function agentProposal(api:ReturnType<typeof vectorAgentEntrySource>,base:vectorState.VectorSnapshot,extra:Partial<vectorRead.VectorRevisionInput>={}) {
  const first=await api.readVectorRevision({base,...extra}),parts=[first.json];
  for(let part=1;part<first.partCount;part++)parts.push((await api.readVectorRevision({base,...extra,part,token:first.token})).json);
  return decodeExactJson(JSON.parse(parts.join(""))) as Awaited<ReturnType<typeof vectorRead.vectorProposal>>["data"];
}
async function projectProposal(proposal:VectorPublicationInput["proposal"]):Promise<VectorPublicationInput>{
  const operation=resolveNativeVectorOperation(proposal.operation),matrix=(await solveTransform(operation.plane,{width:Math.ceil(proposal.width),height:Math.ceil(proposal.height)})).homography.matrix;
  const geometries=JSON.parse(proposal.geometryJson);
  const inputs=geometries.map((source:any)=>buildNativeVectorProjectionInput({source,matrix,
    reference:{width:Math.ceil(proposal.width),height:Math.ceil(proposal.height)},placement:{width:proposal.width,height:proposal.height},artworkBounds:proposal.bounds}));
  const output=await planVectorArtwork(nativeVectorArtworkFromInputs(operation.core,inputs,proposal.sourceView?.policy==="appearance"));
  const renderedSourceView=proposal.sourceView&&resolvedNativeVectorSourceView(proposal.sourceView,output.sourceBounds);
  return {fileKey:proposal.base.fileKey,pageId:proposal.base.pageId,nodeId:proposal.base.nodeId,proposal,matrix:output.plan.homography,outputs:output.outputs,...(output.plan.executionFrame?{executionFrame:nativeVectorExecutionFrame(output.plan)!}:{}),...(output.clip?{clip:output.clip}:{}),...(renderedSourceView&&renderedSourceView!==proposal.sourceView?{renderedSourceView}:{})};
}
async function stageVector(api:Pick<ReturnType<typeof vectorAgentEntryRaw>,"stagePublicationChunk">,input:VectorPublicationInput,transferId="a".repeat(64)) {
  const encoded=Buffer.from(JSON.stringify(input)).toString("base64"),count=Math.ceil(encoded.length/32768);
  const scope={fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId,transferId,payloadDigest:createHash("sha256").update(encoded).digest("hex")};
  let hash=2166136261;for(const byte of Buffer.from(encoded))hash=Math.imul(hash^byte,16777619)>>>0;
  for(let index=0;index<count;index++)await api.stagePublicationChunk({...scope,count,length:encoded.length,checksum:hash.toString(16).padStart(8,"0"),index,chunk:encoded.slice(index*32768,(index+1)*32768)});
  return scope;
}
function vectorNativeEntry(kind:"source"|"bundled") {
  if(kind==="source")return {...nativeContinuation,...nativeRevision};
  const read=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-native-continuation-vector.js",import.meta.url),"utf8");
  const revision=readFileSync(new URL("../../../crates/worldbend-mcp/src/figma-runtime-native-continuation-revise-vector.js",import.meta.url),"utf8");
  return new Function(`${read}\nconst read=WorldbendFigmaHandoff;\n${revision}\nreturn {...read,...WorldbendFigmaHandoff};`)() as typeof nativeContinuation&typeof nativeRevision;
}
describe.each(["source","bundled"] as const)("Document native Vector authoring (%s)",entry=>{
  it("refuses a mixed owning value and target witness when valid view-only metadata changes during awaited child lookup",async()=>{
    const h=host(),api=vectorAgentEntry(entry),operation:NativeVectorStoredOperation={kind:"task",task:{kind:"deformation",view:"mesh",spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,meshSubdivisions:4}}};
    const made=await api.createCompleteVectorWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"state-read-barrier",operation,width:200,height:100});
    const first=await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot))),result=h.registry.get(first.nodeId),child=result.children[0];
    const next:NativeVectorStoredOperation={...operation,task:{...operation.task,view:"pin"}},get=h.api.getNodeByIdAsync.getMockImplementation()!;
    let once=true;
    h.api.getNodeByIdAsync.mockImplementation(async(id:string)=>{
      if(id===child.id&&once){once=false;writeStoredOperation(result,next);
        const record=JSON.parse(result.getSharedPluginData("worldbend","nativeVector"));record.operation=nativeVectorOperationDigest(next);result.setSharedPluginData("worldbend","nativeVector",JSON.stringify(record));}
      return get(id);
    });
    await expect(api.vectorState(made.reference)).rejects.toThrow(/result changed/);
    const fresh=await api.vectorState(made.reference);expect(fresh.operation).toEqual(next);expect(result.children[0]).toBe(child);
    expect(readStoredOperation(result)).toEqual({status:"valid",operation:next});
    const x=result.x;once=true;
    h.api.getNodeByIdAsync.mockImplementation(async(id:string)=>{if(id===child.id&&once){once=false;result.x+=1;}return get(id);});
    await expect(api.vectorState(made.reference)).rejects.toThrow(/E_FIGMA_CONFLICT/);
    const moved=await api.vectorState(made.reference);expect(moved.placement.x).toBe(x+1);expect(moved.operation).toEqual(next);
    expect(result.children[0]).toBe(child);expect(result.x).toBe(x+1);
  });
  it("refuses a result's generated replacement source before capture/retirement and keeps independent retry usable",async()=>{
    const h=host(),api=vectorAgentEntry(entry);
    const made=await api.createVectorWork({fileKey:"file",pageId:"page",sourceNodeId:h.source.id,requestId:"descendant-source",spec,width:200,height:100});
    const first=await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const result=h.registry.get(first.nodeId),child=result.children[0],before=await api.vectorState(first.snapshot),sourceBefore=JSON.stringify(h.source.vectorNetwork);
    await expect(agentProposal(api,before,{sourceNodeId:child.id})).rejects.toThrow(/cannot depend on its result/);
    expect(await api.vectorState(first.snapshot)).toEqual(before);
    expect(child.removed).not.toBe(true);expect(result.children[0]).toBe(child);
    const replacement=h.makeVector("Independent replacement");
    const retried=await api.publishVectorRevision(await projectProposal(await agentProposal(api,before,{sourceNodeId:replacement.id})));
    expect(retried.snapshot.revision).toBe(2);expect(retried.snapshot.sourceNodeId).toBe(replacement.id);
    expect(replacement.removed).not.toBe(true);expect(JSON.stringify(h.source.vectorNetwork)).toBe(sourceBefore);
    // A previous result's generated artwork is independent when producing a
    // different new work, and must not become a blanket generated-source ban.
    const independent=await api.createVectorWork({fileKey:"file",pageId:"page",sourceNodeId:result.children[0].id,requestId:"independent-generated",spec,width:200,height:100});
    const other=await api.publishVectorRevision(await projectProposal(await agentProposal(api,independent.snapshot)));
    expect(other.snapshot.nodeId).not.toBe(result.id);expect(result.children[0].removed).not.toBe(true);
  });
  it("guards every ordered source role and rechecks a source reparented into its result during native preparation",async()=>{
    const h=host(),payload=input(h.source),projection=await project(h.source,payload.matrix,200,100,payload.placement);
    const result=await publishNativeVectorResult({...payload,projection}),old=result.children[0]!,record=result.getSharedPluginData("worldbend","nativeVector");
    const operation:NativeVectorStoredOperation={kind:"task",task:{kind:"deformation",view:"mesh",shapeGuideSourceIndex:0,spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,shapeFit:{clip:{fillRule:"evenOdd",contours:[{start:{x:0,y:0},segments:[{kind:"line",to:{x:1,y:0}},{kind:"line",to:{x:1,y:1}},{kind:"line",to:{x:0,y:1}}]}]},contour:{start:{x:0,y:0},segments:[{kind:"line",to:{x:1,y:0}},{kind:"line",to:{x:1,y:1}},{kind:"line",to:{x:0,y:1}}]}}}}};
    await expect(vectorSourcesProof({fileKey:"file",pageId:"page",nodeId:result.id},operation,[old.id,h.source.id])).rejects.toThrow(/cannot depend on its result/);
    await expect(publishNativeVectorResult({...input(old as VectorNode,result),projection})).rejects.toThrow(/cannot depend on its result/);
    h.onNextNetwork(()=>{result.appendChild(h.source);});
    await expect(publishNativeVectorResult({...input(h.source,result),projection})).rejects.toThrow(/cannot depend on its result/);
    expect(old.removed).not.toBe(true);expect(h.source.removed).not.toBe(true);
    expect(result.getSharedPluginData("worldbend","nativeVector")).toBe(record);
    expect(result.children.map(n=>n.id)).toEqual([old.id,h.source.id]);
    // Preserve the user's reparent, then retry after they choose a truly
    // independent source. No stale async rollback erases their intervening edit.
    h.page.appendChild(h.source);
    const retryProjection=await project(h.source,payload.matrix,200,100,payload.placement);
    const retry=await publishNativeVectorResult({...input(h.source,result),projection:retryProjection});
    expect(retry.id).toBe(result.id);expect((await nativeVectorDocumentParts(retry)).binding.revision).toBe(2);
  });
  it("keeps a complete guarded proposal, replaces its explicit source through core and rejects a later native edit",async()=>{
    const h=host(),api=vectorAgentEntry(entry),native=vectorNativeEntry(entry);
    h.source.exportAsync=vi.fn(async()=>"<svg width='100' height='50'><path d='M0 0H100V50H0Z'/></svg>");
    const made=await api.createVectorWork({fileKey:"file",pageId:"page",sourceNodeId:h.source.id,requestId:"document-vector",spec,width:200,height:100});
    const published=await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const scope={fileKey:"file",pageId:"page",nodeId:published.nodeId,carrier:"vector" as const};
    const first=await native.readNativeContinuation(scope);let json=first.json;
    for(let part=1;part<first.partCount;part++)json+=(await native.readNativeContinuation({...scope,part,token:first.token})).json;
    const saved=decodeExactJson(JSON.parse(json)) as any,replacement=h.makeVector("Later artwork");replacement.fills=[{type:"SOLID",color:{r:0,g:.6,b:.3}}];
    replacement.exportAsync=vi.fn(async()=>"<svg width='100' height='50'><path d='M0 0H100V50H0Z'/></svg>");
    const input={...scope,targetExpected:saved.targetExpected,sourceExpected:saved.sourceExpected,svgExpected:saved.source.previewFingerprint,
      sourceNodeId:replacement.id,spec:perspectiveSpec,width:240.5,height:140.25};
    const start=await native.readNativeVectorRevision(input),parts=[start.json];
    for(let part=1;part<start.partCount;part++)parts.push((await native.readNativeVectorRevision({...input,part,token:start.token})).json);
    const proposal=decodeExactJson(JSON.parse(parts.join(""))) as VectorPublicationInput["proposal"],sourceBefore=JSON.stringify(replacement.vectorNetwork);
    expect(proposal).toMatchObject({sourceNodeId:replacement.id,width:240.5,height:140.25,operation:{kind:"transform",spec:perspectiveSpec}});
    const after=await api.publishVectorRevision(await projectProposal(proposal));
    expect(after.snapshot).toMatchObject({nodeId:published.nodeId,sourceNodeId:replacement.id,revision:2,placement:{width:240.5,height:140.25}});
    expect(JSON.stringify(replacement.vectorNetwork)).toBe(sourceBefore);
    expect(h.source.removed).not.toBe(true);
    await expect(native.readNativeVectorRevision(input)).rejects.toThrow(/CONFLICT/);
    // An independently changed source invalidates an already captured proposal
    // even if its control JSON and the native result itself remain unchanged.
    replacement.fills=[{type:"SOLID",color:{r:1,g:0,b:0}}];
    await expect(api.publishVectorRevision(await projectProposal(proposal))).rejects.toThrow(/CONFLICT/);
    expect((await api.vectorState(scope)).revision).toBe(2);
  });
});
describe.each(["source","bundled"] as const)("native Vector Agent continuation (%s)",kind=>{
  const createInput=(sourceNodeId:string)=>({fileKey:"file",pageId:"page",sourceNodeId,requestId:"native-vector-continuity",spec:perspectiveSpec,width:200.5,height:100.5});
  it("preserves a newer authoring commit when an older Initialize lease fails during receipt delivery",async()=>{
    const h=host(),api=vectorAgentEntry(kind),operation:NativeVectorStoredOperation={kind:"transform",spec},
      creation={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"initialize-barrier",operation,width:200,height:100};
    const creationJson=JSON.stringify(creation),identity=createHash("sha256").update(Buffer.from(creationJson).toString("base64")).digest("hex");
    const made=await api.reserveVectorWork({...creation,sourceNodeId:h.source.id,identity}),target=h.registry.get(made.nodeId);
    const scope=await stageVector(api,{...made.reference,creationJson} as unknown as VectorPublicationInput,"c".repeat(64));
    const getter=h.api.getNodeByIdAsync.getMockImplementation()!;
    let entered!:()=>void,resume!:()=>void,blocked=false;
    const reached=new Promise<void>(resolve=>entered=resolve),barrier=new Promise<void>(resolve=>resume=resolve);
    h.api.getNodeByIdAsync.mockImplementation(async(id:string)=>{
      if(id===target.id&&target.getSharedPluginData("worldbend","vectorPending")&&!blocked){blocked=true;entered();await barrier;}
      return getter(id);
    });
    const initializing=api.initializeVectorWork(scope);await reached;
    const changed:NativeVectorStoredOperation={kind:"transform",spec:perspectiveSpec};
    writeStoredOperation(target,changed);const pending=target.getSharedPluginData("worldbend","vectorPending");
    await api.cancelPublication(scope);resume();
    expect(await initializing).toMatchObject({status:"failed",error:{code:"E_FIGMA_CONFLICT"}});
    expect(readStoredOperation(target)).toEqual({status:"valid",operation:changed});
    expect(target.getSharedPluginData("worldbend","vectorPending")).toBe(pending);
    expect(await api.vectorState(made.reference)).toMatchObject({published:false,operation:changed});
    expect(h.source.removed).not.toBe(true);expect(target.children).toHaveLength(0);
  });
  it("refuses reservation edits during precommit source proof without overwriting the edited target",async()=>{
    const h=host(),api=vectorAgentEntry(kind),creation={fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"proof-barrier",operation:{kind:"transform" as const,spec},width:200,height:100},creationJson=JSON.stringify(creation),
      identity=createHash("sha256").update(Buffer.from(creationJson).toString("base64")).digest("hex"),
      made=await api.reserveVectorWork({...creation,sourceNodeId:h.source.id,identity}),target=h.registry.get(made.nodeId),
      scope=await stageVector(api,{...made.reference,creationJson} as unknown as VectorPublicationInput,"b".repeat(64));
    let entered!:()=>void,resume!:()=>void,blocked=false;const reached=new Promise<void>(r=>entered=r),barrier=new Promise<void>(r=>resume=r),getter=h.api.getNodeByIdAsync.getMockImplementation()!;
    h.api.getNodeByIdAsync.mockImplementation(async(id:string)=>{if(id===h.source.id&&!blocked){blocked=true;entered();await barrier;}return getter(id);});
    const initializing=api.initializeVectorWork(scope);await reached;target.width=201;writeStoredOperation(target,{kind:"transform",spec:perspectiveSpec});resume();
    expect(await initializing).toMatchObject({status:"failed",error:{code:"E_FIGMA_CONFLICT"}});
    expect(target.width).toBe(201);expect(target.getSharedPluginData("worldbend","vectorPending")).toBe("");
    expect(readStoredOperation(target)).toEqual({status:"valid",operation:{kind:"transform",spec:perspectiveSpec}});
  });
  it("continues the admitted minimum logical rectangle after exact native binary32 readback",async()=>{
    const h=host(),api=vectorAgentEntry(kind),make=h.api.createFrame.getMockImplementation()!;
    h.api.createFrame.mockImplementation(()=>{const frame=make(),resize=frame.resizeWithoutConstraints.getMockImplementation()!;
      frame.resizeWithoutConstraints.mockImplementation((width:number,height:number)=>resize(Math.fround(width),Math.fround(height)));return frame;});
    const made=await api.createVectorWork({...createInput(h.source.id),width:.01,height:.01});
    expect(made.snapshot.placement.width).toBe(Math.fround(.01));expect(made.snapshot.placement.width).toBeLessThan(.01);
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const cold=await api.vectorState(made.reference);expect(cold).toMatchObject({published:true,revision:1,placement:{width:Math.fround(.01),height:Math.fround(.01)}});
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,cold,{width:80.3,height:100.1})));
    expect(await api.vectorState(made.reference)).toMatchObject({revision:2,placement:{width:Math.fround(80.3),height:Math.fround(100.1)}});
  });
  it.each(["transform","deformation"] as const)("retains the complete rounded appearance source window across %s publication, cold update and source replacement",async family=>{
    const h=host(),api=vectorAgentEntry(kind);
    Object.defineProperty(h.source,"absoluteRenderBounds",{configurable:true,get:()=>({...h.source.absoluteBoundingBox,height:49.9999})});
    const warped={...spec,content:{...spec.content,warp:{preset:"arch" as const,amount:.1}}};
    const operation:NativeVectorStoredOperation=family==="transform"?{kind:"transform",spec:warped}:{kind:"task",task:{kind:"deformation",view:"mesh",spec:{
      schema:"worldbend.deformation-work",version:"0.1",transform:spec,meshSubdivisions:4,meshEdits:[{column:2,row:2,warped:{x:.51,y:.5}}]}}};
    const original=JSON.stringify(h.source.vectorNetwork),made=await api.createCompleteVectorWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:`rounded-${family}`,operation,width:200,height:100,sourceViewPolicy:"appearance"});
    const proposal=await agentProposal(api,made.snapshot),publication=await projectProposal(proposal);
    expect(publication.renderedSourceView).toMatchObject({policy:"appearance",reportedBounds:{x:10,y:20,width:100,height:49.9999}});
    expect(publication.renderedSourceView!.bounds.height).toBeGreaterThanOrEqual(50);
    const published=await api.publishVectorRevision(publication),cold=await api.vectorState(made.reference);
    expect(cold.operation).toEqual(operation);expect(cold.sourceView).toEqual(publication.renderedSourceView);
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,cold,{width:210})));
    expect((await api.vectorState(made.reference)).sourceView).toEqual(cold.sourceView);
    const before=await api.vectorState(made.reference),replacement=h.makeVector("replacement"),next=await projectProposal(await agentProposal(api,before,{sourceNodeId:replacement.id}));
    await api.publishVectorRevision(next);
    expect(await api.vectorState(made.reference)).toMatchObject({revision:3,operation,sourceNodeId:replacement.id,sourceView:{policy:"appearance",bounds:replacement.absoluteBoundingBox}});
    // Getter equality alone is not source freshness: a same-box paint edit
    // after capture must reject publication and preserve the visible result.
    const base=await api.vectorState(made.reference),stale=await projectProposal(await agentProposal(api,base));replacement.fills=[{type:"SOLID",color:{r:0,g:1,b:0}}];
    await expect(api.publishVectorRevision(stale)).rejects.toThrow(/CONFLICT/);
    expect(JSON.stringify(h.source.vectorNetwork)).toBe(original);expect(published.nodeId).toBe(made.nodeId);
  });
  it("rejects missing authored and unexpected guide masks before any preparation write",async()=>{
    const h=host(),payload=input(h.source),projection=await project(h.source,payload.matrix,200,100,payload.placement),
      operation:NativeVectorStoredOperation={kind:"task",task:{kind:"deformation",view:"mesh",spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,
        shapeFit:{contour:{start:{x:0,y:0},segments:[{kind:"line",to:{x:1,y:0}},{kind:"line",to:{x:1,y:1}},{kind:"line",to:{x:0,y:1}}]},
          clip:{contours:[{start:{x:0,y:0},segments:[{kind:"line",to:{x:1,y:0}},{kind:"line",to:{x:1,y:1}},{kind:"line",to:{x:0,y:1}}]}],fillRule:"evenOdd"}}}}};
    const vectors=h.api.createVector.mock.calls.length;
    await expect(publishNativeVectorResult({...payload,operation,sourceView:{policy:"logical",bounds:h.source.absoluteBoundingBox},projection})).rejects.toThrow("Unsupported native vector publication");
    await expect(publishNativeVectorResult({...payload,operation:{kind:"transform",spec},sourceView:{policy:"logical",bounds:h.source.absoluteBoundingBox},projection,clip:projection})).rejects.toThrow("Unsupported native vector publication");
    expect(h.api.createVector.mock.calls.length).toBe(vectors);expect(h.api.createFrame).not.toHaveBeenCalled();
    const core=await planVectorArtwork(nativeVectorArtworkFromInputs(resolveNativeVectorOperation(operation).core,[buildNativeVectorProjectionInput({source:h.source,matrix:payload.matrix,reference:{width:200,height:100},placement:payload.placement})]));
    const result=await publishNativeVectorResult({...payload,operation,sourceView:{policy:"logical",bounds:h.source.absoluteBoundingBox},projection:core.outputs[0]!,clip:core.clip!,matrix:core.plan.homography});
    expect((await nativeVectorDocumentParts(result)).record.parts[0]!.role).toBe("clip");
    const record=JSON.parse(result.getSharedPluginData("worldbend","nativeVector"));delete record.parts[0].role;
    result.setSharedPluginData("worldbend","nativeVector",JSON.stringify(record));
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("result changed");
    expect((result.children[0] as VectorNode).isMask).toBe(true);
  });
  it.each([{width:200.5,height:100.5},{width:100.1,height:80.3},{width:.01,height:.01}])("preserves fractional authored reference axes $width across native size readback, publication and independently scaled cold update",async targetSize=>{
    const h=host(),api=vectorAgentEntry(kind),operation:NativeVectorStoredOperation={kind:"task",task:{kind:"deformation",view:"mesh",spec:{
      schema:"worldbend.deformation-work",version:"0.1",transform:spec,targetSize,meshSubdivisions:4,meshEdits:[{column:2,row:2,warped:{x:.51,y:.5}}]}}};
    const make=h.api.createFrame.getMockImplementation()!;
    h.api.createFrame.mockImplementation(()=>{const frame=make(),resize=frame.resizeWithoutConstraints.getMockImplementation()!;
      frame.resizeWithoutConstraints.mockImplementation((width:number,height:number)=>resize(Math.fround(width),Math.fround(height)));return frame;});
    const made=await api.createCompleteVectorWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"fractional-work",operation,...targetSize});
    expect(made.snapshot.placement).toMatchObject({width:Math.fround(targetSize.width),height:Math.fround(targetSize.height)});
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const before=await api.vectorState(made.reference);expect(before.operation).toEqual(operation);
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,before,{width:240.5,height:120.5})));
    expect(await api.vectorState(made.reference)).toMatchObject({revision:2,operation,placement:{width:240.5,height:120.5}});
    expect(readStoredBinding(h.registry.get(made.nodeId))).toMatchObject({renderWidth:Math.ceil(targetSize.width),renderHeight:Math.ceil(targetSize.height)});
  });
  it("retains complete large controls across exact pages, selective edits, compressed guarded publication and cold source replacement",async()=>{
    const h=host(),api=vectorAgentEntry(kind);
    h.source.vectorNetwork={vertices:[{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:50,y:25},{x:0,y:50}],
      segments:Array.from({length:5},(_,i)=>({start:i,end:(i+1)%5})),regions:[{windingRule:"NONZERO",loops:[[0,1,2,3,4]]}]};
    const samples=Array.from({length:256},(_,i)=>({position:{x:(i%16+1)/17,y:(Math.floor(i/16)+1)/17},delta:{x:Math.sin(i)*.00001,y:Math.cos(i)*.00001},radius:.08,strength:.01}));
    const candidate:unknown={kind:"task",task:{kind:"deformation",view:"mesh",spec:{schema:"worldbend.deformation-work",version:"0.1",transform:spec,
      meshSubdivisions:16,surface:{envelope:{columns:1,rows:1,points:Array.from({length:16},(_,i)=>({x:i%4/3,y:Math.floor(i/4)/3}))},
        anchors:Array.from({length:64},(_,i)=>({id:`anchor-${i}`,column:i%8+1,row:Math.floor(i/8)+1})),
        strokes:Array.from({length:4},(_,i)=>({id:`pin-${i}`,samples:structuredClone(samples)}))},
      liquify:{strokes:Array.from({length:4},(_,i)=>({id:`liquify-${i}`,mode:"push",samples:structuredClone(samples)}))},
      meshEdits:Array.from({length:225},(_,i)=>({column:i%15+1,row:Math.floor(i/15)+1,warped:{x:(i%15+1)/16,y:(Math.floor(i/15)+1)/16}}))}}};
    if(!isNativeVectorStoredOperation(candidate))throw Error("invalid complete controls");const operation=candidate;
    expect(Buffer.byteLength(JSON.stringify(operation))).toBeGreaterThan(90*1024);
    const original=JSON.stringify(h.source.vectorNetwork),made=await api.createCompleteVectorWork({fileKey:"file",pageId:"page",sourceNodeIds:[h.source.id],requestId:"complete-controls",operation,width:200,height:100});
    const first=await api.readVectorState({...made.reference,part:0}),pages=[first.json];
    expect(first.partCount).toBeGreaterThan(1);
    for(let part=1;part<first.partCount;part++)pages.push((await api.readVectorState({...made.reference,part,token:first.token})).json);
    expect((decodeExactJson(JSON.parse(pages.join(""))) as any).operation).toEqual(operation);
    let publication=await projectProposal(await agentProposal(api,made.snapshot));
    let scope=await stageVector(api,publication);await api.validateVectorPublication(scope);expect(await api.finalizeVectorPublication(scope)).toMatchObject({status:"published"});
    const cold=await api.vectorState(made.reference);expect(cold.operation).toEqual(operation);
    const changed=structuredClone(operation);if(changed.kind!=="task"||changed.task.kind!=="deformation")throw Error();changed.task.spec.meshEdits!.find(e=>e.column===8&&e.row===8)!.warped.x=.51;
    const proposal=await agentProposal(api,cold,{operation:changed});publication=await projectProposal(proposal);
    expect(publication.outputs[0]!.network.vertices).not.toEqual((await projectProposal(await agentProposal(api,cold))).outputs[0]!.network.vertices);
    scope=await stageVector(api,publication);await api.validateVectorPublication(scope);expect(await api.finalizeVectorPublication(scope)).toMatchObject({status:"published",snapshot:{reference:{nodeId:made.nodeId,revision:2}}});
    const updated=await api.vectorState(made.reference);expect(updated.operation).toEqual(changed);expect(readStoredOperation(h.registry.get(made.nodeId))).toEqual({status:"valid",operation:changed});
    const replacement=h.makeVector("replacement");replacement.fills=[{type:"SOLID",color:{r:0,g:1,b:0}}];
    const replaced=await projectProposal(await agentProposal(api,updated,{sourceNodeId:replacement.id}));
    // Use the same exact compressed payload that production transports, not a
    // separate direct setter. Original encoded SHA remains the authority.
    const encoded=encodeExactJson(replaced),data=encoded.data,count=Math.ceil(data.length/32768);
    scope={fileKey:"file",pageId:"page",nodeId:made.nodeId,transferId:"e".repeat(64),payloadDigest:encoded.digest};
    let checksum=2166136261;for(const byte of Buffer.from(data))checksum=Math.imul(checksum^byte,16777619)>>>0;
    for(let index=0;index<count;index++)await api.stagePublicationChunk({...scope,count,length:data.length,checksum:checksum.toString(16).padStart(8,"0"),index,chunk:data.slice(index*32768,(index+1)*32768)});
    await api.validateVectorPublication(scope);expect(await api.finalizeVectorPublication(scope)).toMatchObject({status:"published"});
    const final=await api.vectorState(made.reference);expect(final.operation).toEqual(changed);expect(final).toMatchObject({nodeId:made.nodeId,revision:3,sourceNodeId:replacement.id});
    expect(JSON.stringify(h.source.vectorNetwork)).toBe(original);expect(h.source.removed).not.toBe(true);expect(replacement.removed).not.toBe(true);
    expect(await api.inspectPublication(scope)).toMatchObject({status:"empty"});expect([...h.registry.values()].some(n=>n.name?.startsWith("Worldbend vector preparation"))).toBe(false);
  },90_000);
  it("clears obsolete capture/pending only on successful commit and restores exact prior cache after cleanup failure",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const target=h.registry.get(made.nodeId),creation=target.getSharedPluginData("worldbend","vectorCreation");
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    expect(target.getSharedPluginData("worldbend","vectorPending")).toBe("");expect(target.getSharedPluginData("worldbend","vector-read-manifest")).toBe("");
    expect(target.getSharedPluginData("worldbend","vectorCreation")).toBe(creation);
    const base=await api.vectorState(made.reference),next=await projectProposal(await agentProposal(api,base,{width:220.5})),cache=target.getSharedPluginData("worldbend","vector-read-manifest");
    const child=target.children[0],stateBefore=await api.vectorState(made.reference),write=target.setSharedPluginData.bind(target);let rejected=false;
    target.setSharedPluginData=(ns:string,key:string,value:string)=>{if(key==="vector-read-manifest"&&!value&&!rejected){rejected=true;return;}write(ns,key,value);};
    await expect(api.publishVectorRevision(next)).rejects.toThrow("obsolete Vector capture was not cleared");
    expect(rejected).toBe(true);expect(await api.vectorState(made.reference)).toEqual(stateBefore);expect(target.children).toEqual([child]);
    expect(target.getSharedPluginData("worldbend","vector-read-manifest")).toBe(cache);target.setSharedPluginData=write;
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,base,{width:240.5})));
    expect((await api.vectorState(made.reference)).revision).toBe(2);expect(target.getSharedPluginData("worldbend","vectorCreation")).toBe(creation);
    expect(target.getSharedPluginData("worldbend","vector-read-manifest")).toBe("");
    for(let i=0;i<35;i++)expect(target.getSharedPluginData("worldbend",`vector-read-chunk-${i}`)).toBe("");
  });
  it("rejects an extended output tangent before hidden preparation",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const publication=await projectProposal(await agentProposal(api,made.snapshot));
    Object.assign(publication.outputs[0]!.network.segments[0]!,{tangentStart:{x:0,y:0,extra:"汉"}});
    const vectors=h.api.createVector.mock.calls.length;
    await expect(api.publishVectorRevision(publication)).rejects.toThrow("Unsupported native vector publication");
    expect(h.registry.get(made.nodeId).children).toHaveLength(0);expect(h.api.createVector.mock.calls.length).toBe(vectors);
  });
  it("rejects a payload substituted after staging but before capture validation",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const publication=await projectProposal(await agentProposal(api,made.snapshot)),scope=await stageVector(api,publication);
    const target=h.registry.get(made.nodeId),substituted=structuredClone(publication),output=substituted.outputs[0]!;
    output.network.vertices[0]!.x=10;output.network.vertices[0]!.y=10;
    output.bounds.x=10;output.bounds.width=190.5;
    const encoded=Buffer.from(JSON.stringify(substituted)).toString("base64"),meta=JSON.parse(target.getSharedPluginData("worldbend","publication-transfer"));
    let hash=2166136261;for(const byte of Buffer.from(encoded))hash=Math.imul(hash^byte,16777619)>>>0;
    Object.assign(meta,{count:Math.ceil(encoded.length/32768),length:encoded.length,checksum:hash.toString(16).padStart(8,"0")});
    target.setSharedPluginData("worldbend","publication-transfer",JSON.stringify(meta));
    for(let index=0;index<meta.count;index++)target.setSharedPluginData("worldbend",`publication-chunk-${index}`,encoded.slice(index*32768,(index+1)*32768));
    await expect(api.validateVectorPublication(scope)).rejects.toThrow("INTEGRITY");
    await expect(api.finalizeVectorPublication(scope)).rejects.toThrow("INTEGRITY");
    expect(target.children).toHaveLength(0);
    await api.cancelPublication(scope);await stageVector(api,publication);
    await api.validateVectorPublication(scope);expect(await api.finalizeVectorPublication(scope)).toMatchObject({status:"published"});
  });
  it.each(["cancel","expiry","replace","same-id-renewal","guard","payload","page","source","target","child","ancestor-radius","ancestor-mode","ancestor-transform"] as const)(
    "rejects %s during asynchronous hidden preparation and preserves owned recovery",async(change)=>{
      let now=1_800_000_000_000;vi.spyOn(Date,"now").mockImplementation(()=>now);
      const h=host(),api=vectorAgentEntry(kind),ancestor=h.api.createFrame();ancestor.width=300;ancestor.height=200;
      ancestor.clipsContent=change!=="ancestor-mode";ancestor.topLeftRadius=0;
      if(change.startsWith("ancestor-"))ancestor.appendChild(h.source);else ancestor.remove();
      const made=await api.createVectorWork(createInput(h.source.id));
      await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
      const candidate=h.registry.get(made.nodeId),oldChild=candidate.children[0],oldNetwork=JSON.stringify(oldChild.vectorNetwork),oldFills=structuredClone(oldChild.fills);
      const base=await api.vectorState(made.snapshot),publication=await projectProposal(await agentProposal(api,base,{width:220.5}));
      const scope=await stageVector(api,publication);await api.validateVectorPublication(scope);
      let resume!:()=>void,reached!:()=>void;
      const paused=new Promise<void>(resolve=>{resume=resolve;}),entered=new Promise<void>(resolve=>{reached=resolve;});
      h.onNextNetwork(async()=>{reached();await paused;});
      const pending=api.finalizeVectorPublication(scope);await entered;
      let replacement:typeof scope|undefined;
      if(change==="cancel")await api.cancelPublication(scope);
      else if(change==="expiry")now+=600001;
      else if(change==="replace"||change==="same-id-renewal") {
        // A fresh incarnation must not alias the original even within the
        // same millisecond, with the same transfer id and identical payload.
        await api.cancelPublication(scope);
        replacement=await stageVector(api,publication,change==="replace"?"b".repeat(64):scope.transferId);
        await api.validateVectorPublication(replacement);
      } else if(change==="guard")candidate.setSharedPluginData("worldbend","vectorPublicationGuard","");
      else if(change==="payload")candidate.setSharedPluginData("worldbend","publication-chunk-0","A".repeat(candidate.getSharedPluginData("worldbend","publication-chunk-0").length));
      else if(change==="page")h.api.currentPage={...h.page,id:"another-page"};
      else if(change==="source")h.source.opacity=.45;
      else if(change==="target")candidate.name="Human name";
      else if(change==="ancestor-radius")ancestor.topLeftRadius=1;
      else if(change==="ancestor-mode")ancestor.clipsContent=true;
      else if(change==="ancestor-transform")ancestor.x=1;
      else oldChild.fills=[{type:"SOLID",color:{r:0,g:1,b:0}}];
      const ownedTransfer=candidate.getSharedPluginData("worldbend","publication-transfer"),ownedGuard=candidate.getSharedPluginData("worldbend","vectorPublicationGuard");
      resume();
      expect(await pending).toMatchObject({status:"failed",requiresInspection:true});
      expect(candidate.children).toEqual([oldChild]);expect(oldChild.removed).not.toBe(true);
      expect(JSON.stringify(oldChild.vectorNetwork)).toBe(oldNetwork);expect(candidate.width).toBe(200.5);
      expect([...h.registry.values()].some(n=>n.name?.startsWith("Worldbend vector preparation"))).toBe(false);
      if(change==="target")expect(candidate.name).toBe("Human name");
      if(change==="source")expect(h.source.opacity).toBe(.45);
      if(change==="child")expect(oldChild.fills[0].color.g).toBe(1);
      if(change==="page")h.api.currentPage=h.page;
      if(replacement) {
        expect(candidate.getSharedPluginData("worldbend","publication-transfer")).toBe(ownedTransfer);
        expect(candidate.getSharedPluginData("worldbend","vectorPublicationGuard")).toBe(ownedGuard);
        expect(await api.readPublication(replacement)).toEqual(publication);
        expect(await api.finalizeVectorPublication(replacement)).toMatchObject({status:"published"});
        expect(candidate.width).toBe(220.5);
      } else expect(await api.inspectPublication(scope)).toMatchObject({status:"empty"});
      if(change==="child") {
        await expect(api.vectorState(made.snapshot)).rejects.toThrow("changed");
        oldChild.fills=oldFills; // Explicit host Undo restores the owned proof.
      }
      // A fresh job still works after cancellation, expiry or a human edit.
      const fresh=await api.vectorState(made.snapshot),next=await stageVector(api,await projectProposal(await agentProposal(api,fresh,{width:240.5})),"c".repeat(64));
      await api.validateVectorPublication(next);expect(await api.finalizeVectorPublication(next)).toMatchObject({status:"published"});
      expect(candidate.width).toBe(240.5);
    });
  it("cold creates, reads exact geometry, validates transferred capture and publishes the same candidate",async()=>{
    const h=host(),api=vectorAgentEntry(kind),original=JSON.stringify(h.source.vectorNetwork),input=createInput(h.source.id);
    const made=await api.createVectorWork(input),candidate=h.registry.get(made.nodeId);
    const statePage=await api.readVectorState({...made.snapshot,part:0});
    expect(decodeExactJson(JSON.parse(statePage.json))).toEqual(made.snapshot);
    expect(decodeExactJson(JSON.parse(statePage.json))).not.toHaveProperty("part");
    expect(made.status).toBe("needs-projection");expect(candidate.children).toHaveLength(0);
    const proposal=await agentProposal(api,made.snapshot),publication=await projectProposal(proposal),scope=await stageVector(api,publication);
    expect(await api.validateVectorPublication(scope)).toMatchObject({status:"validated"});
    expect(candidate.children).toHaveLength(0);
    const receipt=await api.finalizeVectorPublication(scope);
    expect(receipt).toMatchObject({status:"published",snapshot:{reference:{nodeId:candidate.id,revision:1}}});
    expect(await api.vectorState(made.reference)).toMatchObject({published:true,revision:1});
    expect(candidate.children).toHaveLength(1);expect(candidate.width).toBe(200.5);
    expect(JSON.stringify(h.source.vectorNetwork)).toBe(original);
    expect(await api.inspectPublication(scope)).toMatchObject({status:"empty"});
    expect(candidate.getSharedPluginData("worldbend","vectorPublicationGuard")).toBe("");
    expect(await api.createVectorWork(input)).toMatchObject({reused:true,status:"published",nodeId:candidate.id,affectedNodeIds:[]});
  });
  it("rejects source changes after transfer validation and clears transport without altering the candidate",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const scope=await stageVector(api,await projectProposal(await agentProposal(api,made.snapshot)));
    await api.validateVectorPublication(scope);h.source.opacity=.45;
    expect(await api.finalizeVectorPublication(scope)).toMatchObject({status:"failed",error:{code:"E_FIGMA_CONFLICT"}});
    expect(h.registry.get(made.nodeId).children).toHaveLength(0);expect(h.source.opacity).toBe(.45);
    expect(await api.inspectPublication(scope)).toMatchObject({status:"empty"});
  });
  it("continues an ordinary native duplicate independently without stealing creation identity",async()=>{
    const h=host(),api=vectorAgentEntry(kind),input=createInput(h.source.id),made=await api.createVectorWork(input);
    await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const original=h.registry.get(made.nodeId),copy=h.api.createFrame();copy.resizeWithoutConstraints(original.width,original.height);
    for(const key of ["nativeVector","transform","binding","vectorCreation","vectorPending"])copy.setSharedPluginData("worldbend",key,original.getSharedPluginData("worldbend",key));
    for(const part of original.children)copy.appendChild(part.clone());
    const page=await api.readVectorState({fileKey:"file",pageId:"page",nodeId:copy.id,part:0}),state=decodeExactJson(JSON.parse(page.json)) as vectorState.VectorSnapshot;
    expect(state).toMatchObject({nodeId:copy.id,published:true,revision:0});
    const revised=await api.publishVectorRevision(await projectProposal(await agentProposal(api,state,{width:210.5})));
    expect(revised.snapshot).toMatchObject({nodeId:copy.id,revision:1,placement:{width:210.5}});
    expect(JSON.parse(original.getSharedPluginData("worldbend","binding")).revision).toBe(1);expect(original.width).toBe(200.5);
    expect(await api.createVectorWork(input)).toMatchObject({reused:true,nodeId:original.id,snapshot:{revision:1}});
  });
  it("preserves native edits made while path preparation awaits the host",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const publication=await projectProposal(await agentProposal(api,made.snapshot)),candidate=h.registry.get(made.nodeId);
    h.onNextNetwork(()=>{candidate.name="Human revised name";});
    await expect(api.publishVectorRevision(publication)).rejects.toThrow("changed");
    expect(candidate.name).toBe("Human revised name");expect(candidate.children).toHaveLength(0);
    expect(h.page.children.some((n:any)=>n.name.startsWith("Worldbend vector preparation"))).toBe(false);
  });
  it("replaces a missing original source while retaining current controls and work identity",async()=>{
    const h=host(),api=vectorAgentEntry(kind),input=createInput(h.source.id),made=await api.createVectorWork(input);
    const first=await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    const state=first.snapshot,candidate=h.registry.get(made.nodeId),oldChildren=[...candidate.children];
    h.source.remove();const replacement=h.makeVector("Replacement");replacement.fills=[{type:"SOLID",color:{r:0,g:1,b:0}}];
    const revised=await api.publishVectorRevision(await projectProposal(await agentProposal(api,state,{sourceNodeId:replacement.id,width:210.25})));
    expect(revised.snapshot).toMatchObject({nodeId:made.nodeId,revision:2,sourceNodeId:replacement.id,spec:perspectiveSpec,placement:{width:210.25,height:100.5}});
    expect(oldChildren.every(n=>n.removed)).toBe(true);
    expect(await api.createVectorWork(input)).toMatchObject({reused:true,nodeId:made.nodeId,snapshot:{revision:2,sourceNodeId:replacement.id}});
    const generated=candidate.children[0];generated.opacity=.3;
    await expect(api.readVectorState(state)).rejects.toThrow("changed");
    expect(generated.opacity).toBe(.3);
  });
  it("uses current native work as independent artwork even after its earlier source disappears",async()=>{
    const h=host(),api=vectorAgentEntry(kind),made=await api.createVectorWork(createInput(h.source.id));
    const published=await api.publishVectorRevision(await projectProposal(await agentProposal(api,made.snapshot)));
    h.source.remove();
    const next=await api.createVectorWork({...createInput(published.nodeId),requestId:"independent-native-source"});
    const capture=await agentProposal(api,next.snapshot);
    expect(capture.sourceNodeId).toBe(published.nodeId);expect(JSON.parse(capture.geometryJson)).toHaveLength(1);
    const output=await api.publishVectorRevision(await projectProposal(capture));
    expect(output.snapshot).toMatchObject({revision:1,sourceNodeId:published.nodeId});
    expect(decodeExactJson(JSON.parse((await api.readVectorState({fileKey:"file",pageId:"page",nodeId:published.nodeId})).json))).toMatchObject({revision:1});
  });
});

describe("native Vector document publication", () => {
  it("publishes the core expanded frame and retains its complete outward recipe on cold read", async () => {
    const h=host(), payload=input(h.source);
    const operation:NativeVectorStoredOperation={kind:"task",task:{kind:"deformation",view:"mesh",spec:{
      schema:"worldbend.deformation-work",version:"0.1",transform:spec,targetSize:{width:200,height:100},
      boundary:"free",meshSubdivisions:4,meshEdits:[{column:2,row:0,warped:{x:.5,y:-.2}},{column:2,row:4,warped:{x:.5,y:1.2}}]}}};
    const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolveNativeVectorOperation(operation).core,
      [buildNativeVectorProjectionInput({source:h.source,matrix:payload.matrix,reference:{width:200,height:100},placement:{width:200,height:140}})]));
    const publication={...payload,operation,sourceView:{policy:"logical" as const,bounds:h.source.absoluteBoundingBox},
      matrix:projected.plan.homography,executionFrame:nativeVectorExecutionFrame(projected.plan)!,renderHeight:projected.plan.reference.height,
      placement:{...payload.placement,height:140},projection:projected.outputs[0]!};
    const invalidFrame=structuredClone(publication.executionFrame); invalidFrame.transform.destination.quad.tr.x-=.01;
    await expect(publishNativeVectorResult({...publication,executionFrame:invalidFrame})).rejects.toThrow("Unsupported native vector publication");
    const result=await publishNativeVectorResult(publication);
    expect(result.height).toBe(140);
    expect((await nativeVectorDocumentParts(result)).operation).toEqual(operation);
    expect(readStoredBinding(result)).toMatchObject({renderWidth:200,renderHeight:140});
    await publishNativeVectorResult({...publication,existing:result});
    expect((await nativeVectorDocumentParts(result)).operation).toEqual(operation);
    expect(result.height).toBe(140);
  });
  it.each(["PAGE", "FRAME"] as const)("keeps grouped native-vector updates in the containing %s coordinate basis", async containerType => {
    const h = host(), payload = input(h.source);
    const result = await publishNativeVectorResult({ ...payload,
      projection: await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement) });
    const container = containerType === "PAGE" ? h.page : h.api.createFrame();
    if (containerType === "FRAME") { container.x = 1000; container.y = 2000; }
    const group = h.api.createFrame(); group.type = "GROUP"; group.x = 1200; group.y = 2300;
    if (containerType === "FRAME") container.appendChild(group);
    group.appendChild(result);
    const offset = containerType === "FRAME" ? { x: 1000, y: 2000 } : { x: 0, y: 0 };
    Object.defineProperty(result, "absoluteTransform", { get: () => [[1, 0, result.x + offset.x], [0, 1, result.y + offset.y]] });
    const placement = { ...payload.placement, x: 400 + offset.x, y: 500 + offset.y };
    await publishNativeVectorResult({ ...input(h.source, result, placement),
      projection: await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, placement) });
    expect(result).toMatchObject({ x: 400, y: 500, parent: group });
    expect((await nativeVectorDocumentParts(result)).record.placement).toEqual(placement);
    expect(readStoredBinding(result)?.revision).toBe(2);
  });

  it.each([1, 2])("reopens a native %i-part duplicate without writes, adopts it on Update, and protects edited parts", async count => {
    const h = host(), payload = input(h.source);
    const projection = await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement);
    const parts = Array.from({length:count}, () => ({geometry:h.source,projection}));
    const original = await publishNativeVectorResult({...payload,parts});
    const copy = h.api.createFrame(); copy.resizeWithoutConstraints(original.width, original.height);
    copy.x = 900; copy.y = 500;
    for (const key of ["operation", "transform", "nativeVector", "binding"]) {
      copy.setSharedPluginData("worldbend", key, original.getSharedPluginData("worldbend",key));
    }
    for (const child of original.children) {
      const clone: any = (child as VectorNode).clone(); clone.name = child.name;
      clone.width = child.width; clone.height = child.height;
      copy.appendChild(clone);
    }
    const raw = copy.getSharedPluginData("worldbend","nativeVector");
    const writes = vi.spyOn(copy,"setSharedPluginData");
    const before = await nativeVectorDocumentParts(copy);
    expect(before.copied).toBe(true);
    expect(before.contents).toEqual(copy.children);
    expect(writes).not.toHaveBeenCalled();
    expect(copy.getSharedPluginData("worldbend","nativeVector")).toBe(raw);
    copy.children[0].x += 1;
    await expect(nativeVectorDocumentParts(copy)).rejects.toThrow("Native vector result changed");
    copy.children[0].x -= 1;
    const kept = [...original.children];
    const updated = await publishNativeVectorResult({...payload,parts,existing:copy,
      placement:{x:copy.x,y:copy.y,width:copy.width,height:copy.height}});
    expect(updated).toBe(copy);
    expect((await nativeVectorDocumentParts(copy)).copied).toBe(false);
    expect(readStoredBinding(copy)?.sourceNodeIds).toEqual([h.source.id]);
    expect(original.children).toEqual(kept);
    expect(copy.x).toBe(900);
    copy.children[0].x += 1;
    await expect(nativeVectorDocumentParts(copy)).rejects.toThrow("Native vector result changed");
  });
  it("publishes detached primitive geometry, binds the original and reports native outlining without copying metadata", async () => {
    const h = host(); const payload = input(h.source);
    const geometry = { ...h.source, nativeStrokeOutlined: true as const };
    const output = await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement);
    const original = { ...h.source, type: "RECTANGLE", topLeftRadius: 12, topRightRadius: 12,
      bottomRightRadius: 12, bottomLeftRadius: 12, cornerSmoothing: .4 } as unknown as RectangleNode;
    const result = await publishNativeVectorResult({ ...payload, source: original, geometry, projection: output });
    expect((await nativeVectorDocumentParts(result)).record).toMatchObject({ sourceNodeId: original.id,
      fidelity: { class: "outlined", reasons: ["strokeOutlined"] } });
    expect(h.api.createVector).toHaveBeenCalledOnce(); expect(h.source.clone).not.toHaveBeenCalled();
    expect(readStoredBinding(result)?.sourceNodeIds).toEqual([original.id]);
  });

  it("rolls back if a primitive corner changes while its output is being written", async () => {
    const h = host(); const payload = input(h.source);
    const output = await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement);
    const original: any = { ...h.source, type: "RECTANGLE", topLeftRadius: 12, topRightRadius: 12,
      bottomRightRadius: 12, bottomLeftRadius: 12, cornerSmoothing: .4 };
    h.onNextNetwork(() => { original.topLeftRadius = 24; });
    await expect(publishNativeVectorResult({ ...payload, source: original, geometry: h.source, projection: output }))
      .rejects.toThrow("source changed");
    expect(h.page.children).toEqual([h.source]);
    expect(original.topLeftRadius).toBe(24);
  });
  it("creates one stable Frame with a projected native Vector and reusable state", async () => {
    const h = host();
    const payload = input(h.source);
    const result = await publishNativeVectorResult({
      ...payload,
      projection: await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement),
    });
    const parts = await nativeVectorDocumentParts(result);
    expect(result).toMatchObject({ name: "Card · Worldbend Vector", x: 300, y: 400, width: 200, height: 100 });
    expect(result.children).toEqual([parts.contents[0]]);
    expect(parts.contents[0]!.vectorNetwork.vertices).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ]);
    expect(readStoredOperation(result)).toEqual({ status: "valid", operation: { kind: "transform", spec } });
    expect(readStoredBinding(result)).toMatchObject({ sourceNodeIds: [h.source.id], revision: 1 });
    expect(parts.record).toMatchObject({ resultNodeId: result.id,
      parts: [{ contentNodeId: parts.contents[0]!.id }],
      sourceNodeId: h.source.id, outputSize: { width: 200, height: 100 } });
    expect(parts.record.fidelity).toEqual({ class: "exact", reasons: [] });
  });

  it("publishes curved paths under perspective with a bounded approximation report", async () => {
    const h = host();
    // Four-cubic circle approximation with real curvature.
    const k = 50 * 0.5523;
    h.source.width = 100;
    h.source.height = 100;
    h.source.vectorNetwork = {
      vertices: [{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }],
      segments: [
        { start: 0, end: 1, tangentStart: { x: k, y: 0 }, tangentEnd: { x: 0, y: -k } },
        { start: 1, end: 2, tangentStart: { x: 0, y: k }, tangentEnd: { x: k, y: 0 } },
        { start: 2, end: 3, tangentStart: { x: -k, y: 0 }, tangentEnd: { x: 0, y: k } },
        { start: 3, end: 0, tangentStart: { x: 0, y: -k }, tangentEnd: { x: -k, y: 0 } },
      ],
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }],
    };
    const solved = await solveTransform(perspectiveSpec, { width: 200, height: 100 });
    const payload = { ...input(h.source, undefined, { x: 0, y: 0, width: 200, height: 100 }),
      spec: perspectiveSpec,
      matrix: solved.homography.matrix as NineNumbers };
    const projection = await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement);
    expect(projection.report.fidelity).toBe("approximated");
    expect(projection.report.maxError).toBeLessThanOrEqual(0.25);
    expect(projection.network.segments.length).toBeGreaterThan(4);
    const result = await publishNativeVectorResult({ ...payload, projection });
    const parts = await nativeVectorDocumentParts(result);
    expect(parts.record.fidelity).toEqual({
      class: "approximated",
      maxError: projection.report.maxError,
      reasons: ["curveSubdivision"],
    });
    // Subdivided pieces stay connected through shared vertices.
    const content = parts.contents[0]!.vectorNetwork;
    for (const loop of content.regions![0]!.loops) {
      expect(loop.length).toBe(content.segments.filter((segment: { tangentStart?: unknown }) => segment.tangentStart).length);
    }
    const outlined = await publishNativeVectorResult({ ...payload, projection,
      geometry: { ...h.source, nativeStrokeOutlined: true } });
    expect((await nativeVectorDocumentParts(outlined)).record.fidelity).toEqual({
      class: "outlined", maxError: projection.report.maxError,
      reasons: ["curveSubdivision", "strokeOutlined"],
    });
  });

  it("publishes a stroked path as outlined fills with the stroke paint attached", async () => {
    const h = host();
    const stroke = { type: "SOLID" as const, color: { r: 0, g: 0, b: 0 } };
    const regionFill = { type: "SOLID" as const, color: { r: 0, g: 1, b: 0 } };
    h.source.strokes = [stroke];
    h.source.strokeWeight = 8;
    h.source.vectorNetwork = {
      ...h.source.vectorNetwork,
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [regionFill] }],
    };
    const payload = input(h.source);
    const projection = await project(h.source, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement);
    expect(projection.report.fidelity).toBe("outlined");
    expect(projection.report.strokeOutlined).toBe(true);
    expect(projection.report.maxError).toBeUndefined();
    const result = await publishNativeVectorResult({ ...payload, projection });
    const parts = await nativeVectorDocumentParts(result);
    expect(parts.record.fidelity).toEqual({ class: "outlined", reasons: ["strokeOutlined"] });
    const content = parts.contents[0]!.vectorNetwork;
    // Fill regions keep the source paint; the stroke region carries the
    // stroke paint and holds both outline loops of the closed chain, so its
    // nonzero winding keeps the interior hole open.
    expect(content.regions!.length).toBe(2);
    expect(content.regions![0]!.fills).toEqual([regionFill]);
    expect(content.regions![1]!.fills).toEqual([stroke]);
    expect(content.regions![1]!.windingRule).toBe("NONZERO");
    expect(content.regions![1]!.loops.length).toBe(2);
    expect(parts.contents[0]!.strokes).toEqual([]);
    // The outer outline extends past the source square by half the stroke
    // in path units, scaled by the 2x placement over the source bounds.
    const xs = content.vertices.map((vertex: { x: number }) => vertex.x + (parts.contents[0] as unknown as { x: number }).x);
    expect(Math.min(...xs)).toBeCloseTo(-8, 6);
  });

  it("enables native fills before publishing explicit multi-color regions from a mixed capture", async () => {
    const h = host(), payload = input(h.source);
    const red = h.source.fills[0];
    const blue = { type: "SOLID" as const, color: { r: 0, g: 0, b: 1 } };
    const geometry = { ...h.source, fills: [], vectorNetwork: {
      ...h.source.vectorNetwork,
      regions: [
        { windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [red] },
        { windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [blue] },
      ],
    } } as VectorNode;
    let baseFillsAtWrite: Paint[] | undefined;
    h.onNextNetwork(() => {
      baseFillsAtWrite = h.api.createVector.mock.results.at(-1)!.value.fills;
    });
    const result = await publishNativeVectorResult({ ...payload, parts: [{ geometry,
      projection: await project(geometry, payload.matrix, payload.renderWidth, payload.renderHeight, payload.placement),
    }] });
    expect(baseFillsAtWrite).toEqual([red]);
    expect((result.children[0] as VectorNode).vectorNetwork.regions!.map(region => region.fills))
      .toEqual([[red], [blue]]);
  });

  it("updates the wrapper in place, replaces only its generated child, and advances the binding revision", async () => {
    const h = host();
    const first = await publishNativeVectorResult({
      ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    });
    const before = await nativeVectorDocumentParts(first);
    const placement = { x: 320, y: 440, width: 300, height: 150 };
    const updated = await publishNativeVectorResult({
      ...input(h.source, first, placement),
      projection: await project(h.source, [300, 0, 0, 0, 150, 0, 0, 0, 1], 300, 150, placement),
    });
    const second = await nativeVectorDocumentParts(updated);
    expect(updated).toBe(first);
    expect(updated).toMatchObject({ x: 320, y: 440, width: 300, height: 150 });
    expect(second.contents[0]!.id).not.toBe(before.contents[0]!.id);
    expect(h.registry.has(before.contents[0]!.id)).toBe(false);
    expect(readStoredBinding(updated)?.revision).toBe(2);
  });

  it("refuses to overwrite paths edited directly in Figma", async () => {
    const h = host();
    const result = await publishNativeVectorResult({
      ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    });
    const content = (await nativeVectorDocumentParts(result)).contents[0]!;
    content.x += 1;
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("Native vector result changed");
    await expect(publishNativeVectorResult({
      ...input(h.source, result),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    })).rejects.toThrow("Native vector result changed");
    expect(result.children).toEqual([content!]);
  });

  it("refuses to overwrite generated layer metadata or a transformed result basis", async () => {
    const h = host();
    const result = await publishNativeVectorResult({
      ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    });
    const content = (await nativeVectorDocumentParts(result)).contents[0]!;
    content.name = "Keep my layer name";
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("Native vector result changed");
    content.name = "Vector";
    content.isMask = true;
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("Native vector result changed");
    content.isMask = false;
    (result as FrameNode & { absoluteTransformOverride: Transform }).absoluteTransformOverride =
      [[0, -1, 0], [1, 0, 0]];
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("Native vector result changed");
  });

  it("treats wrapper appearance changes as an edited result", async () => {
    const h = host();
    const result = await publishNativeVectorResult({
      ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    });
    result.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: 4, visible: true }];
    await expect(nativeVectorDocumentParts(result)).rejects.toThrow("Native vector result changed");
  });

  it("rejects a matrix that does not represent the stored core operation", async () => {
    const h = host();
    await expect(publishNativeVectorResult({ ...input(h.source),
      matrix: [100, 0, 0, 0, 100, 0, 0, 0, 1],
      projection: await project(h.source, [100, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    })).rejects.toThrow("Unsupported native vector publication");
    expect(h.page.children).toEqual([h.source]);
  });

  it("rejects a valid operation whose projected path falls outside the result frame", async () => {
    const h = host();
    const shifted: TransformSpec = { ...spec, destination: { space: "normalized", quad: {
      tl: { x: -.1, y: 0 }, tr: { x: .9, y: 0 }, br: { x: .9, y: 1 }, bl: { x: -.1, y: 1 },
    } } };
    await expect(publishNativeVectorResult({ ...input(h.source), spec: shifted,
      matrix: [200, 0, -20, 0, 100, 0, 0, 0, 1],
      projection: await project(h.source, [200, 0, -20, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    })).rejects.toThrow("exceeds its result bounds");
    expect(h.page.children).toEqual([h.source]);
  });

  it("accepts a curve whose handles leave the frame while the curve itself stays inside", async () => {
    const h = host();
    h.source.vectorNetwork = {
      vertices: [{ x: 0, y: 25 }, { x: 100, y: 25 }, { x: 50, y: 50 }],
      segments: [
        { start: 0, end: 1, tangentStart: { x: 0, y: -30 }, tangentEnd: { x: 0, y: 30 } },
        { start: 1, end: 2 },
        { start: 2, end: 0 },
      ],
      regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2]] }],
    };
    const projection: VectorProjectionOutput = {
      network: {
        vertices: [{ x: 0, y: 50 }, { x: 200, y: 50 }, { x: 100, y: 100 }],
        segments: [
          { start: 0, end: 1, tangentStart: { x: 0, y: -60 }, tangentEnd: { x: 0, y: 60 } },
          { start: 1, end: 2 },
          { start: 2, end: 0 },
        ],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2]] }],
      },
      bounds: { x: 0, y: 32.67949192431123, width: 200, height: 67.32050807568876 },
      report: {
        fidelity: "exact", strokeOutlined: false, tolerancePx: 0.25, reasons: [],
        inputVertices: 3, inputSegments: 3, inputRegions: 1,
        outputVertices: 3, outputSegments: 3, outputRegions: 1,
        maxSubdivisionDepth: 0,
      },
    };
    const result = await publishNativeVectorResult({ ...input(h.source), projection });
    expect(result.children).toHaveLength(1);
  });

  it("rolls back when the source changes during an asynchronous host write", async () => {
    const h = host();
    h.onNextNetwork(() => { h.source.x += 1; });
    await expect(publishNativeVectorResult({ ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    })).rejects.toThrow("Native vector source changed");
    expect(h.page.children).toEqual([h.source]);
  });

  it("rolls back when the caller invalidates the selection during a host write", async () => {
    const h = host();
    await expect(publishNativeVectorResult({ ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
      validateWrite: () => { throw new Error("selection changed"); },
    })).rejects.toThrow("selection changed");
    expect(h.page.children).toEqual([h.source]);
  });

  it("removes an incomplete new result and preserves an existing result when vector writes fail", async () => {
    const h = host();
    h.rejectNetwork();
    await expect(publishNativeVectorResult({ ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    })).rejects.toThrow("network write failed");
    expect(h.page.children).toEqual([h.source]);

    const result = await publishNativeVectorResult({ ...input(h.source),
      projection: await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    });
    const before = await nativeVectorDocumentParts(result);
    const binding = readStoredBinding(result);
    h.rejectNetwork();
    const placement = { x: 900, y: 800, width: 300, height: 150 };
    await expect(publishNativeVectorResult({ ...input(h.source, result, placement),
      projection: await project(h.source, [300, 0, 0, 0, 150, 0, 0, 0, 1], 300, 150, placement),
    })).rejects.toThrow("network write failed");
    expect(result).toMatchObject({ x: 300, y: 400, width: 200, height: 100 });
    expect(result.children).toEqual([before.contents[0]]);
    expect(readStoredBinding(result)).toEqual(binding);
    await expect(nativeVectorDocumentParts(result)).resolves.toMatchObject({ contents: [before.contents[0]!] });
  });

  it("keeps the published graph intact during preparation and preserves a later native resize", async () => {
    const h=host(),payload={...input(h.source),
      projection:await project(h.source,[200,0,0,0,100,0,0,0,1],200,100,{width:200,height:100})};
    const result=await publishNativeVectorResult(payload),prior=await nativeVectorDocumentParts(result);
    const binding=result.getSharedPluginData("worldbend","binding"),record=result.getSharedPluginData("worldbend","nativeVector");
    h.onNextNetwork(()=>{
      expect(result).toMatchObject({width:200,height:100,x:300,y:400});
      expect(result.children).toEqual(prior.contents);
      expect(h.page.children.filter((n:SceneNode)=>n.name.startsWith("Worldbend vector preparation")).every((n:SceneNode)=>n.visible===false)).toBe(true);
      result.resizeWithoutConstraints(777,100);
    });
    const placement={x:900,y:800,width:300,height:150};
    await expect(publishNativeVectorResult({...input(h.source,result,placement),
      projection:await project(h.source,[300,0,0,0,150,0,0,0,1],300,150,placement)})).rejects.toThrow("changed during preparation");
    expect(result).toMatchObject({width:777,height:100,x:300,y:400});
    expect(result.children).toEqual(prior.contents);
    expect(result.getSharedPluginData("worldbend","binding")).toBe(binding);
    expect(result.getSharedPluginData("worldbend","nativeVector")).toBe(record);
    expect(h.page.children).toEqual([h.source,result]);
  });

  it("preserves a native edit to the old vector child while the replacement network awaits", async () => {
    const h=host(),projection=await project(h.source,[200,0,0,0,100,0,0,0,1],200,100,{width:200,height:100});
    const result=await publishNativeVectorResult({...input(h.source),projection}),prior=await nativeVectorDocumentParts(result);
    h.onNextNetwork(()=>{prior.contents[0]!.opacity=.45;});
    await expect(publishNativeVectorResult({...input(h.source,result),projection})).rejects.toThrow("changed during preparation");
    expect(prior.contents[0]!.opacity).toBe(.45);
    expect(result.children).toEqual(prior.contents);
    expect(readStoredBinding(result)?.revision).toBe(1);
    expect(h.page.children).toEqual([h.source,result]);
  });

  it("fills an owned empty candidate in place and retains it unchanged after a preparation failure", async () => {
    const h=host(),candidate=h.api.createFrame(),projection=await project(h.source,[200,0,0,0,100,0,0,0,1],200,100,{width:200,height:100});
    candidate.name="Agent Vector work";candidate.resizeWithoutConstraints(200,100);candidate.x=300;candidate.y=400;
    candidate.setSharedPluginData("worldbend","vectorPending","candidate-state");
    h.rejectNetwork();
    await expect(publishNativeVectorResult({...input(h.source),unpublished:candidate,projection})).rejects.toThrow("network write failed");
    expect(candidate).toMatchObject({name:"Agent Vector work",width:200,height:100,x:300,y:400,children:[]});
    expect(candidate.getSharedPluginData("worldbend","vectorPending")).toBe("candidate-state");
    expect(await publishNativeVectorResult({...input(h.source),unpublished:candidate,projection})).toBe(candidate);
    expect((await nativeVectorDocumentParts(candidate)).record.resultNodeId).toBe(candidate.id);
    expect(readStoredBinding(candidate)?.revision).toBe(1);
  });
});


describe("multi-part whole-artwork publication", () => {
  const artwork = (h: ReturnType<typeof host>) => {
    const poster: any = { ...h.source, id: "poster", type: "FRAME", name: "Poster",
      children: [], fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      strokes: [], clipsContent: false, layoutMode: "NONE", removed: false,
      get absoluteTransform() { return [[1, 0, 0], [0, 1, 0]]; } };
    return poster as unknown as FrameNode;
  };

  it("publishes one projected child per captured layer with a 0.2 parts record", async () => {
    const h = host(); const poster = artwork(h);
    const blue = { ...h.source, fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }] };
    const outputs = [
      await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
      await project(blue as unknown as VectorNode, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 }),
    ];
    const result = await publishNativeVectorResult({
      source: poster, spec, matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 200, renderHeight: 100,
      placement: { x: 0, y: 0, width: 200, height: 100 },
      parts: [
        { geometry: h.source as unknown as import("./native-vector").NativeVectorGeometry, projection: outputs[0]! },
        { geometry: { ...blue, nativeTextOutlined: true } as unknown as import("./native-vector").NativeVectorGeometry, projection: outputs[1]! },
      ],
    });
    const parts = await nativeVectorDocumentParts(result);
    expect(result.children).toHaveLength(2);
    expect(result.children.map((child) => child.name)).toEqual(["Vector 1", "Vector 2"]);
    expect(parts.record.version).toBe("0.2");
    expect(parts.record.parts).toHaveLength(2);
    expect(parts.record.parts.map((part) => part.contentNodeId)).toEqual(result.children.map((child) => child.id));
    // The text layer freezes outlines, so the combined summary reports it.
    expect(parts.record.fidelity).toEqual({ class: "outlined", reasons: ["textOutlined"] });
    expect(readStoredBinding(result)?.sourceNodeIds).toEqual([poster.id]);
  });

  it("replaces every generated child on update and preserves the result frame on failure", async () => {
    const h = host(); const poster = artwork(h);
    const geometry = h.source as unknown as import("./native-vector").NativeVectorGeometry;
    const output = await project(h.source, [200, 0, 0, 0, 100, 0, 0, 0, 1], 200, 100, { width: 200, height: 100 });
    const result = await publishNativeVectorResult({
      source: poster, spec, matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 200, renderHeight: 100, placement: { x: 0, y: 0, width: 200, height: 100 },
      parts: [{ geometry, projection: output }, { geometry, projection: output }],
    });
    const first = await nativeVectorDocumentParts(result);
    const placement = { x: 100, y: 100, width: 300, height: 150 };
    const updated = await publishNativeVectorResult({
      source: poster, existing: result, spec, matrix: [300, 0, 0, 0, 150, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 300, renderHeight: 150, placement,
      parts: [{ geometry, projection: await project(h.source, [300, 0, 0, 0, 150, 0, 0, 0, 1], 300, 150, placement) },
        { geometry, projection: await project(h.source, [300, 0, 0, 0, 150, 0, 0, 0, 1], 300, 150, placement) }],
    });
    expect(updated).toBe(result);
    expect(updated.children).toHaveLength(2);
    expect(updated.children.every((child) => !first.contents.some((old) => old.id === child.id))).toBe(true);
    expect(readStoredBinding(updated)?.revision).toBe(2);

    // A failing write preserves both previous children and the record.
    h.rejectNetwork();
    const before = await nativeVectorDocumentParts(result);
    await expect(publishNativeVectorResult({
      source: poster, existing: result, spec, matrix: [300, 0, 0, 0, 150, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 300, renderHeight: 150, placement,
      parts: [{ geometry, projection: output }, { geometry, projection: output }],
    })).rejects.toThrow("network write failed");
    expect(result.children).toEqual(before.contents);
    await expect(nativeVectorDocumentParts(result)).resolves.toBeTruthy();
  });

  it("exempts unambiguous native stroke-outline regions from the placement fit", async () => {
    const h = host(); const poster = artwork(h);
    // Both regions project past the left edge of the placement; only the
    // first (fill) region must fail the fit check.
    const projection: VectorProjectionOutput = {
      network: {
        vertices: [{ x: -20, y: 0 }, { x: 180, y: 0 }, { x: 180, y: 100 }, { x: -20, y: 100 },
          { x: -40, y: 10 }, { x: 160, y: 10 }, { x: 160, y: 90 }, { x: -40, y: 90 }],
        segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 },
          { start: 4, end: 5 }, { start: 5, end: 6 }, { start: 6, end: 7 }, { start: 7, end: 4 }],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }, { windingRule: "NONZERO", loops: [[4, 5, 6, 7]] }],
      },
      bounds: { x: -40, y: 0, width: 220, height: 100 },
      report: {
        fidelity: "exact", strokeOutlined: false, tolerancePx: 0.25, reasons: [],
        inputVertices: 8, inputSegments: 8, inputRegions: 2,
        outputVertices: 8, outputSegments: 8, outputRegions: 2, maxSubdivisionDepth: 0,
      },
    };
    const geometry = { ...(h.source as unknown as import("./native-vector").NativeVectorGeometry),
      vectorNetwork: { ...(h.source as any).vectorNetwork,
        vertices: projection.network.vertices.map((vertex) => ({ x: vertex.x / 2, y: vertex.y / 2 })),
        segments: projection.network.segments.map((segment) => ({ ...segment })),
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]], fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] },
          { windingRule: "NONZERO", loops: [[4, 5, 6, 7]], fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] }] },
      nativeStrokeOutlineRegions: [false, true] };
    await expect(publishNativeVectorResult({
      source: poster, spec, matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 200, renderHeight: 100, placement: { x: 0, y: 0, width: 200, height: 100 },
      parts: [{ geometry, projection }],
    })).rejects.toThrow("exceeds its result bounds");
    // With the fill region inside, the overflowing outline alone publishes.
    const inside = structuredClone(projection);
    inside.network.vertices = inside.network.vertices.map((vertex, index) =>
      index < 4 ? { x: vertex.x + 20, y: vertex.y } : vertex);
    inside.bounds = { x: -40, y: 0, width: 240, height: 100 };
    const result = await publishNativeVectorResult({
      source: poster, spec, matrix: [200, 0, 0, 0, 100, 0, 0, 0, 1] as NineNumbers,
      renderWidth: 200, renderHeight: 100, placement: { x: 0, y: 0, width: 200, height: 100 },
      parts: [{ geometry, projection: inside }],
    });
    expect(result.children).toHaveLength(1);
  });
});

describe("native vector rollback reporting", () => {
  it("exposes the rollback-incomplete error type", () => {
    expect(new NativeVectorRollbackIncompleteError("x")).toBeInstanceOf(Error);
  });
});
