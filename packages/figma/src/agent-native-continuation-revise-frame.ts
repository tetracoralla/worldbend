import { prepareNativeFrameSource } from "./agent-native-frame-source";
import { apply,inspect } from "./agent-handoff";
import { nativeContinuationCapture,assertNativeSource,assertNativeTarget,type NativeSourceGuard } from "./agent-native-continuation-source";
import type { NineNumbers,TransformSpec,NativeFramePlan } from "@worldbend/web/types";
import { canUseNativeSource,nativeAppearanceInsideViewport,nodePage } from "./native-document";
import { prepareNativeCopy } from "./native-copy-closure";

export interface NativeFrameRevision extends NativeSourceGuard {
  sourceNodeId:string;spec:TransformSpec;inverse:NineNumbers;width:number;height:number;
  renderWidth:number;renderHeight:number;
  nativePlan?:NativeFramePlan;
  sourceFacts?:{sourceNodeId:string;width:number;height:number;expected:string};
}
export async function reviseNativeFrame(input:NativeFrameRevision) {
  if(input.carrier!=="frame")throw Error("E_FIGMA_INPUT: choose the Frame carrier");
  const read=()=>inspect(input.nodeId,input.fileKey,input.pageId),base=await read();
  input={...input,nodeId:base.nodeId};
  assertNativeTarget(base,input.targetExpected);
  const capture=await nativeContinuationCapture(input,base,base.source.nodeId,read);
  assertNativeSource(capture,input);
  let replacement:FrameNode|undefined,validate=capture.validate;
  if(input.sourceNodeId!==base.source.nodeId) {
    const prepared=await prepareNativeFrameSource(input.sourceNodeId,input.fileKey,input.pageId);
    capture.validate();
    if(input.sourceFacts&&(input.sourceFacts.sourceNodeId!==prepared.facts.sourceNodeId||input.sourceFacts.width!==prepared.facts.width||
      input.sourceFacts.height!==prepared.facts.height||input.sourceFacts.expected!==prepared.facts.expected))throw Error("E_FIGMA_CONFLICT: replacement source facts changed; read again");
    if(input.nativePlan&&!input.sourceFacts)throw Error("E_FIGMA_INPUT: replacement native plan needs read source facts");
    replacement=prepared.source;
    const proof=prepared.proof;capture.validate();
    if(proof.originals.has(input.nodeId))throw Error("E_FIGMA_INPUT: native source cannot contain its own result");
    const fonts=new Map<string,FontName>();
    for(const node of [...capture.sourceNodes.values(),...proof.originals.values()])if(node.type==="TEXT") {
      const values=node.fontName===figma.mixed?node.getStyledTextSegments(["fontName"]).map(s=>s.fontName):[node.fontName];
      for(const font of values)fonts.set(JSON.stringify(font),font);
    }
    if(fonts.size>256)throw Error("E_FIGMA_LIMIT: native content replacement exceeds 256 current fonts");
    await Promise.all([...fonts.values()].map(font=>figma.loadFontAsync(font)));
    validate=()=>{capture.validate();try{proof.validate();}catch{throw Error("E_FIGMA_CONFLICT: replacement source changed; reread");}};
    validate();
  }
  const snapshot=await apply({...input,expected:base.expected},validate,replacement);
  return {schema:"worldbend.figma.native-document-publication" as const,version:"0.1" as const,
    carrier:"frame" as const,nodeId:input.nodeId,snapshot,sourceOriginNodeId:input.sourceNodeId,
    retainedSourceNodeIds:replacement?[base.source.nodeId]:[],
    affectedNodeIds:[input.nodeId,...(replacement?[base.source.nodeId,snapshot.source.nodeId]:[])]};
}

/** First phase when a document chooses a different native source. */
export async function readNativeReplacementSource(input:NativeFrameRevision) {
  const read=()=>inspect(input.nodeId,input.fileKey,input.pageId),base=await read();
  input={...input,nodeId:base.nodeId};
  assertNativeTarget(base,input.targetExpected);
  const capture=await nativeContinuationCapture(input,base,base.source.nodeId,read);assertNativeSource(capture,input);
  const prepared=await prepareNativeFrameSource(input.sourceNodeId,input.fileKey,input.pageId);capture.validate();
  return {schema:"worldbend.figma.native-source-facts",version:"0.1",fileKey:input.fileKey,pageId:input.pageId,sourceFacts:prepared.facts,
    next:"Repeat reviseNative with these sourceFacts on the chosen source binding."};
}
