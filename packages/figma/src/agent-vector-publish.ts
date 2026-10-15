import { vectorProposal, vectorValue } from "./agent-vector-read";
import { publishPreparedVector, vectorProposalRevision, type VectorPublicationInput } from "./agent-vector-publish-prepared";

export async function publishVectorRevision(input:VectorPublicationInput) {
  const saved=input.proposal,accepted=await vectorProposal(vectorProposalRevision(saved));
  if(vectorValue(saved)!==vectorValue(accepted.data))throw Error("E_FIGMA_CONFLICT: Vector source or work changed; recapture");
  return publishPreparedVector(input,accepted.artwork,accepted.validate);
}
