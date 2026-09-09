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
  const value = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY);
  if (!value || value.length > 4096) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || Object.keys(parsed).length !== 7 ||
      parsed["schema"] !== "worldbend.figma.binding" || parsed["version"] !== "0.1" ||
      parsed["resultNodeId"] !== node.id ||
      !Array.isArray(parsed["sourceNodeIds"]) || parsed["sourceNodeIds"].length < 1 ||
      parsed["sourceNodeIds"].length > 8 ||
      !parsed["sourceNodeIds"].every((id: unknown) =>
        typeof id === "string" && id.length > 0 && id.length <= 256 && id !== node.id) ||
      new Set(parsed["sourceNodeIds"]).size !== parsed["sourceNodeIds"].length ||
      !Number.isSafeInteger(parsed["revision"]) || Number(parsed["revision"]) < 1 ||
      !isFigmaImageAxis(parsed["renderWidth"]) || !isFigmaImageAxis(parsed["renderHeight"])) {
      return undefined;
    }
    return parsed as unknown as StoredBinding;
  } catch {
    return undefined;
  }
}

export function writeStoredBinding(
  node: SharedOperationWriter & { id: string },
  input: Pick<StoredBinding, "sourceNodeIds" | "renderWidth" | "renderHeight">,
): void {
  const prior = readStoredBinding(node);
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
