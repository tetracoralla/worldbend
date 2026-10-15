import {scaleSolveToRasterSize} from "./designer-preview";
import {deformationCanvasChange,deformationPublicationPlacement,planDeformationRaster,prepareDeformationRaster} from "./deformation-raster";
import { nativeFrameAvailability } from "./native-frame-availability";
import {nativePlacementPagePoint,nativePlacementPointFromPage} from "./native-output-position";
import { decodeSourceRaster } from "./source-raster-decode";
import {resolvedNativeVectorSourceView} from "./native-vector-view";
import type {NativeVectorSourceView} from "./native-vector-view";
import {nativeVectorExecutionFrame,resolveNativeVectorOperation,nativeVectorArtworkFromInputs} from "./native-vector-operation";
import { refreshNativeShapeFit } from "./native-shape-fit";
import { isUnchangedRasterProjection } from "./unchanged-raster";
import { observeHostVisibleViewport } from "./host-visible-viewport";
import { deformationArtworkIndex, deformationTask, deformationTaskSourceCount } from "./stored-designer-task";
import { deformationTemplateWorkForSource } from "./stored-template-library";
import {
  buildWarpMesh,
  planNativeFrame,
  rebaseNativeAffine,
  type NativeFramePlan,
  composeAffineTransform,
  emitCssTransform,
  createPreviewViewport,
  estimateSourceRasterSize,
  formatZoomPercent,
  identityTransformRecipe,
  normalizedSpec,
  PerspectiveEditor,
  planVectorArtwork,
  projectDeformationClip,
  rectifyPlane,
  solveTransform,
  unitQuad,
  awaitImageDecoded,
  type AffineComposition,
  type PerspectiveCorner,
  type Point,
  type Quad,
  type Size,
  type TransformGestureEvent,
  type TransformHandle,
  type TransformRecipe,
  type VectorProjectionInput,
  type VectorProjectionOutput,
  type WarpSpec,
  type WarpPreset,
  type PreviewViewportHandle,
  type PreviewSolveOutput,
  type RectifyPlan,
  type RectifySpecInput,
  type TransformSpec,
  type WarpMesh,
} from "@worldbend/web";
import type {
  MainToUiMessage,
  NativeVectorProjectionPayload,
  Placement,
  SourcePayload,
  SourceRasterPayload,
  UiToMainMessage,
} from "./messages";
import { withTimeout } from "./async-timeout";
import { copyPlacementParameters, placementParametersJson } from "./copy-parameters";
import { MAX_FIGMA_IMAGE_AXIS } from "./stored-plane";
import {
  frameFromComposition,
  frameFromSource,
  rebaseTransformFrame,
  sameTransformSpec,
  sameTransformFrame,
  type TransformFrame,
} from "./transform-frame";
import {
  createTransformControls,
  type TransformControls,
  type TransformInputValues,
} from "./transform-controls";
import { createLocaleView, nextMenuIndex, type OptionsMenuView } from "./locale-view";
import { messageFromError } from "./error-messages";
import {
  createFrameCoalescer,
  createLatestAsyncQueue,
  createLatestFrameCoalescer,
} from "./frame-coalescer";
import {
  changePivotWithoutMoving,
  pivotPreviewPoint,
  wrapDegrees,
  type GestureFrame,
} from "./recipe-gestures";
import { createTransformGestureSession } from "./transform-gesture-session";
import { createPivotPicker, type PivotPicker } from "./pivot-picker";
import {
  createAppliedTransformMemory,
  effectiveFlipState,
  parsePlacementValue,
} from "./transform-actions";
import {
  createDeferredEditCommit,
  createEditHistory,
  type EditHistory,
  type EditHistoryEntry,
} from "./edit-history";
import {
  canStartTransformGesture,
  canSwitchEditorMode,
  previewZoomCommand,
  shouldApplyOnEnter,
  shouldCancelOnEscape,
  shouldHoldSpacePan,
  shouldRedoInPlugin,
  shouldRouteAppliedUndo,
  shouldUndoInPlugin,
  validityAfterSourceLoad,
  type DistortMode,
  type EditorMode,
  type Phase,
} from "./editor-state";
import {
  formatPercent,
  resolveLocale,
  translate,
  userMessage,
  type LocalePreference,
  type MessageKey,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";
import { nativeVectorStatusMessage } from "./native-vector-status";
import { createWarpPicker } from "./warp-picker";
import { createSceneDraftClient } from "./scene-draft-client";
import { createSceneDraftToken } from "./scene-draft-id";
import { LIVE_SCENE_DRAFT_ENABLED } from "./scene-draft-policy";
import { parseWarpControls, warpAmountPercent, WARP_PRESETS } from "./warp-controls";
import { sliderProgress } from "./slider-domain";
import {
  canApplyOutput,
  outputSizeForQuad,
  planFigmaOutput,
  rasterSizeForPolicy,
  type FigmaOutputPlan,
  type OutputDensityPolicy,
  type PixelSize,
} from "./output-density";
import {
  createProductWorkspaceRouter,
  type ProductWorkspace,
  type ProductWorkspaceRouter,
} from "./product-workspace";
import {
  createWorkspaceNavigation,
  defaultWorkspaceForSourceCount,
  taskWorkspaceAvailability,
} from "./task-launcher";
import { createHorizontalStrip } from "./horizontal-strip";
import { createContextualHelp } from "./contextual-help";
import { createCanvasWorkspace } from "./canvas-workspace";
import type { CanvasWorkspaceCopy } from "./canvas-workspace-view";
import { createMeshWorkspace, type MeshWorkspaceCopy } from "./mesh-workspace";
import { createSurfaceWorkspace, type SurfaceWorkspaceCopy } from "./surface-workspace";
import {
  deformationWorkFromPlaneView,
  planeSpecComposesWithDeformation,
  planeSpecFromDeformationWork,
  type DeformationWorkView,
} from "./deformation-work-state";
import {
  batchOperationWork,
  createBatchRenderer,
  parseBatchOperation,
  type ParsedBatchOperation,
} from "./batch-update";
import type { StoredOperation } from "./stored-operation";
import type { DeformationWorkSpecInput } from "@worldbend/web";
import { planDeformationWork } from "./designer-plan";
import {
  designerDeformationTask,
  deformationArtworkSource,
  postDesignerResult,
  sameJsonValue,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import { createMockupWorkspace, type MockupWorkspaceCopy } from "./mockup-workspace";
import { createRemapWorkspace, type RemapWorkspaceCopy } from "./remap-workspace";
import { createAppearanceWorkspace, type AppearanceWorkspaceCopy } from "./appearance-workspace";
import { createCardWorkspace, type CardWorkspaceCopy } from "./card-workspace";
import { createPresetWorkspace } from "./preset-workspace";
import { createSpatialWorkspace, type SpatialWorkspaceCopy } from "./spatial-workspace";
import { createTemplateWorkspace, type TemplateWorkspaceCopy } from "./template-workspace";

const TRANSFORM_PREVIEW_TIMEOUT_MS = 5_000;
const SOURCE_RASTER_TIMEOUT_MS = 10_000;

const editorMount = required<HTMLDivElement>("editor");
const canvasWorkspaceRoot = required<HTMLElement>("canvas-workspace");
const spatialWorkspaceRoot = required<HTMLElement>("spatial-workspace");
const mockupWorkspaceRoot = required<HTMLElement>("mockup-workspace");
const meshWorkspaceRoot = required<HTMLElement>("mesh-workspace");
const surfaceWorkspaceRoot = required<HTMLElement>("surface-workspace");
const remapWorkspaceRoot = required<HTMLElement>("remap-workspace");
const appearanceWorkspaceRoot = required<HTMLElement>("appearance-workspace");
const cardWorkspaceRoot = required<HTMLElement>("card-workspace");
const presetsWorkspaceRoot = required<HTMLElement>("presets-workspace");
const templatesWorkspaceRoot = required<HTMLElement>("templates-workspace");
const selectionState = required<HTMLElement>("selection-state");
const selectionTitle = required<HTMLElement>("selection-title");
const selectionDetail = required<HTMLElement>("selection-detail");
const selectionContinue = required<HTMLElement>("selection-continue");
const nativeRecoverButton = required<HTMLButtonElement>("native-recover");
let nativeRecovery: { nodeId: string; expected: string } | undefined;
const sourceName = required<HTMLOutputElement>("source-name");
const linkedResultsTrigger = required<HTMLButtonElement>("linked-results-trigger");
const linkedResultsPopover = required<HTMLElement>("linked-results-popover");
const linkedResultsTitle = required<HTMLElement>("linked-results-title");
const linkedResultsList = required<HTMLElement>("linked-results-list");
const linkedResultsMore = required<HTMLElement>("linked-results-more");
const errorMessage = required<HTMLElement>("error");
const errorText = required<HTMLSpanElement>("error-text");
const errorDismiss = required<HTMLButtonElement>("error-dismiss");
const statusMessage = required<HTMLParagraphElement>("status");
const controls = required<HTMLElement>("controls");
const historyInputValues = new Map<HTMLInputElement, string>();
const applyButton = required<HTMLButtonElement>("apply");
const resetButton = required<HTMLButtonElement>("reset");
const modeSwitch = required<HTMLDivElement>("mode-switch");
const modeTransformButton = required<HTMLButtonElement>("mode-transform");
const modeDistortButton = required<HTMLButtonElement>("mode-distort");
const modeWarpButton = required<HTMLButtonElement>("mode-warp");
const modeRectifyButton = required<HTMLButtonElement>("mode-rectify");
const contextControls = required<HTMLDivElement>("context-controls");
const distortOptions = required<HTMLDivElement>("distort-options");
const distortKind = required<HTMLDivElement>("distort-kind");
const distortFreeButton = required<HTMLButtonElement>("distort-free");
const distortPerspectiveButton = required<HTMLButtonElement>("distort-perspective");
const transformOptions = required<HTMLDivElement>("transform-options");
const warpOptions = required<HTMLDivElement>("warp-options");
const rectifyOptions = required<HTMLDivElement>("rectify-options");
const rectifyWidthLabel = required<HTMLSpanElement>("rectify-width-label");
const rectifyHeightLabel = required<HTMLSpanElement>("rectify-height-label");
const rectifyWidthInput = required<HTMLInputElement>("rectify-width");
const rectifyHeightInput = required<HTMLInputElement>("rectify-height");
const warpPresetLabel = required<HTMLLabelElement>("warp-preset-label");
const warpPresetSelect = required<HTMLSelectElement>("warp-preset");
const warpAmountLabel = required<HTMLSpanElement>("warp-amount-label");
const warpAmountSlider = required<HTMLInputElement>("warp-amount-slider");
const warpAmountInput = required<HTMLInputElement>("warp-amount");
const warpMeshContinue = required<HTMLButtonElement>("warp-mesh-continue");
const linkScaleButton = required<HTMLButtonElement>("link-scale");
const moreOptionsButton = required<HTMLButtonElement>("more-options");
const settingsPopover = required<HTMLDivElement>("settings-popover");
const perspectiveOptionsTitle = required<HTMLParagraphElement>("perspective-options-title");
const transformActions = required<HTMLDivElement>("transform-actions");
const actionFlipX = required<HTMLButtonElement>("action-flip-x");
const actionFlipY = required<HTMLButtonElement>("action-flip-y");
const actionRotateCw = required<HTMLButtonElement>("action-rotate-cw");
const actionCopyParameters = required<HTMLButtonElement>("action-copy-parameters");
const actionTransformAgain = required<HTMLButtonElement>("action-transform-again");
const actionCopyCss = required<HTMLButtonElement>("action-copy-css");
const actionApplyCopy = required<HTMLButtonElement>("action-apply-copy");
const actionApplyEditable = required<HTMLButtonElement>("action-apply-editable");
const editNativeSourceButton=required<HTMLButtonElement>("edit-native-source");
const nativeSourceEditing=required<HTMLDivElement>("native-source-editing");
const nativeSourceTitle=required<HTMLElement>("native-source-title");
const nativeSourceDescription=required<HTMLParagraphElement>("native-source-description");
const actionApplyVector = required<HTMLButtonElement>("action-apply-vector");
const nativeGuidance = required<HTMLParagraphElement>("native-guidance");
const openEffectListing = required<HTMLButtonElement>("open-effect-listing");
const workspaceNavigationRoot = required<HTMLElement>("workspace-navigation");
const workspaceStripViewport = required<HTMLElement>("workspace-strip-viewport");
const workspaceBackward = required<HTMLButtonElement>("workspace-backward");
const workspaceForward = required<HTMLButtonElement>("workspace-forward");
const modeStripViewport = required<HTMLElement>("mode-strip-viewport");
const modeBackward = required<HTMLButtonElement>("mode-backward");
const modeForward = required<HTMLButtonElement>("mode-forward");
const shortcutHelp = required<HTMLParagraphElement>("shortcut-help");
const placementToggle = required<HTMLButtonElement>("placement-toggle");
const placementPanel = required<HTMLDivElement>("advanced-placement");
const placementClose = required<HTMLButtonElement>("placement-close");
const placementLabel = required<HTMLSpanElement>("placement-label");
const pivotLabel = required<HTMLSpanElement>("pivot-label");
const pivotGrid = required<HTMLDivElement>("pivot-grid");
const positionXLabel = required<HTMLSpanElement>("position-x-label");
const positionYLabel = required<HTMLSpanElement>("position-y-label");
const positionXInput = required<HTMLInputElement>("position-x");
const positionYInput = required<HTMLInputElement>("position-y");
const zoomLevelOutput = required<HTMLOutputElement>("zoom-level");
const scaleXLabel = required<HTMLSpanElement>("scale-x-label");
const scaleYLabel = required<HTMLSpanElement>("scale-y-label");
const rotationLabel = required<HTMLSpanElement>("rotation-label");
const skewXLabel = required<HTMLSpanElement>("skew-x-label");
const skewYLabel = required<HTMLSpanElement>("skew-y-label");
const settingsTitle = required<HTMLParagraphElement>("settings-title");
const outputSettingsTitle = required<HTMLParagraphElement>("output-settings-title");
const outputPolicyFit = required<HTMLButtonElement>("output-policy-fit");
const outputPolicyFitLabel = required<HTMLSpanElement>("output-policy-fit-label");
const outputPolicyFitDetail = required<HTMLElement>("output-policy-fit-detail");
const outputPolicyOriginal = required<HTMLButtonElement>("output-policy-original");
const outputPolicyOriginalLabel = required<HTMLSpanElement>("output-policy-original-label");
const outputPolicyOriginalDetail = required<HTMLElement>("output-policy-original-detail");
const outputSize = required<HTMLOutputElement>("output-size");
const outputSizeFlow = required<HTMLSpanElement>("output-size-flow");
const outputSizeNote = required<HTMLSpanElement>("output-size-note");
const localeSystem = required<HTMLSpanElement>("locale-system");
const localeSystemDetail = required<HTMLElement>("locale-system-detail");
const localeEnglish = required<HTMLSpanElement>("locale-en-label");
const localeChinese = required<HTMLSpanElement>("locale-zh-CN-label");
const nativeHelpContent = document.createElement("div");
nativeHelpContent.append(nativeGuidance, openEffectListing);
const nativeHelp = createContextualHelp({ content: nativeHelpContent, interactive: true });
nativeHelp.button.id = "native-help";
nativeHelp.button.hidden = true;
required<HTMLElement>("output-actions").append(nativeHelp.button);

type ShownNodes = { nodeIds: string[]; sourceNodeIds: readonly string[] };
type ActiveSource = Omit<SourcePayload, "bytes" | "sources"> & {
  sources?: Array<Omit<NonNullable<SourcePayload["sources"]>[number], "bytes">>;
};

let current: ActiveSource | undefined;
let pendingDesignerPublication: {
  generation: number;
  targetNodeId: string;
  task: Extract<UiToMainMessage, { type: "apply-designer" }>["payload"]["task"];
} | undefined;
// Which layers the editor currently shows. Unlike `current`, this survives a
// selection reload, so chained refreshes of the same layers keep the quad.
let lastShownNodes: ShownNodes | undefined;
let loadingNodeIds: readonly string[] = [];
let refreshInFlight = false;
let nativeRendererUpdate: Extract<MainToUiMessage, { type: "source-renderer" }> | undefined;
// One decoded full-resolution source, never rendered result pixels. Exact
// requested dimensions keep warm and cold sampling identical. A source edit
// or selection refresh releases it on the leading edge, before async work.
let finalSourceRaster: {
  source: ActiveSource; generation: number; width: number; height: number;
  image: HTMLImageElement; bytes: Uint8Array;
} | undefined;
let activeGeneration = 0;
let valid = false;
let phase: Phase = "idle";
const systemLocales = readSystemLocales();
let localePreference: LocalePreference = "system";
let activeLocale: SupportedLocale = resolveLocale(localePreference, systemLocales);
let selectionMessage: UserMessage = userMessage("selectOneSource");
let visibleError: UserMessage | undefined;
let visibleStatus: UserMessage | undefined;
let editorMode: EditorMode = "distort";
let distortMode: DistortMode = "free";
let initialFrame: TransformFrame | undefined;
let baseFrame: TransformFrame | undefined;
let activeFrame: TransformFrame | undefined;
let rectifyParent:
  | { initialFrame: TransformFrame; entry: EditHistoryEntry }
  | undefined;
let rectifyInputsValid = true;
let rectifyInitialOutput = { width: "1024", height: "1024" };
let placementCanonical = { x: "0", y: "0" };
let composeGeneration = 0;
let composeInFlight = false;
// Continuous controls keep the task surface interactive while their
// latest-wins preview queue is running. Blocking compositions (mode switches,
// reset, undo, apply preparation) retain the ordinary disabled state.
let continuousPreviewInFlight = false;
let outputDensityPolicy: OutputDensityPolicy = "fit";
let transformInputsValid = true;
// Distort changes are rendered immediately by the editor, then reframed once
// through the core before mode switching or publication. Pointer-up can beat
// the coalesced onChange callback, so onEditEnd marks this independently.
let distortFrameDirty = false;
// Set once an applied-state Cmd/Ctrl+Z has been routed to the host; further
// presses stay with the plugin until the reload or next apply clears it.
let undoRouted = false;
// Apply publishes beside the selected source but does not end the session.
// Until the next local edit, one ordinary Undo may still remove that fresh
// Figma result; afterwards Undo belongs to the plugin-local draft history.
let appliedResultPending = false;
let appliedNativeRevision: {nodeId:string;revision:number}|undefined;
let pendingReplacementBaseline: { generation: number; frame: TransformFrame } | undefined;
let nextSourceRasterRequestId = 1;
const pendingSourceRasterRequests = new Map<
  number,
  {
    generation: number;
    timer: ReturnType<typeof setTimeout>;
    resolve: (raster: Pick<SourceRasterPayload,"bytes"|"captureFacts">) => void;
    reject: (error: unknown) => void;
  }
>();
interface PendingNativeVectorProjection {
  generation: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: {
    inputs: VectorProjectionInput[];
    placement: Placement;
    sourceFingerprint: string;sourceView:NativeVectorSourceView;operationExpected:string;
  }) => void;
  reject: (message: UserMessage) => void;
}
const pendingNativeVectorProjections = new Map<number, PendingNativeVectorProjection>();
const NATIVE_VECTOR_PROJECTION_TIMEOUT_MS = 15_000;
/**
 * Generations whose native relay failed the core's fidelity contract and
 * continued on the HD image route, so the completion status can state why
 * no native result was published.
 */
const nativeVectorFallbackGenerations = new Set<number>();

/**
 * Relay one projection through the main thread's fresh source read and the
 * shared WASM bridge. The core owns every projection semantic; this UI only
 * transports data between the two plugin threads.
 */
function requestNativeVectorProjection(
  payload: NativeVectorProjectionPayload,
): Promise<{inputs:VectorProjectionInput[];placement:Placement;sourceFingerprint:string;sourceView:NativeVectorSourceView;operationExpected:string}> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingNativeVectorProjections.delete(payload.generation)) {
        reject(userMessage("nativeVectorApplyFailed"));
      }
    }, NATIVE_VECTOR_PROJECTION_TIMEOUT_MS);
    pendingNativeVectorProjections.set(payload.generation, {
      generation: payload.generation,
      timer,
      resolve,
      reject,
    });
    post({ type: "request-native-vector-projection", payload });
  });
}

function failPendingApply(generation: number, message: UserMessage): void {
  pendingReplacementBaseline = undefined;
  appliedTransformMemory.fail(generation);
  refreshInFlight = false;
  undoRouted = false;
  appliedResultPending = false;
  phase = current ? "ready" : "idle";
  showError(message);
  renderState();
  // The publication never reached the document; restore the live draft
  // feedback just like a host-side apply rejection.
  syncSceneDraft();
}
// Canvas translation accumulated outside the numeric fields. It composes on
// every recipe; a mode switch or reset bakes it into the base frame.
let gestureTranslation: Point = { x: 0, y: 0 };
// Explicit source-orientation flips and the reference point, both recipe
// state that lives outside the numeric fields and bakes on mode switches.
let recipeFlip: { x: boolean; y: boolean } = { x: false, y: false };
let recipePivot: Point = { x: 0.5, y: 0.5 };
// The last committed transform, remembered for Transform Again. Translation
// is remembered in the base render pixels it was composed against.
const appliedTransformMemory = createAppliedTransformMemory();
let lastCompose:
  | { composition: AffineComposition; recipe: TransformRecipe }
  | undefined;
const transformGestureSession = createTransformGestureSession();
let history: EditHistory | undefined;
const deferredHistoryCommit = createDeferredEditCommit(() => commitHistoryNow());
const gesturePreviewWork = createLatestAsyncQueue(
  async (sample: { recipe: TransformRecipe; settleViewport: boolean }) => updateTransformPreview({
    recipe: sample.recipe,
    liveGesture: true,
    settleViewport: sample.settleViewport,
  }),
  { preserve: (sample) => sample.settleViewport },
);
const gesturePreviewFrames = createLatestFrameCoalescer(flushTransformGesturePreview);
const controlPreviewWork = createLatestAsyncQueue(
  async (sample: { recipe: TransformRecipe; final: boolean;values:TransformInputValues }) => updateTransformPreview({
    recipe: sample.recipe,
    liveGesture: true,
    commitBoundary: sample.final,
    ...(sample.final?{commitControls:sample.values}:{}),
  }),
  { preserve: (sample) => sample.final,onPendingChange:()=>renderState() },
);
const controlPreviewFrames = createLatestFrameCoalescer(
  (sample: { recipe: TransformRecipe; final: boolean;values:TransformInputValues }) => controlPreviewWork.request(sample),
);
const warpPreviewWork = createLatestAsyncQueue(
  async (sample: { preset: string; amount: string; final: boolean }) => updateWarpPreview(
    sample.final,
    { preset: sample.preset, amount: sample.amount },
    true,
  ),
  { preserve: (sample) => sample.final },
);
const warpPreviewFrames = createLatestFrameCoalescer(
  (sample: { preset: string; amount: string; final: boolean }) => warpPreviewWork.request(sample),
);

const editor = createEditor();
if (editor) editorMount.append(editor.element);
const viewport: PreviewViewportHandle | undefined = editor
  ? createPreviewViewport(editor, editorMount, {
      onScaleChange: renderZoomLevel,
      onEdgePanChange(edge) {
        if (edge.x) editorMount.dataset.edgePanX = edge.x;
        else delete editorMount.dataset.edgePanX;
        if (edge.y) editorMount.dataset.edgePanY = edge.y;
        else delete editorMount.dataset.edgePanY;
      },
    })
  : undefined;
const distortEndFrames = createFrameCoalescer(() => {
  if (phase !== "ready" || editorMode !== "distort" || !current || refreshInFlight) return;
  // Only viewport presentation waits for paint. The completed edit is already
  // recorded synchronously, so a refresh cannot cancel its Undo boundary.
  viewport?.revealAllCorners({ animate: true });
});

// Publication-parity feedback on the real Figma canvas. Figma exposes no
// transient canvas overlay, so the main thread owns one marked document node
// after the first actual edit. The node is never the published result.
const sceneDraft = createSceneDraftClient({
  intervalMs: 200,
  render: async () => {
    if (productWorkspace.current() !== "perspective") return undefined;
    if (!editor || !activeFrame || phase !== "ready" || refreshInFlight || composeInFlight) return undefined;
    if (editorMode !== "transform" && editorMode !== "distort" && editorMode !== "warp") return undefined;
    if (carriedDeformation && planeSpecComposesWithDeformation(activeFrame.spec)) {
      const workspaceSource = meshWorkspace.currentSource() ?? surfaceWorkspace.currentSource();
      if (!workspaceSource) return undefined;
      const work = deformationWorkFromPlaneView(carriedDeformation.work, activeFrame.spec,
        { width: activeFrame.renderWidth, height: activeFrame.renderHeight });
      const plan = await planDeformationWork(work);
      let placement = await deformationPublicationPlacement(workspaceSource, plan);
      if (!workspaceSource.targetNodeId) {
        // The transient canvas preview has no saved result placement yet; anchor
        // its expanded origin to the artwork's own pixel density instead.
        const artwork = deformationArtworkSource(workspaceSource);
        if (!artwork) return undefined;
        const origin = plan.authoredView?.canvasOrigin ?? { x: 0, y: 0 };
        placement = {
          ...placement,
          x: artwork.placement.x + origin.x * artwork.placement.width / artwork.renderWidth,
          y: artwork.placement.y + origin.y * artwork.placement.height / artwork.renderHeight,
        };
      }
      const scale = Math.min(1, 1024 / Math.max(placement.width, placement.height, 1));
      const width = Math.max(1, Math.round(placement.width * scale));
      const height = Math.max(1, Math.round(placement.height * scale));
      const bytes = await editor.exportPng(width, height, activeFrame.spec, undefined,
        { solved: scaleSolveToRasterSize(plan.meshWarp.solve, { width, height }),
          warpMesh: plan.meshWarp.spec.mesh, ...(plan.clip ? { clip: plan.clip } : {}) });
      return { bytes, renderWidth: width, renderHeight: height, placement };
    }
    const placement = activeFrame.placement;
    const scale = Math.min(1, 1024 / Math.max(placement.width, placement.height, 1));
    const width = Math.max(1, Math.round(placement.width * scale));
    const height = Math.max(1, Math.round(placement.height * scale));
    const bytes = await editor.exportPng(width, height, activeFrame.spec);
    return { bytes, renderWidth: width, renderHeight: height, placement };
  },
  send: (frame) => {
    post({ type: "scene-draft", generation: activeGeneration, ...frame });
  },
  clear: () => {
    post({ type: "scene-draft-clear", generation: activeGeneration });
  },
});
function clearSceneDraftFeedback(): void {
  sceneDraft.cancel();
  post({ type: "scene-draft-clear", generation: activeGeneration });
}
// Ask the main thread to clear early when the iframe unloads. Figma's main-
// thread `close` event is the synchronous guarantee; the next-run stale-draft
// sweep remains the abnormal-exit backstop.
addEventListener("pagehide", () => {
  post({ type: "scene-draft-clear", generation: activeGeneration });
});

const transformControls: TransformControls = createTransformControls({
  scaleX: control("scale-x"),
  scaleY: control("scale-y"),
  rotation: control("rotation"),
  skewX: control("skew-x"),
  skewY: control("skew-y"),
  scaleLinkButton: linkScaleButton,
  onRecipeChange: () => requestTransformControlPreview(false),
  onScaleLinkChange: renderScaleLink,
  onRecipeCommit: () => {
    requestTransformControlPreview(true);
  },
});

const localeView: OptionsMenuView = createLocaleView({
  moreOptionsButton,
  settingsPopover,
  menuButtons: Array.from(
    settingsPopover.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']"),
  ),
  localeButtons: Array.from(
    settingsPopover.querySelectorAll<HTMLButtonElement>("[data-locale]"),
  ),
  onSelectPreference(preference) {
    applyLocale(preference, resolveLocale(preference, systemLocales));
    post({ type: "set-locale", preference });
  },
});

const warpPicker = createWarpPicker(warpPresetSelect, warpPresetLabel);

let productWorkspace!: ProductWorkspaceRouter;
let workspaceNavigation!: ReturnType<typeof createWorkspaceNavigation>;
const canvasWorkspace = createCanvasWorkspace({
  root: canvasWorkspaceRoot,
  copy: canvasWorkspaceCopy,
  onBack() {
    productWorkspace.returnToPerspective();
  },
  post,
  async requestSourceRaster(source,desired) {
    const raw=await requestSourceRaster(source,desired);
    return (await decodeSourceRaster(raw.bytes,raw.captureFacts)).bytes;
  },
  decodeImage: imageFromBytes,
  formatError(error) {
    return translate(activeLocale, messageFromError(error, "unexpectedError"));
  },
});
const spatialWorkspace = createSpatialWorkspace({
  root: spatialWorkspaceRoot,
  copy: spatialWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const meshWorkspace = createMeshWorkspace({
  root: meshWorkspaceRoot,
  copy: meshWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  captureSourceRaster: captureDesignerDeformationRaster,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
  livePerspective() {
    if (!editor || !activeFrame || editorMode === "rectify") return undefined;
    return {
      spec: editor.captureSpec(),
      width: activeFrame.renderWidth,
      height: activeFrame.renderHeight,
    };
  },
});
const surfaceWorkspace = createSurfaceWorkspace({
  root: surfaceWorkspaceRoot,
  copy: surfaceWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  captureSourceRaster: captureDesignerDeformationRaster,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
  livePerspective() {
    if (!editor || !activeFrame || editorMode === "rectify") return undefined;
    return {
      spec: editor.captureSpec(),
      width: activeFrame.renderWidth,
      height: activeFrame.renderHeight,
    };
  },
});
const mockupWorkspace = createMockupWorkspace({
  root: mockupWorkspaceRoot,
  copy: mockupWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  liveDeformationWork(){return carriedDeformation?.work;},
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const remapWorkspace = createRemapWorkspace({
  root: remapWorkspaceRoot,
  copy: remapWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const appearanceWorkspace = createAppearanceWorkspace({
  root: appearanceWorkspaceRoot,
  copy: appearanceWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const presetsWorkspace = createPresetWorkspace({
  root: presetsWorkspaceRoot,
  copy: () => ({title:translate(activeLocale,"workspacePresets"),names:{
    "pointer-tilt":translate(activeLocale,"presetPointerTilt"),"idle-tilt":translate(activeLocale,"presetIdleTilt"),
    "card-turn":translate(activeLocale,"presetCardTurn"),"fold-screen":translate(activeLocale,"presetFoldScreen")},
    amount:translate(activeLocale,"presetAmount"),apply:translate(activeLocale,"presetApply"),applying:translate(activeLocale,"applying"),
    applied:translate(activeLocale,"designerApplied"),cancel:translate(activeLocale,"materialCancel"),editSource:translate(activeLocale,"presetEditSource"),
    loading:translate(activeLocale,"loadingSelection"),selectionEmpty:translate(activeLocale,"presetSelectionEmpty"),
    previewNote:translate(activeLocale,"presetPreviewNote")}),
  post,formatError(error){return translate(activeLocale,messageFromError(error,"unexpectedError"));},
});
const cardWorkspace = createCardWorkspace({
  root: cardWorkspaceRoot,
  copy: cardWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const templateWorkspace = createTemplateWorkspace({
  root: templatesWorkspaceRoot,
  copy: templateWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  onCreate(target) { productWorkspace.enter(target); },
  async onUse(template, isCurrent) {
    if (template.schema === "worldbend.figma-task-template") {
      if (template.operation.kind === "deformation") {
        const source = current;
        if (!source || !isCurrent()) return false;
        const work = deformationTemplateWorkForSource(template.operation.spec, source);
        // Resizing can change output/curve resource bounds even though every
        // normalized control is retained. Validate the rebound Pin work too.
        if (template.operation.view === "pin") {
          await planDeformationWork(work);
          if (current !== source || !isCurrent()) return false;
        }
        const loaded = template.operation.view === "mesh"
          ? await meshWorkspace.loadDeformationTemplate(work, isCurrent)
          : surfaceWorkspace.loadDeformationWork(work, "template");
        if (!loaded || current !== source || !isCurrent()) return false;
        // A template replaces the complete work; it does not compose an old
        // Plane draft into the saved controls during workspace navigation.
        routingStoredSource = true;
        try { productWorkspace.enter(template.operation.view === "pin" ? "surface" : "mesh"); }
        finally { routingStoredSource = false; }
        carriedDeformation = { work: structuredClone(work), view: template.operation.view };
        return true;
      }
      if (template.operation.kind === "mesh") {
        if (!meshWorkspace.loadTemplate(template.operation.spec)) return false;
        productWorkspace.enter("mesh");
        return true;
      }
      if (template.operation.kind === "surface") {
        if (!surfaceWorkspace.loadTemplate(template.operation.spec)) return false;
        productWorkspace.enter("surface");
        return true;
      }
      if (!canvasWorkspace.loadTemplate(template.operation.spec, "outputNames" in template ? template.outputNames : undefined)) return false;
      productWorkspace.enter("canvas");
      return true;
    }
    if (!mockupWorkspace.loadTemplate(template)) return false;
    productWorkspace.enter("mockup");
    return true;
  },
  post,
  formatError(error) { return translate(activeLocale, messageFromError(error, "unexpectedError")); },
});
const designerWorkspaces: Record<"spatial" | "mesh" | "surface" | "mockup" | "remap" | "appearance" | "card" | "presets" | "templates", DesignerTaskWorkspace> = {
  spatial: spatialWorkspace,
  mesh: meshWorkspace,
  surface: surfaceWorkspace,
  mockup: mockupWorkspace,
  remap: remapWorkspace,
  appearance: appearanceWorkspace,
  card: cardWorkspace,
  presets: presetsWorkspace,
  templates: templateWorkspace,
};
const taskRoots = {
  canvas: canvasWorkspaceRoot,
  spatial: spatialWorkspaceRoot,
  mockup: mockupWorkspaceRoot,
  mesh: meshWorkspaceRoot,
  surface: surfaceWorkspaceRoot,
  remap: remapWorkspaceRoot,
  appearance: appearanceWorkspaceRoot,
  card: cardWorkspaceRoot,
  presets: presetsWorkspaceRoot,
  templates: templatesWorkspaceRoot,
} as const;
let routingStoredSource = false;
productWorkspace = createProductWorkspaceRouter({
  onChange(previous, next) {
    pendingDesignerPublication = undefined;
    const leavingPendingPlane = previous === "perspective" && pendingCarriedPlane !== undefined;
    if (previous === "perspective") pendingCarriedPlane = undefined;
    if (previous === "perspective") clearSceneDraftFeedback();
    // Pin and Mesh are two views of one deformation work. Carry the current
    // unpublished draft across the existing workspace navigation so a view
    // switch never requires publishing, reopening, or reconstructing state.
    if (!routingStoredSource && previous === "mesh" && next === "surface") {
      const work = meshWorkspace.currentDeformationWork();
      if (work) surfaceWorkspace.loadDeformationWork(work);
    } else if (!routingStoredSource && previous === "surface" && next === "mesh") {
      const work = surfaceWorkspace.currentDeformationWork();
      if (work) void meshWorkspace.loadDeformationWork(work);
    }
    // The Plane editor is the third view over that same work. Leaving a
    // deformation view records the current draft; returning to the Plane
    // editor loads its plane and previews the interior instead of leaving
    // the deformation invisible behind an unrelated plane state.
    if (!routingStoredSource && (previous === "mesh" || previous === "surface")) {
      captureCarriedDeformation(previous === "mesh" ? "mesh" : "pin");
    }
    if (!routingStoredSource && previous === "perspective" && (next === "mesh" || next === "surface")) {
      composeCarriedPlaneIntoDeformationView(next === "mesh" ? "mesh" : "surface", leavingPendingPlane);
    }
    if (!routingStoredSource && next === "perspective" && (previous === "mesh" || previous === "surface")) {
      void carryDeformationIntoPlane();
    }
    if (previous === "canvas") canvasWorkspace.leave();
    if (previous === "spatial" || previous === "mesh" || previous === "surface" || previous === "mockup" || previous === "remap" || previous === "appearance" || previous === "card" || previous === "presets" || previous === "templates") designerWorkspaces[previous].leave();
    if (previous !== "perspective") taskRoots[previous].hidden = true;
    controls.inert = next !== "perspective";
    controls.hidden = next !== "perspective" || !current;
    selectionState.hidden = next !== "perspective" || Boolean(current);
    if (next === "canvas") canvasWorkspace.enter();
    if (next === "spatial" || next === "mesh" || next === "surface" || next === "mockup" || next === "remap" || next === "appearance" || next === "card" || next === "presets" || next === "templates") designerWorkspaces[next].enter();
    if (next !== "perspective") taskRoots[next].hidden = false;
    renderOptionsContext(next);
    workspaceNavigation.setCurrent(next);
    workspaceNavigation.focusCurrent();
    if (next === "perspective") {
      renderMode();
      renderState();
    }
  },
});
workspaceNavigation = createWorkspaceNavigation({
  root: workspaceNavigationRoot,
  viewport: workspaceStripViewport,
  backward: workspaceBackward,
  forward: workspaceForward,
  onChoose(workspace) {
    enterProductWorkspace(workspace);
  },
});
// Host UI size is adjustable after launch. The corner works across every tool,
// with keyboard steps as well as a pointer drag; each layout keeps its own size.
const windowGrip = document.createElement("button");
windowGrip.type = "button"; windowGrip.className = "window-resize";
const labelWindowGrip = ():void => { windowGrip.setAttribute("aria-label",`${translate(activeLocale,"resizeWindow")} · ${innerWidth} × ${innerHeight}`); };
let lastRequestedSize: { width:number;height:number } | undefined;
const resizeWindow = (width:number,height:number):void => {
  lastRequestedSize = { width:Math.round(Math.max(300,Math.min(1600,width))),height:Math.round(Math.max(440,Math.min(1200,height))) };
  post({type:"resize-ui",width:lastRequestedSize.width,height:lastRequestedSize.height});
};
// The host window edge is a resize route too. Report its actual size so each
// layout retains what the person chose, not only grip-driven sizes; skip the
// echo of our own request and transient out-of-contract sizes.
addEventListener("resize",() => {
  labelWindowGrip();
  const width = Math.round(innerWidth),height = Math.round(innerHeight);
  if (width === lastRequestedSize?.width && height === lastRequestedSize?.height) return;
  if (width < 300 || width > 1600 || height < 440 || height > 1200) return;
  lastRequestedSize = { width,height };
  post({type:"resize-ui",width,height});
});
windowGrip.addEventListener("pointerdown",event=>{
  if(event.button!==0)return;event.preventDefault();windowGrip.focus({preventScroll:true});windowGrip.setPointerCapture(event.pointerId);
  const start={x:event.screenX,y:event.screenY,width:innerWidth,height:innerHeight};
  const move=(next:PointerEvent):void=>{resizeWindow(start.width+next.screenX-start.x,start.height+next.screenY-start.y);};
  const finish=():void=>{windowGrip.removeEventListener("pointermove",move);windowGrip.removeEventListener("pointerup",finish);windowGrip.removeEventListener("pointercancel",finish);windowGrip.removeEventListener("lostpointercapture",finish);};
  windowGrip.addEventListener("pointermove",move);windowGrip.addEventListener("pointerup",finish);windowGrip.addEventListener("pointercancel",finish);windowGrip.addEventListener("lostpointercapture",finish);
});
windowGrip.addEventListener("keydown",event=>{
  const step=event.shiftKey?100:20;
  const direction=event.key==="ArrowRight"?[step,0]:event.key==="ArrowLeft"?[-step,0]:event.key==="ArrowDown"?[0,step]:event.key==="ArrowUp"?[0,-step]:undefined;
  if(direction){event.preventDefault();event.stopPropagation();resizeWindow(innerWidth+direction[0]!,innerHeight+direction[1]!);}
});
labelWindowGrip();document.body.append(windowGrip);
observeHostVisibleViewport();
// One deformation work carried across its three editing views. The Pin and
// Mesh workspaces own the interior while one of them is active; this record
// keeps the same draft alive through a return to the Plane editor so the
// plane continues editing, previewing, and publishing the whole work.
interface CarriedDeformationState {
  work: DeformationWorkSpecInput;
  view: DeformationWorkView;
  /** Final interior mesh from the shared plan; never derived adapter-side. */
  previewMesh?: WarpMesh;
}
let carriedDeformation: CarriedDeformationState | undefined;
let pendingCarriedPlane: object | undefined;
/** Marks a deformation publication the Plane editor itself initiated, so its
 * completion lands in the plane state machine instead of a task workspace. */
let planeDeformationApply: { generation: number } | undefined;

function clearCarriedDeformation(): void {
  carriedDeformation = undefined;
  editor?.setDeformationMesh(undefined);
}

function captureCarriedDeformation(view: DeformationWorkView): void {
  const fromMesh = view === "mesh";
  const work = fromMesh
    ? meshWorkspace.currentDeformationWork()
    : surfaceWorkspace.currentDeformationWork();
  if (!work) {
    if (carriedDeformation) clearCarriedDeformation();
    return;
  }
  // A fresh plane seed — including the Warp a Mesh entry baked — is not a
  // deformation session: carrying it would capture every later plane
  // publication and veto the very Warp that seeded it. Carry only work the
  // views authored or loaded from a stored task, or keep an already carried
  // work current.
  const authored = fromMesh ? meshWorkspace.deformationDraftAuthored()
    : surfaceWorkspace.deformationDraftAuthored();
  if (!authored && !carriedDeformation) return;
  if (carriedDeformation && sameJsonValue(carriedDeformation.work, work)) {
    carriedDeformation.view = view;
    return;
  }
  carriedDeformation = { work: structuredClone(work), view };
}

function livePlaneForDeformation(): { spec: TransformSpec; width: number; height: number } | undefined {
  if (!editor || !activeFrame || editorMode === "rectify") return undefined;
  return {
    spec: editor.captureSpec(),
    width: activeFrame.renderWidth,
    height: activeFrame.renderHeight,
  };
}

/**
 * Navigation that can start from the Plane editor. A preset Warp has no slot
 * in the shared work, so it cannot compose with a carried interior; block the
 * switch with the reason instead of entering a view that would silently drop
 * either side.
 */
function enterProductWorkspace(next: ProductWorkspace): boolean {
  if(current?.nativeSourceEditing&&next!=="perspective")return false;
  if (productWorkspace.current() === "perspective" && (next === "mesh" || next === "surface")) {
    const live = livePlaneForDeformation();
    if (carriedDeformation && live && !pendingCarriedPlane && !planeSpecComposesWithDeformation(live.spec)) {
      showError(userMessage("deformationWarpCompose"));
      renderState();
      return false;
    }
  }
  return productWorkspace.enter(next);
}

/** The live plane becomes the work's Plane view; the interior is untouched. */
function composeCarriedPlaneIntoDeformationView(next: "mesh" | "surface", preserveCarriedPlane = false): void {
  const carried = carriedDeformation;
  const live = livePlaneForDeformation();
  if (!carried || !live || (!preserveCarriedPlane && !planeSpecComposesWithDeformation(live.spec))) return;
  // A cancelled Plane preview has not installed its frame yet. Returning to
  // another view must keep the carried plane, not compose the previous one.
  const composed = preserveCarriedPlane ? carried.work : deformationWorkFromPlaneView(carried.work, live.spec, {
    width: live.width,
    height: live.height,
  });
  carriedDeformation = { ...carried, work: composed };
  if (next === "mesh") void meshWorkspace.loadDeformationWork(composed);
  else surfaceWorkspace.loadDeformationWork(composed);
}

/**
 * Returning to the Plane editor loads the work's plane as the continued
 * editing basis and previews the interior through the shared plan. The plane
 * history re-bases only when the carried plane differs from the live one;
 * interior edits never changed the plane spec, so an unchanged plane keeps
 * its local Undo history.
 */
async function carryDeformationIntoPlane(): Promise<void> {
  const carried = carriedDeformation;
  if (!carried || !editor || !current || !activeFrame || phase !== "ready" || refreshInFlight) return;
  const pending = {};
  pendingCarriedPlane = pending;
  // The visible plane must be installed before it accepts another edit.
  // Otherwise an input during core planning can be overwritten by that load.
  renderState();
  try {
    let mesh: WarpMesh;
    try {
      const plan = await planDeformationWork(carried.work);
      if (pendingCarriedPlane !== pending || productWorkspace.current() !== "perspective" || carriedDeformation !== carried) return;
      mesh = structuredClone(plan.meshWarp.spec.mesh);
    } catch (error) {
      if (pendingCarriedPlane === pending && productWorkspace.current() === "perspective" && carriedDeformation === carried) {
        showError(error);
      }
      return;
    }
    carried.previewMesh = mesh;
    editor.setDeformationMesh(mesh, carried.work.shapeFit?.clip ?? undefined, async (transform, targetSize) => {
      const plan = await planDeformationWork({ ...carried.work, transform, targetSize });
      return {
        mesh: plan.meshWarp.spec.mesh,
        quad: plan.meshWarp.solve.resolvedDestination.quad,
        canvas: {
          origin: plan.authoredView?.canvasOrigin ?? { x: 0, y: 0 },
          reference: plan.meshWarp.solve.resolvedDestination.reference,
        },
      };
    });
    const carriedSpec = planeSpecFromDeformationWork(carried.work);
    const nextFrame: TransformFrame = {
      ...cloneFrame(activeFrame),
      spec: carriedSpec,
      renderWidth: carried.work.targetSize?.width ?? activeFrame.renderWidth,
      renderHeight: carried.work.targetSize?.height ?? activeFrame.renderHeight,
    };
    if (editorMode === "rectify" || sameTransformFrame(activeFrame, nextFrame)) return;
    try {
      cancelTransformGesturePreview();
      distortEndFrames.cancel();
      composeGeneration += 1;
      composeInFlight = false;
      deferredHistoryCommit.clear();
      transformGestureSession.cancel();
      const loaded = await withTimeout(
        editor.setSpec(nextFrame.spec, {
          width: nextFrame.renderWidth,
          height: nextFrame.renderHeight,
        }),
        TRANSFORM_PREVIEW_TIMEOUT_MS,
        () => userMessage("transformPreviewTimedOut"),
      );
      if (pendingCarriedPlane !== pending || productWorkspace.current() !== "perspective" || carriedDeformation !== carried) return;
      if (!loaded) throw new Error("The selected layer could not be previewed");
      activeFrame = cloneFrame(nextFrame);
      baseFrame = cloneFrame(nextFrame);
      lastCompose = undefined;
      distortFrameDirty = false;
      gestureTranslation = { x: 0, y: 0 };
      resetTransformInputs();
      history = createEditHistory(currentHistoryEntry());
      syncViewportScene();
      viewport?.handleCanvasResized();
      renderState();
    } catch (error) {
      if (pendingCarriedPlane === pending && productWorkspace.current() === "perspective" && carriedDeformation === carried) {
        clearSceneDraftFeedback();
        showError(error);
        renderState();
      }
    }
  } finally {
    if (pendingCarriedPlane === pending) {
      pendingCarriedPlane = undefined;
      renderState();
    }
  }
}
const modeStrip = createHorizontalStrip({
  viewport: modeStripViewport,
  backward: modeBackward,
  forward: modeForward,
});
renderOptionsContext(productWorkspace.current());
const pivotPicker: PivotPicker = createPivotPicker({
  container: pivotGrid,
  onSelect(pivot) {
    void selectPivot(pivot);
  },
});
// Paint a usable system-locale UI immediately. The main side may replace this
// with the persisted preference, but a delayed preference read must never
// leave the plugin hidden behind the i18n readiness guard.
applyLocale(localePreference, activeLocale);
canvasWorkspace.updateLocale();
spatialWorkspace.updateLocale();
meshWorkspace.updateLocale();
surfaceWorkspace.updateLocale();
mockupWorkspace.updateLocale();
remapWorkspace.updateLocale();
appearanceWorkspace.updateLocale();
cardWorkspace.updateLocale();
presetsWorkspace.updateLocale();
templateWorkspace.updateLocale();

function control(id: string): {
  numberInput: HTMLInputElement;
  slider: HTMLInputElement;
  unit?: string;
} {
  const unit = document.getElementById(`${id}-unit`)?.textContent ?? undefined;
  return {
    numberInput: required<HTMLInputElement>(id),
    slider: required<HTMLInputElement>(`${id}-slider`),
    ...(unit ? { unit } : {}),
  };
}

window.onmessage=(event:MessageEvent<{pluginMessage?:MainToUiMessage}>)=>{
  if(event.data.pluginMessage)handleMainMessage(event.data.pluginMessage);
};
function handleMainMessage(message:MainToUiMessage){
  // One batch run owns its prepare reply and its per-item completions; no
  // other surface may consume them while correlated items are in flight.
  if (linkedBatchPrepare && (message.type === "linked-batch" || message.type === "linked-batch-error") &&
      message.generation === linkedBatchPrepare.generation) {
    const resolvePrepare = linkedBatchPrepare.resolve;
    linkedBatchPrepare = undefined;
    resolvePrepare(message);
    return;
  }
  if (linkedBatchSourceRequest &&
    (message.type === "batch-source" || message.type === "batch-source-error") &&
    message.generation === linkedBatchSourceRequest.generation &&
    message.resultNodeId === linkedBatchSourceRequest.resultNodeId &&
    message.nodeId === linkedBatchSourceRequest.nodeId) {
    const resolveSource = linkedBatchSourceRequest.resolve;
    linkedBatchSourceRequest = undefined;
    resolveSource(message);
    return;
  }
  if (
    linkedBatchRun?.completion &&
    (message.type === "apply-complete" || message.type === "apply-error") &&
    message.generation === linkedBatchRun.generation
  ) {
    const resolveCompletion = linkedBatchRun.completion;
    linkedBatchRun.completion = undefined;
    resolveCompletion(message);
    return;
  }
  if (message.type === "source-renderer") {
    if (message.generation !== activeGeneration) return;
    nativeRendererUpdate = message;
    if (current?.sourceNodeId === message.sourceNodeId && current.targetNodeId === message.targetNodeId) {
      if (message.renderer) current.nativeRenderer = message.renderer;
      else delete current.nativeRenderer;
      delete current.nativeRendererPending;
      renderState();
    }
    return;
  }
  if (message.type === "native-scene-preview") { templateWorkspace.handleMainMessage(message); return; }
  if (message.type === "scene-sizes-ready") {
    if (message.generation === activeGeneration) pendingSceneSizesSource = { nodeId: message.sourceNodeId, generation: message.generation };
    return;
  }
  if (message.type === "template-library" || message.type === "template-library-error") {
    templateWorkspace.handleMainMessage(message);
    if (message.mutation?.kind === "save") {
      const error = message.type === "template-library-error"
        ? translate(activeLocale, message.message)
        : undefined;
      if (message.mutation.workspace === "canvas") {
        canvasWorkspace.finishTemplateSave(message.mutation.requestId, error);
      } else if (message.mutation.workspace === "mesh") {
        meshWorkspace.finishTemplateSave(message.mutation.requestId, error);
      } else if (message.mutation.workspace === "surface") {
        surfaceWorkspace.finishTemplateSave(message.mutation.requestId, error);
      } else {
        mockupWorkspace.finishTemplateSave(message.mutation.requestId, error);
      }
    }
    return;
  }
  if ((message.type === "appearance-state" || message.type === "texture-state" || message.type === "foil-state" || message.type === "mesh-gradient-state" ||
       message.type === "appearance-applied" || message.type === "material-preview" || message.type === "material-context-changed" || message.type === "material-trial" || message.type === "material-applied" ||
       message.type === "texture-applied" || message.type === "appearance-error" ||
       message.type === "texture-error" || message.type === "card-state" || message.type === "card-source" ||
       message.type === "card-rig-applied" || message.type === "card-still-published" ||
       message.type === "card-error") && message.generation !== activeGeneration) return;
  if ((message.type === "apply-designer-complete" || message.type === "apply-designer-error") &&
    pendingDesignerPublication?.generation === message.generation) {
    const published = pendingDesignerPublication;
    pendingDesignerPublication = undefined;
    if (message.type === "apply-designer-complete" && message.operation === "replace" &&
      message.generation === activeGeneration && message.targetNodeId === published.targetNodeId &&
      current?.targetNodeId === published.targetNodeId) {
      current.task = published.task;
      if (message.publication) {
        current.placement = { ...message.publication.placement };
        current.targetRasterSize = { width: message.publication.renderWidth, height: message.publication.renderHeight };
      }
      if (published.task.kind === "deformation") {
        meshWorkspace.acceptPublication(published.task, message.publication);
        surfaceWorkspace.acceptPublication(published.task, message.publication);
      }
      delete current.deformationDraft;
      delete current.effectDraft;
      delete current.mockupDraft;
      delete current.mockupDraftUnavailable;
    }
  }
  if (canvasWorkspace.handleMainMessage(message)) return;
  // A publication the Plane editor initiated over a carried deformation work
  // completes in the plane state machine even while a task workspace is busy
  // with its own apply; each side keeps its own pending state.
  if (
    (message.type === "apply-designer-complete" || message.type === "apply-designer-error") &&
    planeDeformationApply?.generation === message.generation
  ) {
    planeDeformationApply = undefined;
    refreshInFlight = false;
    phase = current ? "ready" : "idle";
    if (message.type === "apply-designer-error") {
      appliedResultPending = false;
      undoRouted = false;
      showError(message.message);
      // The host rejected or rolled back publication; the live deformed draft
      // is still current, so restore its in-context feedback.
      syncSceneDraft();
    } else {
      appliedResultPending = true;
      undoRouted = false;
      setStatus(message.vectorFidelity?nativeVectorStatusMessage(message.vectorFidelity):userMessage(message.operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"));
    }
    renderState();
    return;
  }
  for (const workspace of Object.values(designerWorkspaces)) {
    if (workspace.handleMainMessage(message)) return;
  }
  if (message.type === "source-raster" || message.type === "source-raster-error") {
    const pending = pendingSourceRasterRequests.get(message.requestId);
    if (!pending || pending.generation !== message.generation) return;
    clearTimeout(pending.timer);
    pendingSourceRasterRequests.delete(message.requestId);
    if (message.type === "source-raster") pending.resolve({bytes:message.bytes,...(message.captureFacts?{captureFacts:message.captureFacts}:{})});
    else pending.reject(message.message);
    return;
  }
  if (message.type === "native-vector-projection" || message.type === "native-vector-projection-error") {
    const pending = pendingNativeVectorProjections.get(message.generation);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingNativeVectorProjections.delete(message.generation);
    if (message.type === "native-vector-projection") {
      pending.resolve({
        inputs: message.inputs,
        placement: message.placement,
        sourceFingerprint:message.sourceFingerprint,sourceView:message.sourceView,operationExpected:message.operationExpected,
      });
    } else {
      pending.reject(message.message);
    }
    return;
  }
  if (message.type === "locale") {
    applyLocale(message.preference, message.locale);
    renderLinkedResults();
    canvasWorkspace.updateLocale();
    spatialWorkspace.updateLocale();
    meshWorkspace.updateLocale();
    surfaceWorkspace.updateLocale();
    mockupWorkspace.updateLocale();
    remapWorkspace.updateLocale();
    appearanceWorkspace.updateLocale();
    cardWorkspace.updateLocale();
    presetsWorkspace.updateLocale();
    templateWorkspace.updateLocale();
  }
  if (message.type === "preference-error") showError(message.message);
  if (message.type === "selection-loading") {
    beginSelectionLoad(message.generation, message.nodeIds);
  }
  if (message.type === "source") void loadSource(message.generation, message.payload);
  if (message.type === "selection-error") {
    showSelectionError(message.generation, message.message);
    if (message.generation === activeGeneration) {
      nativeRecovery = message.nativeRecovery;
      nativeRecoverButton.hidden = !nativeRecovery;
      nativeRecoverButton.disabled = false;
    }
  }
  if (message.type === "apply-error" && message.generation === activeGeneration) {
    nativeVectorFallbackGenerations.delete(message.generation);
    pendingReplacementBaseline = undefined;
    appliedTransformMemory.fail(message.generation);
    refreshInFlight = false;
    undoRouted = false;
    appliedResultPending = false;
    phase = current ? "ready" : "idle";
    showError(message.message);
    renderState();
    // The host rejected or rolled back publication, so the user's live draft
    // is still the current object. Restore its in-context feedback without
    // requiring an otherwise meaningless control nudge.
    syncSceneDraft();
  }
  if (message.type === "apply-complete" && message.generation === activeGeneration) {
    appliedTransformMemory.complete(message.generation);
    if (message.operation === "replace" && pendingReplacementBaseline?.generation === message.generation) {
      // The host will report our replacement as a node change. Rebase later
      // edits from the frame just published, so that refresh cannot apply the
      // saved size/translation a second time.
      initialFrame = cloneFrame(pendingReplacementBaseline.frame);
    }
    pendingReplacementBaseline = undefined;
    refreshInFlight = false;
    phase = "ready";
    appliedResultPending = true;
    appliedNativeRevision=message.nativeRevision===undefined?undefined:{nodeId:message.targetNodeId,revision:message.nativeRevision};
    undoRouted = false;
    const nativeVectorFallback = nativeVectorFallbackGenerations.delete(message.generation);
    setStatus(
      nativeVectorFallback
        ? userMessage("nativeVectorFallbackApplied")
        : message.vectorFidelity
          ? nativeVectorStatusMessage(message.vectorFidelity)
          : userMessage(message.operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"),
    );
    renderState();
  }
}

resetButton.addEventListener("click", () => void resetPerspective());
linkedResultsTrigger.addEventListener("click", () => {
  const opening = linkedResultsPopover.hidden;
  linkedResultsPopover.hidden = !opening;
  linkedResultsTrigger.setAttribute("aria-expanded", String(opening));
  if (opening) linkedResultButtons()[0]?.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (linkedResultsPopover.hidden || linkedResultsPopover.contains(event.target as Node) ||
    linkedResultsTrigger.contains(event.target as Node)) return;
  closeLinkedResults();
});
applyButton.addEventListener("click", () => void (current?.nativeSourceEditing?finishNativeSource():applyPerspective()));
editNativeSourceButton.addEventListener("click",()=>{
  if(phase!=="ready"||!current?.nativeComponentTarget||!current.targetNodeId||!current.spec||current.nativeSourceEditing)return;
  phase="applying";renderState();
  post({type:"edit-native-source",generation:activeGeneration,sourceNodeId:current.sourceNodeId,targetNodeId:current.targetNodeId,spec:structuredClone(current.spec)});
});

async function finishNativeSource():Promise<void>{
  const source=current,generation=activeGeneration;
  if(phase!=="ready"||!source?.nativeSourceEditing||!source.nativeSourceSize||!source.targetNodeId||!source.spec)return;
  phase="applying";renderState();
  try{
    const spec=source.spec,placement=source.placement;
    const [nativePlan,solved]=await Promise.all([
      planNativeFrame({spec,sourceSize:source.nativeSourceSize,outputSize:{width:placement.width,height:placement.height}}),
      solveTransform(spec,{width:Math.ceil(placement.width),height:Math.ceil(placement.height)}),
    ]);
    if(current!==source||generation!==activeGeneration)return;
    post({type:"apply-native",payload:{generation,spec,inverse:solved.homography.inverse,nativePlan,
      sourceNodeId:source.sourceNodeId,targetNodeId:source.targetNodeId,placement,
      renderWidth:Math.ceil(placement.width),renderHeight:Math.ceil(placement.height)}});
  }catch(error){if(generation===activeGeneration){phase="ready";showError(messageFromError(error,"nativeApplyFailed"));renderState();}}
}
modeTransformButton.addEventListener("click", () => void switchEditorMode("transform"));
modeDistortButton.addEventListener("click", () => void switchEditorMode("distort"));
modeWarpButton.addEventListener("click", () => void switchEditorMode("warp"));
modeRectifyButton.addEventListener("click", () => void switchEditorMode("rectify"));
distortFreeButton.addEventListener("click", () => void selectDistortMode("free"));
distortPerspectiveButton.addEventListener("click", () => void selectDistortMode("perspective"));
warpMeshContinue.addEventListener("click", () => {
  enterProductWorkspace("mesh");
});
outputPolicyFit.addEventListener("click", () => selectOutputDensityPolicy("fit"));
outputPolicyOriginal.addEventListener("click", () => selectOutputDensityPolicy("original"));
// Route the preset through the same latest-wins coalescer as the amount
// controls: a direct update here could be superseded by an older queued
// sample that drains with a newer generation and resurrect the previous
// preset in activeFrame while the select already shows the new one.
warpPresetSelect.addEventListener("change", () => requestWarpPreview(true));
warpAmountSlider.addEventListener("input", () => {
  warpAmountInput.value = warpAmountSlider.value;
  updateWarpRangeVisual();
  requestWarpPreview(false);
});
warpAmountSlider.addEventListener("change", () => requestWarpPreview(true));
warpAmountInput.addEventListener("input", () => {
  if (warpAmountInput.validity.valid && warpAmountInput.value.trim().length > 0) {
    warpAmountSlider.value = warpAmountInput.value;
    updateWarpRangeVisual();
    requestWarpPreview(false);
  }
});
warpAmountInput.addEventListener("change", () => requestWarpPreview(true));
for (const input of [rectifyWidthInput, rectifyHeightInput]) {
  input.addEventListener("input", () => {
    disarmAppliedResultUndo();
    rectifyInputsValid = readRectifyOutput() !== undefined;
    input.setAttribute("aria-invalid", String(!input.validity.valid));
    if (rectifyInputsValid) clearError();
    renderState();
  });
  input.addEventListener("change", () => {
    const output = readRectifyOutput();
    rectifyInputsValid = output !== undefined;
    if (!output) showError(userMessage("invalidRectify"));
    renderState();
  });
}
actionFlipX.addEventListener("click", () => void toggleRecipeFlip("x"));
actionFlipY.addEventListener("click", () => void toggleRecipeFlip("y"));
actionRotateCw.addEventListener("click", () => void rotateByQuarter(90));
actionCopyParameters.addEventListener("click", () => void copyPlacementParametersToClipboard());
actionCopyCss.addEventListener("click", () => void copyCssTransformToClipboard());
actionTransformAgain.addEventListener("click", () => void applyTransformAgain());
actionApplyCopy.addEventListener("click", () => void applyPerspective(true, "image"));
actionApplyEditable.addEventListener("click", () => {
  if (actionApplyEditable.getAttribute("aria-disabled") === "true") {
    openNativeEffectListing();
    return;
  }
  void applyPerspective(true, "frame");
});
actionApplyVector.addEventListener("click", () => void applyPerspective(true, "vector"));
openEffectListing.addEventListener("click", openNativeEffectListing);
errorDismiss.addEventListener("click", clearError);
nativeRecoverButton.addEventListener("click", () => {
  if (!nativeRecovery) return;
  nativeRecoverButton.disabled = true;
  post({ type: "restore-native", generation: activeGeneration, ...nativeRecovery });
});
placementToggle.addEventListener("click", togglePlacementPanel);
placementClose.addEventListener("click", () => closePlacementPanel({ restoreFocus: true }));
document.addEventListener("pointerdown", closePlacementPanelOutside);
positionXInput.addEventListener("change", () => commitPlacementAxis("x"));
positionYInput.addEventListener("change", () => commitPlacementAxis("y"));
positionXInput.addEventListener("focus", () => {
  positionXInput.value = placementCanonical.x;
});
positionYInput.addEventListener("focus", () => {
  positionYInput.value = placementCanonical.y;
});
positionXInput.addEventListener("blur", () => restorePlacementInput("x"));
positionYInput.addEventListener("blur", () => restorePlacementInput("y"));
document.addEventListener("keydown", handleKeydown);
// Figma Desktop can replay a browser text-history command before forwarding
// Cmd/Ctrl Z to the plugin. A field blurred by publication must not consume
// that command and turn the published state into a new local edit first.
document.addEventListener("beforeinput", (event) => {
  if ((event.inputType === "historyUndo" || event.inputType === "historyRedo") &&
    event.target instanceof HTMLInputElement && historyInputValues.has(event.target) &&
    event.target !== document.activeElement) {
    event.preventDefault();
  }
});
// Some Desktop replays emit input alone. Restore the last presented value
// before any field handler can change the recipe or disarm publication Undo.
document.addEventListener("input", (event) => {
  const field = event.target;
  const inputType = (event as InputEvent).inputType;
  if ((inputType === "historyUndo" || inputType === "historyRedo") &&
    field instanceof HTMLInputElement && field !== document.activeElement && historyInputValues.has(field)) {
    field.value = historyInputValues.get(field)!;
    event.stopImmediatePropagation();
  }
}, true);
document.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", releasePreviewPan);

if (editor) {
  const sceneDraftSessionId = createSceneDraftToken((values) => crypto.getRandomValues(values));
  post({ type: "ready", systemLocales, sceneDraftSessionId });
}

function createEditor(): PerspectiveEditor | undefined {
  try {
    const nextEditor = new PerspectiveEditor({
      maxPreviewAxis: 1024,
      maxExportPixels: MAX_FIGMA_IMAGE_AXIS * MAX_FIGMA_IMAGE_AXIS,
      interactionSurface: editorMount,
      cornerLabel: localizedCornerLabel,
      transformHandleLabel: localizedTransformHandleLabel,
      transformSurfaceLabel: translate(activeLocale, "transformSurfaceLabel"),
      transformPivotLabel: translate(activeLocale, "transformPivotLabel"),
      onError(error) {
        if (phase === "ready" || phase === "resetting") showError(error);
      },
      onTransformGesture(event) {
        handleTransformGesture(event);
      },
      onDistortGesture(event) {
        viewport?.handleDistortGesture(event);
        if (event.phase === "start") setStatus();
      },
      onEditEnd(source) {
        handleEditEnd(source);
      },
      onChange() {
        // While the quad is invalid the visible error belongs to that live
        // state and must survive per-frame change notifications; returning to
        // valid clears it via onValidityChange instead.
        if (valid) clearError();
        if ((editorMode === "distort" || editorMode === "rectify") && activeFrame && editor) {
          if (editorMode === "distort") distortFrameDirty = true;
          transformInputsValid = true;
          activeFrame = { ...activeFrame, spec: editor.captureSpec() };
          viewport?.handleCanvasResized();
          if (editorMode === "distort") syncSceneDraft();
        }
        // Apply validity and the quiet output-size HUD both depend on live
        // dimensions. Rebuild only publication chrome during a live gesture:
        // rewriting every dock control on each paint is what made continuous
        // Distort/Transform feel sticky.
        renderState(
          editorMode === "distort" || editorMode === "rectify" || continuousPreviewInFlight
            ? "publication"
            : "full",
        );
      },
      onValidityChange(next) {
        valid = next;
        if (next) {
          clearError();
          if (editorMode === "distort") syncSceneDraft();
        } else {
          clearSceneDraftFeedback();
        }
        renderState();
      },
    });
    nextEditor.element.setAttribute("aria-describedby", zoomLevelOutput.id);
    return nextEditor;
  } catch (error) {
    // Without an editor the plugin never posts `ready`, so the localized
    // labels never arrive; reveal the panel with the client-resolved locale
    // anyway instead of leaving a permanently blank window on WebGL-less
    // machines.
    document.documentElement.lang = activeLocale;
    document.body.dataset.i18nReady = "true";
    selectionMessage = messageFromError(error, "previewFailed");
    renderSelectionMessage();
    return undefined;
  }
}

let pendingSceneSizesSource: { nodeId: string; generation: number } | undefined;
function beginSelectionLoad(generation: number, nodeIds: readonly string[]): void {
  if (!Number.isSafeInteger(generation) || generation < activeGeneration) return;
  pendingCarriedPlane = undefined;
  if (pendingSceneSizesSource && !nodeIds.includes(pendingSceneSizesSource.nodeId)) pendingSceneSizesSource = undefined;
  if (linkedBatchPrepare && linkedBatchPrepare.generation !== generation) {
    const pending = linkedBatchPrepare;
    linkedBatchPrepare = undefined;
    pending.resolve({ type: "linked-batch-error", generation: pending.generation, message: userMessage("selectionChanged") });
  }
  if (linkedBatchRun && linkedBatchRun.generation !== generation) linkedBatchRun.cancelled = true;
  nativeRendererUpdate = undefined;
  finalSourceRaster = undefined;
  loadingNodeIds = [...nodeIds];
  pendingDesignerPublication = undefined;
  nativeRecovery = undefined;
  nativeRecoverButton.hidden = true;
  canvasWorkspace.selectionLoading();
  for (const workspace of Object.values(designerWorkspaces)) workspace.selectionLoading();
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  cancelSourceRasterRequests(userMessage("selectionChanged"));
  appliedTransformMemory.cancelPending();
  sceneDraft.cancel();
  activeGeneration = generation;
  closeLinkedResults();
  linkedResultsTrigger.disabled = true;
  composeGeneration += 1;
  composeInFlight = false;
  undoRouted = false;
  if (isSameShownSelection(nodeIds)) {
    // The same layers are being re-exported (for example the source moved).
    // Keep the editor fully live so in-progress corner edits survive; only
    // Apply pauses while the main thread rebuilds its snapshot.
    refreshInFlight = true;
    setStatus(userMessage("refreshingSelection"));
    renderState();
    return;
  }
  // A different selection ends the previous session's canvas draft.
  post({ type: "scene-draft-clear", generation });
  appliedResultPending = false;
  pendingReplacementBaseline = undefined;
  // A different selection is loading. When a previous preview is on screen,
  // keep it dimmed in place instead of hiding the whole workspace — tearing
  // the preview down and re-showing it flashes the panel on every selection.
  const keepPreviousPreview = lastShownNodes !== undefined;
  refreshInFlight = false;
  current = undefined;
  renderLinkedResults();
  for (const workspace of Object.values(designerWorkspaces)) workspace.clearSource();
  valid = false;
  phase = "loading";
  history = undefined;
  rectifyParent = undefined;
  deferredHistoryCommit.clear();
  transformGestureSession.cancel();
  lastCompose = undefined;
  sourceName.textContent = "";
  sourceName.removeAttribute("title");
  clearError();
  setStatus(userMessage("loadingSelection"));
  selectionMessage = userMessage("loadingSelection");
  renderSelectionMessage();
  selectionState.hidden = false;
  if (keepPreviousPreview) controls.dataset.loading = "true";
  else controls.hidden = true;
  renderState();
}

function isSameShownSelection(nodeIds: readonly string[]): boolean {
  if (!lastShownNodes || nodeIds.length === 0) return false;
  return [...lastShownNodes.nodeIds].sort().join("\u0000") === [...nodeIds].sort().join("\u0000");
}

function storedSourceWorkspace(source: Pick<SourcePayload, "canvas" | "task" | "targetNodeId" | "cardResult" | "presetResult" | "deformationDraft"> | undefined): ProductWorkspace | undefined {
  if (source?.presetResult) return "presets";
  if (source?.cardResult) return "card";
  if (source?.deformationDraft) return source.deformationDraft.view === "pin" ? "surface" : "mesh";
  if (!source?.targetNodeId) return undefined;
  if (source.canvas) return "canvas";
  const task = source.task;
  if (!task) return "perspective";
  return task.kind === "effect" ? "spatial" : task.kind === "composition" ? "mockup"
    : task.kind === "deformation" ? (task.view === "pin" ? "surface" : "mesh") : task.kind;
}

async function loadSource(generation: number, payload: SourcePayload): Promise<void> {
  if (generation !== activeGeneration || !editor) return;
  const nextNodeIds = [
    ...(payload.sources?.map((source) => source.sourceNodeId) ?? [payload.sourceNodeId]),
    ...(payload.targetNodeId ? [payload.targetNodeId] : []),
  ];
  const refreshing = lastShownNodes !== undefined &&
    isSameShownSelection(loadingNodeIds) &&
    [...lastShownNodes.sourceNodeIds].sort().join("\u0000") === [...nextNodeIds].sort().join("\u0000");
    // A different selection ends the previous deformation session before any
    // workspace routing runs; a same-selection pixel refresh keeps the draft
    // alive with its source.
    if (!refreshing) {
      clearCarriedDeformation();
      linkedBatchReport = undefined;
      linkedBatchNodeIds = new Set();
    }
  const storedWorkspace = storedSourceWorkspace(payload);
  const changedOperationFamily = storedWorkspace !== storedSourceWorkspace(current);
  try {
    if(payload.nativeAffineState)payload={...payload,spec:await rebaseNativeAffine(payload.nativeAffineState)};
    const primaryRaster = await decodeSourceRaster(payload.bytes,payload.captureFacts);
    const image = primaryRaster.image;
    const rasterSources = payload.sources?.length ? payload.sources : [payload];
    const loadedSources = await Promise.all(rasterSources.map(async (raster, index) => ({
      sourceNodeId: raster.sourceNodeId,
      sourceName: raster.sourceName,
      renderWidth: raster.renderWidth,
      renderHeight: raster.renderHeight,
      placement: { ...raster.placement },
      ...(raster.quadGuide ? { quadGuide: structuredClone(raster.quadGuide) } : {}),
      ...(raster.shapeGuide ? { shapeGuide: structuredClone(raster.shapeGuide) } : {}),
      image: raster.sourceNodeId === payload.sourceNodeId
        ? image
        : (await decodeSourceRaster(raster.bytes,raster.captureFacts)).image,
    })));
    if (generation !== activeGeneration) return;
    if(!payload.deformationDraft && payload.task?.kind === "deformation" && payload.task.shapeGuideSourceIndex !== undefined) {
      const guide=loadedSources[payload.task.shapeGuideSourceIndex]?.shapeGuide;
      let work=payload.task.spec;
      if(refreshing && sameJsonValue(current?.task,payload.task)) {
        const workspace=productWorkspace.current();
        const local=workspace === "mesh" ? meshWorkspace.currentDeformationWork() : workspace === "surface" ? surfaceWorkspace.currentDeformationWork() : carriedDeformation?.work;
        if(local) work=local;
      }
      const refreshed=await refreshNativeShapeFit(payload.task,guide,work);
      if(generation!==activeGeneration) return;
      if(!sameJsonValue(refreshed,payload.task)) payload={...payload,deformationDraft:refreshed};
    }
    const payloadFrame = frameFromSource(payload);
    const nextInitial = payload.rectification
      ? {
          ...payloadFrame,
          spec: normalizedSpec(structuredClone(payload.rectification.source.quad)),
          renderWidth: image.naturalWidth,
          renderHeight: image.naturalHeight,
        }
      : payloadFrame;
    const externalTransformChanged = refreshing && initialFrame &&
      !sameTransformSpec(initialFrame.spec, nextInitial.spec);
    const displacedDraft = externalTransformChanged && activeFrame && baseFrame && initialFrame &&
      !sameTransformFrame(activeFrame, initialFrame)
      ? currentHistoryEntry() : undefined;
    const retainedSession = refreshing && initialFrame && activeFrame && baseFrame &&
      sameTransformFrame(initialFrame, nextInitial)
      ? { entry: currentHistoryEntry(), history } : undefined;
    const ownNativeRefresh=appliedResultPending&&payload.targetNodeId===appliedNativeRevision?.nodeId&&payload.nativeRevision===appliedNativeRevision?.revision;
    if (externalTransformChanged&&!ownNativeRefresh) appliedResultPending = false;
    const nextActive =
      refreshing && initialFrame && activeFrame
        ? editorMode === "rectify"
          ? {
              ...cloneFrame(activeFrame),
              renderWidth: image.naturalWidth,
              renderHeight: image.naturalHeight,
              placement: { ...nextInitial.placement },
            }
          : rebaseTransformFrame(initialFrame, nextInitial, activeFrame)
        : nextInitial;
    if (!refreshing) {
      appliedResultPending = false;
      editorMode = payload.rectification ? "rectify" : "distort";
      distortMode = "free";
      rectifyParent = undefined;
    }
    editor.setSourceSelectionMode(editorMode === "rectify");
    const loaded = await withTimeout(
      editor.setSource(image, nextActive.spec, {
        targetSize: { width: nextActive.renderWidth, height: nextActive.renderHeight },
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    if (generation !== activeGeneration) return;
    // A false return means the spec failed structural or geometric validation
    // during load; on a same-node refresh that is just the preserved in-progress
    // quad being momentarily invalid, so the ready state and red styling stay.
    if (!loaded && !refreshing) {
      throw new Error("The selected layer could not be previewed");
    }
    // beginSelectionLoad intentionally clears the UI-owned validity for a new
    // source. The editor may already be internally valid, in which case its
    // edge-triggered callback does not fire again; synchronize from the
    // successful render result so the new source does not remain disabled.
    valid = validityAfterSourceLoad(valid, loaded);
    // The decoded image and preview bitmap own the pixels from here. Retain
    // only task metadata so a multi-megabyte source byte array does not stay
    // live for the entire editing session.
    const { bytes: _decodedBytes, sources: _decodedSources, ...primaryMetadata } = payload;
    const activeSource: ActiveSource = {
      ...primaryMetadata,
      ...(payload.sources ? {
        sources: payload.sources.map(({ bytes: _bytes, ...metadata }) => metadata),
      } : {}),
    };
    current = activeSource;
    renderLinkedResults();
    linkedResultsTrigger.disabled = false;
    // Discovery can finish while image decoding or the first GPU preview is
    // pending. Preserve that completion when installing the decoded source.
    if (nativeRendererUpdate?.generation === generation &&
      nativeRendererUpdate.sourceNodeId === current.sourceNodeId &&
      nativeRendererUpdate.targetNodeId === current.targetNodeId) {
      if (nativeRendererUpdate.renderer) current.nativeRenderer = nativeRendererUpdate.renderer;
      else delete current.nativeRenderer;
      delete current.nativeRendererPending;
    }
    canvasWorkspace.setSource({ ...primaryMetadata, selectionGeneration: generation }, image);
    const designerSource: DesignerWorkspaceSource = {
      sources: loadedSources,
      selectionGeneration: generation,
      ...(payload.task ? { task: payload.task } : {}),
      ...(payload.deformationDraft ? {deformationDraft:payload.deformationDraft} : {}),
      ...(payload.effectDraft ? { effectDraft: payload.effectDraft } : {}),
      ...(payload.mockupDraft ? { mockupDraft: payload.mockupDraft } : {}),
      ...(payload.mockupDraftUnavailable ? { mockupDraftUnavailable: true as const } : {}),
      ...(payload.targetNodeId ? { targetPlacement: { ...payload.placement } } : {}),
      ...(payload.targetNodeId ? { targetNodeId: payload.targetNodeId } : {}),
      ...(payload.targetRasterSize ? { targetRasterSize: { ...payload.targetRasterSize } } : {}),
      ...(payload.nativeVector?{nativeVector:true as const}:{}),
      ...(payload.nativeVectorTarget?{nativeVectorTarget:true as const}:{}),
      ...(payload.sceneContext ? { sceneContext: true as const } : {}),
      ...(payload.sceneContextReadOnly ? { sceneContextReadOnly: true as const } : {}),
    };
    // Active workspaces can seed from Perspective synchronously in setSource.
    // Install this selection's geometry and dimensions before that handoff.
    initialFrame = cloneFrame(nextInitial);
    baseFrame = cloneFrame(retainedSession?.entry.baseFrame ?? nextActive);
    activeFrame = cloneFrame(nextActive);
    for (const workspace of Object.values(designerWorkspaces)) workspace.setSource(designerSource);
    const sourceCount = designerDeformationTask(designerSource)?.shapeGuideSourceIndex !== undefined ? 1 : loadedSources.length;
    const available = taskWorkspaceAvailability(sourceCount);
    workspaceNavigation.setAvailability(available);
    if (payload.rectification && !retainedSession) {
      rectifyWidthInput.value = String(payload.rectification.output.width);
      rectifyHeightInput.value = String(payload.rectification.output.height);
    } else if (!refreshing) {
      const seed = fitRectifySeed(nextInitial.renderWidth, nextInitial.renderHeight);
      rectifyWidthInput.value = String(seed.width);
      rectifyHeightInput.value = String(seed.height);
    }
    rectifyInputsValid = readRectifyOutput() !== undefined;
    if (!retainedSession) {
      rectifyInitialOutput = {
        width: rectifyWidthInput.value,
        height: rectifyHeightInput.value,
      };
    }
    syncWarpControls(nextActive.spec.content.warp);
    if (!retainedSession) {
      resetTransformInputs();
      gestureTranslation = { x: 0, y: 0 };
    }
    lastCompose = undefined;
    transformGestureSession.cancel();
    distortFrameDirty = retainedSession?.entry.distortFrameDirty ?? false;
    // The selected result can resolve to content that is not itself selected.
    // Keep host selection separate from the sources used to render it.
    lastShownNodes = { nodeIds: [...loadingNodeIds], sourceNodeIds: nextNodeIds };
    refreshInFlight = false;
    phase = "ready";
    sourceName.textContent = payload.sourceName;
    sourceName.title = payload.sourceName;
    selectionState.hidden = true;
    // Pixel refreshes continue the current view. A newly selected saved result
    // reopens its own operation; only a new source can continue a compatible
    // tool left open on the previous artwork.
    // Every view has just received the incoming source. Routing that saved
    // task must not carry an outgoing local view over it: Mesh projection can
    // still be pending, so its current draft may belong to the previous task.
    routingStoredSource = true;
    try {
      if (pendingSceneSizesSource?.nodeId === payload.sourceNodeId && generation > pendingSceneSizesSource.generation && !payload.targetNodeId) {
        pendingSceneSizesSource = undefined;
        productWorkspace.enter("canvas");
      } else if (!refreshing || changedOperationFamily) {
        if (storedWorkspace) productWorkspace.enter(storedWorkspace);
        else {
          const currentWorkspace = productWorkspace.current();
          if (currentWorkspace === "perspective" || !available[currentWorkspace]) {
            productWorkspace.enter(defaultWorkspaceForSourceCount(sourceCount));
          }
        }
      }
    } finally { routingStoredSource = false; }
    // A deformation task is one work across three views; keep it carried so
    // the Plane editor can continue it after the task view loads. Assignment
    // follows the routing above so the load itself never composes the fresh
    // identity plane into the stored work.
    const loadedWork=payload.deformationDraft ?? (payload.task?.kind === "deformation" ? payload.task : undefined);
    if (loadedWork) {
      carriedDeformation = { work: structuredClone(loadedWork.spec), view: loadedWork.view };
    } else if (payload.task) {
      clearCarriedDeformation();
    }
    controls.hidden = productWorkspace.current() !== "perspective";
    delete controls.dataset.loading;
    renderMode();
    setStatus();
    renderState();
    // New pixels alone do not invalidate local geometry, controls or history.
    // Only a changed geometric frame needs a new history basis.
    history = retainedSession?.history ?? createEditHistory(currentHistoryEntry());
    if (editorMode === "transform") {
      const initialized = await updateTransformPreview({recordHistory:false});
      if (initialized && generation === activeGeneration && history && !retainedSession) {
        history.resetToBaseline(currentHistoryEntry());
      }
    }
    if (generation !== activeGeneration) return;
    if (displacedDraft) {
      // Keep an unapplied draft recoverable without silently publishing it
      // over the newly loaded shared operation. Standard Undo restores it.
      const latest = currentHistoryEntry();
      history = createEditHistory(displacedDraft);
      history.push(latest);
      setStatus(userMessage("sharedTransformRefreshed"));
    }
    // Fit only after the final mode-specific layout and preview have settled.
    // Figma can restore the plugin across displays before the iframe reports
    // its new dimensions; fit-lock then keeps following later mount resizes.
    syncViewportScene();
    if (!refreshing) viewport?.fit();
  } catch (error) {
    if (generation !== activeGeneration) return;
    showSelectionError(
      generation,
      messageFromError(error, "previewFailed"),
    );
  }
}

function showSelectionError(generation: number, message: UserMessage): void {
  if (generation !== activeGeneration) return;
  clearSceneDraftFeedback();
  // A task cannot remain active after its source contract has failed. Return
  // to the base workspace first so the user gets one usable recovery surface
  // rather than a disabled task containing a second copy of the same error.
  productWorkspace.returnToPerspective();
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  lastShownNodes = undefined;
  composeGeneration += 1;
  composeInFlight = false;
  transformInputsValid = true;
  undoRouted = false;
  appliedResultPending = false;
  refreshInFlight = false;
  current = undefined;
  renderLinkedResults();
  canvasWorkspace.clearSource(translate(activeLocale, message));
  for (const workspace of Object.values(designerWorkspaces)) {
    workspace.clearSource(translate(activeLocale, message));
  }
  clearCarriedDeformation();
  initialFrame = undefined;
  baseFrame = undefined;
  activeFrame = undefined;
  history = undefined;
  rectifyParent = undefined;
  deferredHistoryCommit.clear();
  transformGestureSession.cancel();
  lastCompose = undefined;
  distortFrameDirty = false;
  gestureTranslation = { x: 0, y: 0 };
  valid = false;
  phase = "idle";
  sourceName.textContent = "";
  sourceName.removeAttribute("title");
  delete controls.dataset.loading;
  controls.hidden = true;
  selectionMessage = message;
  renderSelectionMessage();
  selectionState.hidden = false;
  clearError();
  setStatus();
  editor?.clearSource();
  renderState();
}

async function resetPerspective(): Promise<void> {
  await restoreLoadedState(false);
}

async function restoreLoadedState(discardHistory: boolean): Promise<void> {
  if (!editor || !current || !initialFrame || phase !== "ready" || refreshInFlight) return;
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  phase = "resetting";
  composeGeneration += 1;
  composeInFlight = false;
  deferredHistoryCommit.clear();
  transformInputsValid = true;
  gestureTranslation = { x: 0, y: 0 };
  transformGestureSession.cancel();
  lastCompose = undefined;
  distortFrameDirty = false;
  clearError();
  setStatus(userMessage("resetting"));
  renderState();
  try {
    baseFrame = cloneFrame(initialFrame);
    activeFrame = cloneFrame(initialFrame);
    if (editorMode === "rectify") {
      rectifyWidthInput.value = rectifyInitialOutput.width;
      rectifyHeightInput.value = rectifyInitialOutput.height;
      rectifyInputsValid = readRectifyOutput() !== undefined;
    }
    resetTransformInputs();
    await withTimeout(
      editor.setSpec(initialFrame.spec, {
        width: initialFrame.renderWidth,
        height: initialFrame.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    if (phase !== "resetting") return;
    phase = "ready";
    if (editorMode === "transform") await updateTransformPreview();
    if (editorMode === "warp") {
      syncWarpControls(initialFrame.spec.content.warp);
      await updateWarpPreview(false);
    }
    syncViewportScene();
    viewport?.fit();
    // Escape discards the whole session. The visible Reset action remains a
    // normal recoverable edit so an accidental click can be undone.
    if (editorMode === "rectify") {
      // Rectification is a replacing child workspace. Its Reset boundary must
      // not insert source-selection entries into the parent's transform undo
      // stack; a loaded rectification already owns its one baseline entry.
      if (!rectifyParent && history && baseFrame && activeFrame) {
        history.resetToBaseline(currentHistoryEntry());
      }
    } else if (discardHistory && history && baseFrame && activeFrame) {
      history.resetToBaseline(currentHistoryEntry());
    } else {
      commitHistoryNow();
    }
    if (valid) setStatus(userMessage("perspectiveReset"));
  } catch (error) {
    phase = "ready";
    clearSceneDraftFeedback();
    showError(error);
  }
  renderState();
}

async function switchEditorMode(nextMode: EditorMode): Promise<void> {
  if (editorMode === "distort" && nextMode !== "distort" && distortFrameDirty) {
    const finalized = await finalizeDistortEdit();
    if (!finalized) return;
  }
  if (
    !canSwitchEditorMode({
      nextMode,
      currentMode: editorMode,
      hasEditor: Boolean(editor),
      hasFrame: Boolean(activeFrame),
      valid,
      phase,
      composeInFlight,
      refreshInFlight,
    })
  ) {
    return;
  }
  if (nextMode === "rectify") {
    await enterRectifyMode();
    return;
  }
  if (editorMode === "rectify") {
    await leaveRectifyMode(nextMode);
    return;
  }
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  composeGeneration += 1;
  deferredHistoryCommit.clear();
  // Baking the live spec into the next operation is geometry-only: no export
  // or rasterization happens on a mode switch.
  activeFrame = { ...activeFrame!, spec: editor!.captureSpec() };
  baseFrame = cloneFrame(activeFrame);
  editorMode = nextMode;
  gestureTranslation = { x: 0, y: 0 };
  transformGestureSession.cancel();
  lastCompose = undefined;
  resetTransformInputs();
  clearError();
  setStatus();
  renderMode();
  renderState();
  if (nextMode === "transform") {
    deferredHistoryCommit.request();
    await updateTransformPreview();
  } else if (nextMode === "warp") {
    syncWarpControls(baseFrame.spec.content.warp);
    await updateWarpPreview(false);
    commitHistoryNow();
  } else {
    commitHistoryNow();
  }
}

async function enterRectifyMode(): Promise<void> {
  if (!editor || !initialFrame || !activeFrame || !baseFrame) return;
  const sourceSize = editor.getSourceRasterSize();
  if (!sourceSize) return;
  clearSceneDraftFeedback();
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  composeGeneration += 1;
  deferredHistoryCommit.clear();
  activeFrame = { ...activeFrame, spec: editor.captureSpec() };
  baseFrame = cloneFrame(activeFrame);
  rectifyParent = {
    initialFrame: cloneFrame(initialFrame),
    entry: currentHistoryEntry(),
  };
  const rectifySeed = fitRectifySeed(activeFrame.renderWidth, activeFrame.renderHeight);
  rectifyWidthInput.value = String(rectifySeed.width);
  rectifyHeightInput.value = String(rectifySeed.height);
  rectifyInitialOutput = {
    width: rectifyWidthInput.value,
    height: rectifyHeightInput.value,
  };
  rectifyInputsValid = readRectifyOutput() !== undefined;
  const selectionFrame: TransformFrame = {
    spec: normalizedSpec(unitQuad()),
    renderWidth: Math.max(1, Math.round(sourceSize.width)),
    renderHeight: Math.max(1, Math.round(sourceSize.height)),
    placement: { ...activeFrame.placement },
  };
  initialFrame = cloneFrame(selectionFrame);
  baseFrame = cloneFrame(selectionFrame);
  activeFrame = cloneFrame(selectionFrame);
  editorMode = "rectify";
  distortFrameDirty = false;
  transformGestureSession.cancel();
  lastCompose = undefined;
  clearError();
  setStatus();
  editor.setSourceSelectionMode(true);
  renderMode();
  renderState();
  try {
    const loaded = await withTimeout(
      editor.setSpec(selectionFrame.spec, {
        width: selectionFrame.renderWidth,
        height: selectionFrame.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    if (!loaded) throw new Error("The correction preview could not be rendered");
    syncViewportScene();
    viewport?.fit();
  } catch (error) {
    showError(error);
  }
  renderState();
}

async function leaveRectifyMode(nextMode: Exclude<EditorMode, "rectify">): Promise<void> {
  if (!editor || !rectifyParent) return;
  const parent = rectifyParent;
  rectifyParent = undefined;
  initialFrame = cloneFrame(parent.initialFrame);
  editorMode = parent.entry.mode;
  distortMode = parent.entry.distortMode;
  distortFrameDirty = parent.entry.distortFrameDirty;
  baseFrame = cloneFrame(parent.entry.baseFrame);
  activeFrame = cloneFrame(parent.entry.activeFrame);
  gestureTranslation = { ...parent.entry.gestureTranslation };
  recipeFlip = { ...parent.entry.flip };
  recipePivot = { ...parent.entry.pivot };
  transformControls.setValues(parent.entry.values);
  editor.setSourceSelectionMode(false);
  clearError();
  renderMode();
  renderState();
  try {
    await withTimeout(
      editor.setSpec(activeFrame.spec, {
        width: activeFrame.renderWidth,
        height: activeFrame.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    syncViewportScene();
    viewport?.handleCanvasResized();
    if (nextMode !== editorMode) await switchEditorMode(nextMode);
  } catch (error) {
    showError(error);
  }
  renderState();
}

async function selectDistortMode(nextMode: DistortMode): Promise<void> {
  if (editorMode !== "distort") await switchEditorMode("distort");
  if (editorMode === "distort") switchDistortMode(nextMode);
}

function switchDistortMode(nextMode: DistortMode): void {
  if (
    nextMode === distortMode ||
    !editor ||
    phase !== "ready" ||
    composeInFlight ||
    refreshInFlight
  ) {
    return;
  }
  distortMode = nextMode;
  editor.setDistortMode(nextMode);
  clearError();
  setStatus();
  renderMode();
  renderState();
}

async function updateWarpPreview(
  commit: boolean,
  sample?: { preset: string; amount: string },
  continuous = false,
): Promise<boolean> {
  if (!editor || !baseFrame || editorMode !== "warp" || phase !== "ready") return false;
  const generation = ++composeGeneration;
  const fallbackFrame = cloneFrame(activeFrame ?? baseFrame);
  let warp: WarpSpec | undefined;
  try {
    warp = parseWarpControls(
      sample?.preset ?? warpPresetSelect.value,
      sample?.amount ?? warpAmountInput.value,
      activeFrame?.spec.content.warp ?? undefined,
    );
    transformInputsValid = true;
    warpAmountInput.setAttribute("aria-invalid", "false");
  } catch {
    transformInputsValid = false;
    warpAmountInput.setAttribute("aria-invalid", "true");
    clearSceneDraftFeedback();
    showError(userMessage("invalidWarp"));
    renderState();
    return false;
  }
  if (sameWarp(activeFrame?.spec.content.warp, warp)) {
    clearError();
    if (commit) commitHistoryNow();
    renderState();
    syncSceneDraft();
    return true;
  }
  disarmAppliedResultUndo();
  const nextFrame = cloneFrame(baseFrame);
  if (warp) nextFrame.spec.content.warp = warp;
  else delete nextFrame.spec.content.warp;
  composeInFlight = true;
  continuousPreviewInFlight = continuous;
  clearError();
  if (!continuous) renderState();
  try {
    const loaded = await setEditorSpecWithRecovery(
      nextFrame,
      fallbackFrame,
    );
    if (generation !== composeGeneration || editorMode !== "warp") return false;
    if (!loaded) throw new Error("The Warp preset could not be previewed");
    activeFrame = nextFrame;
    composeInFlight = false;
    continuousPreviewInFlight = false;
    transformInputsValid = true;
    syncViewportScene();
    viewport?.handleCanvasResized();
    clearError();
    if (commit) commitHistoryNow();
    renderState();
    return true;
  } catch (error) {
    if (generation !== composeGeneration) return false;
    composeInFlight = false;
    continuousPreviewInFlight = false;
    transformInputsValid = false;
    clearSceneDraftFeedback();
    showError(error);
    renderState();
    return false;
  }
}

function requestWarpPreview(final: boolean): void {
  warpPreviewFrames.request({
    preset: warpPresetSelect.value,
    amount: warpAmountInput.value,
    final,
  });
  if (final) warpPreviewFrames.flush();
}

function sameWarp(a: WarpSpec | undefined, b: WarpSpec | undefined): boolean {
  return a?.preset === b?.preset && a?.amount === b?.amount;
}

function syncWarpControls(warp: WarpSpec | undefined): void {
  warpPresetSelect.value = warp?.preset ?? "";
  const amount = warpAmountPercent(warp);
  warpAmountSlider.value = amount;
  warpAmountInput.value = amount;
  updateWarpRangeVisual();
  warpAmountInput.setAttribute("aria-invalid", "false");
}

function updateWarpRangeVisual(): void {
  const minimum = Number(warpAmountSlider.min);
  const maximum = Number(warpAmountSlider.max);
  const value = Number(warpAmountSlider.value);
  warpAmountSlider.style.setProperty(
    "--range-progress",
    `${sliderProgress(value, minimum, maximum)}%`,
  );
  warpAmountSlider.setAttribute("aria-valuetext", `${warpAmountSlider.value}%`);
}

async function setEditorSpecWithRecovery(
  nextFrame: TransformFrame,
  fallbackFrame: TransformFrame,
): Promise<boolean> {
  const targetEditor = editor;
  if (!targetEditor) throw new Error("The perspective editor is unavailable");
  try {
    return await withTimeout(
      targetEditor.setSpec(nextFrame.spec, {
        width: nextFrame.renderWidth,
        height: nextFrame.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
  } catch (error) {
    try {
      targetEditor.invalidatePendingRender();
      void targetEditor
        .setSpec(fallbackFrame.spec, {
          width: fallbackFrame.renderWidth,
          height: fallbackFrame.renderHeight,
        })
        .catch(() => undefined);
    } catch {
      // The original error remains the actionable failure. A disposed editor
      // cannot be restored and will be rebuilt by the next source load.
    }
    throw error;
  }
}

async function updateTransformPreview(
  options: {
    recipe?: TransformRecipe;
    liveGesture?: boolean;
    settleViewport?: boolean;
    commitBoundary?: boolean;
    recordHistory?: boolean;
    /** Each queued field commit owns the values that produced its frame. */
    commitControls?:TransformInputValues;
  } = {},
): Promise<boolean> {
  if (!editor || !baseFrame || editorMode !== "transform" || phase !== "ready") return false;
  const generation = ++composeGeneration;
  let recipe = options.recipe;
  if (!recipe) {
    try {
      const inputs = transformControls.recipeFromInputs();
      transformInputsValid = true;
      // Canvas gestures and menu actions carry state outside the numeric fields.
      recipe = {
        ...inputs,
        translation: gestureTranslation,
        flip: recipeFlip,
        pivot: recipePivot,
      };
    } catch (error) {
      composeInFlight = false;
      transformInputsValid = false;
      deferredHistoryCommit.clear();
      clearSceneDraftFeedback();
      showError(error);
      renderState();
      return false;
    }
  } else {
    transformInputsValid = true;
  }
  const base = cloneFrame(baseFrame);
  const fallbackFrame = cloneFrame(activeFrame ?? baseFrame);
  composeInFlight = true;
  continuousPreviewInFlight = Boolean(options.liveGesture);
  clearError();
  // A live pointer gesture must not disable its own editor or rebuild every
  // unrelated control on each paint. Non-gesture inputs keep the ordinary
  // busy-state contract.
  if (!options.liveGesture) renderState();
  try {
    const composition = await withTimeout(
      composeAffineTransform(base.spec, recipe, {
        width: base.renderWidth,
        height: base.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    if (generation !== composeGeneration || editorMode !== "transform") return false;
    const nextFrame = frameFromComposition(base, composition);
    const loaded = await setEditorSpecWithRecovery(
      nextFrame,
      fallbackFrame,
    );
    if (generation !== composeGeneration || editorMode !== "transform") return false;
    if (!loaded) throw new Error("The selected layer could not be previewed");
    activeFrame = nextFrame;
    composeInFlight = false;
    continuousPreviewInFlight = false;
    transformInputsValid = true;
    lastCompose = { composition, recipe };
    // The pivot marker is a visual echo of the composed frame; skip it rather
    // than crash if the just-recorded composition cannot be framed.
    const gestureFrame = gestureFrameFromLastCompose();
    if (gestureFrame) editor.setTransformPivot(pivotPreviewPoint(gestureFrame));
    syncViewportScene();
    viewport?.handleCanvasResized();
    // A camera mutation while the pointer owns a Transform makes the grabbed
    // handle jump away from that pointer. Keep the camera stable for every
    // live sample and recover all-handle visibility only after the exact final
    // sample has rendered on release.
    if (options.settleViewport) viewport?.revealAllCorners({ animate: true });
    clearError();
    // An older async sample may complete after pointer-up queued the exact
    // final recipe. Only the final live sample may close the gesture's single
    // undo step; otherwise an intermediate frame can win that race.
    if (!options.liveGesture || options.settleViewport || options.commitBoundary) {
      if(options.recordHistory!==false){
        if(options.commitControls){
          const entry=currentHistoryEntry();entry.values=structuredClone(options.commitControls);
          entry.gestureTranslation={...recipe.translation};entry.flip={x:Boolean(recipe.flip?.x),y:Boolean(recipe.flip?.y)};entry.pivot={...recipe.pivot};
          commitHistoryNow(entry);
        }else deferredHistoryCommit.flush();
      }
      renderState();
    }
    return true;
  } catch (error) {
    if (generation !== composeGeneration) return false;
    composeInFlight = false;
    continuousPreviewInFlight = false;
    transformInputsValid = false;
    deferredHistoryCommit.clear();
    clearSceneDraftFeedback();
    showError(error);
    renderState();
    return false;
  }
}

function requestTransformControlPreview(final: boolean): void {
  disarmAppliedResultUndo();
  try {
    const inputs = transformControls.recipeFromInputs();
    transformInputsValid = true;
    const recipe: TransformRecipe = {
      ...inputs,
      translation: gestureTranslation,
      flip: recipeFlip,
      pivot: recipePivot,
    };
    controlPreviewFrames.request({ recipe, final,values:transformControls.currentValues() });
    if (final) controlPreviewFrames.flush();
    renderState();
  } catch (error) {
    transformInputsValid = false;
    deferredHistoryCommit.clear();
    clearSceneDraftFeedback();
    showError(error);
    renderState();
  }
}

function flushTransformGesturePreview(sample: {
  recipe: TransformRecipe;
  settleViewport: boolean;
}): void {
  const { recipe, settleViewport } = sample;
  // Numeric echoes are presentation feedback. Update them once per paint,
  // not at the raw pointer sample rate. Expensive core/render work is also
  // single-flight and retains only the newest value while busy.
  pivotPicker.setValue(recipe.pivot);
  transformControls.setValues(valuesFromRecipe(recipe));
  gesturePreviewWork.request({ recipe, settleViewport });
}

function cancelTransformGesturePreview(): void {
  gesturePreviewFrames.cancel();
  gesturePreviewWork.cancel();
  controlPreviewFrames.cancel();
  controlPreviewWork.cancel();
  warpPreviewFrames.cancel();
  warpPreviewWork.cancel();
  continuousPreviewInFlight = false;
}

function handleTransformGesture(event: TransformGestureEvent): void {
  if (!editor || phase !== "ready" || editorMode !== "transform" || !baseFrame) return;
  if (event.phase === "start") {
    // A pointer-up frame is flushed synchronously, but its async core/render
    // job may still be finishing. Do not cancel that exact final sample when
    // the user quickly reaches for the next handle.
    if (!canStartTransformGesture({
      composeInFlight,
      previewQueuePending: gesturePreviewWork.pending(),
    })) return;
    gesturePreviewFrames.cancel();
    setStatus();
    const frame = gestureFrameFromLastCompose();
    // Transform mode initializes an identity composition before enabling the
    // editor, so a missing frame here means a newer session has superseded it.
    if (!frame) return;
    transformGestureSession.start(event, frame);
    return;
  }
  const sample = transformGestureSession.update(event, transformControls.isScaleLinked());
  if (!sample) return;
  const { recipe, final } = sample;
  gestureTranslation = { ...recipe.translation };
  recipePivot = { ...recipe.pivot };
  gesturePreviewFrames.request({ recipe, settleViewport: final });
  if (final) {
    // Pointer-up owns the exact final value. Flush it before onEditEnd asks
    // the deferred history writer to commit this gesture as one undo step.
    gesturePreviewFrames.flush();
    // The exact final compose/render becomes the committed baseline for the
    // next gesture. Disable new pointer ownership until that boundary settles.
    renderState();
  }
}

function gestureFrameFromLastCompose(): GestureFrame | undefined {
  if (!lastCompose || !baseFrame) return undefined;
  const size = { width: baseFrame.renderWidth, height: baseFrame.renderHeight };
  const quad: Quad = baseFrame.spec.destination.quad;
  const toPixels = (point: Point): Point => ({
    x: point.x * size.width,
    y: point.y * size.height,
  });
  return {
    matrix: lastCompose.composition.matrix,
    canvasOrigin: { ...lastCompose.composition.canvas.origin },
    canvasSize: { ...lastCompose.composition.canvas.size },
    baseQuad: {
      tl: toPixels(quad.tl),
      tr: toPixels(quad.tr),
      br: toPixels(quad.br),
      bl: toPixels(quad.bl),
    },
    recipe: structuredClone(lastCompose.recipe),
  };
}

function valuesFromRecipe(recipe: TransformRecipe): TransformInputValues {
  return {
    scaleX: preciseInputValue(recipe.scale.x * 100),
    scaleY: preciseInputValue(recipe.scale.y * 100),
    rotation: preciseInputValue(recipe.rotationDegrees),
    skewX: preciseInputValue(recipe.skew.xDegrees),
    skewY: preciseInputValue(recipe.skew.yDegrees),
  };
}

function preciseInputValue(value: number): string {
  return Number(value.toPrecision(15)).toString();
}

function handleEditEnd(source: "distort" | "transform"): void {
  if (phase !== "ready" || !current || refreshInFlight) return;
  disarmAppliedResultUndo();
  if (editorMode === "rectify") return;
  if (source === "distort" && editorMode === "distort") {
    // Keep every corner in the stable source frame for the whole Distort
    // session. Tight reframing here would renormalize all four points after
    // pointer-up, making adjacent corners appear to move even though the live
    // gesture held them fixed. Apply and cross-mode transitions own framing.
    distortFrameDirty = true;
    // Pointer/key release can precede onChange, or follow its paint while the
    // next history frame is still pending. Read the exact current geometry at
    // the semantic boundary; host refresh/Undo may arrive before another rAF.
    if (activeFrame && editor) activeFrame = { ...activeFrame, spec: editor.captureSpec() };
    commitHistoryNow();
    distortEndFrames.request();
    return;
  }
  if (source === "transform") transformGestureSession.cancel();
  if (source === "transform") requestTransformHistoryCommit();
  else commitHistoryNow();
}

/**
 * Reframe a Distort into the core's tight canvas at an operation boundary.
 * The editor keeps the raw quad for the full Distort session so adjacent
 * corners and the source reference frame stay visibly stable. Publication and
 * later modes only see this validated tight frame.
 */
async function finalizeDistortEdit(): Promise<boolean> {
  if (
    !editor ||
    !baseFrame ||
    !activeFrame ||
    editorMode !== "distort" ||
    phase !== "ready" ||
    composeInFlight ||
    refreshInFlight
  ) {
    return false;
  }
  if (!distortFrameDirty) return true;
  const generation = ++composeGeneration;
  const base = cloneFrame(baseFrame);
  const rawSpec = editor.captureSpec();
  activeFrame = { ...cloneFrame(base), spec: structuredClone(rawSpec) };
  composeInFlight = true;
  clearError();
  renderState();
  try {
    const composition = await withTimeout(
      composeAffineTransform(rawSpec, identityTransformRecipe(), {
        width: base.renderWidth,
        height: base.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    if (generation !== composeGeneration || editorMode !== "distort") return false;
    const nextFrame = frameFromComposition(base, composition);
    const loaded = await setEditorSpecWithRecovery(
      nextFrame,
      base,
    );
    if (generation !== composeGeneration || editorMode !== "distort") return false;
    if (!loaded) throw new Error("The selected layer could not be previewed");
    baseFrame = cloneFrame(nextFrame);
    activeFrame = cloneFrame(nextFrame);
    composeInFlight = false;
    transformInputsValid = true;
    distortFrameDirty = false;
    syncViewportScene();
    viewport?.handleCanvasResized();
    clearError();
    renderState();
    return true;
  } catch (error) {
    if (generation !== composeGeneration) return false;
    composeInFlight = false;
    // The editor was already restored to the fallback frame; keep activeFrame
    // consistent with it instead of parking the rejected raw spec where no
    // later consumer reads it. The error stays visible and the dirty flag
    // lets the next finalize retry from the editor's live state.
    baseFrame = base;
    activeFrame = cloneFrame(base);
    transformInputsValid = false;
    distortFrameDirty = true;
    clearSceneDraftFeedback();
    showError(error);
    renderState();
    return false;
  }
}

function currentHistoryEntry(): EditHistoryEntry {
  if (!baseFrame || !activeFrame) throw new Error("No transform frame to record");
  return {
    mode: editorMode,
    distortMode,
    distortFrameDirty,
    values: transformControls.currentValues(),
    gestureTranslation: { ...gestureTranslation },
    flip: { ...recipeFlip },
    pivot: { ...recipePivot },
    ...(editorMode === "rectify"
      ? {
          rectifyOutput: {
            width: rectifyWidthInput.value,
            height: rectifyHeightInput.value,
          },
        }
      : {}),
    baseFrame: cloneFrame(baseFrame),
    activeFrame: cloneFrame(activeFrame),
  };
}

function commitHistoryNow(entry?:EditHistoryEntry): void {
  if (!history || !baseFrame || !activeFrame || phase !== "ready" || refreshInFlight) return;
  disarmAppliedResultUndo();
  history.push(entry??currentHistoryEntry());
}

function disarmAppliedResultUndo(): void {
  appliedResultPending = false;
  undoRouted = false;
}

function requestTransformHistoryCommit(): void {
  if (
    editorMode !== "transform" ||
    phase !== "ready" ||
    refreshInFlight ||
    !transformInputsValid ||
    !transformControls.inputsComposeCleanly()
  ) {
    return;
  }
  deferredHistoryCommit.request();
  if (!composeInFlight && lastCompose) deferredHistoryCommit.flush();
}

async function stepHistory(direction: "undo" | "redo"): Promise<void> {
  if (!history || !editor || phase !== "ready" || composeInFlight || refreshInFlight) return;
  if (editorMode === "rectify") return;
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  const entry = direction === "undo" ? history.undo() : history.redo();
  if (!entry) {
    // Once the local draft is exhausted, Undo still belongs to the native
    // work. Reopening or returning from source view must not swallow it.
    if(direction==="undo"&&current?.nativeTarget){
      lastShownNodes=undefined;post({type:"trigger-undo"});
    }
    return;
  }
  composeGeneration += 1;
  composeInFlight = false;
  deferredHistoryCommit.clear();
  transformGestureSession.cancel();
  lastCompose = undefined;
  editorMode = entry.mode;
  distortMode = entry.distortMode;
  distortFrameDirty = entry.distortFrameDirty;
  baseFrame = cloneFrame(entry.baseFrame);
  activeFrame = cloneFrame(entry.activeFrame);
  gestureTranslation = { ...entry.gestureTranslation };
  recipeFlip = { ...entry.flip };
  recipePivot = { ...entry.pivot };
  if (entry.rectifyOutput) {
    rectifyWidthInput.value = entry.rectifyOutput.width;
    rectifyHeightInput.value = entry.rectifyOutput.height;
    rectifyInputsValid = readRectifyOutput() !== undefined;
  }
  transformControls.setValues(entry.values);
  syncWarpControls(entry.activeFrame.spec.content.warp);
  clearError();
  renderMode();
  pivotPicker.setValue(recipePivot);
  renderState();
  try {
    await withTimeout(
      editor.setSpec(activeFrame.spec, {
        width: activeFrame.renderWidth,
        height: activeFrame.renderHeight,
      }),
      TRANSFORM_PREVIEW_TIMEOUT_MS,
      () => userMessage("transformPreviewTimedOut"),
    );
    syncViewportScene();
    viewport?.handleCanvasResized();
    if (editorMode === "transform") {
      // Rebuild the gesture frame from the restored recipe so canvas
      // manipulation resumes immediately after an undo step.
      await updateTransformPreview();
    }
    setStatus(userMessage(direction === "undo" ? "editUndone" : "editRedone"));
  } catch (error) {
    showError(error);
  }
  renderState();
}

async function cancelSession(): Promise<void> {
  if (phase !== "ready" || refreshInFlight) return;
  await restoreLoadedState(true);
}

function menuActionAvailable(): boolean {
  return (
    phase === "ready" &&
    Boolean(current) &&
    Boolean(editor) &&
    Boolean(activeFrame) &&
    valid &&
    !composeInFlight &&
    !refreshInFlight
  );
}

/** Enter transform mode with the live quad baked as the new base. */
async function ensureTransformMode(): Promise<boolean> {
  if (editorMode !== "transform") await switchEditorMode("transform");
  return editorMode === "transform" && Boolean(lastCompose) && menuActionAvailable();
}

async function toggleRecipeFlip(axis: "x" | "y"): Promise<void> {
  if (!menuActionAvailable()) return;
  if (!(await ensureTransformMode())) return;
  recipeFlip = { ...recipeFlip, [axis]: !recipeFlip[axis] };
  await updateTransformPreview();
  requestTransformHistoryCommit();
}

async function rotateByQuarter(degrees: number): Promise<void> {
  if (!menuActionAvailable()) return;
  if (!(await ensureTransformMode())) return;
  const values = transformControls.currentValues();
  const rotation = wrapDegrees(Number(values.rotation) + degrees);
  transformControls.setValues({ ...values, rotation: rotation.toFixed(1) });
  await updateTransformPreview();
  requestTransformHistoryCommit();
}

/**
 * Human export of the live placement document. Correct mode is excluded: its
 * quad means "source to be corrected", not a destination placement.
 */
async function copyPlacementParametersToClipboard(): Promise<void> {
  if (!menuActionAvailable() || editorMode === "rectify") return;
  const spec = editor?.captureSpec() ?? activeFrame?.spec;
  if (!spec) return;
  const copied = await copyPlacementParameters(placementParametersJson(spec));
  setStatus({ key: copied ? "parametersCopied" : "copyParametersFailed" });
}

async function copyCssTransformToClipboard(): Promise<void> {
  if (!menuActionAvailable() || editorMode === "rectify") return;
  const spec = editor?.captureSpec() ?? activeFrame?.spec;
  if (!spec || !activeFrame) return;
  if (spec.content.warp && spec.content.warp.amount !== 0) {
    showError(userMessage("cssWarpUnsupported"));
    return;
  }
  try {
    const css = await emitCssTransform(
      spec,
      { width: activeFrame.renderWidth, height: activeFrame.renderHeight },
      { width: activeFrame.renderWidth, height: activeFrame.renderHeight },
    );
    const copied = await copyPlacementParameters(
      `${css.transform};\ntransform-origin: ${css.transformOrigin};`,
    );
    setStatus({ key: copied ? "cssCopied" : "cssCopyFailed" });
  } catch {
    showError(userMessage("cssWarpUnsupported"));
  }
}

async function applyTransformAgain(): Promise<void> {
  if (!menuActionAvailable() || !initialFrame || !activeFrame || !editor) return;
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  const repeated = appliedTransformMemory.repeatFor(initialFrame);
  if (!repeated) return;
  const generation = activeGeneration;
  const source = current;
  const fallbackFrame = cloneFrame(activeFrame);
  composeGeneration += 1;
  composeInFlight = false;
  deferredHistoryCommit.clear();
  transformGestureSession.cancel();
  lastCompose = undefined;
  clearError();
  renderState();
  try {
    const loaded = await setEditorSpecWithRecovery(
      repeated,
      fallbackFrame,
    );
    // A selection or generation change during the async work means the repeat
    // must not land on the newly loaded source.
    if (generation !== activeGeneration || phase !== "ready" || current !== source) return;
    if (!loaded) throw new Error("The repeated transform could not be previewed");
    editorMode = "transform";
    baseFrame = cloneFrame(repeated);
    activeFrame = cloneFrame(repeated);
    distortFrameDirty = false;
    gestureTranslation = { x: 0, y: 0 };
    resetTransformInputs();
    renderMode();
    syncViewportScene();
    viewport?.handleCanvasResized();
    const initialized = await updateTransformPreview();
    if (
      initialized &&
      generation === activeGeneration &&
      phase === "ready" &&
      current === source
    ) {
      commitHistoryNow();
    }
  } catch (error) {
    showError(error);
  }
  renderState();
}

async function selectPivot(pivot: Point): Promise<void> {
  if (!menuActionAvailable()) return;
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y)) return;
  if (!(await ensureTransformMode())) return;
  const frame = gestureFrameFromLastCompose();
  if (!frame) return;
  const recipe = changePivotWithoutMoving(frame, pivot);
  recipePivot = { ...recipe.pivot };
  gestureTranslation = { ...recipe.translation };
  pivotPicker.setValue(recipePivot);
  await updateTransformPreview();
  requestTransformHistoryCommit();
}

/**
 * X/Y place the output Frame's origin in scene coordinates. Move its carrier
 * placement directly: composing fractional recipe translation into a tight
 * raster canvas rounds its origin and can also enlarge the output by a pixel.
 */
function commitPlacementAxis(axis: "x" | "y"): void {
  const input = axis === "x" ? positionXInput : positionYInput;
  if (!baseFrame || !activeFrame || editorMode !== "transform" || phase !== "ready") return;
  const desired = parsePlacementValue(input.value);
  if (desired === undefined) {
    restorePlacementInput(axis);
    showError(userMessage("invalidPlacement"));
    return;
  }
  placementCanonical[axis] = input.value;
  const pagePoint=nativePlacementPagePoint(activeFrame.placement,current?.nativeOutputBasis);
  const intrinsic=nativePlacementPointFromPage({...pagePoint,[axis]:desired},current?.nativeOutputBasis);
  const origin={x:baseFrame.placement.x+intrinsic.x-activeFrame.placement.x,
    y:baseFrame.placement.y+intrinsic.y-activeFrame.placement.y};
  if (![origin.x,origin.y].every(Number.isFinite)) {
    restorePlacementInput(axis);
    showError(userMessage("invalidPlacement"));
    return;
  }
  baseFrame.placement={...baseFrame.placement,...origin};
  void updateTransformPreview();
  requestTransformHistoryCommit();
}

function restorePlacementInput(axis: "x" | "y"): void {
  if (!activeFrame) return;
  const input = axis === "x" ? positionXInput : positionYInput;
  const value = nativePlacementPagePoint(activeFrame.placement,current?.nativeOutputBasis)[axis];
  placementCanonical[axis] = preciseInputValue(value);
  input.value = displayPlacementValue(value);
}

function renderPlacementFields(): void {
  if (!activeFrame) return;
  const point=nativePlacementPagePoint(activeFrame.placement,current?.nativeOutputBasis);
  if (document.activeElement !== positionXInput) {
    placementCanonical.x = preciseInputValue(point.x);
    positionXInput.value = displayPlacementValue(point.x);
  }
  if (document.activeElement !== positionYInput) {
    placementCanonical.y = preciseInputValue(point.y);
    positionYInput.value = displayPlacementValue(point.y);
  }
}

function displayPlacementValue(value: number): string {
  return Number(value).toString();
}

function renderTransformActionStates(): void {
  const flips = effectiveFlipState(activeFrame?.spec);
  actionFlipX.setAttribute("aria-pressed", String(flips.x));
  actionFlipY.setAttribute("aria-pressed", String(flips.y));
}

function resetTransformInputs(): void {
  transformControls.reset();
  transformInputsValid = true;
  recipeFlip = { x: false, y: false };
  recipePivot = { x: 0.5, y: 0.5 };
  pivotPicker.setValue(recipePivot);
}

function cloneFrame(frame: TransformFrame): TransformFrame {
  return structuredClone(frame);
}

function renderMode(): void {
  if (editorMode !== "warp") warpPicker.close();
  const transformSelected = editorMode === "transform";
  const distortSelected = editorMode === "distort";
  const warpSelected = editorMode === "warp";
  const rectifySelected = editorMode === "rectify";
  modeTransformButton.setAttribute("aria-pressed", String(transformSelected));
  modeDistortButton.setAttribute("aria-pressed", String(distortSelected));
  modeWarpButton.setAttribute("aria-pressed", String(warpSelected));
  modeRectifyButton.setAttribute("aria-pressed", String(rectifySelected));
  controls.dataset.editorMode = editorMode;
  transformOptions.hidden = !transformSelected;
  distortOptions.hidden = !distortSelected;
  contextControls.hidden = distortSelected;
  warpOptions.hidden = !warpSelected;
  rectifyOptions.hidden = !rectifySelected;
  distortFreeButton.setAttribute(
    "aria-pressed",
    String(distortSelected && distortMode === "free"),
  );
  distortPerspectiveButton.setAttribute(
    "aria-pressed",
    String(distortSelected && distortMode === "perspective"),
  );
  editor?.setHandlesVisible(!warpSelected);
  editor?.setSourceSelectionMode(rectifySelected);
  editor?.setInteractionMode(transformSelected ? "transform" : "distort");
  editor?.setDistortMode(distortMode);
  if (!transformSelected) closePlacementPanel();
  renderScaleLink();
  modeStrip.refresh();
}

function renderOptionsContext(workspace: ProductWorkspace): void {
  const perspective = workspace === "perspective";
  if (!perspective) warpPicker.close();
  settingsPopover.dataset.workspace = perspective ? "perspective" : "global";
  for (const element of [
    perspectiveOptionsTitle,
    actionTransformAgain,
    actionCopyCss,
    shortcutHelp,
    outputSettingsTitle,
    outputPolicyFit,
    outputPolicyOriginal,
  ]) {
    element.hidden = !perspective;
  }
}

/**
 * A rectify output the user starts from must be publishable: a natural size
 * beyond the Figma axis limit is fitted under it (aspect preserved) instead of
 * seeding a value the input constraints and Apply gate would call invalid.
 */
function fitRectifySeed(width: number, height: number): { width: number; height: number } {
  const source = { width: Math.max(1, width), height: Math.max(1, height) };
  const scale = Math.min(
    1,
    MAX_FIGMA_IMAGE_AXIS / source.width,
    MAX_FIGMA_IMAGE_AXIS / source.height,
  );
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

function readRectifyOutput(): { width: number; height: number } | undefined {
  const width = Number(rectifyWidthInput.value);
  const height = Number(rectifyHeightInput.value);
  if (
    !rectifyWidthInput.validity.valid ||
    !rectifyHeightInput.validity.valid ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_FIGMA_IMAGE_AXIS ||
    height > MAX_FIGMA_IMAGE_AXIS
  ) {
    return undefined;
  }
  return { width, height };
}

function togglePlacementPanel(): void {
  placementPanel.hidden = !placementPanel.hidden;
  transformOptions.dataset.placementOpen = String(!placementPanel.hidden);
  placementToggle.setAttribute("aria-expanded", String(!placementPanel.hidden));
}

function closePlacementPanel(options: { restoreFocus?: boolean } = {}): void {
  if (placementPanel.hidden) return;
  placementPanel.hidden = true;
  delete transformOptions.dataset.placementOpen;
  placementToggle.setAttribute("aria-expanded", "false");
  if (options.restoreFocus) placementToggle.focus();
}

function closePlacementPanelOutside(event: PointerEvent): void {
  if (
    placementPanel.hidden ||
    placementPanel.contains(event.target as Node) ||
    placementToggle.contains(event.target as Node)
  ) {
    return;
  }
  closePlacementPanel();
}

function renderScaleLink(): void {
  const linked = transformControls.isScaleLinked();
  linkScaleButton.setAttribute("aria-pressed", String(linked));
  const key: MessageKey = linked ? "unlinkScale" : "linkScale";
  const label = translate(activeLocale, key);
  linkScaleButton.setAttribute("aria-label", label);
  linkScaleButton.title = label;
}

function warpPresetMessageKey(preset: WarpPreset): MessageKey {
  const keys: Record<WarpPreset, MessageKey> = {
    arc: "warpArc",
    arch: "warpArch",
    flag: "warpFlag",
    wave: "warpWave",
    fish: "warpFish",
    rise: "warpRise",
    fisheye: "warpFisheye",
    inflate: "warpInflate",
    squeeze: "warpSqueeze",
    twist: "warpTwist",
  };
  return keys[preset];
}

function renderZoomLevel(scale: number): void {
  zoomLevelOutput.value = formatZoomPercent(scale);
}

/** Keep tight transformed outputs registered to the loaded Figma layer. */
function syncViewportScene(): void {
  if (!viewport || !editor || !initialFrame || !activeFrame) return;
  syncSceneDraft();
  const display = editor.getTargetDisplaySize();
  const displayScaleX = display.width / activeFrame.renderWidth;
  const displayScaleY = display.height / activeFrame.renderHeight;
  const documentPerInitialPixelX = initialFrame.placement.width / initialFrame.renderWidth;
  const documentPerInitialPixelY = initialFrame.placement.height / initialFrame.renderHeight;
  viewport.setSceneOffset({
    x:
      ((activeFrame.placement.x - initialFrame.placement.x) / documentPerInitialPixelX) *
      displayScaleX,
    y:
      ((activeFrame.placement.y - initialFrame.placement.y) / documentPerInitialPixelY) *
      displayScaleY,
  });
}

/**
 * Opening Worldbend is read-only. The canvas working preview starts only once
 * the current frame differs from the loaded Figma result, then follows every
 * settled or live change. Returning exactly to the loaded frame removes it.
 */
function syncSceneDraft(): void {
  if (!LIVE_SCENE_DRAFT_ENABLED || !initialFrame || !activeFrame) return;
  if (productWorkspace.current() !== "perspective" || !valid) {
    clearSceneDraftFeedback();
    return;
  }
  if (editorMode !== "transform" && editorMode !== "distort" && editorMode !== "warp") {
    clearSceneDraftFeedback();
    return;
  }
  if (sameTransformFrame(initialFrame, activeFrame)) {
    clearSceneDraftFeedback();
    return;
  }
  sceneDraft.request();
}

/**
 * Publishes the carried deformation work from the Plane editor. The interior
 * mesh comes from the shared plan; the solve, output-density policy, and
 * high-resolution source raster follow the ordinary plane publication path so
 * the deformed result keeps the same quality contract.
 */
async function applyCarriedDeformation(duplicate:boolean,spec:TransformSpec,outputKind:PerspectiveOutputKind="image"):Promise<void> {
  const carried = carriedDeformation;
  const source = current;
  if (!carried || !source || !editor || !activeFrame) return;
  const generation = activeGeneration;
  const workspaceSource = meshWorkspace.currentSource() ?? surfaceWorkspace.currentSource();
  if (!workspaceSource) {
    showError(userMessage("noSourceLoaded"));
    return;
  }
  const work = deformationWorkFromPlaneView(carried.work, spec, {
    width: activeFrame.renderWidth,
    height: activeFrame.renderHeight,
  });
  const outputPlan = currentOutputPlan(false);
  if (!outputPlan || !canApplyOutput(outputPlan, outputDensityPolicy)) {
    showError(userMessage("transformOutputLimit", { limit: MAX_FIGMA_IMAGE_AXIS }));
    renderState();
    return;
  }
  clearSceneDraftFeedback();
  transformGestureSession.cancel();
  appliedResultPending = false;
  undoRouted = false;
  phase = "applying";
  clearError();
  setStatus(userMessage("applying"));
  renderState();
  try {
    const plan = await planDeformationWork(work);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const reference = plan.meshWarp.solve.resolvedDestination.reference;
    const placement = await deformationPublicationPlacement(workspaceSource, plan, duplicate);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const task = deformationTask(work, carried.view,
      designerDeformationTask(workspaceSource)?.shapeGuideSourceIndex, designerDeformationTask(workspaceSource)?.shapeGuideDomain);
    if (outputKind === "vector") {
      if (!source.nativeVector) throw userMessage("nativeVectorUnavailable");
      planeDeformationApply = { generation };
      postDesignerResult({ post, source: workspaceSource, task, bytes: new Uint8Array(0),
        width: reference.width, height: reference.height, placement,
        ...(duplicate ? { duplicate: true } : {}), nativeVector: true });
      return;
    }
    const raster = await prepareDeformationRaster(workspaceSource, plan, captureDesignerDeformationRaster);
    const canvasChange = await deformationCanvasChange(workspaceSource, plan, duplicate);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const bytes = await editor.exportPng(raster.size.width, raster.size.height, spec, raster.image,
      { solved: raster.solve, warpMesh: plan.meshWarp.spec.mesh, ...(plan.clip ? { clip: plan.clip } : {}) });
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    carriedDeformation = { ...carried, work };
    planeDeformationApply = { generation };
    postDesignerResult({ post, source: workspaceSource, task, bytes,
      width: reference.width, height: reference.height, rasterSize: raster.size, placement,
      ...(canvasChange ? { canvasChange } : {}), ...(duplicate ? { duplicate: true } : {}) });
  } catch (error) {
    if (generation !== activeGeneration) return;
    planeDeformationApply = undefined;
    phase = "ready";
    showError(error);
    renderState();
    // The host never received a publication; the live deformed draft keeps
    // its in-context feedback.
    syncSceneDraft();
  }
}

type PerspectiveOutputKind = "image" | "frame" | "vector";

async function applyPerspective(duplicate = false, outputIntent?: PerspectiveOutputKind): Promise<void> {
  // A running results batch owns this generation's apply-completion routing,
  // so a concurrent plane publication would be consumed as one of its items
  // and this editor would never see its own completion. One publication
  // pipeline at a time.
  if (linkedBatchRun || linkedBatchPrepare) {
    showError(userMessage("batchApplyBlocked"));
    renderState();
    return;
  }
  // A Warp operation cannot publish an editable result, so even on a
  // native-capable file its primary Apply stays the HD image route instead
  // of routing editable and failing on click.
  const outputKind=outputIntent??(!duplicate?(current?.nativeVectorTarget?"vector":current?.nativeTarget&&!editor?.captureSpec().content.warp?"frame":"image"):"image");
  const editable = outputKind !== "image";
  if (editable && editorMode === "rectify") {
    showError(userMessage("nativeApplyFailed"));
    return;
  }
  if (editorMode === "rectify") {
    await applyRectification(duplicate);
    return;
  }
  if (editorMode === "distort" && distortFrameDirty) {
    const finalized = await finalizeDistortEdit();
    if (!finalized) return;
  }
  if (
    !editor ||
    !current ||
    !initialFrame ||
    !activeFrame ||
    !baseFrame ||
    !valid ||
    !transformInputsValid ||
    composeInFlight ||
    phase !== "ready" ||
    refreshInFlight
  ) {
    return;
  }
  const source = current;
  const generation = activeGeneration;
  const spec = editor.captureSpec();
  // A carried deformation work makes the Plane editor one more view over that
  // work: Apply publishes plane plus interior through the shared plan instead
  // of a plane-only result that would silently drop the deformation. No
  // native route can represent the interior, so every Apply intent resolves
  // to the deformation raster publication.
  if (carriedDeformation) {
    if (!planeSpecComposesWithDeformation(spec)) {
      showError(userMessage("deformationWarpCompose"));
      renderState();
      return;
    }
    await applyCarriedDeformation(duplicate,spec,outputKind);
    return;
  }
  if (editable && source.nativeVectorTarget && !duplicate && !source.nativeVector) {
    showError(userMessage(source.artworkSource ? "nativeVectorArtworkUnavailable" : "nativeVectorUnavailable"));
    return;
  }
  if (outputKind === "vector" && !source.nativeVector) {
    showError(userMessage(source.artworkSource ? "nativeVectorArtworkUnsupported" : "nativeVectorUnsupported"));
    return;
  }
  if (outputKind==="frame"&&spec.content.warp) {
    showError(userMessage("nativeApplyFailed"));
    return;
  }
  const output = { ...cloneFrame(activeFrame), spec };
  const outputPlan = currentOutputPlan(editable);
  // Raster fitting changes pixel density only. A native Frame must fit the
  // host's logical bounds and is independent of the image density preference.
  const policy = editable ? "original" : outputDensityPolicy;
  if (!outputPlan || !canApplyOutput(outputPlan, policy)) {
    showError(userMessage("transformOutputLimit", { limit: MAX_FIGMA_IMAGE_AXIS }));
    renderState();
    return;
  }
  const rasterSize = rasterSizeForPolicy(outputPlan, policy);
  // Synchronous validation failures leave the working preview untouched.
  // Clear only after publication is actually accepted; any later failure
  // restores feedback from the still-live editing state below.
  clearSceneDraftFeedback();
  activeFrame = cloneFrame(output);
  const targetKind: PerspectiveOutputKind = source.nativeTarget ? "frame" : source.nativeVectorTarget ? "vector" : "image";
  const replacing = !duplicate && source.targetNodeId && outputKind === targetKind;
  pendingReplacementBaseline = replacing ? {
    generation,
    frame: {
      ...cloneFrame(output),
      renderWidth: editable ? Math.ceil(output.placement.width) : rasterSize.width,
      renderHeight: editable ? Math.ceil(output.placement.height) : rasterSize.height,
    },
  } : undefined;
  transformGestureSession.cancel();
  // This remains pending until the main thread confirms the visible write.
  appliedTransformMemory.begin(generation, {
    initialFrame: cloneFrame(initialFrame),
    finalFrame: cloneFrame(output),
  });
  appliedResultPending = false;
  phase = "applying";
  clearError();
  setStatus(userMessage(replacing ? "replacing" : "applying"));
  renderState();
  try {
    let nativeVectorFallback = false;
    if (editable) {
      const solved = await solveTransform(spec, rasterSize);
      if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
      if (outputKind === "vector") {
        const matrix = solved.homography.matrix;
        let relayed;
        try {
          relayed = await requestNativeVectorProjection({
            generation,spec,matrix,operation:{kind:"transform",spec},sourceNodeIds:[source.sourceNodeId],
            sourceNodeId: source.sourceNodeId,
            renderWidth: rasterSize.width, renderHeight: rasterSize.height,
            placement: output.placement,
            ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
            ...(duplicate ? { duplicate: true } : {}),
          });
        } catch (message) {
          if (generation !== activeGeneration || current !== source) return;
          failPendingApply(generation, message as UserMessage);
          return;
        }
        if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
        let projected: VectorProjectionOutput[] | undefined;
        let projectedView=relayed.sourceView;
        try {
          // One complete operation and one cumulative core budget cover every
          // captured layer. Any part the core refuses falls the whole
          // apply back to the HD image route — parts are never dropped.
          const nativeResult=await planVectorArtwork(nativeVectorArtworkFromInputs({kind:"transform",spec},relayed.inputs,relayed.sourceView.policy==="appearance"));
          projected=nativeResult.outputs;
          projectedView=resolvedNativeVectorSourceView(relayed.sourceView,nativeResult.sourceBounds);
        } catch {
          // The core refused this geometry (stationary endpoints, direction
          // reversals, cusps, self-intersecting outlines, complexity): the
          // apply keeps its outcome on the HD image route instead of failing,
          // and the completion status states why no native result appeared.
          if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
          nativeVectorFallback = true;
          nativeVectorFallbackGenerations.clear();
          nativeVectorFallbackGenerations.add(generation);
        }
        if (projected) {
          post({ type: "apply-native-vector", payload: {
            generation,spec,matrix,operation:{kind:"transform",spec},sourceNodeIds:[source.sourceNodeId],
            sourceNodeId: source.sourceNodeId,
            renderWidth: rasterSize.width, renderHeight: rasterSize.height,
            placement: relayed.placement,
            sourceView:projectedView,operationExpected:relayed.operationExpected,
            projection: {
              outputs: projected,
              sourceFingerprint: relayed.sourceFingerprint,
            },
            ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
            ...(duplicate ? { duplicate: true } : {}),
          } });
          return;
        }
        // The HD publication below needs the raster size its payload names.
        if (pendingReplacementBaseline?.generation === generation) {
          pendingReplacementBaseline.frame.renderWidth = rasterSize.width;
          pendingReplacementBaseline.frame.renderHeight = rasterSize.height;
        }
      } else {
        const nativePlan=source.nativeSourceSize?await planNativeFrame({spec,sourceSize:source.nativeSourceSize,outputSize:{width:output.placement.width,height:output.placement.height}}):undefined;
        if(generation!==activeGeneration||current!==source)return;
        if(!source.nativeRenderer&&(nativePlan?.kind!=="affine"||source.nativeTarget&&!source.nativeComponentTarget))throw userMessage(source.nativeTarget?"nativeEffectUnavailable":"nativeUnavailable");
        post({ type: "apply-native", payload: {
          generation, spec, inverse: solved.homography.inverse,
          ...(nativePlan?{nativePlan}:{}),
          sourceNodeId: source.sourceNodeId,
          renderWidth: rasterSize.width, renderHeight: rasterSize.height,
          placement: output.placement,
          ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
          ...(duplicate ? { duplicate: true } : {}),
        } });
        return;
      }
    }
    const prepared = await prepareFinalSourceRaster(source, rasterSize, spec);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const bytes = prepared.unchangedSourceBytes ?? await editor.exportPng(
      rasterSize.width,
      rasterSize.height,
      spec,
      prepared.sourceOverride,
      {
        solved: prepared.solved,
        ...(prepared.warpMesh ? { warpMesh: prepared.warpMesh } : {}),
      },
    );
    if (
      generation !== activeGeneration ||
      phase !== "applying" ||
      current !== source
    ) {
      return;
    }
    post({
      type: "apply",
      payload: {
        generation,
        bytes,
        spec,
        sourceNodeId: source.sourceNodeId,
        renderWidth: rasterSize.width,
        renderHeight: rasterSize.height,
        placement: output.placement,
        ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
        ...(duplicate ? { duplicate: true } : {}),
        ...(nativeVectorFallback ? { nativeVectorFallback: true } : {}),
      },
    });
  } catch (error) {
    if (generation !== activeGeneration) return;
    appliedTransformMemory.fail(generation);
    phase = "ready";
    showError(error);
    renderState();
    syncSceneDraft();
  }
}

async function applyRectification(duplicate = false): Promise<void> {
  pendingReplacementBaseline = undefined;
  clearSceneDraftFeedback();
  const output = readRectifyOutput();
  if (
    !editor ||
    !current ||
    !activeFrame ||
    !valid ||
    !output ||
    composeInFlight ||
    phase !== "ready" ||
    refreshInFlight
  ) {
    if (!output) showError(userMessage("invalidRectify"));
    return;
  }
  const source = current;
  const generation = activeGeneration;
  const rectification: RectifySpecInput = {
    schema: "worldbend.rectify",
    version: "0.1",
    source: {
      space: "normalized",
      quad: structuredClone(editor.captureSpec().destination.quad),
    },
    output,
  };
  appliedResultPending = false;
  phase = "applying";
  clearError();
  setStatus(userMessage(!duplicate && source.targetNodeId ? "replacing" : "applying"));
  renderState();
  try {
    const plan = await rectifyPlane(rectification);
    const prepared = await prepareRectificationSourceRaster(source, plan);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const bytes = await editor.exportPng(
      output.width,
      output.height,
      normalizedSpec(unitQuad()),
      prepared.sourceOverride,
      { solved: prepared.solved },
    );
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const placement = fittedRectificationPlacement(activeFrame.placement, output);
    post({
      type: "apply",
      payload: {
        generation,
        bytes,
        rectification,
        sourceNodeId: source.sourceNodeId,
        renderWidth: output.width,
        renderHeight: output.height,
        placement,
        ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
        ...(duplicate ? { duplicate: true } : {}),
      },
    });
  } catch (error) {
    if (generation !== activeGeneration) return;
    phase = "ready";
    showError(error);
    renderState();
  }
}

async function prepareRectificationSourceRaster(
  source: ActiveSource,
  plan: RectifyPlan,
): Promise<{ sourceOverride?: HTMLImageElement; solved: PreviewSolveOutput }> {
  if (!editor) throw new Error("The correction preview is unavailable");
  const solved: PreviewSolveOutput = {
    resolvedDestination: {
      reference: {
        width: plan.spec.output.width,
        height: plan.spec.output.height,
      },
    },
    homography: { matrix: plan.homography.matrix },
  };
  const desired = estimateSourceRasterSize(
    plan,
    normalizedSpec(unitQuad()),
    MAX_FIGMA_IMAGE_AXIS,
  );
  const available = editor.getSourceRasterSize();
  if (available && available.width >= desired.width && available.height >= desired.height) {
    return { solved };
  }
  return { sourceOverride: await finalSourceImage(source, desired), solved };
}

function fittedRectificationPlacement(
  source: TransformFrame["placement"],
  output: { width: number; height: number },
): TransformFrame["placement"] {
  const scale = Math.min(source.width / output.width, source.height / output.height);
  const width = output.width * scale;
  const height = output.height * scale;
  return {
    x: source.x + (source.width - width) / 2,
    y: source.y + (source.height - height) / 2,
    width,
    height,
  };
}

async function prepareFinalSourceRaster(
  source: ActiveSource,
  output: Size,
  spec: TransformFrame["spec"],
  deformationMesh?: WarpMesh,
): Promise<{
  sourceOverride?: HTMLImageElement;
  unchangedSourceBytes?: Uint8Array;
  solved: PreviewSolveOutput;
  warpMesh?: WarpMesh;
}> {
  if (!editor) throw new Error("The transform preview is unavailable");
  const solved = await solveTransform(spec, {
    width: output.width,
    height: output.height,
  });
  const warpMesh = deformationMesh ??
    (spec.content.warp?.amount
      ? await buildWarpMesh(spec.content.warp)
      : undefined);
  if (isUnchangedRasterProjection(solved, output, warpMesh)) {
    const capture = await finalSourceCapture(source, output);
    // Figma exports at a uniform scale. Appearance overflow or pixel rounding
    // can make the real PNG disagree with requested dimensions; those sources
    // retain the regular density-planned renderer rather than a false identity.
    if (capture.image.naturalWidth === output.width && capture.image.naturalHeight === output.height) {
      return { solved, unchangedSourceBytes: capture.bytes };
    }
  }
  const desired = estimateSourceRasterSize(
    solved,
    spec,
    MAX_FIGMA_IMAGE_AXIS,
    warpMesh,
  );
  const available = editor.getSourceRasterSize();
  if (available && available.width >= desired.width && available.height >= desired.height) {
    return { solved, ...(warpMesh ? { warpMesh } : {}) };
  }
  return {
    sourceOverride: await finalSourceImage(source, desired),
    solved,
    ...(warpMesh ? { warpMesh } : {}),
  };
}

async function finalSourceImage(source: ActiveSource, desired: Size): Promise<HTMLImageElement> {
  return (await finalSourceCapture(source, desired)).image;
}

async function captureDesignerDeformationRaster(source: DesignerWorkspaceSource, desired: Size): Promise<HTMLImageElement> {
  const artwork = deformationArtworkSource(source);
  const active = current;
  if (!active || !artwork || source.selectionGeneration !== activeGeneration ||
    artwork.sourceNodeId !== active.sourceNodeId || source.targetNodeId !== active.targetNodeId) {
    throw userMessage("selectionChanged");
  }
  return finalSourceImage(active, desired);
}

async function finalSourceCapture(source: ActiveSource, desired: Size): Promise<NonNullable<typeof finalSourceRaster>> {
  if (current !== source || refreshInFlight) throw userMessage("selectionChanged");
  const generation = activeGeneration;
  if (finalSourceRaster?.source === source && finalSourceRaster.generation === generation &&
    finalSourceRaster.width === desired.width && finalSourceRaster.height === desired.height) {
    return finalSourceRaster;
  }
  finalSourceRaster = undefined;
  const raw = await requestSourceRaster(source, desired);
  const {bytes,image} = await decodeSourceRaster(raw.bytes,raw.captureFacts);
  if (generation !== activeGeneration || current !== source || refreshInFlight) throw userMessage("selectionChanged");
  finalSourceRaster = { source, generation, width: desired.width, height: desired.height, image, bytes };
  return finalSourceRaster;
}

function selectOutputDensityPolicy(policy: OutputDensityPolicy): void {
  if (outputDensityPolicy === policy) return;
  outputDensityPolicy = policy;
  clearError();
  renderState();
}

function highResolutionDensity(): number {
  if (!activeFrame) return 1;
  return Math.max(1, 2 * activeFrame.placement.width / activeFrame.renderWidth,
    2 * activeFrame.placement.height / activeFrame.renderHeight);
}

function currentOutputPlan(editable = false): FigmaOutputPlan | undefined {
  if (!initialFrame || !activeFrame) return undefined;
  if (carriedDeformation && editorMode !== "rectify") {
    const planned = refreshCarriedOutput();
    if (!planned) return undefined;
    return planOutputForSize(editable ? planned.placement : planned.size);
  }
  try {
    let requested: PixelSize;
    if (editorMode === "rectify") {
      const output = readRectifyOutput();
      if (!output) return undefined;
      requested = output;
    } else if (editorMode === "distort" && distortFrameDirty && editor && baseFrame) {
      requested = outputSizeForQuad(editor.captureSpec().destination.quad, {
        width: baseFrame.renderWidth,
        height: baseFrame.renderHeight,
      });
    } else {
      requested = {
        width: activeFrame.renderWidth,
        height: activeFrame.renderHeight,
      };
    }
    if (editable) {
      return planOutputForSize({
        width: Math.ceil(requested.width * activeFrame.placement.width / activeFrame.renderWidth),
        height: Math.ceil(requested.height * activeFrame.placement.height / activeFrame.renderHeight),
      });
    }
    const density = editorMode === "rectify" ? 1 : highResolutionDensity();
    return planOutputForSize({ width: requested.width * density, height: requested.height * density });
  } catch {
    return undefined;
  }
}

function planOutputForSize(requested: Size): FigmaOutputPlan | undefined {
  if (!initialFrame) return undefined;
  try {
    return planFigmaOutput(
      { width: initialFrame.renderWidth, height: initialFrame.renderHeight },
      requested,
      MAX_FIGMA_IMAGE_AXIS,
    );
  } catch {
    return undefined;
  }
}

function renderOutputPolicy(): void {
  // A carried deformation owns its complete-canvas density; the manual
  // fit/original choice only applies to plain plane output.
  const automatic = productWorkspace.current() === "perspective" && Boolean(carriedDeformation);
  for (const element of [outputSettingsTitle, outputPolicyFit, outputPolicyOriginal]) {
    element.hidden = productWorkspace.current() !== "perspective" || automatic;
  }
  outputPolicyFit.setAttribute("aria-checked", String(outputDensityPolicy === "fit"));
  outputPolicyOriginal.setAttribute("aria-checked", String(outputDensityPolicy === "original"));
}

function renderOutputSize(plan: FigmaOutputPlan | undefined): void {
  if (!current || !plan || phase === "idle" || phase === "loading") {
    outputSize.hidden = true;
    outputSizeFlow.textContent = "";
    outputSizeNote.textContent = "";
    outputSize.removeAttribute("aria-label");
    delete outputSize.dataset.blocked;
    return;
  }
  const nativePlan = (current.nativeVectorTarget || current.nativeTarget) && editorMode !== "rectify" &&
    !editor?.captureSpec().content.warp ? currentOutputPlan(true) : undefined;
  if (nativePlan) {
    outputSize.hidden = false;
    const name = translate(activeLocale, current.nativeVectorTarget ? "nativeVectorOutput" : "editableFrameOutput");
    outputSizeFlow.textContent = `${name} · ${formatPixelSize(nativePlan.requested)}`;
    outputSizeNote.textContent = nativePlan.fitted ? translate(activeLocale, "nativeOutputLimit") : "";
    outputSize.setAttribute("aria-label", [outputSizeFlow.textContent, outputSizeNote.textContent].filter(Boolean).join(". "));
    if (nativePlan.fitted) outputSize.dataset.blocked = "true";
    else delete outputSize.dataset.blocked;
    return;
  }
  const source = formatPixelSize(plan.source);
  const requested = formatPixelSize(plan.requested);
  const applied = formatPixelSize(plan.applied);
  const fitted = plan.fitted && outputDensityPolicy === "fit";
  const blocked = plan.fitted && outputDensityPolicy === "original";
  outputSize.hidden = false;
  const pixelFlow = fitted
    ? `${source} → ${requested} → ${applied} px`
    : `${source} → ${requested} px`;
  outputSizeFlow.textContent = `${translate(activeLocale, "highResolutionOutput")} · ${pixelFlow}`;
  outputSizeNote.textContent = carriedDeformation ? "" : fitted
    ? translate(activeLocale, "outputFitNote")
    : blocked
      ? translate(activeLocale, "outputOverLimitNote")
      : "";
  if (blocked) outputSize.dataset.blocked = "true";
  else delete outputSize.dataset.blocked;
  outputSize.setAttribute(
    "aria-label",
    `${translate(activeLocale, "highResolutionOutput")}. ` + translate(
      activeLocale,
      userMessage(
        fitted
          ? "outputSizeFittedAria"
          : blocked
            ? "outputSizeOverLimitAria"
            : "outputSizeAria",
        fitted
          ? { source, requested, applied }
          : blocked
            ? { source, requested }
            : { source, output: requested },
      ),
    ),
  );
}

function formatPixelSize(size: PixelSize): string {
  return `${size.width} × ${size.height}`;
}

function requestSourceRaster(source: ActiveSource, desired: Size): Promise<Pick<SourceRasterPayload,"bytes"|"captureFacts">> {
  const requestId = nextSourceRasterRequestId++;
  return new Promise<Pick<SourceRasterPayload,"bytes"|"captureFacts">>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSourceRasterRequests.delete(requestId);
      reject(userMessage("sourceExportTimedOut"));
    }, SOURCE_RASTER_TIMEOUT_MS);
    pendingSourceRasterRequests.set(requestId, {
      generation: activeGeneration,
      timer,
      resolve,
      reject,
    });
    post({
      type: "request-source-raster",
      generation: activeGeneration,
      requestId,
      sourceNodeId: source.sourceNodeId,
      ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
      desiredWidth: Math.max(1, Math.min(MAX_FIGMA_IMAGE_AXIS, Math.round(desired.width))),
      desiredHeight: Math.max(1, Math.min(MAX_FIGMA_IMAGE_AXIS, Math.round(desired.height))),
    });
  });
}

function cancelSourceRasterRequests(error: unknown): void {
  for (const pending of pendingSourceRasterRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  pendingSourceRasterRequests.clear();
}

let nativeFrameAdmission:{key:string;pending:boolean;plan?:NativeFramePlan}|undefined;
let carriedOutput: { key: string; value?: Awaited<ReturnType<typeof planDeformationRaster>> } | undefined;
/** The visible output size and Apply use the same full-canvas plan. Cache by
 * both the live work and saved publication state, never by the base plane. */
function refreshCarriedOutput(): Awaited<ReturnType<typeof planDeformationRaster>> | undefined {
  const carried = carriedDeformation, frame = activeFrame;
  const source = meshWorkspace.currentSource() ?? surfaceWorkspace.currentSource();
  if (!carried || !frame || !source || !editor) return undefined;
  const work = deformationWorkFromPlaneView(carried.work, editor.captureSpec(),
    { width: frame.renderWidth, height: frame.renderHeight });
  const key = JSON.stringify([activeGeneration, work, source.task, source.targetPlacement, source.targetRasterSize]);
  if (carriedOutput?.key === key) return carriedOutput.value;
  const entry = { key } as NonNullable<typeof carriedOutput>;
  carriedOutput = entry;
  void planDeformationWork(work)
    .then(plan => planDeformationRaster(source, plan))
    .then(value => {
      if (carriedOutput !== entry) return;
      entry.value = value;
      renderState("publication");
    })
    .catch(error => {
      if (carriedOutput === entry) {
        showError(error);
        renderState("publication");
      }
    });
  return undefined;
}
function refreshNativeFrameAdmission(source:ActiveSource|undefined,placement:Placement|undefined):NativeFramePlan|undefined {
  if(!source?.nativeSourceSize||!placement||!editor)return undefined;
  const input={spec:editor.captureSpec(),sourceSize:source.nativeSourceSize,outputSize:{width:placement.width,height:placement.height}};
  const key=JSON.stringify([activeGeneration,input]);
  if(nativeFrameAdmission?.key===key)return nativeFrameAdmission.plan;
  const entry={key,pending:true} as NonNullable<typeof nativeFrameAdmission>;nativeFrameAdmission=entry;
  void planNativeFrame(input).then(plan=>{if(nativeFrameAdmission===entry){entry.plan=plan;entry.pending=false;renderState("publication");}}).catch(()=>{if(nativeFrameAdmission===entry){entry.pending=false;renderState("publication");}});
  return undefined;
}

function renderState(scope: "full" | "publication" = "full"): void {
  const editing=Boolean(current?.nativeSourceEditing);
  document.body.classList.toggle("native-source-mode",editing);
  nativeSourceEditing.hidden=!editing;
  nativeSourceTitle.textContent=translate(activeLocale,"nativeSourceTitle");
  nativeSourceDescription.textContent=translate(activeLocale,"nativeSourceDescription");
  const header=document.querySelector<HTMLElement>("#controls > header");if(header)header.inert=editing;
  editNativeSourceButton.hidden=!current?.nativeComponentTarget||editing;
  editNativeSourceButton.disabled=phase!=="ready";
  editNativeSourceButton.textContent=translate(activeLocale,"editNativeSource");
  resetButton.hidden=editing;
  const ready = phase === "ready" && Boolean(current) && Boolean(editor);
  const controlsPending=controlPreviewFrames.pending()||controlPreviewWork.pending();
  const blockingCompose = controlsPending||(composeInFlight && !continuousPreviewInFlight) ||
    (productWorkspace.current() === "perspective" && pendingCarriedPlane !== undefined);
  const transformInitializing = ready && editorMode === "transform" && !lastCompose;
  const navigationReady = ready && valid && Boolean(activeFrame) &&
    !controlsPending && !(composeInFlight && !continuousPreviewInFlight) && !refreshInFlight;
  const taskReady = navigationReady && !blockingCompose;
  const sourceCount = (current?.deformationDraft ?? (current?.task?.kind === "deformation" ? current.task : undefined))?.shapeGuideSourceIndex !== undefined
    ? 1 : current?.sources?.length ?? (current ? 1 : 0);
  const menuReady = taskReady && sourceCount === 1;
  const outputPlan = currentOutputPlan();
  const outputApplicable = canApplyOutput(outputPlan, outputDensityPolicy);
  const positionReady = menuReady && !transformInitializing && editorMode === "transform" && transformInputsValid;
  const editableApplicable = canApplyOutput(currentOutputPlan(true), "original");
  const editableModeSupported = editorMode !== "rectify" && !editor?.captureSpec().content.warp;
  const frameSource = Boolean(current?.nativeFrameSource || current?.nativeTarget ||
    current?.nativeRenderer || current?.nativeRendererPending);
  const nativePlan=refreshNativeFrameAdmission(ready&&editableModeSupported?current:undefined,activeFrame?.placement);
  const availability=nativeFrameAvailability({renderer:Boolean(current?.nativeRenderer),rendererPending:Boolean(current?.nativeRendererPending),
    corePending:Boolean(current?.nativeSourceSize&&nativeFrameAdmission?.pending),legacyTarget:Boolean(current?.nativeTarget&&!current.nativeComponentTarget),
    ...(nativePlan?{coreKind:nativePlan.kind}:{})});
  const editableSupported = availability.supported && editableModeSupported;
  const editableReady = menuReady && transformInputsValid && !transformInitializing &&
    editableApplicable && editableSupported;
  actionApplyEditable.disabled = !editableReady;
  actionApplyEditable.hidden = !frameSource;
  const vectorReady = menuReady && transformInputsValid && !transformInitializing &&
    editableApplicable && editorMode!=="rectify" && Boolean(current?.nativeVector);
  actionApplyVector.hidden = !current?.vectorSource && !current?.nativeVector && !current?.nativeVectorTarget;
  actionApplyVector.disabled = !vectorReady;
  actionApplyVector.textContent = translate(activeLocale, "applyNativeVector");
  const vectorHelp = translate(activeLocale, editorMode==="rectify" ? "nativeOutputUnsupported" :
    !current?.nativeVector ? current?.artworkSource ? "nativeVectorArtworkUnsupported" : "nativeVectorUnsupported" :
    !editableApplicable ? "nativeOutputLimit" : "nativeVectorOutputHelp");
  actionApplyVector.title = vectorHelp;
  const editableHelp = translate(activeLocale, !editableModeSupported ? "nativeOutputUnsupported" :
    availability.preparing ? "nativePreparing" :
    !availability.supported ? current?.nativeTarget ? "nativeEffectUnavailable" : "nativeUnavailable" :
    !editableApplicable ? "nativeOutputLimit" : "editableOutputHelp");
  actionApplyEditable.title = editableHelp;
  actionApplyEditable.textContent = translate(activeLocale, "applyEditable");
  actionApplyCopy.disabled = !menuReady || !transformInputsValid || transformInitializing ||
    !outputApplicable || (editorMode === "rectify" && !rectifyInputsValid);
  const imageSize = outputPlan && rasterSizeForPolicy(outputPlan, outputDensityPolicy);
  const imageHelp = `${translate(activeLocale, "imageOutputHelp")}${imageSize ? ` · ${imageSize.width} × ${imageSize.height} px` : ""}`;
  actionApplyCopy.title = imageHelp;
  applyButton.disabled =
    !ready ||
    !valid ||
    !transformInputsValid ||
    !outputApplicable ||
    (editorMode === "rectify" && !rectifyInputsValid) ||
    blockingCompose ||
    refreshInFlight;
  // A Warp operation cannot publish an editable result, so on native-capable
  // files the primary button must stay the HD route instead of taking the
  // editable gate and disabling itself: the alternate HD button only exists
  // once a result is selected, which would leave a fresh Warp unapplicable.
  const primaryEditable=Boolean(current?.nativeVectorTarget?editorMode!=="rectify":current?.nativeTarget&&editableModeSupported);
  const primaryEditableReady = current?.nativeVectorTarget ? vectorReady : editableReady;
  if (primaryEditable) applyButton.disabled = !primaryEditableReady;
  const primaryEditableHelp = current?.nativeVectorTarget && !current.nativeVector
    ? translate(activeLocale, current.artworkSource ? "nativeVectorArtworkUnavailable" : "nativeVectorUnavailable")
    : current?.nativeVectorTarget ? vectorHelp : editableHelp;
  applyButton.title = primaryEditable ? primaryEditableHelp : imageHelp;
  const replacing = Boolean(current?.targetNodeId) &&
    ((!current?.nativeTarget && !current?.nativeVectorTarget) || primaryEditable);
  applyButton.textContent = translate(activeLocale, replacing
    ? primaryEditable
      ? current?.nativeVectorTarget ? "updateNativeVector" : "updateEditable"
      : "updateHighResolutionImage"
    : "createHighResolutionImage");
  actionApplyCopy.hidden = !replacing;
  renderOutputSize(outputPlan);
  if(editing){
    actionApplyEditable.hidden=true;actionApplyVector.hidden=true;actionApplyCopy.hidden=true;
    applyButton.textContent=translate(activeLocale,"returnNativeResult");
    applyButton.disabled=phase!=="ready"||refreshInFlight;
    applyButton.title=translate(activeLocale,"returnNativeResult");
  }
  if (scope === "publication") return;
  // A missing native effect cannot be fixed by editing transform inputs, so
  // its recovery guidance must stay keyboard-reachable and visible instead of
  // hiding behind a disabled button's hover-only tooltip.
  const editableEnvironmentBlocked = menuReady && transformInputsValid && !transformInitializing &&
    editableApplicable && editableModeSupported && frameSource &&
    !availability.supported && !current?.nativeRenderer && !current?.nativeRendererPending;
  if (editableEnvironmentBlocked) {
    actionApplyEditable.disabled = false;
    actionApplyEditable.setAttribute("aria-disabled", "true");
    actionApplyEditable.setAttribute("aria-describedby", nativeHelp.panel.id);
    nativeGuidance.textContent = translate(activeLocale, current?.nativeTarget ? "nativeEffectUnavailable" : "nativeUnavailable");
    nativeGuidance.hidden = false;
    openEffectListing.hidden = false;
    nativeHelp.button.hidden = false;
    nativeHelp.setCopy(translate(activeLocale, "nativeOutputHelp"));
  } else {
    actionApplyEditable.removeAttribute("aria-disabled");
    actionApplyEditable.removeAttribute("aria-describedby");
    nativeGuidance.hidden = true;
    openEffectListing.hidden = true;
    nativeHelp.button.hidden = true;
    nativeHelp.close();
  }
  for (const button of [actionFlipX, actionFlipY, actionRotateCw, actionCopyParameters]) {
    button.disabled = !positionReady;
  }
  actionCopyParameters.disabled = !positionReady || editorMode === "rectify";
  // CSS emission represents a Distort quad just as well as a Transform
  // recipe; the documented route is Transform/Distort without Warp.
  const cssReady = menuReady && !transformInitializing && transformInputsValid &&
    (editorMode === "transform" || editorMode === "distort");
  actionCopyCss.disabled = !cssReady;
  actionApplyCopy.textContent = translate(activeLocale, "createHighResolutionImage");
  workspaceNavigation.setDisabled(!navigationReady||editing);
  // Transform Again repeats onto the current source and lands in Transform
  // mode itself, so it must stay reachable from the Distort mode a fresh
  // selection opens in; Warp and Correct are different operation families.
  const repeatReady = menuReady && !transformInitializing && transformInputsValid &&
    (editorMode === "transform" || editorMode === "distort");
  actionTransformAgain.disabled = !repeatReady || !appliedTransformMemory.hasLatest();
  pivotPicker.setDisabled(!positionReady);
  placementToggle.disabled = !positionReady;
  positionXInput.disabled = !positionReady;
  positionYInput.disabled = !positionReady;
  renderPlacementFields();
  renderTransformActionStates();
  editor?.setDisabled(editing || !ready || transformInitializing || blockingCompose || refreshInFlight);
  resetButton.disabled = !ready || blockingCompose || refreshInFlight;
  const rectificationOnly = editorMode === "rectify" && !rectifyParent;
  modeTransformButton.disabled = !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  modeDistortButton.disabled = !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  modeWarpButton.disabled = !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  modeRectifyButton.disabled = !ready || !valid || blockingCompose || refreshInFlight;
  const peersDisabled =
    !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  distortFreeButton.disabled = peersDisabled;
  distortPerspectiveButton.disabled = peersDisabled;
  transformControls.setDisabled(!ready || refreshInFlight || editorMode !== "transform");
  const warpDisabled = !ready || refreshInFlight || editorMode !== "warp";
  warpPresetSelect.disabled = warpDisabled;
  warpPicker.sync();
  const warpAmountDisabled = warpDisabled || warpPresetSelect.value === "";
  warpAmountSlider.disabled = warpAmountDisabled;
  warpAmountInput.disabled = warpAmountDisabled;
  warpMeshContinue.disabled = warpDisabled;
  rectifyWidthInput.disabled = !ready || refreshInFlight || editorMode !== "rectify";
  rectifyHeightInput.disabled = !ready || refreshInFlight || editorMode !== "rectify";
  renderOutputPolicy();
  resetButton.textContent = translate(activeLocale, phase === "resetting" ? "resetting" : "reset");
  // Keep each action's meaning visible while publishing. A new copy must not
  // make the disabled Update button announce that the old result is replaced.

  controls.setAttribute(
    "aria-busy",
    String(
      phase === "loading" || phase === "applying" || refreshInFlight || blockingCompose,
    ),
  );
  for (const field of controls.querySelectorAll<HTMLInputElement>('input[type="number"]')) {
    historyInputValues.set(field, field.value);
  }
}

function clearError(): void {
  visibleError = undefined;
  if (errorMessage.hidden) return;
  errorText.textContent = "";
  errorMessage.hidden = true;
}

function showError(error: unknown): void {
  const message = messageFromError(error, "unexpectedError");
  if (!errorMessage.hidden && sameMessage(visibleError, message)) {
    setStatus();
    return;
  }
  visibleError = message;
  errorText.textContent = translate(activeLocale, message);
  errorMessage.hidden = false;
  setStatus();
}

function setStatus(message?: UserMessage): void {
  visibleStatus = message;
  const text = message ? translate(activeLocale, message) : "";
  if (statusMessage.textContent === text) return;
  statusMessage.textContent = text;
}

function applyLocale(preference: LocalePreference, locale: SupportedLocale): void {
  nativeRecoverButton.textContent = translate(locale, "restoreEditable");
  localePreference = preference;
  activeLocale = locale;
  labelWindowGrip();
  document.documentElement.lang = locale;
  document.body.dataset.i18nReady = "true";
  localizeIconAction(moreOptionsButton, translate(locale, "moreOptions"));
  settingsPopover.setAttribute("aria-label", translate(locale, "moreOptions"));
  perspectiveOptionsTitle.textContent = translate(locale, "perspectiveOptions");
  modeSwitch.setAttribute("aria-label", translate(locale, "modeGroupLabel"));
  distortKind.setAttribute("aria-label", translate(locale, "distortGroupLabel"));
  outputSettingsTitle.textContent = translate(locale, "outputPixels");
  outputPolicyFitLabel.textContent = translate(locale, "outputFitFigma");
  outputPolicyFitDetail.textContent = translate(locale, "outputFitFigmaDetail");
  outputPolicyOriginalLabel.textContent = translate(locale, "outputKeepOriginal");
  outputPolicyOriginalDetail.textContent = translate(locale, "outputKeepOriginalDetail");
  settingsTitle.textContent = translate(locale, "language");
  localeSystem.textContent = translate(locale, "languageSystem");
  localeSystemDetail.textContent = translate(locale, "languageSystemDetail");
  localeEnglish.textContent = translate(locale, "languageEnglish");
  localeChinese.textContent = translate(locale, "languageChinese");
  localeView.applyCheckedState(preference);
  modeTransformButton.textContent = translate(locale, "modeTransform");
  modeDistortButton.textContent = translate(locale, "modeDistort");
  modeWarpButton.textContent = translate(locale, "modeWarp");
  modeRectifyButton.textContent = translate(locale, "modeRectify");
  distortFreeButton.textContent = translate(locale, "distortFree");
  distortPerspectiveButton.textContent = translate(locale, "distortPerspective");
  scaleXLabel.textContent = translate(locale, "scaleX");
  scaleYLabel.textContent = translate(locale, "scaleY");
  rotationLabel.textContent = translate(locale, "rotation");
  skewXLabel.textContent = translate(locale, "skewX");
  skewYLabel.textContent = translate(locale, "skewY");
  warpPresetLabel.textContent = translate(locale, "warpPreset");
  warpAmountLabel.textContent = translate(locale, "warpAmount");
  warpMeshContinue.textContent = translate(locale, "meshContinue");
  rectifyWidthLabel.textContent = translate(locale, "rectifyWidth");
  rectifyHeightLabel.textContent = translate(locale, "rectifyHeight");
  const noneOption = warpPresetSelect.querySelector<HTMLOptionElement>('option[value=""]');
  if (noneOption) noneOption.textContent = translate(locale, "warpNone");
  for (const preset of WARP_PRESETS) {
    const option = warpPresetSelect.querySelector<HTMLOptionElement>(`option[value="${preset}"]`);
    if (option) option.textContent = translate(locale, warpPresetMessageKey(preset));
  }
  transformActions.setAttribute("aria-label", translate(locale, "transformActions"));
  localizeIconAction(actionFlipX, translate(locale, "flipHorizontal"));
  localizeIconAction(actionFlipY, translate(locale, "flipVertical"));
  localizeIconAction(actionRotateCw, translate(locale, "rotateQuarterCw"));
  localizeIconAction(actionCopyParameters, translate(locale, "copyParameters"));
  actionCopyCss.textContent = translate(locale, "copyCss");
  actionTransformAgain.textContent = translate(locale, "transformAgain");
  workspaceNavigation.setLabels(translate(locale, "workspaceGroupLabel"), {
    perspective: translate(locale, "workspacePerspective"),
    templates: translate(locale, "workspaceTemplates"),
    canvas: translate(locale, "canvasTitle"),
    spatial: translate(locale, "workspaceSpatial"),
    mockup: translate(locale, "workspaceMockup"),
    mesh: translate(locale, "workspaceMesh"),
    surface: translate(locale, "workspaceSurface"),
    remap: translate(locale, "workspaceRemap"),
    appearance: translate(locale, "workspaceAppearance"),
    card: translate(locale, "workspaceCard"),
    presets: translate(locale, "workspacePresets"),
  }, translate(locale, "previousTools"), translate(locale, "nextTools"));
  modeBackward.setAttribute("aria-label", translate(locale, "previousModes"));
  modeForward.setAttribute("aria-label", translate(locale, "nextModes"));
  actionApplyCopy.textContent = translate(locale, "createHighResolutionImage");
  actionApplyEditable.textContent = translate(locale, "applyEditable");
  actionApplyVector.textContent = translate(locale, "applyNativeVector");
  openEffectListing.textContent = translate(locale, "openEffectListing");
  shortcutHelp.textContent = translate(locale, "shortcutHelp");
  errorDismiss.setAttribute("aria-label", translate(locale, "dismissError"));
  placementLabel.textContent = translate(locale, "placement");
  placementClose.setAttribute("aria-label", translate(locale, "closePlacement"));
  pivotLabel.textContent = translate(locale, "referencePoint");
  pivotPicker.setLabelFormatter((button) => translate(locale, pivotLabelKey(button)));
  positionXLabel.textContent = translate(locale, "positionX");
  positionYLabel.textContent = translate(locale, "positionY");
  editor?.setCornerLabelFormatter(localizedCornerLabel);
  editor?.setTransformHandleLabelFormatter(localizedTransformHandleLabel);
  editor?.setTransformSurfaceLabel(translate(locale, "transformSurfaceLabel"));
  editor?.setTransformPivotLabel(translate(locale, "transformPivotLabel"));
  renderSelectionMessage();
  if (visibleError) errorText.textContent = translate(locale, visibleError);
  if (visibleStatus) statusMessage.textContent = translate(locale, visibleStatus);
  renderMode();
  renderState();
}

function canvasWorkspaceCopy(): CanvasWorkspaceCopy {
  return {
    workspaceLabel: translate(activeLocale, "canvasTitle"),
    previewLabel: translate(activeLocale, "canvasPreview"),
    back: translate(activeLocale, "canvasBack"),
    title: translate(activeLocale, "canvasTitle"),
    addVariant: translate(activeLocale, "addCanvasVariant"),
    removeVariant: translate(activeLocale, "removeCanvasVariant"),
    templateName: translate(activeLocale, "templateName"),
    templateNamePlaceholder: translate(activeLocale, "templateNamePlaceholder"),
    saveTemplate: translate(activeLocale, "saveTemplate"),
    savingTemplate: translate(activeLocale, "savingTemplate"),
    templateSaved: translate(activeLocale, "templateSaved"),
    outputName: translate(activeLocale, "canvasOutputName"),
    operation: translate(activeLocale, "canvasOperation"),
    crop: translate(activeLocale, "canvasCrop"),
    trim: translate(activeLocale, "canvasTrim"),
    pad: translate(activeLocale, "canvasPad"),
    width: translate(activeLocale, "rectifyWidth"),
    height: translate(activeLocale, "rectifyHeight"),
    contain: translate(activeLocale, "fitContain"),
    cover: translate(activeLocale, "fitCover"),
    stretch: translate(activeLocale, "canvasStretch"),
    x: translate(activeLocale, "positionX"),
    y: translate(activeLocale, "positionY"),
    threshold: translate(activeLocale, "canvasThreshold"),
    top: translate(activeLocale, "pivotTop"),
    right: translate(activeLocale, "pivotRight"),
    bottom: translate(activeLocale, "pivotBottom"),
    left: translate(activeLocale, "pivotLeft"),
    anchor: translate(activeLocale, "canvasAnchor"),
    background: translate(activeLocale, "canvasBackground"),
    transparent: translate(activeLocale, "transparent"),
    solid: translate(activeLocale, "solidColor"),
    reset: translate(activeLocale, "reset"),
    apply: translate(activeLocale, "apply"),
    applyVariants: translate(activeLocale, "applyCanvasVariants"),
    replace: translate(activeLocale, "replace"),
    applyNew: translate(activeLocale, "applyAsCopy"),
    planning: translate(activeLocale, "canvasPlanning"),
    applying: translate(activeLocale, "applying"),
    applied: translate(activeLocale, "canvasApplied"),
    invalid: translate(activeLocale, "invalidCanvas"),
    invalidName: translate(activeLocale, "invalidCanvasName"),
    duplicateName: translate(activeLocale, "duplicateCanvasName"),
    anchors: [
      translate(activeLocale, "cornerTopLeft"),
      translate(activeLocale, "pivotTop"),
      translate(activeLocale, "cornerTopRight"),
      translate(activeLocale, "pivotLeft"),
      translate(activeLocale, "pivotCenter"),
      translate(activeLocale, "pivotRight"),
      translate(activeLocale, "cornerBottomLeft"),
      translate(activeLocale, "pivotBottom"),
      translate(activeLocale, "cornerBottomRight"),
    ],
  };
}

function designerCopy(title: MessageKey) {
  return {
    back: translate(activeLocale, "canvasBack"),
    title: translate(activeLocale, title),
    reset: translate(activeLocale, "reset"),
    apply: translate(activeLocale, "apply"),
    applyNew: translate(activeLocale, "applyAsCopy"),
    update: translate(activeLocale, "updateLinkedImage"),
    applying: translate(activeLocale, "applying"),
    applied: translate(activeLocale, "designerApplied"),
    outputLabel:translate(activeLocale,"outputFormat"),vectorOutput:translate(activeLocale,"outputVector"),imageOutput:translate(activeLocale,"outputImage"),
    vectorApply:translate(activeLocale,"applyNativeVector"),vectorUpdate:translate(activeLocale,"updateNativeVector"),
  };
}

function spatialWorkspaceCopy(): SpatialWorkspaceCopy {
  return {
    ...designerCopy("spatialTitle"),
    width: translate(activeLocale, "rectifyWidth"),
    height: translate(activeLocale, "rectifyHeight"),
    sourceForRole: translate(activeLocale, "spatialSourceForRole"),
    background: translate(activeLocale, "spatialBackground"),
    middle: translate(activeLocale, "spatialMiddle"),
    foreground: translate(activeLocale, "spatialForeground"),
    distance: translate(activeLocale, "spatialDistance"),
    focalLength: translate(activeLocale, "spatialFocalLength"),
    travel: translate(activeLocale, "spatialTravel"),
    convergence: translate(activeLocale, "spatialConvergence"),
    opticalFocus: translate(activeLocale, "spatialOpticalFocus"),
    depthOfField: translate(activeLocale, "spatialDepthOfField"),
    focusRange: translate(activeLocale, "spatialFocusRange"),
    blurRadius: translate(activeLocale, "spatialBlurRadius"),
    motionBlur: translate(activeLocale, "spatialMotionBlur"),
    exposure: translate(activeLocale, "spatialExposure"),
    motionRadius: translate(activeLocale, "spatialMotionRadius"),
    previewX: translate(activeLocale, "spatialPreviewX"),
    previewY: translate(activeLocale, "spatialPreviewY"),
    reducedMotion: translate(activeLocale, "spatialReducedMotion"),
    dragPreview: translate(activeLocale, "spatialDragPreview"),
    previewHelp: translate(activeLocale, "previewHelp"),
    agentDraft: translate(activeLocale, "spatialAgentDraft"),
    invalidControls: translate(activeLocale, "spatialInvalidControls"),
  };
}

function openNativeEffectListing(): void {
  post({ type: "open-native-effect-listing" });
  setStatus(userMessage("effectListingOpening"));
}

function meshWorkspaceCopy(): MeshWorkspaceCopy {
  return {
    fitCorners:translate(activeLocale,"fitCorners"),fitAutomatic:translate(activeLocale,"fitAutomatic"),fitPerimeter:translate(activeLocale,"fitPerimeter"),
    fitCornerNames:[translate(activeLocale,"cornerTopLeft"),translate(activeLocale,"cornerTopRight"),translate(activeLocale,"cornerBottomRight"),translate(activeLocale,"cornerBottomLeft")],
    ...designerCopy("meshTitle"),
    apply: translate(activeLocale, "createLinkedImage"),
    applyNew: translate(activeLocale, "createLinkedImage"),
    update: translate(activeLocale, "updateLinkedImage"),
    subdivisions: translate(activeLocale, "meshSubdivisions"),
    densityLocked: translate(activeLocale, "deformationDensityLocked"),
    boundaryLabel: translate(activeLocale, "deformationBoundary"),
    boundaryFixed: translate(activeLocale, "deformationBoundaryFixed"),
    boundaryFree: translate(activeLocale, "deformationBoundaryFree"),
    pointLabel: translate(activeLocale, "meshPointLabel"),
    templateName: translate(activeLocale, "templateName"),
    templateNamePlaceholder: translate(activeLocale, "templateNamePlaceholder"),
    saveTemplate: translate(activeLocale, "saveTemplate"),
    savingTemplate: translate(activeLocale, "savingTemplate"),
    templateSaved: translate(activeLocale, "templateSaved"),
  };
}

function surfaceWorkspaceCopy(): SurfaceWorkspaceCopy {
  return {
    ...designerCopy("surfaceTitle"),
    apply: translate(activeLocale, "createLinkedImage"),
    applyNew: translate(activeLocale, "createLinkedImage"),
    update: translate(activeLocale, "updateLinkedImage"),
    patches: translate(activeLocale, "surfacePatches"),
    subdivisions: translate(activeLocale, "surfaceSubdivisions"),
    densityLocked: translate(activeLocale, "deformationDensityLocked"),
    boundaryLabel: translate(activeLocale, "deformationBoundary"),
    boundaryFixed: translate(activeLocale, "deformationBoundaryFixed"),
    boundaryFree: translate(activeLocale, "deformationBoundaryFree"),
    pointLabel: translate(activeLocale, "surfacePointLabel"),
    handles: translate(activeLocale, "surfaceHandles"),
    pin: translate(activeLocale, "surfacePin"),
    brush: translate(activeLocale, "surfaceBrush"),
    liquify: translate(activeLocale, "surfaceLiquify"),
    liquifyPush: translate(activeLocale, "liquifyPush"),
    liquifyBloat: translate(activeLocale, "liquifyBloat"),
    liquifyPucker: translate(activeLocale, "liquifyPucker"),
    liquifyTwirl: translate(activeLocale, "liquifyTwirl"),
    radius: translate(activeLocale, "surfaceRadius"),
    strength: translate(activeLocale, "surfaceStrength"),
    splitRequired: translate(activeLocale, "surfaceSplitRequired"),
    pinDensity: translate(activeLocale, "surfacePinDensity"),
    pinLimit: translate(activeLocale, "surfacePinLimit"),
    strokeLimit: translate(activeLocale, "surfaceStrokeLimit"),
    brushLimit: translate(activeLocale, "surfaceBrushLimit"),
    strokeSampleLimit: translate(activeLocale, "surfaceStrokeSampleLimit"),
    liquifyStrokeLimit: translate(activeLocale, "liquifyStrokeLimit"),
    liquifyLimit: translate(activeLocale, "liquifyLimit"),
    liquifyStrokeSampleLimit: translate(activeLocale, "liquifyStrokeSampleLimit"),
    pinLabel: translate(activeLocale, "surfacePinLabel"),
    templateName: translate(activeLocale, "templateName"),
    templateNamePlaceholder: translate(activeLocale, "templateNamePlaceholder"),
    saveTemplate: translate(activeLocale, "saveTemplate"),
    savingTemplate: translate(activeLocale, "savingTemplate"),
    templateSaved: translate(activeLocale, "templateSaved"),
  };
}

function mockupWorkspaceCopy(): MockupWorkspaceCopy {
  return {
    backdrop: translate(activeLocale, "placeOnBackdrop"),
    fitToQuad: translate(activeLocale, "fitToQuad"),
    fitToShape: translate(activeLocale, "fitToShape"),
    bendToShape: translate(activeLocale,"bendToShape"),
    fittingDomain:translate(activeLocale,"fittingDomain"),
    fittingShape:translate(activeLocale,"fittingShape"),
    nativeOutline:translate(activeLocale,"nativeOutline"),
    convexEnvelope:translate(activeLocale,"convexEnvelope"),
    boundsClip:translate(activeLocale,"boundsClip"),
    ...designerCopy("mockupTitle"),
    sceneAnimation:translate(activeLocale,"mockupSceneAnimation"),sceneAnimationCancel:translate(activeLocale,"mockupSceneAnimationCancel"),sceneAnimationSave:translate(activeLocale,"mockupSceneAnimationSave"),
    motion:{title:translate(activeLocale,"mockupAnimation"),enable:translate(activeLocale,"mockupAnimate"),play:translate(activeLocale,"mockupPlay"),pause:translate(activeLocale,"mockupPause"),position:translate(activeLocale,"mockupPosition"),duration:translate(activeLocale,"mockupDuration"),capture:translate(activeLocale,"mockupCapturePose"),remove:translate(activeLocale,"mockupRemovePose"),easing:translate(activeLocale,"mockupEasing"),linear:translate(activeLocale,"mockupLinear"),smooth:translate(activeLocale,"mockupSmooth"),hold:translate(activeLocale,"mockupHold"),reduced:translate(activeLocale,"mockupReducedMotion")},
    agentDraft: translate(activeLocale, "mockupAgentDraft"),
    agentDraftUnavailable: translate(activeLocale, "mockupAgentDraftUnavailable"),
    agentDraftUnavailableWithEdits: translate(activeLocale, "mockupAgentDraftUnavailableWithEdits"),
    agentConflict: translate(activeLocale, "mockupAgentConflict"),
    reviewAgent: translate(activeLocale, "mockupReviewAgent"),
    keepMine: translate(activeLocale, "mockupKeepMine"),
    keepingMine: translate(activeLocale, "mockupKeepingMine"),
    editTarget: translate(activeLocale, "mockupEditTarget"),
    editLayers: translate(activeLocale, "mockupEditLayers"),
    editWhole: translate(activeLocale, "mockupEditWhole"),
    wholeWidth: translate(activeLocale, "rectifyWidth"),
    wholeHeight: translate(activeLocale, "rectifyHeight"),
    wholeCorners: translate(activeLocale, "mockupWholeCorners"),
    wholeCorner: translate(activeLocale, "mockupWholeCorner"),
    warp: translate(activeLocale, "modeWarp"),
    warpNone: translate(activeLocale, "warpNone"),
    warpPresets: (["warpArc", "warpArch", "warpFlag", "warpWave", "warpFish", "warpRise", "warpFisheye", "warpInflate", "warpSqueeze", "warpTwist"] satisfies MessageKey[]).map(key => translate(activeLocale, key)),
    warpAmount: translate(activeLocale, "warpAmount"),
    invalidWarp: translate(activeLocale, "invalidWarp"),
    surface: translate(activeLocale,"mockupSurface"), surfaceNone:translate(activeLocale,"mockupSurfaceNone"),
    cylinder:translate(activeLocale,"mockupCylinder"), fabric:translate(activeLocale,"mockupFabric"),
    surfaceWrap:translate(activeLocale,"mockupSurfaceWrap"), surfaceDepth:translate(activeLocale,"mockupSurfaceDepth"),
    surfaceTilt:translate(activeLocale,"mockupSurfaceTilt"), surfaceFolds:translate(activeLocale,"mockupSurfaceFolds"),
    surfacePhase:translate(activeLocale,"mockupSurfacePhase"), surfaceLight:translate(activeLocale,"mockupSurfaceLight"),
    surfaceLightStrength:translate(activeLocale,"mockupSurfaceLightStrength"), surfaceLightDirection:translate(activeLocale,"mockupSurfaceLightDirection"),
    invalidSurface:translate(activeLocale,"mockupInvalidSurface"),
    shadow:translate(activeLocale,"mockupShadow"),shadowOpacity:translate(activeLocale,"mockupShadowOpacity"),shadowBlur:translate(activeLocale,"mockupShadowBlur"),shadowX:translate(activeLocale,"mockupShadowX"),shadowY:translate(activeLocale,"mockupShadowY"),shadowColor:translate(activeLocale,"mockupShadowColor"),invalidShadow:translate(activeLocale,"mockupInvalidShadow"),
    outputMode: translate(activeLocale, "mockupOutputMode"),
    outputSingle: translate(activeLocale, "mockupOutputSingle"),
    outputVariants: translate(activeLocale, "mockupOutputVariants"),
    addVariant: translate(activeLocale, "addCanvasVariant"),
    removeVariant: translate(activeLocale, "removeCanvasVariant"),
    outputName: translate(activeLocale, "canvasOutputName"),
    outputOperation: translate(activeLocale, "canvasOperation"),
    crop: translate(activeLocale, "canvasCrop"),
    contain: translate(activeLocale, "fitContain"),
    cover: translate(activeLocale, "fitCover"),
    stretch: translate(activeLocale, "canvasStretch"),
    cropX: translate(activeLocale, "positionX"),
    cropY: translate(activeLocale, "positionY"),
    outputWidth: translate(activeLocale, "rectifyWidth"),
    outputHeight: translate(activeLocale, "rectifyHeight"),
    width: translate(activeLocale, "rectifyWidth"),
    height: translate(activeLocale, "rectifyHeight"),
    opacity: translate(activeLocale, "mockupOpacity"),
    grid: translate(activeLocale, "mockupGrid"),
    columns: translate(activeLocale, "mockupColumns"),
    rows: translate(activeLocale, "mockupRows"),
    corner: translate(activeLocale, "mockupCorner"),
    templateName: translate(activeLocale, "templateName"),
    templateNamePlaceholder: translate(activeLocale, "templateNamePlaceholder"),
    saveTemplate: translate(activeLocale, "saveTemplate"),
    saveScene: translate(activeLocale, "saveScene"),
    sceneSizes: translate(activeLocale, "sceneSizes"),
    scenePreviewUnavailable: translate(activeLocale, "scenePreviewUnavailable"),
    retryScenePreview: translate(activeLocale, "retryScenePreview"),
    savingTemplate: translate(activeLocale, "savingTemplate"),
    templateSaved: translate(activeLocale, "templateSaved"),
    copyParameters: translate(activeLocale, "copyParameters"),
    parametersCopied: translate(activeLocale, "parametersCopied"),
    copyParametersFailed: translate(activeLocale, "copyParametersFailed"),
  };
}

function templateWorkspaceCopy(): TemplateWorkspaceCopy {
  return {
    ...designerCopy("templateTitle"),
    empty: translate(activeLocale, "templateEmpty"),
    create: translate(activeLocale, "templateCreate"),
    use: translate(activeLocale, "templateUse"),
    remove: translate(activeLocale, "templateRemove"),
    confirmRemove: translate(activeLocale, "templateConfirmRemove"),
    sourceCount: translate(activeLocale, "templateSourceCount"),
    scene: translate(activeLocale, "templateScene"),
    artworkFit: translate(activeLocale, "templateArtworkFit"),
    cover: translate(activeLocale, "templateCover"),
    contain: translate(activeLocale, "templateContain"),
    outputCount: translate(activeLocale, "templateOutputCount"),
    noSceneAppearance: translate(activeLocale, "templateNoSceneAppearance"),
    incompatible: translate(activeLocale, "templateIncompatible"),
    mockup: translate(activeLocale, "workspaceMockup"),
    sizes: translate(activeLocale, "canvasTitle"),
    mesh: translate(activeLocale, "templateMesh"),
    surface: translate(activeLocale, "templateSurface"),
    createCanvas: translate(activeLocale, "templateCreateCanvas"),
  };
}

function remapWorkspaceCopy(): RemapWorkspaceCopy {
  return {
    ...designerCopy("remapTitle"),
    mode: translate(activeLocale, "remapMode"),
    lens: translate(activeLocale, "remapLens"),
    displacement: translate(activeLocale, "remapDisplacement"),
    width: translate(activeLocale, "rectifyWidth"),
    height: translate(activeLocale, "rectifyHeight"),
    k1: translate(activeLocale, "remapK1"), k2: translate(activeLocale, "remapK2"),
    k3: translate(activeLocale, "remapK3"), p1: translate(activeLocale, "remapP1"),
    p2: translate(activeLocale, "remapP2"), more: translate(activeLocale, "more"),
    centerX: translate(activeLocale, "remapCenterX"), centerY: translate(activeLocale, "remapCenterY"),
    scaleX: translate(activeLocale, "remapScaleX"), scaleY: translate(activeLocale, "remapScaleY"),
    xChannel: translate(activeLocale, "remapXChannel"), yChannel: translate(activeLocale, "remapYChannel"),
    neutral: translate(activeLocale, "remapNeutral"), boundary: translate(activeLocale, "remapBoundary"),
    red: translate(activeLocale, "remapRed"), green: translate(activeLocale, "remapGreen"),
    blue: translate(activeLocale, "remapBlue"), alpha: translate(activeLocale, "remapAlpha"),
    luminance: translate(activeLocale, "remapLuminance"), transparent: translate(activeLocale, "transparent"),
    clamp: translate(activeLocale, "remapClamp"), wrap: translate(activeLocale, "remapWrap"),
    mapRequired: translate(activeLocale, "remapMapRequired"),
  };
}

function appearanceWorkspaceCopy(): AppearanceWorkspaceCopy {
  return {
    ...designerCopy("appearanceTitle"),
    apply: translate(activeLocale, "appearanceApplyToSelection"),
    allMaterials: translate(activeLocale, "materialAll"),
    tune: translate(activeLocale, "materialTune"),
    cancel: translate(activeLocale, "materialCancel"),
    saveVariation: translate(activeLocale, "materialSaveVariation"),
    remove: translate(activeLocale, "materialRemove"),
    libraryError: translate(activeLocale, "materialLibraryError"),
    trialReady: translate(activeLocale, "materialTrialReady"),
    trialInWindow: translate(activeLocale, "materialTrialInWindow"),
    trialLoading: translate(activeLocale, "materialTrialLoading"),
    trialFailed: translate(activeLocale, "materialTrialFailed"),
    variationName: translate(activeLocale, "materialVariationName"),
    mixed: translate(activeLocale, "materialMixed"),
    edited: translate(activeLocale, "materialEdited"),
    deleteLook: translate(activeLocale, "materialDeleteLook"),
    closeTuning: translate(activeLocale, "materialCloseTuning"),
    artworkPreview: translate(activeLocale, "materialArtworkPreview"),
    controlGroups: {optics:translate(activeLocale,"materialOptics"), lighting:translate(activeLocale,"materialLighting"), grain:translate(activeLocale,"materialGrain"), etching:translate(activeLocale,"materialEtching"), display:translate(activeLocale,"materialDisplay"),motion:translate(activeLocale,"foilMotion"),corners:translate(activeLocale,"materialCorners"),surface:translate(activeLocale,"materialSurface")},
    glassFamily: translate(activeLocale, "appearanceGlassFamily"),
    textureFamily: translate(activeLocale, "appearanceTextureFamily"),
    foilFamily:translate(activeLocale,'foilFamily'),foilUnavailable:translate(activeLocale,'foilUnavailable'),
    foilUnverified:translate(activeLocale,'foilUnverified'),foilLegacy:translate(activeLocale,'foilLegacy'),foilMultiple:translate(activeLocale,'foilMultiple'),
    foilLocked:translate(activeLocale,'foilLocked'),foilInvalid:translate(activeLocale,'foilInvalid'),foilNoFills:translate(activeLocale,'foilNoFills'),
    foilAdopt:translate(activeLocale,'foilAdopt'),foilAdoptNote:translate(activeLocale,'foilAdoptNote'),foilOpacity:translate(activeLocale,'foilOpacity'),
    meshGradientFamily:translate(activeLocale,'meshGradientFamily'),meshGradientUnavailable:translate(activeLocale,'meshGradientUnavailable'),
    meshGradientUnverified:translate(activeLocale,'meshGradientUnverified'),meshGradientLegacy:translate(activeLocale,'meshGradientLegacy'),meshGradientMultiple:translate(activeLocale,'meshGradientMultiple'),
    meshGradientLocked:translate(activeLocale,'meshGradientLocked'),meshGradientInvalid:translate(activeLocale,'meshGradientInvalid'),meshGradientNoFills:translate(activeLocale,'meshGradientNoFills'),
    meshGradientAdopt:translate(activeLocale,'meshGradientAdopt'),meshGradientAdoptNote:translate(activeLocale,'meshGradientAdoptNote'),meshGradientOpacity:translate(activeLocale,'meshGradientOpacity'),
    meshGradientFieldNames:{visible:translate(activeLocale,'appearanceVisible'),'color-tl':translate(activeLocale,'meshGradientColorTl'),
      'color-tr':translate(activeLocale,'meshGradientColorTr'),'color-bl':translate(activeLocale,'meshGradientColorBl'),'color-br':translate(activeLocale,'meshGradientColorBr'),
      warp:translate(activeLocale,'meshGradientWarp'),softness:translate(activeLocale,'meshGradientSoftness'),'duration-ms':translate(activeLocale,'meshGradientDuration'),
      'phase-ms':translate(activeLocale,'meshGradientPhase'),'flow-speed':translate(activeLocale,'meshGradientFlow')},
    foilFieldNames:{visible:translate(activeLocale,'appearanceVisible'),'base-color':translate(activeLocale,'foilBaseColor'),
      'highlight-color':translate(activeLocale,'foilHighlightColor'),'light-angle':translate(activeLocale,'appearanceLightAngle'),
      intensity:translate(activeLocale,'foilIntensity'),roughness:translate(activeLocale,'foilRoughness'),'flow-speed':translate(activeLocale,'foilFlowSpeed')},
    applied: translate(activeLocale, "appearanceApplied"),
    recipeNames: {
      "clear-lens": translate(activeLocale, "appearanceClearLens"),
      "frosted-panel": translate(activeLocale, "appearanceFrostedPanel"),
      "prism-edge": translate(activeLocale, "appearancePrismEdge"),
      "warm-paper": translate(activeLocale, "textureWarmPaper"),
      "etched-card": translate(activeLocale, "textureEtchedCard"),
      "frosted-plastic": translate(activeLocale, "textureFrostedPlastic"),
      "warm-foil":translate(activeLocale,"foilWarm"),"silver-foil":translate(activeLocale,"foilSilver"),"rose-foil":translate(activeLocale,"foilRose"),
      "soft-fluid":translate(activeLocale,"meshGradientSoftFluid"),"dawn-wash":translate(activeLocale,"meshGradientDawnWash"),"night-current":translate(activeLocale,"meshGradientNightCurrent"),
    },
    visible: translate(activeLocale, "appearanceVisible"),
    clipToShape: translate(activeLocale, "textureClipToShape"),
    applyToSelection: translate(activeLocale, "appearanceApplyToSelection"),
    selectionEmpty: translate(activeLocale, "appearanceSelectionEmpty"),
    selectionSummary: translate(activeLocale, "appearanceSelectionSummary"),
    untagged: translate(activeLocale, "appearanceUntagged"),
    absent: translate(activeLocale, "appearanceAbsent"),
    customizedFields: translate(activeLocale, "appearanceCustomizedFields"),
    removedGlass: translate(activeLocale, "appearanceRemovedGlass"),
    multipleGlass: translate(activeLocale, "appearanceMultipleGlass"),
    noEffects: translate(activeLocale, "appearanceNoEffects"),
    previewNote: translate(activeLocale, "appearancePreviewNote"),
    retryPreview: translate(activeLocale, "appearanceRetryPreview"),
    previewHelp: translate(activeLocale, "previewHelp"),
    opaqueFill: translate(activeLocale, "appearanceOpaqueFill"),
    backgroundBlur: translate(activeLocale, "appearanceBackgroundBlur"),
    invalidGlass: translate(activeLocale, "appearanceInvalidGlass"),
    fieldNames: {
      visible: translate(activeLocale, "appearanceVisible"),
      "light-intensity": translate(activeLocale, "appearanceLightIntensity"),
      "light-angle": translate(activeLocale, "appearanceLightAngle"),
      refraction: translate(activeLocale, "appearanceRefraction"),
      depth: translate(activeLocale, "appearanceDepth"),
      dispersion: translate(activeLocale, "appearanceDispersion"),
      radius: translate(activeLocale, "appearanceRadius"),
    },
    textureUntagged: translate(activeLocale, "textureUntagged"),
    textureAbsent: translate(activeLocale, "textureAbsent"),
    textureRemovedTexture: translate(activeLocale, "textureRemovedTexture"),
    textureMultipleNoise: translate(activeLocale, "textureMultipleNoise"),
    textureMultipleTexture: translate(activeLocale, "textureMultipleTexture"),
    textureInvalidTexture: translate(activeLocale, "textureInvalidTexture"),
    textureFieldNames: {
      visible: translate(activeLocale, "appearanceVisible"),
      grain: translate(activeLocale, "textureGrain"),
      "grain-size": translate(activeLocale, "textureGrainSize"),
      "grain-color": translate(activeLocale, "textureGrainColor"),
      etch: translate(activeLocale, "textureEtch"),
      "etch-size": translate(activeLocale, "textureEtchSize"),
      "clip-to-shape": translate(activeLocale, "textureClipToShape"),
    },
  };
}

function cardWorkspaceCopy(): CardWorkspaceCopy {
  const t = (key: MessageKey): string => translate(activeLocale, key);
  return {
    title: t("cardTitle"),
    reset: t("reset"),
    apply: t("cardApply"),
    applying: t("applying"),
    applied: t("designerApplied"),
    selectionEmpty: t("cardSelectionEmpty"),
    selectionSummary: t("cardSelectionSummary"),
    helpTitle: t("cardHelpTitle"),
    helpBody: t("cardHelpBody"),
    poseGroup: t("cardPoseGroup"),
    envelopeGroup: t("cardEnvelopeGroup"),
    actionGroup: t("cardActionGroup"),
    idleGroup: t("cardIdleGroup"),
    rotateX: t("cardRotateX"),
    rotateY: t("cardRotateY"),
    rotateZ: t("cardRotateZ"),
    perspective: t("cardPerspective"),
    pivotX: t("cardPivotX"),
    pivotY: t("cardPivotY"),
    maxTiltX: t("cardMaxTiltX"),
    maxTiltY: t("cardMaxTiltY"),
    axis: t("cardAxis"),
    axisX: t("cardAxisX"),
    axisY: t("cardAxisY"),
    direction: t("cardDirection"),
    forward: t("cardForward"),
    reverse: t("cardReverse"),
    turns: t("cardTurns"),
    duration: t("cardDuration"),
    easing: t("cardEasing"),
    smooth: t("cardSmooth"),
    constant: t("cardConstant"),
    stepAtEnd: t("cardStepAtEnd"),
    customCurve: t("cardCustomCurve"),
    idleOn: t("cardIdleOn"),
    idleAmplitudeX: t("cardIdleAmplitudeX"),
    idleAmplitudeY: t("cardIdleAmplitudeY"),
    idlePeriod: t("cardIdlePeriod"),
    turn: t("cardTurn"),
    play: t("cardPlay"),
    pause: t("cardPause"),
    scrub: t("cardScrub"),
    live: t("cardLive"),
    scrubbing: t("cardScrubbing"),
    viewsGroup: t("cardViewsGroup"),
    viewRest: t("cardViewRest"),
    viewTilt: (role) => role,
    viewTurn: (angle) => `${t("cardTurn")} ${angle}°`,
    publish: t("cardPublish"),
    updateView: t("cardUpdateView"),
    saveCopy: t("cardSaveCopy"),
    publishing: t("applying"),
    edgeNote: t("cardEdgeNote"),
    outputLimit: t("cardOutputLimit"),
    densityShortfall: t("cardDensityShortfall"),
    front: t("cardFaceFront"),
    useSelectionAsBack: t("cardUseSelectionAsBack"),
    mirrorBack: t("cardMirrorBack"),
    rigApplied: t("cardRigApplied"),
    copyJson: t("cardCopyJson"),
    cancel: t("materialCancel"),
    precision: t("materialTune"),
    copiedJson: t("cardCopiedJson"),
    copyFailed: t("copyParametersFailed"),
    stillPublished: t("cardStillPublished"),
    stillFailed: t("cardStillFailed"),
    face: (value) => value === "front" ? t("cardFaceFront") : value === "back" ? t("cardFaceBack") : t("cardFaceEdge"),
    revolutions: (value) => t("cardRevolutions").replace("{value}", value.toFixed(2)),
  };
}

function localizeIconAction(button: HTMLButtonElement, label: string): void {
  button.setAttribute("aria-label", label);
  const tooltip = button.querySelector<HTMLElement>(".action-tooltip");
  if (tooltip) tooltip.textContent = label;
}

function localizedCornerLabel(
  corner: PerspectiveCorner,
  point: { x: number; y: number },
): string {
  const cornerKeys: Record<PerspectiveCorner, MessageKey> = {
    tl: "cornerTopLeft",
    tr: "cornerTopRight",
    br: "cornerBottomRight",
    bl: "cornerBottomLeft",
  };
  return translate(
    activeLocale,
    userMessage(editorMode === "rectify"
      ? "cornerLabel"
      : distortMode === "perspective"
        ? "cornerLabelPerspective"
        : "cornerLabelFree", {
      corner: translate(activeLocale, cornerKeys[corner]),
      x: formatPercent(activeLocale, point.x),
      y: formatPercent(activeLocale, point.y),
    }),
  );
}

function localizedTransformHandleLabel(handle: TransformHandle): string {
  const handleKeys: Record<TransformHandle, MessageKey> = {
    tl: "handleCornerTopLeft",
    tr: "handleCornerTopRight",
    br: "handleCornerBottomRight",
    bl: "handleCornerBottomLeft",
    top: "handleEdgeTop",
    right: "handleEdgeRight",
    bottom: "handleEdgeBottom",
    left: "handleEdgeLeft",
  };
  return translate(activeLocale, handleKeys[handle]);
}

function pivotLabelKey(button: HTMLButtonElement): MessageKey {
  const cornerKeys: Record<string, MessageKey> = {
    "0,0": "cornerTopLeft",
    "1,0": "cornerTopRight",
    "1,1": "cornerBottomRight",
    "0,1": "cornerBottomLeft",
    "0.5,0": "pivotTop",
    "1,0.5": "pivotRight",
    "0.5,1": "pivotBottom",
    "0,0.5": "pivotLeft",
    "0.5,0.5": "pivotCenter",
  };
  return cornerKeys[button.dataset.pivot ?? ""] ?? "pivotCenter";
}

function renderSelectionMessage(): void {
  const empty = selectionMessage.key === "selectOneSource";
  const loading = selectionMessage.key === "loadingSelection";
  const title: MessageKey = empty ? "selectionStart" : loading ? "loadingSelection" :
    selectionMessage.key === "webglRequired" ? "selectionUnavailable" : "selectionCheck";
  selectionState.dataset.state = empty ? "empty" : loading ? "loading" : "error";
  selectionState.setAttribute("role", empty || loading ? "status" : "alert");
  selectionTitle.textContent = translate(activeLocale, title);
  selectionDetail.textContent = translate(activeLocale, empty ? "selectionStartDetail" : selectionMessage);
  selectionDetail.hidden = loading;
  selectionContinue.textContent = translate(activeLocale, "selectionContinue");
  selectionContinue.hidden = !empty;
}

function closeLinkedResults(): void {
  linkedResultsPopover.hidden = true;
  linkedResultsTrigger.setAttribute("aria-expanded", "false");
}

function renderLinkedResults(): void {
  const linked = current?.targetNodeId ? undefined : current?.linkedResults;
  const unavailable = !current?.targetNodeId && current?.linkedResultsUnavailable;
  // A running batch keeps the popover open so its per-item outcomes and the
  // Stop action stay visible while rows refresh.
  if (!linkedBatchRun) closeLinkedResults();
  linkedResultsTrigger.hidden = !linked?.total && !unavailable;
  linkedResultsList.replaceChildren();
  if (unavailable) {
    linkedResultsTrigger.textContent = translate(activeLocale, "linkedResultsUnavailable");
    linkedResultsTitle.textContent = translate(activeLocale, "linkedResultsUnavailable");
    linkedResultsMore.hidden = false;
    linkedResultsMore.textContent = translate(activeLocale, "linkedResultsUnavailableHelp");
    return;
  }
  if (!linked?.total) return;
  const outcomes = linkedBatchRun
    ? linkedBatchRun.generation === activeGeneration ? linkedBatchRun.entries : undefined
    : linkedBatchReport;
  // Ordinary discovery stays compact; a batch must identify every outcome,
  // including failures beyond the first 32 rows, and offer the same reopen path.
  const results = linked.items.map(result => outcomes?.get(result.nodeId)?.result ?? result);
  const visibleIds = new Set(results.map(result => result.nodeId));
  for (const [id, outcome] of outcomes ?? []) {
    if (!visibleIds.has(id)) results.push(outcome.result);
  }
  linkedResultsTrigger.textContent = translate(activeLocale, userMessage("linkedResultsCount", { count: linked.total }));
  linkedResultsTitle.textContent = translate(activeLocale, "linkedResultsTitle");
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-option";
    button.setAttribute("role", "menuitem");
    const name = document.createElement("span");
    name.textContent = result.name;
    const detail = document.createElement("small");
    const batchSource = outcomes?.get(result.nodeId);
    const batchLabel = batchSource
      ? linkedBatchStatusLabel(batchSource.status)
      : "";
    const detailText = [
      batchLabel,
      batchSource?.reason ? translate(activeLocale, batchSource.reason) : undefined,
      translate(activeLocale, linkedResultKindLabel(result.kind)),
      result.position ? translate(activeLocale, userMessage("linkedResultPosition", result.position)) : undefined,
    ].filter(Boolean).join(" · ");
    detail.textContent = detailText;
    button.append(name, detail);
    button.title = [result.name, detailText].filter(Boolean).join(" · ");
    const currentSourceId = current!.sourceNodeId;
    button.addEventListener("click", () => {
      if (linkedBatchRun || linkedBatchPrepare) return;
      if (current?.sourceNodeId !== currentSourceId) return;
      closeLinkedResults();
      post({ type: "select-linked-result", generation: activeGeneration,
        sourceNodeId: currentSourceId, resultNodeId: result.nodeId });
    });
    linkedResultsList.append(button);
  }
  linkedResultsMore.hidden = linked.total <= results.length;
  linkedResultsMore.textContent = translate(activeLocale, "linkedResultsMore");
  renderLinkedBatchAction();
}

function renderLinkedBatchAction(): void {
  let action = linkedResultsPopover.querySelector<HTMLButtonElement>("#linked-batch-action");
  if (!linkedBatchRun && (!current?.linkedResults?.total || current?.targetNodeId)) {
    action?.remove();
    return;
  }
  if (!action) {
    action = document.createElement("button");
    action.type = "button";
    action.id = "linked-batch-action";
    action.className = "menu-option";
    linkedResultsPopover.append(action);
    action.addEventListener("click", () => void runLinkedBatch());
  }
  action.textContent = linkedBatchRun
    ? translate(activeLocale, linkedBatchRun.cancelled ? "batchStopping" : "batchStop")
    : translate(activeLocale, "batchUpdateAll");
  action.disabled = Boolean(linkedBatchPrepare);
}

function linkedResultButtons(): HTMLButtonElement[] {
  return Array.from(
    linkedResultsList.querySelectorAll<HTMLButtonElement>("button:not([disabled]):not([hidden])"),
  );
}

// One relationship-aware batch run over a source's linked results, per
// docs/BATCH_RESULTS_CONTRACT.md: sequential items, per-item outcome, and a
// stop that never interrupts an in-flight publication.
type LinkedBatchStatus = "pending" | "updating" | "updated" | "unsupported" | "failed" | "cancelled";
interface LinkedBatchRunState {
  generation: number;
  cancelled: boolean;
  completion?: ((message: MainToUiMessage) => void) | undefined;
  entries: Map<string, { result: NonNullable<SourcePayload["linkedResults"]>["items"][number];
    status: LinkedBatchStatus; reason?: UserMessage }>;
}
let linkedBatchRun: LinkedBatchRunState | undefined;
let linkedBatchPrepare: { generation: number; resolve: (message: MainToUiMessage) => void } | undefined;
/** One in-flight bound-source export of a multi-source batch item. */
let linkedBatchSourceRequest:
  | {
      generation: number;
      resultNodeId: string;
      nodeId: string;
      resolve: (message: Extract<MainToUiMessage, { type: "batch-source" | "batch-source-error" }>) => void;
    }
  | undefined;
/** The completed run's per-item outcomes, kept so the popover still reports them. */
let linkedBatchReport: LinkedBatchRunState["entries"] | undefined;
let linkedBatchNodeIds: ReadonlySet<string> = new Set();

const LINKED_BATCH_STEP_TIMEOUT_MS = 30_000;

async function runLinkedBatch(): Promise<void> {
  if (linkedBatchPrepare) return;
  if (linkedBatchRun) {
    linkedBatchRun.cancelled = true;
    renderLinkedResults();
    return;
  }
  const source = current;
  const generation = activeGeneration;
  const workspaceSource = meshWorkspace.currentSource() ?? surfaceWorkspace.currentSource();
  const first = workspaceSource?.sources[0];
  if (!source || source.targetNodeId || !source.linkedResults?.total || phase !== "ready" || !first?.image) return;
  const preparedMessage = await new Promise<MainToUiMessage>((resolve) => {
    const pending = { generation, resolve };
    linkedBatchPrepare = pending;
    renderLinkedBatchAction();
    post({ type: "prepare-linked-batch", generation });
    setTimeout(() => {
      if (linkedBatchPrepare === pending) {
        linkedBatchPrepare = undefined;
        resolve({ type: "linked-batch-error", generation, message: userMessage("unexpectedError") });
      }
    }, LINKED_BATCH_STEP_TIMEOUT_MS);
  });
  renderLinkedBatchAction();
  if (generation !== activeGeneration || current !== source) return;
  if (preparedMessage.type !== "linked-batch") {
    showError(preparedMessage.type === "linked-batch-error" ? preparedMessage.message : userMessage("unexpectedError"));
    return;
  }
  const run: LinkedBatchRunState = {
    generation,
    cancelled: false,
    entries: new Map(preparedMessage.items.map(item => [item.nodeId, { result: {
      nodeId: item.nodeId, name: Array.from(item.name).slice(0, 128).join(""),
      revision: item.revision, kind: item.kind,
      position: { x: Math.round(item.placement.x), y: Math.round(item.placement.y) },
    }, status: "pending" as const }])),
  };
  linkedBatchRun = run;
  linkedBatchNodeIds = new Set(preparedMessage.items.map((item) => item.nodeId));
  const renderer = createBatchRenderer();
  renderLinkedResults();
  try {
    for (const item of preparedMessage.items) {
      const entry = run.entries.get(item.nodeId)!;
      if (run.cancelled || generation !== activeGeneration || current !== source) {
        run.cancelled = true;
        entry.status = "cancelled";
        continue;
      }
      if (item.dependencyNodeIds?.some(id => run.entries.get(id)?.status !== "updated")) {
        entry.status = "failed";
        entry.reason = userMessage("batchDependencyBlocked");
        renderLinkedResults();
        continue;
      }
      const parsed = parseBatchOperation(item);
      if (parsed.status === "unsupported") {
        entry.status = "unsupported";
        continue;
      }
      if (parsed.status === "invalid") {
        entry.status = "failed";
        entry.reason = userMessage("linkedResultInvalid");
        continue;
      }
      entry.status = "updating";
      renderLinkedResults();
      try {
        let bytes: Uint8Array;
        let sourceNodeIds: string[] | undefined;
        if (parsed.operation.kind === "mockup" || parsed.operation.kind === "composition") {
          // Multi-source slice: resolve every bound source explicitly — the
          // selected raster from the live selection, the rest from fresh main
          // exports — then recompute the whole Mockup task from its plan.
          // A dependency places a republished local inside one of the bound
          // sources, so even the selected raster predates the pixels to sample.
          const boundIds = item.sourceNodeIds ?? [];
          const sources = new Map<string, TexImageSource>();
          for (let index = 0; index < boundIds.length; index += 1) {
            const nodeId = boundIds[index]!;
            const slot = `source-${index + 1}`;
            if (nodeId === source.sourceNodeId && !item.dependencyNodeIds?.length) {
              sources.set(slot, first.image);
              continue;
            }
            const exported = await requestLinkedBatchSource(generation, item.nodeId, nodeId, item.width, item.height);
            sources.set(slot, await imageFromBytes(exported.bytes));
            if (run.cancelled) break;
          }
          if (!run.cancelled) {
            bytes = parsed.operation.kind === "mockup"
              ? await renderer.renderMockup(parsed.operation.spec, sources)
              : await renderer.renderComposition(parsed.operation.task, sources);
            sourceNodeIds = boundIds;
          }
        } else {
          const boundIds = item.sourceNodeIds ?? [source.sourceNodeId];
          const count=parsed.operation.kind === "deformation" ? deformationTaskSourceCount(parsed.operation) : 1;
          if (boundIds.length!==count) throw new Error("Invalid source binding");
          const nodeId=boundIds[parsed.operation.kind === "deformation" ? deformationArtworkIndex(parsed.operation) : 0]!;
          // The selection raster is reusable only while no prerequisite has
          // republished a local inside this item's bound source; otherwise the
          // bound source — the selected node itself — must be exported freshly.
          const image = nodeId === source.sourceNodeId && !item.dependencyNodeIds?.length ? first.image : await imageFromBytes(
            (await requestLinkedBatchSource(generation, item.nodeId, nodeId, item.width, item.height)).bytes,
          );
          if(parsed.operation.kind === "deformation" && parsed.operation.shapeGuideSourceIndex !== undefined) {
            const guideId=boundIds[parsed.operation.shapeGuideSourceIndex]!;
            const guide=await requestLinkedBatchSource(generation,item.nodeId,guideId,item.width,item.height);
            parsed.operation=await refreshNativeShapeFit(parsed.operation,guide.shapeGuide);
          }
          if (!run.cancelled) bytes = await renderer.render(parsed.operation, image, { width: item.width, height: item.height }, async desired => {
            const exported = await requestLinkedBatchSource(generation, item.nodeId, nodeId, desired.width, desired.height);
            if (run.cancelled || generation !== activeGeneration || current !== source) throw userMessage("selectionChanged");
            return imageFromBytes(exported.bytes);
          });
          sourceNodeIds = boundIds;
        }
        if (run.cancelled) {
          entry.status = "cancelled";
          continue;
        }
        post({
          type: "apply-linked-batch-item",
          payload: {
            generation,
            nodeId: item.nodeId,
            bytes: bytes!,
            renderWidth: item.width,
            renderHeight: item.height,
            placement: item.placement,
            storedOperation: batchStoredOperation(parsed.operation),
            ...(sourceNodeIds ? { sourceNodeIds } : {}),
          },
        });
        const completion = await new Promise<MainToUiMessage>((resolve) => {
          run.completion = resolve;
          setTimeout(() => {
            if (run.completion === resolve) {
              run.completion = undefined;
              resolve({ type: "apply-error", generation, message: userMessage("unexpectedError") });
            }
          }, LINKED_BATCH_STEP_TIMEOUT_MS);
        });
        if (completion.type === "apply-error") {
          entry.status = "failed";
          entry.reason = completion.message;
        } else {
          entry.status = "updated";
        }
      } catch (error) {
        entry.status = "failed";
        entry.reason = messageFromError(error, "unexpectedError");
      }
      renderLinkedResults();
    }
  } finally {
    renderer.dispose();
    if (generation === activeGeneration && current === source) {
      linkedBatchReport = new Map(run.entries);
      // Keep the final report open only for the source that started the run.
      renderLinkedResults();
    }
    linkedBatchRun = undefined;
    renderLinkedBatchAction();
  }
  if (generation !== activeGeneration || current !== source) return;
  const tally = { updated: 0, issues: 0, total: run.entries.size };
  for (const entry of run.entries.values()) {
    if (entry.status === "updated") tally.updated += 1;
    else tally.issues += 1;
  }
  setStatus(userMessage(tally.issues ? "batchSummaryIssues" : "batchSummary", tally));
}

function batchStoredOperation(operation: ParsedBatchOperation): StoredOperation {
  if (operation.kind === "deformation") return {kind:"task",task:operation};
  if (operation.kind === "canvas") return { kind: "canvas", spec: operation.spec };
  if (operation.kind === "transform") {
    return { kind: "transform", spec: operation.spec };
  }
  if (operation.kind === "mockup") {
    return { kind: "task", task: { kind: "mockup", spec: operation.spec } };
  }
  if (operation.kind === "composition") return { kind: "task", task: operation.task };
  const { work, view } = batchOperationWork(operation);
  return { kind: "task", task: { kind: "deformation", view, spec: work } };
}

/** One bound-source raster of a multi-source batch item, exported by main. */
function requestLinkedBatchSource(
  generation: number,
  resultNodeId: string,
  nodeId: string,
  width: number,
  height: number,
): Promise<Extract<MainToUiMessage, { type: "batch-source" }>> {
  return new Promise((resolve, reject) => {
    const pending = {
      generation,
      resultNodeId,
      nodeId,
      resolve: (message: Extract<MainToUiMessage, { type: "batch-source" | "batch-source-error" }>) => {
        if (message.type === "batch-source") resolve(message);
        else reject(new Error(translate(activeLocale, messageFromError(message.message, "unexpectedError"))));
      },
    };
    linkedBatchSourceRequest = pending;
    post({ type: "export-batch-source", generation, resultNodeId, nodeId, desiredWidth: width, desiredHeight: height });
    setTimeout(() => {
      if (linkedBatchSourceRequest === pending) {
        linkedBatchSourceRequest = undefined;
        reject(new Error("Source export timed out"));
      }
    }, LINKED_BATCH_STEP_TIMEOUT_MS);
  });
}

function linkedBatchStatusLabel(status: LinkedBatchStatus): string {
  switch (status) {
    case "pending": return "";
    case "updating": return translate(activeLocale, "batchRowUpdating");
    case "updated": return translate(activeLocale, "batchRowUpdated");
    // The unsupported kind stays in the detail chain; the label never repeats it.
    case "unsupported": return translate(activeLocale, "batchRowUnsupported");
    case "failed": return translate(activeLocale, "batchRowFailed");
    case "cancelled": return translate(activeLocale, "batchRowCancelled");
  }
}

function linkedResultKindLabel(kind: NonNullable<SourcePayload["linkedResults"]>["items"][number]["kind"]): MessageKey {
  switch (kind) {
    case "invalid": return "linkedResultNeedsRepair";
    case "transform": return "workspacePerspective";
    case "rectify": return "modeRectify";
    case "canvas": return "canvasTitle";
    case "effect": return "workspaceSpatial";
    case "mockup": return "workspaceMockup";
    case "composition": return "workspaceMockup";
    case "mesh": return "workspaceMesh";
    case "surface": return "workspaceSurface";
    case "deformation": return "workspaceDeformation";
    case "remap": return "workspaceRemap";
  }
}

function handleKeydown(event: KeyboardEvent): void {
  if (!linkedResultsPopover.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLinkedResults();
      linkedResultsTrigger.focus();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = linkedResultButtons();
      const currentIndex = enabled.findIndex((button) => button === document.activeElement);
      const nextIndex = nextMenuIndex(currentIndex, event.key, enabled.length);
      if (nextIndex !== undefined) enabled[nextIndex]?.focus();
      return;
    }
  }
  const workspace = productWorkspace.current();
  if (workspace === "canvas") {
    canvasWorkspace.handleKeydown(event);
    return;
  }
  if (workspace === "spatial" || workspace === "mesh" || workspace === "surface" || workspace === "mockup" || workspace === "remap" || workspace === "appearance" || workspace === "card" || workspace === "presets" || workspace === "templates") {
    designerWorkspaces[workspace].handleKeydown(event);
    return;
  }
  // Popovers register first and prevent the keys they own. Do not reinterpret
  // their Escape/navigation keys as editor-wide cancel or zoom commands after
  // the popover has already closed itself.
  if (event.defaultPrevented) return;
  if (event.key === "Escape" && !placementPanel.hidden) {
    event.preventDefault();
    closePlacementPanel({ restoreFocus: true });
    return;
  }
  const shortcut = {
    key: event.key,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
  };
  const targetEditsText = targetOwnsTextEditingKey(event.target);
  if (
    shouldRouteAppliedUndo({
      phase,
      appliedResultPending,
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      alreadyRouted: undoRouted,
    })
  ) {
    // Applying does not lock the editor. Before the next local edit, preserve
    // the familiar one-step document Undo for removing the freshly generated
    // result without making that result the active source.
    event.preventDefault();
    undoRouted = true;
    appliedResultPending = false;
    // A selected native result now represents the restored document state.
    // Reload it instead of preserving the just-undone local deformation.
    if (current?.nativeTarget || current?.nativeVectorTarget) lastShownNodes = undefined;
    post({ type: "trigger-undo" });
    return;
  }
  if (!targetEditsText && shouldUndoInPlugin({ ...shortcut, phase })) {
    event.preventDefault();
    void stepHistory("undo");
    return;
  }
  if (!targetEditsText && history?.canRedo() && shouldRedoInPlugin({ ...shortcut, phase })) {
    event.preventDefault();
    void stepHistory("redo");
    return;
  }
  const targetOwnsKey = targetOwnsSessionKey(event.target);
  const zoomCommand = previewZoomCommand({
    phase,
    key: event.key,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    targetOwnsKey: targetEditsText,
  });
  if (zoomCommand) {
    event.preventDefault();
    if (zoomCommand === "in") viewport?.zoomIn();
    if (zoomCommand === "out") viewport?.zoomOut();
    if (zoomCommand === "fit") viewport?.fit();
    if (zoomCommand === "actual") viewport?.resetScale();
    return;
  }
  const session = {
    phase,
    key: event.key,
    targetOwnsKey,
    popoverOpen: !settingsPopover.hidden || !placementPanel.hidden || !linkedResultsPopover.hidden,
  };
  if (shouldHoldSpacePan({ phase, key: event.key, targetOwnsKey: session.targetOwnsKey })) {
    event.preventDefault();
    viewport?.setPanActive(true);
    return;
  }
  if (shouldApplyOnEnter(session)) {
    event.preventDefault();
    void applyPerspective();
    return;
  }
  if (shouldCancelOnEscape(session)) {
    event.preventDefault();
    void cancelSession();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  if (productWorkspace.current() !== "perspective") return;
  if (event.key === " ") viewport?.setPanActive(false);
}

function releasePreviewPan(): void {
  if (productWorkspace.current() !== "perspective") return;
  viewport?.setPanActive(false);
}

function targetOwnsSessionKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, button:not(.worldbend-editor__handle)"))
  );
}

function targetOwnsTextEditingKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function sameMessage(left: UserMessage | undefined, right: UserMessage): boolean {
  return (
    left?.key === right.key &&
    JSON.stringify(left?.values ?? {}) === JSON.stringify(right.values ?? {})
  );
}

function readSystemLocales(): string[] {
  const candidates = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  // The main-side message guard rejects more than 16 entries; keep the
  // ordered prefix so unusual machines still initialize.
  return [
    ...new Set(candidates.filter((locale) => typeof locale === "string" && locale.length > 0)),
  ].slice(0, 16);
}

async function publishNativeDesigner(payload:Extract<UiToMainMessage,{type:"apply-designer"}>["payload"]){
  const generation=payload.generation;
  try {
    if(payload.task.kind!=="deformation")throw Error("Native Vector requires complete deformation work");
    const operation={kind:"task" as const,task:payload.task},resolved=resolveNativeVectorOperation(operation);
    const plan=await planDeformationWork(payload.task.spec);
    if(generation!==activeGeneration)return;
    const sourceNodeId=payload.sourceNodeIds[resolved.artworkSourceIndex]!;
    const request:NativeVectorProjectionPayload={generation,operation,sourceNodeIds:payload.sourceNodeIds,spec:resolved.plane,
      matrix:plan.meshWarp.solve.homography.matrix,sourceNodeId,renderWidth:payload.task.spec.targetSize?.width??payload.renderWidth,renderHeight:payload.task.spec.targetSize?.height??payload.renderHeight,
      placement:payload.placement,...(payload.targetNodeId?{targetNodeId:payload.targetNodeId}:{}),...(payload.duplicate?{duplicate:true}:{} )};
    const relayed=await requestNativeVectorProjection(request);
    if(generation!==activeGeneration)return;
    const projected=await planVectorArtwork(nativeVectorArtworkFromInputs(resolved.core,relayed.inputs,relayed.sourceView.policy==="appearance"));
    if(generation!==activeGeneration)return;
    const executionFrame=nativeVectorExecutionFrame(projected.plan);
    post({type:"apply-native-vector",payload:{...request,matrix:projected.plan.homography,placement:relayed.placement,
      ...(executionFrame ? {executionFrame,renderWidth:projected.plan.reference.width,renderHeight:projected.plan.reference.height} : {}),
      sourceView:resolvedNativeVectorSourceView(relayed.sourceView,projected.sourceBounds),operationExpected:relayed.operationExpected,projection:{outputs:projected.outputs,sourceFingerprint:relayed.sourceFingerprint,...(projected.clip?{clip:projected.clip}:{})}}});
  }catch(error){if(generation===activeGeneration)handleMainMessage({type:"apply-designer-error",generation,message:messageFromError(error,"nativeVectorApplyFailed")});}
}

function post(message: UiToMainMessage): void {
  if (message.type === "apply-designer") {
    const { generation, targetNodeId, task, duplicate } = message.payload;
    pendingDesignerPublication = targetNodeId && !duplicate
      ? { generation, targetNodeId, task: structuredClone(task) } : undefined;
    if(message.payload.nativeVector){void publishNativeDesigner(message.payload);return;}
  }
  // Figma's bundled inline UI has a null origin and requires this target.
  // This is a confined host bridge, not an external-URL UI or network export.
  // https://developers.figma.com/docs/plugins/creating-ui/
  parent.postMessage({ pluginMessage: message }, "*");
}

async function imageFromBytes(bytes: Uint8Array): Promise<HTMLImageElement> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new Error("The selected layer did not produce a readable image");
  }
  // postMessage delivered a private clone backed by a plain ArrayBuffer, so
  // the bytes can go straight into the Blob without another copy.
  const blobBytes = bytes as Uint8Array<ArrayBuffer>;
  const url = URL.createObjectURL(new Blob([blobBytes], { type: "image/png" }));
  try {
    const image = new Image();
    image.src = url;
    try {
      await awaitImageDecoded(image);
    } catch {
      throw new Error("The selected layer did not produce a readable image");
    }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      throw new Error("The selected layer did not produce a readable image");
    }
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

window.addEventListener(
  "pagehide",
  () => {
    pendingDesignerPublication = undefined;
    cancelTransformGesturePreview();
    distortEndFrames.cancel();
    cancelSourceRasterRequests(userMessage("selectionChanged"));
    viewport?.dispose();
    editor?.dispose();
    canvasWorkspace.dispose();
    for (const workspace of Object.values(designerWorkspaces)) workspace.dispose();
    window.removeEventListener("blur", releasePreviewPan);
  },
  { once: true },
);
