import { vectorState } from "./agent-vector-state";
import { nativeContinuationCapture,nativeContinuationPage,nativeSourcePage,type NativeReadScope,type NativeSourceGuard } from "./agent-native-continuation-source";
import type { WorkPage } from "./agent-work-state";
async function capture(input:NativeReadScope) {
  if(input.carrier!=="vector")throw Error("E_FIGMA_INPUT: choose the Vector carrier");
  const read=()=>vectorState(input),base=await read();
  if(!base.published)throw Error("E_FIGMA_STATE: publish the native Vector before document continuation");
  return nativeContinuationCapture(input,base,base.sourceNodeId,read,base.operation?{operation:base.operation,sourceNodeIds:base.sourceNodeIds!,...(base.sourceView?{sourceView:base.sourceView}:{})}:undefined);
}
export async function readNativeContinuation(input:NativeReadScope&WorkPage) {return nativeContinuationPage(await capture(input),input);}
export async function readNativeSource(input:NativeSourceGuard&WorkPage) {return nativeSourcePage(await capture(input),input);}
