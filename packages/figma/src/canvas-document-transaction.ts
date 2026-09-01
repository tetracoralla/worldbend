import type { SourcePayload, UiToMainMessage } from "./messages";
import { singleCanvasSpec } from "./stored-canvas";
import type { StoredOperation } from "./stored-operation";

type CanvasPayload = Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"];

export interface CanvasPublishRequest {
  existing?: RectangleNode;
  imageHash: string;
  storedOperation: Extract<StoredOperation, { kind: "canvas" }>;
  sourceName: string;
  placement: SourcePayload["placement"];
  renderWidth: number;
  renderHeight: number;
}

export class CanvasRollbackIncompleteError extends Error {}

/**
 * Owns only the ordered, all-or-none Canvas document mutation. Selection,
 * reusable-result validation, and shared storage publication stay in main and
 * enter through explicit dependencies instead of becoming a second model.
 */
export async function publishCanvasDocumentTransaction(input: {
  payload: CanvasPayload;
  sourceName: string;
  existing?: RectangleNode;
  createImage(bytes: Uint8Array): { hash: string };
  commitUndo(): void;
  publish(request: CanvasPublishRequest): Promise<RectangleNode>;
}): Promise<RectangleNode[]> {
  const images = input.payload.outputs.map((output) => input.createImage(output.bytes));
  input.commitUndo();
  const results: RectangleNode[] = [];
  const created: RectangleNode[] = [];
  try {
    for (let index = 0; index < input.payload.outputs.length; index += 1) {
      const output = input.payload.outputs[index]!;
      const variant = input.payload.setSpec.variants[index]!;
      const result = await input.publish({
        ...(input.existing ? { existing: input.existing } : {}),
        imageHash: images[index]!.hash,
        storedOperation: { kind: "canvas", spec: singleCanvasSpec(variant.operation) },
        sourceName: `${input.sourceName} · ${variant.id}`,
        placement: output.placement,
        renderWidth: output.renderWidth,
        renderHeight: output.renderHeight,
      });
      results.push(result);
      if (!input.existing) created.push(result);
    }
    return results;
  } catch (error) {
    let rollbackFailed = false;
    for (const result of [...created].reverse()) {
      try {
        result.remove();
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) throw new CanvasRollbackIncompleteError();
    throw error;
  }
}
