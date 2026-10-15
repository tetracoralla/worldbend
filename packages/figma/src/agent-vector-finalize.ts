import { finishPublication } from "./agent-handoff-media";
import { publishValidatedVector, type VectorPublicationInput } from "./agent-vector-publish-prepared";
export async function finalizeVectorPublication(scope:{fileKey:string;pageId:string;nodeId:string;transferId:string;payloadDigest:string}) {
  if(!/^[a-f0-9]{64}$/.test(scope.payloadDigest))throw Error("E_FIGMA_INTEGRITY: prepared Vector payload digest required");
  return finishPublication(scope,(data,lease)=>publishValidatedVector(data as unknown as VectorPublicationInput,scope,lease));
}
