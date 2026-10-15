import type { VectorOperation, VectorOperationInput, VectorArtworkProjectionInput, VectorProjectionInput } from "@worldbend/web/types";
import {readStoredOperationValue,type StoredOperation,type SharedOperationReader} from "./stored-operation";
import {deformationArtworkIndex,deformationTaskSourceCount,isStoredDeformationTask,type FigmaDeformationTask} from "./stored-designer-task";
import {sha256Hex} from "../../web/src/sha256";
import {byteBase64,utf8Bytes} from "./utf8-base64";
import {isOwnedTransformSpec,isRecord} from "./stored-plane";

/** Narrow the generated nullable schema projection to its actual owned wire. */
export function nativeVectorExecutionFrame(plan: import("@worldbend/web/types").VectorOperationPlan) {
  if (!plan.executionFrame) return undefined;
  if (!isNativeVectorExecutionFrame(plan.executionFrame)) throw Error("Invalid core execution frame");
  return plan.executionFrame;
}


export interface NativeVectorExecutionFrame { transform: import("@worldbend/web/types").TransformSpec; reference: {width:number;height:number} }
export function isNativeVectorExecutionFrame(value: unknown): value is NativeVectorExecutionFrame {
  return isRecord(value) && Object.keys(value).sort().join(",")==="reference,transform" && isOwnedTransformSpec(value["transform"]) &&
    isRecord(value["reference"]) && Object.keys(value["reference"]).sort().join(",")==="height,width" &&
    [value["reference"]["width"],value["reference"]["height"]].every(v=>typeof v==="number"&&Number.isFinite(v)&&v>0&&v<=4096);
}
/** The complete authored value is handed to core unchanged. No Pin, Mesh,
 * Liquify or Warp view is flattened into a TransformSpec by the carrier. */
export type NativeVectorOperation = VectorOperation;
export type NativeVectorStoredOperation=Extract<StoredOperation,{kind:"transform"}>|{kind:"task";task:FigmaDeformationTask};
export function isNativeVectorStoredOperation(value:unknown):value is NativeVectorStoredOperation {
  if(!isRecord(value))return false;
  return value.kind==="transform"?Object.keys(value).sort().join(",")==="kind,spec"&&isOwnedTransformSpec(value.spec):
    value.kind==="task"&&Object.keys(value).sort().join(",")==="kind,task"&&isStoredDeformationTask(value.task);
}
export function readNativeVectorStoredOperation(source:SharedOperationReader):NativeVectorStoredOperation|undefined {
  try{const v=readStoredOperationValue(source);if(!v)return undefined;
    const operation=v.kind==="task"?{kind:"task",task:v.value}:{kind:v.kind,spec:v.value};
    return isNativeVectorStoredOperation(operation)?operation:undefined;
  }catch{return undefined;}
}
export function resolveNativeVectorOperation(authored:StoredOperation) {
  if(!isNativeVectorStoredOperation(authored))throw Error("E_FIGMA_INPUT: invalid complete native Vector operation");
  if(authored.kind==="transform")return {authored,plane:authored.spec,core:{kind:"transform" as const,spec:authored.spec},artworkSourceIndex:0,sourceCount:1};
  if(authored.kind==="task"&&authored.task.kind==="deformation"){
    const plane=authored.task.spec.transform;if(!isOwnedTransformSpec(plane))throw Error("E_FIGMA_INPUT: invalid owning deformation plane");
    return {authored,plane,core:{kind:"deformationWork" as const,spec:authored.task.spec},
      artworkSourceIndex:deformationArtworkIndex(authored.task),sourceCount:deformationTaskSourceCount(authored.task)};
  }
  throw Error("E_FIGMA_INPUT: this complete operation requires its existing carrier");
}
/** Complete owning value, including carrier-only view and guide provenance.
 * SHA accepts ASCII; hashing exact UTF-8 base64 retains Unicode/lone-surrogate
 * JSON semantics without pretending UTF-16 code units are UTF-8 bytes. */
export function nativeVectorOperationDigest(value:StoredOperation):string {
  const json=JSON.stringify(value,(_key,item:unknown)=>item&&typeof item==="object"&&!Array.isArray(item)
    ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
  return sha256Hex(byteBase64(utf8Bytes(json)));
}
export function nativeVectorOperationInput(operation: NativeVectorOperation, reference: {width:number;height:number}): VectorOperationInput {
  return {schema:"worldbend.vector-operation",version:"0.1",operation,reference:nativeVectorOperationReference(operation,reference)};
}
/** Authored targetSize owns the work's solve reference, not the separately
 * scalable native placement or the raster transport's integer pixel axes. */
export function nativeVectorOperationReference(operation:NativeVectorOperation,fallback:{width:number;height:number}) {
  return operation.kind==="deformationWork"&&operation.spec.targetSize?{...operation.spec.targetSize}:fallback;
}
/** Compatibility relay supplies geometry only. The canonical operation owns
 * H and M; a parallel per-part mesh or heterogeneous basis is not accepted. */
export function nativeVectorArtworkFromInputs(operation:NativeVectorOperation,inputs:VectorProjectionInput[],expandSourceBounds=false):VectorArtworkProjectionInput {
  const first=inputs[0];if(!first)throw Error("Native vector artwork has no painted parts");
  if(inputs.some(input=>input.mesh!==undefined||
    input.sourceBounds.x!==first.sourceBounds.x||input.sourceBounds.y!==first.sourceBounds.y||
    input.sourceBounds.width!==first.sourceBounds.width||input.sourceBounds.height!==first.sourceBounds.height||
    input.reference.width!==first.reference.width||input.reference.height!==first.reference.height||
    input.placement.width!==first.placement.width||input.placement.height!==first.placement.height))
    throw Error("Native vector artwork must share one canonical basis");
  return {schema:"worldbend.vector-artwork",version:"0.1",operation,reference:nativeVectorOperationReference(operation,first.reference),
    placement:first.placement,sourceBounds:first.sourceBounds,...(expandSourceBounds?{sourceBoundsPolicy:"expandToGeometry" as const}:{}),
    parts:inputs.map(({path,sourceTransform,stroke})=>({path,sourceTransform,...(stroke?{stroke}:{})})),tolerancePx:0.25};
}
