import {nativeVectorSourceViewMatches} from "./source-raster";
import {VECTOR_CAPTURE_CHUNK_BYTES,VECTOR_CAPTURE_ENCODED_BYTES} from "./vector-capture-storage";
import type { ExactJsonEnvelope } from "./exact-json-codec";
import type { WorkPage, WorkScope } from "./agent-work-state";
import { vectorReference, vectorState, vectorScope, type VectorReference } from "./agent-vector-state";
import { vectorSourceProof,vectorValue } from "./agent-vector-proof";
import { nativeVectorOperationDigest } from "./native-vector-operation";

import type { NativeVectorSourceView } from "./native-vector";
import {boundedStateFingerprint} from "./agent-handoff";
import { sha256Hex } from "../../web/src/sha256";
import { vectorExactPage } from "./agent-vector-pages";
const NS="worldbend",META="vector-read-manifest",PREFIX="vector-read-chunk-",SIZE=VECTOR_CAPTURE_CHUNK_BYTES,MAX=VECTOR_CAPTURE_ENCODED_BYTES;
interface CaptureManifest {
  schema:"worldbend.figma.vector-capture";version:"0.3";reference:VectorReference;
  sourceNodeId:string;sourceNodeIds:string[];sourceExpected:string;sourceView:NativeVectorSourceView;currentOperationExpected:string;
  count:number;length:number;digest:string;expiresAt:number;
}
export function storeVectorCapture(target:FrameNode,envelope:ExactJsonEnvelope,
  facts:Pick<CaptureManifest,"reference"|"sourceNodeId"|"sourceNodeIds"|"sourceExpected"|"sourceView"|"currentOperationExpected">) {
  const json=JSON.stringify(envelope);vectorExactPage(json,{},facts.reference);
  const manifest:CaptureManifest={schema:"worldbend.figma.vector-capture",version:"0.3",...facts,
    count:Math.ceil(json.length/SIZE),length:json.length,digest:sha256Hex(json),expiresAt:Date.now()+600000};
  const oldMeta=target.getSharedPluginData(NS,META),oldChunks=Array.from({length:Math.ceil(MAX/SIZE)},(_,i)=>target.getSharedPluginData(NS,`${PREFIX}${i}`));
  try {
    for(let i=0;i<oldChunks.length;i++)target.setSharedPluginData(NS,`${PREFIX}${i}`,json.slice(i*SIZE,(i+1)*SIZE));
    target.setSharedPluginData(NS,META,JSON.stringify(manifest));
    if(target.getSharedPluginData(NS,META)!==JSON.stringify(manifest)||
      Array.from({length:manifest.count},(_,i)=>target.getSharedPluginData(NS,`${PREFIX}${i}`)).join("")!==json)
      throw Error("E_FIGMA_STATE: complete Vector capture was not retained");
  }catch(e){for(let i=0;i<oldChunks.length;i++)target.setSharedPluginData(NS,`${PREFIX}${i}`,oldChunks[i]!);target.setSharedPluginData(NS,META,oldMeta);throw e;}
  return vectorExactPage(json,{},facts.reference);
}
export async function readCachedVectorRevision(input:WorkScope&WorkPage) {
  vectorScope(input);const target=await figma.getNodeByIdAsync(input.nodeId);vectorScope(input);
  if(target?.type!=="FRAME"||target.removed)throw Error("E_FIGMA_SCOPE: current Vector candidate unavailable");
  const raw=target.getSharedPluginData(NS,META);let saved:CaptureManifest;
  try {saved=JSON.parse(raw);}catch{throw Error("E_FIGMA_STATE: capture missing; read a fresh proposal");}
  if(raw.length>8192||saved?.schema!=="worldbend.figma.vector-capture"||saved.version!=="0.3"||
    Object.keys(saved).sort().join(",")!=="count,currentOperationExpected,digest,expiresAt,length,reference,schema,sourceExpected,sourceNodeId,sourceNodeIds,sourceView,version"||
    !Number.isSafeInteger(saved.length)||saved.length<1||saved.length>MAX||saved.count!==Math.ceil(saved.length/SIZE)||
    !Number.isSafeInteger(saved.expiresAt)||saved.expiresAt<=Date.now()||!/^[a-f0-9]{64}$/.test(saved.digest))
    throw Error("E_FIGMA_STATE: capture corrupt or expired; read a fresh proposal");
  const state=await vectorState(input),operation=state.operation??{kind:"transform" as const,spec:state.spec};
  if(vectorValue(vectorReference(state))!==vectorValue(saved.reference)||nativeVectorOperationDigest(operation)!==saved.currentOperationExpected)
    throw Error("E_FIGMA_CONFLICT: Vector work changed between parts; restart read");
  // Proposed operation may change source-role order. Admission was witnessed
  // by capture; freshness here binds every source independent of current view.
  const proofs:Awaited<ReturnType<typeof vectorSourceProof>>[]=[];for(const id of saved.sourceNodeIds) {
    proofs.push(await vectorSourceProof(input,id));
  }
  const validate=()=>{vectorScope(input);for(const p of proofs)p.validate();};validate();
  const expected=boundedStateFingerprint(vectorValue(proofs.map((p,i)=>({id:saved.sourceNodeIds[i],expected:p.sourceExpected}))));
  const source=proofs.find(p=>p.artwork.id===saved.sourceNodeId);
  if(expected!==saved.sourceExpected||!source||!nativeVectorSourceViewMatches(source.artwork,saved.sourceView))throw Error("E_FIGMA_CONFLICT: Vector sources/view changed between parts; restart read");
  let json="";for(let i=0;i<saved.count;i++){
    const part=target.getSharedPluginData(NS,`${PREFIX}${i}`);
    if(part.length!==Math.min(SIZE,saved.length-i*SIZE))throw Error("E_FIGMA_STATE: capture incomplete; restart read");json+=part;
  }
  if(sha256Hex(json)!==saved.digest)throw Error("E_FIGMA_INTEGRITY: capture bytes changed; restart read");
  if(target.getSharedPluginData(NS,META)!==raw)throw Error("E_FIGMA_CONFLICT: capture replaced while reading; restart read");
  validate();return {...vectorExactPage(json,input,input),reference:saved.reference};
}
