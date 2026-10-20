import type { Size } from "@worldbend/web/types";
import type { Placement } from "./messages";
import { isRecord, parseOwnedTransformSpec, SHARED_NAMESPACE } from "./stored-plane";
import type { SharedOperationReader } from "./stored-operation";
export type NativeMatrix = [[number,number,number],[number,number,number]];

/** A local master retains the source's style/variable relationships. Only its
 * instance is scaled; both belong to the same copyable result subtree. */
export interface NativeComponentProjection {
  schema: "worldbend.figma.native";
  version: "0.3";
  resultNodeId: string;
  contentNodeId: string;
  surfaceNodeId: string;
  sourceSize: Size;
  outputSize: Size;
  placement: Placement;
  operation: string;
  /** Source structure is temporarily shown on canvas; the output stays saved. */
  sourceEditing?: true;
  frame: {
    masterNodeId: string;
    masterContentNodeId: string;
    instanceNodeId: string;
    basisNodeId: string;
    instanceScale: number;
    outerBasis: NativeMatrix;
    innerBasis: NativeMatrix;
    surfaceSize: Size;
    basisSize: Size;
    instanceSize: Size;
  };
  renderer: { kind: "affine" } | { kind: "projective"; shaderId: string; properties: Record<string, number> };
  /** Common lookup convenience: the mode remains the authoritative owner. */
  shaderId?: never;
  properties?: never;
}

const fields = ["schema","version","resultNodeId","contentNodeId","surfaceNodeId","sourceSize","outputSize","placement","operation","frame","renderer"];
const frameFields = ["masterNodeId","masterContentNodeId","instanceNodeId","basisNodeId","instanceScale","outerBasis","innerBasis","surfaceSize","basisSize","instanceSize"];
const exact = (v:Record<string,unknown>, keys:readonly string[]) => Object.keys(v).length===keys.length&&keys.every(k=>k in v);
const id = (v:unknown):v is string => typeof v==="string"&&v.length>0&&v.length<=256;
const size = (v:unknown):v is Size => isRecord(v)&&exact(v,["width","height"])&&
  [v.width,v.height].every(n=>typeof n==="number"&&Number.isFinite(n)&&n>0);
const matrix = (v:unknown):v is NativeMatrix => Array.isArray(v)&&v.length===2&&v.every(r=>Array.isArray(r)&&r.length===3&&r.every(n=>typeof n==="number"&&Number.isFinite(n)));

export function readComponentNativeProjection(node:SharedOperationReader & {id:string}):NativeComponentProjection|undefined {
  const raw=node.getSharedPluginData(SHARED_NAMESPACE,"native");
  if(!raw||raw.length>8192)return undefined;
  try {
    const v:unknown=JSON.parse(raw);
    if(!isRecord(v)||!exact(v,v.sourceEditing===true?[...fields,"sourceEditing"]:fields)||v.schema!=="worldbend.figma.native"||v.version!=="0.3"||v.resultNodeId!==node.id||
      ![v.resultNodeId,v.contentNodeId,v.surfaceNodeId].every(id)||!size(v.sourceSize)||!size(v.outputSize)||
      v.outputSize.width>4096||v.outputSize.height>4096||!isRecord(v.placement)||!exact(v.placement,["x","y","width","height"])||
      ![v.placement.x,v.placement.y].every(n=>typeof n==="number"&&Number.isFinite(n))||
      v.placement.width!==v.outputSize.width||v.placement.height!==v.outputSize.height||
      typeof v.operation!=="string"||v.operation.length>2048||!parseOwnedTransformSpec(v.operation)||
      v.operation!==node.getSharedPluginData(SHARED_NAMESPACE,"transform")||!isRecord(v.frame)||!exact(v.frame,frameFields)||
      ![v.frame.masterNodeId,v.frame.masterContentNodeId,v.frame.instanceNodeId,v.frame.basisNodeId].every(id)||
      typeof v.frame.instanceScale!=="number"||!Number.isFinite(v.frame.instanceScale)||v.frame.instanceScale<=0||
      !matrix(v.frame.outerBasis)||!matrix(v.frame.innerBasis)||!size(v.frame.surfaceSize)||!size(v.frame.basisSize)||!size(v.frame.instanceSize)||
      !isRecord(v.renderer))return undefined;
    const ids=[v.resultNodeId,v.contentNodeId,v.surfaceNodeId,v.frame.masterNodeId,v.frame.masterContentNodeId,v.frame.instanceNodeId,v.frame.basisNodeId];
    if(new Set(ids).size!==ids.length)return undefined;
    if(v.renderer.kind==="affine") {if(!exact(v.renderer,["kind"]))return undefined;}
    else if(v.renderer.kind==="projective") {
      if(!exact(v.renderer,["kind","shaderId","properties"])||!id(v.renderer.shaderId)||!isRecord(v.renderer.properties)||
        Object.keys(v.renderer.properties).length!==11||!Object.values(v.renderer.properties).every(n=>typeof n==="number"&&Number.isFinite(n)&&Math.abs(n)<=1e6))return undefined;
    }else return undefined;
    return v as unknown as NativeComponentProjection;
  }catch{return undefined;}
}

export function componentRendererId(record:NativeComponentProjection):string|undefined {
  return record.renderer.kind==="projective"?record.renderer.shaderId:undefined;
}
