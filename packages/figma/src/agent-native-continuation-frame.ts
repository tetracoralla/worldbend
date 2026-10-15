import { inspect } from "./agent-handoff";
import { nativeContinuationCapture,nativeContinuationPage,nativeSourcePage,type NativeReadScope,type NativeSourceGuard } from "./agent-native-continuation-source";
import type { WorkPage } from "./agent-work-state";
async function capture(input:NativeReadScope) {
  if(input.carrier!=="frame")throw Error("E_FIGMA_INPUT: choose the Frame carrier");
  const read=()=>inspect(input.nodeId,input.fileKey,input.pageId),base=await read();
  input={...input,nodeId:base.nodeId};
  return nativeContinuationCapture(input,base,base.source.nodeId,read);
}
export async function readNativeContinuation(input:NativeReadScope&WorkPage) {return nativeContinuationPage(await capture(input),input);}
export async function readNativeSource(input:NativeSourceGuard&WorkPage) {return nativeSourcePage(await capture(input),input);}
