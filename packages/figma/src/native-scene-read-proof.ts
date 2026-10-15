import {readStoredOperationSlots} from "./stored-operation";
import { nativeNodeSnapshot, prepareNativeCopy } from "./native-copy-closure";
import { readResultBinding } from "./stored-binding";
import { fingerprintState } from "./state-fingerprint";

const key = "sceneReadProof";

// Figma's native VM and remote bridge enumerate nested text/paint facts in
// different orders. Compare their values while preserving all array ordering.
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ?
    Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

/** A publication's native source graph, independently of PNG export scale.
 * Reading or validating this proof never creates a document object. */
export async function prepareSceneReadProof(sources: readonly SceneNode[]) {
  const prepared = await prepareNativeCopy(sources);
  const fingerprint = sceneSourcesFingerprint(sources.map(source => source.id),
    [...prepared.originals.values()].map(node => ({ node, state: nativeNodeSnapshot(node) })));
  return { fingerprint, validate: prepared.validate };
}

export function sceneSourcesFingerprint(ids: readonly string[], stamps: readonly { node: { id: string }; state: string }[]) {
  return fingerprintState(stableJson([ids, [...stamps].sort((a, b) => a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0)
    .map(stamp => JSON.parse(stamp.state))]));
}

function record(result: RectangleNode, fingerprint: string) {
  const slots=readStoredOperationSlots(result);
  // Preserve existing small-slot proofs byte-for-byte, including closed-host
  // Undo/Redo. Large operations additionally bind every active bank byte.
  const owning=slots.banks?slots:result.getSharedPluginData("worldbend","task");
  return JSON.stringify({fingerprint,result:fingerprintState(stableJson([result.id,result.getSharedPluginData("worldbend","binding"),owning,result.fills]))});
}

export function writeSceneReadProof(result: RectangleNode, fingerprint: string) {
  if (!readResultBinding(result)) throw Error("Scene binding unavailable");
  result.setSharedPluginData("worldbend", key, record(result, fingerprint));
}

export function matchesSceneReadProof(result: RectangleNode, fingerprint: string) {
  return result.getSharedPluginData("worldbend", key) === record(result, fingerprint);
}
