import { nativeSvgCaptureFacts, logicalSourceSvg } from "./native-source-svg";
import {componentNativeParts} from "./native-component";
import {stableExportSvg} from "./stable-export-svg";
import type { NativeMatrix } from "./native-frame-record";
import type { SourceCaptureFacts } from "@worldbend/web/types";
import {nativeVectorSourceViewMatches,retainedNativeVectorSourceView} from "./source-raster";
import type {NativeVectorSourceView} from "./native-vector-view";
import {captureDocumentShapeForSource} from "./native-shape-document";
import {normalizedDocumentShape} from "./native-shape";
import {encodeExactJson} from "./exact-json-codec";
import {vectorExactPage} from "./agent-vector-pages";
import {resolveNativeVectorOperation,type NativeVectorStoredOperation} from "./native-vector-operation";
import { nativeArtworkProof } from "./native-artwork-proof";
import { nativeNodeSnapshot } from "./native-copy-closure";
import { nodePage } from "./native-document";
import { fingerprintState, figmaError } from "./state-fingerprint";
import { vectorValue } from "./agent-vector-proof";
import { statePage, type WorkPage, type WorkScope } from "./agent-work-state";
import { byteFingerprint } from "./agent-handoff";
import {sourceRasterBounds,sourceRasterViewBox,sameSourceRasterViewBox } from "./source-raster";
import {assertIndependentVectorSource} from "./native-vector-dependency";

export type NativeCarrier = "frame" | "vector";
export interface NativeReadScope extends WorkScope { carrier:NativeCarrier }
export interface NativeSourceGuard extends NativeReadScope {
  targetExpected:string;sourceExpected:string;svgExpected:string;
  sourceProjection?:{matrix:NativeMatrix;capture:SourceCaptureFacts};
}
export function assertNativeTarget(base:unknown,expected:string) {
  if(fingerprintState(vectorValue(base))!==expected)throw figmaError("CONFLICT","native work changed; reread the complete snapshot");
}
export async function nativeContinuationCapture(input:NativeReadScope,base:unknown,sourceNodeId:string,readBase:()=>Promise<unknown>,context?:{operation:NativeVectorStoredOperation;sourceNodeIds:string[];sourceView?:NativeVectorSourceView}) {
  const source=await figma.getNodeByIdAsync(sourceNodeId);
  if(!source||!("visible" in source)||source.removed||nodePage(source)?.id!==input.pageId||
    figma.fileKey!==input.fileKey||figma.currentPage.id!==input.pageId)throw figmaError("SCOPE","native source unavailable on the granted page");
  const artwork=source as SceneNode,proof=nativeArtworkProof(artwork),proofs=[proof];
  const componentFrame=input.carrier==="frame"&&(base as {componentFrame?:boolean}).componentFrame;
  let captureArtwork=artwork,captureProof=proof;
  if(componentFrame&&(base as {sourceEditing?:boolean}).sourceEditing){
    const result=await figma.getNodeByIdAsync(input.nodeId);
    if(result?.type!=="FRAME")throw figmaError("CONFLICT","native source view changed");
    const parts=await componentNativeParts(result);
    if(!parts.record.sourceEditing||parts.content.id!==artwork.id)throw figmaError("CONFLICT","native source view changed");
    captureArtwork=parts.masterContent;captureProof=nativeArtworkProof(captureArtwork);proofs.push(captureProof);
  }
  const vectorSources:SceneNode[]=[artwork];
  if(input.carrier==="vector")assertIndependentVectorSource(artwork,input.nodeId);
  let shapeGuideClip:ReturnType<typeof normalizedDocumentShape>|undefined;
  if(context){
    const resolved=resolveNativeVectorOperation(context.operation);
    if(context.sourceNodeIds.length!==resolved.sourceCount||context.sourceNodeIds[resolved.artworkSourceIndex]!==sourceNodeId)
      throw figmaError("INPUT","preserve complete native source roles");
    for(const id of context.sourceNodeIds.filter(id=>id!==sourceNodeId)){
      const guide=await figma.getNodeByIdAsync(id);
      if(guide?.type!=="VECTOR"||guide.removed||nodePage(guide)?.id!==input.pageId)throw figmaError("SCOPE","current native guide unavailable");
      const guideProof=nativeArtworkProof(guide);proofs.push(guideProof);
      if(input.carrier==="vector"){assertIndependentVectorSource(guide,input.nodeId);vectorSources.push(guide);}
      const shape=await captureDocumentShapeForSource(guide);if(!shape)throw figmaError("STATE","current native guide unavailable");
      shapeGuideClip=normalizedDocumentShape(shape);guideProof.validate();
    }
  }
  const validate=()=>{
    if(figma.fileKey!==input.fileKey||figma.currentPage.id!==input.pageId)throw figmaError("SCOPE","native source scope changed");
    try {if(input.carrier==="vector")for(const source of vectorSources)assertIndependentVectorSource(source,input.nodeId);for(const p of proofs)p.validate();}catch {throw figmaError("CONFLICT","native source changed during capture or publication; reread");}
  };
  if(proofs.some(p=>p.originals.has(input.nodeId)))throw figmaError("INPUT","native source cannot contain its own result");
  const originals=new Map(proofs.flatMap(p=>[...p.originals]));
  const stamps=[...originals].map(([id,node])=>({id,state:nativeNodeSnapshot(node)})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const sourceExpected=fingerprintState(vectorValue(stamps)),targetExpected=fingerprintState(vectorValue(base));
  const view=context?retainedNativeVectorSourceView(artwork,context.sourceView):undefined;
  const logicalSize=(base as {source?:{width:number;height:number}}).source??artwork;
  const box=input.carrier==="vector"?(view?.bounds??sourceRasterViewBox(artwork)):{width:logicalSize.width,height:logicalSize.height};
  if(!box)throw figmaError("STATE","native source bounds unavailable");
  const svg=stableExportSvg(await captureArtwork.exportAsync({format:"SVG_STRING",svgOutlineText:true,
    ...(input.carrier==="frame"?{useAbsoluteBounds:true}:view?{useAbsoluteBounds:view.policy==="logical"}:sourceRasterBounds(artwork))}));
  validate();
  if(input.carrier==="vector"&&(view?!nativeVectorSourceViewMatches(artwork,view):!sameSourceRasterViewBox(artwork,box as Rect)))throw figmaError("CONFLICT","native source bounds changed during SVG export");
  const fresh=await readBase();validate();
  if(fingerprintState(vectorValue(fresh))!==targetExpected)throw figmaError("CONFLICT","native work changed during source capture; reread");
  // No TextEncoder is available in some supported Figma execution hosts.
  const binary=unescape(encodeURIComponent(svg));
  if(binary.length>8*1024*1024)throw figmaError("LIMIT","native SVG source exceeds 8 MiB");
  const sourceEffects=[...new Set([...captureProof.originals.values()].flatMap(n=>"effects" in n?
    n.effects.filter(effect=>effect.visible!==false).map(effect=>effect.type):[]))].sort();
  const sourceFacts={slotId:"source-1",nodeId:source.id,name:[...source.name].slice(0,128).join(""),width:box.width,height:box.height,
    previewFingerprint:byteFingerprint(Uint8Array.from(binary,c=>c.charCodeAt(0)))};
  const sourceCapture=componentFrame&&captureArtwork.type==="FRAME"?nativeSvgCaptureFacts(captureArtwork,svg,{width:logicalSize.width,height:logicalSize.height}):undefined;
  const data={schema:"worldbend.figma.native-continuation-snapshot" as const,version:context?"0.3" as const:"0.1" as const,
    carrier:input.carrier,base,targetExpected,sourceExpected,source:sourceFacts,svgBytes:binary.length,sourceEffects,...(sourceCapture?{sourceCapture}:{}),...(shapeGuideClip?{shapeGuideClip}:{}),...(view?{sourceView:view}:{})};
  if(!context)statePage(data,{});
  return {data,binary,validate,sourceNodes:originals,scope:{fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId}};
}
export function nativeContinuationPage(capture:Awaited<ReturnType<typeof nativeContinuationCapture>>,page:WorkPage) {
  return "operation"in (capture.data.base as Record<string,unknown>)?vectorExactPage(JSON.stringify(encodeExactJson(capture.data)),page,capture.scope):statePage(capture.data,page);
}
/** Base64 slices retain exact UTF-8 bytes even when a code point crosses a
 * slice. 12288 ASCII units leave ample space below the host's 20 KiB return. */
export function nativeSourcePage(capture:Awaited<ReturnType<typeof nativeContinuationCapture>>,input:NativeSourceGuard&WorkPage) {
  assertNativeSource(capture,input);
  const sourceCapture=capture.data.sourceCapture;
  if(Boolean(sourceCapture)!==Boolean(input.sourceProjection)||sourceCapture&&vectorValue(sourceCapture)!==vectorValue(input.sourceProjection!.capture))throw figmaError("CONFLICT","logical SVG source projection requires its current capture facts");
  const binary=input.sourceProjection?unescape(encodeURIComponent(logicalSourceSvg(decodeURIComponent(escape(capture.binary)),input.sourceProjection.matrix,sourceCapture!.logicalSize))):capture.binary;
  if(binary.length>8*1024*1024)throw figmaError("LIMIT","logical native SVG source exceeds 8 MiB");
  const base64=btoa(binary),token=fingerprintState(base64),part=input.part??0,partCount=Math.max(1,Math.ceil(base64.length/12288));
  if(!Number.isSafeInteger(part)||part<0||part>=partCount||(part>0&&!input.token))throw figmaError("INPUT","use this native source's complete part token");
  if(input.token!==undefined&&input.token!==token)throw figmaError("CONFLICT","native SVG bytes changed between parts; restart read");
  capture.validate();
  return {schema:"worldbend.figma.native-source-page" as const,version:"0.1" as const,mimeType:"image/svg+xml" as const,
    sourceNodeId:capture.data.source.nodeId,token,part,partCount,bytes:binary.length,base64:base64.slice(part*12288,(part+1)*12288)};
}
export function assertNativeSource(capture:Awaited<ReturnType<typeof nativeContinuationCapture>>,input:NativeSourceGuard) {
  if(capture.data.targetExpected!==input.targetExpected||capture.data.sourceExpected!==input.sourceExpected||
    capture.data.source.previewFingerprint!==input.svgExpected)throw figmaError("CONFLICT","native source or work changed; reread the complete snapshot");
  capture.validate();
}
