import { nodePage } from "./native-document";
import { nativeNodeSnapshot } from "./native-copy-closure";
import { nativeArtworkProof } from "./native-artwork-proof";
import { boundedStateFingerprint } from "./agent-handoff";
import { vectorScope } from "./agent-vector-state";
import type { WorkScope } from "./agent-work-state";
import {resolveNativeVectorOperation,type NativeVectorStoredOperation} from "./native-vector-operation";
import {assertIndependentVectorSource} from "./native-vector-dependency";

export function vectorValue(value: unknown) {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}

/** Complete state/basis proof, shared by capture and every native write barrier. */
export async function vectorSourceProof(base:WorkScope, sourceNodeId:string) {
  const source = await figma.getNodeByIdAsync(sourceNodeId); vectorScope(base);
  if (!source || !("visible" in source) || nodePage(source)?.id !== base.pageId || source.id === base.nodeId) {
    throw Error("E_FIGMA_INPUT: choose the current source or an explicit replacement");
  }
  const artwork = source as SceneNode;
  assertIndependentVectorSource(artwork,base.nodeId);
  const proof = nativeArtworkProof(artwork);
  if (proof.originals.has(base.nodeId)) throw Error("E_FIGMA_INPUT: Vector source cannot depend on its result");
  const stamps = [...proof.originals].map(([id, node]) => ({ id, state: nativeNodeSnapshot(node) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sourceExpected = boundedStateFingerprint(vectorValue(stamps));
  return { artwork, sourceExpected, validate: () => { vectorScope(base); assertIndependentVectorSource(artwork,base.nodeId); proof.validate(); } };
}
export async function vectorSourcesProof(base:WorkScope,operation:NativeVectorStoredOperation,sourceNodeIds:string[]) {
  const resolved=resolveNativeVectorOperation(operation);
  if(sourceNodeIds.length!==resolved.sourceCount||new Set(sourceNodeIds).size!==sourceNodeIds.length)
    throw Error("E_FIGMA_INPUT: preserve all ordered Vector source roles");
  const proofs:Awaited<ReturnType<typeof vectorSourceProof>>[]=[];for(const id of sourceNodeIds)proofs.push(await vectorSourceProof(base,id));
  const validate=()=>{vectorScope(base);for(const p of proofs)p.validate();};validate();
  return {artwork:proofs[resolved.artworkSourceIndex]!.artwork,sources:proofs.map(p=>p.artwork),
    sourceExpected:boundedStateFingerprint(vectorValue(proofs.map((p,i)=>({id:sourceNodeIds[i],expected:p.sourceExpected})))),validate};
}
