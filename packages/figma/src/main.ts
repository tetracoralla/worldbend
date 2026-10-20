import {changeRasterCanvas,type RasterCanvasChange} from "./raster-canvas-change";
import { componentNativeTopology, componentNativeParts, componentNativeMotionParts, componentNativeSourceOwner, showComponentNativeSource } from "./native-component";
import { nativeCaptureSnapshot, nativeCaptureFacts } from "./source-capture";
import {nativeVectorSourceViewMatches,retainedNativeVectorSourceView,currentNativeVectorSourceView} from "./source-raster";
import {resolveNativeVectorOperation,nativeVectorOperationDigest,guideIndependentNativeVectorDigest} from "./native-vector-operation";
import {nativePlacementSelection,NATIVE_PLACEMENT_KEY} from "./native-copy-placement";
import {vectorSourcesProof,vectorValue} from "./agent-vector-proof";
import {nativeVectorSourceView} from "./source-raster";
import type {FigmaCompositionTask} from "./stored-designer-task";
import {beginNativeSceneAnimation,sceneAnimationAuthoringResult} from "./native-scene-animation";
import { FoilNativeReadContext } from './foil-native-read';
import { foilNodeSnapshot, foilNodeSnapshotFresh } from './foil-material';
import type { FoilNodeSnapshot } from './foil-material-wire';
import { MeshGradientNativeReadContext } from './mesh-gradient-native-read';
import { meshGradientNodeSnapshot, meshGradientNodeSnapshotFresh } from './mesh-gradient-material';
import type { MeshGradientNodeSnapshot } from './mesh-gradient-material-wire';
import { captureRasterPaints, rasterPaintsIntact, rasterPaintsMatch, SHARED_RASTER_PAINT_KEY, writeRasterPaintProof } from "./raster-paint-guard";
import { sameSourceRasterViewBox, sourceRasterBounds, sourceRasterViewBox } from "./source-raster";
import { normalizedDocumentShape } from "./native-shape";
import { deformationArtworkIndex, deformationTaskSourceCount } from "./stored-designer-task";
import { canSaveNativeScene, copyNativeScene, nativeSceneForResult } from "./native-scene-main";
import { parseNativeSceneTemplateMarker } from "./native-scene-model";
import { continuedCompositionTask } from "./stored-designer-task";
import { createMaterialTrial } from "./material-trial";
import { applyMaterialEditAsync } from "./material-edit";
import { isSavedMaterial, type SavedMaterial } from "./material-edit-wire";
import { isCardView, isCardSample, parseStoredCardBinding } from "./card-wire";
import { presetParts, presetOwner, presetSourceSnapshot, loadPresetFonts, publishPresetEffect } from "./preset-effect-main";
import { PRESET_EFFECT_KEY } from "./preset-effect";
import type { TransformSpec } from "@worldbend/web/types";
import type {
  LinkedBatchItem,
  LinkedBatchSourcePayload,
  MainToUiMessage,
  SourcePayload,
  TemplateMutationReceipt,
  UiToMainMessage,
  NativeApplyPayload,
  NativeVectorApplyPayload,
  NativeVectorProjectionPayload,
} from "./messages";
import { isUiToMainMessage } from "./messages";
import { appearanceNodeSnapshot, appearanceExpectedState, appearancePreviewContext, applyAppearanceToNodes } from "./appearance";
import { textureNodeSnapshot, textureExpectedState, applyTextureToNodes } from "./texture";
import { documentQuadForSource } from "./native-quad";
import { captureDocumentShapeForSource } from "./native-shape-document";
import { prepareSceneReadProof, matchesSceneReadProof, writeSceneReadProof } from "./native-scene-read-proof";
import { withTimeout } from "./async-timeout";
import { createLatestAsyncQueue } from "./latest-async-queue";
import { createLocalePreferenceSettings } from "./locale-preference";
import {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  translate,
  userMessage,
  type LocalePreference,
  type MessageKey,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";
import {
  isFigmaImageAxis,
  MAX_FIGMA_IMAGE_AXIS,
  RENDER_HEIGHT_KEY,
  RENDER_WIDTH_KEY,
  SHARED_NAMESPACE,
} from "./stored-plane";
import { readResultBinding, SHARED_BINDING_KEY, writeStoredBinding, type StoredBinding } from "./stored-binding";
import { linkedResultGraph, linkedResultsForSource } from "./linked-results";
import { nativePagePlacement, pointInCoordinateParent } from "./coordinate-parent";
import {nativePlacementPagePoint,nativeOutputBounds,nativeOutputAtBounds} from "./native-output-position";
import { canUseNativeSource, nativeAppearanceInsideViewport, loadNativeRenderer, nativeDocumentParts, nodePage, NativeRollbackIncompleteError, publishNativeResult, restoreNativeProjection,
  nativePublicationUndoFor, matchesNativePublicationUndo, restoreNativePublicationUndo, type NativePublicationUndo } from "./native-document";
import { readNativeProjection, readCopiedNativeProjection, recordedNativeRenderer, SHARED_NATIVE_KEY } from "./native-projective";
import { readNativeMotionPlayhead } from "./native-motion";
import {
  buildNativeVectorProjectionInput,
  nativeVectorReadFingerprint,
  readNativeVectorProjection,
  readCopiedNativeVectorProjection,
  SHARED_NATIVE_VECTOR_KEY,
  type NativeVectorFidelity,
} from "./native-vector";
import { captureNativeVectorSource, canCaptureNativeVectorSource, isNativeVectorArtwork, nativeVectorArtworkFingerprint } from "./native-vector-source";
import {
  artworkVectorFingerprint,
  canCaptureArtworkVectorSource,
  captureArtworkVectorGeometry,
  isArtworkVectorSource,
} from "./native-vector-artwork";
import { nativeVectorDocumentParts, publicationTargetFingerprint, emptyPaints, NativeVectorRollbackIncompleteError, publishNativeVectorResult, type NativeVectorPublicationPart } from "./native-vector-document";
import { nativeVectorStatusMessage } from "./native-vector-status";
import { NATIVE_EFFECT_LISTING_URL } from "./native-renderer";
import {
  CANVAS_OUTPUT_ID_KEY,
  CANVAS_OUTPUT_NAME_KEY,
  readCanvasOutputId,
  readCanvasOutputName,
} from "./stored-canvas";
import {
  CanvasRollbackIncompleteError,
  publishCanvasDocumentTransaction,
} from "./canvas-document-transaction";
import {
  readStoredOperation,
  readStoredOperationSlots,
  restoreStoredOperationSlots,
  writeStoredOperation,
  type StoredOperation,
} from "./stored-operation";
import {
  compositionMockup,
  sameDesignerTaskFamily,
  parseStoredEffectDraft,
  parseStoredMockupDraft,
  SHARED_EFFECT_DRAFT_KEY,
  SHARED_MOCKUP_DRAFT_KEY,
  type StoredDesignerTask,
} from "./stored-designer-task";
import { sameJsonValue } from "./json-value";
import { placementBeside } from "./result-placement";
import {
  createSceneDraftSession,
  isSceneDraftNode,
  type SceneDraftSession,
} from "./scene-draft";
import { LIVE_SCENE_DRAFT_ENABLED } from "./scene-draft-policy";
import {
  MAX_SAVED_SPATIAL_TEMPLATES,
  TEMPLATE_LIBRARY_STORAGE_KEY,
  checkedTemplateLibrary,
  canvasTemplateFromSet,
  emptyTemplateLibrary,
  deformationTemplateFromWork,
  meshTemplateFromSpec,
  templateAppearance,
  templateSlotsFromSources,
  parseTemplateLibrary,
  spatialTemplateFromCompositionTask,
  spatialTemplateFromMockup,
  surfaceTemplateFromSpec,
  type FigmaSpatialTemplate,
  type FigmaTaskTemplate,
  type SavedSpatialTemplate,
  type StoredTemplateLibrary,
} from "./stored-template-library";
import { readyScene, readySceneRecords } from "./ready-scenes";
import { createReadyScene } from "./ready-scenes-main";

// Figma otherwise reuses a previous position even when it clips the footer.
// Start inside the visible canvas; position uses document coordinates, so the
// margin is converted using the host zoom. Designers can still move/resize it.
const uiBounds = figma.viewport?.bounds, uiZoom = figma.viewport?.zoom;
const uiPosition = uiBounds && Number.isFinite(uiZoom) && uiZoom > 0
  ? { x: uiBounds.x + 16 / uiZoom, y: uiBounds.y + 16 / uiZoom } : undefined;
const uiAvailable = uiPosition && uiBounds ? {
  width: Math.max(300, Math.floor(uiBounds.width * uiZoom - 32)),
  height: Math.max(440, Math.floor(uiBounds.height * uiZoom - 72)),
} : { width: 820, height: 720 };
const initialEditorWindow = { width: Math.min(820, uiAvailable.width), height: Math.min(660, uiAvailable.height) };
figma.showUI(__html__, { ...initialEditorWindow, themeColors: true,
  ...(uiPosition ? { position: uiPosition } : {}) });

const localeSettings = createLocalePreferenceSettings({
  read: () => figma.clientStorage.getAsync(LOCALE_STORAGE_KEY),
  write: (record) => figma.clientStorage.setAsync(LOCALE_STORAGE_KEY, record),
});
const storedLocalePreference = localeSettings.readStoredPreference();
const storedTemplateLibrary = (
  figma.clientStorage?.getAsync(TEMPLATE_LIBRARY_STORAGE_KEY) ?? Promise.resolve(undefined)
)
  .then((value) => ({ ok: true as const, value }))
  .catch(() => ({ ok: false as const }));
let localePreference: LocalePreference = "system";
let activeLocale: SupportedLocale = "en";
let systemLocales: string[] = [];
let uiInitialized = false;
let templateLibrary: StoredTemplateLibrary = emptyTemplateLibrary();
let templateLibraryReadFailed = false;
let templateMutation = Promise.resolve();
let sceneDraftSession: SceneDraftSession | undefined;
let materialTrialSession: SceneDraftSession | undefined;
let materialMutation = Promise.resolve();
const materialObservedRoots = new Set<string>();
const materialObservedNodes = new Map<string, SceneNode>();
const MATERIAL_LIBRARY_KEY = "worldbend-material-library-v1";
const SHARED_CARD_KEY = "card";
let materialLayout = false;
let materialContextDirty = false;
let materialWindow = {width:initialEditorWindow.width,height:Math.min(720,uiAvailable.height)};
let editorWindow = initialEditorWindow;
let nativeSourceLayout=false;
function setNativeSourceLayout(editing:boolean):void {
  if(editing===nativeSourceLayout)return;
  nativeSourceLayout=editing;
  const size=editing?{width:420,height:230}:editorWindow;
  figma.ui.resize(size.width,size.height);
}

let selectionGeneration = 0;
const appearanceObservedStates = new Map<string, string>();
const textureObservedStates = new Map<string, string>();
const foilObservedStates=new Map<string,FoilNodeSnapshot>();
let foilReadRevision=0,foilReadyGeneration:number|undefined;
const meshGradientObservedStates=new Map<string,MeshGradientNodeSnapshot>();
let meshGradientReadRevision=0,meshGradientReadyGeneration:number|undefined;
let preparedSelection:
  | {
      generation: number;
      payload: SourcePayload;
      selectedNodeIds: ReadonlySet<string>;
      observedNodeIds: ReadonlySet<string>;
      observedNodes: Map<string, SceneNode>;
      ancestorNodeIds: ReadonlySet<string>;
      binding?: StoredBinding;
      canvasTargetSize?: {width:number;height:number;outputName:string};
      rasterPaintSnapshot?: string;
      mockupDraftRaw?: string;
      sceneProof?: Awaited<ReturnType<typeof prepareSceneReadProof>>;
    }
  | undefined;
let applying = false;

const materialTrial = createMaterialTrial({
  current(request) {
    if (request.generation !== selectionGeneration || applying || reloadScheduled) return undefined;
    const selection = figma.currentPage.selection.filter(node => !isSceneDraftNode(node));
    if (request.type === "request-scene-context") return undefined;
    if (request.type === "request-material-preview") return selection;
    if(request.edit.family==='foil') {
      if(foilReadyGeneration!==request.generation || selection.some(node=>{
        const state=foilObservedStates.get(node.id);return !state||!foilNodeSnapshotFresh(state);
      }))return undefined;
      return selection.filter(node=>foilObservedStates.get(node.id)?.eligible);
    }
    if(request.edit.family==='mesh-gradient') {
      if(meshGradientReadyGeneration!==request.generation || selection.some(node=>{
        const state=meshGradientObservedStates.get(node.id);return !state||!meshGradientNodeSnapshotFresh(state);
      }))return undefined;
      return selection.filter(node=>meshGradientObservedStates.get(node.id)?.eligible);
    }
    const observed = request.edit.family === "glass" ? appearanceObservedStates : textureObservedStates;
    const expected = request.edit.family === "glass" ? appearanceExpectedState : textureExpectedState;
    if (selection.some(node => node.removed || observed.get(node.id) !== expected(node))) return undefined;
    return selection.filter(node => (request.edit.family === "glass" ? appearanceNodeSnapshot(node) : textureNodeSnapshot(node)).eligible);
  },
  sessionId: () => materialTrialSession?.sessionId ?? "material-trial-session",
  track: id => observedDraftNodeIds.add(id),
  observe: (id, node) => { materialObservedRoots.add(id); if (node) observeNodeTree(materialObservedNodes, [node]); },
  clear: () => { materialObservedRoots.clear(); materialObservedNodes.clear(); materialTrialSession?.clear(observedPage); },
  present: (_request, frames) => materialTrialSession?.updateMany(observedPage, frames, "Material") ?? false,
  post: (request, ok, frames, canvas) => {
    if (request.type === "request-scene-context") return;
    const previews = frames?.map(frame=>({bytes:figma.base64Encode(frame.bytes),width:frame.renderWidth,height:frame.renderHeight})) ?? [];
    if(request.type === "request-material-preview") post({type:"material-preview",generation:request.generation,requestId:request.requestId,previews});
    else post({ type: "material-trial", generation: request.generation, requestId: request.requestId, ok, previews, canvas: canvas ?? false });
  },
});
const sceneContextObservedRoots = new Set<string>();
const sceneContextObservedNodes = new Map<string, SceneNode>();
const sceneContextTrial = createMaterialTrial({
  current(request) {
    if (request.type !== "request-scene-context" || request.generation !== selectionGeneration || applying || reloadScheduled ||
      preparedSelection?.generation !== request.generation || !preparedSelection.payload.sceneContext) return undefined;
    const target = currentEditingSelection().find(node => node.id === preparedSelection?.payload.targetNodeId);
    if (!target || target.removed || target.type !== "RECTANGLE" || !canSaveNativeScene(target) ||
      !sameJsonValue(readResultBinding(target), preparedSelection.binding)) return undefined;
    return [target];
  },
  sessionId: () => sceneDraftSession?.sessionId ?? "scene-context-session",
  track: id => observedDraftNodeIds.add(id),
  observe: (id, node) => { sceneContextObservedRoots.add(id); if (node) observeNodeTree(sceneContextObservedNodes, [node]); },
  clear: () => { sceneContextObservedRoots.clear(); sceneContextObservedNodes.clear(); sceneDraftSession?.clear(observedPage); },
  present: (_request, frames) => sceneDraftSession?.updateMany(observedPage, frames, "Scene") ?? false,
  post: (request, ok, frames) => {
    if (request.type !== "request-scene-context") return;
    const target = currentEditingSelection().find(node => node.id === preparedSelection?.payload.targetNodeId);
    const frame = ok && frames?.length === 1 ? frames[0] : undefined;
    post({ type: "scene-context-preview", generation: request.generation, requestId: request.requestId,
      ...(frame && target && !target.removed ? { frame: { bytes: frame.bytes, width: frame.renderWidth, height: frame.renderHeight,
        placement: frame.placement, resultTransform: target.absoluteTransform, resultWidth: target.width, resultHeight: target.height } } : {}) });
  },
});
function clearSceneDraft(page: PageNode): void {
  publishedSceneContextRevision += 1;
  sceneContextTrial.cancel();
  sceneDraftSession?.clear(page);
}
let publishedSceneContextRevision = 0;
const publishedSceneContextReads = createLatestAsyncQueue(async (pending: {
  request: Extract<UiToMainMessage, { type: "request-scene-context" }>; revision: number;
}) => {
  const { request, revision } = pending;
  const prepared = preparedSelection;
  const target = currentEditingSelection().find(node => node.id === prepared?.payload.targetNodeId);
  const current = () => revision === publishedSceneContextRevision && request.generation === selectionGeneration &&
    !applying && !reloadScheduled && prepared === preparedSelection && prepared?.payload.sceneContextReadOnly &&
    target?.type === "RECTANGLE" && !target.removed && canSaveNativeScene(target) &&
    sameJsonValue(readResultBinding(target), prepared.binding);
  let frame: Extract<MainToUiMessage, { type: "scene-context-preview" }>["frame"];
  try {
    if (!current() || !target || target.type !== "RECTANGLE" || target.parent?.type !== "FRAME") return;
    const preview = target.parent;
    const box = preview.absoluteRenderBounds ?? preview.absoluteBoundingBox;
    if (!box || box.width <= 0 || box.height <= 0) throw Error("Scene preview unavailable");
    sceneContextObservedRoots.add(preview.id);
    observeNodeTree(sceneContextObservedNodes, [preview]);
    const scale = Math.min(Math.sqrt(4194304 / (box.width * box.height)), Math.max(1, figma.viewport.zoom * 2), 4096 / Math.max(box.width, box.height));
    const bytes = await withTimeout(preview.exportAsync({ format: "PNG", useAbsoluteBounds: true,
      constraint: { type: "SCALE", value: scale } }), 10000, () => Error("Scene preview timed out"));
    if (!current()) return;
    frame = { bytes, width: Math.max(1, Math.round(box.width * scale)), height: Math.max(1, Math.round(box.height * scale)),
      placement: box, resultTransform: target.absoluteTransform, resultWidth: target.width, resultHeight: target.height };
  } catch { if (!current()) return; }
  post({ type: "scene-context-preview", generation: request.generation, requestId: request.requestId, ...(frame ? { frame } : {}) });
});
// Async preflight is not a write: user/source edits must still invalidate it.
// Suppress our own host changes only after the last checked write boundary.
let publishing = false;
const cardOwnWrites = new Map<string, {generation: number; snapshot: string}>();
const cardObservedRoots = new Set<string>();
const cardObservedNodes = new Map<string, SceneNode>();
let presetExport: {generation:number;nodeId:string;sourceState:string;box:Rect}|undefined;
function beginPublication(): void {
  figma.commitUndo();
  markPublicationStarted();
}
function markPublicationStarted(): void {
  publishing = true;
  // Retired previews are safe to remove, but still a document write. Sweep
  // only at an explicit publication, never while opening/reading a selection:
  // otherwise a cold reopen would erase the host's existing redo history.
  sceneDraftSession?.sweepRetired(figma.currentPage);
}
let observedPage = figma.currentPage;
// Observation is separate from mutation ownership: another session's preview
// deletion must not invalidate this session's artwork or interrupt a gesture.
const observedDraftNodeIds = new Set<string>();
function observePageDrafts(): void {
  observedDraftNodeIds.clear();
  for (const node of observedPage.children) {
    if (isSceneDraftNode(node)) observedDraftNodeIds.add(node.id);
  }
}
observePageDrafts();
let selectionPageId = observedPage.id;
let selectionNodeIds = observedPage.selection.map((node) => node.id);
let editingSelection: readonly SceneNode[] = [];

// Ordinary artwork follows the actual Figma selection, including children of
// a previously selected Frame. Only a native result's private Content tree is
// an editing surface for its wrapper; retain that deliberately bound operation.
function currentEditingSelection(): readonly SceneNode[] {
  const actual = figma.currentPage.selection.map(nativePlacementSelection);
  const animated=actual.length===1?sceneAnimationAuthoringResult(actual[0]!):undefined;
  const selection=animated?[animated]:actual;
  const anchor = editingSelection.length === 1 ? editingSelection[0] : undefined;
  // The anchor outlives its event: a deleted result must fall through to the
  // live selection instead of reading plugin data off a removed node.
  if (anchor?.type === "FRAME" && !anchor.removed) {
    const record = readNativeProjection(anchor)??readCopiedNativeProjection(anchor);
    if (record) {
      const surface = anchor.children.find((node) => node.id === record.surfaceNodeId && node.type === "FRAME");
      let content = surface?.type === "FRAME"
        ? surface.children.find((node) => node.id === record.contentNodeId && node.type === "FRAME") : undefined;
      if(record.version==="0.3")try{const parts=componentNativeTopology(anchor);content=record.sourceEditing?parts.masterContent:parts.content;}catch{/* Reopen reports the damaged structure. */}
      if (content?.type === "FRAME" && selectionIsInside(content)) return editingSelection;
    }
  }
  // Reopening while a source child is selected must find the same owned work.
  for(let owner:BaseNode|null=selection[0]?.parent??null;owner&&owner.type!=="PAGE";owner=owner.parent){
    if(owner.type!=="FRAME")continue;
    const record=readNativeProjection(owner)??readCopiedNativeProjection(owner);
    if(record?.version!=="0.3")continue;
    try{const parts=componentNativeTopology(owner);
      if(selectionIsInside(record.sourceEditing?parts.masterContent:parts.content))return editingSelection=[owner];
    }catch{/* The ordinary load reports a changed structure. */}
  }
  editingSelection = [...selection];
  return editingSelection;
}

function selectionIsInside(anchor: FrameNode): boolean {
  const selection = figma.currentPage.selection;
  return !anchor.removed && nodePage(anchor)?.id === figma.currentPage.id &&
    selection.length > 0 && selection.every((selected) => {
      let node: BaseNode | null = selected;
      while (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
        if (node.id === anchor.id) return true;
        node = node.parent;
      }
      return false;
    });
}
let loadSelectionTimer: ReturnType<typeof setTimeout> | undefined;
// True while a (re)load is scheduled but not started. Applies in this window
// would race a reload whose pixels are about to become stale.
let reloadScheduled = false;
let observeNativeUndo: (() => void) | undefined;
let loadingSelection: {
  observedNodeIds: ReadonlySet<string>; observedNodes: Map<string, SceneNode>; ancestorNodeIds: ReadonlySet<string>;
} | undefined;

/** Remember actual artwork descendants before awaiting rasterization. Removed
 * nodes no longer expose ancestry, and native flatten can emit DELETE for an
 * internal Vector whose CREATE and handle were never exposed to the plugin. */
function observeNodeTree(observed: Map<string, SceneNode>, roots: readonly SceneNode[]): void {
  const pending = [...roots], visited = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id) || node.removed || isSceneDraftNode(node)) continue;
    visited.add(node.id);
    observed.set(node.id, node);
    if ("children" in node) for (const child of node.children) pending.push(child);
  }
}

function deletedObservedNode(id: string, ids: ReadonlySet<string>, nodes: ReadonlyMap<string, SceneNode> | undefined): boolean {
  // A newly created ancestor may have been removed before its CREATE event;
  // retained descendant handles still establish the loss of real artwork.
  if (ids.has(id)) return true;
  if (nodes) for (const node of nodes.values()) if (node.removed) return true;
  return false;
}

function observeLoadingSelection(nodes: readonly SceneNode[]): void {
  const observedNodes = new Map(loadingSelection?.observedNodes);
  observeNodeTree(observedNodes, nodes);
  loadingSelection = {
    observedNodes,
    observedNodeIds: new Set(observedNodes.keys()),
    ancestorNodeIds: new Set([...(loadingSelection?.ancestorNodeIds ?? []), ...selectionAncestorIds(nodes)]),
  };
}

// Marquee drags and panel edits fire selection/node changes far faster than
// once per frame, and each load rasterizes the source. Coalesce the storms;
// the first explicit UI readiness still loads immediately.
const SELECTION_SETTLE_DELAY_MS = 120;
const SOURCE_EXPORT_TIMEOUT_MS = 10_000;

figma.on("selectionchange", handleSelectionChange);
figma.on("currentpagechange", handleCurrentPageChange);
figma.on("close", handlePluginClose);
observedPage.on("nodechange", handleNodeChange);
let nativeSceneAnimationJob:{generation:number;requestId:number;actor?:Awaited<ReturnType<typeof beginNativeSceneAnimation>>}|undefined;
let nativeSceneAnimationEpoch=0;
async function handleNativeSceneAnimation(message:Extract<UiToMainMessage,{type:"scene-animation-begin"|"scene-animation-frame"|"scene-animation-finish"|"scene-animation-cancel"}>){
 const reply=(stage:"ready"|"frame"|"complete"|"error",extra:Partial<Extract<MainToUiMessage,{type:"scene-animation-reply"}>>={})=>post({type:"scene-animation-reply",generation:message.generation,requestId:message.requestId,stage,...extra});
 if(message.type==="scene-animation-cancel"){
  if(nativeSceneAnimationJob?.generation===message.generation&&nativeSceneAnimationJob.requestId===message.requestId){nativeSceneAnimationJob.actor?.cancel();nativeSceneAnimationJob=undefined;applying=false;++nativeSceneAnimationEpoch;}return;
 }
 try{
  if(message.type==="scene-animation-begin"){
   if(applying||nativeSceneAnimationJob)throw Error("Another scene operation is in progress");
   const selected=[...currentEditingSelection()],own=++nativeSceneAnimationEpoch;
   const check=()=>{if(own!==nativeSceneAnimationEpoch||selectionGeneration!==message.generation||preparedSelection?.generation!==message.generation||reloadScheduled||!sameIds(selected.map(n=>n.id),currentEditingSelection().map(n=>n.id)))throw Error("Scene changed. Select artwork and retry.");};
   check();const target=selected.find(n=>n.id===preparedSelection?.payload.targetNodeId);
   if(!target||target.type!=="RECTANGLE"||!canSaveNativeScene(target))throw Error("Select a linked result inside a native scene");
   const binding=readResultBinding(target);
   if(!binding||!sameJsonValue(binding,preparedSelection?.binding)||taskSourceCount(message.task)!==binding.sourceNodeIds.length)throw Error("Scene source binding changed. Reopen the result and retry.");
   nativeSceneAnimationJob={generation:message.generation,requestId:message.requestId};
   applying=true;clearSceneDraft(figma.currentPage);
   const actor=await beginNativeSceneAnimation({result:target,task:message.task as Extract<FigmaCompositionTask,{kind:"composition"}>,renderWidth:message.renderWidth,renderHeight:message.renderHeight,
    name:(nativeSceneForResult(target)?(await figma.getNodeByIdAsync(nativeSceneForResult(target)!.rootNodeId))?.name:target.parent!.name)+" · Animation",placement:{x:Math.max(...figma.currentPage.children.map(n=>n.x+n.width))+160,y:target.absoluteTransform[1][2]},assertCurrent:check,
    track(node){observedDraftNodeIds.add(node.id);}});
   if(own!==nativeSceneAnimationEpoch){actor.cancel();throw Error("Scene animation cancelled");}
   nativeSceneAnimationJob={generation:message.generation,requestId:message.requestId,actor};reply("ready");return;
  }
  const job=nativeSceneAnimationJob;if(!job?.actor||job.generation!==message.generation||job.requestId!==message.requestId)throw Error("This scene animation session is no longer active");
  if(message.type==="scene-animation-frame"){await job.actor.receive(message.index,message.bytes);reply("frame",{index:message.index});return;}
  const result=await job.actor.finish();
  // The useful native scene survives a failed encoder, allowing native retry.
  const scale=Math.min(1,1920/result.root.width,1080/result.root.height);
  const bytes=await result.root.exportAsync({format:"MP4",fps:result.fps as 12|24|30|60,quality:"HIGH",constraint:{type:"WIDTH",value:Math.max(2,Math.floor(result.root.width*scale))}});
  if(bytes.length>64*1024*1024)throw Error("The native movie exceeds the 64 MiB transfer limit");
  if(nativeSceneAnimationJob!==job)return;nativeSceneAnimationJob=undefined;applying=false;
  reply("complete",{nodeId:result.root.id,bytes,name:result.root.name+".mp4"});
 }catch(error){if(nativeSceneAnimationJob?.generation===message.generation&&nativeSceneAnimationJob.requestId===message.requestId){nativeSceneAnimationJob.actor?.cancel();nativeSceneAnimationJob=undefined;applying=false;++nativeSceneAnimationEpoch;}reply("error",{message:error instanceof Error?error.message:String(error)});}
}
figma.ui.onmessage = async (message: unknown) => {
  if (!isUiToMainMessage(message)) {
    post({
      type: "apply-error",
      generation: selectionGeneration,
      message: userMessage("invalidApplyRequest"),
    });
    return;
  }
  if (message.type === "ready") {
    if (sceneDraftSession && sceneDraftSession.sessionId !== message.sceneDraftSessionId) {
      post({
        type: "apply-error",
        generation: selectionGeneration,
        message: userMessage("invalidApplyRequest"),
      });
      return;
    }
    sceneDraftSession ??= createSceneDraftSession(message.sceneDraftSessionId);
    materialTrialSession ??= createSceneDraftSession(`${message.sceneDraftSessionId}-material`);
    void initializeUi(message.systemLocales);
    return;
  }
  if (message.type === "set-locale") {
    setLocalePreference(message.preference);
    return;
  }
  if (!uiInitialized) {
    post({
      type: "apply-error",
      generation: selectionGeneration,
      message: userMessage("invalidApplyRequest"),
    });
    return;
  }
  if (message.type === "trigger-undo") {
    void undoInHost();
    return;
  }
  if (message.type === "open-native-effect-listing") {
    void figma.openExternal(NATIVE_EFFECT_LISTING_URL);
    return;
  }
  if (message.type === "request-appearance-state") {
    postAppearanceState();
    return;
  }
  if (message.type === "request-material-trial" || message.type === "request-material-preview") {
    materialTrial.request(message);
    return;
  }
  if (message.type === "material-layout") {
    materialLayout = message.active;
    if (!materialLayout && materialContextDirty) scheduleLoadSelection();
    const size = materialLayout ? materialWindow : editorWindow;
    figma.ui.resize(size.width, size.height);
    return;
  }
  if (message.type === "resize-ui") {
    if(nativeSourceLayout)return;
    const size = {width:message.width,height:message.height};
    if (materialLayout) materialWindow = size; else editorWindow = size;
    figma.ui.resize(size.width,size.height);
    return;
  }
  if (message.type === "request-material-library" || message.type === "save-material" || message.type === "delete-material") {
    materialMutation = materialMutation.then(async () => {
      const stored: unknown = await figma.clientStorage.getAsync(MATERIAL_LIBRARY_KEY);
      if (stored !== undefined && (!Array.isArray(stored) || stored.length > 48 || !stored.every(isSavedMaterial))) throw new Error("Invalid material library");
      let materials: SavedMaterial[] = stored === undefined ? [] : stored as SavedMaterial[];
      if (message.type === "save-material") {
        const entry: SavedMaterial = JSON.parse(JSON.stringify(message.material));
        const first = figma.currentPage.selection.find(node => !isSceneDraftNode(node));
        const snapshot = first ? entry.edit.family==="foil" ? await foilNodeSnapshot(first) : entry.edit.family==="mesh-gradient" ? await meshGradientNodeSnapshot(first) : entry.edit.family === "glass" ? appearanceNodeSnapshot(first) : textureNodeSnapshot(first) : undefined;
        if (first && snapshot?.live && ((entry.edit.family!=="foil" && entry.edit.family!=="mesh-gradient") || ("canChoose" in snapshot && snapshot.canChoose)) && JSON.stringify(snapshot.live) === JSON.stringify(entry.edit.material)) {
          const originalGeneration = selectionGeneration;
          const expectedState = entry.edit.family === "glass" ? appearanceExpectedState : textureExpectedState;
          const before = expectedState(first);
          try {
            const bytes = await withTimeout(appearancePreviewContext(first).exportAsync({ format: "PNG", ...sourceRasterBounds(appearancePreviewContext(first)), constraint: { type: "WIDTH", value: 160 } }), 5000, () => new Error("Thumbnail timed out"));
            const thumbnail = figma.base64Encode(bytes);
            if (!first.removed && selectionGeneration === originalGeneration && expectedState(first) === before && (entry.edit.family!=="foil" || foilNodeSnapshotFresh(snapshot as FoilNodeSnapshot)) && (entry.edit.family!=="mesh-gradient" || meshGradientNodeSnapshotFresh(snapshot as MeshGradientNodeSnapshot)) && thumbnail.length <= 65536) entry.thumbnail = thumbnail;
          } catch { /* Saving the declared look does not require a scene thumbnail. */ }
        }
        materials = [...materials.filter(m => m.edit.recipe.recipeId !== entry.edit.recipe.recipeId), entry];
        if (materials.length > 48) throw new Error("Material library is full");
        await figma.clientStorage.setAsync(MATERIAL_LIBRARY_KEY, materials);
      } else if (message.type === "delete-material") {
        materials = materials.filter(m => m.edit.recipe.recipeId !== message.recipeId);
        await figma.clientStorage.setAsync(MATERIAL_LIBRARY_KEY, materials);
      }
      post({ type: "material-library", materials });
    }).catch(() => post({ type: "material-library-error" }));
    return;
  }
  if (message.type === "request-preset-state") {
    try {
      const selection=figma.currentPage.selection.filter(node=>!isSceneDraftNode(node));
      if(selection.length!==1) {post({type:"preset-state",generation:selectionGeneration,
        ...(selection.length?{message:userMessage("presetSelectOne")}: {})});return;}
      const selected=selection[0]!, existing=presetOwner(selected);
      if (selected.getSharedPluginData(SHARED_NAMESPACE,PRESET_EFFECT_KEY) && !existing) throw Error("Damaged preset result");
      const source=existing?.source??selected;
      post({type:"preset-state",generation:selectionGeneration,node:{nodeId:source.id,name:existing?.root.name??source.name,
        ...(existing?{spec:existing.record.spec,resultNodeId:existing.root.id}: {})}});
    } catch {post({type:"preset-state",generation:selectionGeneration,message:userMessage("presetSourceUnavailable")});}
    return;
  }
  if (message.type === "request-preset-source") {
    let clone:SceneNode|undefined;
    try {
      const source=await figma.getNodeByIdAsync(message.nodeId);
      if(!source||!isSceneNode(source)||source.removed||message.generation!==selectionGeneration||reloadScheduled) throw Error("Selection changed");
      const sourceState=presetSourceSnapshot(source);
      if(sourceState.length>1_000_000)throw Error("Source exceeds snapshot limit");
      await loadPresetFonts(source);
      if(message.generation!==selectionGeneration||reloadScheduled||sourceState!==presetSourceSnapshot(source)) throw Error("Source changed");
      // clone() first inserts into the original parent. In auto layout that
      // temporarily shares FILL space and shrinks both siblings; restore the
      // detached clone from dimensions captured before that insertion.
      const sourceWidth=source.width,sourceHeight=source.height,sourceTransform=source.absoluteTransform;
      clone=source.clone();figma.currentPage.appendChild(clone);clone.visible=true;
      if ("resizeWithoutConstraints" in clone) clone.resizeWithoutConstraints(sourceWidth,sourceHeight);
      else if (clone.width!==sourceWidth||clone.height!==sourceHeight) throw Error("Source copy changed size");
      clone.relativeTransform=sourceTransform;
      const all=[clone,...("findAll" in clone?clone.findAll(()=>true):[])];
      all.forEach(n=>{n.setPluginData("sceneDraft","1");observedDraftNodeIds.add(n.id);});
      const box=cardArtworkBounds(clone);
      if(!box||box.width<=0||box.height<=0)throw Error("Source has no visible bounds");
      const scale=Math.min(2,4096/Math.max(box.width,box.height));
      const bytes=await withTimeout(clone.exportAsync({format:"PNG",...sourceRasterBounds(clone),constraint:{type:"SCALE",value:scale}}),10000,()=>Error("Preset source export timed out"));
      if(message.generation!==selectionGeneration||reloadScheduled||sourceState!==presetSourceSnapshot(source)) throw Error("Source changed");
      presetExport={generation:message.generation,nodeId:source.id,sourceState,box};
      post({type:"preset-source",generation:message.generation,requestId:message.requestId,bytes:figma.base64Encode(bytes),
        width:box.width,height:box.height,sourceState});
    } catch {post({type:"preset-error",generation:message.generation,requestId:message.requestId,message:userMessage("presetSourceUnavailable")});}
    finally {clone?.remove();}
    return;
  }
  if(message.type==="apply-preset-effect") {
    let started=false;
    try {
      const source=await figma.getNodeByIdAsync(message.sourceNodeId), exported=presetExport;
      const selected=figma.currentPage.selection[0];
      const existing=selected ? presetOwner(selected) : undefined;
      const ownerState=existing?presetSourceSnapshot(existing.root):undefined;
      const assertCurrent=()=>{
        const now=figma.currentPage.selection[0],currentOwner=now?presetOwner(now):undefined;
        if(applying||publishing||reloadScheduled||message.generation!==selectionGeneration||!source||!isSceneNode(source)||source.removed||
          !exported||exported.generation!==message.generation||exported.nodeId!==source.id||exported.sourceState!==message.sourceState||
          message.sourceState!==presetSourceSnapshot(source)||figma.currentPage.selection.length!==1||
          (existing ? existing.source.id!==source.id||currentOwner?.root.id!==existing.root.id||
            presetSourceSnapshot(existing.root)!==ownerState
            : now?.id!==source.id||currentOwner!==undefined)) throw Error("Selection or artwork changed");
      };
      assertCurrent();
      for(const layer of message.raster.layers) {
        const bytes=figma.base64Decode(layer.bytes);
        const width=pngDimension(bytes,16),height=pngDimension(bytes,20);
        if(width<1||height<1||width>4096||height>4096)throw Error("Preset raster exceeds image limit");
      }
      await loadPresetFonts(source as SceneNode);assertCurrent();
      const root=publishPresetEffect({source:source as SceneNode,...(existing?{existing}:{}),spec:message.spec,
        raster:message.raster,sourceBox:exported!.box,beforeWrite(){assertCurrent();started=true;beginPublication();}});
      figma.currentPage.selection=[root];figma.commitUndo();
      post({type:"preset-applied",generation:message.generation,nodeId:root.id});
      publishing=false;loadSelectionNow();
    } catch {
      if(started)publishing=false;
      post({type:"preset-error",generation:message.generation,message:userMessage("presetApplyFailed")});
      if(started)loadSelectionNow();
    }
    return;
  }
  if(message.type==="edit-preset-source") {
    const selected=figma.currentPage.selection[0];
    let parts:ReturnType<typeof presetParts>;
    try {parts=selected&&presetOwner(selected);} catch {post({type:"preset-error",generation:message.generation,message:userMessage("presetSourceUnavailable")});return;}
    if(parts&&message.generation===selectionGeneration&&!applying&&!publishing&&!reloadScheduled) {
      beginPublication();parts.holder.visible=true;parts.presentation.visible=false;
      figma.currentPage.selection=[parts.source];figma.commitUndo();publishing=false;loadSelectionNow();
    }
    return;
  }
  if (message.type === "request-card-state") {
    postCardState();
    return;
  }
  if (message.type === "request-card-source") {
    void (async () => {
      try {
        const node = await figma.getNodeByIdAsync(message.nodeId);
        if (!node || !isSceneNode(node) || node.removed ||
            message.generation !== selectionGeneration || reloadScheduled) {
          throw userError("selectionChanged");
        }
        const box = cardArtworkBounds(node);
        if (!box || box.width <= 0 || box.height <= 0) throw userError("cardSourceUnavailable");
        cardObservedRoots.add(node.id);
        observeNodeTree(cardObservedNodes, [node]);
        const scale = Math.min(2, 4096 / Math.max(box.width, box.height));
        const bytes = await withTimeout(
          node.exportAsync({ format: "PNG", ...sourceRasterBounds(node), constraint: { type: "SCALE", value: scale } }),
          10000,
          () => new Error("card source export timed out"),
        );
        if (message.generation !== selectionGeneration || reloadScheduled) return;
        post({
          type: "card-source",
          generation: message.generation,
          requestId: message.requestId,
          bytes: figma.base64Encode(bytes),
          width: pngDimension(bytes, 16),
          height: pngDimension(bytes, 20),
          ...(message.back ? { back: true } : {}),
        });
      } catch {
        post({ type: "card-error", generation: message.generation, operation: "source", requestId: message.requestId, message: userMessage("cardSourceUnavailable") });
      }
    })();
    return;
  }
  if (message.type === "apply-card-rig") {
    const { nodes: selection } = await resolveCardSelection();
    if (applying || publishing || reloadScheduled || message.generation !== selectionGeneration || !selection.length) {
      post({ type: "card-error", generation: selectionGeneration, message: userMessage("selectionChanged") });
      postCardState();
      return;
    }
    const node = selection[0]!;
    try {
      beginPublication();
      const binding = {
        schema: "worldbend.card-binding",
        version: "0.1",
        rig: message.rig,
        ...(message.backNodeId ? { backNodeId: message.backNodeId } : {}),
      };
      node.setSharedPluginData(SHARED_NAMESPACE, SHARED_CARD_KEY, JSON.stringify(binding));
      cardOwnWrites.set(node.id, {generation: selectionGeneration, snapshot: cardWriteSnapshot(node)});
      figma.commitUndo();
      post({ type: "card-rig-applied", generation: selectionGeneration });
    } catch {
      post({ type: "card-error", generation: selectionGeneration, message: userMessage("cardApplyFailed") });
    } finally {
      publishing = false;
      postCardState();
    }
    return;
  }
  if (message.type === "publish-card-still") {
    const { nodes: selection } = await resolveCardSelection();
    if (applying || publishing || reloadScheduled || message.generation !== selectionGeneration || !selection.length) {
      post({ type: "card-error", generation: selectionGeneration, message: userMessage("selectionChanged") });
      return;
    }
    const source = selection[0]!;
    let created: RectangleNode | undefined;
    let restoreExisting: (() => void) | undefined;
    try {
      beginPublication();
      const bytes = figma.base64Decode(message.bytes);
      const imageHash = figma.createImage(bytes).hash;
      const existing = figma.currentPage.findAll(node => {
        if (node.type !== "RECTANGLE") return false;
        try { const binding = JSON.parse(node.getSharedPluginData(SHARED_NAMESPACE, "card-still"));
          return binding.schema === "worldbend.card-still" && binding.sourceNodeId === source.id && binding.viewId === message.viewId;
        } catch { return false; }
      })[0] as RectangleNode | undefined;
      if (existing) {
        const previous: Pick<RectangleNode, "name" | "width" | "height" | "fills"> & {record: string} = {name: existing.name, width: existing.width, height: existing.height,
          fills: existing.fills, record: existing.getSharedPluginData(SHARED_NAMESPACE, "card-still")};
        restoreExisting = () => {
          existing.name = previous.name;
          existing.resize(previous.width, previous.height);
          existing.fills = previous.fills;
          if (existing.getSharedPluginData(SHARED_NAMESPACE, "card-still") !== previous.record)
            existing.setSharedPluginData(SHARED_NAMESPACE, "card-still", previous.record);
        };
      }
      const still = existing ?? (created = figma.createRectangle());
      const previousGeneratedName = existing
        ? JSON.parse(existing.getSharedPluginData(SHARED_NAMESPACE, "card-still")).generatedName
        : undefined;
      const box = cardArtworkBounds(source);
      const width = Math.min(message.renderWidth, 8192);
      const height = Math.min(message.renderHeight, 8192);
      if (!existing || existing.name === previousGeneratedName) still.name = message.name;
      still.resize(width, height);
      if (!existing) {
        const saved = figma.currentPage.findAll(node => {
          if (node.type !== "RECTANGLE") return false;
          try {
            const binding = JSON.parse(node.getSharedPluginData(SHARED_NAMESPACE, "card-still"));
            return binding.schema === "worldbend.card-still" && binding.sourceNodeId === source.id;
          } catch { return false; }
        });
        const right = Math.max(box ? box.x + box.width : source.x + source.width, ...saved.map(node => (node.absoluteBoundingBox?.x ?? node.x) + (node.absoluteBoundingBox?.width ?? node.width)));
        still.x = right + 48;
        still.y = box ? box.y : source.y;
      }
      still.fills = [{ type: "IMAGE", imageHash, scaleMode: "FILL" }];
      still.setSharedPluginData(SHARED_NAMESPACE, "card-still", JSON.stringify({
        schema: "worldbend.card-still",
        version: "0.1",
        rig: message.rig,
        view: message.view,
        sourceNodeId: source.id,
        viewId: message.viewId,
        generatedName: message.name,
        sourceRevision: cardSourceRevision(source),
        visibleFace: message.face,
        ...(message.sample ? {sample: message.sample} : {}),
      }));
      if (!existing) figma.currentPage.appendChild(still);
      cardOwnWrites.set(still.id, {generation: selectionGeneration, snapshot: cardWriteSnapshot(still)});
      figma.commitUndo();
      post({ type: "card-still-published", generation: selectionGeneration, requestId: message.requestId, nodeId: still.id });
    } catch {
      if (created && !created.removed) created.remove();
      else if (restoreExisting) restoreExisting();
      post({ type: "card-error", generation: message.generation, operation: "publish", requestId: message.requestId, message: userMessage("cardStillFailed") });
    } finally {
      publishing = false;
    }
    return;
  }
  if (message.type === "apply-material") {
    const selection = figma.currentPage.selection.filter(node => !isSceneDraftNode(node));
    const observed = message.edit.family === "glass" ? appearanceObservedStates : textureObservedStates;
    const expected = message.edit.family === "glass" ? appearanceExpectedState : textureExpectedState;
    if (applying || publishing || reloadScheduled || message.generation !== selectionGeneration ||
        (message.edit.family==='foil' ? foilReadyGeneration!==message.generation || selection.some(node=>{
          const snapshot=foilObservedStates.get(node.id);return !snapshot||!foilNodeSnapshotFresh(snapshot);
        }) : message.edit.family==='mesh-gradient' ? meshGradientReadyGeneration!==message.generation || selection.some(node=>{
          const snapshot=meshGradientObservedStates.get(node.id);return !snapshot||!meshGradientNodeSnapshotFresh(snapshot);
        }) : selection.some(node => observed.get(node.id) !== expected(node)))) {
      materialTrial.cancel();
      post({ type: "appearance-error", generation: selectionGeneration, message: userMessage("appearanceChanged") });
      postAppearanceState(); postTextureState(); postCardState();
      return;
    }
    materialTrial.cancel();
    try {
      const capturedPage=figma.currentPage;
      const result = await applyMaterialEditAsync(selection, message.edit,message.edit.family==='mesh-gradient'?meshGradientObservedStates:foilObservedStates,()=>{
        if(figma.currentPage!==capturedPage || message.generation!==selectionGeneration || applying || reloadScheduled ||
           !sameIds(figma.currentPage.selection.filter(node=>!isSceneDraftNode(node)).map(node=>node.id),selection.map(node=>node.id)))
          throw Error('Material selection changed');
      },beginPublication);
      figma.commitUndo();
      if (result.ok) {
        materialContextDirty = true;
        post({ type: "material-applied", generation: selectionGeneration, results: result.outcomes });
      } else {
        post({ type: "appearance-error", generation: selectionGeneration, message: result.unrestoredNodeIds.length
          ? userMessage("appearanceRollbackFailed", { layers: result.unrestoredNodeIds.map(id => selection.find(n => n.id === id)?.name ?? id).join(", ") })
          : userMessage("appearanceApplyFailed") });
      }
    } catch {
      post({ type: "appearance-error", generation: selectionGeneration, message: userMessage("appearanceApplyFailed") });
    } finally {
      publishing = false;
      postAppearanceState();
      postTextureState();
    }
    return;
  }
  if (message.type === "cancel-appearance-draft") {
    materialTrial.cancel();
    return;
  }
  if(message.type==="request-foil-state"){void postFoilState();return;}
  if(message.type==="request-mesh-gradient-state"){void postMeshGradientState();return;}
  if (message.type === "request-texture-state") {
    postTextureState();
    return;
  }
  if (message.type === "apply-texture") {
    if (applying || message.generation !== selectionGeneration) {
      // A dropped apply has no completion of its own; without this reply the
      // panel would stay locked on an apply that can never land.
      post({ type: "texture-error", generation: selectionGeneration, message: userMessage(applying ? "applyAlreadyInProgress" : "selectionChanged") });
      return;
    }
    const selection = figma.currentPage.selection.filter(isSceneNode);
    if (selection.some(n => textureObservedStates.get(n.id) !== textureExpectedState(n))) {
      post({ type: "texture-error", generation: selectionGeneration, message: userMessage("textureChanged") });
      postTextureState();
      return;
    }
    const applied = applyTextureToNodes(selection, message.recipe, message.material);
    if (!applied.ok) {
      post({
        type: "texture-error",
        generation: selectionGeneration,
        message: applied.unrestoredNodeIds.length ? userMessage("textureRollbackFailed", { layers: applied.unrestoredNodeIds.map(id => selection.find(n => n.id === id)?.name ?? id).join(", ") }) : userMessage("textureApplyFailed"),
      });
      postTextureState();
      return;
    }
    post({
      type: "texture-applied",
      generation: selectionGeneration,
      results: applied.outcomes,
    });
    postTextureState();
    return;
  }
  if (message.type === "apply-appearance") {
    if (applying || message.generation !== selectionGeneration) {
      // A dropped apply has no completion of its own; without this reply the
      // panel would stay locked on an apply that can never land.
      post({ type: "appearance-error", generation: selectionGeneration, message: userMessage(applying ? "applyAlreadyInProgress" : "selectionChanged") });
      return;
    }
    const selection = figma.currentPage.selection.filter(isSceneNode);
    if (selection.some(n => appearanceObservedStates.get(n.id) !== appearanceExpectedState(n))) {
      post({ type: "appearance-error", generation: selectionGeneration, message: userMessage("appearanceChanged") });
      postAppearanceState();
      return;
    }
    const applied = applyAppearanceToNodes(selection, message.recipe, message.material);
    if (!applied.ok) {
      post({
        type: "appearance-error",
        generation: selectionGeneration,
        message: applied.unrestoredNodeIds.length ? userMessage("appearanceRollbackFailed", { layers: applied.unrestoredNodeIds.map(id => selection.find(n => n.id === id)?.name ?? id).join(", ") }) : userMessage("appearanceApplyFailed"),
      });
      postAppearanceState();
      return;
    }
    post({
      type: "appearance-applied",
      generation: selectionGeneration,
      results: applied.outcomes,
    });
    postAppearanceState();
    return;
  }
  if (message.type === "select-linked-result") {
    const prepared = preparedSelection;
    if (applying || !prepared || message.generation !== selectionGeneration ||
      prepared.payload.targetNodeId || !sameIds(currentEditingSelection().map(node => node.id), [...prepared.selectedNodeIds])) return;
    const stackSource = prepared.payload.sources?.some(source => source.sourceNodeId === message.sourceNodeId);
    if (!stackSource && (prepared.payload.sourceNodeId !== message.sourceNodeId ||
      !prepared.payload.linkedResults?.items.some(result => result.nodeId === message.resultNodeId))) return;
    const requestedGeneration = message.generation;
    const sourceNodeId = message.sourceNodeId;
    void figma.getNodeByIdAsync(message.resultNodeId).then((node) => {
      // The lookup can resolve after the designer has changed selection or an
      // apply has started. A late selection write would discard that newer work.
      if (applying || requestedGeneration !== selectionGeneration) return;
      if (!node || node.removed || !isSceneNode(node) || nodePage(node)?.id !== figma.currentPage.id) {
        loadSelectionNow();
        return;
      }
      const binding = readResultBinding(node);
      const source = currentEditingSelection().find(selected => selected.id === sourceNodeId);
      const related = source && linkedResultGraph(linkedResultCandidates(), source).entries.some(entry => entry.node.id === node.id);
      if (!binding || !related || readStoredOperation(node).status !== "valid") {
        loadSelectionNow();
        return;
      }
      figma.currentPage.selection = [node];
      try { figma.viewport.scrollAndZoomIntoView([node]); }
      catch { /* Revealing the node is not required for the selection itself. */ }
    }).catch(() => {
      if (!applying && requestedGeneration === selectionGeneration) loadSelectionNow();
    });
    return;
  }
  if (message.type === "prepare-linked-batch") {
    void prepareLinkedBatch(message.generation);
    return;
  }
  if (message.type === "apply-linked-batch-item") {
    void applyLinkedBatchItem(message.payload);
    return;
  }
  if (message.type === "export-batch-source") {
    void exportBatchSource(message);
    return;
  }
  if (message.type === "request-scene-context") {
    if (LIVE_SCENE_DRAFT_ENABLED) {
      const revision = ++publishedSceneContextRevision;
      if (message.readPublished && preparedSelection?.payload.sceneContextReadOnly) {
        sceneContextTrial.cancel();
        publishedSceneContextReads.request({ request: message, revision });
      } else sceneContextTrial.request(message);
    }
    return;
  }
  if (message.type === "scene-draft") {
    if (LIVE_SCENE_DRAFT_ENABLED && !applying && message.generation === selectionGeneration) {
      sceneDraftSession?.update(
        figma.currentPage,
        message,
        preparedSelection?.payload.sourceName ?? "Worldbend",
      );
    }
    return;
  }
  if (message.type === "scene-draft-clear") {
    if (message.generation === selectionGeneration) clearSceneDraft(figma.currentPage);
    return;
  }
  if (message.type === "restore-native") {
    void restoreNativeSelection(message);
    return;
  }
  if (message.type === "apply-native") {
    void applyNativeResult(message.payload);
    return;
  }
  if(message.type==="edit-native-source"){
    void editNativeSource(message);return;
  }
  if(message.type==="request-native-motion-context"){
    const prepared=preparedSelection;
    if(!prepared||prepared.generation!==message.generation||selectionGeneration!==message.generation||
      !prepared.payload.nativeComponentTarget||prepared.payload.targetNodeId!==message.targetNodeId||
      !sameIds(currentEditingSelection().map(node=>node.id),[...prepared.selectedNodeIds]))return;
    try{
      const playheadPosition=readNativeMotionPlayhead(figma);
      post({type:"native-motion-context",generation:message.generation,targetNodeId:message.targetNodeId,
        ...(playheadPosition!==undefined?{playheadPosition}:{})});
    }catch{/* A transient beta API read never changes the last safe UI state. */}
    return;
  }
  if (message.type === "request-native-vector-projection") {
    void requestNativeVectorProjection(message.payload);
    return;
  }
  if (message.type === "apply-native-vector") {
    void applyNativeVector(message.payload);
    return;
  }
  if (message.type === "save-template") {
    const mutation: TemplateMutationReceipt = {
      kind: "save",
      workspace: message.workspace,
      requestId: message.requestId,
    };
    queueTemplateMutation(mutation, async () => {
      assertTemplateLibraryWritable();
      if (templateLibrary.templates.length >= MAX_SAVED_SPATIAL_TEMPLATES) {
        throw userError("templateLimitReached", { limit: MAX_SAVED_SPATIAL_TEMPLATES });
      }
      if (templateLibrary.templates.some((template) => template.name === message.name)) {
        throw userError("templateNameExists", { name: message.name });
      }
      const storedTemplate = storedTemplateFromMessage(message.template);
      const record: SavedSpatialTemplate = {
        id: createTemplateId(templateLibrary.templates),
        name: message.name,
        template: storedTemplate,
        ...(message.slots ? { slots: message.slots } : {}),
        appearance: templateAppearance(storedTemplate),
      };
      const next = checkedTemplateLibrary([...templateLibrary.templates, record]);
      if (!next) throw userError("templateSaveFailed");
      await figma.clientStorage.setAsync(TEMPLATE_LIBRARY_STORAGE_KEY, next);
      templateLibrary = next;
      postTemplateLibrary(mutation);
    });
    return;
  }
  if (message.type === "delete-template") {
    const mutation: TemplateMutationReceipt = {
      kind: "delete",
      requestId: message.requestId,
    };
    queueTemplateMutation(mutation, async () => {
      assertTemplateLibraryWritable();
      const removed = templateLibrary.templates.find(template => template.id === message.id);
      const sceneRoot = removed?.nativeScene ? await figma.getNodeByIdAsync(removed.nativeScene.rootNodeId) : null;
      const sceneMarker = sceneRoot?.getSharedPluginData("worldbend", "sceneTemplate") ?? "";
      const next = checkedTemplateLibrary(
        templateLibrary.templates.filter((template) => template.id !== message.id),
      );
      if (!next) throw userError("templateSaveFailed");
      const ownedMarker = parseNativeSceneTemplateMarker(sceneMarker)?.id === removed?.id &&
        sceneRoot !== null && !sceneRoot.removed && removed?.nativeScene !== undefined &&
        sceneRoot.getSharedPluginData("worldbend", "nativeScene") === JSON.stringify(removed.nativeScene);
      if (ownedMarker) sceneRoot!.setSharedPluginData("worldbend", "sceneTemplate", "");
      try { await figma.clientStorage.setAsync(TEMPLATE_LIBRARY_STORAGE_KEY, next); }
      catch (error) {
        if (ownedMarker && sceneRoot && !sceneRoot.removed && sceneRoot.getSharedPluginData("worldbend", "sceneTemplate") === "") {
          sceneRoot.setSharedPluginData("worldbend", "sceneTemplate", sceneMarker);
        }
        throw error;
      }
      templateLibrary = next;
      if (ownedMarker) figma.commitUndo();
      postTemplateLibrary(mutation);
    });
    return;
  }
  if(message.type==="scene-animation-begin"||message.type==="scene-animation-frame"||message.type==="scene-animation-finish"||message.type==="scene-animation-cancel"){void handleNativeSceneAnimation(message);return;}
  if (message.type === "save-native-scene") {
    saveNativeScene(message); return;
  }
  if (message.type === "use-native-scene") {
    void useNativeScene(message); return;
  }
  if (message.type === "use-ready-scene") {
    void useReadyScene(message);
    return;
  }
  if (message.type === "request-source-raster") {
    void refreshSourceRaster(message);
    return;
  }
  if (message.type === "apply") void applyResult(message.payload);
  if (message.type === "apply-canvas") void applyCanvasSet(message.payload);
  if (message.type === "prepare-shape-fit") {
    try {
      const prepared=preparedSelection;
      if (!prepared || prepared.generation!==message.generation || message.generation!==selectionGeneration || reloadScheduled ||
        !sameIds(currentEditingSelection().map(node=>node.id),[...prepared.selectedNodeIds])) throw userError("selectionChanged");
      const rasters=prepared.payload.sources;
      const index=message.task.shapeGuideSourceIndex;
      if (!rasters || rasters.length!==2 || index===undefined || !rasters[index]?.shapeGuide ||
        !sameJsonValue(message.task.spec.shapeFit?.clip,normalizedDocumentShape(rasters[index]!.shapeGuide!))) throw userError("selectionChanged");
      const artwork=rasters[1-index]!;
      prepared.payload={...prepared.payload,...artwork,
        ...(prepared.payload.targetNodeId ? {placement:prepared.payload.placement} : {}),
        deformationDraft:JSON.parse(JSON.stringify(message.task))};
      post({type:"source",generation:message.generation,payload:prepared.payload});
    } catch(error) {post({type:"shape-fit-error",generation:message.generation,message:toUserMessage(error,"unexpectedError")});}
    return;
  }
  if (message.type === "apply-designer") {
    void applyDesignerResult(message.payload);
  }
};

async function initializeUi(nextSystemLocales: string[]): Promise<void> {
  if (uiInitialized) return;
  systemLocales = [...nextSystemLocales];
  const [nextPreference, savedLibraryRead] = await Promise.all([
    storedLocalePreference,
    storedTemplateLibrary,
  ]);
  // Only a session's own cleanup may mark a preview retired. Never infer that
  // an unretired node is stale from its age or client identity: it may still
  // be another plugin instance's live feedback.
  localePreference = nextPreference;
  if (!savedLibraryRead.ok) {
    templateLibraryReadFailed = true;
  } else if (savedLibraryRead.value === undefined) {
    templateLibrary = emptyTemplateLibrary();
  } else {
    const parsed = parseTemplateLibrary(savedLibraryRead.value);
    if (parsed) templateLibrary = parsed;
    else templateLibraryReadFailed = true;
  }
  activeLocale = resolveLocale(localePreference, systemLocales);
  uiInitialized = true;
  post({ type: "locale", preference: localePreference, locale: activeLocale });
  postTemplateLibrary();
  if (templateLibraryReadFailed) {
    post({ type: "template-library-error", message: userMessage("templateLibraryInvalid") });
  }
  loadSelectionNow();
}

function queueTemplateMutation(
  mutation: TemplateMutationReceipt,
  operation: () => Promise<void>,
): void {
  templateMutation = templateMutation.then(operation, operation).catch((error) => {
    post({
      type: "template-library-error",
      message: toUserMessage(error, "templateSaveFailed"),
      mutation,
    });
  });
}

function assertTemplateLibraryWritable(): void {
  if (templateLibraryReadFailed) throw userError("templateLibraryInvalid");
}

let templatePreviewEpoch = 0;
function postTemplateLibrary(mutation?: TemplateMutationReceipt): void {
  post({
    type: "template-library",
    templates: [...readySceneRecords(), ...(checkedTemplateLibrary(templateLibrary.templates)?.templates ?? [])],
    ...(mutation ? { mutation } : {}),
  });
  const epoch = ++templatePreviewEpoch;
  void Promise.all(templateLibrary.templates.filter(record => record.nativeScene).map(async record => {
    try {
      const result = await figma.getNodeByIdAsync(record.nativeScene!.resultNodeId);
      if (!result || !("visible" in result) || !sameJsonValue(nativeSceneForResult(result), record.nativeScene)) return;
      const preview = await figma.getNodeByIdAsync(record.nativeScene!.previewNodeId);
      if (!preview || preview.type !== "FRAME") return;
      const bytes = await preview.exportAsync({ format: "PNG", constraint: { type: "WIDTH", value: 320 } });
      if (epoch === templatePreviewEpoch) post({ type: "native-scene-preview", id: record.id, bytes });
    } catch { /* The saved scene remains discoverable for recovery if its preview is unavailable. */ }
  }));
}

async function useReadyScene(message: Extract<UiToMainMessage, { type: "use-ready-scene" }>) {
  if (applying) {
    post({ type: "template-library-error", message: userMessage("applyAlreadyInProgress"), useRequestId: message.requestId });
    return;
  }
  applying = true;
  try {
    const selection = [...currentEditingSelection()];
    const artwork = selection[0];
    const prepared = preparedSelection;
    const assertCurrent = () => {
      if (!artwork || selection.length !== 1 || artwork.removed || !prepared ||
        prepared.generation !== message.generation || selectionGeneration !== message.generation || reloadScheduled ||
        !sameIds(currentEditingSelection().map(node => node.id), selection.map(node => node.id))) throw userError("selectionChanged");
    };
    assertCurrent();
    const layout = readyScene(message.id);
    const placement = placementBeside([prepared!.payload.placement], { width: layout.surface.width + 96 + layout.width, height: Math.max(layout.surface.height, layout.height) },
      figma.currentPage.children.map(node => ({ x: node.x, y: node.y, width: node.width, height: node.height })));
    const scene = await createReadyScene({ id: message.id, artwork: artwork!, fit: message.fit, placement,
      assertCurrent, begin() { clearSceneDraft(figma.currentPage); figma.commitUndo(); } });
    figma.currentPage.selection = [scene.result];
    figma.viewport.scrollAndZoomIntoView([scene.preview]);
    loadSelectionNow();
  } catch (error) {
    post({ type: "template-library-error", message: toUserMessage(error, "unexpectedError"), useRequestId: message.requestId });
  } finally { applying = false; }
}

function saveNativeScene(message: Extract<UiToMainMessage, { type: "save-native-scene" }>) {
  const mutation: TemplateMutationReceipt = { kind: "save", workspace: "mockup", requestId: message.requestId };
  queueTemplateMutation(mutation, async () => {
    assertTemplateLibraryWritable();
    if (applying) throw userError("applyAlreadyInProgress");
    if (templateLibrary.templates.length >= MAX_SAVED_SPATIAL_TEMPLATES) throw userError("templateLimitReached", { limit: MAX_SAVED_SPATIAL_TEMPLATES });
    if (templateLibrary.templates.some(record => record.name === message.name)) throw userError("templateNameExists", { name: message.name });
    const selected = [...currentEditingSelection()];
    const assertCurrent = () => {
      if (!preparedSelection || preparedSelection.generation !== message.generation || selectionGeneration !== message.generation || reloadScheduled ||
        preparedSelection.payload.targetNodeId !== message.targetNodeId || !sameIds(selected.map(node => node.id), currentEditingSelection().map(node => node.id))) throw userError("selectionChanged");
    };
    assertCurrent(); applying = true;
    let created: FrameNode | undefined;
    try {
      const target = await figma.getNodeByIdAsync(message.targetNodeId); assertCurrent();
      if (!target || target.type !== "RECTANGLE") throw userError("resultNotReplaceable");
      const operation = readStoredOperation(target), operationSlots = readStoredOperationSlots(target), binding = readResultBinding(target);
      if (operation.status !== "valid" || operation.operation.kind !== "task" ||
        (operation.operation.task.kind !== "mockup" && operation.operation.task.kind !== "composition") || !binding) throw userError("resultNotReplaceable");
      const task = message.task;
      if (taskSourceCount(task) !== binding.sourceNodeIds.length) throw userError("selectionChanged");
      const template = spatialTemplateFromCompositionTask(task);
      const oldScene = nativeSceneForResult(target);
      const originalRoot = oldScene ? await figma.getNodeByIdAsync(oldScene.rootNodeId) : target.parent;
      if (!originalRoot || originalRoot.type !== "FRAME") throw userError("resultNotReplaceable");
      const placement = placementBeside([originalRoot.absoluteBoundingBox!], { width: originalRoot.width, height: originalRoot.height },
        figma.currentPage.children.map(node => ({ x: node.x, y: node.y, width: node.width, height: node.height })));
      const copied = await copyNativeScene({ result: target, expectedSlots: operationSlots, task, name: message.name, renderSize: { width: message.renderWidth, height: message.renderHeight }, placement, assertCurrent,
        begin() { clearSceneDraft(figma.currentPage); figma.commitUndo(); } });
      created = copied.root;
      const finalPlacement = placementBeside([originalRoot.absoluteBoundingBox!], { width: copied.root.width, height: copied.root.height },
        figma.currentPage.children.filter(node => node.id !== copied.root.id).map(node => ({ x: node.x, y: node.y, width: node.width, height: node.height })));
      copied.root.x = finalPlacement.x; copied.root.y = finalPlacement.y;
      const image = figma.createImage(message.bytes);
      copied.result.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
      writeRasterPaintProof(copied.result);
      const slots = templateSlotsFromSources(copied.replaceSources.map(node => {
        const scale = Math.min(1, 4096 / node.width, 4096 / node.height);
        return { sourceName: node.name, renderWidth: Math.max(1, Math.ceil(node.width * scale)), renderHeight: Math.max(1, Math.ceil(node.height * scale)) };
      }));
      if (!slots) throw userError("templateSaveFailed");
      const record: SavedSpatialTemplate = { id: createTemplateId(templateLibrary.templates), name: message.name, template, nativeScene: copied.reference,
        slots,
        appearance: templateAppearance(template) };
      const next = checkedTemplateLibrary([...templateLibrary.templates, record]);
      if (!next) throw userError("templateSaveFailed");
      copied.root.setSharedPluginData("worldbend", "sceneTemplate", JSON.stringify({ id: record.id, name: record.name }));
      await figma.clientStorage.setAsync(TEMPLATE_LIBRARY_STORAGE_KEY, next);
      templateLibrary = next; postTemplateLibrary(mutation); figma.commitUndo();
    } catch (error) { if (created && !created.removed) created.remove(); throw error; }
    finally { applying = false; }
  });
}

async function useNativeScene(message: Extract<UiToMainMessage, { type: "use-native-scene" }>) {
  if (applying) { post({ type: "template-library-error", message: userMessage("applyAlreadyInProgress"), useRequestId: message.requestId }); return; }
  applying = true;
  try {
    const record = templateLibrary.templates.find(record => record.id === message.id);
    if (!record?.nativeScene || (record.template.operation.kind !== "mockup" && record.template.operation.kind !== "compositionProgram")) throw userError("templateSaveFailed");
    const selection = [...currentEditingSelection()], prepared = preparedSelection;
    const assertCurrent = () => {
      if (!prepared || prepared.generation !== message.generation || selectionGeneration !== message.generation || reloadScheduled ||
        selection.length !== record.nativeScene!.replaceSourceNodeIds.length || selection.some(node => node.removed) ||
        !sameIds(currentEditingSelection().map(node => node.id), selection.map(node => node.id))) throw userError("selectionChanged");
    };
    assertCurrent();
    const root = await figma.getNodeByIdAsync(record.nativeScene.rootNodeId), result = await figma.getNodeByIdAsync(record.nativeScene.resultNodeId);
    if (!root || root.type !== "FRAME" || !result || result.type !== "RECTANGLE") throw new Error("The saved scene is unavailable. Open its Figma file and page, or save the scene again.");
    const operation = readStoredOperation(result), operationSlots = readStoredOperationSlots(result);
    if (operation.status !== "valid" || operation.operation.kind !== "task" ||
      (operation.operation.task.kind !== "mockup" && operation.operation.task.kind !== "composition")) throw userError("invalidReusablePlane");
    const task = operation.operation.task.kind === "mockup" ? continuedCompositionTask(operation.operation.task.spec) : operation.operation.task;
    const placement = placementBeside([prepared!.payload.placement], { width: root.width, height: root.height },
      figma.currentPage.children.map(node => ({ x: node.x, y: node.y, width: node.width, height: node.height })));
    const copied = await copyNativeScene({ result, reference: record.nativeScene, expectedSlots: operationSlots, task, name: record.name, placement, replacements: selection, fit: message.fit, assertCurrent,
      begin() { clearSceneDraft(figma.currentPage); figma.commitUndo(); } });
    copied.root.setSharedPluginData("worldbend", "sceneTemplate", "");
    figma.currentPage.selection = [copied.result]; figma.viewport.scrollAndZoomIntoView([copied.preview]); loadSelectionNow();
  } catch (error) { post({ type: "template-library-error", message: toUserMessage(error, "unexpectedError"), useRequestId: message.requestId }); }
  finally { applying = false; }
}

function storedTemplateFromMessage(template: FigmaTaskTemplate): FigmaTaskTemplate {
  if (template.operation.kind === "canvas") return canvasTemplateFromSet(template.operation.spec,
    "outputNames" in template ? template.outputNames : undefined);
  if (template.operation.kind === "deformation") return deformationTemplateFromWork(template.operation.spec, template.operation.view);
  if (template.operation.kind === "mesh") return meshTemplateFromSpec(template.operation.spec);
  if (template.operation.kind === "surface") return surfaceTemplateFromSpec(template.operation.spec);
  if (template.operation.kind === "mockup") return spatialTemplateFromMockup(template.operation.spec);
  const spatial = template as FigmaSpatialTemplate;
  const previewOutputId = spatial.output.kind === "single"
    ? spatial.output.id
    : spatial.output.spec.variants[0]?.id ?? "";
  return spatialTemplateFromCompositionTask({
    kind: "composition",
    template: (({motion,...canonical})=>canonical)(spatial) as Extract<StoredDesignerTask, { kind: "composition" }>["template"],
    ...(spatial.motion?{motion:spatial.motion}:{}),
    previewOutputId,
  });
}

function createTemplateId(existing: readonly SavedSpatialTemplate[]): string {
  const used = new Set(existing.map((template) => template.id));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `template-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;
    if (id.length <= 64 && !used.has(id)) return id;
  }
  throw userError("templateSaveFailed");
}

function setLocalePreference(preference: LocalePreference): void {
  if (!uiInitialized) return;
  localePreference = preference;
  activeLocale = resolveLocale(preference, systemLocales);
  post({ type: "locale", preference, locale: activeLocale });
  localeSettings.queueWrite(preference, () => {
    post({ type: "preference-error", message: userMessage("languageSaveFailed") });
  });
}

function scheduleLoadSelection(): void {
  materialContextDirty = false;
  materialTrial.cancel();
  rememberSelectionIdentity();
  // Advancing the generation on the leading edge invalidates in-flight
  // exports and apply responses immediately. Waiting until the debounce fires
  // would let stale work from the previous selection land in the UI.
  if (!reloadScheduled) {
    selectionGeneration += 1;
    reloadScheduled = true;
    // One leading-edge notification invalidates the old selection. Further
    // node-change samples only extend the settle window; they do not restart
    // the panel's busy state or flood the bridge with identical messages.
    post({
      type: "selection-loading",
      generation: selectionGeneration,
      nodeIds: currentEditingSelection().map((node) => node.id),
    });
  }
  const generation = selectionGeneration;
  if (loadSelectionTimer !== undefined) clearTimeout(loadSelectionTimer);
  loadSelectionTimer = setTimeout(() => {
    loadSelectionTimer = undefined;
    if (generation !== selectionGeneration) return;
    reloadScheduled = false;
    void loadSelection(generation);
  }, SELECTION_SETTLE_DELAY_MS);
}

function loadSelectionNow(): void {
  cardOwnWrites.clear();
  cardObservedRoots.clear();
  cardObservedNodes.clear();
  rememberSelectionIdentity();
  if (loadSelectionTimer !== undefined) {
    clearTimeout(loadSelectionTimer);
    loadSelectionTimer = undefined;
  }
  reloadScheduled = false;
  const generation = ++selectionGeneration;
  void loadSelection(generation);
}

const selectionLoads = createLatestAsyncQueue(async (generation: number) => {
  if (generation === selectionGeneration) await loadSelectionSnapshot(generation);
});

function loadSelection(generation: number): void {
  // Figma exports cannot be cancelled. Keep one selection export active and
  // replace pending work with the latest settled selection instead of piling
  // up rasterizations while the designer types, resizes or switches layers.
  selectionLoads.request(generation);
}

function canReadSavedSceneContext(previous: SourcePayload | undefined, next: SourcePayload): boolean {
  if (!previous?.sceneContext || !next.sceneContext || !next.targetNodeId || previous.targetNodeId !== next.targetNodeId ||
    next.mockupDraft || next.mockupDraftUnavailable || !previous.task || !next.task ||
    (!previous.sceneContextReadOnly && sameJsonValue(previous.task, next.task))) return false;
  const before = previous.sources ?? [previous], after = next.sources ?? [next];
  return before.length === after.length && before.every((source, index) => {
    const incoming = after[index]!;
    return source.sourceNodeId === incoming.sourceNodeId && source.renderWidth === incoming.renderWidth &&
      source.renderHeight === incoming.renderHeight && sameJsonValue(source.placement, incoming.placement) &&
      source.bytes.length === incoming.bytes.length && source.bytes.every((byte, offset) => byte === incoming.bytes[offset]);
  });
}

async function loadSelectionSnapshot(generation: number): Promise<void> {
  const selection = [...currentEditingSelection()];
  observeLoadingSelection(selection);
  // The previous snapshot stays installed until the new one is ready so that
  // node changes landing inside the export window still invalidate through
  // it; applies during the window are rejected by the generation mismatch in
  // requirePreparedSelection.
  post({
    type: "selection-loading",
    generation,
    nodeIds: selection.map((node) => node.id),
  });
  try {
    const { payload, rendererRequest, binding, canvasTargetSize, mockupDraftRaw, sceneProof, rasterPaintSnapshot } = await selectionPayload(selection);
    if (selection[0] && readCardStill(selection[0])) payload.cardResult = true;
    if (selection[0] && presetOwner(selection[0])) payload.presetResult = true;
    const sourceIds = payload.sources?.map((source) => source.sourceNodeId) ?? [payload.sourceNodeId];
    const selectedSources = sourceIds.map((id) => selection.find((node) => node.id === id));
    const sources = selectedSources.every((node) => node !== undefined)
      ? selectedSources
      : await Promise.all(sourceIds.map((id) => figma.getNodeByIdAsync(id)));
    if (generation !== selectionGeneration) return;
    if (!sources.every((node): node is SceneNode => node !== null && isSceneNode(node))) {
      throw userError("linkedSourceUnavailable");
    }
    const previous = preparedSelection?.payload;
    if (payload.sceneContextReadOnly && previous && previous.targetNodeId === payload.targetNodeId) {
      const before = previous.sources ?? [previous], after = payload.sources ?? [payload];
      if (before.length !== after.length || !before.every((source, index) => {
        const incoming = after[index]!;
        return source.sourceNodeId === incoming.sourceNodeId && source.bytes.length === incoming.bytes.length &&
          source.bytes.every((byte, offset) => byte === incoming.bytes[offset]);
      })) delete payload.sceneContextReadOnly;
    }
    if (canReadSavedSceneContext(previous, payload)) payload.sceneContextReadOnly = true;
    const observedNodes = new Map(loadingSelection?.observedNodes);
    observeNodeTree(observedNodes, [...selection, ...sources]);
    preparedSelection = {
      generation,
      payload,
      selectedNodeIds: new Set(selection.map((node) => node.id)),
      observedNodes,
      observedNodeIds: new Set([...observedNodes.keys(), ...(payload.linkedResults?.items.map(result => result.nodeId) ?? [])]),
      ancestorNodeIds: selectionAncestorIds([...selection, ...sources]),
      ...(binding ? { binding } : {}),
      ...(canvasTargetSize ? {canvasTargetSize} : {}),
      ...(rasterPaintSnapshot !== undefined ? { rasterPaintSnapshot } : {}),
      ...(mockupDraftRaw !== undefined ? { mockupDraftRaw } : {}),
      ...(sceneProof ? { sceneProof } : {}),
    };
    setNativeSourceLayout(Boolean(payload.nativeSourceEditing));
    post({ type: "source", generation, payload });
    if (payload.nativeRendererPending && rendererRequest) {
      // Optional effect discovery must not occupy the source-export queue.
      // Retain only identities, not each obsolete snapshot's PNG bytes while
      // a shared import is pending across many content/selection refreshes.
      const { sourceNodeId, targetNodeId } = payload;
      void rendererRequest.then((renderer) => {
        const installed = preparedSelection?.payload;
        if (generation !== selectionGeneration || !installed || installed.sourceNodeId !== sourceNodeId ||
          installed.targetNodeId !== targetNodeId) return;
        if (renderer) installed.nativeRenderer = renderer;
        else delete installed.nativeRenderer;
        delete installed.nativeRendererPending;
        post({ type: "source-renderer", generation, sourceNodeId,
          ...(targetNodeId ? { targetNodeId } : {}),
          ...(renderer ? { renderer } : {}),
        });
      });
    }
  } catch (error) {
    if (generation !== selectionGeneration) return;
    // A broken wrapper must not trap selection inside its failed context;
    setNativeSourceLayout(false);
    // selecting Content is also an explicit recovery route.
    editingSelection = [];
    const node = selection.length === 1 ? selection[0] : undefined;
    const message = toUserMessage(error, "previewFailed");
    const recovery = message.key === "nativeResultChanged" && node?.type === "FRAME" && readNativeProjection(node)
      ? { nodeId: node.id, expected: node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) } : undefined;
    post({
      type: "selection-error",
      generation,
      message,
      ...(recovery ? { nativeRecovery: recovery } : {}),
    });
  } finally {
    loadingSelection = undefined;
  }
}

async function undoInHost(): Promise<void> {
  if (applying) return;
  const selected = currentEditingSelection();
  const result = selected.length === 1 && selected[0]?.type === "FRAME" ? selected[0] : undefined;
  const before = result && readNativeProjection(result);
  const revision = result && readResultBinding(result)?.revision;
  if (!result || !before || revision === undefined) {
    figma.triggerUndo();
    scheduleLoadSelection();
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const publicationUndo = nativePublicationUndoFor(result);
    publishing = true;
    await triggerNativeUndoAndWait(result, revision, publicationUndo);
    if (publicationUndo && matchesNativePublicationUndo(result, publicationUndo)) {
      await restoreNativePublicationUndo(result, publicationUndo, () => {
        if (!editingSelectionMatchesNode(result.id)) throw userError("selectionChanged");
      });
      return;
    }
    const after = result && !result.removed && readNativeProjection(result);
    if (result && before && after && revision !== undefined &&
      readResultBinding(result)?.revision === revision - 1 &&
      before.contentNodeId === after.contentNodeId) {
      try { await nativeDocumentParts(result); }
      catch {
        const expected = JSON.stringify(after);
        await restoreNativeProjection(result, () => {
          if (JSON.stringify(readNativeProjection(result)) !== expected ||
            !editingSelectionMatchesNode(result.id)) throw userError("selectionChanged");
        });
      }
    }
  } catch (error) {
    post({ type: "apply-error", generation: selectionGeneration, message: toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false; scheduleLoadSelection(); }
}

function triggerNativeUndoAndWait(
  result: FrameNode,
  revision: number,
  publicationUndo?: NativePublicationUndo,
): Promise<void> {
  const page = figma.currentPage;
  return new Promise((resolve, reject) => {
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    // Events drive completion; the deadline only bounds an absent/unsupported
    // host notification. Later mismatches retain the explicit recovery route.
    const deadline = setTimeout(() => finish(), 1000);
    const finish = (error?: unknown) => {
      clearTimeout(deadline);
      if (checkTimer !== undefined) clearTimeout(checkTimer);
      observeNativeUndo = undefined;
      if (error !== undefined) reject(error); else resolve();
    };
    const check = () => {
      checkTimer = undefined;
      if (result.removed || figma.currentPage.id !== page.id ||
        !editingSelectionMatchesNode(result.id)) {
        finish(userError("selectionChanged"));
        return;
      }
      const after = readNativeProjection(result);
      if (publicationUndo&&matchesNativePublicationUndo(result,publicationUndo))finish();
      else if (after && readResultBinding(result)?.revision === revision - 1) finish();
    };
    observeNativeUndo = () => {
      // Coalesce host changes before inspecting the matching record/binding.
      if (checkTimer === undefined) checkTimer = setTimeout(check, 0);
    };
    try { figma.triggerUndo(); observeNativeUndo(); }
    catch (error) { finish(error); }
  });
}

async function restoreNativeSelection(request: Extract<UiToMainMessage, { type: "restore-native" }>): Promise<void> {
  if (applying) return;
  // A failed preview releases the session anchor so Content can be selected
  // independently. Its offered repair still belongs to the containing result.
  let selected: BaseNode | null = figma.currentPage.selection[0] ?? null;
  while (selected && selected.id !== request.nodeId && selected.type !== "PAGE" && selected.type !== "DOCUMENT") {
    selected = selected.parent;
  }
  const node = selected?.type === "FRAME" ? selected : undefined;
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const check = () => {
      if (request.generation !== selectionGeneration ||
        !node || node.id !== request.nodeId || !selectionIsInside(node) ||
        node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) !== request.expected) throw userError("selectionChanged");
    };
    check();
    if (node?.type !== "FRAME") throw userError("nativeResultChanged");
    await restoreNativeProjection(node, () => { check(); beginPublication(); });
    editingSelection = [node];
  } catch (error) {
    post({ type: "apply-error", generation: request.generation, message: toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false; loadSelectionNow(); }
}

type SelectionPreview = {
  payload: SourcePayload;
  rendererRequest: ReturnType<typeof loadNativeRenderer> | undefined;
  binding?: StoredBinding;
  canvasTargetSize?: {width:number;height:number;outputName:string};
  rasterPaintSnapshot?: string;
  mockupDraftRaw?: string;
  sceneProof?: Awaited<ReturnType<typeof prepareSceneReadProof>>;
};

async function selectionPayload(selection: readonly SceneNode[]): Promise<SelectionPreview> {
  // The locked draft is plugin-owned feedback; if it ever reaches a
  // selection event it is ignored rather than treated as artwork.
  const draftFiltered = selection.filter((node) => !isSceneDraftNode(node));
  if (draftFiltered.length === 0) throw userError("selectOneSource");
  if (draftFiltered.length > 9) throw userError("selectOneOrPair");
  selection = draftFiltered;
  const candidates = selection.map((node) => ({ node, stored: readStoredOperation(node) }));
  if (candidates.some((candidate) => candidate.stored.status === "invalid")) {
    throw userError("invalidReusablePlane");
  }
  const targets = candidates.filter((candidate) => candidate.stored.status === "valid");
  if (targets.length > 1) throw userError("selectOneSourceAndResult");
  if (targets.length === 0) {
    if (selection.some((node) => node.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY) ||
      node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) ||
      node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_VECTOR_KEY)||node.getSharedPluginData(SHARED_NAMESPACE,NATIVE_PLACEMENT_KEY))) throw userError("invalidReusablePlane");
    if (selection.length > 8) throw userError("selectOneOrPair");
    const preview = await exportSources(selection);
    if (selection.length === 1) {
      // The current Figma host supports the indexed shared-data search. Older
      // plugin sandboxes can still edit one result through ordinary selection.
      if (typeof figma.currentPage.findAllWithCriteria === "function") {
        try {
          await figma.currentPage.loadAsync?.();
          const candidates = figma.currentPage.findAllWithCriteria({
            types: ["RECTANGLE", "FRAME"],
            sharedPluginData: { namespace: SHARED_NAMESPACE, keys: [SHARED_BINDING_KEY] },
          });
          const linked = linkedResultsForSource(candidates, selection[0]!);
          if (linked.total > 0) {
            preview.payload.linkedResults = linked;
            const linkedIds = new Set(linked.items.map(result => result.nodeId));
            observeLoadingSelection(candidates.filter(node => linkedIds.has(node.id)));
          }
        } catch {
          // Discovery must not prevent the selected source from being edited.
          preview.payload.linkedResultsUnavailable = true;
        }
      }
    }
    return preview;
  }
  const target = targets[0]!;
  if(target.stored.status==="valid"&&target.node.type==="FRAME"&&(readNativeVectorProjection(target.node)??readCopiedNativeVectorProjection(target.node))){
    let parts:Awaited<ReturnType<typeof nativeVectorDocumentParts>>;
    try{parts=await nativeVectorDocumentParts(target.node);}catch{throw userError("nativeVectorResultChanged");}
    const resolved=resolveNativeVectorOperation(parts.operation),extras=selection.filter(n=>n.id!==target.node.id);
    let sourceIds=[...parts.binding.sourceNodeIds];
    if(extras.length===resolved.sourceCount){
      sourceIds=sameIds(extras.map(n=>n.id),sourceIds)?sourceIds:extras.map(n=>n.id);
      if(resolved.sourceCount===2){const guideIndex=1-resolved.artworkSourceIndex,oldGuide=parts.binding.sourceNodeIds[guideIndex];
        if(extras.some(n=>n.id===oldGuide)){sourceIds[guideIndex]=oldGuide!;sourceIds[resolved.artworkSourceIndex]=extras.find(n=>n.id!==oldGuide)!.id;}}
    }else if(extras.length===1){
      const guideIndex=1-resolved.artworkSourceIndex;
      if(resolved.sourceCount===1||extras[0]!.id!==sourceIds[guideIndex])sourceIds[resolved.artworkSourceIndex]=extras[0]!.id;
    }else if(extras.length)throw userError("selectOneSourceAndResult");
    const nodes=await Promise.all(sourceIds.map(id=>figma.getNodeByIdAsync(id)));
    if(!nodes.every((n):n is SceneNode=>!!n&&isSceneNode(n)&&nodePage(n)?.id===figma.currentPage.id))throw userError("linkedSourceUnavailable");
    const preview=await exportSources(nodes,target.node,parts.operation);
    preview.payload.nativeVectorTarget=true;
    return preview;
  }
  if (target.stored.status === "valid" && target.stored.operation.kind === "transform" && target.node.type === "FRAME") {
    let content: FrameNode;
    let spec: TransformSpec;
    let affineState: SourcePayload["nativeAffineState"];
    let component:Awaited<ReturnType<typeof componentNativeParts>>|Awaited<ReturnType<typeof componentNativeMotionParts>>|undefined;
    const nativeRecord=readNativeProjection(target.node)??readCopiedNativeProjection(target.node);
    try {
      if(nativeRecord?.version==="0.3"){
        try{component=await componentNativeParts(target.node,nativeRecord);}
        catch{component=await componentNativeMotionParts(target.node,nativeRecord);}
        content=component.content;spec=component.spec;
        affineState="affineState" in component?component.affineState:undefined;
      }else({ content, spec, affineState } = await nativeDocumentParts(target.node));
    } catch { throw userError("nativeResultChanged"); }
    const replacements=selection.filter(node=>node.id!==target.node.id&&node.id!==content.id);
    if(replacements.length>1)throw userError("selectOneSourceAndResult");
    const source=component?.record.sourceEditing?component.masterContent:replacements[0]??content;
    if(source!==content&&!component?.record.sourceEditing&&(!canUseNativeSource(source)||!nativeAppearanceInsideViewport(source)))throw userError("nativeUnavailable");
    const preview = await exportSources([source], target.node, { kind: "transform", spec });
    preview.payload.nativeTarget = true;
    if(affineState)preview.payload.nativeAffineState=affineState;
    if((readNativeProjection(target.node)??readCopiedNativeProjection(target.node))?.version==="0.3"){
      preview.payload.nativeComponentTarget=true;
      preview.payload.nativeOutputBasis=target.node.absoluteTransform.map(row=>[...row]) as Transform;
    }
    if(component?.record.sourceEditing){
      preview.payload.nativeSourceEditing=true;preview.payload.nativeFrameSource=true;
      const nativeContent=component.master.type==="INSTANCE"?component.masterContent:content;
      preview.payload.nativeSourceSize={width:nativeContent.width,height:nativeContent.height};
      preview.payload.placement=nativePagePlacement(target.node,component.record.outputSize);
    }
    return preview;
  }
  if (target.stored.status !== "valid" || target.node.type !== "RECTANGLE") {
    throw userError("resultNotReplaceable");
  }
  let sources = candidates.filter((candidate) => candidate.node.id !== target.node.id).map((candidate) => candidate.node);
  const binding = readResultBinding(target.node);
  if (sources.length === 0) {
    if (!binding) throw userError("selectOneSourceAndResult");
    const resolved = await Promise.all(binding.sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)));
    if (!resolved.every((node): node is SceneNode =>
      node !== null && isSceneNode(node) && nodePage(node)?.id === figma.currentPage.id)) {
      throw userError("linkedSourceUnavailable");
    }
    sources = resolved;
  } else if (binding && sameIds(sources.map((source) => source.id), binding.sourceNodeIds)) {
    // Selection order is not source-slot order (especially after a marquee).
    sources = binding.sourceNodeIds.map((id) => sources.find((source) => source.id === id)!);
  }
  if (sources.length < 1 || sources.length > 8) throw userError("selectOneSourceAndResult");
  if (target.stored.operation.kind !== "task" && sources.length !== 1) {
    throw userError("selectOneSourceAndResult");
  }
  if (target.stored.operation.kind === "task" && sources.length !== taskSourceCount(target.stored.operation.task)) {
    throw userError("selectOneSourceAndResult");
  }
  return exportSources(sources, target.node, target.stored.operation);
}

async function exportSources(
  sources: readonly SceneNode[],
  target?: RectangleNode | FrameNode,
  storedOperation?: StoredOperation,
): Promise<SelectionPreview> {
  // Observe the source being read too, including a linked source outside the
  // selected result. This also protects the very first export before a
  // prepared snapshot exists.
  observeLoadingSelection(sources);
  const rasterPaintSnapshot = target?.type === "RECTANGLE" ? captureRasterPaints(target) : undefined;
  const canvasTargetSize = target && storedOperation?.kind === "canvas" ? {width:target.width,height:target.height,
    outputName:target.getSharedPluginData(SHARED_NAMESPACE,CANVAS_OUTPUT_NAME_KEY)} : undefined;
  if (target?.type === "RECTANGLE" && !rasterPaintsIntact(target)) throw userError("rasterResultPaintChanged");
  const rasterTarget = storedOperation?.kind === "transform" || storedOperation?.kind === "rectify"
    ? target
    : undefined;
  const nativeVectorRecord=target?.type==="FRAME"?(readNativeVectorProjection(target)??readCopiedNativeVectorProjection(target)):undefined;
  const nativeRecord = target?.type === "FRAME" ? (readNativeProjection(target) ?? readCopiedNativeProjection(target)) : undefined;
  let nativeMotion: SourcePayload["nativeMotion"];
  if (nativeRecord?.version === "0.3" && nativeRecord.renderer.kind === "projective") {
    let playheadPosition: number | undefined;
    try { playheadPosition = readNativeMotionPlayhead(figma); } catch { /* Optional beta context never blocks reopening. */ }
    if (playheadPosition !== undefined) nativeMotion = { playheadPosition };
  }
  const rasterTargetSize = nativeRecord && target
    ? { width: Math.ceil(target.width), height: Math.ceil(target.height) }
    : rasterTarget ? storedRasterSize(rasterTarget) : undefined;
  let nativeRenderer: SourcePayload["nativeRenderer"];
  let rendererPending = false;
  const ownedSource=!target&&sources.length===1&&sources[0]?.type==="FRAME"?await componentNativeSourceOwner(sources[0]):undefined;
  const componentSource=nativeRecord?.version==="0.3"&&target?.type==="FRAME"?componentNativeTopology(target).content:ownedSource?sources[0]:undefined;
  const nativeFrameSource = sources.length === 1 && (componentSource?.id===sources[0]!.id || canUseNativeSource(sources[0]!) &&
    Boolean(nativeRecord || nativeAppearanceInsideViewport(sources[0]!)));
  const rendererRequest = nativeFrameSource
    ? loadNativeRenderer(figma.currentPage, recordedNativeRenderer(nativeRecord), "publish").catch(() => undefined).then((renderer) => {
        rendererPending = false;
        nativeRenderer = renderer;
        return renderer;
      }) : undefined;
  rendererPending = Boolean(rendererRequest);
  const artworkIndex=storedOperation?.kind === "task" ? deformationArtworkIndex(storedOperation.task) : 0;
  const sceneProof = target?.type === "RECTANGLE" && canSaveNativeScene(target)
    ? await prepareSceneReadProof(sources) : undefined;
  const rasters = await Promise.all(sources.map((source, index) => exportSourceRaster(
      source,
      index === artworkIndex ? rasterTarget : undefined,
      index === artworkIndex ? rasterTargetSize : undefined,
      Boolean(nativeRecord) && index === artworkIndex,
      index===artworkIndex?nativeVectorRecord?.sourceView:undefined,
      componentSource?.id===source.id,
    )));
  const first = rasters[artworkIndex];
  let workpieceName: string | undefined;
  if (target && rasters.length > 1) {
    const scene = target.type === "RECTANGLE" ? nativeSceneForResult(target) : undefined;
    const owner = scene
      ? await figma.getNodeByIdAsync(scene.rootNodeId)
      : target.parent?.type === "FRAME" ? target.parent : target;
    const candidate = owner && "name" in owner && nodePage(owner)?.id === figma.currentPage.id
      ? owner.name.trim() : target.name.trim();
    if (candidate) workpieceName = candidate;
  }
  sceneProof?.validate();
  if (target?.type === "RECTANGLE" && (!rasterPaintsIntact(target) || !rasterPaintsMatch(target, rasterPaintSnapshot))) {
    throw userError("rasterResultPaintChanged");
  }
  if (!first) throw userError("selectOneSource");
  const targetBox = target?.absoluteBoundingBox;
  const primary = nativeRecord?.version==="0.3"&&target?.type==="FRAME"
    ? {...first,placement:nativePagePlacement(target,nativeRecord.sourceEditing?nativeRecord.outputSize:target)}
    : targetBox && targetBox.width > 0 && targetBox.height > 0
    ? { ...first, placement: { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: targetBox.height } }
    : first;
  const effectDraft = storedOperation?.kind === "task" && storedOperation.task.kind === "effect" && target?.type === "RECTANGLE"
    ? currentEffectDraft(target)
    : undefined;
  const mockupDraftRaw = storedOperation?.kind === "task" &&
    (storedOperation.task.kind === "mockup" || storedOperation.task.kind === "composition") && target?.type === "RECTANGLE"
    ? target.getSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY)
    : undefined;
  const mockupDraft = mockupDraftRaw && target?.type === "RECTANGLE"
    ? currentMockupDraft(target, mockupDraftRaw)
    : undefined;
  const binding = target ? readResultBinding(target) : undefined;
  const canvasOutputId = target && storedOperation?.kind === "canvas" ? readCanvasOutputId(target) : undefined;
  const canvasOutputName = target && storedOperation?.kind === "canvas" ? readCanvasOutputName(target) : undefined;
  const artworkSource = isArtworkVectorSource(sources[artworkIndex]!) ? sources[artworkIndex]! : undefined;
  const vectorSource = isNativeVectorArtwork(sources[artworkIndex]!) || Boolean(artworkSource);
  // Selection/Undo reads must not create temporary geometry: even net-zero
  // document writes can erase Figma's redo history. Resolve only on Apply.
  // The artwork probe reads structure and loads fonts only; geometry resolves
  // on Apply.
  const nativeVector = canCaptureNativeVectorSource(sources[artworkIndex]!) ? true
    : artworkSource ? await canCaptureArtworkVectorSource(artworkSource, figma)
    : false;
  return { rendererRequest, ...(binding ? { binding } : {}),
    ...(canvasTargetSize ? {canvasTargetSize} : {}),
    ...(rasterPaintSnapshot !== undefined ? { rasterPaintSnapshot } : {}),
    ...(sceneProof ? { sceneProof } : {}),
    ...(mockupDraftRaw !== undefined ? { mockupDraftRaw } : {}), payload: {
    ...primary,
    ...(ownedSource&&sources[0]?.type==="FRAME"?{nativeOutputBasis:[
      [ownedSource.absoluteTransform[0][0],ownedSource.absoluteTransform[0][1],sources[0].absoluteTransform[0][2]],
      [ownedSource.absoluteTransform[1][0],ownedSource.absoluteTransform[1][1],sources[0].absoluteTransform[1][2]],
    ] as Transform}:{}),
    ...(nativeRenderer ? { nativeRenderer } : {}),
    ...(nativeFrameSource ? { nativeFrameSource: true as const, nativeSourceSize: {width:sources[0]!.width,height:sources[0]!.height} } : {}),
    ...(nativeRecord ? {nativeRevision:binding?.revision??0} : {}),
    ...(nativeMotion ? { nativeMotion } : {}),
    ...(vectorSource ? { vectorSource: true as const } : {}),
    ...(artworkSource ? { artworkSource: true as const } : {}),
    ...(nativeVector ? { nativeVector: true as const,nativeVectorSourceView:nativeVectorRecord?.sourceView?retainedNativeVectorSourceView(sources[artworkIndex]!,nativeVectorRecord.sourceView):nativeVectorSourceView(sources[artworkIndex]!,nativeRecord?"logical":undefined) } : {}),
    ...(rendererPending ? { nativeRendererPending: true } : {}),
    ...(workpieceName ? { workpieceName } : {}),
    ...(rasters.length > 1 || storedOperation?.kind === "task" ? { sources: rasters } : {}),
    ...(storedOperation?.kind === "transform" && target ? { spec: storedOperation.spec, targetNodeId: target.id } : {}),
    ...(storedOperation?.kind === "rectify" && target ? { rectification: storedOperation.spec, targetNodeId: target.id } : {}),
    ...(storedOperation?.kind === "canvas" && target ? { canvas: storedOperation.spec, targetNodeId: target.id,
      ...(binding ? {targetRasterSize:{width:binding.renderWidth,height:binding.renderHeight}} : {}),
      ...(canvasOutputId ? { canvasOutputId } : {}),
      ...(canvasOutputName ? {canvasOutputName} : {}) } : {}),
    ...(storedOperation?.kind === "task" && target ? {
      task: storedOperation.task,
      ...(binding ? { targetRasterSize: { width: binding.renderWidth, height: binding.renderHeight } } : {}),
      ...(effectDraft ? { effectDraft } : {}),
      ...(mockupDraft ? { mockupDraft } : {}),
      ...(mockupDraftRaw && !mockupDraft ? { mockupDraftUnavailable: true as const } : {}),
      targetNodeId: target.id,
      ...(canSaveNativeScene(target) ? { sceneContext: true as const } : {}),
      ...(sceneProof && target.type === "RECTANGLE" && !mockupDraftRaw && matchesSceneReadProof(target, sceneProof.fingerprint)
        ? { sceneContextReadOnly: true as const } : {}),
    } : {}),
  } };
}

function currentEffectDraft(target: RectangleNode) {
  const value = target.getSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY);
  if (!value) return undefined;
  const draft = parseStoredEffectDraft(value);
  const binding = readResultBinding(target);
  return draft && binding && draft.baseRevision === binding.revision ? draft : undefined;
}

function currentMockupDraft(target: RectangleNode, value: string) {
  const draft = parseStoredMockupDraft(value);
  const binding = readResultBinding(target);
  if (!draft || !binding || draft.baseRevision !== binding.revision) return undefined;
  // Match the Agent handoff's usability rule: a draft that no longer covers
  // the linked source slots is unusable, not a workspace that fails to render.
  const slots = new Set(compositionMockup(draft.task).planes.map((plane) => plane.sourceId));
  const count = binding.sourceNodeIds.length;
  return count >= 1 && count <= 8 && slots.size === count &&
    Array.from({ length: count }, (_, index) => `source-${index + 1}`).every((slot) => slots.has(slot))
    ? draft
    : undefined;
}

async function exportSourceRaster(
  source: SceneNode,
  target?: RectangleNode | FrameNode,
  targetRasterSize?: { width: number; height: number },
  logicalViewport = false,
  vectorView?:import("./native-vector-view").NativeVectorSourceView,
  componentSource = false,
): Promise<SourcePayload> {
  // A linked result can consume an owned Content plane too. Its logical
  // pixels must not acquire the native ancestor transform again on reopen.
  const ownedContent=componentSource||source.type==="FRAME"&&Boolean(await componentNativeSourceOwner(source));
  const capture=ownedContent&&source.type==="FRAME"?nativeCaptureSnapshot(source):undefined;
  const view=vectorView?retainedNativeVectorSourceView(source,vectorView):undefined;
  const box = capture?.box??sourceRasterViewBox(source,logicalViewport,view);
  if (!box || box.width <= 0 || box.height <= 0) {
    throw userError("sourceNeedsVisibleBounds");
  }
  const placementBox = target?.absoluteBoundingBox ?? box;
  if (!placementBox || placementBox.width <= 0 || placementBox.height <= 0) {
    throw userError("resultNeedsVisibleBounds");
  }

  const desiredWidth = targetRasterSize?.width ??
    (target ? target.width : Math.max(1, Math.round(capture?.logicalSize.width??box.width)));
  const desiredHeight = targetRasterSize?.height ??
    (target ? target.height : Math.max(1, Math.round(capture?.logicalSize.height??box.height)));
  const renderWidth = checkedOutputAxis(desiredWidth);
  const renderHeight = checkedOutputAxis(desiredHeight);
  const samplingSize=capture?.logicalSize??box;
  const desiredScale = Math.max(1, renderWidth / samplingSize.width, renderHeight / samplingSize.height);
  const maximumScale = Math.min(
    MAX_FIGMA_IMAGE_AXIS / box.width,
    MAX_FIGMA_IMAGE_AXIS / box.height,
  );
  const exportScale = Math.min(desiredScale, maximumScale);
  if (!Number.isFinite(exportScale) || exportScale <= 0) {
    throw userError("sourceUnsupportedSize");
  }
  const bytes = await withTimeout(
    source.exportAsync({
      format: "PNG",
      // Capture and metadata must name the same view box, including the
      // selected layer's own outside effects and strokes.
      ...(capture?{useAbsoluteBounds:true}:view?{useAbsoluteBounds:view.policy==="logical"}:sourceRasterBounds(source, logicalViewport)),
      constraint: { type: "SCALE", value: exportScale },
    }),
    SOURCE_EXPORT_TIMEOUT_MS,
    () => userError("sourceExportTimedOut"),
  );
  if(view?!nativeVectorSourceViewMatches(source,view):!capture&&!sameSourceRasterViewBox(source,box,logicalViewport))throw userError("selectionChanged");
  const quadGuide = documentQuadForSource(source);
  const shapeGuide = await captureDocumentShapeForSource(source);
  return {
    bytes,
    ...(capture&&source.type==="FRAME"?{captureFacts:nativeCaptureFacts(source,capture,bytes,exportScale)}:{}),
    sourceNodeId: source.id,
    sourceName: source.name,
    renderWidth,
    renderHeight,
    placement: capture&&!target&&source.type==="FRAME"?nativePagePlacement(source):{
      x: placementBox.x,
      y: placementBox.y,
      width: placementBox.width,
      height: placementBox.height,
    },
    ...(quadGuide ? { quadGuide } : {}),
    ...(shapeGuide ? { shapeGuide } : {}),
  };
}

function taskSourceCount(task: StoredDesignerTask): number {
  if (task.kind === "deformation") return deformationTaskSourceCount(task);
  if (task.kind === "effect") return task.recipe.layers.length;
  if (task.kind === "mockup" || task.kind === "composition") {
    return new Set(compositionMockup(task).planes.map((plane) => plane.sourceId)).size;
  }
  if (task.kind === "remap" && task.spec.operation.kind === "displacement") return 2;
  return 1;
}

async function refreshSourceRaster(
  request: Extract<UiToMainMessage, { type: "request-source-raster" }>,
): Promise<void> {
  try {
    if (
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      !preparedSelection ||
      preparedSelection.generation !== request.generation ||
      preparedSelection.payload.sourceNodeId !== request.sourceNodeId ||
      preparedSelection.payload.targetNodeId !== request.targetNodeId ||
      !selectionMatches(request.sourceNodeId, request.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }
    const source = await figma.getNodeByIdAsync(request.sourceNodeId);
    if (!source || !isSceneNode(source)) throw userError("selectionChanged");
    const logicalViewport = Boolean(preparedSelection.payload.nativeTarget);
    const capture=preparedSelection.payload.captureFacts&&source.type==="FRAME"?nativeCaptureSnapshot(source):undefined;
    const box = capture?.box??sourceRasterViewBox(source, logicalViewport);
    if (!box || box.width <= 0 || box.height <= 0) {
      throw userError("sourceNeedsVisibleBounds");
    }
    const samplingSize=capture?.logicalSize??box;
    const requestedScale = Math.max(
      request.desiredWidth / samplingSize.width,
      request.desiredHeight / samplingSize.height,
    );
    const maximumScale = Math.min(
      MAX_FIGMA_IMAGE_AXIS / box.width,
      MAX_FIGMA_IMAGE_AXIS / box.height,
    );
    const exportScale = Math.min(requestedScale, maximumScale);
    if (!Number.isFinite(exportScale) || exportScale <= 0) {
      throw userError("sourceUnsupportedSize");
    }
    const bytes = await withTimeout(
      source.exportAsync({
        format: "PNG",
        ...(capture?{useAbsoluteBounds:true}:sourceRasterBounds(source, logicalViewport)),
        constraint: { type: "SCALE", value: exportScale },
      }),
      SOURCE_EXPORT_TIMEOUT_MS,
      () => userError("sourceExportTimedOut"),
    );
    if (
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      !capture&&!sameSourceRasterViewBox(source, box, logicalViewport) ||
      !selectionMatches(request.sourceNodeId, request.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }
    post({
      type: "source-raster",
      generation: request.generation,
      requestId: request.requestId,
      bytes,
      ...(capture&&source.type==="FRAME"?{captureFacts:nativeCaptureFacts(source,capture,bytes,exportScale)}:{}),
    });
  } catch (error) {
    post({
      type: "source-raster-error",
      generation: request.generation,
      requestId: request.requestId,
      message: toUserMessage(error, "previewFailed"),
    });
  }
}

async function applyNativeResult(payload: NativeApplyPayload): Promise<void> {
  const generation = payload.generation;
  let sourceViewFinished=false;
  if (applying) {
    post({ type: "apply-error", generation, message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const prepared = requirePreparedSelection(payload);
    if(prepared.nativeComponentTarget&&!payload.duplicate&&payload.targetNodeId&&readNativeMotionPlayhead(figma)!==undefined) {
      throw userError("nativeMotionCloseForUpdate");
    }
    const affineCarrier=payload.nativePlan?.kind==="affine"&&
      (!prepared.nativeTarget||prepared.nativeComponentTarget||payload.duplicate);
    const [selectedSource, renderer, target] = await Promise.all([
      figma.getNodeByIdAsync(payload.sourceNodeId),
      affineCarrier?undefined:loadNativeRenderer(figma.currentPage, prepared.nativeRenderer?.id),
      payload.targetNodeId ? figma.getNodeByIdAsync(payload.targetNodeId) : undefined,
    ]);
    const editing=prepared.nativeSourceEditing&&target?.type==="FRAME"?await componentNativeParts(target):undefined;
    if(editing&&editing.masterContent.id!==selectedSource?.id)throw userError("selectionChanged");
    const source=editing?(editing.master.type==="INSTANCE"?editing.masterContent:editing.content):selectedSource;
    if (generation !== selectionGeneration || reloadScheduled || !selectionMatches(payload.sourceNodeId, payload.targetNodeId)) {
      throw userError("selectionChanged");
    }
    if (!source || source.type!=="FRAME" || (!prepared.nativeComponentTarget&&!canUseNativeSource(source)) || (!renderer&&!affineCarrier)) throw userError("nativeUnavailable");
    const existing = prepared.nativeTarget && !payload.duplicate && target?.type === "FRAME" ? target : undefined;
    if (existing && nodePage(existing)?.id !== figma.currentPage.id) throw userError("nativeResultChanged");
    const replacingSource=existing&&(await nativeDocumentParts(existing)).content.id!==source.id;
    // Readback page transforms are float32 in the host. Preserve the exact
    // local origin when no position change was requested instead of repeatedly
    // converting that rounded page point back through a rotated parent.
    const pagePoint=nativePlacementPagePoint(payload.placement,prepared.nativeOutputBasis);
    const localPoint=existing&&pagePoint.x===prepared.placement.x&&pagePoint.y===prepared.placement.y
      ?{x:existing.x,y:existing.y}:existing?parentPointFromAbsolute(existing,pagePoint):undefined;
    const freeBounds=existing?undefined:placementBeside(inputPlacements(figma.currentPage, prepared),
      nativeOutputBounds(payload.placement,prepared.nativeOutputBasis),pagePlacements(figma.currentPage, prepared));
    const pageBasis=freeBounds?nativeOutputAtBounds(payload.placement,freeBounds,prepared.nativeOutputBasis):undefined;
    const placement = existing ? { ...payload.placement, ...localPoint! }
      : {...payload.placement,x:pageBasis![0][2],y:pageBasis![1][2]};
    const result = await publishNativeResult({
      source, ...(existing ? { existing } : {}), ...(renderer?{renderer}:{}),
      spec: payload.spec, inverse: payload.inverse, placement, ...(payload.nativePlan?{nativePlan:payload.nativePlan}:{}),
      ...(existing?{replaceContent:true}:{}),
      renderWidth: payload.renderWidth, renderHeight: payload.renderHeight,
      beforeWrite: () => {
        if (generation !== selectionGeneration || reloadScheduled ||
          !selectionMatches(payload.sourceNodeId, payload.targetNodeId)) throw userError("selectionChanged");
        beginPublication();
      },
    });
    // A completed source swap resumes the independent result. Keeping the
    // source/result pair would replace Content again on every later Update.
    if(editing||replacingSource){editingSelection=[result];figma.currentPage.selection=[result];sourceViewFinished=true;}
    finishAppliedResult(result, [source], existing ? "replace" : "apply", generation);
    figma.commitUndo();
  } catch (error) {
    console.warn("Worldbend native publication failed",error);
    post({ type: "apply-error", generation, message: error instanceof NativeRollbackIncompleteError
      ? userMessage("rollbackIncomplete") : toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false;if(sourceViewFinished)loadSelectionNow(); }
}

async function editNativeSource(message:Extract<UiToMainMessage,{type:"edit-native-source"}>):Promise<void>{
  if(applying)return;
  applying=true;
  try{
    const prepared=preparedSelection;
    const valid=()=>prepared===preparedSelection&&prepared?.generation===message.generation&&message.generation===selectionGeneration&&
      !reloadScheduled&&prepared.payload.nativeComponentTarget&&prepared.payload.sourceNodeId===message.sourceNodeId&&
      prepared.payload.targetNodeId===message.targetNodeId&&selectionMatches(message.sourceNodeId,message.targetNodeId);
    if(!valid())throw userError("selectionChanged");
    if(readNativeMotionPlayhead(figma)!==undefined)throw userError("nativeMotionCloseForUpdate");
    const result=await figma.getNodeByIdAsync(message.targetNodeId);
    if(result?.type!=="FRAME")throw userError("nativeResultChanged");
    const source=await showComponentNativeSource(result,message.spec,()=>{if(!valid())throw userError("selectionChanged");beginPublication();});
    editingSelection=[result];figma.currentPage.selection=[source];
    figma.viewport.scrollAndZoomIntoView([source]);
  }catch(error){post({type:"apply-error",generation:message.generation,message:toUserMessage(error,"nativeApplyFailed")});}
  finally{applying=false;publishing=false;loadSelectionNow();}
}

/**
 * The main thread owns the fresh source read: it resolves the placement,
 * maps the Figma vector onto the shared core input, and hands that pure data
 * to the UI, which relays it through the same WASM bridge every carrier
 * uses. The core owns the projection semantics; the main thread never
 * computes geometry itself.
 */
async function nativeVectorJobContext(payload:NativeVectorProjectionPayload,prepared:SourcePayload,existing?:FrameNode,expectedSourceIds?:readonly string[]){
  const operation=payload.operation??{kind:"transform" as const,spec:payload.spec},resolved=resolveNativeVectorOperation(operation);
  const ids=payload.sourceNodeIds??[payload.sourceNodeId],preparedIds=expectedSourceIds??prepared.sources?.map(n=>n.sourceNodeId)??[prepared.sourceNodeId];
  if(ids.length!==resolved.sourceCount||ids.some((id,i)=>id!==preparedIds[i])||ids[resolved.artworkSourceIndex]!==payload.sourceNodeId||
    vectorValue(resolved.plane)!==vectorValue(payload.spec))throw userError("selectionChanged");
  // A guide-bound task must describe the guide that is live right now: the
  // fitted clip is re-read from the document, so a stale or forged capture
  // cannot publish geometry the current guide does not own.
  if(operation.kind==="task"&&operation.task.shapeGuideSourceIndex!==undefined){
    const guideId=ids[operation.task.shapeGuideSourceIndex]!;
    const guide=await figma.getNodeByIdAsync(guideId);
    const shape=guide&&isSceneNode(guide)&&!guide.removed?await captureDocumentShapeForSource(guide):undefined;
    if(!shape||!sameJsonValue(operation.task.spec.shapeFit?.clip,normalizedDocumentShape(shape)))
      throw userError(guide&&isSceneNode(guide)?"selectionChanged":"linkedGuideUnavailable");
  }
  const operationExpected=nativeVectorOperationDigest(operation);
  if(payload.operationExpected!==undefined&&payload.operationExpected!==operationExpected)throw userError("selectionChanged");
  // A selected Shader Frame is context, not the Vector result being replaced.
  // Its intentionally retained Content may be an independent new Vector source.
  const proof=await vectorSourcesProof({fileKey:figma.fileKey!,pageId:figma.currentPage.id,nodeId:existing?.id??""},operation,ids);
  const reportedView=currentNativeVectorSourceView(proof.artwork,payload.sourceView??prepared.nativeVectorSourceView);
  const sourceView=payload.sourceView??reportedView;
  if(!nativeVectorSourceViewMatches(proof.artwork,sourceView))throw userError("selectionChanged");
  const validate=()=>{proof.validate();if(!nativeVectorSourceViewMatches(proof.artwork,sourceView))throw userError("selectionChanged");};
  validate();
  return {...proof,operation,operationExpected,sourceView,sourceNodeIds:ids,validate,
    sourceFingerprint:nativeVectorReadFingerprint(vectorValue({source:proof.sourceExpected,operation:operationExpected,sourceView:reportedView}))};
}

async function nativeVectorSelection(payload:NativeVectorProjectionPayload){
  const batchId=payload.batchResultId;
  const prepared=batchId?preparedSelection?.payload:requirePreparedSelection(payload);
  if(!prepared)throw userError("selectionChanged");
  const [source,target]=await Promise.all([figma.getNodeByIdAsync(payload.sourceNodeId),
    payload.targetNodeId?figma.getNodeByIdAsync(payload.targetNodeId):undefined]);
  if(!source||!isSceneNode(source)||(!isNativeVectorArtwork(source)&&!isArtworkVectorSource(source)))throw userError("nativeVectorUnavailable");
  const existing=(batchId||prepared.nativeVectorTarget)&&!payload.duplicate&&target?.type==="FRAME"?target:undefined;
  const candidate=batchId?linkedBatchCandidates.get(batchId):undefined;
  const expectedSourceIds=batchId?readResultBinding(existing??source)?.sourceNodeIds:undefined;
  const check=()=>{
    if(payload.generation!==selectionGeneration||reloadScheduled||source.removed||
      !selectionMatches(batchId?prepared.sourceNodeId:payload.sourceNodeId,batchId?undefined:payload.targetNodeId))throw userError("selectionChanged");
    if(existing&&nodePage(existing)?.id!==figma.currentPage.id)throw userError("nativeVectorResultChanged");
    if(batchId){
      const stored=existing&&readStoredOperation(existing);
      // A guide-bound refresh replaces only guide-derived fitting geometry; the
      // operation's authored controls must still match the stored work exactly.
      const guideBound=payload.operation?.kind==="task"&&payload.operation.task.kind==="deformation"&&payload.operation.task.shapeGuideSourceIndex!==undefined;
      const digest=guideBound?guideIndependentNativeVectorDigest:nativeVectorOperationDigest;
      const sourceCount=payload.operation?resolveNativeVectorOperation(payload.operation).sourceCount:1;
      if(prepared.targetNodeId||(prepared.sources?.length??0)>0||!existing||payload.targetNodeId!==batchId||
        !candidate?.nativeVector||candidate.batchRunId!==payload.batchRunId||candidate.generation!==payload.generation||candidate.snapshot!==linkedBatchSnapshot(existing)||
        !candidate.dependencyNodeIds.every(id=>linkedBatchCompleted.has(id))||stored?.status!=="valid"||!payload.operation||
        digest(stored.operation)!==digest(payload.operation)||
        !expectedSourceIds||!sameIds(expectedSourceIds,payload.sourceNodeIds??[])||expectedSourceIds.length!==sourceCount)
        throw userError("resultChanged");
    }
  };
  check();
  if(batchId){
    try{await nativeVectorDocumentParts(existing!);}catch{throw userError("nativeVectorResultChanged");}
    check();
  }
  return {prepared,source,existing,expectedSourceIds,check,previousChildren:existing?.children.map(n=>n.id)??[]};
}

let nativeVectorUndoBoundary:{generation:number;sourceFingerprint:string}|undefined;
async function requestNativeVectorProjection(payload: NativeVectorProjectionPayload): Promise<void> {
  const generation = payload.generation;
  if (applying) {
    post({ type: "native-vector-projection-error", generation, ...(payload.batchResultId?{batchResultId:payload.batchResultId,batchRunId:payload.batchRunId!}:{}), message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  try {
    const selection=await nativeVectorSelection(payload);
    const {prepared,source,existing}=selection;
    const placement = existing ? payload.placement : placementBeside(
      inputPlacements(figma.currentPage, prepared), payload.placement, pagePlacements(figma.currentPage, prepared),
    );
    const context=await nativeVectorJobContext(payload,prepared,existing,selection.expectedSourceIds);
    const sourceFingerprint=context.sourceFingerprint;
    // This request is the first phase of explicit Apply. Seal prior user work
    // BEFORE native capture/preparation creates any temporary document nodes;
    // both phases then become one real update, not an invisible staging item.
    figma.commitUndo();
    nativeVectorUndoBoundary={generation,sourceFingerprint};
    const inputs=await buildArtworkOrSingleInputs(source,{...payload,sourceView:context.sourceView},placement);
    selection.check();
    context.validate();
    post({
      type: "native-vector-projection",
      generation,
      ...(payload.batchResultId?{batchResultId:payload.batchResultId,batchRunId:payload.batchRunId!}:{}),
      inputs,
      placement,
      sourceFingerprint,sourceView:context.sourceView,operationExpected:context.operationExpected,
    });
  } catch (error) {
    if(nativeVectorUndoBoundary?.generation===generation)nativeVectorUndoBoundary=undefined;
    console.warn("Worldbend vector capture failed", error instanceof Error ? error.message : "Native capture refused");
    post({ type: "native-vector-projection-error", generation, ...(payload.batchResultId?{batchResultId:payload.batchResultId,batchRunId:payload.batchRunId!}:{}), message: toUserMessage(error, "nativeVectorApplyFailed") });
  } finally { applying = false; }
}

/** Fresh capture for the projection request: one core input per captured
 * part, or the single-source input for primitive artwork. */
async function buildArtworkOrSingleInputs(
  source: SceneNode, payload: NativeVectorProjectionPayload, placement: { width: number; height: number },
) {
  if (isArtworkVectorSource(source)) {
    const geometries = await captureArtworkVectorGeometryCached(source);
    if (!geometries || geometries.length < 1) throw userError("nativeVectorUnavailable");
    const box=payload.sourceView?.bounds??sourceRasterViewBox(source,Boolean(preparedSelection?.payload.nativeTarget));
    if (!box || box.width <= 0 || box.height <= 0) throw userError("nativeVectorUnavailable");
    return geometries.map((geometry) => buildNativeVectorProjectionInput({
      source: geometry,
      matrix: payload.matrix,
      reference: { width: payload.renderWidth, height: payload.renderHeight },
      placement: { width: placement.width, height: placement.height },
      // The common preview/output window includes the artwork's own outside
      // paint. Native capture retains each part's original logical geometry.
      artworkBounds: { x: box.x, y: box.y, width: box.width, height: box.height },
    }));
  }
  const geometry=await captureSourceVectorGeometry(source,Boolean(payload.operation)||payload.sourceView?.policy==="appearance");
  if (!geometry) throw userError("nativeVectorUnavailable");
  const box=payload.sourceView?.bounds??sourceRasterViewBox(source,Boolean(preparedSelection?.payload.nativeTarget));
  if (!box) throw userError("nativeVectorUnavailable");
  return [buildNativeVectorProjectionInput({
    source: geometry,
    matrix: payload.matrix,
    reference: { width: payload.renderWidth, height: payload.renderHeight },
    placement: { width: placement.width, height: placement.height },
    artworkBounds: box,
  })];
}


async function applyNativeVector(payload: NativeVectorApplyPayload): Promise<void> {
  const generation = payload.generation;
  if (applying) {
    post({ type: !payload.batchResultId&&payload.operation?.kind==="task"?"apply-designer-error":"apply-error", generation, ...(payload.batchResultId?{batchResultId:payload.batchResultId,batchRunId:payload.batchRunId!}:{}), message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const selection=await nativeVectorSelection(payload);
    const {prepared,source,existing}=selection;
    if(nativeVectorUndoBoundary?.generation!==generation||
      nativeVectorUndoBoundary.sourceFingerprint!==payload.projection.sourceFingerprint)figma.commitUndo();
    nativeVectorUndoBoundary=undefined;
    const resolved = existing ? payload.placement : placementBeside(
      inputPlacements(figma.currentPage, prepared), payload.placement, pagePlacements(figma.currentPage, prepared),
    );
    // The projection was computed for the placement resolved at request
    // time; a page change that moves the tight placement invalidates it.
    const close = (left: number, right: number) => Math.abs(left - right) <= Math.max(1e-4, Math.abs(right) * 1e-6);
    if (!close(resolved.width, payload.placement.width) || !close(resolved.height, payload.placement.height)) {
      throw userError("selectionChanged");
    }
    const context=await nativeVectorJobContext(payload,prepared,existing,selection.expectedSourceIds);
    if(context.sourceFingerprint!==payload.projection.sourceFingerprint)throw new Error("Native vector source/work/view changed");
    // One publication part per relayed projection, matched back to its fresh
    // capture in paint order; the outputs and geometries must pair exactly.
    const parts: NativeVectorPublicationPart[] = [];
    if (isArtworkVectorSource(source)) {
      const geometries = await captureArtworkVectorGeometryCached(source);
      if (!geometries || geometries.length !== payload.projection.outputs.length) {
        throw userError("nativeVectorUnavailable");
      }
      parts.push(...geometries.map((geometry, index) => ({
        geometry, projection: payload.projection.outputs[index]!,
      })));
    } else {
      const geometry=await captureSourceVectorGeometry(source,Boolean(payload.operation)||context.sourceView.policy==="appearance");
      if (!geometry || payload.projection.outputs.length !== 1) throw userError("nativeVectorUnavailable");
      parts.push({ geometry, projection: payload.projection.outputs[0]! });
    }
    context.validate();
    const result = await publishNativeVectorResult({
      source,
      parts,
      ...(existing ? { existing } : {}),
      spec: payload.spec,operation:context.operation,operationExpected:context.operationExpected,sourceNodeIds:context.sourceNodeIds,sourceView:context.sourceView,
      ...(payload.executionFrame ? {executionFrame:payload.executionFrame} : {}),
      ...(payload.projection.clip?{clip:payload.projection.clip}:{}),
      matrix: payload.matrix,
      placement: resolved,
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
      beforeWrite: () => {
        context.validate();
        selection.check();
        // Keep the last checked write boundary and retired-preview sweep;
        // the undo boundary was sealed before any preparation mutation.
        markPublicationStarted();
      },
      validateWrite: () => {
        context.validate();
        selection.check();
      },
    });
    if(payload.batchResultId){
      recordNativeBatchWrite(result,selection.previousChildren,generation);
      linkedBatchCompleted.add(result.id);linkedBatchCandidates.delete(result.id);
      finishAppliedResult(result,context.sources,"replace",generation,readNativeVectorProjection(result)!.fidelity,false,
        {reveal:false,notify:false,batchResultId:result.id,batchRunId:payload.batchRunId!});
    }else if(context.operation.kind==="task"){
      if(existing&&preparedSelection){const {deformationDraft,...old}=preparedSelection.payload;preparedSelection.payload={...old,task:context.operation.task,nativeVectorSourceView:context.sourceView};}
      try{result.setRelaunchData({edit:""});figma.viewport.scrollAndZoomIntoView([result,...context.sources]);figma.notify(translate(activeLocale,nativeVectorStatusMessage(readNativeVectorProjection(result)!.fidelity)));}catch{}
      try{figma.commitUndo();}catch{}
      post({type:"apply-designer-complete",generation,targetNodeId:result.id,operation:existing?"replace":"apply",vectorFidelity:readNativeVectorProjection(result)!.fidelity});
    }else finishAppliedResult(result,context.sources,existing?"replace":"apply",generation,readNativeVectorProjection(result)!.fidelity);
  } catch (error) {
    console.warn("Worldbend vector publication failed", error instanceof Error ? error.message : "Native publication refused");
    post({ type: !payload.batchResultId&&payload.operation?.kind==="task"?"apply-designer-error":"apply-error", generation, ...(payload.batchResultId?{batchResultId:payload.batchResultId,batchRunId:payload.batchRunId!}:{}), message: error instanceof NativeVectorRollbackIncompleteError
      ? userMessage("rollbackIncomplete") : toUserMessage(error, "nativeVectorApplyFailed") });
  } finally { applying = false; publishing = false; }
}

function observeNativeVectorCapture(node: SceneNode): void {
  node.setPluginData("sceneDraft", "1");
  observedDraftNodeIds.add(node.id);
}

// Reuse recent detached vector captures between projection and publication.
// Keys include the whole current source and world placement; never reuse stale
// geometry after a path, material, radius or native parameter change.
const nativeVectorCaptures = new Map<string, Awaited<ReturnType<typeof captureNativeVectorSource>>>();
function captureKey(source: SceneNode): string {
  return `${figma.currentPage.id}:${source.id}:${nativeVectorArtworkFingerprint(source)}`;
}
async function captureSourceVectorGeometry(source:SceneNode,outlineStroke=false) {
  const key=`${captureKey(source)}:${outlineStroke?"native-outline":"admitted-uniform"}`;
  if (nativeVectorCaptures.has(key)) return nativeVectorCaptures.get(key);
  const geometry = await captureNativeVectorSource(source,figma,observeNativeVectorCapture,undefined,{outlineStroke});
  if(source.removed||`${captureKey(source)}:${outlineStroke?"native-outline":"admitted-uniform"}`!==key) throw userError("selectionChanged");
  nativeVectorCaptures.set(key, geometry);
  if (nativeVectorCaptures.size > 16) nativeVectorCaptures.delete(nativeVectorCaptures.keys().next().value!);
  return geometry;
}

// Whole-artwork captures reuse the same discipline, keyed by the recursive
// subtree fingerprint so any layer change forces a fresh capture.
const artworkVectorCaptures = new Map<string, Awaited<ReturnType<typeof captureArtworkVectorGeometry>>>();
function artworkCaptureKey(source: SceneNode): string {
  return `${figma.currentPage.id}:${source.id}:${artworkVectorFingerprint(source)}`;
}
async function captureArtworkVectorGeometryCached(source: SceneNode) {
  const key = artworkCaptureKey(source);
  if (artworkVectorCaptures.has(key)) return artworkVectorCaptures.get(key);
  const geometries = await captureArtworkVectorGeometry(source, figma, observeNativeVectorCapture);
  if (source.removed || artworkCaptureKey(source) !== key) throw userError("selectionChanged");
  artworkVectorCaptures.set(key, geometries);
  if (artworkVectorCaptures.size > 4) artworkVectorCaptures.delete(artworkVectorCaptures.keys().next().value!);
  return geometries;
}

/**
 * Publishes one recomputed linked result in place. Every guard of the single
 * update applies — the live node must still carry the bound stored operation
 * of the family the UI recomputed — so a result that changed underneath the
 * batch fails its item instead of being overwritten.
 */
async function applyLinkedBatchItem(
  payload: Extract<UiToMainMessage, { type: "apply-linked-batch-item" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  const batchReply = { batchResultId: payload.nodeId, batchRunId: payload.batchRunId };
  if (applying) {
    post({ type: "apply-error", generation: requestGeneration, ...batchReply, message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const prepared = preparedSelection;
    if (
      !prepared ||
      prepared.generation !== requestGeneration ||
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      prepared.payload.targetNodeId ||
      !selectionMatches(prepared.payload.sourceNodeId) ||
      (prepared.payload.sources?.length ?? 0) > 0
    ) {
      throw userError("selectionChanged");
    }
    const source = await figma.getNodeByIdAsync(prepared.payload.sourceNodeId);
    const target = await figma.getNodeByIdAsync(payload.nodeId);
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !source ||
      !isSceneNode(source) ||
      !target ||
      target.type !== "RECTANGLE" ||
      nodePage(target)?.id !== figma.currentPage.id
    ) {
      throw userError(target ? "selectionChanged" : "resultUnavailable");
    }
    const binding = readResultBinding(target);
    const stored = readStoredOperation(target);
    const candidate = linkedBatchCandidates.get(target.id);
    const candidateMatches = (): boolean => candidate?.generation === requestGeneration &&
      candidate.batchRunId === payload.batchRunId &&
      candidate.snapshot === linkedBatchSnapshot(target);
    const payloadFamily = payload.storedOperation.kind === "task" ? payload.storedOperation.task.kind : payload.storedOperation.kind;
    const storedFamily = stored.status === "valid"
      ? (stored.operation.kind === "task" ? stored.operation.task.kind : stored.operation.kind)
      : undefined;
    const isTaskFamily = (kind: string): boolean =>
      ["effect", "mockup", "composition", "mesh", "surface", "deformation", "remap"].includes(kind);
    const familyMatches = payloadFamily === storedFamily ||
      (storedFamily !== undefined && isTaskFamily(payloadFamily) && isTaskFamily(storedFamily) &&
        sameDesignerTaskFamily(storedFamily as StoredDesignerTask["kind"], payloadFamily as StoredDesignerTask["kind"]));
    // Each item republishes with its full binding-order source ids;
    // every id must still resolve on this page.
    const payloadSourceIds = payload.sourceNodeIds ?? [source.id];
    const sourceNodesValid = payloadSourceIds.length >= 1 && payloadSourceIds.length <= 8 &&
      payloadSourceIds.every((id, index) => id === binding?.sourceNodeIds[index]) &&
      payloadSourceIds.length === binding?.sourceNodeIds.length;
    if (
      !candidateMatches() ||
      !binding ||
      !candidate?.dependencyNodeIds.every(id => linkedBatchCompleted.has(id)) ||
      stored.status !== "valid" ||
      !familyMatches ||
      !sourceNodesValid ||
      (payload.storedOperation.kind === "canvas" && !sameJsonValue(stored.operation, payload.storedOperation)) ||
      (storedRasterSize(target)?.width ?? checkedOutputAxis(target.width)) !== payload.renderWidth ||
      (storedRasterSize(target)?.height ?? checkedOutputAxis(target.height)) !== payload.renderHeight
    ) {
      throw userError("resultChanged");
    }
    if (payload.sourceNodeIds) {
      for (const id of payload.sourceNodeIds) {
        const bound = await figma.getNodeByIdAsync(id);
        if (!bound || bound.removed || !isSceneNode(bound) || nodePage(bound)?.id !== figma.currentPage.id) {
          throw userError("resultChanged");
        }
        if (requestGeneration !== selectionGeneration || reloadScheduled) throw userError("selectionChanged");
      }
    }
    if (!candidateMatches()) throw userError("resultChanged");
    const sceneProof = candidate?.sceneProof;
    if (!candidateMatches() || requestGeneration !== selectionGeneration || reloadScheduled) throw userError("resultChanged");
    sceneProof?.validate();
    beginPublication();
    const result = await publishResult({
      existing: target,
      preserveExistingFrame: true,
      imageHash: figma.createImage(payload.bytes).hash,
      storedOperation: payload.storedOperation,
      sourceName: source.name,
      sourceNodeIds: payloadSourceIds,
      placement: payload.placement,
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    if (sceneProof) writeSceneReadProof(result, sceneProof.fingerprint);
    linkedBatchOwnWrites.set(result.id, { generation: requestGeneration, snapshot: linkedBatchSnapshot(result) });
    linkedBatchCompleted.add(result.id);
    finishAppliedResult(result, [source, result], "replace", requestGeneration, undefined, false,
      { reveal: false, notify: false, ...batchReply });
    linkedBatchCandidates.delete(target.id);
  } catch (error) {
    post({ type: "apply-error", generation: requestGeneration, ...batchReply, message: toUserMessage(error, "unexpectedError") });
  } finally {
    applying = false;
    publishing = false;
  }
}

async function applyResult(
  payload: Extract<UiToMainMessage, { type: "apply" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({
      type: "apply-error",
      generation: requestGeneration,
      message: userMessage("applyAlreadyInProgress"),
    });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const prepared = requirePreparedSelection(payload);
    const source = await figma.getNodeByIdAsync(payload.sourceNodeId);
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !source ||
      !isSceneNode(source) ||
      !selectionMatches(payload.sourceNodeId, payload.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }

    let existing: RectangleNode | undefined;
    // Apply-as-copy keeps an existing pair result untouched and publishes a
    // new rectangle instead of replacing in place.
    let besideNativeResult = false;
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (requestGeneration !== selectionGeneration || reloadScheduled) {
        throw userError("selectionChanged");
      }
      if (!target) {
        throw userError("resultUnavailable");
      }
      if (target.type === "FRAME") {
        // The open selection is a native result, and a raster publication
        // (Warp or Correct) cannot replace it: publish a new image beside the
        // editable frame instead of failing the only available output route.
        besideNativeResult = true;
      } else {
        if (target.type !== "RECTANGLE") {
          throw userError("resultUnavailable");
        }
        if (!rasterPaintsIntact(target) || !rasterPaintsMatch(target, preparedSelection?.rasterPaintSnapshot)) {
          throw userError("rasterResultPaintChanged");
        }
        const stored = readStoredOperation(target);
        const targetRaster = storedRasterSize(target) ?? {
          width: checkedOutputAxis(target.width),
          height: checkedOutputAxis(target.height),
        };
        if (
          stored.status !== "valid" ||
          // A plane-only publication must not overwrite a stored designer
          // task; its work publishes through the task route or not at all.
          stored.operation.kind === "task" ||
          targetRaster.width !== prepared.renderWidth ||
          targetRaster.height !== prepared.renderHeight
        ) {
          throw userError("resultChanged");
        }
        existing = target;
      }
    }

    const storedOperation: StoredOperation = payload.rectification
      ? { kind: "rectify", spec: payload.rectification }
      : { kind: "transform", spec: payload.spec! };
    // Establish an explicit pre-mutation snapshot. A post-mutation commit alone
    // can leave a long-running UI plugin without the boundary needed for the
    // host's next Undo to restore an in-place replacement.
    beginPublication();
    const image = figma.createImage(payload.bytes);
    const operation = existing ? "replace" : "apply";
    const placement = existing
      ? payload.placement
      : placementBeside(
          inputPlacements(figma.currentPage, prepared),
          payload.placement,
          pagePlacements(figma.currentPage, prepared),
        );
    const result = await publishResult({
      ...(existing ? { existing } : {}),
      imageHash: image.hash,
      storedOperation,
      sourceName: source.name,
      sourceNodeIds: [source.id],
      placement,
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    const zoomContext: SceneNode[] = [source];
    if (payload.targetNodeId && (payload.duplicate || besideNativeResult)) {
      const pairTarget = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (pairTarget && isSceneNode(pairTarget)) zoomContext.push(pairTarget);
    }
    finishAppliedResult(result, zoomContext, operation, requestGeneration,
      undefined, payload.nativeVectorFallback === true);
  } catch (error) {
    post({
      type: "apply-error",
      generation: requestGeneration,
      message: toUserMessage(error, "unexpectedError"),
    });
  } finally {
    applying = false;
    publishing = false;
  }
}

async function applyCanvasSet(
  payload: Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({
      type: "apply-canvas-error",
      generation: requestGeneration,
      message: userMessage("applyAlreadyInProgress"),
    });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  try {
    const prepared = requirePreparedSelection(payload);
    const source = await figma.getNodeByIdAsync(payload.sourceNodeId);
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !source ||
      !isSceneNode(source) ||
      !selectionMatches(payload.sourceNodeId, payload.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }

    let existing: RectangleNode | undefined;
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (requestGeneration !== selectionGeneration || reloadScheduled) {
        throw userError("selectionChanged");
      }
      if (!target || target.type !== "RECTANGLE") throw userError("resultUnavailable");
      const stored = readStoredOperation(target);
      // A designer can resize a published raster without changing its pixel
      // recipe. Guard the read logical size, independently of saved pixels or
      // the new source's dimensions (especially Trim and Pad).
      const storedOutput = preparedSelection?.canvasTargetSize;
      if (
        stored.status !== "valid" ||
        stored.operation.kind !== "canvas" ||
        !sameJsonValue(stored.operation.spec, prepared.canvas) ||
        readCanvasOutputId(target) !== prepared.canvasOutputId ||
        target.getSharedPluginData(SHARED_NAMESPACE,CANVAS_OUTPUT_NAME_KEY) !== storedOutput?.outputName ||
        !sameJsonValue(readResultBinding(target), preparedSelection?.binding) ||
        !storedOutput ||
        target.width !== storedOutput.width ||
        target.height !== storedOutput.height
      ) {
        throw userError("resultChanged");
      }
      existing = target;
    }

    if (requestGeneration !== selectionGeneration || reloadScheduled) {
      throw userError("selectionChanged");
    }
    // The UI-side chain positions are advisory for new applies: publication
    // is authoritative here, where page-wide obstacles are readable. Each
    // variant chains right of the inputs and the variants before it, so a
    // variant set never covers inputs, page content, or its own siblings.
    let outputs = payload.outputs;
    if (!existing) {
      const inputs = inputPlacements(figma.currentPage, prepared);
      const obstacles = pagePlacements(figma.currentPage, prepared);
      const placed: SourcePayload["placement"][] = [];
      outputs = payload.outputs.map((output) => {
        const placement = placementBeside(
          [...inputs, ...placed],
          output.placement,
          [...obstacles, ...placed],
        );
        placed.push(placement);
        return { ...output, placement };
      });
    }
    const results = await publishCanvasDocumentTransaction({
      payload: { ...payload, outputs },
      sourceName: source.name,
      ...(existing ? { existing } : {}),
      createImage: (bytes) => figma.createImage(bytes),
      commitUndo: beginPublication,
      publish: (request) => publishResult({ ...request, sourceNodeIds: [source.id] }),
    });
    if (existing && preparedSelection?.payload.targetNodeId === existing.id) {
      const variant = payload.setSpec.variants[0]!;
      const canvasOutputName = readCanvasOutputName(existing);
      preparedSelection.payload = { ...preparedSelection.payload,
        canvas: { schema: "worldbend.canvas", version: "0.1", operation: variant.operation },
        canvasOutputId: variant.id, ...(canvasOutputName ? {canvasOutputName} : {}) };
      const binding = readResultBinding(existing);
      preparedSelection.canvasTargetSize={width:existing.width,height:existing.height,
        outputName:existing.getSharedPluginData(SHARED_NAMESPACE,CANVAS_OUTPUT_NAME_KEY)};
      if (binding) {
        preparedSelection.binding = binding;
        preparedSelection.payload = {...preparedSelection.payload,
          targetRasterSize:{width:binding.renderWidth,height:binding.renderHeight},
          placement:{...preparedSelection.payload.placement,width:existing.width,height:existing.height}};
      }
      else delete preparedSelection.binding;
    }
    finishAppliedCanvasResults(results, source, existing ? "replace" : "apply", requestGeneration);
  } catch (error) {
    post({
      type: "apply-canvas-error",
      generation: requestGeneration,
      message: error instanceof CanvasRollbackIncompleteError
        ? userMessage("rollbackIncomplete")
        : toUserMessage(error, "unexpectedError"),
    });
  } finally {
    applying = false;
    publishing = false;
  }
}

async function applyDesignerResult(
  payload: Extract<UiToMainMessage, { type: "apply-designer" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({ type: "apply-designer-error", generation: requestGeneration, message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  clearSceneDraft(figma.currentPage);
  let sceneOutputSource: FrameNode | undefined;
  try {
    const prepared = requirePreparedDesignerSelection(payload);
    const actualIds = currentEditingSelection().map((node) => node.id);
    const expectedIds = [...preparedSelection!.selectedNodeIds];
    if (requestGeneration !== selectionGeneration || reloadScheduled || !sameIds(actualIds, expectedIds)) {
      throw userError("selectionChanged");
    }
    const sourceNodes = await Promise.all(
      payload.sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)),
    );
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !sameIds(currentEditingSelection().map((node) => node.id), expectedIds) ||
      !sourceNodes.every((node): node is SceneNode => node !== null && isSceneNode(node))
    ) {
      throw userError("selectionChanged");
    }
    const source = sourceNodes[deformationArtworkIndex(payload.task)];
    if (!source) throw userError("selectionChanged");
    let existing: RectangleNode | undefined;
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (!target || target.type !== "RECTANGLE") throw userError("resultUnavailable");
      const stored = readStoredOperation(target);
      const raster = storedRasterSize(target);
      if (
        stored.status !== "valid" ||
        stored.operation.kind !== "task" ||
        !raster ||
        preparedSelection?.binding?.renderWidth !== raster.width ||
        preparedSelection?.binding?.renderHeight !== raster.height
      ) throw userError("resultChanged");
      existing = target;
    }
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !sameIds(currentEditingSelection().map((node) => node.id), expectedIds)
    ) {
      throw userError("selectionChanged");
    }
    if (existing && prepared.task?.kind && !sameDesignerTaskFamily(prepared.task.kind, payload.task.kind)) {
      throw userError("resultChanged");
    }
    if (existing) {
      const currentBinding = readResultBinding(existing);
      if (!currentBinding || !preparedSelection?.binding || !sameJsonValue(currentBinding, preparedSelection.binding)) {
        throw userError("resultChanged");
      }
    }
    if (payload.sceneSizes) {
      if (!existing || !prepared.sceneContext || !canSaveNativeScene(existing) || existing.parent?.type !== "FRAME") {
        throw userError("resultChanged");
      }
      // The containing preview Frame owns native backgrounds and foregrounds.
      // Its scene root may also contain source artwork that is not a deliverable.
      sceneOutputSource = existing.parent;
    }
    let effectDraftBeforePublication: string | undefined;
    let mockupDraftBeforePublication: string | undefined;
    if (payload.task.kind === "effect" && existing) {
      effectDraftBeforePublication = existing.getSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY);
      const currentDraft = parseStoredEffectDraft(effectDraftBeforePublication);
      if (prepared.effectDraft
        ? !currentDraft || !sameJsonValue(currentDraft, prepared.effectDraft)
        : effectDraftBeforePublication !== "") {
        // A newer Agent stage belongs to a later visual review. Never let a
        // UI that loaded an older selection publish over it or clear it.
        throw userError("resultChanged");
      }
    }
    if ((payload.task.kind === "mockup" || payload.task.kind === "composition") && existing) {
      mockupDraftBeforePublication = existing.getSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY);
      if (mockupDraftBeforePublication !== (preparedSelection?.mockupDraftRaw ?? "")) {
        throw userError("resultChanged");
      }
    }
    if (payload.canvasChange && existing) {
      // The guarded canvas transport must replay against the exact stored
      // operation it was planned from; any drift is a conflict, not an update.
      const operation = readStoredOperation(existing);
      if (operation.status !== "valid" || operation.operation.kind !== "task" ||
        nativeVectorOperationDigest(operation.operation) !== payload.canvasChange.workExpected) throw userError("resultChanged");
    }
    const sceneProof = preparedSelection?.sceneProof;
    requirePreparedDesignerSelection(payload);
    sceneProof?.validate();
    beginPublication();
    const result = await publishResult({
      ...(existing ? { existing } : {}),
      // Designer re-edits carry the existing visual bounds, not a requested
      // native resize. Those bounds cannot replace a rotated or flipped frame.
      ...(existing ? { preserveExistingFrame: true } : {}),
      ...(payload.canvasChange ? { canvasChange: payload.canvasChange } : {}),
      imageHash: figma.createImage(payload.bytes).hash,
      storedOperation: { kind: "task", task: payload.task },
      sourceName: source.name,
      sourceNodeIds: [...payload.sourceNodeIds],
      placement: existing
        ? payload.placement
        : placementBeside(
            inputPlacements(figma.currentPage, prepared),
            payload.placement,
            pagePlacements(figma.currentPage, prepared),
          ),
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    if (sceneProof) writeSceneReadProof(result, sceneProof.fingerprint);
    if (payload.task.kind === "effect") {
      if (!existing || result.getSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY) === effectDraftBeforePublication) {
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_EFFECT_DRAFT_KEY, "");
      }
    }
    if (payload.task.kind === "mockup" || payload.task.kind === "composition") {
      if (!existing || result.getSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY) === mockupDraftBeforePublication) {
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY, "");
      }
    }
    if (existing && preparedSelection?.payload.targetNodeId === result.id) {
      const { effectDraft: _publishedDraft, mockupDraft: _publishedMockupDraft, ...preparedPayload } = preparedSelection.payload;
      const box = result.absoluteBoundingBox;
      preparedSelection.payload = {
        ...preparedPayload,
        task: payload.task,
        ...(box ? { placement: { ...box } } : {}),
        targetRasterSize: { width: payload.renderWidth, height: payload.renderHeight },
      };
      preparedSelection.mockupDraftRaw = "";
      const publishedBinding = readResultBinding(result);
      if (publishedBinding) preparedSelection.binding = publishedBinding;
      else delete preparedSelection.binding;
    }
    const zoomContext: SceneNode[] = [...sourceNodes];
    if (payload.duplicate && payload.targetNodeId) {
      const pairTarget = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (pairTarget && isSceneNode(pairTarget)) zoomContext.push(pairTarget);
    }
    try { figma.viewport.scrollAndZoomIntoView([result, ...zoomContext]); } catch {}
    try { figma.notify(translate(activeLocale, "designerApplied")); } catch {}
    try { figma.commitUndo(); } catch {}
    post({ type: "apply-designer-complete", generation: requestGeneration, targetNodeId: result.id, operation: existing ? "replace" : "apply",
      ...(payload.task.kind === "deformation" && result.absoluteBoundingBox
        ? { publication: { placement: { ...result.absoluteBoundingBox }, renderWidth: payload.renderWidth, renderHeight: payload.renderHeight } }
        : {}) });
    if (sceneOutputSource && requestGeneration === selectionGeneration && !reloadScheduled && !sceneOutputSource.removed) {
      post({ type: "scene-sizes-ready", generation: requestGeneration, sourceNodeId: sceneOutputSource.id });
      editingSelection = [];
      figma.currentPage.selection = [sceneOutputSource];
    } else sceneOutputSource = undefined;
  } catch (error) {
    sceneOutputSource = undefined;
    post({ type: "apply-designer-error", generation: requestGeneration, message: toUserMessage(error, "unexpectedError") });
  } finally {
    applying = false;
    publishing = false;
    if (sceneOutputSource) loadSelectionNow();
  }
}

function finishAppliedCanvasResults(
  results: RectangleNode[],
  source: SceneNode,
  operation: "apply" | "replace",
  generation: number,
): void {
  try {
    // Keep the producing input in view beside the results: side-by-side
    // comparison is the outcome a human checks after publication.
    figma.viewport.scrollAndZoomIntoView([...results, source]);
  } catch {
    // Viewport movement does not determine publication success.
  }
  try {
    figma.notify(
      translate(activeLocale, operation === "replace" ? "canvasReplaced" : "canvasApplied"),
    );
  } catch {
    // Notifications are non-authoritative confirmation only.
  }
  try {
    figma.commitUndo();
  } catch {
    // Visible results remain the truthful operation outcome.
  }
  post({
    type: "apply-canvas-complete",
    generation,
    targetNodeIds: results.map((result) => result.id),
    operation,
  });
}

function selectionPlacements(selection: readonly SceneNode[]): SourcePayload["placement"][] {
  return selection.flatMap((node) => {
    const box = node.absoluteBoundingBox;
    return box && box.width > 0 && box.height > 0
      ? [{ x: box.x, y: box.y, width: box.width, height: box.height }]
      : [];
  });
}

function preparedPlacements(prepared: SourcePayload): SourcePayload["placement"][] {
  const sources = prepared.sources ?? [prepared];
  return [
    ...sources.map((source) => ({ ...source.placement })),
    ...(prepared.targetNodeId ? [{ ...prepared.placement }] : []),
  ];
}

function inputPlacements(
  page: PageNode,
  prepared: SourcePayload,
): SourcePayload["placement"][] {
  const placements = selectionPlacements(page === figma.currentPage ? currentEditingSelection() : page.selection);
  return placements.length > 0 ? placements : preparedPlacements(prepared);
}

function pagePlacements(
  page: PageNode,
  prepared: SourcePayload,
): SourcePayload["placement"][] {
  // Hidden layers still own bounds but are invisible on canvas; they must
  // not push results around. Masks keep their bounds: they shape content.
  // The plugin's own draft is transient feedback, not an obstacle.
  const placements = selectionPlacements(page.children.filter((node) => node.visible && !isSceneDraftNode(node)));
  return placements.length > 0 ? placements : preparedPlacements(prepared);
}

function finishAppliedResult(
  result: RectangleNode | FrameNode,
  zoomContext: readonly SceneNode[],
  operation: "apply" | "replace",
  generation: number,
  vectorFidelity?: NativeVectorFidelity,
  nativeVectorFallback = false,
  feedback: { reveal?: boolean; notify?: boolean; batchResultId?:string; batchRunId?:number } = {},
): void {
  // Each publisher owns its Undo checkpoints. Most routes retain the producing
  // selection for comparison; native source editing/replacement explicitly
  // resumes its independent result within that publisher's checkpoint. Keep
  // its snapshot available for another Apply and for observing later edits;
  // clearing it here strands the ready UI until the user selects elsewhere.
  try { result.setRelaunchData({ edit: "" }); }
  catch { /* Relaunch support does not determine publication success. */ }
  try {
    // Keep the producing inputs in view beside the result: side-by-side
    // comparison is the outcome a human checks after publication.
    if (feedback.reveal !== false) figma.viewport.scrollAndZoomIntoView([result, ...zoomContext]);
  } catch {
    // Selection and viewport movement do not determine write success.
  }
  try {
    // The visible completion cue reports the same route fidelity the status
    // region announces: an outlined stroke or an approximation bound changes
    // what the published result is, so it cannot stay screen-reader-only.
    if (feedback.notify !== false) figma.notify(
      translate(
        activeLocale,
        vectorFidelity
          ? nativeVectorStatusMessage(vectorFidelity)
          : nativeVectorFallback
            ? userMessage("nativeVectorFallbackApplied")
            : userMessage(operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"),
      ),
    );
  } catch {
    // Notifications are non-authoritative confirmation only.
  }
  post({
    type: "apply-complete",
    generation,
    ...(feedback.batchResultId?{batchResultId:feedback.batchResultId,batchRunId:feedback.batchRunId!}:{}),
    targetNodeId: result.id,
    operation,
    ...(result.type==="FRAME"&&readNativeProjection(result)?{nativeRevision:readResultBinding(result)?.revision??0}:{}),
    ...(vectorFidelity ? { vectorFidelity } : {}),
  });
}

function handleSelectionChange(): void {
  observeNativeUndo?.();
  // Figma also emits this event for text caret/range changes. Those do not
  // change source pixels and must neither discard a draft nor postpone a
  // pending content refresh. Actual edits still arrive through nodechange.
  if (rememberSelectionIdentity()) scheduleLoadSelection();
}

function rememberSelectionIdentity(): boolean {
  const page = figma.currentPage;
  const ids = currentEditingSelection().map((node) => node.id);
  const changed = page.id !== selectionPageId || ids.length !== selectionNodeIds.length ||
    ids.some((id, index) => id !== selectionNodeIds[index]);
  selectionPageId = page.id;
  selectionNodeIds = ids;
  return changed;
}

function handleCurrentPageChange(): void {
  materialTrial.cancel();
  observeNativeUndo?.();
  clearSceneDraft(observedPage);
  observedPage.off("nodechange", handleNodeChange);
  observedPage = figma.currentPage;
  observePageDrafts();
  observedPage.on("nodechange", handleNodeChange);
  scheduleLoadSelection();
}

function handlePluginClose(): void {
  // Invalidate pending Main continuations before their next asynchronous
  // boundary, and remove only exact session-owned preparation resources while
  // the host still permits synchronous document cleanup.
  ++selectionGeneration;
  nativeVectorUndoBoundary=undefined;
  try { cancelNativeTemporarySessions(); } finally {
  nativeSceneAnimationJob?.actor?.cancel();nativeSceneAnimationJob=undefined;++nativeSceneAnimationEpoch;
  materialTrial.cancel();
  // Figma invokes this synchronously while document APIs are still available.
  // Preserve originals, durable work and other sessions' canvas resources.
  clearSceneDraft(observedPage);
  if (figma.currentPage.id !== observedPage.id) clearSceneDraft(figma.currentPage);
  }
}

function handleNodeChange(event: NodeChangeEvent): void {
  observeNativeUndo?.();
  const relevantChanges = event.nodeChanges.filter((change) => {
    const nativeBatchWrite=linkedBatchNativeWrites.get(change.id);
    if(nativeBatchWrite){
      if(nativeBatchWrite.generation===selectionGeneration&&!nativeBatchWrite.root.removed&&
        publicationTargetFingerprint(nativeBatchWrite.root)===nativeBatchWrite.snapshot&&
        (change.type==="DELETE"?nativeBatchWrite.retired:!nativeBatchWrite.retired))return false;
      linkedBatchNativeWrites.delete(change.id);
    }
    const batchWrite = linkedBatchOwnWrites.get(change.id);
    if (batchWrite) {
      if (change.type === "PROPERTY_CHANGE" && change.properties?.length &&
          change.properties.every(property => ["pluginData", "fills"].includes(property)) &&
          batchWrite.generation === selectionGeneration && !change.node.removed && isSceneNode(change.node) &&
          batchWrite.snapshot === linkedBatchSnapshot(change.node)) return false;
      linkedBatchOwnWrites.delete(change.id);
    }
    const own = cardOwnWrites.get(change.id);
    if (own) {
      cardOwnWrites.delete(change.id);
      if (change.type === "PROPERTY_CHANGE" && change.properties?.length &&
          change.properties.every(property => ["pluginData","fills","width","height","name","parent"].includes(property)) &&
          own.generation === selectionGeneration && !change.node.removed && isSceneNode(change.node) &&
          own.snapshot === cardWriteSnapshot(change.node)) return false;
    }
    if (change.type !== "DELETE" && !change.node.removed && isSceneDraftNode(change.node)) {
      observedDraftNodeIds.add(change.id);
    }
    const isDraft = observedDraftNodeIds.has(change.id) || sceneDraftSession?.isOwnedNodeId(change.id) || materialTrialSession?.isOwnedNodeId(change.id);
    // Deleted nodes cannot expose their private markers. Remember observations
    // until DELETE, then release them so repeated sessions stay bounded.
    if (change.type === "DELETE") {
      observedDraftNodeIds.delete(change.id);
      sceneDraftSession?.forgetNodeId(change.id);
      materialTrialSession?.forgetNodeId(change.id);
    }
    return !isDraft;
  });
  if (publishing) return;
  // Native scene continuation also observes the saved task and result pixels.
  // Refresh it before the material-only fast path can classify Undo as a
  // surrounding appearance change and leave the geometry controls stale.
  if (relevantChanges.some(change => {
    if (change.type === "DELETE") return deletedObservedNode(change.id, sceneContextObservedRoots, sceneContextObservedNodes);
    if (change.node.removed) return false;
    let node: BaseNode | null = change.node;
    while (node) { if (sceneContextObservedRoots.has(node.id)) return true; node = node.parent; }
    return false;
  })) { clearSceneDraft(figma.currentPage); scheduleLoadSelection(); return; }
  // Material feedback samples surrounding artwork, not only a raster source.
  // A changed background/foreground must invalidate the capture too.
  if (relevantChanges.some(change => {
    if (change.type === "DELETE") return deletedObservedNode(change.id, materialObservedRoots, materialObservedNodes);
    if (change.node.removed) return false;
    let node: BaseNode | null = change.node;
    while (node) { if (materialObservedRoots.has(node.id)) return true; node = node.parent; }
    return false;
  })) {
    const selection = figma.currentPage.selection.filter(node => !isSceneDraftNode(node));
    const intact = !reloadScheduled && !applying &&
      !relevantChanges.some(nodeChangeTouchesPreparedSelection) && selection.length > 0 && selection.every(node =>
      !node.removed && appearanceObservedStates.get(node.id) === appearanceExpectedState(node) &&
      textureObservedStates.get(node.id) === textureExpectedState(node));
    if (intact) {
      materialContextDirty = true;
      materialTrial.cancel();
      postAppearanceState();
      postTextureState();
      post({ type: "material-context-changed", generation: selectionGeneration });
    } else scheduleLoadSelection();
    return;
  }

  if (!preparedSelection && !loadingSelection) return;
  if (relevantChanges.some((change) => nodeChangeTouchesPreparedSelection(change))) {
    scheduleLoadSelection();
  }
}

function nodeChangeTouchesPreparedSelection(change: NodeChange): boolean {
  const prepared = preparedSelection;
  if (prepared?.observedNodeIds.has(change.id) || prepared?.ancestorNodeIds.has(change.id) ||
    loadingSelection?.observedNodeIds.has(change.id) || loadingSelection?.ancestorNodeIds.has(change.id)) {
    return true;
  }
  if (change.type === "DELETE") {
    return deletedObservedNode(change.id, cardObservedRoots, cardObservedNodes) ||
      deletedObservedNode(change.id, prepared?.observedNodeIds ?? new Set(), prepared?.observedNodes) ||
      deletedObservedNode(change.id, loadingSelection?.observedNodeIds ?? new Set(), loadingSelection?.observedNodes);
  }
  let node: BaseNode | null = "parent" in change.node ? change.node : null;
  while (node) {
    if (cardObservedRoots.has(node.id)) return true;
    if (prepared?.observedNodeIds.has(node.id) || loadingSelection?.observedNodeIds.has(node.id)) return true;
    node = node.parent;
  }
  return false;
}

function selectionAncestorIds(selection: readonly SceneNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const selected of selection) {
    let parent = selected.parent;
    while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
      ids.add(parent.id);
      parent = parent.parent;
    }
  }
  return ids;
}

async function publishResult(input: {
  existing?: RectangleNode;
  /** A linked recompute updates pixels without changing native placement. */
  preserveExistingFrame?: boolean;
  canvasChange?: RasterCanvasChange;
  imageHash: string;
  storedOperation: StoredOperation;
  sourceName: string;
  sourceNodeIds: string[];
  placement: SourcePayload["placement"];
  renderWidth: number;
  renderHeight: number;
  canvasOutputId?: string;
  canvasOutputName?: string;
}): Promise<RectangleNode> {
  if (input.existing && !rasterPaintsIntact(input.existing)) throw userError("rasterResultPaintChanged");
  // Legacy results have no proof. The selection snapshot is what rejects a
  // fill edit that arrives after the read, on every in-place publication of
  // that prepared result. A linked batch item has its own snapshot.
  if (input.existing && preparedSelection?.payload.targetNodeId === input.existing.id &&
    !rasterPaintsMatch(input.existing, preparedSelection.rasterPaintSnapshot)) {
    throw userError("rasterResultPaintChanged");
  }
  const priorPaintProof = input.existing?.getSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY);
  const existingFills = input.existing?.fills;
  if (existingFills === figma.mixed) {
    throw userError("mixedFills");
  }
  const priorFills = existingFills ? [...existingFills] : undefined;
  const priorOperationSlots = input.existing
    ? readStoredOperationSlots(input.existing)
    : undefined;
  const priorWidth = input.existing?.getPluginData(RENDER_WIDTH_KEY);
  const priorHeight = input.existing?.getPluginData(RENDER_HEIGHT_KEY);
  const priorBinding = input.existing?.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY);
  const priorCanvasOutputId = input.existing?.getSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_ID_KEY);
  const priorCanvasOutputName = input.existing?.getSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_NAME_KEY);
  const priorEffectiveCanvasName = input.existing ? readCanvasOutputName(input.existing) : undefined;
  const priorName = input.existing?.name;
  const priorFrame = input.existing
    ? {
        x: input.existing.x,
        y: input.existing.y,
        width: input.existing.width,
        height: input.existing.height,
        transform: input.existing.relativeTransform?.map(row => [...row]) as Transform | undefined,
      }
    : undefined;
  const result = input.existing ?? figma.createRectangle();
  const created = !input.existing;
  try {
    if (created) {
      result.name = `${input.sourceName} · Worldbend`;
      result.resize(input.placement.width, input.placement.height);
      // A created node lives on the current page, where node coordinates and
      // absolute coordinates agree, so the payload placement applies as-is.
      result.x = input.placement.x;
      result.y = input.placement.y;
    } else if (input.canvasChange) {
      changeRasterCanvas(result, input.canvasChange);
    } else if (!input.preserveExistingFrame) {
      // The payload placement is absolute while x/y use the containing basis
      // (Figma Groups and booleans do not establish a coordinate system).
      // Preserve the payload's intended center (including a real transform
      // translation) by mapping it through the parent's affine transform.
      // This keeps nested results in their parent without silently ignoring
      // the newly composed placement.
      result.resize(input.placement.width, input.placement.height);
      const center = parentPointFromAbsolute(result, {
        x: input.placement.x + input.placement.width / 2,
        y: input.placement.y + input.placement.height / 2,
      });
      result.x = center.x - input.placement.width / 2;
      result.y = center.y - input.placement.height / 2;
    }
    result.fills = [{ type: "IMAGE", imageHash: input.imageHash, scaleMode: "FILL" }];
    writeStoredOperation(result, input.storedOperation);
    result.setPluginData(RENDER_WIDTH_KEY, String(input.renderWidth));
    result.setPluginData(RENDER_HEIGHT_KEY, String(input.renderHeight));
    writeStoredBinding(result, input);
    writeRasterPaintProof(result);
    if (input.canvasOutputId !== undefined) result.setSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_ID_KEY, input.canvasOutputId);
    if (input.canvasOutputName !== undefined) {
      if (!created && input.canvasOutputName !== (priorEffectiveCanvasName ?? priorCanvasOutputId)) {
        result.name = `${input.sourceName} · Worldbend`;
      }
      result.setSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_NAME_KEY, input.canvasOutputName);
    }
    if (input.existing && preparedSelection?.payload.targetNodeId === result.id) {
      if (input.storedOperation.kind === "transform" || input.storedOperation.kind === "rectify") {
        // The next replacement must compare against the output we just wrote,
        // not the dimensions from when this result was originally opened.
        preparedSelection.payload = {
          ...preparedSelection.payload,
          renderWidth: input.renderWidth,
          renderHeight: input.renderHeight,
        };
      }
      const snapshot = captureRasterPaints(result);
      if (snapshot !== undefined) preparedSelection.rasterPaintSnapshot = snapshot;
      else delete preparedSelection.rasterPaintSnapshot;
    }
    return result;
  } catch (error) {
    try {
      if (created) {
        result.remove();
      } else if (priorFills && priorFrame && priorOperationSlots) {
        result.resize(priorFrame.width, priorFrame.height);
        result.x = priorFrame.x;
        result.y = priorFrame.y;
        if (priorFrame.transform) result.relativeTransform = priorFrame.transform;
        result.fills = priorFills;
        restoreStoredOperationSlots(result, priorOperationSlots);
        result.setPluginData(RENDER_WIDTH_KEY, priorWidth ?? "");
        result.setPluginData(RENDER_HEIGHT_KEY, priorHeight ?? "");
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY, priorBinding ?? "");
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY, priorPaintProof ?? "");
        if (input.canvasOutputId !== undefined) result.setSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_ID_KEY, priorCanvasOutputId ?? "");
        if (input.canvasOutputName !== undefined) {
          result.setSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_NAME_KEY, priorCanvasOutputName ?? "");
          result.name = priorName!;
        }
      }
    } catch {
      throw userError("rollbackIncomplete");
    }
    throw error;
  }
}

function parentPointFromAbsolute(
  result: RectangleNode | FrameNode,
  point: { x: number; y: number },
): { x: number; y: number } {
  try{return pointInCoordinateParent(result,point);}catch{throw userError("resultChanged");}
}

function requirePreparedSelection(
  payload:
    | NativeApplyPayload
    | NativeVectorApplyPayload
    | NativeVectorProjectionPayload
    | Extract<UiToMainMessage, { type: "apply" }>["payload"]
    | Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"],
): SourcePayload {
  const prepared = preparedSelection;
  if (
    !prepared ||
    prepared.generation !== payload.generation ||
    prepared.generation !== selectionGeneration ||
    // A scheduled reload invalidates the snapshot's pixels even though its
    // generation has not advanced yet.
    reloadScheduled ||
    prepared.payload.sourceNodeId !== payload.sourceNodeId ||
    prepared.payload.targetNodeId !== payload.targetNodeId
  ) {
    throw userError("selectionChanged");
  }
  return prepared.payload;
}

function requirePreparedDesignerSelection(
  payload: Extract<UiToMainMessage, { type: "apply-designer" }>["payload"],
): SourcePayload {
  const prepared = preparedSelection;
  const preparedSourceIds = prepared?.payload.sources?.map((source) => source.sourceNodeId) ??
    (prepared ? [prepared.payload.sourceNodeId] : []);
  const sourceOrderMatches = payload.task.kind === "effect"
    ? sameIds(preparedSourceIds, payload.sourceNodeIds)
    : preparedSourceIds.every((id, index) => id === payload.sourceNodeIds[index]);
  if (
    !prepared ||
    prepared.generation !== payload.generation ||
    prepared.generation !== selectionGeneration ||
    reloadScheduled ||
    preparedSourceIds.length !== payload.sourceNodeIds.length ||
    !sourceOrderMatches ||
    prepared.payload.targetNodeId !== payload.targetNodeId
  ) throw userError("selectionChanged");
  return prepared.payload;
}

function checkedOutputAxis(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded < 1) throw userError("outputInvalidDimensions");
  if (rounded > MAX_FIGMA_IMAGE_AXIS) {
    throw userError("outputLimitExceeded", { limit: MAX_FIGMA_IMAGE_AXIS });
  }
  return rounded;
}

const MAX_LINKED_BATCH_ITEMS = 64;
const linkedBatchCandidates = new Map<string, { generation: number; snapshot: string; dependencyNodeIds: string[];
  sceneProof?: Awaited<ReturnType<typeof prepareSceneReadProof>>; nativeVector?:boolean; batchRunId?:number }>();
let linkedBatchRunId=0;
const linkedBatchCompleted = new Set<string>();
const linkedBatchOwnWrites = new Map<string, { generation: number; snapshot: string }>();

const linkedBatchNativeWrites=new Map<string,{generation:number;root:FrameNode;snapshot:string;retired:boolean}>();
function recordNativeBatchWrite(root:FrameNode,previousChildren:string[],generation:number){
  const snapshot=publicationTargetFingerprint(root),current=new Set([root.id,...root.children.map(n=>n.id)]);
  for(const id of new Set([...previousChildren,...current]))linkedBatchNativeWrites.set(id,{generation,root,snapshot,retired:!current.has(id)});
}

function linkedResultCandidates(): SceneNode[] {
  return figma.currentPage.findAllWithCriteria({
    types: ["RECTANGLE", "FRAME"],
    sharedPluginData: { namespace: SHARED_NAMESPACE, keys: [SHARED_BINDING_KEY] },
  });
}

/** Capture the actual result, including direct native edits, before recomputation. */
function linkedBatchSnapshot(node: SceneNode): string {
  return JSON.stringify({
    binding: readResultBinding(node), operation: readStoredOperation(node),
    ...(node.type==="FRAME"&&readNativeVectorProjection(node)?{nativeVector:publicationTargetFingerprint(node)}:{}),
    rasterPaint: node.getSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY),
    draft: node.getSharedPluginData(SHARED_NAMESPACE, SHARED_MOCKUP_DRAFT_KEY),
    canvasOutputId: node.getSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_ID_KEY),
    canvasOutputName: node.getSharedPluginData(SHARED_NAMESPACE, CANVAS_OUTPUT_NAME_KEY),
    name: node.name, parentId: node.parent?.id, x: node.x, y: node.y, width: node.width, height: node.height,
    transform: node.relativeTransform, visible: node.visible,
    ...("opacity" in node ? { opacity: node.opacity } : {}),
    ...("fills" in node ? { fills: emptyPaints(node.fills as readonly unknown[]) } : {}),
    ...("strokes" in node ? { strokes: emptyPaints(node.strokes as readonly unknown[]) } : {}),
    ...("effects" in node ? { effects: emptyPaints(node.effects as readonly unknown[]) } : {}),
    ...("cornerRadius" in node ? { cornerRadius: node.cornerRadius } : {}),
    raster: storedRasterSize(node),
  });
}

/**
 * Correlates one source's linked results for the batch update: every bound,
 * saved binding with its node facts, including damaged operations, in dependency order. Recomputation
 * and publication stay in the UI through the ordinary per-result update path;
 * this side only reads and verifies the durable relationships.
 */
let linkedBatchPrepareChain: Promise<void> = Promise.resolve();
function prepareLinkedBatch(requestGeneration: number): Promise<void> {
  // Preparations serialize: a second request must never interleave its
  // candidate rebuild with one still in flight under the same generation.
  const run = linkedBatchPrepareChain.then(() => prepareLinkedBatchNow(requestGeneration));
  linkedBatchPrepareChain = run.catch(() => {});
  return run;
}

async function prepareLinkedBatchNow(requestGeneration: number): Promise<void> {
  try {
    const prepared = preparedSelection;
    const linked = prepared?.payload.linkedResults;
    if (
      !prepared ||
      prepared.generation !== requestGeneration ||
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      applying ||
      prepared.payload.targetNodeId ||
      !selectionMatches(prepared.payload.sourceNodeId) ||
      (prepared.payload.sources?.length ?? 0) > 0 ||
      !linked?.total
    ) {
      throw userError("selectionChanged");
    }
    const source = await figma.getNodeByIdAsync(prepared.payload.sourceNodeId);
    if (!source || !isSceneNode(source)) throw userError("selectionChanged");
    const graph = linkedResultGraph(linkedResultCandidates(), source);
    if (graph.hasCycle) throw userError("batchDependencyCycle");
    if (graph.entries.length > MAX_LINKED_BATCH_ITEMS) throw userError("batchTooManyResults");
    linkedBatchCandidates.clear();
    linkedBatchCompleted.clear();
    linkedBatchOwnWrites.clear();
    linkedBatchNativeWrites.clear();
    observeNodeTree(prepared.observedNodes, graph.entries.map(entry => entry.node));
    prepared.observedNodeIds = new Set([...prepared.observedNodeIds, ...prepared.observedNodes.keys()]);
    const items: LinkedBatchItem[] = [];
    const batchRunId=++linkedBatchRunId;
    for (const entry of graph.entries) {
      const node = entry.node;
      if (requestGeneration !== selectionGeneration || reloadScheduled || applying) {
        throw userError("selectionChanged");
      }
      if (!node || node.removed || !isSceneNode(node) || nodePage(node)?.id !== figma.currentPage.id) continue;
      const binding = readResultBinding(node);
      const stored = readStoredOperation(node);
      if (!binding) throw userError("resultChanged");
      const operation = stored.status === "valid" ? stored.operation : undefined;
      const kind = operation?.kind === "task" ? operation.task.kind : operation?.kind ?? "invalid";
      const vectorRecord=node.type==="FRAME"?readNativeVectorProjection(node):undefined;
      // A native Vector result keeps its carrier through the batch: one-source
      // planes and complete deformation works, including the native shape-guide
      // family whose guide source refreshes alongside the artwork.
      const guideBoundTask=operation?.kind==="task"&&operation.task.kind==="deformation"&&operation.task.shapeGuideSourceIndex!==undefined?operation.task:undefined;
      const nativeVectorSourceCount=guideBoundTask?2:1;
      const nativeVector=!!vectorRecord&&!!operation&&binding.sourceNodeIds.length===nativeVectorSourceCount&&
        (operation.kind==="transform"||(operation.kind==="task"&&operation.task.kind==="deformation"&&
          (!!guideBoundTask||operation.task.shapeGuideSourceIndex===undefined)));
      let nativeView:SourcePayload["nativeVectorSourceView"];
      if(nativeVector){
        const artworkIndex=operation?.kind==="task"?deformationArtworkIndex(operation.task):0;
        const artwork=await figma.getNodeByIdAsync(binding.sourceNodeIds[artworkIndex]!);
        if(artwork&&isSceneNode(artwork))nativeView=currentNativeVectorSourceView(artwork,vectorRecord.sourceView);
      }
      const supported = nativeVector || !!operation && node.type === "RECTANGLE" && ((["transform","mesh","surface"].includes(kind) && binding.sourceNodeIds.length===1) ||
        (operation.kind === "task" && operation.task.kind === "deformation" && binding.sourceNodeIds.length===deformationTaskSourceCount(operation.task)) ||
        (operation.kind === "canvas" && binding.sourceNodeIds.length === 1 &&
          ["contain", "cover", "stretch"].includes(operation.spec.operation.kind)) ||
        ((kind === "mockup" || kind === "composition") && binding.sourceNodeIds.length >= 2 && binding.sourceNodeIds.length <= 8));
      const raster = storedRasterSize(node) ?? { width: checkedOutputAxis(node.width), height: checkedOutputAxis(node.height) };
      const box = node.absoluteBoundingBox;
      items.push({
        nodeId: node.id,
        name: node.name,
        revision: binding.revision,
        kind,
        width: raster.width,
        height: raster.height,
        placement: {
          x: box?.x ?? 0,
          y: box?.y ?? 0,
          width: box?.width ?? raster.width,
          height: box?.height ?? raster.height,
        },
        operationKind: operation?.kind === "task" ? "task" : operation?.kind === "canvas" ? "canvas" : "transform",
        operationJson: supported && operation
          ? JSON.stringify(operation.kind === "task" ? operation.task : operation.spec)
          : "",
        batchRunId,
        sourceNodeIds: [...binding.sourceNodeIds],
        dependencyNodeIds: entry.dependencyNodeIds,
        ...(nativeVector?{nativeVector:true as const,...(nativeView?{nativeVectorSourceView:nativeView}:{})}:{}),
        ...(!supported ? { updatable: false as const } : {}),
      });
      if (supported) linkedBatchCandidates.set(node.id, { generation: requestGeneration, snapshot: linkedBatchSnapshot(node), dependencyNodeIds: entry.dependencyNodeIds, nativeVector, batchRunId });
      for (const id of binding.sourceNodeIds) {
        const bound = await figma.getNodeByIdAsync(id);
        if (bound && isSceneNode(bound)) {
          observeNodeTree(prepared.observedNodes, [bound]);
          prepared.observedNodeIds = new Set([...prepared.observedNodeIds, ...prepared.observedNodes.keys()]);
          prepared.ancestorNodeIds = new Set([...prepared.ancestorNodeIds, ...selectionAncestorIds([bound])]);
        }
      }
    }
    if (!items.length) throw userError("resultUnavailable");
    if (requestGeneration !== selectionGeneration || reloadScheduled || applying) throw userError("selectionChanged");
    post({ type: "linked-batch", generation: requestGeneration, items });
  } catch (error) {
    post({
      type: "linked-batch-error",
      generation: requestGeneration,
      message: toUserMessage(error, "unexpectedError"),
    });
  }
}

function storedRasterSize(
  target: Pick<RectangleNode, "id" | "getPluginData" | "getSharedPluginData"> & { type?: string },
): { width: number; height: number } | undefined {
  const width = Number(target.getPluginData(RENDER_WIDTH_KEY));
  const height = Number(target.getPluginData(RENDER_HEIGHT_KEY));
  const binding = readResultBinding(target);
  return binding ? { width: binding.renderWidth, height: binding.renderHeight }
    : isFigmaImageAxis(width) && isFigmaImageAxis(height)
    ? { width, height }
    : undefined;
}

/**
 * One bound source of an in-flight batch item: a fresh raster for
 * recompute, exported only while the preparing run and the prepared
 * single-source selection that started the batch are still current.
 */
async function exportBatchSource(
  request: Extract<UiToMainMessage, { type: "export-batch-source" }>,
): Promise<void> {
  try {
    const prepared = preparedSelection;
    if (
      !prepared ||
      prepared.generation !== request.generation ||
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      applying ||
      prepared.payload.targetNodeId ||
      !selectionMatches(prepared.payload.sourceNodeId) ||
      (prepared.payload.sources?.length ?? 0) > 0
    ) {
      throw userError("selectionChanged");
    }
    const result = await figma.getNodeByIdAsync(request.resultNodeId);
    if (!result || !isSceneNode(result) || nodePage(result)?.id !== figma.currentPage.id) {
      throw userError("resultUnavailable");
    }
    const binding = readResultBinding(result);
    const candidate = linkedBatchCandidates.get(result.id);
    const candidateMatches = () => candidate?.generation === request.generation &&
      candidate.batchRunId === request.batchRunId &&
      candidate.snapshot === linkedBatchSnapshot(result) &&
      candidate.dependencyNodeIds.every(id => linkedBatchCompleted.has(id));
    if (!candidateMatches() || !binding?.sourceNodeIds.includes(request.nodeId)) throw userError("resultChanged");
    const node = await figma.getNodeByIdAsync(request.nodeId);
    if (!node || !isSceneNode(node)) {
      // A deleted bound shape guide has its own recovery path: restore the
      // guide or reopen the task to rebind, instead of a selection complaint.
      const task = readStoredOperation(result);
      throw userError(task.status === "valid" && task.operation.kind === "task" &&
        task.operation.task.kind === "deformation" && task.operation.task.shapeGuideSourceIndex !== undefined &&
        binding.sourceNodeIds[task.operation.task.shapeGuideSourceIndex] === request.nodeId
          ? "linkedGuideUnavailable" : "selectionChanged");
    }
    if (
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      node.removed ||
      nodePage(node)?.id !== figma.currentPage.id
    ) {
      throw userError("selectionChanged");
    }
    const box = sourceRasterViewBox(node);
    if (!box || box.width <= 0 || box.height <= 0) throw userError("sourceNeedsVisibleBounds");
    if (candidate && result.type === "RECTANGLE" && canSaveNativeScene(result)) {
      if (!candidate.sceneProof) {
        const sources = await Promise.all(binding.sourceNodeIds.map(id => figma.getNodeByIdAsync(id)));
        if (!sources.every((source): source is SceneNode => source !== null && isSceneNode(source))) throw userError("resultChanged");
        candidate.sceneProof = await prepareSceneReadProof(sources);
      }
      candidate.sceneProof.validate();
    }
    // A refresh whose preview is short asks for the derivative-planned source,
    // which can be larger than the stored output frame. Cover that request,
    // keep at least the published frame, and stay inside the axis cap.
    const stored = storedRasterSize(result as RectangleNode);
    const requestedWidth = checkedOutputAxis(request.desiredWidth);
    const requestedHeight = checkedOutputAxis(request.desiredHeight);
    const requestedScale = Math.max(requestedWidth / box.width, requestedHeight / box.height);
    const storedScale = stored ? Math.max(stored.width / box.width, stored.height / box.height) : 0;
    const maximumScale = Math.min(
      MAX_FIGMA_IMAGE_AXIS / box.width,
      MAX_FIGMA_IMAGE_AXIS / box.height,
    );
    const exportScale = Math.min(Math.max(storedScale, requestedScale), maximumScale);
    if (!Number.isFinite(exportScale) || exportScale <= 0) throw userError("sourceUnsupportedSize");
    const bytes = await withTimeout(
      node.exportAsync({
        format: "PNG",
        ...sourceRasterBounds(node),
        constraint: { type: "SCALE", value: exportScale },
      }),
      SOURCE_EXPORT_TIMEOUT_MS,
      () => userError("sourceExportTimedOut"),
    );
    if (request.generation !== selectionGeneration || reloadScheduled || !sameSourceRasterViewBox(node, box)) throw userError("selectionChanged");
    if (!candidateMatches()) throw userError("resultChanged");
    candidate?.sceneProof?.validate();
    const shapeGuide=await captureDocumentShapeForSource(node);
    if(request.generation!==selectionGeneration || reloadScheduled || !candidateMatches()) throw userError("selectionChanged");
    const payload: LinkedBatchSourcePayload = {
      generation: request.generation,
      batchRunId: request.batchRunId,
      requestId: request.requestId,
      resultNodeId: request.resultNodeId,
      nodeId: request.nodeId,
      ...(shapeGuide ? {shapeGuide} : {}),
      bytes,
      renderWidth: checkedOutputAxis(Math.max(1, Math.round(box.width * exportScale))),
      renderHeight: checkedOutputAxis(Math.max(1, Math.round(box.height * exportScale))),
    };
    post({ type: "batch-source", ...payload });
  } catch (error) {
    post({
      type: "batch-source-error",
      generation: request.generation,
      batchRunId: request.batchRunId,
      requestId: request.requestId,
      resultNodeId: request.resultNodeId,
      nodeId: request.nodeId,
      message: toUserMessage(error, "unexpectedError"),
    });
  }
}

class UserFacingError extends Error {
  constructor(readonly userMessage: UserMessage) {
    super(userMessage.key);
  }
}

function userError(
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
): UserFacingError {
  return new UserFacingError(userMessage(key, values));
}

function toUserMessage(error: unknown, fallback: MessageKey): UserMessage {
  return error instanceof UserFacingError ? error.userMessage : userMessage(fallback);
}

function selectionMatches(sourceNodeId: string, targetNodeId?: string): boolean {
  const prepared = preparedSelection;
  if (!prepared || prepared.payload.sourceNodeId !== sourceNodeId ||
    prepared.payload.targetNodeId !== targetNodeId) return false;
  const actual = currentEditingSelection().map((node) => node.id).sort();
  const expected = [...prepared.selectedNodeIds].sort();
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function editingSelectionMatchesNode(nodeId: string): boolean {
  const selection = currentEditingSelection();
  return selection.length === 1 && selection[0]?.id === nodeId;
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function isSceneNode(node: BaseNode): node is SceneNode {
  return "visible" in node;
}

function post(message: MainToUiMessage): void {
  try {
    figma.ui.postMessage(message);
  } catch {
    // A closed UI cannot receive messages; the canvas state remains the
    // truthful outcome either way.
  }
}

/** The appearance workspace reads the live selection; native values win. */
function cardArtworkBounds(node: SceneNode): Rect | null {
  return sourceRasterViewBox(node);
}
function cardWriteSnapshot(node: SceneNode): string {
  return JSON.stringify({box:node.absoluteBoundingBox,name:node.name,parent:node.parent?.id,
    fills:"fills" in node ? node.fills : undefined,
    shared:node.getSharedPluginDataKeys(SHARED_NAMESPACE).sort().map(key=>[key,node.getSharedPluginData(SHARED_NAMESPACE,key)])});
}
function pngDimension(bytes: Uint8Array, offset: number): number {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80) throw new Error("Invalid source PNG");
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}
function cardSourceRevision(node: SceneNode): string {
  // Informational native-property fingerprint, not an authority for skipping
  // source exports or content-change events.
  const state = { id: node.id, name: node.name, size: node.absoluteBoundingBox,
    fills: "fills" in node ? node.fills : undefined, strokes: "strokes" in node ? node.strokes : undefined,
    text: "characters" in node ? node.characters : undefined, effects: "effects" in node ? node.effects : undefined,
    opacity: "opacity" in node ? node.opacity : undefined,
    vector: "vectorNetwork" in node ? node.vectorNetwork : undefined,
    font: "fontName" in node ? node.fontName : undefined,
    fontSize: "fontSize" in node ? node.fontSize : undefined,
    children: "children" in node ? node.children.map(child => cardSourceRevision(child)) : undefined };
  let hash = 2166136261;
  for (const char of JSON.stringify(state)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(16);
}

function readCardStill(node: SceneNode): {sourceNodeId: string; viewId: string; view: import("./card-wire").CardView} | undefined {
  try {
    const saved = JSON.parse(node.getSharedPluginData(SHARED_NAMESPACE, "card-still"));
    if (saved.schema === "worldbend.card-still" && typeof saved.sourceNodeId === "string" && isCardView(saved.view)) {
      return {sourceNodeId: saved.sourceNodeId, viewId: typeof saved.viewId === "string" ? saved.viewId : "custom", view: saved.view};
    }
  } catch { /* ordinary artwork */ }
  return undefined;
}

async function resolveCardSelection(): Promise<{nodes: SceneNode[]; selectedStill?: {viewId: string; view: import("./card-wire").CardView}; missingSource?: boolean; tooMany?: boolean}> {
  const selection = figma.currentPage.selection.filter(node => isSceneNode(node) && !isSceneDraftNode(node));
  if (selection.length > 2) return {nodes: [], tooMany: true};
  const first = selection[0];
  if (!first) return {nodes: []};
  const saved = readCardStill(first);
  if (!saved) return {nodes: selection};
  try {
    const source = await figma.getNodeByIdAsync(saved.sourceNodeId);
    if (!source || !isSceneNode(source) || source.removed || source === first) return {nodes: [], missingSource: true};
    return {nodes: [source, ...selection.slice(1).filter(node => node !== source)],
      selectedStill: {viewId: saved.viewId ?? "custom", view: saved.view}};
  } catch { return {nodes: [], missingSource: true}; }
}

async function postCardState(): Promise<void> {
  const generation = selectionGeneration;
  const resolved = await resolveCardSelection();
  if (generation !== selectionGeneration) return;
  const selection = resolved.nodes;
  cardObservedRoots.clear();
  cardObservedNodes.clear();
  observeNodeTree(cardObservedNodes, selection);
  for (const node of selection) cardObservedRoots.add(node.id);
  if (resolved.missingSource || resolved.tooMany) post({type: "card-error", generation, message: userMessage(resolved.tooMany ? "cardSelectOneWorkpiece" : "cardSourceUnavailable")});
  // The first selected node is the card front; a second selection is the
  // back-face candidate the workspace can assign explicitly.
  const nodes = selection.slice(0, 2).map((node, index) => {
    const snapshot: import("./messages").CardNodeSnapshot = {
      nodeId: node.id,
      name: node.name,
      width: (cardArtworkBounds(node))?.width ?? ("width" in node ? node.width : 0),
      height: (cardArtworkBounds(node))?.height ?? ("height" in node ? node.height : 0),
    };
    if (index === 0) {
      if (resolved.selectedStill) snapshot.selectedStill = resolved.selectedStill;
      snapshot.stills = figma.currentPage.findAll(child => child.type === "RECTANGLE").flatMap(child => {
        try { const saved = JSON.parse(child.getSharedPluginData(SHARED_NAMESPACE, "card-still"));
          return saved.schema === "worldbend.card-still" && saved.sourceNodeId === node.id && typeof saved.viewId === "string" && isCardView(saved.view)
            ? [{ viewId: saved.viewId, view: saved.view, ...(isCardSample(saved.sample) ? {sample: saved.sample} : {}) }] : [];
        } catch { return []; }
      });
      const binding = parseStoredCardBinding(
        node.getSharedPluginData(SHARED_NAMESPACE, SHARED_CARD_KEY),
      );
      if (binding) {
        snapshot.rig = binding.rig;
        if (binding.backNodeId) {
          snapshot.backNodeId = binding.backNodeId;
          cardObservedRoots.add(binding.backNodeId);
        }
      }
    }
    return snapshot;
  });
  post({ type: "card-state", generation: selectionGeneration, nodes });
}

function postAppearanceState(): void {
  const selection = figma.currentPage.selection.filter(isSceneNode);
  appearanceObservedStates.clear();
  for (const node of selection) appearanceObservedStates.set(node.id, appearanceExpectedState(node));
  post({
    type: "appearance-state",
    generation: selectionGeneration,
    nodes: selection.map(appearanceNodeSnapshot),
  });
}

/** The texture family shares the live-selection read and context preview. */
function postTextureState(): void {
  void postFoilState();
  void postMeshGradientState();
  const selection = figma.currentPage.selection.filter(isSceneNode);
  textureObservedStates.clear();
  for (const node of selection) textureObservedStates.set(node.id, textureExpectedState(node));
  post({
    type: "texture-state",
    generation: selectionGeneration,
    nodes: selection.map(textureNodeSnapshot),
  });
}

async function postFoilState():Promise<void> {
  const revision=++foilReadRevision, generation=selectionGeneration,page=figma.currentPage;
  const selection=page.selection.filter(node=>!isSceneDraftNode(node));
  foilReadyGeneration=undefined;
  try {
    const nodes:FoilNodeSnapshot[]=[],context=new FoilNativeReadContext();
    for(const node of selection) {
      nodes.push(await foilNodeSnapshot(node,context));
      if(revision!==foilReadRevision || generation!==selectionGeneration || page!==figma.currentPage)return;
    }
    if(!sameIds(page.selection.filter(node=>!isSceneDraftNode(node)).map(node=>node.id),selection.map(node=>node.id)) ||
       nodes.some(node=>!foilNodeSnapshotFresh(node)))throw Error('Material changed during capture');
    foilObservedStates.clear();for(const node of nodes)foilObservedStates.set(node.nodeId,node);
    foilReadyGeneration=generation;post({type:'foil-state',generation,nodes});
  }catch {
    if(revision!==foilReadRevision || generation!==selectionGeneration)return;
    foilObservedStates.clear();
    post({type:'foil-state',generation,nodes:selection.map(node=>({nodeId:node.id,name:node.name,eligible:false,reason:'invalid',state:'absent',
      live:null,provenance:null,customized:[],profile:null,resource:null,available:null,canChoose:false,canAdopt:false,warnings:[]}))});
  }
}

async function postMeshGradientState():Promise<void> {
  const revision=++meshGradientReadRevision, generation=selectionGeneration,page=figma.currentPage;
  const selection=page.selection.filter(node=>!isSceneDraftNode(node));
  meshGradientReadyGeneration=undefined;
  try {
    const nodes:MeshGradientNodeSnapshot[]=[],context=new MeshGradientNativeReadContext();
    for(const node of selection) {
      nodes.push(await meshGradientNodeSnapshot(node,context));
      if(revision!==meshGradientReadRevision || generation!==selectionGeneration || page!==figma.currentPage)return;
    }
    if(!sameIds(page.selection.filter(node=>!isSceneDraftNode(node)).map(node=>node.id),selection.map(node=>node.id)) ||
       nodes.some(node=>!meshGradientNodeSnapshotFresh(node)))throw Error('Material changed during capture');
    meshGradientObservedStates.clear();for(const node of nodes)meshGradientObservedStates.set(node.nodeId,node);
    meshGradientReadyGeneration=generation;post({type:'mesh-gradient-state',generation,nodes});
  }catch {
    if(revision!==meshGradientReadRevision || generation!==selectionGeneration)return;
    meshGradientObservedStates.clear();
    post({type:'mesh-gradient-state',generation,nodes:selection.map(node=>({nodeId:node.id,name:node.name,eligible:false,reason:'invalid',state:'absent',
      live:null,provenance:null,customized:[],profile:null,resource:null,available:null,canChoose:false,canAdopt:false,warnings:[]}))});
  }
}
import {cancelNativeTemporarySessions} from "./native-temporary-session";
