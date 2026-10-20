import { finishPublication } from "./agent-handoff-media";
import { publishLinkedImage } from "./agent-linked-update";

/** One trusted bundle lets the transport finalizer and publisher share their
 * native-state/base64 helpers instead of concatenating two complete runtimes. */
export function finishLinkedPublication(input: Parameters<typeof finishPublication>[0]) {
  return finishPublication(input, (data,lease) => publishLinkedImage(data as Parameters<typeof publishLinkedImage>[0],lease.validate));
}
