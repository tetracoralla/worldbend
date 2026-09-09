import type { NineNumbers, TransformSpec } from "@worldbend/web/types";
import { readStoredBinding, SHARED_BINDING_KEY, writeStoredBinding } from "./stored-binding";
import { readStoredOperationSlots, restoreStoredOperationSlots, writeStoredOperation } from "./stored-operation";
import { SHARED_NAMESPACE } from "./stored-plane";
import {
  nativeRendererFromShader, nativeRendererId, nativeShaderProperties, nativeCurrentSpec, readNativeProjection, readCopiedNativeProjection,
  SHARED_NATIVE_KEY, type NativeProjection, type NativeRenderer,
} from "./native-projective";
import type { Placement } from "./messages";
import { BUNDLED_NATIVE_RENDERER, canonicalNativeRendererId, publicationNativeRendererId } from "./native-renderer";
import { withTimeout } from "./async-timeout";

const NATIVE_IMPORT_TIMEOUT_MS = 5000;

type ShaderEffect = { type: "SHADER"; visible: boolean; id: string; properties: Record<string, number> };
type ShaderApi = { importShaderById?: (id: string) => Promise<Parameters<typeof nativeRendererFromShader>[0]> };
export class NativeRollbackIncompleteError extends Error {}
let cached: { host: typeof figma; pageId: string; id: string; pending: Promise<NativeRenderer | undefined> } | undefined;
export interface NativePublicationUndo {
  resultNodeId: string; contentNodeId: string; surfaceNodeId: string;
  sourceWidth: number; sourceHeight: number;
  width: number; height: number; x: number; y: number;
  surfaceWidth: number; surfaceHeight: number; effects: readonly Effect[];
  native: string; binding: string; operation: string; publishedNative: string;
}
// One completed publication, bounded to the same lifespan as the open plugin.
let lastPublicationUndo: NativePublicationUndo | undefined;

export function nativePublicationUndoFor(result: FrameNode): NativePublicationUndo | undefined {
  return lastPublicationUndo?.resultNodeId === result.id &&
    lastPublicationUndo.publishedNative === result.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY)
    ? lastPublicationUndo : undefined;
}

export function matchesNativePublicationUndo(result: FrameNode, saved: NativePublicationUndo): boolean {
  return !result.removed && result.id === saved.resultNodeId &&
    result.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) === saved.native &&
    result.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY) === saved.binding &&
    result.getSharedPluginData(SHARED_NAMESPACE, "transform") === saved.operation;
}

/** Restore the actual pre-publication placement, including a copied/moved Frame. */
export async function restoreNativePublicationUndo(
  result: FrameNode, saved: NativePublicationUndo, beforeWrite: () => void,
): Promise<void> {
  const [content, surface] = await Promise.all([
    figma.getNodeByIdAsync(saved.contentNodeId), figma.getNodeByIdAsync(saved.surfaceNodeId),
  ]);
  if (!matchesNativePublicationUndo(result, saved) || content?.type !== "FRAME" || surface?.type !== "FRAME" ||
    content.parent?.id !== surface.id || surface.parent?.id !== result.id ||
    result.children.length !== 1 || surface.children.length !== 1 || !canUseNativeSource(content) ||
    content.width !== saved.sourceWidth || content.height !== saved.sourceHeight) throw new Error("Native content changed; undo unavailable");
  const sameEffects = JSON.stringify(surface.effects) === JSON.stringify(saved.effects);
  if (result.width === saved.width && result.height === saved.height && result.x === saved.x && result.y === saved.y &&
    surface.width === saved.surfaceWidth && surface.height === saved.surfaceHeight && sameEffects) return;
  const previous = { width: result.width, height: result.height, x: result.x, y: result.y,
    surfaceWidth: surface.width, surfaceHeight: surface.height, effects: surface.effects };
  beforeWrite();
  if (!matchesNativePublicationUndo(result, saved)) throw new Error("Native undo state changed");
  try {
    result.resizeWithoutConstraints(saved.width, saved.height); result.x = saved.x; result.y = saved.y;
    surface.resizeWithoutConstraints(saved.surfaceWidth, saved.surfaceHeight); surface.effects = saved.effects;
    await nativeDocumentParts(result);
  } catch (error) {
    try {
      result.resizeWithoutConstraints(previous.width, previous.height); result.x = previous.x; result.y = previous.y;
      surface.resizeWithoutConstraints(previous.surfaceWidth, previous.surfaceHeight); surface.effects = previous.effects;
    } catch { throw new NativeRollbackIncompleteError("Native undo rollback incomplete"); }
    throw error;
  }
}

export async function loadNativeRenderer(
  page: PageNode, retainedShaderId?: string, purpose: "reopen" | "publish" = "reopen",
): Promise<NativeRenderer | undefined> {
  // Reopening keeps the recorded version. Explicit publication repairs only
  // the known alpha build; a page override still scopes new development trials.
  const retained = retainedShaderId && purpose === "publish" ? publicationNativeRendererId(retainedShaderId) : retainedShaderId;
  const id = canonicalNativeRendererId(retained ??
    (typeof page.getSharedPluginData === "function" ? nativeRendererId(page) : undefined) ?? BUNDLED_NATIVE_RENDERER);
  const api = figma as unknown as ShaderApi;
  if (!api.importShaderById) return undefined;
  if (cached?.host === figma && cached.pageId === page.id && cached.id === id) return cached.pending;
  const pending = withTimeout(api.importShaderById(id).then((shader) =>
    canonicalNativeRendererId(shader.id) === id ? nativeRendererFromShader(shader) : undefined),
    NATIVE_IMPORT_TIMEOUT_MS, () => new Error("Native sampler import timed out")).catch(() => undefined);
  const entry = { host: figma, pageId: page.id, id, pending };
  cached = entry;
  // Do not memoize an unavailable effect: a later request may follow an
  // installation or fresh file session. Do not evict a newer page's import.
  void pending.then((renderer) => { if (!renderer && cached === entry) cached = undefined; });
  return pending;
}

export function canUseNativeSource(node: SceneNode): node is FrameNode {
  return node.type === "FRAME" && node.clipsContent && node.width > 0 && node.height > 0 &&
    node.width <= 4096 && node.height <= 4096 &&
    [node.relativeTransform, node.absoluteTransform].every((matrix) =>
      Math.abs(matrix[0][0] - 1) < 1e-6 && Math.abs(matrix[1][1] - 1) < 1e-6 &&
      Math.abs(matrix[0][1]) < 1e-6 && Math.abs(matrix[1][0]) < 1e-6);
}

export function nodePage(node: BaseNode): PageNode | undefined {
  let current: BaseNode | null = node;
  while (current && current.type !== "PAGE") current = current.parent;
  return current?.type === "PAGE" ? current : undefined;
}

// Supported native carriers have an axis-aligned, unit-scale ancestor basis.
// The durable placement stays in page coordinates, including after reparenting.
function nativeParentOffset(result: FrameNode): { x: number; y: number } {
  const parent = result.parent;
  return parent && "absoluteTransform" in parent
    ? { x: parent.absoluteTransform[0][2], y: parent.absoluteTransform[1][2] }
    : { x: 0, y: 0 };
}

export async function nativeDocumentParts(result: FrameNode): Promise<{
  record: NativeProjection; content: FrameNode; surface: FrameNode;
  spec: TransformSpec;
  binding: NonNullable<ReturnType<typeof readStoredBinding>>; copied: boolean;
}> {
  const record = readNativeProjection(result) ?? readCopiedNativeProjection(result);
  if (!record) throw new Error("Invalid native projection record");
  const copied = record.resultNodeId !== result.id;
  // Copies resolve only their own two wrapper levels. Their old record IDs
  // are validation data, never references to mutate or reuse the original.
  const copiedSurface = copied ? result.children[0] : undefined;
  const [content, surface] = copied ? [
    copiedSurface?.type === "FRAME" ? copiedSurface.children[0] : undefined, copiedSurface,
  ] : await Promise.all([
    figma.getNodeByIdAsync(record.contentNodeId), figma.getNodeByIdAsync(record.surfaceNodeId),
  ]);
  const binding = readStoredBinding(copied ? { id: record.resultNodeId,
    getSharedPluginData: (namespace, key) => result.getSharedPluginData(namespace, key) } : result);
  const oldSurface = {
    width: Math.ceil(Math.max(record.sourceSize.width, record.outputSize.width)),
    height: Math.ceil(Math.max(record.sourceSize.height, record.outputSize.height)),
  };
  // Figma Resize can leave the surface unchanged; Scale scales the subtree.
  // Both preserve the recorded effect, and reopen against the current output
  // bounds. Unrelated wrapper edits still fail this structural check.
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 1e-6);
  const surfaceSizeMatches = surface?.type === "FRAME" && (
    (close(surface.width, oldSurface.width) && close(surface.height, oldSurface.height)) ||
    (close(surface.width, oldSurface.width * result.width / record.outputSize.width) &&
      close(surface.height, oldSurface.height * result.height / record.outputSize.height))
  );
  if (!content || content.type !== "FRAME" || !surface || surface.type !== "FRAME" ||
    content.parent?.id !== surface.id || surface.parent?.id !== result.id ||
    surface.children.length !== 1 || result.children.length !== 1 ||
    !result.clipsContent || !surface.clipsContent || !close(content.x, 0) || !close(content.y, 0) ||
    !close(surface.x, 0) || !close(surface.y, 0) || !canUseNativeSource(content) ||
    ![result.width, result.height].every((n) => Number.isFinite(n) && n > 0 && n <= 4096) || !surfaceSizeMatches ||
    binding?.sourceNodeIds.length !== 1 || binding.sourceNodeIds[0] !== record.contentNodeId ||
    (copied && (content.id === record.contentNodeId || surface.id === record.surfaceNodeId))) {
    throw new Error("Native projection structure changed");
  }
  const effects = surface.effects as unknown as ShaderEffect[];
  const effect = effects[0];
  if (effects.length !== 1 || !effect || effect.type !== "SHADER" || !effect.visible ||
    effect.id !== record.shaderId || Object.keys(effect.properties).length !== 11 ||
    !Object.entries(record.properties).every(([id, value]) => effect.properties[id] === Math.fround(value))) {
    throw new Error("Native projection effect changed");
  }
  return { record, content, surface, binding, copied, spec: nativeCurrentSpec(record, surface, result) };
}

/** Explicitly replay saved geometry after host Undo or a requested repair. */
export async function restoreNativeProjection(result: FrameNode, beforeWrite: () => void): Promise<void> {
  const record = readNativeProjection(result);
  if (!record || nodePage(result)?.id !== figma.currentPage.id) throw new Error("Native recovery unavailable");
  const [content, surface] = await Promise.all([
    figma.getNodeByIdAsync(record.contentNodeId), figma.getNodeByIdAsync(record.surfaceNodeId),
  ]);
  if (content?.type !== "FRAME" || surface?.type !== "FRAME" ||
    content.parent?.id !== surface.id || surface.parent?.id !== result.id ||
    surface.children.length !== 1 || result.children.length !== 1 ||
    !canUseNativeSource(content) || content.width !== record.sourceSize.width || content.height !== record.sourceSize.height ||
    readStoredBinding(result)?.sourceNodeIds.join() !== content.id ||
    JSON.stringify(readNativeProjection(result)) !== JSON.stringify(record)) throw new Error("Native content changed; recovery unavailable");
  const previous = { x: result.x, y: result.y, width: result.width, height: result.height,
    surfaceWidth: surface.width, surfaceHeight: surface.height, effects: surface.effects };
  const offset = nativeParentOffset(result);
  beforeWrite();
  try {
    result.resizeWithoutConstraints(record.outputSize.width, record.outputSize.height);
    result.x = record.placement.x - offset.x; result.y = record.placement.y - offset.y;
    surface.resizeWithoutConstraints(Math.ceil(Math.max(record.sourceSize.width, record.outputSize.width)), Math.ceil(Math.max(record.sourceSize.height, record.outputSize.height)));
    surface.effects = [{ type: "SHADER", visible: true, id: record.shaderId, properties: record.properties }] as unknown as Effect[];
    await nativeDocumentParts(result);
  } catch (error) {
    try {
      result.resizeWithoutConstraints(previous.width, previous.height); result.x = previous.x; result.y = previous.y;
      surface.resizeWithoutConstraints(previous.surfaceWidth, previous.surfaceHeight); surface.effects = previous.effects;
    } catch { throw new NativeRollbackIncompleteError("Native recovery rollback incomplete"); }
    throw error;
  }
}

/** Mutate native nodes as one recoverable host operation. No raster asset is made. */
export async function publishNativeResult(input: {
  source: FrameNode;
  existing?: FrameNode;
  renderer: NativeRenderer;
  inverse: NineNumbers;
  spec: TransformSpec;
  placement: Placement;
  renderWidth: number;
  renderHeight: number;
  beforeWrite?: () => void;
}): Promise<FrameNode> {
  if (!canUseNativeSource(input.source) || input.spec.content.warp ||
    ![input.placement.width, input.placement.height].every((n) => Number.isFinite(n) && n > 0 && n <= 4096)) {
    throw new Error("Unsupported editable frame");
  }
  const existingParts = input.existing ? await nativeDocumentParts(input.existing) : undefined;
  if (existingParts && existingParts.content.id !== input.source.id) {
    throw new Error("Select the native content to update this result");
  }
  // The lookup above yields to the host; source basis/size can change there.
  if (!canUseNativeSource(input.source)) throw new Error("Native source changed");
  input.beforeWrite?.();
  const result = input.existing ?? figma.createFrame();
  const prior = input.existing && existingParts ? {
    width: result.width, height: result.height, x: result.x, y: result.y,
    surfaceWidth: existingParts.surface.width, surfaceHeight: existingParts.surface.height,
    effects: existingParts.surface.effects,
    slots: readStoredOperationSlots(result),
    binding: result.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY),
    native: result.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY),
  } : undefined;
  let surface: FrameNode | undefined = existingParts?.surface;
  let clonedContent: FrameNode | undefined;
  try {
    if (!input.existing) {
      result.name = `${input.source.name} · Worldbend`;
      result.fills = [];
      result.clipsContent = true;
      surface = figma.createFrame();
      surface.name = "Perspective";
      surface.fills = [];
      surface.clipsContent = true;
      result.appendChild(surface);
      surface.x = 0; surface.y = 0;
    }
    if (!surface) throw new Error("Missing native surface");
    const content = existingParts?.content ?? input.source.clone();
    if (!existingParts) {
      clonedContent = content;
      surface.appendChild(content);
      content.name = "Content";
      content.x = 0; content.y = 0;
    }
    // These are sampling view boxes, not content-layout operations. resize()
    // recursively applies CENTER/SCALE/etc. constraints to native children.
    result.resizeWithoutConstraints(input.placement.width, input.placement.height);
    result.x = input.placement.x;
    result.y = input.placement.y;
    surface.resizeWithoutConstraints(Math.ceil(Math.max(content.width, result.width)), Math.ceil(Math.max(content.height, result.height)));
    // The core inverse is in requested render pixels. Convert surface document
    // pixels to that coordinate scale before converting input UV to its texture.
    const inverse = input.inverse.map((value, index) => value *
      (index % 3 === 0 ? input.renderWidth / result.width : index % 3 === 1 ? input.renderHeight / result.height : 1)) as NineNumbers;
    const properties = nativeShaderProperties(input.renderer, inverse, content, surface);
    surface.effects = [{ type: "SHADER", visible: true, id: input.renderer.id, properties }] as unknown as Effect[];
    const applied = (surface.effects as unknown as ShaderEffect[])[0]!;
    if (applied.type !== "SHADER" || !applied.visible ||
      !Object.entries(properties).every(([id, value]) => applied.properties[id] === value)) {
      throw new Error("Native sampler did not retain its parameters");
    }
    const offset = nativeParentOffset(result);
    const record: NativeProjection = {
      schema: "worldbend.figma.native", version: "0.2", resultNodeId: result.id,
      contentNodeId: content.id, surfaceNodeId: surface.id, shaderId: applied.id,
      sourceSize: { width: content.width, height: content.height },
      outputSize: { width: result.width, height: result.height },
      placement: { x: result.x + offset.x, y: result.y + offset.y, width: result.width, height: result.height },
      operation: JSON.stringify(input.spec), properties,
    };
    writeStoredOperation(result, { kind: "transform", spec: input.spec });
    writeStoredBinding(result, { sourceNodeIds: [content.id], renderWidth: input.renderWidth, renderHeight: input.renderHeight });
    result.setSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY, JSON.stringify(record));
    lastPublicationUndo = prior ? {
      resultNodeId: result.id, contentNodeId: content.id, surfaceNodeId: surface.id,
      sourceWidth: content.width, sourceHeight: content.height,
      width: prior.width, height: prior.height, x: prior.x, y: prior.y,
      surfaceWidth: prior.surfaceWidth, surfaceHeight: prior.surfaceHeight, effects: prior.effects,
      native: prior.native, binding: prior.binding, operation: prior.slots.transform,
      publishedNative: JSON.stringify(record),
    } : undefined;
    return result;
  } catch (error) {
    try {
      if (!input.existing) {
        // clone() initially inserts beside its source. Clean it up even if
        // reparenting failed before it joined the new result's subtree.
        if (clonedContent && clonedContent.parent?.id !== surface?.id) clonedContent.remove();
        if (surface && surface.parent?.id !== result.id) surface.remove();
        result.remove();
      }
      else if (prior && surface) {
        result.resizeWithoutConstraints(prior.width, prior.height); result.x = prior.x; result.y = prior.y;
        surface.resizeWithoutConstraints(prior.surfaceWidth, prior.surfaceHeight); surface.effects = prior.effects;
        restoreStoredOperationSlots(result, prior.slots);
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY, prior.binding);
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY, prior.native);
      }
    } catch { throw new NativeRollbackIncompleteError("Native projection rollback incomplete"); }
    throw error;
  }
}
