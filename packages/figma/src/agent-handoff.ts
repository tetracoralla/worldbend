import { rasterPaintsIntact, SHARED_RASTER_PAINT_KEY, writeRasterPaintProof } from "./raster-paint-guard";
import { figmaError } from "./state-fingerprint";
import {nativePlacementSelection} from "./native-copy-placement";
import { nativeNodeSnapshot } from "./native-copy-closure";
import { sceneSourcesFingerprint, writeSceneReadProof } from "./native-scene-read-proof";
import { fingerprintState } from "./state-fingerprint";
import { sameSourceRasterViewBox, sourceRasterBounds, sourceRasterViewBox } from "./source-raster";
import { appearanceNodeSnapshot, appearanceExpectedState, appearancePreviewContext, applyAppearanceToNodes, isAppearanceRecipeWire, type GlassMaterialWire, type GlassWireField, type AppearanceRecipeWire } from "./appearance";
import { textureNodeSnapshot, textureExpectedState, applyTextureToNodes, isTextureRecipeWire, type TextureMaterialWire, type TextureWireField, type TextureRecipeWire } from "./texture";
import type { NineNumbers, TransformSpec, NativeFramePlan } from "@worldbend/web/types";
import { loadNativeRenderer, nativeDocumentParts, publishNativeResult, nodePage } from "./native-document";
import {
  isOwnedTransformSpec,
  isFigmaImageAxis,
  SHARED_NAMESPACE,
} from "./stored-plane";
import { readNativeProjection, readCopiedNativeProjection, recordedNativeRenderer } from "./native-projective";
import { readResultBinding, writeStoredBinding } from "./stored-binding";
import { readStoredOperationValue, readStoredOperationSlots, restoreStoredOperationSlots, writeStoredOperation } from "./stored-operation";
import {
  compositionMockup,
  isFigmaCompositionTask,
  isFigmaSpatialEffectTask,
  parseStoredEffectDraft,
  parseStoredMockupDraft,
  SHARED_EFFECT_DRAFT_KEY,
  SHARED_MOCKUP_DRAFT_KEY,
  type FigmaSpatialEffectTask,
  type FigmaCompositionTask,
  type FigmaDeformationTask,
  type StoredEffectDraft,
  type StoredMockupDraft,
} from "./stored-designer-task";
import { templateLibrarySummary } from "./template-library-summary";
import { discoverFileNativeTemplates } from "./agent-template-discovery";
import { readySceneRecords } from "./ready-scenes";
import { placementBeside, RESULT_PLACEMENT_GAP } from "./result-placement";

declare function btoa(binary:string):string;
declare function atob(encoded:string):string;
function readHandoffTask(source:{getSharedPluginData(namespace:string,key:string):string}):unknown {
  try{const value=readStoredOperationValue(source);return value?.kind==="task"?value.value:undefined;}catch{return undefined;}
}

function currentState(result: FrameNode, content: FrameNode) {
  const record=readNativeProjection(result)??readCopiedNativeProjection(result);
  const nativeSurface=record?.version==="0.3"?result.children[0]:content.parent;
  const surface=nativeSurface?.type==="FRAME"?nativeSurface:undefined;
  return JSON.stringify({
    parentNodeId: result.parent?.id,
    record: result.getSharedPluginData("worldbend", "native"),
    binding: result.getSharedPluginData("worldbend", "binding"),
    source: { nodeId: content.id, width: content.width, height: content.height },
    surface: surface?.type === "FRAME" ? { nodeId: surface.id, width: surface.width, height: surface.height } : null,
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
    ...(record?.version==="0.3"?{basis:content.parent?.parent&&"relativeTransform"in content.parent.parent?content.parent.parent.relativeTransform:null,scale:content.parent?.type==="INSTANCE"?content.parent.scaleFactor:null,outer:surface?.relativeTransform}:{}),
  });
}

function nativeExpectedState(result:FrameNode,content:FrameNode):string {
  const state=currentState(result,content);
  // Modern records are already present in the file. Carry a bounded opaque
  // freshness token instead of JSON-escaping that complete record repeatedly.
  return (readNativeProjection(result)??readCopiedNativeProjection(result))?.version==="0.3"?fingerprintState(state):state;
}

/** Used by the local packet preparer; never included in the human plugin. */
export async function inspect(nodeId: string, fileKey: string, pageId: string) {
  if (figma.fileKey !== fileKey) throw figmaError("SCOPE", "granted file mismatch");
  const selected = await figma.getNodeByIdAsync(nodeId);
  const result=selected?.type==="FRAME"?nativePlacementSelection(selected):selected;
  if (result?.type !== "FRAME" || nodePage(result)?.id !== pageId || figma.currentPage.id !== pageId) {
    throw figmaError("SCOPE", "select an editable result on the granted page");
  }
  const { content, binding, copied, spec, affineState } = await nativeDocumentParts(result);
  const record=readNativeProjection(result)??readCopiedNativeProjection(result);
  const source = { nodeId: content.id, width: content.width, height: content.height };
  const placement = { x: result.x, y: result.y, ...(record?.version==="0.3"&&record.sourceEditing?record.outputSize:{width:result.width,height:result.height}) };
  // Text/image edits that leave the source bounds intact are deliberately not
  // conflicts: the effect continues rendering the current native content.
  const expected = nativeExpectedState(result, content);
  return {
    schema: "worldbend.figma.handoff", version: record?.version==="0.3"?"0.2":"0.1", fileKey, pageId, nodeId:result.id,
    revision: copied ? 0 : binding.revision, spec, source, placement, expected,
    ...(record?.version==="0.3"?{componentFrame:true,...(record.sourceEditing?{sourceEditing:true}:{})}:{}),...(affineState?{affineState}:{}),
  };
}

export async function apply(input: {
  fileKey: string; pageId: string; nodeId: string; expected: string;
  spec: TransformSpec; inverse: NineNumbers; width: number; height: number;
  renderWidth?: number; renderHeight?: number;
  nativePlan?:NativeFramePlan;
}, validateSource?: () => void, replacement?: FrameNode) {
  const renderWidth = input.renderWidth ?? Math.ceil(input.width);
  const renderHeight = input.renderHeight ?? Math.ceil(input.height);
  if (!isOwnedTransformSpec(input.spec) || input.spec.content.warp ||
    ![input.width, input.height].every((n) => Number.isFinite(n) && n >= .01 && n <= 4096) ||
    ![renderWidth, renderHeight].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 4096) ||
    input.inverse.length !== 9 || !input.inverse.every(Number.isFinite)) {
    throw figmaError("INPUT", "prepare a supported transform through the canonical core");
  }
  const fresh = await inspect(input.nodeId, input.fileKey, input.pageId);
  if (fresh.expected !== input.expected) throw figmaError("CONFLICT", "reread the changed result before applying");
  const result = await figma.getNodeByIdAsync(fresh.nodeId);
  const content = await figma.getNodeByIdAsync(fresh.source.nodeId);
  if (result?.type !== "FRAME" || content?.type !== "FRAME") throw figmaError("STATE", "native content unavailable");
  if(replacement&&!validateSource)throw figmaError("INPUT","prepare a guarded native source replacement");
  const projection=readNativeProjection(result)??readCopiedNativeProjection(result);
  const affineCarrier=input.nativePlan?.kind==="affine"&&projection?.version==="0.3";
  const renderer = affineCarrier?undefined:await loadNativeRenderer(figma.currentPage,
    recordedNativeRenderer(projection), "publish");
  if (!renderer&&!affineCarrier) throw figmaError("RENDERER", "this result's sampler is unavailable");
  await publishNativeResult({
    source: replacement??content, existing: result, ...(renderer?{renderer}:{}), ...(input.nativePlan?{nativePlan:input.nativePlan}:{}), spec: input.spec, inverse: input.inverse,
    ...(replacement?{replaceContent:true}:{}),
    placement: { ...fresh.placement, width: input.width, height: input.height },
    renderWidth, renderHeight,
    beforeWrite: () => {
      validateSource?.();
      if (figma.fileKey !== input.fileKey || figma.currentPage.id !== input.pageId || nodePage(result)?.id !== input.pageId ||
        nativeExpectedState(result, content) !== input.expected) {
        throw figmaError("CONFLICT", "reread the changed result before applying");
      }
    },
  });
  return inspect(input.nodeId, input.fileKey, input.pageId);
}

function effectState(result: RectangleNode, sources: Awaited<ReturnType<typeof mockupSources>>) {
  return linkedTaskState(result, sources, SHARED_EFFECT_DRAFT_KEY);
}

/** Read the published Spatial recipe and any explicit Agent draft. */
export async function inspectEffect(nodeId: string, fileKey: string, pageId: string) {
  if (figma.fileKey !== fileKey) throw figmaError("SCOPE", "granted file mismatch");
  const result = await figma.getNodeByIdAsync(nodeId);
  if (result?.type !== "RECTANGLE" || nodePage(result)?.id !== pageId || figma.currentPage.id !== pageId) {
    throw figmaError("SCOPE", "select a published Worldbend Spatial result on the granted page");
  }
  const task = readHandoffTask(result);
  const binding = readResultBinding(result);
  if (!isFigmaSpatialEffectTask(task) || !binding) {
    throw figmaError("STATE", "the selected node is not a published Worldbend Spatial result");
  }
  if (task.recipe.layers.length !== binding.sourceNodeIds.length) {
    throw figmaError("STATE", "Depth source roles no longer match the saved layers");
  }
  const before = JSON.stringify(linkedTaskStructure(result, SHARED_EFFECT_DRAFT_KEY));
  const sources = await mockupSources(binding.sourceNodeIds, pageId, task.recipe.viewport);
  if (figma.currentPage.id !== pageId || before !== JSON.stringify(linkedTaskStructure(result, SHARED_EFFECT_DRAFT_KEY))) {
    throw figmaError("CONFLICT", "Depth changed while its sources were read; inspect again");
  }
  const rawDraft = result.getSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY);
  const parsedDraft = rawDraft ? parseStoredEffectDraft(rawDraft) : undefined;
  if (rawDraft && (!parsedDraft || parsedDraft.baseRevision !== binding.revision)) {
    throw figmaError("STATE", "the staged Spatial draft is invalid or stale");
  }
  return {
    schema: "worldbend.figma.effect-handoff",
    version: "0.1",
    fileKey,
    pageId,
    nodeId,
    revision: binding.revision,
    task,
    published: result.fills !== figma.mixed && result.fills.some(fill => fill.type === "IMAGE" && !!fill.imageHash),
    sourceNodeIds: [...binding.sourceNodeIds],
    sources,
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
    ...(parsedDraft ? { draft: parsedDraft } : {}),
    expected: effectState(result, sources),
  };
}

/** Stage only semantic data. The Figma plugin renders and publishes it so
 * document pixels never claim a recipe that has not actually been drawn. */
export async function stageEffect(input: {
  fileKey: string;
  pageId: string;
  nodeId: string;
  expected: string;
  task: FigmaSpatialEffectTask;
  fingerprint: string;
}) {
  if (!isFigmaSpatialEffectTask(input.task) ||
    !/^sha256:[0-9a-f]{64}$/.test(input.fingerprint)) {
    throw figmaError("INPUT", "prepare a supported Spatial recipe through the canonical core");
  }
  const fresh = await inspectEffect(input.nodeId, input.fileKey, input.pageId);
  if (fresh.expected !== input.expected) throw figmaError("CONFLICT", "reread the changed result before staging");
  const result = await figma.getNodeByIdAsync(input.nodeId);
  if (result?.type !== "RECTANGLE" || figma.currentPage.id !== input.pageId ||
    input.task.recipe.layers.length !== fresh.sourceNodeIds.length || effectState(result, fresh.sources) !== input.expected) {
    throw figmaError("CONFLICT", "reread the changed result before staging");
  }
  const draft: StoredEffectDraft = {
    schema: "worldbend.figma.effect-draft",
    version: "0.1",
    baseRevision: fresh.revision,
    fingerprint: input.fingerprint,
    // The Figma MCP host does not expose structuredClone.
    task: JSON.parse(JSON.stringify(input.task)) as FigmaSpatialEffectTask,
  };
  result.setSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY, JSON.stringify(draft));
  return inspectEffect(input.nodeId, input.fileKey, input.pageId);
}

export function mockupSlots(task: FigmaCompositionTask, sourceCount: number) {
  if (sourceCount < 1 || sourceCount > 8) return false;
  const expected = new Set(Array.from({ length: sourceCount }, (_, index) => `source-${index + 1}`));
  const spec = compositionMockup(task);
  for (const plane of spec.planes) if (!expected.has(plane.sourceId)) return false;
  return expected.size === new Set(spec.planes.map((plane) => plane.sourceId)).size;
}

export async function captureMockupSources(sourceNodeIds: readonly string[], pageId: string, rasterSize?: { width: number; height: number } | "native") {
  const nodes = await Promise.all(sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)));
  if (!nodes.every((node) => node && nodePage(node) && nodePage(node)?.id === pageId &&
    "exportAsync" in node && "width" in node && "height" in node && Number.isFinite(node.width) && Number.isFinite(node.height) &&
    node.width > 0 && node.height > 0)) {
    throw figmaError("STATE", "Composition source unavailable");
  }
  return Promise.all(nodes.map(async (node, index) => {
    const source = node as SceneNode & { width: number; height: number; exportAsync(settings: ExportSettings): Promise<Uint8Array> };
    const preview = await captureSourceRaster(source, rasterSize);
    return { bytes: preview, source: {
      slotId: `source-${index + 1}`,
      nodeId: source.id,
      name: Array.from(source.name).slice(0, 128).join(""),
      width: source.width,
      height: source.height,
      previewFingerprint: byteFingerprint(preview),
    } };
  }));
}

export async function mockupSources(sourceNodeIds: readonly string[], pageId: string, rasterSize?: { width: number; height: number } | "native") {
  return (await captureMockupSources(sourceNodeIds, pageId, rasterSize)).map(capture => capture.source);
}

/** Return the exact single capture whose byte proof appears in the snapshot. */
export function exportCapturedSources(nodeId: string, captures: Awaited<ReturnType<typeof captureMockupSources>>, transport: "inline" | "artifact"):
  Array<{slotId:string;nodeId:string;width:number;height:number;base64?:string;artifact?:{name:string;mimeType:string;bytes:number}}> {
  const io = (figma as unknown as { io?: { write(name: string, bytes: Uint8Array): void } }).io;
  if (transport === "artifact" && typeof io?.write !== "function") throw figmaError("ARTIFACT", "this Figma interface cannot return image artifacts; use inline transport only for small sources");
  // Validate every PNG before emitting the first artifact; retain slot order.
  const rasters = captures.map(({bytes,source}) => ({bytes,...pngRasterDimensions(bytes),slotId:source.slotId,nodeId:source.nodeId}));
  return rasters.map(({bytes,...raster}) => {
    if (transport === "inline") return {...raster,base64:base64Bytes(bytes)};
    const artifact={name:`worldbend-${nodeId.replace(/[^a-zA-Z0-9-]/g,"-")}-${raster.slotId}.png`,mimeType:"image/png",bytes:bytes.length};
    io!.write(artifact.name,bytes);
    return {...raster,artifact};
  });
}

export interface EffectSourceSet {
  schema: "worldbend.figma.effect-sources";
  version: "0.1";
  fileKey: string;
  pageId: string;
  nodeId: string;
  revision: number;
  resultExpected: string;
  sourceNodeIds: string[];
  sources: Awaited<ReturnType<typeof mockupSources>>;
}

/** Guard both native containment and linked dependencies. Reading source pixels
 * must not admit a result as its own future input, directly or through a Frame. */
export async function effectSourceGraph(sourceNodeIds: readonly string[], fileKey: string, pageId: string, targetNodeId: string, minimum = 2) {
  if (sourceNodeIds.length < minimum || sourceNodeIds.length > 8 || new Set(sourceNodeIds).size !== sourceNodeIds.length ||
    !sourceNodeIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256)) {
    throw figmaError("INPUT", "invalid source identities");
  }
  const pending = sourceNodeIds.map(id => ({ id, depth: 0 }));
  const seen = new Set<string>();
  const stamps: Array<{ node: BaseNode; state: string }> = [];
  const assertScope = () => {
    if (figma.fileKey !== fileKey || figma.currentPage.id !== pageId) throw figmaError("SCOPE", "source page changed");
  };
  let stateBytes = 0;
  const stamp = (node: BaseNode) => {
    if (!("visible" in node)) throw figmaError("STATE", "dependency is not artwork");
    return nativeNodeSnapshot(node as SceneNode);
  };
  while (pending.length) {
    const item = pending.pop()!;
    if (item.id === targetNodeId) throw figmaError("CYCLE", "source depends on result");
    if (seen.has(item.id)) continue;
    if (seen.size >= 20000 || item.depth > 64) throw figmaError("LIMIT", "sources exceed 20000 nodes / 64 levels");
    seen.add(item.id);
    assertScope();
    const node = await figma.getNodeByIdAsync(item.id);
    assertScope();
    if (!node || node.removed || nodePage(node)?.id !== pageId) throw figmaError("STATE", "source dependency unavailable");
    const state = stamp(node); stateBytes += state.length * 2;
    if (stateBytes > 16 * 1024 * 1024) throw figmaError("LIMIT", "source state exceeds 16 MiB");
    stamps.push({ node, state });
    const dependencies = [...("children" in node ? (node as ChildrenMixin).children.map(child => child.id) : []),
      ...(readResultBinding(node)?.sourceNodeIds ?? [])];
    if (seen.size + pending.length + dependencies.length > 20000) throw figmaError("LIMIT", "sources exceed 20000 nodes");
    pending.push(...dependencies.map(id => ({ id, depth: item.depth + 1 })));
  }
  return Object.assign(() => {
    assertScope();
    if (stamps.some(({ node, state }) => node.removed || stamp(node) !== state)) {
      throw figmaError("CONFLICT", "sources changed; inspect again");
    }
  }, { fingerprint: sceneSourcesFingerprint(sourceNodeIds, stamps), states: stamps });
}

/** A read-only proposal: publishing is the only operation that changes binding. */
export async function inspectEffectSources(input: {
  fileKey: string; pageId: string; nodeId: string; expected: string; revision: number;
  sourceNodeIds: string[]; includeSourceRasters?: boolean; sourceRasterTransport?: "inline" | "artifact";
}) {
  const snapshot = await inspectEffect(input.nodeId, input.fileKey, input.pageId);
  if (snapshot.expected !== input.expected || snapshot.revision !== input.revision) {
    throw figmaError("CONFLICT", "reread the changed Depth result before choosing sources");
  }
  const result = await figma.getNodeByIdAsync(input.nodeId);
  const validateSources = await effectSourceGraph(input.sourceNodeIds, input.fileKey, input.pageId, input.nodeId);
  const sources = await mockupSources(input.sourceNodeIds, input.pageId, snapshot.task.recipe.viewport);
  const validate = () => {
    validateSources();
    if (figma.fileKey !== input.fileKey || result?.type !== "RECTANGLE" || result.removed ||
      effectState(result, snapshot.sources) !== input.expected) {
      throw figmaError("CONFLICT", "Depth changed while choosing sources; inspect again");
    }
  };
  validate();
  const sourceSet: EffectSourceSet = { schema: "worldbend.figma.effect-sources", version: "0.1",
    fileKey: input.fileKey, pageId: input.pageId, nodeId: input.nodeId, revision: snapshot.revision,
    resultExpected: snapshot.expected, sourceNodeIds: [...input.sourceNodeIds], sources };
  const viewport = snapshot.task.recipe.viewport;
  const sourceRasters = input.includeSourceRasters ? await exportBoundSources(input.nodeId, input.pageId,
    viewport.width, viewport.height, input.sourceRasterTransport, { sources, validate }, input.sourceNodeIds) : undefined;
  return { ...snapshot, sourceSet, ...(sourceRasters ? { sourceRasters } : {}) };
}

export function byteFingerprint(bytes: Uint8Array): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    left = Math.imul(left ^ value, 0x01000193) >>> 0;
    right = Math.imul(right ^ (value + index), 0x85ebca6b) >>> 0;
  }
  return `preview32x2:${bytes.length}:${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

function mockupState(result: RectangleNode, sources: Awaited<ReturnType<typeof mockupSources>>) {
  return linkedTaskState(result, sources, SHARED_MOCKUP_DRAFT_KEY);
}

function linkedTaskState(result: RectangleNode, sources: Awaited<ReturnType<typeof mockupSources>>, draftKey: string) {
  const state = JSON.stringify({
    ...linkedTaskStructure(result, draftKey),
    sources: sources.map(({ nodeId, width, height, previewFingerprint }) => ({ nodeId, width, height, previewFingerprint })),
  });
  return boundedStateFingerprint(state);
}

function linkedTaskStructure(result: RectangleNode, draftKey: string) {
  return {
    parentNodeId: result.parent?.id,
    operationSlots:readStoredOperationSlots(result),
    binding: result.getSharedPluginData(SHARED_NAMESPACE, "binding"),
    draft: result.getSharedPluginData(SHARED_NAMESPACE, draftKey),
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
    fills: result.fills === figma.mixed ? "mixed" : result.fills,
  };
}

export function boundedStateFingerprint(state: string) {
  // The same state can contain both published and staged eight-plane specs.
  // Keep the Agent packet bounded while hashing every state character at the write edge.
  return fingerprintState(state);
}

/** Inspect the actual Composition result and ordered Figma source bindings. */
export async function inspectMockup(nodeId: string, fileKey: string, pageId: string) {
  if (figma.fileKey !== fileKey) throw figmaError("SCOPE", "granted file mismatch");
  const result = await figma.getNodeByIdAsync(nodeId);
  if (result?.type !== "RECTANGLE" || nodePage(result)?.id !== pageId || figma.currentPage.id !== pageId) {
    throw figmaError("SCOPE", "choose Composition here");
  }
  const task = readHandoffTask(result);
  const binding = readResultBinding(result);
  if (!isFigmaCompositionTask(task) || !binding || !mockupSlots(task, binding.sourceNodeIds.length)) {
    throw figmaError("STATE", "choose linked Composition");
  }
  const before = JSON.stringify(linkedTaskStructure(result, SHARED_MOCKUP_DRAFT_KEY));
  const sources = await mockupSources(binding.sourceNodeIds, pageId, { width: binding.renderWidth, height: binding.renderHeight });
  if (figma.currentPage.id !== pageId || before !== JSON.stringify(linkedTaskStructure(result, SHARED_MOCKUP_DRAFT_KEY))) {
    throw figmaError("CONFLICT", "reread changed Composition");
  }
  const rawDraft = result.getSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY);
  const draft = rawDraft ? parseStoredMockupDraft(rawDraft) : undefined;
  const usableDraft = draft && draft.baseRevision === binding.revision &&
    mockupSlots(draft.task, binding.sourceNodeIds.length) ? draft : undefined;
  return {
    schema: "worldbend.figma.mockup-handoff", version: "0.1",
    fileKey, pageId, nodeId, revision: binding.revision,
    task, sourceNodeIds: [...binding.sourceNodeIds], sources,
    placement: { x: result.x, y: result.y, width: result.width, height: result.height },
    ...(usableDraft ? { draft: usableDraft } : {}),
    ...(rawDraft && !usableDraft ? { draftIssue: "invalid-or-stale" as const } : {}),
    expected: mockupState(result, sources),
  };
}

/** Stage only geometry; the plugin renders current Figma sources before publishing. */
export async function stageMockup(input: {
  fileKey: string; pageId: string; nodeId: string; expected: string;
  task: FigmaCompositionTask;
}) {
  if (!isFigmaCompositionTask(input.task)) {
    throw figmaError("INPUT", "invalid Composition task");
  }
  const fresh = await inspectMockup(input.nodeId, input.fileKey, input.pageId);
  if (!mockupSlots(input.task, fresh.sourceNodeIds.length)) {
    throw figmaError("INPUT", "Composition source slots must match the linked Figma sources");
  }
  if (fresh.expected !== input.expected) {
    throw figmaError("CONFLICT", "reread the changed Composition result before staging");
  }
  const result = await figma.getNodeByIdAsync(input.nodeId);
  const binding = result && readResultBinding(result);
  if (!binding) throw figmaError("STATE", "Composition binding unavailable");
  const sources = await mockupSources(fresh.sourceNodeIds, input.pageId, { width: binding.renderWidth, height: binding.renderHeight });
  if (result?.type !== "RECTANGLE" || mockupState(result, sources) !== input.expected) {
    throw figmaError("CONFLICT", "reread the changed Composition result before staging");
  }
  const draft: StoredMockupDraft = {
    schema: "worldbend.figma.mockup-draft", version: "0.1",
    baseRevision: fresh.revision, task: JSON.parse(JSON.stringify(input.task)) as StoredMockupDraft["task"],
  };
  result.setSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY, JSON.stringify(draft));
  return inspectMockup(input.nodeId, input.fileKey, input.pageId);
}

/** Discover the client's reusable scene templates with their slot and
 * appearance boundaries, so an Agent can choose a scene and its sources
 * without development-source knowledge. Read-only: never writes the file. */
export async function inspectTemplates(fileKey: string) {
  if (figma.fileKey !== fileKey) {
    throw figmaError("SCOPE", "granted file mismatch");
  }
  let clientLibrary: "readable" | "unavailable" | "unreadable" = "readable";
  let summaries: ReturnType<typeof templateLibrarySummary>;
  try {
    summaries = templateLibrarySummary(await figma.clientStorage.getAsync("worldbend.spatial-templates.v1"));
    if (!summaries) clientLibrary = "unreadable";
  } catch { clientLibrary = "unavailable"; }
  if (figma.fileKey !== fileKey) throw figmaError("SCOPE", "the granted file changed during discovery");
  const native = await discoverFileNativeTemplates(result => {
    const task = readHandoffTask(result), binding = readResultBinding(result);
    return isFigmaCompositionTask(task) && binding && mockupSlots(task, binding.sourceNodeIds.length) ? task : undefined;
  });
  // Client-local geometry templates remain useful. Native entries must resolve
  // to this file's marked master; its current task/slots take precedence over
  // a stale client cache. A reference from another file is never advertised
  // as a usable scene merely because its local node ID happens to collide.
  const templates = (summaries ?? []).filter(summary => !summary.nativeScene);
  for (const scene of native.templates) {
    const cached = summaries?.find(summary => summary.nativeScene?.sceneId === scene.nativeScene?.sceneId &&
      summary.nativeScene?.rootNodeId === scene.nativeScene?.rootNodeId);
    templates.push({ ...cached, ...scene });
  }
  if (figma.fileKey !== fileKey) throw figmaError("SCOPE", "the granted file changed during discovery");
  return {
    schema: "worldbend.figma.template-library-handoff",
    version: "0.1",
    fileKey,
    templates,
    readyScenes: readySceneRecords().map(record => ({ id: record.id, name: record.name, readyScene: record.readyScene,
      kind: "mockup", sourceCount: 1, slots: record.slots, appearance: record.appearance,
      provenance: { kind: "first-party", license: "Apache-2.0" } })),
    discovery: { clientLibrary, ...native.scan,
      ...(summaries ? { unresolvedClientSceneCount: summaries.filter(summary => summary.nativeScene &&
        !native.templates.some(scene => scene.nativeScene?.sceneId === summary.nativeScene?.sceneId &&
          scene.nativeScene?.rootNodeId === summary.nativeScene?.rootNodeId)).length } : {}) },
  };
}

/** Base64 of exported bytes, ASCII-safe for the prepared-request packet. */
function base64Bytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Publish rendered pixels onto one linked result in place. The caller
 * supplies bytes rendered by the shared core renderer from a snapshot this
 * runtime re-verifies through `reinspect`: scope, live expected state and
 * revision must all still match, or nothing is written. Task publication clears
 * its draft; an unchanged Depth refresh retains the pending recipe edits. */
export async function publishResultImage<Snapshot>(
  input: {
    fileKey: string; pageId: string; nodeId: string;
    expected: string; revision: number;
    renderWidth: number; renderHeight: number; imageBase64: string; draftKey?: string;
    task?: FigmaCompositionTask | FigmaSpatialEffectTask | FigmaDeformationTask;
    sourceNodeIds?: string[];
    preserveDraft?: boolean;
  },
  reinspect: () => Promise<Snapshot & { revision: number; expected: string }>,
  guard: (result: RectangleNode, fresh: Snapshot) => void,
  prepareSources?: () => Promise<void>,
  afterWrite?: (result: RectangleNode) => Snapshot,
  writeProof?: (result: RectangleNode) => void,
  validatePublication?: () => void,
): Promise<Snapshot> {
  validatePublication?.();
  if (!isFigmaImageAxis(input.renderWidth) || !isFigmaImageAxis(input.renderHeight)) {
    throw figmaError("INPUT", "invalid raster size");
  }
  if (figma.fileKey !== input.fileKey) {
    throw figmaError("SCOPE", "granted file mismatch");
  }
  const result = await figma.getNodeByIdAsync(input.nodeId);
  validatePublication?.();
  const fresh = await reinspect();
  validatePublication?.();
  if (fresh.revision !== input.revision || fresh.expected !== input.expected) {
    throw figmaError("CONFLICT", "result changed; reread");
  }
  if (!result || result.removed || result.type !== "RECTANGLE" || nodePage(result)?.id !== input.pageId) {
    throw figmaError("CONFLICT", "result unavailable");
  }
  const binding = readResultBinding(result);
  if (!binding || binding.revision !== input.revision) {
    throw figmaError("CONFLICT", "binding changed; reread");
  }
  if (prepareSources) await prepareSources();
  validatePublication?.();
  const image = figma.createImage(base64ToBytes(input.imageBase64));
  // Recheck synchronously after the last host await, before any document write.
  guard(result, fresh);
  validatePublication?.();
  if (!rasterPaintsIntact(result)) throw figmaError("STATE", "result image fill was edited; preserve it and create a new result");
  const priorPaintProof = result.getSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY);
  const priorFills = result.fills;
  if (priorFills === figma.mixed) throw figmaError("STATE", "mixed result fills");
  const priorSlots = readStoredOperationSlots(result);
  const priorBinding = result.getSharedPluginData(SHARED_NAMESPACE, "binding");
  const priorGeometry = {x:result.x,y:result.y,width:result.width,height:result.height,
    matrix:result.relativeTransform?.map(row=>[...row]) as Transform|undefined};
  let ownsCreation=false;
  try {ownsCreation=JSON.parse(result.getSharedPluginData(SHARED_NAMESPACE,"workCreation")||"null")?.nodeId===result.id;} catch { /* not an owned cold creation */ }
  const priorSceneProof = result.getSharedPluginData(SHARED_NAMESPACE, "sceneReadProof");
  const priorDraft = input.draftKey ? result.getSharedPluginData(SHARED_NAMESPACE, input.draftKey) : "";
  const nextDraft = input.preserveDraft && priorDraft
    ? JSON.stringify({ ...JSON.parse(priorDraft), baseRevision: binding.revision + 1 })
    : "";
  // FILL matches the plugin's own publication: the rendered raster carries the
  // result's aspect, and a designer-resized node must crop, not letterbox.
  try {
    result.fills = [{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash }];
    if (input.task) writeStoredOperation(result, { kind: "task", task: input.task });
    // Shared binding owns raster size across plugin and external-Agent edits;
    // the external host cannot update another plugin's private data.
    writeStoredBinding(result, {
      sourceNodeIds: input.sourceNodeIds ?? binding.sourceNodeIds,
      renderWidth: input.renderWidth,
      renderHeight: input.renderHeight,
    });
    writeRasterPaintProof(result);
    if (input.draftKey) result.setSharedPluginData(SHARED_NAMESPACE, input.draftKey, nextDraft);
    writeProof?.(result);
    // An empty cold-created Canvas only had a provisional viewport. Once the
    // core resolves its actual size, keep the proposed position when free and
    // clear adjacent content before delivering its first image. Existing and
    // reparented work retains the designer's placement.
    if (binding.revision===1 && priorFills.length===0 && result.parent?.id===figma.currentPage.id &&
      (result.rotation??0)===0 && (result.width!==priorGeometry.width||result.height!==priorGeometry.height) &&
      ownsCreation) {
      if(figma.currentPage.children.length>20000) throw figmaError("LIMIT","placement exceeds 20000 nodes");
      const obstacles=figma.currentPage.children.filter(n=>n.id!==result.id&&n.visible&&!n.removed)
        .map(n=>n.absoluteBoundingBox).filter((b):b is Rect=>!!b&&Object.values(b).every(Number.isFinite)&&b.width>0&&b.height>0);
      const placed=placementBeside([{x:result.x-RESULT_PLACEMENT_GAP,y:result.y,width:0,height:0}],
        {width:result.width,height:result.height},obstacles);
      result.x=placed.x;result.y=placed.y;
    }
  } catch (error) {
    try {
      if(result.width!==priorGeometry.width||result.height!==priorGeometry.height) result.resize(priorGeometry.width,priorGeometry.height);
      result.x=priorGeometry.x;result.y=priorGeometry.y;
      if(priorGeometry.matrix)result.relativeTransform=priorGeometry.matrix;
      result.fills = priorFills;
      restoreStoredOperationSlots(result, priorSlots);
      result.setSharedPluginData(SHARED_NAMESPACE, "binding", priorBinding);
      result.setSharedPluginData(SHARED_NAMESPACE, "sceneReadProof", priorSceneProof);
      result.setSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY, priorPaintProof);
      if (input.draftKey) result.setSharedPluginData(SHARED_NAMESPACE, input.draftKey, priorDraft);
    } catch {
      throw figmaError("STATE", "rollback incomplete; inspect result");
    }
    throw error;
  }
  return afterWrite ? afterWrite(result) : reinspect();
}

/** Publish core-rendered pixels onto the linked Composition result. */
export async function publishMockupImage(input: {
  fileKey: string; pageId: string; nodeId: string;
  expected: string; revision: number;
  renderWidth: number; renderHeight: number; imageBase64: string;
  task: FigmaCompositionTask;
}, validatePublication?:()=>void) {
  if (!isFigmaCompositionTask(input.task)) {
    throw figmaError("INPUT", "invalid Composition task");
  }
  let validateSources: Awaited<ReturnType<typeof effectSourceGraph>> | undefined;
  return publishResultImage(
    { ...input, draftKey: SHARED_MOCKUP_DRAFT_KEY },
    () => inspectMockup(input.nodeId, input.fileKey, input.pageId),
    (result, fresh) => {
      validateSources?.();
      if (!mockupSlots(input.task, fresh.sourceNodeIds.length)) {
        throw figmaError("INPUT", "Composition source slots must match the linked Figma sources");
      }
      if (figma.currentPage.id !== input.pageId || mockupState(result, fresh.sources) !== input.expected) {
        throw figmaError("CONFLICT", "reread the changed Composition result before publishing");
      }
    }, async () => {
      const result = await figma.getNodeByIdAsync(input.nodeId), binding = result && readResultBinding(result);
      if (!binding) throw figmaError("STATE", "Composition binding unavailable");
      validateSources = await effectSourceGraph(binding.sourceNodeIds, input.fileKey, input.pageId, input.nodeId, 1);
      const current = await inspectMockup(input.nodeId, input.fileKey, input.pageId);
      if (current.expected !== input.expected || current.revision !== input.revision) throw figmaError("CONFLICT", "reread changed Composition");
      validateSources();
    },
    undefined, result => writeSceneReadProof(result, validateSources!.fingerprint),validatePublication,
  );
}

/** Publish core-rendered pixels onto the linked Spatial (Depth) result. */
export async function publishEffectImage(input: {
  fileKey: string; pageId: string; nodeId: string;
  expected: string; revision: number;
  renderWidth: number; renderHeight: number; imageBase64: string;
  task?: FigmaSpatialEffectTask;
  sourceNodeIds?: string[];
  sourceSet?: EffectSourceSet;
}, validatePublication?:()=>void) {
  if ((input.task !== undefined && (!isFigmaSpatialEffectTask(input.task) ||
    input.task.recipe.viewport.width !== input.renderWidth || input.task.recipe.viewport.height !== input.renderHeight)) ||
    (input.sourceNodeIds !== undefined && input.task === undefined)) {
    throw figmaError("INPUT", "invalid Depth publication task");
  }
  let validateSources: (() => void) | undefined;
  return publishResultImage(
    // An unchanged refresh retains pending edits; an explicit task publication
    // accepts its exact rendered recipe and source roles and clears the draft.
    { ...input, ...(input.sourceSet && !input.sourceNodeIds ? { sourceNodeIds: input.sourceSet.sourceNodeIds } : {}),
      draftKey: SHARED_EFFECT_DRAFT_KEY, preserveDraft: input.task === undefined },
    () => inspectEffect(input.nodeId, input.fileKey, input.pageId),
    (result, fresh) => {
      const order = input.sourceNodeIds ?? input.sourceSet?.sourceNodeIds ?? fresh.sourceNodeIds;
      const available = input.sourceSet?.sourceNodeIds ?? fresh.sourceNodeIds;
      if (order.length !== available.length || new Set(order).size !== order.length ||
        !order.every(id => available.includes(id)) ||
        (input.task && input.task.recipe.layers.length !== order.length)) {
        throw figmaError("INPUT", "Depth roles must use every bound source exactly once");
      }
      validateSources?.();
      if (figma.currentPage.id !== input.pageId || effectState(result, fresh.sources) !== input.expected) {
        throw figmaError("CONFLICT", "reread the changed Depth result before publishing");
      }
    },
    input.sourceSet ? async () => {
      const set = input.sourceSet!;
      if (set.schema !== "worldbend.figma.effect-sources" || set.version !== "0.1" ||
        set.fileKey !== input.fileKey || set.pageId !== input.pageId || set.nodeId !== input.nodeId ||
        set.resultExpected !== input.expected || set.revision !== input.revision || !input.task) {
        throw figmaError("INPUT", "source proposal must belong to this inspected Depth result");
      }
      validateSources = await effectSourceGraph(set.sourceNodeIds, input.fileKey, input.pageId, input.nodeId);
      const current = await figma.getNodeByIdAsync(input.nodeId);
      if (!current || current.removed || current.type !== "RECTANGLE") throw figmaError("CONFLICT", "Depth result is no longer available");
      const currentTask = readHandoffTask(current);
      if (!isFigmaSpatialEffectTask(currentTask)) throw figmaError("CONFLICT", "Depth task is no longer available");
      const sources = await mockupSources(set.sourceNodeIds, input.pageId, currentTask.recipe.viewport);
      if (sources.length !== set.sources.length || sources.some((source, index) => {
        const expected = set.sources[index];
        return !expected || source.nodeId !== expected.nodeId || source.width !== expected.width ||
          source.height !== expected.height || source.previewFingerprint !== expected.previewFingerprint;
      })) throw figmaError("CONFLICT", "chosen Depth sources changed; inspect again");
      validateSources();
    } : undefined,undefined,undefined,validatePublication,
  );
}

/** Export every bound source of one linked result, keyed by slot id. */
export async function exportBoundSources(
  nodeId: string,
  pageId: string,
  renderWidth: number,
  renderHeight: number,
  transport: "inline" | "artifact" = "inline",
  expected?: { sources: Array<{ nodeId: string; previewFingerprint: string }>; validate(): void },
  sourceNodeIds?: readonly string[],
  capture?: "native",
): Promise<Array<{ slotId: string; nodeId: string; width: number; height: number; base64?: string;
  artifact?: { name: string; mimeType: string; bytes: number } }>> {
  const io = (figma as unknown as { io?: { write(name: string, bytes: Uint8Array): void } }).io;
  if (transport === "artifact" && typeof io?.write !== "function") {
    throw figmaError("ARTIFACT", "this Figma interface cannot return image artifacts; use inline transport only for small sources");
  }
  const result = await figma.getNodeByIdAsync(nodeId);
  const binding = result && result.type === "RECTANGLE" ? readResultBinding(result) : undefined;
  if (!binding) throw figmaError("STATE", "the linked result lost its binding");
  const nodes = await Promise.all((sourceNodeIds ?? binding.sourceNodeIds).map((id) => figma.getNodeByIdAsync(id)));
  const rasterPromises = nodes.map(async (node, index) => {
    if (!node || nodePage(node)?.id !== pageId || !("exportAsync" in node) ||
      !("width" in node) || !("height" in node) ||
      !Number.isFinite(node.width) || node.width <= 0 ||
      !Number.isFinite(node.height) || node.height <= 0) {
      throw figmaError("STATE", "linked source unavailable");
    }
    const source = node as SceneNode & { width: number; height: number; exportAsync(settings: ExportSettings): Promise<Uint8Array> };
    const bytes = await captureSourceRaster(source, capture ?? { width: renderWidth, height: renderHeight });
    const name = `worldbend-${nodeId.replace(/[^a-zA-Z0-9-]/g, "-")}-source-${index + 1}.png`;
    return {
      bytes,
      slotId: `source-${index + 1}`,
      nodeId: source.id,
      ...(transport === "artifact" ? { artifact: { name, mimeType: "image/png", bytes: bytes.length } } : { base64: base64Bytes(bytes) }),
    };
  });
  const rasters = await Promise.all(rasterPromises);
  if (expected) {
    if (rasters.length !== expected.sources.length || rasters.some((raster, index) =>
      raster.nodeId !== expected.sources[index]!.nodeId || byteFingerprint(raster.bytes) !== expected.sources[index]!.previewFingerprint)) {
      throw figmaError("CONFLICT", "Depth sources changed during raster export; inspect again");
    }
    expected.validate();
  }
  // The Figma response carries ordered image blocks without a filename on
  // each block. Emit them in slot order, regardless of async export timing;
  // the result screenshot follows all source artifacts.
  const sized = rasters.map(raster => ({ ...raster, ...pngRasterDimensions(raster.bytes) }));
  return sized.map(({ bytes, ...raster }) => {
    if ("artifact" in raster) io!.write(raster.artifact.name, bytes);
    return raster;
  });
}

function pngRasterDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) ||
    ![73,72,68,82].every((value,index) => bytes[index + 12] === value)) {
    throw figmaError("RASTER", "invalid exported PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height) throw figmaError("RASTER", "empty exported PNG");
  return { width, height };
}

export function assertRasterSize(encoded: string, width: number, height: number) {
  const size=pngRasterDimensions(base64ToBytes(encoded));
  if(size.width!==width || size.height!==height) throw figmaError("RASTER", "PNG dimensions differ from resolved Canvas");
}

function boundSourceScale(source: { width: number; height: number }, width: number, height: number): number {
  return Math.min(4096 / Math.max(source.width, source.height), Math.max(width / source.width, height / source.height));
}

async function captureSourceRaster(source: SceneNode & { width: number; height: number }, size?: { width: number; height: number } | "native"): Promise<Uint8Array> {
  const box = sourceRasterViewBox(source), dimensions = box ?? source;
  if (size === "native" && Math.max(dimensions.width, dimensions.height) > 4096) {
    throw figmaError("LIMIT", "Canvas source exceeds 4096 px at 1x");
  }
  const scale = size === "native" ? 1 : size ? boundSourceScale(dimensions, size.width, size.height)
    : Math.min(1, 256 / Math.max(dimensions.width, dimensions.height));
  const bytes = await source.exportAsync({ format: "PNG", ...sourceRasterBounds(source), constraint: { type: "SCALE", value: scale } });
  if (box && !sameSourceRasterViewBox(source, box)) throw figmaError("CONFLICT", "Source raster bounds changed during export; inspect again");
  return bytes;
}

/** Export every bound source at the result's stored raster size so the Agent
 * can render the full publication through the shared core renderer. */
export async function inspectMockupWithSources(nodeId: string, fileKey: string, pageId: string, transport: "inline" | "artifact" = "inline") {
  const snapshot = await inspectMockup(nodeId, fileKey, pageId);
  const result = await figma.getNodeByIdAsync(nodeId);
  const binding = result && result.type === "RECTANGLE" ? readResultBinding(result) : undefined;
  if (!binding) throw figmaError("STATE", "the Composition result lost its binding");
  const sourceRasters = await exportBoundSources(
    nodeId, pageId, binding.renderWidth, binding.renderHeight, transport, { sources: snapshot.sources, validate() {
      if (result?.type !== "RECTANGLE" || result.removed || figma.fileKey !== fileKey || figma.currentPage.id !== pageId ||
        mockupState(result, snapshot.sources) !== snapshot.expected) throw figmaError("CONFLICT", "Composition changed during export");
    } });
  return { ...snapshot, sourceRasters };
}

/** Depth variant: export the ordered recipe-layer sources at viewport scale. */
export async function inspectEffectWithSources(nodeId: string, fileKey: string, pageId: string, transport: "inline" | "artifact" = "inline") {
  const snapshot = await inspectEffect(nodeId, fileKey, pageId);
  const result = await figma.getNodeByIdAsync(nodeId);
  const validate = () => {
    if (result?.type !== "RECTANGLE" || result.removed || figma.currentPage.id !== pageId ||
      effectState(result, snapshot.sources) !== snapshot.expected) {
      throw figmaError("CONFLICT", "Depth changed during raster export; inspect again");
    }
  };
  validate();
  const viewport = snapshot.task.recipe.viewport;
  const sourceRasters = await exportBoundSources(
    nodeId, pageId, Math.round(viewport.width), Math.round(viewport.height), transport, { sources: snapshot.sources, validate });
  return { ...snapshot, sourceRasters };
}

/** Native Effects are readable and editable without a Worldbend plugin UI. */
export async function inspectAppearance(nodeId: string, fileKey: string, pageId: string) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (figma.fileKey !== fileKey || !node || !("visible" in node) || nodePage(node)?.id !== pageId || figma.currentPage.id !== pageId) throw figmaError("SCOPE", "select a live layer on the granted page");
  const snapshot = appearanceNodeSnapshot(node);
  if (!snapshot.eligible) throw new Error(`E_FIGMA_STATE: ${snapshot.reason}`);
  const expected = appearanceExpectedState(node);
  return { schema: "worldbend.figma.appearance-handoff", version: "0.1", fileKey, pageId, ...snapshot, previewNodeId: appearancePreviewContext(node).id, placement: { x: node.x, y: node.y, width: node.width, height: node.height }, expected };
}

export async function applyAppearance(input: { fileKey: string; pageId: string; nodeId: string; expected: string; recipe: AppearanceRecipeWire; material?: GlassMaterialWire; fields?: GlassWireField[]; retainUntagged?: boolean }) {
  if (!isAppearanceRecipeWire(input.recipe)) throw figmaError("INPUT", "invalid appearance recipe");
  const before = await inspectAppearance(input.nodeId, input.fileKey, input.pageId);
  if (before.expected !== input.expected) throw figmaError("CONFLICT", "native appearance changed; reread before applying");
  const node = await figma.getNodeByIdAsync(input.nodeId);
  if (!node || !("visible" in node)) throw figmaError("STATE", "target removed");
  // The second host await can admit a native edit or a page switch. Recheck
  // immediately before the synchronous write, not only before resolving it.
  if (figma.currentPage.id !== input.pageId || appearanceExpectedState(node) !== input.expected) throw figmaError("CONFLICT", "native appearance changed; reread before applying");
  const result = applyAppearanceToNodes([node], input.recipe, input.material, input.fields, input.retainUntagged);
  if (!result.ok) throw new Error(`E_FIGMA_STATE: ${result.error}`);
  if (result.outcomes[0]?.outcome !== "applied") throw figmaError("STATE", "target not updated");
  return inspectAppearance(input.nodeId, input.fileKey, input.pageId);
}

/** The native texture family shares the appearance handoff semantics. */
export async function inspectTexture(nodeId: string, fileKey: string, pageId: string) {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (figma.fileKey !== fileKey || !node || !("visible" in node) || nodePage(node)?.id !== pageId || figma.currentPage.id !== pageId) throw figmaError("SCOPE", "select a live layer on the granted page");
  const snapshot = textureNodeSnapshot(node);
  if (!snapshot.eligible) throw new Error(`E_FIGMA_STATE: ${snapshot.reason}`);
  const expected = textureExpectedState(node);
  return { schema: "worldbend.figma.texture-handoff", version: "0.1", fileKey, pageId, ...snapshot, previewNodeId: appearancePreviewContext(node).id, placement: { x: node.x, y: node.y, width: node.width, height: node.height }, expected };
}

export async function applyTexture(input: { fileKey: string; pageId: string; nodeId: string; expected: string; recipe: TextureRecipeWire; material?: TextureMaterialWire; fields?: TextureWireField[]; retainUntagged?: boolean }) {
  if (!isTextureRecipeWire(input.recipe)) throw figmaError("INPUT", "invalid texture recipe");
  const before = await inspectTexture(input.nodeId, input.fileKey, input.pageId);
  if (before.expected !== input.expected) throw figmaError("CONFLICT", "native texture changed; reread before applying");
  const node = await figma.getNodeByIdAsync(input.nodeId);
  if (!node || !("visible" in node)) throw figmaError("STATE", "target removed");
  // The second host await can admit a native edit or a page switch. Recheck
  // immediately before the synchronous write, not only before resolving it.
  if (figma.currentPage.id !== input.pageId || textureExpectedState(node) !== input.expected) throw figmaError("CONFLICT", "native texture changed; reread before applying");
  const result = applyTextureToNodes([node], input.recipe, input.material, input.fields, input.retainUntagged);
  if (!result.ok) throw new Error(`E_FIGMA_STATE: ${result.error}`);
  if (result.outcomes[0]?.outcome !== "applied") throw figmaError("STATE", "target not updated");
  return inspectTexture(input.nodeId, input.fileKey, input.pageId);
}
