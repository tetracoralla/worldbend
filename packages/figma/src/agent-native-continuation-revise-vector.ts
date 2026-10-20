import type {NativeVectorStoredOperation} from "./native-vector-operation";
import {readCachedVectorRevision} from "./agent-vector-read-cache";
import {finishPublication} from "./agent-handoff-media";
import { vectorState } from "./agent-vector-state";
import {readVectorRevision} from "./agent-vector-read";
import type { TransformSpec } from "@worldbend/web/types";
import {type WorkPage } from "./agent-work-state";
import { nativeContinuationCapture,assertNativeSource,assertNativeTarget,type NativeSourceGuard } from "./agent-native-continuation-source";

export async function readNativeVectorRevision(input:NativeSourceGuard&WorkPage&{sourceNodeId:string;spec?:TransformSpec;operation?:NativeVectorStoredOperation;width:number;height:number},transportValidate:()=>void=()=>{}) {
  transportValidate();
  if(input.carrier!=="vector")throw Error("E_FIGMA_INPUT: choose the Vector carrier");
  if((input.part??0)>0)return readCachedVectorRevision(input);
  const read=()=>vectorState(input),base=await read();
  assertNativeTarget(base,input.targetExpected);
  if(!base.published)throw Error("E_FIGMA_STATE: publish the native Vector before document revision");
  const capture=await nativeContinuationCapture(input,base,base.sourceNodeId,read,base.operation?{operation:base.operation,sourceNodeIds:base.sourceNodeIds!,...(base.sourceView?{sourceView:base.sourceView}:{})}:undefined);
  assertNativeSource(capture,input);
  const proposal=await readVectorRevision({base,sourceNodeId:input.sourceNodeId,
    ...(input.operation?{operation:input.operation}:input.spec?{spec:input.spec}:{}),width:input.width,height:input.height,
    ...(input.part===undefined?{}:{part:input.part}),...(input.token===undefined?{}:{token:input.token})});
  capture.validate();transportValidate();return proposal;
}

export async function readTransferredNativeVectorRevision(scope:{fileKey:string;pageId:string;nodeId:string;transferId:string;payloadDigest:string}){
  return finishPublication(scope,async(data,lease)=>{
    lease.validate();const result=await readNativeVectorRevision(data as unknown as Parameters<typeof readNativeVectorRevision>[0],lease.validate);lease.validate();return {nodeId:scope.nodeId,...result};
  },"captured");
}
