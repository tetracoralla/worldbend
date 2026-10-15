import type { TransformSpec } from "@worldbend/web/types";
import { nodePage } from "./native-document";
import { nativeVectorDocumentParts, publicationTargetFingerprint } from "./native-vector-document";
import { readCopiedNativeVectorProjection, readNativeVectorProjection, type NativeVectorSourceView } from "./native-vector";
import { isOwnedTransformSpec } from "./stored-plane";
import { statePage, type WorkPage, type WorkScope, type WorkReference } from "./agent-work-state";
import { isNativeVectorStoredOperation, readNativeVectorStoredOperation, resolveNativeVectorOperation, nativeVectorOperationDigest, type NativeVectorStoredOperation } from "./native-vector-operation";
import { vectorExactPage } from "./agent-vector-pages";
import { encodeExactJson } from "./exact-json-codec";
import {isNativeVectorSourceView,isNativeVectorAxis} from "./native-vector-view";

export interface VectorSnapshot extends WorkScope {
  schema:"worldbend.figma.vector-state";version:"0.1"|"0.3";revision:number;published:boolean;
  /** Legacy projection only. In 0.3 this is derived from the owning operation. */
  spec:TransformSpec;sourceNodeId:string;placement:{x:number;y:number;width:number;height:number};targetExpected:string;
  operation?:NativeVectorStoredOperation;operationExpected?:string;sourceNodeIds?:string[];sourceView?:NativeVectorSourceView;
}
export type VectorReference=WorkReference;
export function vectorReference(value:VectorSnapshot):VectorReference {
  return {fileKey:value.fileKey,pageId:value.pageId,nodeId:value.nodeId,revision:value.revision,targetExpected:value.targetExpected};
}
export function vectorScope(scope:WorkScope) {
  if(figma.fileKey!==scope.fileKey||figma.currentPage.id!==scope.pageId)throw Error("E_FIGMA_SCOPE: use the granted Vector page");
}
export function vectorSpec(spec:TransformSpec,width:number,height:number) {
  if(!isOwnedTransformSpec(spec)||![width,height].every(isNativeVectorAxis)) {
    throw Error("E_FIGMA_INPUT: use normalized native Vector controls and bounded logical dimensions");
  }
}
export async function vectorState(scope:WorkScope):Promise<VectorSnapshot> {
  vectorScope(scope);
  const node=await figma.getNodeByIdAsync(scope.nodeId);vectorScope(scope);
  if(node?.type!=="FRAME"||node.removed||nodePage(node)?.id!==scope.pageId)throw Error("E_FIGMA_SCOPE: choose this page's Vector work");
  const record=readNativeVectorProjection(node)??readCopiedNativeVectorProjection(node),published=Boolean(record);
  let spec:TransformSpec,sourceNodeId:string,revision:number,operation:NativeVectorStoredOperation|undefined,
    sourceNodeIds:string[]|undefined,sourceView:NativeVectorSourceView|undefined;
  if(published) {
    const parts=await nativeVectorDocumentParts(node);vectorScope(scope);
    spec=parts.spec;sourceNodeId=parts.record.sourceNodeId;revision=parts.copied?0:parts.binding.revision;
    if(parts.record.version==="0.3"){if(!isNativeVectorStoredOperation(parts.operation))throw Error("E_FIGMA_STATE: complete operation unavailable");operation=parts.operation;sourceNodeIds=[...parts.binding.sourceNodeIds];sourceView=parts.record.sourceView;}
  } else {
    let pending:{schema:string;version:string;nodeId:string;sourceNodeId:string;spec?:TransformSpec;sourceNodeIds?:string[];sourceView?:NativeVectorSourceView;width:number;height:number};
    try{pending=JSON.parse(node.getSharedPluginData("worldbend","vectorPending"));}catch{throw Error("E_FIGMA_STATE: unreadable Vector candidate");}
    if(!pending||pending.schema!=="worldbend.figma.vector-pending"||!["0.1","0.3"].includes(pending.version)||
      Object.keys(pending).sort().join(",")!==(pending.version==="0.1"?"height,nodeId,schema,sourceNodeId,spec,version,width":"height,nodeId,schema,sourceNodeId,sourceNodeIds,sourceView,version,width")||
      pending.nodeId!==node.id||!pending.sourceNodeId||pending.sourceNodeId===node.id||pending.sourceNodeId.length>256||
      node.children.length||node.fills===figma.mixed||node.fills.length||node.strokes.length||node.effects.length||node.clipsContent||
      node.opacity!==1||node.blendMode!=="PASS_THROUGH"||node.layoutMode!=="NONE"||node.width!==pending.width||node.height!==pending.height) {
      throw Error("E_FIGMA_STATE: preserve the edited Vector candidate; repair it before publication");
    }
    if(pending.version==="0.3"){
      operation=readNativeVectorStoredOperation(node);if(!operation)throw Error("E_FIGMA_STATE: complete Vector candidate controls unavailable");
      sourceNodeIds=pending.sourceNodeIds;sourceView=pending.sourceView;
      const resolved=resolveNativeVectorOperation(operation);
      if(!sourceNodeIds||sourceNodeIds.length!==resolved.sourceCount||new Set(sourceNodeIds).size!==sourceNodeIds.length||
        sourceNodeIds.some(id=>!id||id.length>256||id===node.id)||sourceNodeIds[resolved.artworkSourceIndex]!==pending.sourceNodeId||
        !isNativeVectorSourceView(sourceView))
        throw Error("E_FIGMA_STATE: complete Vector source roles/view unavailable");
      spec=resolved.plane;
    }else {spec=pending.spec!;}
    sourceNodeId=pending.sourceNodeId;revision=0;
  }
  vectorSpec(spec,node.width,node.height);
  return {fileKey:scope.fileKey,pageId:scope.pageId,nodeId:scope.nodeId,schema:"worldbend.figma.vector-state",version:operation?"0.3":"0.1",revision,published,spec,sourceNodeId,
    placement:{x:node.x,y:node.y,width:node.width,height:node.height},targetExpected:publicationTargetFingerprint(node),
    ...(operation?{operation,operationExpected:nativeVectorOperationDigest(operation),sourceNodeIds:sourceNodeIds!,sourceView:sourceView!}:{})};
}
export async function readVectorState(input:WorkScope&WorkPage) {
  const state=await vectorState(input);
  if(state.version==="0.1")return statePage(state,input);
  return {...vectorExactPage(JSON.stringify(encodeExactJson(state)),input,input),reference:vectorReference(state),encoding:"exact-json-envelope" as const};
}
