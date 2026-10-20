import type { TransformSpec } from "@worldbend/web/types";
import { captureNativeVectorSource } from "./native-vector-source";
import { captureArtworkVectorGeometry, isArtworkVectorSource } from "./native-vector-artwork";
import { vectorSourcesProof, vectorValue } from "./agent-vector-proof";
export { vectorValue } from "./agent-vector-proof";
import type { WorkPage } from "./agent-work-state";
import { vectorSpec, vectorState, vectorScope, vectorReference, type VectorSnapshot, type VectorReference } from "./agent-vector-state";
import { nativeVectorSourceView,retainedNativeVectorSourceView,nativeVectorSourceViewMatches } from "./source-raster";
import { nativeVectorOperationDigest,resolveNativeVectorOperation,type NativeVectorStoredOperation } from "./native-vector-operation";
import {captureDocumentShapeForSource} from "./native-shape-document";
import {normalizedDocumentShape} from "./native-shape";
import {encodeExactJson} from "./exact-json-codec";
import {storeVectorCapture,readCachedVectorRevision} from "./agent-vector-read-cache";
import {finishPublication} from "./agent-handoff-media";

export interface VectorRevisionInput {
  base:VectorSnapshot|VectorReference;sourceNodeId?:string;sourceNodeIds?:string[];spec?:TransformSpec;
  operation?:NativeVectorStoredOperation;sourceViewPolicy?:"logical"|"appearance";width?:number;height?:number;
}
export async function vectorProposal(input:VectorRevisionInput) {
  const base=await vectorState(input.base);
  if(base.targetExpected!==input.base.targetExpected||base.revision!==input.base.revision)throw Error("E_FIGMA_CONFLICT: Vector work changed; reread");
  if(input.operation&&input.spec)throw Error("E_FIGMA_INPUT: provide one complete Vector operation");
  const operation=input.operation??(input.spec?{kind:"transform" as const,spec:input.spec}:base.operation??{kind:"transform" as const,spec:base.spec});
  const resolved=resolveNativeVectorOperation(operation),width=input.width??base.placement.width,height=input.height??base.placement.height;
  vectorSpec(resolved.plane,width,height);
  let sourceNodeIds=input.sourceNodeIds??base.sourceNodeIds??[base.sourceNodeId];
  if(input.sourceNodeId){sourceNodeIds=[...sourceNodeIds];sourceNodeIds[resolved.artworkSourceIndex]=input.sourceNodeId;}
  const proof=await vectorSourcesProof(base,operation,sourceNodeIds),{artwork,sourceExpected}=proof;
  const sourceView=input.sourceViewPolicy!==undefined?(base.sourceView?.selection==="explicit"&&base.sourceView.policy===input.sourceViewPolicy?
    retainedNativeVectorSourceView(artwork,base.sourceView):nativeVectorSourceView(artwork,input.sourceViewPolicy)):
    retainedNativeVectorSourceView(artwork,base.sourceView??(base.version==="0.1"?{policy:"logical",bounds:artwork.absoluteBoundingBox!}:undefined));
  const geometries=isArtworkVectorSource(artwork)?await captureArtworkVectorGeometry(artwork,figma,()=>{}):
    await captureNativeVectorSource(artwork,figma,()=>{},undefined,{outlineStroke:true}).then(g=>g?[g]:undefined);
  vectorScope(base);proof.validate();
  if(!geometries?.length)throw Error("E_FIGMA_INPUT: native Vector capture is unavailable; use linked HD");
  let shapeGuideClip:ReturnType<typeof normalizedDocumentShape>|undefined;
  if(operation.kind==="task"&&operation.task.shapeGuideSourceIndex!==undefined){
    const guide=proof.sources[operation.task.shapeGuideSourceIndex];
    const shape=guide?.type==="VECTOR"?await captureDocumentShapeForSource(guide):undefined;
    if(!shape)throw Error("E_FIGMA_INPUT: preserve the current closed native shape guide");
    shapeGuideClip=normalizedDocumentShape(shape);
  }
  const current=await vectorState(base);proof.validate();
  if(current.targetExpected!==base.targetExpected||!nativeVectorSourceViewMatches(artwork,sourceView))
    throw Error("E_FIGMA_CONFLICT: Vector source/work changed during capture");
  const data={schema:"worldbend.figma.vector-proposal" as const,version:"0.3" as const,base:vectorReference(base),
    sourceNodeId:artwork.id,sourceNodeIds:[...sourceNodeIds],sourceExpected,operation,operationExpected:nativeVectorOperationDigest(operation),
    sourceView,width,height,bounds:{...sourceView.bounds},geometryJson:vectorValue(geometries),...(shapeGuideClip?{shapeGuideClip}:{})};
  // Whole core geometry and opaque appearance have separate bounded budgets.
  // Encoding is exact; no coordinate/style/control field is reduced.
  const envelope=encodeExactJson(data);
  return {data,artwork,envelope,validate:()=>{vectorScope(base);proof.validate();}};
}
export async function readVectorRevision(input:VectorRevisionInput&WorkPage) {
  if((input.part??0)>0)return readCachedVectorRevision({...input.base,...(input.part===undefined?{}:{part:input.part}),...(input.token===undefined?{}:{token:input.token})});
  const accepted=await vectorProposal(input),target=await figma.getNodeByIdAsync(input.base.nodeId);accepted.validate();
  if(target?.type!=="FRAME")throw Error("E_FIGMA_SCOPE: Vector candidate unavailable");
  const current=await vectorState(input.base);accepted.validate();
  if(current.targetExpected!==accepted.data.base.targetExpected)throw Error("E_FIGMA_CONFLICT: work changed before capture retention");
  const first=storeVectorCapture(target,accepted.envelope,{reference:accepted.data.base,
    sourceNodeId:accepted.data.sourceNodeId,sourceNodeIds:accepted.data.sourceNodeIds,sourceExpected:accepted.data.sourceExpected,sourceView:accepted.data.sourceView,
    currentOperationExpected:nativeVectorOperationDigest(current.operation??{kind:"transform",spec:current.spec})});
  accepted.validate();return {...first,reference:accepted.data.base};
}
/** Full capture runtime is staged separately from its bounded argument data. */
export async function readTransferredVectorRevision(scope:{fileKey:string;pageId:string;nodeId:string;transferId:string;payloadDigest:string}) {
  return finishPublication(scope,async(data,lease)=>{
    const input=data as unknown as VectorRevisionInput&WorkPage;lease.validate();
    if(input.base.nodeId!==scope.nodeId||input.base.fileKey!==scope.fileKey||input.base.pageId!==scope.pageId)
      throw Error("E_FIGMA_SCOPE: Vector capture scope changed");
    const page=await readVectorRevision(input);lease.validate();return {nodeId:scope.nodeId,...page};
  },"captured");
}
