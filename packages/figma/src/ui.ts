import {
  buildWarpMesh,
  composeAffineTransform,
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
import { MAX_FIGMA_IMAGE_AXIS } from "./stored-plane";
import {
  frameFromComposition,
  frameFromSource,
  rebaseTransformFrame,
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
  type ProductWorkspaceRouter,
} from "./product-workspace";
import { createTaskLauncher } from "./task-launcher";
import { createCanvasWorkspace } from "./canvas-workspace";
import type { CanvasWorkspaceCopy } from "./canvas-workspace-view";
import { createMeshWorkspace, type MeshWorkspaceCopy } from "./mesh-workspace";
import { createMockupWorkspace, type MockupWorkspaceCopy } from "./mockup-workspace";
import { createRemapWorkspace, type RemapWorkspaceCopy } from "./remap-workspace";
import type { DesignerTaskWorkspace, DesignerWorkspaceSource } from "./designer-workspace-common";

const TRANSFORM_PREVIEW_TIMEOUT_MS = 5_000;
const SOURCE_RASTER_TIMEOUT_MS = 10_000;

const editorMount = required<HTMLDivElement>("editor");
const canvasWorkspaceRoot = required<HTMLElement>("canvas-workspace");
const mockupWorkspaceRoot = required<HTMLElement>("mockup-workspace");
const meshWorkspaceRoot = required<HTMLElement>("mesh-workspace");
const remapWorkspaceRoot = required<HTMLElement>("remap-workspace");
const selectionState = required<HTMLParagraphElement>("selection-state");
const sourceName = required<HTMLElement>("source-name");
const errorMessage = required<HTMLElement>("error");
const errorText = required<HTMLSpanElement>("error-text");
const errorDismiss = required<HTMLButtonElement>("error-dismiss");
const statusMessage = required<HTMLParagraphElement>("status");
const controls = required<HTMLElement>("controls");
const applyButton = required<HTMLButtonElement>("apply");
const resetButton = required<HTMLButtonElement>("reset");
const modeSwitch = required<HTMLDivElement>("mode-switch");
const modeTransformButton = required<HTMLButtonElement>("mode-transform");
const modeWarpButton = required<HTMLButtonElement>("mode-warp");
const modeRectifyButton = required<HTMLButtonElement>("mode-rectify");
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
const linkScaleButton = required<HTMLButtonElement>("link-scale");
const moreOptionsButton = required<HTMLButtonElement>("more-options");
const settingsPopover = required<HTMLDivElement>("settings-popover");
const transformActions = required<HTMLDivElement>("transform-actions");
const actionFlipX = required<HTMLButtonElement>("action-flip-x");
const actionFlipY = required<HTMLButtonElement>("action-flip-y");
const actionRotateCw = required<HTMLButtonElement>("action-rotate-cw");
const actionTransformAgain = required<HTMLButtonElement>("action-transform-again");
const actionApplyCopy = required<HTMLButtonElement>("action-apply-copy");
const taskLauncherButton = required<HTMLButtonElement>("task-launcher-button");
const taskLauncherLabel = required<HTMLSpanElement>("task-launcher-label");
const taskMenu = required<HTMLElement>("task-menu");
const actionUndo = required<HTMLButtonElement>("action-undo");
const actionRedo = required<HTMLButtonElement>("action-redo");
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

type ShownNodes = { nodeIds: string[] };
type ActiveSource = Omit<SourcePayload, "bytes" | "sources"> & {
  sources?: Array<Omit<NonNullable<SourcePayload["sources"]>[number], "bytes">>;
};

let current: ActiveSource | undefined;
// Which layers the editor currently shows. Unlike `current`, this survives a
// selection reload, so chained refreshes of the same layers keep the quad.
let lastShownNodes: ShownNodes | undefined;
let refreshInFlight = false;
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
  // The editor's own frame callback was queued first by the final pointer or
  // keyboard sample. Commit only after onChange has copied that exact quad
  // into activeFrame, then repair visibility without touching its geometry.
  commitHistoryNow();
  viewport?.revealAllCorners({ animate: true });
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

let productWorkspace!: ProductWorkspaceRouter;
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
const designerWorkspaces: Record<"mesh" | "mockup" | "remap", DesignerTaskWorkspace> = {
  mesh: meshWorkspace,
  mockup: mockupWorkspace,
  remap: remapWorkspace,
};
const taskRoots = {
  canvas: canvasWorkspaceRoot,
  mockup: mockupWorkspaceRoot,
  mesh: meshWorkspaceRoot,
  remap: remapWorkspaceRoot,
} as const;
productWorkspace = createProductWorkspaceRouter({
  onChange(previous, next) {
    if (previous === "canvas") canvasWorkspace.leave();
    if (previous === "mesh" || previous === "mockup" || previous === "remap") designerWorkspaces[previous].leave();
    if (previous !== "perspective") taskRoots[previous].hidden = true;
    controls.inert = next !== "perspective";
    controls.hidden = next !== "perspective" || !current;
    selectionState.hidden = next !== "perspective" || Boolean(current);
    if (next === "canvas") canvasWorkspace.enter();
    if (next === "mesh" || next === "mockup" || next === "remap") designerWorkspaces[next].enter();
    if (next !== "perspective") taskRoots[next].hidden = false;
    if (next === "perspective") {
      renderMode();
      renderState();
      queueMicrotask(() => taskLauncherButton.focus());
    }
  },
});
const taskLauncher = createTaskLauncher({
  trigger: taskLauncherButton,
  menu: taskMenu,
  onChoose(workspace) {
    productWorkspace.enter(workspace);
  },
});
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
mockupWorkspace.updateLocale();
remapWorkspace.updateLocale();

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
    mockupWorkspace.updateLocale();
    remapWorkspace.updateLocale();
  }
  if (message.type === "preference-error") showError(message.message);
  if (message.type === "selection-loading") {
    beginSelectionLoad(message.generation, message.nodeIds);
  }
  if (message.type === "source") void loadSource(message.generation, message.payload);
  if (message.type === "selection-error") {
    showSelectionError(message.generation, message.message);
  }
  if (message.type === "apply-error" && message.generation === activeGeneration) {
    appliedTransformMemory.fail(message.generation);
    refreshInFlight = false;
    undoRouted = false;
    phase = current ? "ready" : "idle";
    showError(message.message);
    renderState();
  }
  if (message.type === "apply-complete" && message.generation === activeGeneration) {
    appliedTransformMemory.complete(message.generation);
    refreshInFlight = false;
    phase = "applied";
    setStatus(
      userMessage(message.operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"),
    );
    renderState();
  }
};

resetButton.addEventListener("click", () => void resetPerspective());
applyButton.addEventListener("click", () => void applyPerspective());
modeTransformButton.addEventListener("click", () => void switchEditorMode("transform"));
modeWarpButton.addEventListener("click", () => void switchEditorMode("warp"));
modeRectifyButton.addEventListener("click", () => void switchEditorMode("rectify"));
distortFreeButton.addEventListener("click", () => void selectDistortMode("free"));
distortPerspectiveButton.addEventListener("click", () => void selectDistortMode("perspective"));
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
actionTransformAgain.addEventListener("click", () => void applyTransformAgain());
actionApplyCopy.addEventListener("click", () => void applyPerspective(true));
actionUndo.addEventListener("click", () => void stepHistory("undo"));
actionRedo.addEventListener("click", () => void stepHistory("redo"));
errorDismiss.addEventListener("click", clearError);
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
document.addEventListener("keyup", handleKeyUp);
window.addEventListener("blur", releasePreviewPan);

if (editor) post({ type: "ready", systemLocales });

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
        }
        // Apply validity and the quiet output-size HUD both depend on live
        // dimensions. Re-render after every coalesced geometry sample so a
        // previously blocked Apply cannot stay stale once the user recovers.
        renderState();
      },
      onValidityChange(next) {
        valid = next;
        if (next) clearError();
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
    selectionState.setAttribute("role", "alert");
    return undefined;
  }
}

function beginSelectionLoad(generation: number, nodeIds: readonly string[]): void {
  if (!Number.isSafeInteger(generation) || generation < activeGeneration) return;
  canvasWorkspace.selectionLoading();
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  cancelSourceRasterRequests(userMessage("selectionChanged"));
  appliedTransformMemory.cancelPending();
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
  selectionState.removeAttribute("role");
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
    [...lastShownNodes.nodeIds].sort().join("\u0000") === [...nextNodeIds].sort().join("\u0000");
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
    taskLauncher.setAvailability({
      canvas: sourceCount === 1,
      mesh: sourceCount === 1,
      mockup: sourceCount >= 1 && sourceCount <= 8,
      remap: sourceCount === 1 || sourceCount === 2,
    });
    initialFrame = cloneFrame(nextInitial);
    baseFrame = cloneFrame(nextActive);
    activeFrame = cloneFrame(nextActive);
    if (payload.rectification) {
      rectifyWidthInput.value = String(payload.rectification.output.width);
      rectifyHeightInput.value = String(payload.rectification.output.height);
    } else if (!refreshing) {
      rectifyWidthInput.value = String(nextInitial.renderWidth);
      rectifyHeightInput.value = String(nextInitial.renderHeight);
    }
    rectifyInputsValid = readRectifyOutput() !== undefined;
    rectifyInitialOutput = {
      width: rectifyWidthInput.value,
      height: rectifyHeightInput.value,
    };
    syncWarpControls(nextActive.spec.content.warp);
    resetTransformInputs();
    gestureTranslation = { x: 0, y: 0 };
    lastCompose = undefined;
    transformGestureSession.cancel();
    distortFrameDirty = false;
    lastShownNodes = { nodeIds: nextNodeIds };
    refreshInFlight = false;
    phase = "ready";
    sourceName.textContent = payload.sourceName;
    sourceName.title = payload.sourceName;
    selectionState.hidden = true;
    if (payload.canvas) productWorkspace.enter("canvas");
    if (payload.task) productWorkspace.enter(payload.task.kind);
    controls.hidden = productWorkspace.current() !== "perspective";
    delete controls.dataset.loading;
    syncViewportScene();
    viewport?.fit();
    renderMode();
    setStatus();
    renderState();
    // A same-node refresh rebases geometry; the pre-refresh history entries no
    // longer match the resolved frames, so the session restarts from here.
    history = createEditHistory(currentHistoryEntry());
    if (editorMode === "transform") {
      const initialized = await updateTransformPreview();
      if (initialized && generation === activeGeneration && history) {
        history.resetToBaseline(currentHistoryEntry());
      }
    }
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
  cancelTransformGesturePreview();
  distortEndFrames.cancel();
  lastShownNodes = undefined;
  composeGeneration += 1;
  composeInFlight = false;
  transformInputsValid = true;
  undoRouted = false;
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
  selectionState.setAttribute("role", "alert");
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
    syncViewportScene();
    viewport?.fit();
    if (editorMode === "transform") await updateTransformPreview();
    if (editorMode === "warp") {
      syncWarpControls(initialFrame.spec.content.warp);
      await updateWarpPreview(false);
    }
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
  rectifyWidthInput.value = String(activeFrame.renderWidth);
  rectifyHeightInput.value = String(activeFrame.renderHeight);
  rectifyInitialOutput = {
    width: rectifyWidthInput.value,
    height: rectifyHeightInput.value,
  };
  rectifyInputsValid = true;
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
    showError(userMessage("invalidWarp"));
    renderState();
    return false;
  }
  if (sameWarp(activeFrame?.spec.content.warp, warp)) {
    if (commit) commitHistoryNow();
    return true;
  }
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
    showError(error);
    renderState();
    return false;
  }
}

function requestTransformControlPreview(final: boolean): void {
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
  if (editorMode === "rectify") return;
  if (source === "distort" && editorMode === "distort") {
    // Keep every corner in the stable source frame for the whole Distort
    // session. Tight reframing here would renormalize all four points after
    // pointer-up, making adjacent corners appear to move even though the live
    // gesture held them fixed. Apply and cross-mode transitions own framing.
    distortFrameDirty = true;
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
  history.push(currentHistoryEntry());
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
  const transformSelected = editorMode === "transform";
  const distortSelected = editorMode === "distort";
  const warpSelected = editorMode === "warp";
  const rectifySelected = editorMode === "rectify";
  modeTransformButton.setAttribute("aria-pressed", String(transformSelected));
  modeWarpButton.setAttribute("aria-pressed", String(warpSelected));
  modeRectifyButton.setAttribute("aria-pressed", String(rectifySelected));
  controls.dataset.editorMode = editorMode;
  transformOptions.hidden = !transformSelected;
  warpOptions.hidden = !warpSelected;
  rectifyOptions.hidden = !rectifySelected;
  // Free and Perspective stay visible in every Perspective mode: they are the
  // direct peer choices that re-enter Distort, so hiding them outside Distort
  // would strand the session in Transform, Warp, or Correct.
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

async function applyPerspective(duplicate = false): Promise<void> {
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
  const output = { ...cloneFrame(activeFrame), spec };
  const outputPlan = planOutputForSize({
    width: output.renderWidth,
    height: output.renderHeight,
  });
  if (!outputPlan || !canApplyOutput(outputPlan, outputDensityPolicy)) {
    showError(userMessage("transformOutputLimit", { limit: MAX_FIGMA_IMAGE_AXIS }));
    renderState();
    return;
  }
  const rasterSize = rasterSizeForPolicy(outputPlan, outputDensityPolicy);
  activeFrame = cloneFrame(output);
  transformGestureSession.cancel();
  // This remains pending until the main thread confirms the visible write.
  appliedTransformMemory.begin(generation, {
    initialFrame: cloneFrame(initialFrame),
    finalFrame: cloneFrame(output),
  });
  phase = "applying";
  clearError();
  setStatus(userMessage(!duplicate && source.targetNodeId ? "replacing" : "applying"));
  renderState();
  try {
    const prepared = await prepareFinalSourceRaster(source, rasterSize, spec);
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
  }
}

async function applyRectification(duplicate = false): Promise<void> {
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
  phase = "applying";
  clearError();
  setStatus(userMessage(!duplicate && source.targetNodeId ? "replacing" : "applying"));
  renderState();
  try {
    const plan = await rectifyPlane(rectification);
    const prepared = await prepareRectificationSourceRaster(source, plan);
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
  const bytes = await requestSourceRaster(source, desired);
  return { sourceOverride: await imageFromBytes(bytes), solved };
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
  const bytes = await requestSourceRaster(source, desired);
  return {
    sourceOverride: await imageFromBytes(bytes),
    solved,
    ...(warpMesh ? { warpMesh } : {}),
  };
}

function selectOutputDensityPolicy(policy: OutputDensityPolicy): void {
  if (outputDensityPolicy === policy) return;
  outputDensityPolicy = policy;
  clearError();
  renderState();
}

function currentOutputPlan(): FigmaOutputPlan | undefined {
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
    return planOutputForSize(requested);
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
  outputSizeFlow.textContent = fitted
    ? `${source} → ${requested} → ${applied} px`
    : `${source} → ${requested} px`;
  outputSizeNote.textContent = fitted
    ? translate(activeLocale, "outputFitNote")
    : blocked
      ? translate(activeLocale, "outputOverLimitNote")
      : "";
  if (blocked) outputSize.dataset.blocked = "true";
  else delete outputSize.dataset.blocked;
  outputSize.setAttribute(
    "aria-label",
    translate(
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

function renderState(): void {
  const ready = phase === "ready" && Boolean(current) && Boolean(editor);
  const blockingCompose = composeInFlight && !continuousPreviewInFlight;
  const transformInitializing = ready && editorMode === "transform" && !lastCompose;
  const taskReady = ready && valid && Boolean(activeFrame) && !blockingCompose && !refreshInFlight;
  const sourceCount = current?.sources?.length ?? (current ? 1 : 0);
  const menuReady = taskReady && sourceCount === 1;
  const outputPlan = currentOutputPlan();
  const outputApplicable = canApplyOutput(outputPlan, outputDensityPolicy);
  const positionReady = menuReady && !transformInitializing && editorMode === "transform" && transformInputsValid;
  for (const button of [actionFlipX, actionFlipY, actionRotateCw]) {
    button.disabled = !positionReady;
  }
  actionApplyCopy.disabled =
    !menuReady ||
    // Without an existing result there is nothing to copy beside: the primary
    // Apply already publishes a new image, so the copy variant is redundant.
    !current?.targetNodeId ||
    !outputApplicable ||
    (editorMode === "rectify" && !rectifyInputsValid);
  taskLauncher.setDisabled(!taskReady);
  actionTransformAgain.disabled = !positionReady || !appliedTransformMemory.hasLatest();
  actionUndo.disabled = !ready || !history?.canUndo();
  actionRedo.disabled = !ready || !history?.canRedo();
  pivotPicker.setDisabled(!positionReady);
  placementToggle.disabled = !positionReady;
  positionXInput.disabled = !positionReady;
  positionYInput.disabled = !positionReady;
  renderPlacementFields();
  renderTransformActionStates();
  editor?.setDisabled(!ready || transformInitializing || blockingCompose || refreshInFlight);
  resetButton.disabled = !ready || blockingCompose || refreshInFlight;
  applyButton.disabled =
    !ready ||
    !valid ||
    !transformInputsValid ||
    !outputApplicable ||
    (editorMode === "rectify" && !rectifyInputsValid) ||
    blockingCompose ||
    refreshInFlight;
  const rectificationOnly = editorMode === "rectify" && !rectifyParent;
  modeTransformButton.disabled = !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  modeWarpButton.disabled = !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  modeRectifyButton.disabled = !ready || !valid || blockingCompose || refreshInFlight;
  const peersDisabled =
    !ready || !valid || blockingCompose || refreshInFlight || rectificationOnly;
  distortFreeButton.disabled = peersDisabled;
  distortPerspectiveButton.disabled = peersDisabled;
  transformControls.setDisabled(!ready || refreshInFlight || editorMode !== "transform");
  const warpDisabled = !ready || refreshInFlight || editorMode !== "warp";
  warpPresetSelect.disabled = warpDisabled;
  const warpAmountDisabled = warpDisabled || warpPresetSelect.value === "";
  warpAmountSlider.disabled = warpAmountDisabled;
  warpAmountInput.disabled = warpAmountDisabled;
  rectifyWidthInput.disabled = !ready || refreshInFlight || editorMode !== "rectify";
  rectifyHeightInput.disabled = !ready || refreshInFlight || editorMode !== "rectify";
  renderOutputPolicy();
  renderOutputSize(outputPlan);
  resetButton.textContent = translate(activeLocale, phase === "resetting" ? "resetting" : "reset");
  applyButton.textContent =
    phase === "applied"
      ? translate(activeLocale, "selectSourceAndResult")
      : phase === "applying"
      ? current?.targetNodeId
        ? translate(activeLocale, "replacing")
        : translate(activeLocale, "applying")
      : current?.targetNodeId
        ? translate(activeLocale, "replace")
        : translate(activeLocale, "apply");
  controls.setAttribute(
    "aria-busy",
    String(
      phase === "loading" || phase === "applying" || refreshInFlight || blockingCompose,
    ),
  );
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
  localePreference = preference;
  activeLocale = locale;
  document.documentElement.lang = locale;
  document.body.dataset.i18nReady = "true";
  moreOptionsButton.setAttribute("aria-label", translate(locale, "moreOptions"));
  moreOptionsButton.title = translate(locale, "moreOptions");
  settingsPopover.setAttribute("aria-label", translate(locale, "moreOptions"));
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
  localizeIconAction(actionTransformAgain, translate(locale, "transformAgain"));
  taskLauncher.setLabels(translate(locale, "openTools"), {
    canvas: translate(locale, "canvasTitle"),
    mockup: translate(locale, "workspaceMockup"),
    mesh: translate(locale, "workspaceMesh"),
    remap: translate(locale, "workspaceRemap"),
  });
  taskLauncherLabel.textContent = translate(locale, "tools");
  actionApplyCopy.textContent = translate(locale, "applyAsCopy");
  actionUndo.textContent = translate(locale, "undoEdit");
  actionRedo.textContent = translate(locale, "redoEdit");
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

function meshWorkspaceCopy(): MeshWorkspaceCopy {
  return {
    ...designerCopy("meshTitle"),
    subdivisions: translate(activeLocale, "meshSubdivisions"),
    pointLabel: translate(activeLocale, "meshPointLabel"),
  };
}

function mockupWorkspaceCopy(): MockupWorkspaceCopy {
  return {
    ...designerCopy("mockupTitle"),
    width: translate(activeLocale, "rectifyWidth"),
    height: translate(activeLocale, "rectifyHeight"),
    opacity: translate(activeLocale, "mockupOpacity"),
    grid: translate(activeLocale, "mockupGrid"),
    columns: translate(activeLocale, "mockupColumns"),
    rows: translate(activeLocale, "mockupRows"),
    corner: translate(activeLocale, "mockupCorner"),
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
  selectionState.textContent = translate(activeLocale, selectionMessage);
}

function handleKeydown(event: KeyboardEvent): void {
  const workspace = productWorkspace.current();
  if (workspace === "canvas") {
    canvasWorkspace.handleKeydown(event);
    return;
  }
  if (workspace === "mesh" || workspace === "mockup" || workspace === "remap") {
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
  if (
    shouldRouteAppliedUndo({
      phase,
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      alreadyRouted: undoRouted,
    })
  ) {
    // Once Apply has completed, route the standard shortcut to the Figma
    // document instead of letting the focused plugin input consume it.
    event.preventDefault();
    undoRouted = true;
    post({ type: "trigger-undo" });
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
