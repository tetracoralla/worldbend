import type { NineNumbers, VectorProjectionOutput } from "@worldbend/web/types";
import { publishNativeVectorResult, publicationTargetFingerprint } from "./native-vector-document";
import type { NativeVectorGeometry } from "./native-vector";
import type { vectorProposal, VectorRevisionInput } from "./agent-vector-read";
import { boundedStateFingerprint } from "./agent-handoff";
import { vectorSourcesProof, vectorValue } from "./agent-vector-proof";
import { vectorScope, vectorState } from "./agent-vector-state";
import {nativeVectorSourceViewMatches} from "./source-raster";
import {isNativeVectorSourceView} from "./native-vector-view";
import {nativeVectorOperationDigest,resolveNativeVectorOperation,nativeVectorOperationReference,type NativeVectorStoredOperation} from "./native-vector-operation";
import type { PublicationLease } from "./agent-handoff-media";

export interface VectorPublicationInput {
  fileKey:string;pageId:string;nodeId:string;
  proposal:Awaited<ReturnType<typeof vectorProposal>>["data"];
  renderedOperation?:NativeVectorStoredOperation;renderedSourceView?:import("./native-vector-view").NativeVectorSourceView;matrix:NineNumbers;outputs:VectorProjectionOutput[];clip?:VectorProjectionOutput|null;
  executionFrame?: import("./native-vector-operation").NativeVectorExecutionFrame;
}
export function vectorProposalRevision(saved:VectorPublicationInput["proposal"]):VectorRevisionInput {
  return {base:saved.base,sourceNodeIds:saved.sourceNodeIds,operation:saved.operation,
    ...(saved.sourceView.selection==="explicit"?{sourceViewPolicy:saved.sourceView.policy}:{}),width:saved.width,height:saved.height};
}
function renderedVectorOperation(input:VectorPublicationInput):NativeVectorStoredOperation {
  const saved=input.proposal,operation=input.renderedOperation??saved.operation;
  resolveNativeVectorOperation(operation);
  if(nativeVectorOperationDigest(saved.operation)!==saved.operationExpected)throw Error("E_FIGMA_INTEGRITY: complete Vector operation witness changed");
  if(vectorValue(operation)===vectorValue(saved.operation))return operation;
  const old=saved.operation.kind==="task"?saved.operation.task:undefined,next=operation.kind==="task"?operation.task:undefined;
  const interior=(task:NonNullable<typeof old>)=>{
    const {shapeFit,...spec}=task.spec;const {shapeGuideDomain,...carrier}=task;
    return {...carrier,spec};
  };
  if(!old||!next||old.shapeGuideSourceIndex===undefined||
    vectorValue(interior(old))!==vectorValue(interior(next))||vectorValue(next.spec.shapeFit?.clip)!==vectorValue(saved.shapeGuideClip))
    throw Error("E_FIGMA_INTEGRITY: native guide refresh must preserve all unrelated operation controls");
  return operation;
}
export async function publishPreparedVector(input:VectorPublicationInput, artwork:SceneNode, sourceValidate:()=>void) {
  const saved=input.proposal;
  if(input.fileKey!==saved.base.fileKey||input.pageId!==saved.base.pageId||input.nodeId!==saved.base.nodeId)throw Error("E_FIGMA_SCOPE: Vector payload scope changed");
  const operation=renderedVectorOperation(input),resolved=resolveNativeVectorOperation(operation);
  const sourceView=input.renderedSourceView??saved.sourceView;
  if(!isNativeVectorSourceView(sourceView)||!nativeVectorSourceViewMatches(artwork,sourceView)||
    sourceView.policy!==saved.sourceView.policy||sourceView.selection!==saved.sourceView.selection||
    (input.renderedSourceView&&vectorValue(sourceView.reportedBounds)!==vectorValue(saved.sourceView.reportedBounds??saved.sourceView.bounds)))
    throw Error("E_FIGMA_INTEGRITY: native source enclosure must retain its reported witness");
  const geometries=JSON.parse(saved.geometryJson) as NativeVectorGeometry[];
  if(!geometries.length||geometries.length!==input.outputs.length)throw Error("E_FIGMA_INPUT: Vector projections must match all captured layers");
  const target=await figma.getNodeByIdAsync(saved.base.nodeId),base=await vectorState(saved.base);
  const validate=()=>{
    vectorScope(saved.base);sourceValidate();
    if(target?.type!=="FRAME"||target.removed||publicationTargetFingerprint(target)!==saved.base.targetExpected)throw Error("E_FIGMA_CONFLICT: native Vector work changed");
  };
  validate();
  const frameReference=input.executionFrame?.reference;
  const reference=frameReference??nativeVectorOperationReference(resolved.core,{width:Math.ceil(saved.width),height:Math.ceil(saved.height)});
  const result=await publishNativeVectorResult({source:artwork,
    ...(base.published?{existing:target as FrameNode}:{unpublished:target as FrameNode}),
    spec:resolved.plane,operation,operationExpected:nativeVectorOperationDigest(operation),sourceNodeIds:saved.sourceNodeIds,sourceView,
    ...(input.executionFrame ? {executionFrame:input.executionFrame} : {}),
    ...(input.clip?{clip:input.clip}:{}),matrix:input.matrix,parts:geometries.map((geometry,i)=>({geometry,projection:input.outputs[i]!})),
    placement:{...base.placement,width:saved.width,height:saved.height},renderWidth:reference.width,renderHeight:reference.height,
    beforeWrite:validate,validateWrite:validate});
  // Metadata receipt carries a light reference; large controls are read with
  // the exact state pages, never echoed unbounded into a 20 KiB host response.
  const snapshot=await vectorState(saved.base);
  return {schema:"worldbend.figma.vector-publication",version:"0.3",nodeId:result.id,
    reference:{fileKey:snapshot.fileKey,pageId:snapshot.pageId,nodeId:snapshot.nodeId,revision:snapshot.revision,targetExpected:snapshot.targetExpected},
    operationExpected:snapshot.operationExpected,sourceNodeIds:snapshot.sourceNodeIds,sourceView:snapshot.sourceView,affectedNodeIds:[result.id]};
}

/** All immutable lease, payload, source-role and target checks compose at
 * every asynchronous native network write and the final synchronous swap. */
export async function publishValidatedVector(input:VectorPublicationInput,scope:{transferId:string},lease:PublicationLease) {
  lease.validate();
  const saved=input.proposal,base=await vectorState(saved.base);
  const proof=await vectorSourcesProof(base,saved.operation,saved.sourceNodeIds);
  const target=await figma.getNodeByIdAsync(base.nodeId);
  const originalGuard=target?.getSharedPluginData("worldbend","vectorPublicationGuard")??"";
  let guard:{transferId?:unknown;leaseId?:unknown;expiresAt?:unknown;payloadExpected?:unknown}|undefined;
  try{guard=JSON.parse(originalGuard);}catch{ /* Require fresh successful validation. */ }
  if(!guard||Object.keys(guard).length!==4||guard.transferId!==scope.transferId||guard.leaseId!==lease.leaseId||
    typeof guard.expiresAt!=="number"||!Number.isSafeInteger(guard.expiresAt)||guard.expiresAt<=Date.now()||guard.expiresAt!==lease.expiresAt||
    guard.payloadExpected!==boundedStateFingerprint(vectorValue(input))||base.targetExpected!==saved.base.targetExpected||base.revision!==saved.base.revision||
    proof.sourceExpected!==saved.sourceExpected||!nativeVectorSourceViewMatches(proof.artwork,saved.sourceView))
    throw Error("E_FIGMA_CONFLICT: Vector publication changed or was not validated; recapture");
  const validate=()=>{
    lease.validate();proof.validate();
    if(target?.getSharedPluginData("worldbend","vectorPublicationGuard")!==originalGuard)
      throw Error("E_FIGMA_CONFLICT: Vector publication validation changed; recapture");
  };
  validate();return publishPreparedVector(input,proof.artwork,validate);
}
