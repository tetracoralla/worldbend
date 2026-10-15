import type {NativeVectorGeometry} from "./native-vector";
import {nativeVectorGeometrySupported} from "./native-vector";
import {capturedPaints} from "./native-vector-paints";

export interface NativeVectorCaptureDiagnostic {
  stage:"planning"|"outline"|"clip"|"geometry"|"basis";
  reason:string;
  sourceNodeId?:string;
  observed?:number;
  maximum?:number;
}
export type NativeVectorCaptureObserver=(diagnostic:NativeVectorCaptureDiagnostic)=>void;

/** Compact the already admitted resolved appearance, not an arbitrary native
 * node. Corner radii are zero; visible strokes have proven uniform node cap/
 * join semantics. Preserve all positions, handle presence, holes and paints.
 * Source fingerprints still cover the complete original native properties. */
export function compactNativeVectorGeometry(source:NativeVectorGeometry):NativeVectorGeometry {
  if(!nativeVectorGeometrySupported(source))throw Error("Unsupported native vector capture");
  return {...source,vectorNetwork:{
    vertices:source.vectorNetwork.vertices.map(({x,y})=>({x,y})),
    segments:source.vectorNetwork.segments.map(segment=>({start:segment.start,end:segment.end,
      ...(segment.tangentStart!==undefined?{tangentStart:{...segment.tangentStart}}:{}),
      ...(segment.tangentEnd!==undefined?{tangentEnd:{...segment.tangentEnd}}:{})})),
    regions:source.vectorNetwork.regions!.map(region=>({windingRule:region.windingRule,
      loops:region.loops.map(loop=>[...loop]),
      ...(Array.isArray(region.fills)?{fills:capturedPaints(region.fills)}:{})})),
  }};
}
