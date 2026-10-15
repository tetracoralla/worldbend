import { isFigmaImageAxis, isRecord, SHARED_NAMESPACE } from "./stored-plane";
import type { SharedOperationReader, SharedOperationWriter } from "./stored-operation";

export const SHARED_BINDING_KEY = "binding";

/** Document references, not a second transform model. Source order is significant. */
export interface StoredBinding {
  schema: "worldbend.figma.binding";
  version: "0.1";
  resultNodeId: string;
  sourceNodeIds: string[];
  revision: number;
  renderWidth: number;
  renderHeight: number;
}

export function readStoredBinding(
  node: SharedOperationReader & { id: string },
): StoredBinding | undefined {
  return parseBinding(node, false);
}

/** Figma Duplicate retains shared bytes. Read a raster copy against its own
 * identity without a document write; successful publication adopts it. Native
 * Frames use their structural/fingerprint validation instead of this route.
 * Like the strict reader, this reads references only; callers still admit the
 * saved operation and its source slots through their owning validators. */
export function readResultBinding(
  node: SharedOperationReader & { id: string; type?: string },
): StoredBinding | undefined {
  return parseBinding(node, node.type === "RECTANGLE");
}

function parseBinding(
  node: SharedOperationReader & { id: string }, allowCopiedIdentity: boolean,
): StoredBinding | undefined {
  const value = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY);
  if (!value || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || Object.keys(parsed).length !== 7 ||
      parsed["schema"] !== "worldbend.figma.binding" || parsed["version"] !== "0.1" ||
      typeof parsed["resultNodeId"] !== "string" || parsed["resultNodeId"].length < 1 || parsed["resultNodeId"].length > 256 ||
      (!allowCopiedIdentity && parsed["resultNodeId"] !== node.id) ||
      !Array.isArray(parsed["sourceNodeIds"]) || parsed["sourceNodeIds"].length < 1 ||
      parsed["sourceNodeIds"].length > 8 ||
      !parsed["sourceNodeIds"].every((id: unknown) =>
        typeof id === "string" && id.length > 0 && id.length <= 256 && id !== node.id && id !== parsed["resultNodeId"]) ||
      new Set(parsed["sourceNodeIds"]).size !== parsed["sourceNodeIds"].length ||
      !Number.isSafeInteger(parsed["revision"]) || Number(parsed["revision"]) < 1 ||
      !isFigmaImageAxis(parsed["renderWidth"]) || !isFigmaImageAxis(parsed["renderHeight"])) {
      return undefined;
    }
    return (allowCopiedIdentity && parsed["resultNodeId"] !== node.id
      ? { ...parsed, resultNodeId: node.id }
      : parsed) as unknown as StoredBinding;
  } catch {
    return undefined;
  }
}

export function writeStoredBinding(
  node: SharedOperationWriter & { id: string; type?: string },
  input: Pick<StoredBinding, "sourceNodeIds" | "renderWidth" | "renderHeight">,
  options?: { newResult: true },
): void {
  const prior = options?.newResult ? undefined : readResultBinding(node);
  const binding: StoredBinding = {
    schema: "worldbend.figma.binding",
    version: "0.1",
    resultNodeId: node.id,
    sourceNodeIds: [...input.sourceNodeIds],
    revision: (prior?.revision ?? 0) + 1,
    renderWidth: input.renderWidth,
    renderHeight: input.renderHeight,
  };
  const serialized = JSON.stringify(binding);
  if (!readStoredBinding({ id: node.id, getSharedPluginData: () => serialized })) {
    throw new Error("Invalid Worldbend source binding");
  }
  node.setSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY, serialized);
}
