import {
  buildWarpMesh,
  composeAffineTransform,
  emitCssTransform,
  createPreviewViewport,
  estimateSourceRasterSize,
  formatZoomPercent,
  identityTransformRecipe,
  normalizedSpec,
  PerspectiveEditor,
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
  type WarpSpec,
  type WarpPreset,
  type PreviewViewportHandle,
  type PreviewSolveOutput,
  type RectifyPlan,
  type RectifySpecInput,
  type WarpMesh,
} from "@worldbend/web";
import type { MainToUiMessage, SourcePayload, UiToMainMessage } from "./messages";
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
import { createLocaleView, type OptionsMenuView } from "./locale-view";
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
  translationForPlacement,
  withTranslationAxis,
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
  taskWorkspaceAvailability,
} from "./task-launcher";
import { createHorizontalStrip } from "./horizontal-strip";
import { createCanvasWorkspace } from "./canvas-workspace";
import type { CanvasWorkspaceCopy } from "./canvas-workspace-view";
import { createMeshWorkspace, type MeshWorkspaceCopy } from "./mesh-workspace";
import { createSurfaceWorkspace, type SurfaceWorkspaceCopy } from "./surface-workspace";
import { createMockupWorkspace, type MockupWorkspaceCopy } from "./mockup-workspace";
import { createRemapWorkspace, type RemapWorkspaceCopy } from "./remap-workspace";
import { NATIVE_EFFECT_LISTING_URL } from "./native-renderer";
import type { DesignerTaskWorkspace, DesignerWorkspaceSource } from "./designer-workspace-common";
import { createTemplateWorkspace, type TemplateWorkspaceCopy } from "./template-workspace";

const TRANSFORM_PREVIEW_TIMEOUT_MS = 5_000;
const SOURCE_RASTER_TIMEOUT_MS = 10_000;

const editorMount = required<HTMLDivElement>("editor");
const canvasWorkspaceRoot = required<HTMLElement>("canvas-workspace");
const mockupWorkspaceRoot = required<HTMLElement>("mockup-workspace");
const meshWorkspaceRoot = required<HTMLElement>("mesh-workspace");
const surfaceWorkspaceRoot = required<HTMLElement>("surface-workspace");
const remapWorkspaceRoot = required<HTMLElement>("remap-workspace");
const templatesWorkspaceRoot = required<HTMLElement>("templates-workspace");
const selectionState = required<HTMLElement>("selection-state");
const selectionTitle = required<HTMLElement>("selection-title");
const selectionDetail = required<HTMLElement>("selection-detail");
const selectionContinue = required<HTMLElement>("selection-continue");
const nativeRecoverButton = required<HTMLButtonElement>("native-recover");
let nativeRecovery: { nodeId: string; expected: string } | undefined;
const sourceName = required<HTMLOutputElement>("source-name");
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
const advancedToolsTitle = required<HTMLParagraphElement>("advanced-tools-title");
const perspectiveOptionsTitle = required<HTMLParagraphElement>("perspective-options-title");
const workspaceMockupDetail = required<HTMLElement>("workspace-mockup-detail");
const workspaceMeshDetail = required<HTMLElement>("workspace-mesh-detail");
const workspaceSurfaceDetail = required<HTMLElement>("workspace-surface-detail");
const workspaceRemapDetail = required<HTMLElement>("workspace-remap-detail");
const transformActions = required<HTMLDivElement>("transform-actions");
const actionFlipX = required<HTMLButtonElement>("action-flip-x");
const actionFlipY = required<HTMLButtonElement>("action-flip-y");
const actionRotateCw = required<HTMLButtonElement>("action-rotate-cw");
const actionCopyParameters = required<HTMLButtonElement>("action-copy-parameters");
const actionTransformAgain = required<HTMLButtonElement>("action-transform-again");
const actionCopyCss = required<HTMLButtonElement>("action-copy-css");
const actionApplyCopy = required<HTMLButtonElement>("action-apply-copy");
const actionApplyEditable = required<HTMLButtonElement>("action-apply-editable");
const nativeGuidance = required<HTMLParagraphElement>("native-guidance");
const copyEffectListing = required<HTMLButtonElement>("copy-effect-listing");
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

type ShownNodes = { nodeIds: string[]; sourceNodeIds: readonly string[] };
type ActiveSource = Omit<SourcePayload, "bytes" | "sources"> & {
  sources?: Array<Omit<NonNullable<SourcePayload["sources"]>[number], "bytes">>;
};

let current: ActiveSource | undefined;
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
  source: ActiveSource; generation: number; width: number; height: number; image: HTMLImageElement;
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
let pendingReplacementBaseline: { generation: number; frame: TransformFrame } | undefined;
let nextSourceRasterRequestId = 1;
const pendingSourceRasterRequests = new Map<
  number,
  {
    generation: number;
    timer: ReturnType<typeof setTimeout>;
    resolve: (bytes: Uint8Array) => void;
    reject: (error: unknown) => void;
  }
>();
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
  async (sample: { recipe: TransformRecipe; final: boolean }) => updateTransformPreview({
    recipe: sample.recipe,
    liveGesture: true,
    commitBoundary: sample.final,
  }),
  { preserve: (sample) => sample.final },
);
const controlPreviewFrames = createLatestFrameCoalescer(
  (sample: { recipe: TransformRecipe; final: boolean }) => controlPreviewWork.request(sample),
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
    requestTransformHistoryCommit();
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
  requestSourceRaster,
  decodeImage: imageFromBytes,
  formatError(error) {
    return translate(activeLocale, messageFromError(error, "unexpectedError"));
  },
});
const meshWorkspace = createMeshWorkspace({
  root: meshWorkspaceRoot,
  copy: meshWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  post,
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
const templateWorkspace = createTemplateWorkspace({
  root: templatesWorkspaceRoot,
  copy: templateWorkspaceCopy,
  onBack() { productWorkspace.returnToPerspective(); },
  onCreate(target) { productWorkspace.enter(target); },
  onUse(template) {
    if (template.schema === "worldbend.figma-task-template") {
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
      if (!canvasWorkspace.loadTemplate(template.operation.spec)) return false;
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
const designerWorkspaces: Record<"mesh" | "surface" | "mockup" | "remap" | "templates", DesignerTaskWorkspace> = {
  mesh: meshWorkspace,
  surface: surfaceWorkspace,
  mockup: mockupWorkspace,
  remap: remapWorkspace,
  templates: templateWorkspace,
};
const taskRoots = {
  canvas: canvasWorkspaceRoot,
  mockup: mockupWorkspaceRoot,
  mesh: meshWorkspaceRoot,
  surface: surfaceWorkspaceRoot,
  remap: remapWorkspaceRoot,
  templates: templatesWorkspaceRoot,
} as const;
productWorkspace = createProductWorkspaceRouter({
  onChange(previous, next) {
    if (previous === "perspective") clearSceneDraftFeedback();
    if (previous === "canvas") canvasWorkspace.leave();
    if (previous === "mesh" || previous === "surface" || previous === "mockup" || previous === "remap" || previous === "templates") designerWorkspaces[previous].leave();
    if (previous !== "perspective") taskRoots[previous].hidden = true;
    controls.inert = next !== "perspective";
    controls.hidden = next !== "perspective" || !current;
    selectionState.hidden = next !== "perspective" || Boolean(current);
    if (next === "canvas") canvasWorkspace.enter();
    if (next === "mesh" || next === "surface" || next === "mockup" || next === "remap" || next === "templates") designerWorkspaces[next].enter();
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
  secondaryControl: moreOptionsButton,
  secondaryButtons: Array.from(
    settingsPopover.querySelectorAll<HTMLButtonElement>("button[data-workspace]"),
  ),
  onChoose(workspace) {
    productWorkspace.enter(workspace);
  },
});
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
meshWorkspace.updateLocale();
surfaceWorkspace.updateLocale();
mockupWorkspace.updateLocale();
remapWorkspace.updateLocale();
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

window.onmessage = (event: MessageEvent<{ pluginMessage?: MainToUiMessage }>) => {
  const message = event.data.pluginMessage;
  if (!message) return;
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
  if (canvasWorkspace.handleMainMessage(message)) return;
  for (const workspace of Object.values(designerWorkspaces)) {
    if (workspace.handleMainMessage(message)) return;
  }
  if (message.type === "source-raster" || message.type === "source-raster-error") {
    const pending = pendingSourceRasterRequests.get(message.requestId);
    if (!pending || pending.generation !== message.generation) return;
    clearTimeout(pending.timer);
    pendingSourceRasterRequests.delete(message.requestId);
    if (message.type === "source-raster") pending.resolve(message.bytes);
    else pending.reject(message.message);
    return;
  }
  if (message.type === "locale") {
    applyLocale(message.preference, message.locale);
    canvasWorkspace.updateLocale();
    meshWorkspace.updateLocale();
    surfaceWorkspace.updateLocale();
    mockupWorkspace.updateLocale();
    remapWorkspace.updateLocale();
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
    undoRouted = false;
    setStatus(
      userMessage(message.operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"),
    );
    renderState();
  }
};

resetButton.addEventListener("click", () => void resetPerspective());
applyButton.addEventListener("click", () => void applyPerspective());
modeTransformButton.addEventListener("click", () => void switchEditorMode("transform"));
modeDistortButton.addEventListener("click", () => void switchEditorMode("distort"));
modeWarpButton.addEventListener("click", () => void switchEditorMode("warp"));
modeRectifyButton.addEventListener("click", () => void switchEditorMode("rectify"));
distortFreeButton.addEventListener("click", () => void selectDistortMode("free"));
distortPerspectiveButton.addEventListener("click", () => void selectDistortMode("perspective"));
warpMeshContinue.addEventListener("click", () => {
  productWorkspace.enter("mesh");
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
actionApplyCopy.addEventListener("click", () => void applyPerspective(true, false));
actionApplyEditable.addEventListener("click", () => {
  if (actionApplyEditable.getAttribute("aria-disabled") === "true") {
    void copyNativeEffectListing();
    return;
  }
  void applyPerspective(true, true);
});
copyEffectListing.addEventListener("click", () => void copyNativeEffectListing());
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

function beginSelectionLoad(generation: number, nodeIds: readonly string[]): void {
  if (!Number.isSafeInteger(generation) || generation < activeGeneration) return;
  nativeRendererUpdate = undefined;
  finalSourceRaster = undefined;
  loadingNodeIds = [...nodeIds];
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

async function loadSource(generation: number, payload: SourcePayload): Promise<void> {
  if (generation !== activeGeneration || !editor) return;
  const nextNodeIds = [
    ...(payload.sources?.map((source) => source.sourceNodeId) ?? [payload.sourceNodeId]),
    ...(payload.targetNodeId ? [payload.targetNodeId] : []),
  ];
  const refreshing = lastShownNodes !== undefined &&
    isSameShownSelection(loadingNodeIds) &&
    [...lastShownNodes.sourceNodeIds].sort().join("\u0000") === [...nextNodeIds].sort().join("\u0000");
  try {
    const image = await imageFromBytes(payload.bytes);
    const rasterSources = payload.sources?.length ? payload.sources : [payload];
    const loadedSources = await Promise.all(rasterSources.map(async (raster, index) => ({
      sourceNodeId: raster.sourceNodeId,
      sourceName: raster.sourceName,
      renderWidth: raster.renderWidth,
      renderHeight: raster.renderHeight,
      placement: { ...raster.placement },
      image: index === 0 && raster.sourceNodeId === payload.sourceNodeId
        ? image
        : await imageFromBytes(raster.bytes),
    })));
    if (generation !== activeGeneration) return;
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
    if (externalTransformChanged) appliedResultPending = false;
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
      ...(payload.targetNodeId ? { targetPlacement: { ...payload.placement } } : {}),
      ...(payload.targetNodeId ? { targetNodeId: payload.targetNodeId } : {}),
    };
    for (const workspace of Object.values(designerWorkspaces)) workspace.setSource(designerSource);
    const sourceCount = loadedSources.length;
    workspaceNavigation.setAvailability(taskWorkspaceAvailability(sourceCount));
    initialFrame = cloneFrame(nextInitial);
    baseFrame = cloneFrame(retainedSession?.entry.baseFrame ?? nextActive);
    activeFrame = cloneFrame(nextActive);
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
    if (payload.canvas) productWorkspace.enter("canvas");
    if (payload.task) productWorkspace.enter(payload.task.kind);
    controls.hidden = productWorkspace.current() !== "perspective";
    delete controls.dataset.loading;
    renderMode();
    setStatus();
    renderState();
    // New pixels alone do not invalidate local geometry, controls or history.
    // Only a changed geometric frame needs a new history basis.
    history = retainedSession?.history ?? createEditHistory(currentHistoryEntry());
    if (editorMode === "transform") {
      const initialized = await updateTransformPreview();
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
  canvasWorkspace.clearSource(translate(activeLocale, message));
  for (const workspace of Object.values(designerWorkspaces)) {
    workspace.clearSource(translate(activeLocale, message));
  }
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
    if (commit) commitHistoryNow();
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
      deferredHistoryCommit.flush();
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
    controlPreviewFrames.request({ recipe, final });
    if (final) controlPreviewFrames.flush();
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

function commitHistoryNow(): void {
  if (!history || !baseFrame || !activeFrame || phase !== "ready" || refreshInFlight) return;
  disarmAppliedResultUndo();
  history.push(currentHistoryEntry());
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
  if (!entry) return;
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
 * X/Y place the transformed result's top-left in scene coordinates. Typing a
 * value converts the scene delta into recipe translation through the base
 * frame's placement scale, so placement stays a live composition input.
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
  const current = axis === "x" ? activeFrame.placement.x : activeFrame.placement.y;
  const baseSize = axis === "x" ? baseFrame.renderWidth : baseFrame.renderHeight;
  const placementSize = axis === "x" ? baseFrame.placement.width : baseFrame.placement.height;
  const next = translationForPlacement({
    desired,
    current,
    currentTranslation: gestureTranslation[axis],
    baseRenderSize: baseSize,
    basePlacementSize: placementSize,
  });
  if (next === undefined) {
    restorePlacementInput(axis);
    showError(userMessage("invalidPlacement"));
    return;
  }
  gestureTranslation = withTranslationAxis(gestureTranslation, axis, next);
  void updateTransformPreview();
  requestTransformHistoryCommit();
}

function restorePlacementInput(axis: "x" | "y"): void {
  if (!activeFrame) return;
  const input = axis === "x" ? positionXInput : positionYInput;
  const value = axis === "x" ? activeFrame.placement.x : activeFrame.placement.y;
  placementCanonical[axis] = preciseInputValue(value);
  input.value = displayPlacementValue(value);
}

function renderPlacementFields(): void {
  if (!activeFrame) return;
  if (document.activeElement !== positionXInput) {
    placementCanonical.x = preciseInputValue(activeFrame.placement.x);
    positionXInput.value = displayPlacementValue(activeFrame.placement.x);
  }
  if (document.activeElement !== positionYInput) {
    placementCanonical.y = preciseInputValue(activeFrame.placement.y);
    positionYInput.value = displayPlacementValue(activeFrame.placement.y);
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

async function applyPerspective(duplicate = false, editableIntent?: boolean): Promise<void> {
  // A Warp operation cannot publish an editable result, so even on a
  // native-capable file its primary Apply stays the HD image route instead
  // of routing editable and failing on click.
  const editable = editableIntent ??
    Boolean(current?.nativeTarget && !duplicate && !editor?.captureSpec().content.warp);
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
  if (editable && !source.nativeRenderer) {
    showError(userMessage(source.nativeTarget ? "nativeEffectUnavailable" : "nativeUnavailable"));
    return;
  }
  if (editable && spec.content.warp) {
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
  const replacing = !duplicate && source.targetNodeId && editable === Boolean(source.nativeTarget);
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
    if (editable) {
      const solved = await solveTransform(spec, rasterSize);
      if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
      post({ type: "apply-native", payload: {
        generation, spec, inverse: solved.homography.inverse,
        sourceNodeId: source.sourceNodeId,
        renderWidth: rasterSize.width, renderHeight: rasterSize.height,
        placement: output.placement,
        ...(source.targetNodeId ? { targetNodeId: source.targetNodeId } : {}),
        ...(duplicate ? { duplicate: true } : {}),
      } });
      return;
    }
    const prepared = await prepareFinalSourceRaster(source, rasterSize, spec);
    if (generation !== activeGeneration || phase !== "applying" || current !== source) return;
    const bytes = await editor.exportPng(
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
): Promise<{
  sourceOverride?: HTMLImageElement;
  solved: PreviewSolveOutput;
  warpMesh?: WarpMesh;
}> {
  if (!editor) throw new Error("The transform preview is unavailable");
  const solved = await solveTransform(spec, {
    width: output.width,
    height: output.height,
  });
  const warpMesh = spec.content.warp?.amount
    ? await buildWarpMesh(spec.content.warp)
    : undefined;
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
  if (current !== source || refreshInFlight) throw userMessage("selectionChanged");
  const generation = activeGeneration;
  if (finalSourceRaster?.source === source && finalSourceRaster.generation === generation &&
    finalSourceRaster.width === desired.width && finalSourceRaster.height === desired.height) {
    return finalSourceRaster.image;
  }
  finalSourceRaster = undefined;
  const bytes = await requestSourceRaster(source, desired);
  const image = await imageFromBytes(bytes);
  if (generation !== activeGeneration || current !== source || refreshInFlight) throw userMessage("selectionChanged");
  finalSourceRaster = { source, generation, width: desired.width, height: desired.height, image };
  return image;
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
  outputSizeNote.textContent = fitted
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

function requestSourceRaster(source: ActiveSource, desired: Size): Promise<Uint8Array> {
  const requestId = nextSourceRasterRequestId++;
  return new Promise<Uint8Array>((resolve, reject) => {
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

function renderState(scope: "full" | "publication" = "full"): void {
  const ready = phase === "ready" && Boolean(current) && Boolean(editor);
  const blockingCompose = composeInFlight && !continuousPreviewInFlight;
  const transformInitializing = ready && editorMode === "transform" && !lastCompose;
  const taskReady = ready && valid && Boolean(activeFrame) && !blockingCompose && !refreshInFlight;
  const sourceCount = current?.sources?.length ?? (current ? 1 : 0);
  const menuReady = taskReady && sourceCount === 1;
  const outputPlan = currentOutputPlan();
  const outputApplicable = canApplyOutput(outputPlan, outputDensityPolicy);
  const positionReady = menuReady && !transformInitializing && editorMode === "transform" && transformInputsValid;
  const editableApplicable = canApplyOutput(currentOutputPlan(true), "original");
  const editableModeSupported = editorMode !== "rectify" && !editor?.captureSpec().content.warp;
  const editableSupported = Boolean(current?.nativeRenderer) && editableModeSupported;
  const editableReady = menuReady && transformInputsValid && !transformInitializing &&
    editableApplicable && editableSupported;
  actionApplyEditable.disabled = !editableReady;
  const editableHelp = translate(activeLocale, !editableModeSupported ? "nativeOutputUnsupported" :
    current?.nativeRendererPending ? "nativePreparing" :
    !current?.nativeRenderer ? current?.nativeTarget ? "nativeEffectUnavailable" : "nativeUnavailable" :
    !editableApplicable ? "nativeOutputLimit" : "editableOutputHelp");
  actionApplyEditable.title = editableHelp;
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
  const primaryEditable = Boolean(current?.nativeTarget) && editableModeSupported;
  if (primaryEditable) applyButton.disabled = !editableReady;
  applyButton.title = primaryEditable ? editableHelp : imageHelp;
  const replacing = Boolean(current?.targetNodeId) && (!current?.nativeTarget || primaryEditable);
  applyButton.textContent = translate(activeLocale, replacing
    ? primaryEditable ? "updateEditable" : "updateHighResolutionImage"
    : "createHighResolutionImage");
  actionApplyCopy.hidden = !replacing;
  renderOutputSize(outputPlan);
  if (scope === "publication") return;
  // A missing native effect cannot be fixed by editing transform inputs, so
  // its recovery guidance must stay keyboard-reachable and visible instead of
  // hiding behind a disabled button's hover-only tooltip.
  const editableEnvironmentBlocked = menuReady && transformInputsValid && !transformInitializing &&
    editableApplicable && editableModeSupported && !current?.nativeRenderer && !current?.nativeRendererPending;
  if (editableEnvironmentBlocked) {
    actionApplyEditable.disabled = false;
    actionApplyEditable.setAttribute("aria-disabled", "true");
    actionApplyEditable.setAttribute("aria-describedby", "native-guidance");
    nativeGuidance.textContent = translate(activeLocale, current?.nativeTarget ? "nativeEffectUnavailable" : "nativeUnavailable");
    nativeGuidance.hidden = false;
    copyEffectListing.hidden = false;
  } else {
    actionApplyEditable.removeAttribute("aria-disabled");
    actionApplyEditable.removeAttribute("aria-describedby");
    nativeGuidance.hidden = true;
    copyEffectListing.hidden = true;
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
  workspaceNavigation.setDisabled(!taskReady);
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
  editor?.setDisabled(!ready || transformInitializing || blockingCompose || refreshInFlight);
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
  document.documentElement.lang = locale;
  document.body.dataset.i18nReady = "true";
  localizeIconAction(moreOptionsButton, translate(locale, "moreOptions"));
  settingsPopover.setAttribute("aria-label", translate(locale, "moreOptions"));
  advancedToolsTitle.textContent = translate(locale, "advancedTools");
  perspectiveOptionsTitle.textContent = translate(locale, "perspectiveOptions");
  workspaceMockupDetail.textContent = translate(locale, "workspaceMockupDetail");
  workspaceMeshDetail.textContent = translate(locale, "workspaceMeshDetail");
  workspaceSurfaceDetail.textContent = translate(locale, "workspaceSurfaceDetail");
  workspaceRemapDetail.textContent = translate(locale, "workspaceRemapDetail");
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
    mockup: translate(locale, "workspaceMockup"),
    mesh: translate(locale, "workspaceMesh"),
    surface: translate(locale, "workspaceSurface"),
    remap: translate(locale, "workspaceRemap"),
  }, translate(locale, "previousTools"), translate(locale, "nextTools"));
  modeBackward.setAttribute("aria-label", translate(locale, "previousModes"));
  modeForward.setAttribute("aria-label", translate(locale, "nextModes"));
  actionApplyCopy.textContent = translate(locale, "createHighResolutionImage");
  actionApplyEditable.textContent = translate(locale, "applyEditable");
  copyEffectListing.textContent = translate(locale, "copyEffectListing");
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
    applying: translate(activeLocale, "applying"),
    applied: translate(activeLocale, "designerApplied"),
  };
}

async function copyNativeEffectListing(): Promise<void> {
  const copied = await copyPlacementParameters(NATIVE_EFFECT_LISTING_URL);
  setStatus(userMessage(copied ? "effectListingCopied" : "effectListingCopyFailed"));
}

function meshWorkspaceCopy(): MeshWorkspaceCopy {
  return {
    ...designerCopy("meshTitle"),
    subdivisions: translate(activeLocale, "meshSubdivisions"),
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
    patches: translate(activeLocale, "surfacePatches"),
    subdivisions: translate(activeLocale, "surfaceSubdivisions"),
    pointLabel: translate(activeLocale, "surfacePointLabel"),
    handles: translate(activeLocale, "surfaceHandles"),
    pin: translate(activeLocale, "surfacePin"),
    brush: translate(activeLocale, "surfaceBrush"),
    radius: translate(activeLocale, "surfaceRadius"),
    strength: translate(activeLocale, "surfaceStrength"),
    splitRequired: translate(activeLocale, "surfaceSplitRequired"),
    pinDensity: translate(activeLocale, "surfacePinDensity"),
    pinLimit: translate(activeLocale, "surfacePinLimit"),
    strokeLimit: translate(activeLocale, "surfaceStrokeLimit"),
    brushLimit: translate(activeLocale, "surfaceBrushLimit"),
    strokeSampleLimit: translate(activeLocale, "surfaceStrokeSampleLimit"),
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
    ...designerCopy("mockupTitle"),
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
    outputCount: translate(activeLocale, "templateOutputCount"),
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

function handleKeydown(event: KeyboardEvent): void {
  const workspace = productWorkspace.current();
  if (workspace === "canvas") {
    canvasWorkspace.handleKeydown(event);
    return;
  }
  if (workspace === "mesh" || workspace === "surface" || workspace === "mockup" || workspace === "remap" || workspace === "templates") {
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
    if (current?.nativeTarget) lastShownNodes = undefined;
    post({ type: "trigger-undo" });
    return;
  }
  if (!targetEditsText && shouldUndoInPlugin({ ...shortcut, phase })) {
    event.preventDefault();
    void stepHistory("undo");
    return;
  }
  if (!targetEditsText && shouldRedoInPlugin({ ...shortcut, phase })) {
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
    popoverOpen: !settingsPopover.hidden || !placementPanel.hidden,
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

function post(message: UiToMainMessage): void {
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
    cancelTransformGesturePreview();
    distortEndFrames.cancel();
    cancelSourceRasterRequests(userMessage("selectionChanged"));
    viewport?.dispose();
    editor?.dispose();
    canvasWorkspace.dispose();
    window.removeEventListener("blur", releasePreviewPan);
  },
  { once: true },
);
