import { recoverCreation } from "./creation-recovery";
import { nativeArtworkProof } from "./native-artwork-proof";
import { canCaptureNativeVectorSource } from "./native-vector-source";
import { canCaptureArtworkVectorSource, isArtworkVectorSource, planArtworkVectorLayers } from "./native-vector-artwork";
import { nodePage } from "./native-document";
import { placementBeside } from "./result-placement";
import {isNativeVectorAxis} from "./native-vector-view";

/** A small recoverable reservation precedes exact large-operation transport.
 * The trusted identity binds the complete initialization JSON prepared by MCP,
 * not merely the visible dimensions or a transform-only approximation. */
export interface VectorCreateInput {
  fileKey:string;pageId:string;sourceNodeId:string;sourceNodeIds:string[];requestId:string;name?:string;
  identity:string;width:number;height:number;
}
export async function createVectorWork(input:VectorCreateInput) {
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId)||!/^[a-f0-9]{64}$/.test(input.identity)||
    ![input.width,input.height].every(v=>Number.isFinite(v)&&v>=.01&&v<=4096)||
    !Array.isArray(input.sourceNodeIds)||input.sourceNodeIds.length<1||input.sourceNodeIds.length>2||
    new Set(input.sourceNodeIds).size!==input.sourceNodeIds.length||!input.sourceNodeIds.includes(input.sourceNodeId)||
    input.sourceNodeIds.some(id=>!id||id.length>256)||
    (input.name!==undefined&&(!input.name.trim()||Array.from(input.name).length>80)))throw Error("E_FIGMA_INPUT: invalid Vector creation identity");
  const page=await figma.getNodeByIdAsync(input.pageId);
  const scope=()=>{if(figma.fileKey!==input.fileKey||page?.type!=="PAGE"||page.removed||figma.currentPage.id!==input.pageId)throw Error("E_FIGMA_SCOPE: create Vector on the granted page");};
  scope();
  const find=(create?:()=>FrameNode,reserve=0)=>{scope();return recoverCreation(page as PageNode,input.requestId,"vectorCreation",input.identity,
    (n):n is FrameNode=>n.type==="FRAME",create,reserve);};
  const describe=(node:FrameNode,reused:boolean)=>({schema:"worldbend.figma.vector-creation" as const,version:"0.3" as const,nodeId:node.id,reused,
    status:node.getSharedPluginData("worldbend","nativeVector")?"published" as const:
      node.getSharedPluginData("worldbend","vectorPending")?"needs-projection" as const:"needs-initialization" as const,
    reference:{fileKey:input.fileKey,pageId:input.pageId,nodeId:node.id},nextAction:"initialize" as const,affectedNodeIds:reused?[]:[node.id]});
  const prior=await find();if(prior)return describe(prior,true);
  const sources:SceneNode[]=[],proofs:ReturnType<typeof nativeArtworkProof>[]=[];
  for(const id of input.sourceNodeIds){
    const source=await figma.getNodeByIdAsync(id);scope();
    if(!source||!("visible"in source)||nodePage(source)?.id!==input.pageId)throw Error("E_FIGMA_INPUT: choose current artwork and guide on this page");
    sources.push(source as SceneNode);proofs.push(nativeArtworkProof(source as SceneNode));
  }
  const artwork=sources[input.sourceNodeIds.indexOf(input.sourceNodeId)]!;
  const supported=isArtworkVectorSource(artwork)?await canCaptureArtworkVectorSource(artwork,figma):canCaptureNativeVectorSource(artwork);
  scope();for(const proof of proofs)proof.validate();
  if(!supported)throw Error("E_FIGMA_INPUT: native Vector capture is unavailable; retain complete appearance with linked HD");
  const count=isArtworkVectorSource(artwork)?planArtworkVectorLayers(artwork)!.length:1;
  let created:FrameNode|undefined;
  const accepted=await find(()=>{
    scope();for(const proof of proofs)proof.validate();
    const bounds=(n:SceneNode)=>n.visible&&n.absoluteBoundingBox?[n.absoluteBoundingBox]:[];
    const placement=placementBeside(bounds(artwork),{width:input.width,height:input.height},(page as PageNode).children.flatMap(bounds));
    const result=figma.createFrame();created=result;
    try {
      result.name=input.name?.trim()??`${artwork.name} · Worldbend Vector`;
      result.fills=[];result.clipsContent=false;result.resizeWithoutConstraints(input.width,input.height);result.x=placement.x;result.y=placement.y;
      if(![result.width,result.height].every(isNativeVectorAxis))throw Error("E_FIGMA_STATE: native Vector reservation size unavailable");
      // Figma stores native dimensions at its own precision. Retain the exact
      // SDK readback as the reservation witness, separately from the SHA-bound
      // requested dimensions and complete authored targetSize.
      result.setSharedPluginData("worldbend","vectorCreation",JSON.stringify({nodeId:result.id,requestId:input.requestId,identity:input.identity,width:result.width,height:result.height}));
      return result;
    }catch(error){result.remove();throw error;}
  },count+1);
  if(!accepted)throw Error("E_FIGMA_STATE: Vector creation failed");
  return describe(accepted,accepted!==created);
}
