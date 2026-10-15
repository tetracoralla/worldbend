import { finishPublication } from "./agent-handoff-media";
import { publishWorkRevision } from "./agent-work-revise";
export async function finishWorkRevision(input: Parameters<typeof finishPublication>[0]) {
  return finishPublication(input,(data,lease)=>publishWorkRevision(data as Parameters<typeof publishWorkRevision>[0],lease.validate));
}
