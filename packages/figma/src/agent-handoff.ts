import type { NineNumbers, TransformSpec } from "@worldbend/web/types";
import { loadNativeRenderer, nativeDocumentParts, publishNativeResult, nodePage } from "./native-document";
import { isOwnedTransformSpec } from "./stored-plane";
import { readNativeProjection, readCopiedNativeProjection } from "./native-projective";

function currentState(result: FrameNode, content: FrameNode) {
  const surface = content.parent;
  return JSON.stringify({
    parentNodeId: result.parent?.id,
    record: result.getSharedPluginData("worldbend", "native"),
    binding: result.getSharedPluginData("worldbend", "binding"),
    source: { nodeId: content.id, width: content.width, height: content.height },
    surface: surface?.type === "FRAME" ? { nodeId: surface.id, width: surface.width, height: surface.height } : null,
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
  });
}

/** Used by the local packet preparer; never included in the human plugin. */
export async function inspect(nodeId: string, fileKey: string, pageId: string) {
  if (figma.fileKey !== fileKey) throw new Error("E_FIGMA_SCOPE: the granted file does not match the active file");
  const result = await figma.getNodeByIdAsync(nodeId);
  if (result?.type !== "FRAME" || nodePage(result)?.id !== pageId || figma.currentPage.id !== pageId) {
    throw new Error("E_FIGMA_SCOPE: select an editable result on the granted page");
  }
  const { content, binding, copied, spec } = await nativeDocumentParts(result);
  const source = { nodeId: content.id, width: content.width, height: content.height };
  const placement = { x: result.x, y: result.y, width: result.width, height: result.height };
  // Text/image edits that leave the source bounds intact are deliberately not
  // conflicts: the effect continues rendering the current native content.
  const expected = currentState(result, content);
  return {
    schema: "worldbend.figma.handoff", version: "0.1", fileKey, pageId, nodeId,
    revision: copied ? 0 : binding.revision, spec, source, placement, expected,
  };
}

export async function apply(input: {
  fileKey: string; pageId: string; nodeId: string; expected: string;
  spec: TransformSpec; inverse: NineNumbers; width: number; height: number;
  renderWidth?: number; renderHeight?: number;
}) {
  const renderWidth = input.renderWidth ?? Math.ceil(input.width);
  const renderHeight = input.renderHeight ?? Math.ceil(input.height);
  if (!isOwnedTransformSpec(input.spec) || input.spec.content.warp ||
    ![input.width, input.height].every((n) => Number.isFinite(n) && n >= .01 && n <= 4096) ||
    ![renderWidth, renderHeight].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 4096) ||
    input.inverse.length !== 9 || !input.inverse.every(Number.isFinite)) {
    throw new Error("E_FIGMA_INPUT: prepare a supported transform through the canonical core");
  }
  const fresh = await inspect(input.nodeId, input.fileKey, input.pageId);
  if (fresh.expected !== input.expected) throw new Error("E_FIGMA_CONFLICT: reread the changed result before applying");
  const result = await figma.getNodeByIdAsync(input.nodeId);
  const content = await figma.getNodeByIdAsync(fresh.source.nodeId);
  if (result?.type !== "FRAME" || content?.type !== "FRAME") throw new Error("E_FIGMA_STATE: native content unavailable");
  const renderer = await loadNativeRenderer(figma.currentPage,
    (readNativeProjection(result) ?? readCopiedNativeProjection(result))?.shaderId, "publish");
  if (!renderer) throw new Error("E_FIGMA_RENDERER: this result's sampler is unavailable");
  await publishNativeResult({
    source: content, existing: result, renderer, spec: input.spec, inverse: input.inverse,
    placement: { ...fresh.placement, width: input.width, height: input.height },
    renderWidth, renderHeight,
    beforeWrite: () => {
      if (figma.fileKey !== input.fileKey || figma.currentPage.id !== input.pageId || nodePage(result)?.id !== input.pageId ||
        currentState(result, content) !== input.expected) {
        throw new Error("E_FIGMA_CONFLICT: reread the changed result before applying");
      }
    },
  });
  return inspect(input.nodeId, input.fileKey, input.pageId);
}
