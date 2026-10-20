import {finishPublication} from "./agent-handoff-media";
import {isNativeVectorStoredOperation,resolveNativeVectorOperation,type NativeVectorStoredOperation} from "./native-vector-operation";
import {vectorSpec,vectorState,readVectorState,vectorScope} from "./agent-vector-state";
import {vectorSourcesProof} from "./agent-vector-proof";
import {nativeVectorSourceView} from "./source-raster";
import {readStoredOperationSlots,restoreStoredOperationSlots,writeStoredOperation} from "./stored-operation";
import {sha256Hex} from "../../web/src/sha256";
import {byteBase64,utf8Bytes} from "./utf8-base64";
import {publicationTargetFingerprint} from "./native-vector-document";
import {isNativeVectorAxis} from "./native-vector-view";
interface Creation {
  fileKey:string;pageId:string;sourceNodeIds:string[];requestId:string;name?:string;
  operation:NativeVectorStoredOperation;width:number;height:number;sourceViewPolicy?:"logical"|"appearance";
}
export async function initializeVectorWork(scope:{fileKey:string;pageId:string;nodeId:string;transferId:string;payloadDigest:string}) {
  return finishPublication(scope,async(data,lease)=>{
    if(typeof data.creationJson!=="string"||data.creationJson.length>8*1024*1024)throw Error("E_FIGMA_INPUT: complete initialization JSON required");
    let creation:Creation;try{creation=JSON.parse(data.creationJson);}catch{throw Error("E_FIGMA_INPUT: unreadable Vector initialization");}
    if(creation.fileKey!==scope.fileKey||creation.pageId!==scope.pageId||!isNativeVectorStoredOperation(creation.operation))
      throw Error("E_FIGMA_INPUT: preserve the complete Vector initialization");
    const resolved=resolveNativeVectorOperation(creation.operation);vectorSpec(resolved.plane,creation.width,creation.height);
    const target=await figma.getNodeByIdAsync(scope.nodeId);vectorScope(scope);lease.validate();
    if(target?.type!=="FRAME"||target.removed)throw Error("E_FIGMA_SCOPE: Vector reservation unavailable");
    let marker:{nodeId:string;requestId:string;identity:string;width?:number;height?:number};
    try{marker=JSON.parse(target.getSharedPluginData("worldbend","vectorCreation"));}catch{throw Error("E_FIGMA_STATE: unreadable Vector reservation");}
    if(!marker||marker.nodeId!==target.id||marker.requestId!==creation.requestId||
      marker.identity!==sha256Hex(byteBase64(utf8Bytes(data.creationJson))))throw Error("E_FIGMA_INTEGRITY: Vector initialization differs from its original reservation");
    const markerKeys=Object.keys(marker).sort().join(",");
    if(markerKeys!=="identity,nodeId,requestId"&&(markerKeys!=="height,identity,nodeId,requestId,width"||
      ![marker.width,marker.height].every(isNativeVectorAxis)))
      throw Error("E_FIGMA_INTEGRITY: invalid native reservation size witness");
    if(target.getSharedPluginData("worldbend","vectorPending")||target.getSharedPluginData("worldbend","nativeVector")){
      const page=await readVectorState(scope);lease.validate();return {nodeId:target.id,status:"initialized" as const,reused:true,state:page};
    }
    if(target.children.length||target.fills===figma.mixed||target.fills.length||target.strokes.length||target.effects.length||target.clipsContent||
      target.opacity!==1||target.blendMode!=="PASS_THROUGH"||target.layoutMode!=="NONE"||target.width!==(marker.width??creation.width)||target.height!==(marker.height??creation.height))
      throw Error("E_FIGMA_STATE: preserve the edited Vector reservation");
    const reservation=publicationTargetFingerprint(target);
    const proof=await vectorSourcesProof(scope,creation.operation,creation.sourceNodeIds);proof.validate();lease.validate();
    if(target.removed||publicationTargetFingerprint(target)!==reservation)throw Error("E_FIGMA_CONFLICT: Vector reservation changed before initialization");
    const view=nativeVectorSourceView(proof.artwork,creation.sourceViewPolicy),before=readStoredOperationSlots(target);
    const pending=JSON.stringify({schema:"worldbend.figma.vector-pending",version:"0.3",nodeId:target.id,sourceNodeId:proof.artwork.id,
      sourceNodeIds:creation.sourceNodeIds,sourceView:view,width:target.width,height:target.height});
    try {
      proof.validate();lease.validate();writeStoredOperation(target,creation.operation);
      target.setSharedPluginData("worldbend","vectorPending",pending);
      if(target.getSharedPluginData("worldbend","vectorPending")!==pending)throw Error("E_FIGMA_STATE: Vector initialization was not retained");
    }catch(error){
      restoreStoredOperationSlots(target,before);
      target.setSharedPluginData("worldbend","vectorPending","");throw error;
    }
    // This synchronous authoring commit is complete, but not a publication.
    // Receipt delivery can await and fail after another writer has continued
    // this saved work. Never rewind that writer (or the recoverable commit)
    // because our original lease/source changed during those later reads.
    await vectorState(scope);proof.validate();lease.validate();
    const state=await readVectorState(scope);proof.validate();lease.validate();
    return {nodeId:target.id,status:"initialized" as const,reused:false,state};
  },"initialized");
}
