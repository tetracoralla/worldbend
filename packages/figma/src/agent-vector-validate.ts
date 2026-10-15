import { publicationLease, readPublication } from "./agent-handoff-media";
import { vectorProposal, vectorValue } from "./agent-vector-read";
import {vectorProposalRevision,type VectorPublicationInput } from "./agent-vector-publish-prepared";
import { boundedStateFingerprint } from "./agent-handoff";
import { publicationTargetFingerprint } from "./native-vector-document";

/** Separate capture from path preparation to keep each host request bounded. */
export async function validateVectorPublication(scope:{fileKey:string;pageId:string;nodeId:string;transferId:string;payloadDigest:string}) {
  if(!/^[a-f0-9]{64}$/.test(scope.payloadDigest))throw Error("E_FIGMA_INTEGRITY: prepared Vector payload digest required");
  const lease=await publicationLease(scope);
  const input=await readPublication(scope) as unknown as VectorPublicationInput,saved=input.proposal;
  const accepted=await vectorProposal(vectorProposalRevision(saved));
  if(vectorValue(saved)!==vectorValue(accepted.data)||input.fileKey!==saved.base.fileKey||input.pageId!==saved.base.pageId||input.nodeId!==saved.base.nodeId) {
    throw Error("E_FIGMA_CONFLICT: Vector source or work changed; recapture");
  }
  const target=await figma.getNodeByIdAsync(scope.nodeId);accepted.validate();
  if(target?.type!=="FRAME"||target.removed||publicationTargetFingerprint(target)!==saved.base.targetExpected)throw Error("E_FIGMA_CONFLICT: native Vector work changed");
  lease.validate();
  target.setSharedPluginData("worldbend","vectorPublicationGuard",JSON.stringify({transferId:scope.transferId,leaseId:lease.leaseId,
    expiresAt:lease.expiresAt,payloadExpected:boundedStateFingerprint(vectorValue(input))}));
  return {fileKey:scope.fileKey,pageId:scope.pageId,nodeId:scope.nodeId,transferId:scope.transferId,status:"validated" as const,affectedNodeIds:[target.id]};
}
