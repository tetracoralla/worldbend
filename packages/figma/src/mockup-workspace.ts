import {createCompositionSceneAnimation} from "./composition-scene-animation";
import { normalizedDocumentShape } from "./native-shape";
import { nativeShapeFitGuide, prepareNativeShapeFit } from "./native-shape-fit";
import {
  TransformWebGLRenderer,
  buildMockupPlaneMesh,
  normalizedSpec,
  solveTransformPreview,
  CanvasRasterRenderer,
  paintClipMask, paintMockupShadow,
  type DeformationWorkSpecInput,
  type ShapeFitDomain,
  type MockupPlane,
  type MockupPlanOutput,
  type MockupSpecInput,
  type CanvasOperation,
} from "@worldbend/web";
import { planMockup, shapeFitDomains } from "./designer-plan";
import {createCompositionMotionControls,type CompositionMotionCopy} from "./composition-motion-controls";
import {synchronizeCompositionMotion} from "./composition-motion";
import { renderCompositionOutput } from "./composition-output";
import { copyPlacementParameters, placementParametersJson } from "./copy-parameters";
import { previewScaleFor, scaleSolveByFactor } from "./designer-preview";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import {
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  numericInput,
  postDesignerResult,
  sameJsonValue,
  sameDesignerSelection,
  canRetainDesignerDraft,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
  type LoadedDesignerSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, Placement, SceneContextFrame, UiToMainMessage } from "./messages";
import { sceneContextCoordinates } from "./scene-context-coordinates";
import { createSceneDraftClient } from "./scene-draft-client";
import { LIVE_SCENE_DRAFT_ENABLED } from "./scene-draft-policy";
import { mockupSurfaceControls, parseMockupSurfaceControls } from "./mockup-surface";
import { WARP_PRESETS, parseWarpControls, warpAmountPercent } from "./warp-controls";
import {
  normalizeTemplateName,
  spatialTemplateFromCompositionTask,
  templateSlotsFromSources,
  templateSourceCount,
  type FigmaSpatialTemplate,
} from "./stored-template-library";
import {
  compositionMockup,
  continuedCompositionTask,
  type FigmaCompositionTemplate,
  type FigmaCompositionTask,
} from "./stored-designer-task";

export interface MockupWorkspaceCopy extends DesignerWorkspaceCopy {
  motion: CompositionMotionCopy;
  sceneAnimation:string;sceneAnimationCancel:string;sceneAnimationSave:string;
  agentDraft: string;
  agentDraftUnavailable: string;
  agentDraftUnavailableWithEdits: string;
  agentConflict: string;
  reviewAgent: string;
  keepMine: string;
  keepingMine: string;
  editTarget: string;
  editLayers: string;
  editWhole: string;
  wholeWidth: string;
  wholeHeight: string;
  wholeCorners: string;
  wholeCorner: string;
  warp: string;
  warpNone: string;
  warpPresets: readonly string[];
  warpAmount: string;
  invalidWarp: string;
  surface: string;
  surfaceNone: string;
  cylinder: string;
  fabric: string;
  surfaceWrap: string;
  surfaceDepth: string;
  surfaceTilt: string;
  surfaceFolds: string;
  surfacePhase: string;
  surfaceLight: string;
  surfaceLightStrength: string;
  surfaceLightDirection: string;
  invalidSurface: string;
  shadow:string;shadowOpacity:string;shadowBlur:string;shadowX:string;shadowY:string;shadowColor:string;invalidShadow:string;
  outputMode: string;
  outputSingle: string;
  outputVariants: string;
  addVariant: string;
  removeVariant: string;
  outputName: string;
  outputOperation: string;
  crop: string;
  contain: string;
  cover: string;
  stretch: string;
  cropX: string;
  cropY: string;
  outputWidth: string;
  outputHeight: string;
  backdrop: string;
  width: string;
  height: string;
  opacity: string;
  grid: string;
  columns: string;
  rows: string;
  corner: string;
  templateName: string;
  templateNamePlaceholder: string;
  saveTemplate: string;
  saveScene: string;
  sceneSizes: string;
  scenePreviewUnavailable: string;
  retryScenePreview: string;
  savingTemplate: string;
  templateSaved: string;
  copyParameters: string;
  parametersCopied: string;
  copyParametersFailed: string;
  fitToQuad: string;
  fitToShape: string;
  bendToShape: string;
  fittingDomain:string;
  fittingShape:string;
  nativeOutline:string;
  convexEnvelope:string;
  boundsClip:string;
}

export interface MockupTaskWorkspace extends DesignerTaskWorkspace {
  loadTemplate(template: FigmaSpatialTemplate): boolean;
  finishTemplateSave(requestId: number, error?: string): void;
}

export function createMockupWorkspace(input: {
  root: HTMLElement;
  copy(): MockupWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
  liveDeformationWork?():DeformationWorkSpecInput|undefined;
}): MockupTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="edit-target-label"></span><select data-role="edit-target"><option value="layers"></option><option value="whole"></option></select></label>
    <div data-role="layers-panel"><div class="designer-tabs" data-role="planes" role="tablist"></div>
    <div class="designer-action-stack"><button data-role="backdrop" type="button"></button>
    <button data-role="fit-quad" type="button" hidden></button>
    <button data-role="fit-shape" type="button" hidden></button>
    <button data-role="bend-shape" type="button" hidden></button></div>
    <label class="designer-field" data-role="fit-guide-field" hidden><span data-role="fit-guide-label"></span><select data-role="fit-guide"></select></label>
    <label class="designer-field" data-role="fit-domain-field" hidden><span data-role="fit-domain-label"></span><select data-role="fit-domain"></select></label>
    <div class="designer-row"><label class="designer-field"><span data-role="width-label"></span><input data-role="width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="height-label"></span><input data-role="height" type="number" min="1" max="4096" step="1"></label></div>
    <label class="designer-field"><span data-role="layer-warp-label"></span><select data-role="layer-warp"></select></label>
    <label class="designer-field"><span data-role="layer-warp-amount-label"></span><input data-role="layer-warp-amount" type="range" min="-100" max="100" step="1"><input data-role="layer-warp-amount-number" type="number" min="-100" max="100" step="any"></label>
    <label class="designer-field"><span data-role="surface-label"></span><select data-role="surface"><option value=""></option><option value="cylinder"></option><option value="fabric"></option></select></label>
    <div data-role="surface-controls" hidden>
    <label class="designer-field"><span data-role="surface-amount-label"></span><input data-role="surface-amount" type="range" min="0" max="100" step="1"><input data-role="surface-amount-number" type="number" min="0" max="100" step="any"></label>
    <label class="designer-field" data-role="surface-tilt-field"><span data-role="surface-tilt-label"></span><input data-role="surface-tilt" type="number" min="-100" max="100" step="any"></label>
    <div class="designer-row" data-role="surface-fabric-fields"><label class="designer-field"><span data-role="surface-folds-label"></span><input data-role="surface-folds" type="number" min="1" max="4" step="1"></label><label class="designer-field"><span data-role="surface-phase-label"></span><input data-role="surface-phase" type="number" min="0" max="100" step="any"></label></div>
    <details class="designer-disclosure"><summary data-role="surface-light-label"></summary><label class="designer-field"><span data-role="surface-light-strength-label"></span><input data-role="surface-light" type="range" min="0" max="100" step="1"><input data-role="surface-light-number" type="number" min="0" max="100" step="any"></label><label class="designer-field"><span data-role="surface-direction-label"></span><input data-role="surface-direction" type="range" min="-100" max="100" step="1"><input data-role="surface-direction-number" type="number" min="-100" max="100" step="any"></label></details>
    </div>
    <details class="designer-disclosure"><summary data-role="shadow-label"></summary>
    <label class="designer-field"><span data-role="shadow-opacity-label"></span><input data-role="shadow-opacity" type="range" min="0" max="100" step="1"><input data-role="shadow-opacity-number" type="number" min="0" max="100" step="any"></label>
    <label class="designer-field"><span data-role="shadow-blur-label"></span><input data-role="shadow-blur" type="number" min="0" max="64" step="any"></label>
    <div class="designer-row"><label class="designer-field"><span data-role="shadow-x-label"></span><input data-role="shadow-x" type="number" min="-8192" max="8192" step="any"></label><label class="designer-field"><span data-role="shadow-y-label"></span><input data-role="shadow-y" type="number" min="-8192" max="8192" step="any"></label></div>
    <label class="designer-field"><span data-role="shadow-color-label"></span><input data-role="shadow-color" type="color" value="#000000"></label></details>
    </div><div data-role="whole-panel" hidden>
    <div class="designer-row"><label class="designer-field"><span data-role="whole-width-label"></span><input data-role="whole-width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="whole-height-label"></span><input data-role="whole-height" type="number" min="1" max="4096" step="1"></label></div>
    <label class="designer-field"><span data-role="warp-label"></span><select data-role="warp"></select></label>
    <label class="designer-field"><span data-role="warp-amount-label"></span><input data-role="warp-amount" type="range" min="-100" max="100" step="1"><input data-role="warp-amount-number" type="number" min="-100" max="100" step="any"></label>
    <details class="designer-disclosure" data-role="whole-corners-disclosure"><summary data-role="whole-corners-label"></summary><div data-role="whole-corners"></div></details>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="output-mode-label"></span><select data-role="output-mode"><option value="single"></option><option value="canvasSet"></option></select></label>
    <div data-role="variant-panel" hidden><label class="designer-field"><span data-role="variant-label"></span><select data-role="variant"></select></label>
    <span class="designer-row"><button data-role="add-variant" type="button"></button><button data-role="remove-variant" type="button"></button></span>
    <label class="designer-field"><span data-role="variant-id-label"></span><input data-role="variant-id" type="text" maxlength="64"></label>
    <label class="designer-field"><span data-role="variant-operation-label"></span><select data-role="variant-operation"><option value="contain"></option><option value="cover"></option><option value="stretch"></option><option value="crop"></option></select></label>
    <div class="designer-row" data-role="variant-size"><label class="designer-field"><span data-role="output-width-label"></span><input data-role="output-width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="output-height-label"></span><input data-role="output-height" type="number" min="1" max="4096" step="1"></label></div>
    <div data-role="variant-crop" hidden><div class="designer-row"><label class="designer-field"><span data-role="crop-x-label"></span><input data-role="crop-x" type="number" min="0" max="4095" step="1"></label><label class="designer-field"><span data-role="crop-y-label"></span><input data-role="crop-y" type="number" min="0" max="4095" step="1"></label></div>
    <div class="designer-row"><label class="designer-field"><span data-role="crop-width-label"></span><input data-role="crop-width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="crop-height-label"></span><input data-role="crop-height" type="number" min="1" max="4096" step="1"></label></div></div></div>
    </div><div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="opacity-label"></span><input data-role="opacity" type="range" min="0" max="100" step="1"></label>
    <label class="designer-field"><span><input data-role="grid" type="checkbox"> <span data-role="grid-label"></span></span></label>
    <div class="designer-row" data-role="grid-size"><label class="designer-field"><span data-role="columns-label"></span><input data-role="columns" type="number" min="1" max="64" step="1"></label><label class="designer-field"><span data-role="rows-label"></span><input data-role="rows" type="number" min="1" max="64" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80"></label>
    <span class="designer-row"><button data-role="save-template" type="button"></button> <button data-role="save-scene" type="button" hidden></button> <button data-role="copy-parameters" type="button"></button></span>
    <button data-role="scene-sizes" type="button" hidden></button>
    <div data-role="agent-conflict" hidden><p data-role="agent-conflict-text"></p><span class="designer-row" data-role="agent-conflict-actions"><button data-role="review-agent" type="button"></button> <button data-role="keep-mine" type="button"></button></span></div>`;
  const planes = role<HTMLDivElement>(shell.inspector, "planes");
  const editTarget = role<HTMLSelectElement>(shell.inspector, "edit-target");
  const layersPanel = role<HTMLDivElement>(shell.inspector, "layers-panel");
  const wholePanel = role<HTMLDivElement>(shell.inspector, "whole-panel");
  const backdrop = role<HTMLButtonElement>(shell.inspector, "backdrop");
  const fitQuad = role<HTMLButtonElement>(shell.inspector, "fit-quad");
  const fitShape = role<HTMLButtonElement>(shell.inspector, "fit-shape");
  const bendShape = role<HTMLButtonElement>(shell.inspector, "bend-shape");
  const fitDomain=role<HTMLSelectElement>(shell.inspector,"fit-domain");
  const fitDomainField=role<HTMLElement>(shell.inspector,"fit-domain-field");
  const fitGuide=role<HTMLSelectElement>(shell.inspector,"fit-guide");
  let selectedGuideId:string|undefined;
  fitGuide.addEventListener("change",()=>{selectedGuideId=fitGuide.value;renderControls();});
  function currentGuideIndex():0|1|undefined {
    const index=source?.sources.findIndex(item=>item.sourceNodeId===selectedGuideId);
    return nativeShapeFitGuide(source?.sources??[],index===0||index===1 ? index : undefined);
  }
  let domainKey:string|undefined,domainOptions:ShapeFitDomain[]|undefined,domainEpoch=0;
  const width = role<HTMLInputElement>(shell.inspector, "width");
  const height = role<HTMLInputElement>(shell.inspector, "height");
  const layerWarp = role<HTMLSelectElement>(shell.inspector, "layer-warp");
  const layerWarpAmount = role<HTMLInputElement>(shell.inspector, "layer-warp-amount");
  const layerWarpAmountNumber = role<HTMLInputElement>(shell.inspector, "layer-warp-amount-number");
  const surface = role<HTMLSelectElement>(shell.inspector, "surface");
  const surfaceAmount = role<HTMLInputElement>(shell.inspector, "surface-amount");
  const surfaceAmountNumber = role<HTMLInputElement>(shell.inspector, "surface-amount-number");
  const surfaceTilt = role<HTMLInputElement>(shell.inspector, "surface-tilt");
  const surfaceFolds = role<HTMLInputElement>(shell.inspector, "surface-folds");
  const surfacePhase = role<HTMLInputElement>(shell.inspector, "surface-phase");
  const surfaceLight = role<HTMLInputElement>(shell.inspector, "surface-light");
  const surfaceLightNumber = role<HTMLInputElement>(shell.inspector, "surface-light-number");
  const surfaceDirection = role<HTMLInputElement>(shell.inspector, "surface-direction");
  const surfaceDirectionNumber = role<HTMLInputElement>(shell.inspector, "surface-direction-number");
  const shadowOpacity=role<HTMLInputElement>(shell.inspector,"shadow-opacity"),shadowOpacityNumber=role<HTMLInputElement>(shell.inspector,"shadow-opacity-number");
  const shadowBlur=role<HTMLInputElement>(shell.inspector,"shadow-blur"),shadowX=role<HTMLInputElement>(shell.inspector,"shadow-x"),shadowY=role<HTMLInputElement>(shell.inspector,"shadow-y"),shadowColor=role<HTMLInputElement>(shell.inspector,"shadow-color");
  const opacity = role<HTMLInputElement>(shell.inspector, "opacity");
  const grid = role<HTMLInputElement>(shell.inspector, "grid");
  const gridSize = role<HTMLElement>(shell.inspector, "grid-size");
  const columns = role<HTMLInputElement>(shell.inspector, "columns");
  const rows = role<HTMLInputElement>(shell.inspector, "rows");
  const wholeWidth = role<HTMLInputElement>(shell.inspector, "whole-width");
  const wholeHeight = role<HTMLInputElement>(shell.inspector, "whole-height");
  const wholeCorners = role<HTMLDivElement>(shell.inspector, "whole-corners");
  const warp = role<HTMLSelectElement>(shell.inspector, "warp");
  const warpAmount = role<HTMLInputElement>(shell.inspector, "warp-amount");
  const warpAmountNumber = role<HTMLInputElement>(shell.inspector, "warp-amount-number");
  const outputMode = role<HTMLSelectElement>(shell.inspector, "output-mode");
  const variantPanel = role<HTMLDivElement>(shell.inspector, "variant-panel");
  const variant = role<HTMLSelectElement>(shell.inspector, "variant");
  const addVariant = role<HTMLButtonElement>(shell.inspector, "add-variant");
  const removeVariant = role<HTMLButtonElement>(shell.inspector, "remove-variant");
  const variantId = role<HTMLInputElement>(shell.inspector, "variant-id");
  const variantOperation = role<HTMLSelectElement>(shell.inspector, "variant-operation");
  const variantSize = role<HTMLDivElement>(shell.inspector, "variant-size");
  const variantCrop = role<HTMLDivElement>(shell.inspector, "variant-crop");
  const outputWidth = role<HTMLInputElement>(shell.inspector, "output-width");
  const outputHeight = role<HTMLInputElement>(shell.inspector, "output-height");
  const cropX = role<HTMLInputElement>(shell.inspector, "crop-x");
  const cropY = role<HTMLInputElement>(shell.inspector, "crop-y");
  const cropWidth = role<HTMLInputElement>(shell.inspector, "crop-width");
  const cropHeight = role<HTMLInputElement>(shell.inspector, "crop-height");
  const templateName = role<HTMLInputElement>(shell.inspector, "template-name");
  const saveTemplate = role<HTMLButtonElement>(shell.inspector, "save-template");
  const saveScene = role<HTMLButtonElement>(shell.inspector, "save-scene");
  const sceneSizes = role<HTMLButtonElement>(shell.inspector, "scene-sizes");
  const copyParametersButton = role<HTMLButtonElement>(shell.inspector, "copy-parameters");
  const agentConflict = role<HTMLDivElement>(shell.inspector, "agent-conflict");
  const agentConflictText = role<HTMLParagraphElement>(shell.inspector, "agent-conflict-text");
  const agentConflictActions = role<HTMLSpanElement>(shell.inspector, "agent-conflict-actions");
  const reviewAgentButton = role<HTMLButtonElement>(shell.inspector, "review-agent");
  const keepMineButton = role<HTMLButtonElement>(shell.inspector, "keep-mine");
  const canvas = document.createElement("canvas");
  const sceneCanvas = document.createElement("canvas"); sceneCanvas.hidden = true;
  const retryScenePreview = document.createElement("button"); retryScenePreview.type = "button"; retryScenePreview.hidden = true;
  retryScenePreview.className = "scene-preview-retry";
  shell.preview.append(canvas, sceneCanvas, retryScenePreview);
  const maybeContext = canvas.getContext("2d");
  if (!maybeContext) throw new Error("Canvas 2D is required for Mockup preview");
  const context: CanvasRenderingContext2D = maybeContext;
  const compositionCanvas = document.createElement("canvas");
  const maybeCompositionContext = compositionCanvas.getContext("2d");
  if (!maybeCompositionContext) throw new Error("Canvas 2D is required for Composition preview");
  const compositionContext: CanvasRenderingContext2D = maybeCompositionContext;
  const wholeRenderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  const outputRenderer = new CanvasRasterRenderer(document.createElement("canvas"));
  const cornerInputs = new Map<string, { x: HTMLInputElement; y: HTMLInputElement }>();
  for (const corner of ["tl", "tr", "br", "bl"] as const) {
    const row = document.createElement("div");
    row.className = "designer-row";
    const x = numericInput(corner === "tr" || corner === "br" ? 1 : 0, -2, 3, "0.01");
    const y = numericInput(corner === "bl" || corner === "br" ? 1 : 0, -2, 3, "0.01");
    const xLabel = document.createElement("label");
    const yLabel = document.createElement("label");
    xLabel.className = yLabel.className = "designer-field";
    xLabel.append(document.createElement("span"), x);
    yLabel.append(document.createElement("span"), y);
    row.append(xLabel, yLabel);
    wholeCorners.append(row);
    cornerInputs.set(corner, { x, y });
  }
  const noWholeWarp = document.createElement("option"); noWholeWarp.value = "";
  warp.append(noWholeWarp, ...WARP_PRESETS.map((preset) => {
    const option = document.createElement("option"); option.value = preset; return option;
  }));
  const noLayerWarp = document.createElement("option"); noLayerWarp.value = "";
  layerWarp.append(noLayerWarp, ...WARP_PRESETS.map((preset) => {
    const option = document.createElement("option"); option.value = preset; return option;
  }));
  let source: DesignerWorkspaceSource | undefined;
  let task: FigmaCompositionTask | undefined;
  let baseline: FigmaCompositionTask | undefined;
  let history: WorkspaceHistory<FigmaCompositionTask> | undefined;
  let activePlaneId = "plane-1";
  let editScope: "layers" | "whole" = "layers";
  let overlay: DirectPointOverlay | undefined;
  const renderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  let generation = 0;
  let publicationEpoch = 0;
  let busy = false;
  let refreshing = false;
  let active = false;
  let phase: Phase = "idle";
  let undoRouted = false;
  let appliedResultPending = false;
  let savingTemplate = false;
  let pendingTemplateRequestId: number | undefined;
  let nextTemplateRequestId = 1;
  let templateFeedback: "none" | "saved" | "error" = "none";
  let copyFeedback: "none" | "copied" | "error" = "none";
  let agentDraftLoaded = false;
  let pendingAgentDraft: FigmaCompositionTask | undefined;
  let previewPlan: MockupPlanOutput | undefined;
  let previewGeometryKey = "";
  let controlError: string | undefined;
  let sceneFrame: SceneContextFrame | undefined;
  let nextSceneContextRequestId = 1;
  let pendingSceneContext: { id: number; revision: number } | undefined;
  let scenePreviewError: string | undefined;
  function clearScenePreviewError(): void {
    if (scenePreviewError && shell.error.textContent === scenePreviewError) shell.showError();
    scenePreviewError = undefined;
  }
  retryScenePreview.addEventListener("click", () => { shell.showError(); retryScenePreview.hidden = true; sceneDraft.request(); });
  const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
    if (!active) return;
    fitPreviewCanvas(source?.sceneContext ? sceneCanvas : canvas, shell.preview); overlay?.refresh();
  }) : undefined;
  resizeObserver?.observe(shell.preview);
  const planeLayers: HTMLCanvasElement[] = [];
  const planeShadows:Array<HTMLCanvasElement|undefined>=[],shadowMask=document.createElement("canvas");
  // Continuous plan changes (opacity drags, corner moves) collapse to one
  // preview request per paint. Overlay moves never rebuild the point layer:
  // the moved point is already positioned by the overlay itself, and a
  // rebuild would destroy the focused button after a single keyboard press.
  const previewFrames = createFrameCoalescer(() => void render("preview", false));

  const sceneAnimation=createCompositionSceneAnimation({inspector:shell.inspector,preview:shell.preview,getTask:()=>task,getSources:()=>source?.sources??[],getGeneration:()=>source?.selectionGeneration,
   hasScene:()=>Boolean(source?.sceneContext),isBlocked:()=>busy||refreshing||!active,setBusy:value=>{busy=value;shell.setBusy(value);renderControls()},post:input.post,
   copy:()=>({create:input.copy().sceneAnimation,cancel:input.copy().sceneAnimationCancel,save:input.copy().sceneAnimationSave}),showError:message=>shell.showError(message),render:()=>{renderControls();void render()}});
  const motionControls=createCompositionMotionControls({
    inspector:shell.inspector,preview:shell.preview,output:canvas,
    getTask:()=>task,getPlaneId:()=>activePlaneId,getEditScope:()=>editScope,getTargetLabel:()=>editScope==="whole"?input.copy().editWhole:input.copy().editLayers,getSources:()=>source?.sources??[],isBlocked:()=>busy||refreshing||!active,
    copy:()=>input.copy().motion,formatError:input.formatError,showError:message=>shell.showError(message),
    onPresent:()=>{canvas.hidden=false;sceneCanvas.hidden=true;fitPreviewCanvas(canvas,shell.preview)},
    setBusy:value=>{busy=value;if(value){generation++;previewFrames.cancel();overlay?.interrupt()}shell.setBusy(value);renderControls()},
    setTask:(next,record)=>{task=next;phase="ready";if(record)history?.push(next);},
    render:()=>{renderControls();void render()},
  });

  function currentSpec(): MockupSpecInput | undefined {
    return task ? compositionMockup(task) : undefined;
  }

  function replaceMockup(spec: MockupSpecInput): void {
    if (!task || task.kind === "mockup") task = { kind: "mockup", spec };
    else task = {
      ...task,
      template: {
        ...task.template,
        operation: { ...task.template.operation, composition: spec },
      },
    };
  }

  function selectInitialEditScope(nextTask: FigmaCompositionTask): void {
    editScope = nextTask.kind === "composition" ? "whole" : "layers";
  }

  // Publication-parity feedback on the real Figma canvas. It starts after a
  // composition edit, rather than mutating the document merely on entry.
  const sceneDraft = createSceneDraftClient({
    intervalMs: 250,
    render: async () => {
      if (!task || !source || busy || refreshing || phase !== "ready" || !canvas.width || !canvas.height) return undefined;
      const placement = mockupDraftPlacement();
      if (!placement) return undefined;
      return {
        bytes: await canvasPng(canvas),
        renderWidth: canvas.width,
        renderHeight: canvas.height,
        placement,
      };
    },
    send: (frame) => {
      if (!source) return;
      if (source.sceneContext) {
        const id = nextSceneContextRequestId++;
        pendingSceneContext = { id, revision: generation };
        const showCanvas = Boolean(baseline && task && !sameJsonValue(task, baseline));
        input.post({ type: "request-scene-context", generation: source.selectionGeneration, requestId: id, bytes: frame.bytes,
          showCanvas, ...(source.sceneContextReadOnly && !showCanvas && sameJsonValue(task, source.task) ? { readPublished: true as const } : {}) });
      } else input.post({ type: "scene-draft", generation: source.selectionGeneration, ...frame });
    },
    clear: () => {
      if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
    },
  });
  function clearSceneDraftFeedback(): void {
    sceneDraft.cancel();
    pendingSceneContext = undefined; sceneFrame = undefined;
    clearScenePreviewError();
    sceneCanvas.hidden = true; canvas.hidden = false; retryScenePreview.hidden = true;
    if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
  }
  function mockupDraftPlacement(): Placement | undefined {
    const spec = currentSpec();
    if (!source || !spec) return undefined;
    if (source.targetPlacement) return { ...source.targetPlacement };
    // With no stored target, anchor the composite at its lead plane (the
    // backdrop after Use as backdrop) so the draft covers the real scene,
    // fitted to the composite's aspect inside that document box.
    const leadSourceId = spec.planes[0]?.sourceId;
    const lead = (leadSourceId ? sourceForPlane(source.sources, leadSourceId) : undefined) ?? source.sources[0];
    if (!lead) return undefined;
    const output = canvas.width > 0 && canvas.height > 0 ? canvas : spec.canvas;
    const fit = Math.min(
      lead.placement.width / output.width,
      lead.placement.height / output.height,
    );
    const width = output.width * fit;
    const height = output.height * fit;
    return {
      x: lead.placement.x + (lead.placement.width - width) / 2,
      y: lead.placement.y + (lead.placement.height - height) / 2,
      width,
      height,
    };
  }

  shell.back.addEventListener("click", input.onBack);
  backdrop.addEventListener("click", () => {
    const spec = currentSpec();
    if (!spec || !source || busy || refreshing) return;
    const next = placeOnBackdrop(spec, activePlaneId, source.sources);
    if (!next) return;
    replaceMockup(next);
    history?.push(task!);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    activePlaneId = next.planes[1]?.id ?? next.planes[0]!.id;
    clearFeedback();
    renderControls();
    void render();
  });
  fitQuad.addEventListener("click", () => {
    const spec = currentSpec();
    if (!spec || !source || busy || refreshing) return;
    const next = fitArtworkToQuad(spec, source.sources);
    if (!next) return;
    replaceMockup(next.spec);
    history?.push(task!);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    activePlaneId = next.artworkPlaneId;
    clearFeedback();
    renderControls();
    void render();
  });
  bendShape.addEventListener("click", () => void (async () => {
    const selected=source;
    if (!selected||busy||refreshing) return;
    busy=true;shell.setBusy(true);shell.showError();
    try {
      const prepared=await prepareNativeShapeFit(selected.sources,Number(fitDomain.value)||0,input.liveDeformationWork?.(),currentGuideIndex());
      if (source!==selected||!active||refreshing) return;
      input.post({type:"prepare-shape-fit",generation:selected.selectionGeneration,task:prepared.task});
    } catch(error) {if(source===selected&&active) shell.showError(input.formatError(error));}
    finally {if(source===selected) {busy=false;shell.setBusy(false);renderControls();}}
  })());
  fitShape.addEventListener("click", () => {
    const spec = currentSpec();
    if (!spec || !source || busy || refreshing) return;
    const next = fitArtworkToShape(spec, source.sources);
    if (!next) return;
    replaceMockup(next.spec);
    history?.push(task!);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    activePlaneId = next.artworkPlaneId;
    clearFeedback();
    renderControls();
    void render();
  });
  shell.reset.addEventListener("click", () => {
    if (!baseline) return;
    task = structuredClone(baseline);
    selectInitialEditScope(task);
    agentDraftLoaded = false;
    history?.push(task);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    const spec = currentSpec();
    activePlaneId = initialPlaneId();
    renderControls();
    void render();
  });
  for (const control of [width, height]) control.addEventListener("change", commitCanvasSize);
  function updateLayerWarp(commit: boolean) {
    const plane = activePlane();
    if (!plane || busy || refreshing) return;
    try {
      const nextWarp = parseWarpControls(layerWarp.value, layerWarpAmountNumber.value, plane.transform.content?.warp ?? undefined);
      const { warp: _previous, ...content } = plane.transform.content ?? { fit: "stretch" as const };
      controlError = undefined;
      updateActivePlane({ transform: { ...plane.transform, content: nextWarp ? { ...content, warp: nextWarp } : content } }, commit);
    } catch { rejectControlEdit(); }
  }
  layerWarp.addEventListener("change", () => updateLayerWarp(true));
  layerWarpAmount.addEventListener("input", () => { layerWarpAmountNumber.value = layerWarpAmount.value; updateLayerWarp(false); });
  layerWarpAmount.addEventListener("change", () => { previewFrames.flush(); commitHistory(); });
  layerWarpAmountNumber.addEventListener("change", () => { layerWarpAmount.value = layerWarpAmountNumber.value; updateLayerWarp(true); });
  function updateSurface(commit: boolean) {
    const plane = activePlane();
    if (!plane || busy || refreshing) return;
    try {
      const next = parseMockupSurfaceControls({kind:surface.value,amount:surfaceAmountNumber.value,tilt:surfaceTilt.value,folds:surfaceFolds.value,phase:surfacePhase.value,light:surfaceLightNumber.value,direction:surfaceDirectionNumber.value},plane.surface);
      controlError = undefined;
      // A shape edit reads every numeric field. Keep all coarse sliders at
      // those accepted values, including a number committed by another edit.
      surfaceAmount.value = surfaceAmountNumber.value;
      surfaceLight.value = surfaceLightNumber.value;
      surfaceDirection.value = surfaceDirectionNumber.value;
      updateActivePlane({surface:next ?? null},commit);
      renderSurfaceFields();
    } catch { rejectControlEdit(input.copy().invalidSurface); }
  }
  surface.addEventListener("change", () => updateSurface(true));
  for (const [slider, number] of [[surfaceAmount,surfaceAmountNumber],[surfaceLight,surfaceLightNumber],[surfaceDirection,surfaceDirectionNumber]]) {
    slider!.addEventListener("input", () => { number!.value = slider!.value; updateSurface(false); });
    slider!.addEventListener("change", () => { previewFrames.flush(); commitHistory(); });
    number!.addEventListener("change", () => updateSurface(true));
  }
  for (const number of [surfaceTilt,surfaceFolds,surfacePhase]) number.addEventListener("change", () => updateSurface(true));
  function updateShadow(commit:boolean){
    if(!activePlane()||busy||refreshing)return;
    const amount=Number(shadowOpacityNumber.value),blur=Number(shadowBlur.value),x=Number(shadowX.value),y=Number(shadowY.value),hex=shadowColor.value;
    if(![amount,blur,x,y].every(Number.isFinite)||amount<0||amount>100||blur<0||blur>64||Math.abs(x)>8192||Math.abs(y)>8192||!/^#[0-9a-f]{6}$/i.test(hex)){rejectControlEdit(input.copy().invalidShadow);return}
    shadowOpacity.value=shadowOpacityNumber.value;controlError=undefined;
    updateActivePlane({shadow:{offset:{x,y},blurSigmaPx:blur,color:[parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)],opacity:amount/100}},commit);
  }
  shadowOpacity.addEventListener("input",()=>{shadowOpacityNumber.value=shadowOpacity.value;updateShadow(false)});
  shadowOpacity.addEventListener("change",()=>{previewFrames.flush();commitHistory()});
  for(const control of [shadowOpacityNumber,shadowBlur,shadowX,shadowY,shadowColor])control.addEventListener("change",()=>updateShadow(true));
  opacity.addEventListener("input", () => updateActivePlane({ opacity: Number(opacity.value) / 100 }, false));
  opacity.addEventListener("change", () => { previewFrames.flush(); commitHistory(); });
  grid.addEventListener("change", () => {
    updateActivePlane({ grid: grid.checked ? { columns: 4, rows: 4 } : null }, true);
    renderControls();
  });
  for (const control of [columns, rows]) control.addEventListener("change", () => {
    const active = activePlane();
    if (!active?.grid) return;
    updateActivePlane({ grid: { columns: Number(columns.value), rows: Number(rows.value) } }, true);
  });
  editTarget.addEventListener("change", () => {
    editScope = editTarget.value === "whole" ? "whole" : "layers";
    if (editScope === "whole" && task?.kind === "mockup") {
      task = continuedCompositionTask(task.spec);
      history?.push(task);
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
    }
    renderControls();
    void render();
  });
  for (const control of [wholeWidth, wholeHeight]) control.addEventListener("change", commitWholeTransform);
  for (const controls of cornerInputs.values()) {
    controls.x.addEventListener("change", commitWholeTransform);
    controls.y.addEventListener("change", commitWholeTransform);
  }
  warp.addEventListener("change", commitWholeTransform);
  warpAmount.addEventListener("input", () => { warpAmountNumber.value = warpAmount.value; updateWholeTransform(false); });
  warpAmount.addEventListener("change", () => commitWholeTransform());
  warpAmountNumber.addEventListener("change", () => {
    warpAmount.value = warpAmountNumber.value;
    commitWholeTransform();
  });
  outputMode.addEventListener("change", changeOutputMode);
  variant.addEventListener("change", () => {
    if (task?.kind !== "composition") return;
    task = { ...task, previewOutputId: variant.value };
    commitHistory();
    renderControls();
    void render();
  });
  addVariant.addEventListener("click", addOutputVariant);
  removeVariant.addEventListener("click", removeOutputVariant);
  for (const control of [variantId, variantOperation, outputWidth, outputHeight, cropX, cropY, cropWidth, cropHeight]) {
    control.addEventListener("change", commitOutputVariant);
  }
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));
  templateName.addEventListener("input", () => {
    clearFeedback();
    renderTemplateSave();
  });
  saveTemplate.addEventListener("click", () => void saveCurrentTemplate());
  saveScene.addEventListener("click", () => void saveCurrentScene());
  sceneSizes.addEventListener("click", () => void apply(false, true));
  copyParametersButton.addEventListener("click", () => void copyCurrentParameters());
  reviewAgentButton.addEventListener("click", () => {
    if (!pendingAgentDraft || !source) return;
    clearSceneDraftFeedback();
    task = structuredClone(pendingAgentDraft);
    selectInitialEditScope(task);
    pendingAgentDraft = undefined;
    agentDraftLoaded = true;
    history = createWorkspaceHistory(task);
    phase = "ready";
    appliedResultPending = false;
    shell.status.textContent = input.copy().agentDraft;
    renderControls();
    void render();
  });
  keepMineButton.addEventListener("click", () => {
    if (!pendingAgentDraft) return;
    pendingAgentDraft = undefined;
    agentDraftLoaded = false;
    shell.status.textContent = input.copy().keepingMine;
    renderControls();
    void render();
  });

  function commitCanvasSize(): void {
    const spec = currentSpec();
    if (!spec || !width.validity.valid || !height.validity.valid) return;
    replaceMockup({ ...spec, canvas: { width: Number(width.value), height: Number(height.value) } });
    commitHistory();
    previewFrames.request();
  }
  function initialPlaneId(): string {
    const planes = currentSpec()?.planes;
    return (planes?.find(plane => (plane.opacity ?? 1) > 0) ?? planes?.[0])?.id ?? "plane-1";
  }
  function activePlane(): MockupPlane | undefined { return currentSpec()?.planes.find((plane) => plane.id === activePlaneId); }
  function updateActivePlane(patch: Partial<MockupPlane>, commit: boolean): void {
    const spec = currentSpec();
    if (!spec) return;
    replaceMockup({ ...spec, planes: spec.planes.map((plane) => plane.id === activePlaneId ? { ...plane, ...patch } : plane) });
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    if (commit && task) history?.push(task);
    previewFrames.request();
  }

  function commitHistory(): void {
    if (!task) return;
    history?.push(task);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
  }

  function rejectControlEdit(message = input.copy().invalidWarp): void {
    controlError = message;
    generation += 1;
    previewFrames.cancel();
    clearSceneDraftFeedback();
    shell.showError(controlError);
    shell.apply.disabled = true; shell.applyNew.disabled = true;
    renderTemplateSave();
  }

  function wholeStage() {
    if (task?.kind !== "composition") return undefined;
    const stage = task.template.operation.postprocess.stages[0];
    return stage?.kind === "transform" ? stage : undefined;
  }

  function updateWholeTransform(commit: boolean): void {
    const currentTask = task;
    if (currentTask?.kind !== "composition") return;
    const stage = wholeStage();
    if (!stage || !wholeWidth.validity.valid || !wholeHeight.validity.valid ||
      [...cornerInputs.values()].some(({ x, y }) => !x.validity.valid || !y.validity.valid)) return;
    try {
      const point = (id: "tl" | "tr" | "br" | "bl") => {
        const controls = cornerInputs.get(id)!;
        return { x: Number(controls.x.value), y: Number(controls.y.value) };
      };
      const quad: MockupPlane["transform"]["destination"]["quad"] = {
        tl: point("tl"), tr: point("tr"), br: point("br"), bl: point("bl"),
      };
      const nextWarp = parseWarpControls(warp.value, warpAmountNumber.value, stage.spec.content?.warp ?? undefined);
      controlError = undefined;
      const content = stage.spec.content;
      if (!content) throw new Error("Composition whole-result content is unavailable");
      const { warp: _previousWarp, ...contentWithoutWarp } = content;
      const nextStage = {
        ...stage,
        spec: {
          ...stage.spec,
          destination: { space: "normalized" as const, quad },
          content: nextWarp ? { ...contentWithoutWarp, warp: nextWarp } : contentWithoutWarp,
        },
        target_size: { width: Number(wholeWidth.value), height: Number(wholeHeight.value) },
      };
      task = {
        ...currentTask,
        template: {
          ...currentTask.template,
          operation: {
            ...currentTask.template.operation,
            postprocess: { ...currentTask.template.operation.postprocess, stages: [nextStage] },
          },
        },
      };
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      if (commit && task) history?.push(task);
      previewFrames.request();
    } catch {
      rejectControlEdit();
    }
  }

  function commitWholeTransform(): void {
    updateWholeTransform(true);
  }

  function defaultVariant(id: string): { id: string; operation: CanvasOperation } {
    const stage = wholeStage();
    const size = stage?.target_size ?? currentSpec()?.canvas ?? { width: 1, height: 1 };
    return {
      id,
      operation: {
        kind: "contain",
        output: { width: Math.round(size.width), height: Math.round(size.height) },
        anchor: { x: 0.5, y: 0.5 },
        background: { kind: "transparent" },
      },
    };
  }

  function changeOutputMode(): void {
    if (task?.kind !== "composition") return;
    task = outputMode.value === "canvasSet"
      ? {
          ...task,
          previewOutputId: "output-1",
          template: {
            ...task.template,
            output: {
              kind: "canvasSet",
              spec: { schema: "worldbend.canvas-set", version: "0.1", variants: [defaultVariant("output-1")] },
            },
          },
        }
      : {
          ...task,
          previewOutputId: "output",
          template: { ...task.template, output: { kind: "single", id: "output" } },
        };
    commitHistory();
    renderControls();
    void render();
  }

  function addOutputVariant(): void {
    const currentTask = task;
    if (currentTask?.kind !== "composition" || currentTask.template.output.kind !== "canvasSet" ||
      currentTask.template.output.spec.variants.length >= 8) return;
    const used = new Set(currentTask.template.output.spec.variants.map((item) => item.id));
    let index = used.size + 1;
    while (used.has(`output-${index}`)) index += 1;
    const id = `output-${index}`;
    const variants = [...currentTask.template.output.spec.variants, defaultVariant(id)] as unknown as
      typeof currentTask.template.output.spec.variants;
    task = {
      ...currentTask,
      previewOutputId: id,
      template: { ...currentTask.template, output: { ...currentTask.template.output, spec: { ...currentTask.template.output.spec, variants } } },
    };
    commitHistory();
    renderControls();
    void render();
  }

  function removeOutputVariant(): void {
    const currentTask = task;
    if (currentTask?.kind !== "composition" || currentTask.template.output.kind !== "canvasSet" ||
      currentTask.template.output.spec.variants.length <= 1) return;
    const variants = currentTask.template.output.spec.variants
      .filter((item) => item.id !== currentTask.previewOutputId) as unknown as
      typeof currentTask.template.output.spec.variants;
    const previewOutputId = variants[0]!.id;
    task = {
      ...currentTask,
      previewOutputId,
      template: { ...currentTask.template, output: { ...currentTask.template.output, spec: { ...currentTask.template.output.spec, variants } } },
    };
    commitHistory();
    renderControls();
    void render();
  }

  function commitOutputVariant(): void {
    const currentTask = task;
    if (currentTask?.kind !== "composition" || currentTask.template.output.kind !== "canvasSet") return;
    const current = currentTask.template.output.spec.variants.find((item) => item.id === currentTask.previewOutputId);
    const nextId = variantId.value.trim();
    if (!current || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(nextId) ||
      currentTask.template.output.spec.variants.some((item) => item.id === nextId && item.id !== current.id)) return;
    let operation: CanvasOperation;
    if (variantOperation.value === "crop") {
      operation = { kind: "crop", rect: {
        x: Number(cropX.value), y: Number(cropY.value),
        width: Number(cropWidth.value), height: Number(cropHeight.value),
      } };
    } else if (variantOperation.value === "stretch") {
      operation = { kind: "stretch", output: { width: Number(outputWidth.value), height: Number(outputHeight.value) } };
    } else {
      operation = {
        kind: variantOperation.value === "cover" ? "cover" : "contain",
        output: { width: Number(outputWidth.value), height: Number(outputHeight.value) },
        anchor: { x: 0.5, y: 0.5 }, background: { kind: "transparent" },
      };
    }
    const variants = currentTask.template.output.spec.variants.map((item) => item.id === current.id
      ? { id: nextId, operation } : item) as unknown as typeof currentTask.template.output.spec.variants;
    task = {
      ...currentTask,
      previewOutputId: nextId,
      template: { ...currentTask.template, output: { ...currentTask.template.output, spec: { ...currentTask.template.output.spec, variants } } },
    };
    commitHistory();
    renderControls();
    void render();
  }

  async function render(quality: "preview" | "high" = "preview", refreshOverlay = true): Promise<boolean> {
    let spec = currentSpec();
    if (!active || (quality === "preview" && busy) || !source || !spec) return false;
    if (controlError) {
      shell.showError(controlError);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
      return false;
    }
    const currentGeneration = ++generation;
    try {
      const candidate=task;
      if(candidate?.kind==="composition"&&candidate.motion){
        const next=await synchronizeCompositionMotion(candidate);
        if(currentGeneration!==generation||task!==candidate)return false;
        if(next.motion)candidate.motion=next.motion;candidate.template=next.template;
        spec=currentSpec();if(!spec)return false;
      }
      const geometryKey = mockupGeometryFingerprint(spec);
      const reusePreview = quality === "preview"
        && previewPlan !== undefined
        && previewGeometryKey === geometryKey
        && planeLayers.length === spec.planes.length;
      const plan = reusePreview && previewPlan ? previewPlan : await planMockup(spec);
      if (currentGeneration !== generation) return false;
      // Preview composites at one shared presentation factor so every plane
      // keeps its relative placement; Apply re-renders the full plan below.
      const factor = quality === "preview"
        ? previewScaleFor(plan.canvas.width, plan.canvas.height)
        : 1;
      const previewWidth = Math.max(1, Math.round(plan.canvas.width * factor));
      const previewHeight = Math.max(1, Math.round(plan.canvas.height * factor));
      if (compositionCanvas.width !== previewWidth) compositionCanvas.width = previewWidth;
      if (compositionCanvas.height !== previewHeight) compositionCanvas.height = previewHeight;
      if (!reusePreview) {
        const meshes = await Promise.all(plan.planes.map(buildMockupPlaneMesh));
        if (currentGeneration !== generation) return false;
        planeLayers.length = 0;planeShadows.length=0;
        for (let index = 0; index < plan.planes.length; index += 1) {
          const plane = plan.planes[index]!;
          const image = sourceForPlane(source.sources, plane.sourceId);
          if (!image) throw new Error(`Missing ${plane.sourceId}`);
          if(plane.shadow&&plane.shadow.shadow.opacity>0){
            renderer.render(image.image,scaleSolveByFactor(plane.shadow.solve,factor),meshes[index],quality);
            const layer=document.createElement("canvas");layer.width=renderer.canvas.width;layer.height=renderer.canvas.height;
            const context=layer.getContext("2d");if(!context)throw Error("Canvas 2D is required for shadow preview");context.drawImage(renderer.canvas,0,0);planeShadows.push(layer);
          }else planeShadows.push(undefined);
          renderer.render(image.image, scaleSolveByFactor(plane.solve, factor), meshes[index], quality);
          const layer = document.createElement("canvas");
          layer.width = renderer.canvas.width;
          layer.height = renderer.canvas.height;
          const layerContext = layer.getContext("2d");
          if (!layerContext) throw new Error("Canvas 2D is required for Mockup preview");
          layerContext.drawImage(renderer.canvas, 0, 0);
          planeLayers.push(layer);
        }
        if (quality === "preview") {
          previewPlan = plan;
          previewGeometryKey = geometryKey;
        } else {
          previewPlan = undefined;
          previewGeometryKey = "";
        }
      }
      if (currentGeneration !== generation) return false;
      compositionContext.setTransform(factor, 0, 0, factor, 0, 0);
      compositionContext.clearRect(0, 0, plan.canvas.width, plan.canvas.height);
      if (plan.background.kind === "color") {
        const [r, g, b, a] = plan.background.rgba;
        compositionContext.fillStyle = `rgba(${r} ${g} ${b} / ${a / 255})`;
        compositionContext.fillRect(0, 0, plan.canvas.width, plan.canvas.height);
      }
      for (let index = 0; index < plan.planes.length; index += 1) {
        const plane = plan.planes[index]!;
        const layer = planeLayers[index];
        if (!layer) throw new Error(`Missing ${plane.id}`);
        const opacity = spec.planes.find((candidate) => candidate.id === plane.id)?.opacity ?? plane.opacity;
        const shadowLayer=planeShadows[index];if(shadowLayer&&plane.shadow)paintMockupShadow(compositionContext,shadowLayer,plane.shadow,opacity,factor,shadowMask);
        compositionContext.save();
        compositionContext.globalAlpha = opacity;
        compositionContext.drawImage(
          layer,
          0,
          0,
          plane.solve.resolvedDestination.reference.width,
          plane.solve.resolvedDestination.reference.height,
        );
        compositionContext.restore();
        if (plane.grid) drawGrid(compositionContext, plane.grid, 1 / factor);
      }
      if (spec.clip) applyClipToCanvas(compositionContext, spec.clip, plan.canvas);
      const renderedTask=task;
      if(!await renderTaskOutput(quality,()=>currentGeneration===generation&&task===renderedTask&&active))return false;
      fitPreviewCanvas(canvas, shell.preview);
      if (source.sceneContext && quality === "preview") {
        canvas.hidden = true; sceneCanvas.hidden = false;
        if (!sceneFrame) { sceneCanvas.width = canvas.width; sceneCanvas.height = canvas.height; sceneCanvas.getContext("2d")?.drawImage(canvas, 0, 0); }
        fitPreviewCanvas(sceneCanvas, shell.preview);
      }
      shell.showError(motionControls.error);
      motionControls.sync();
      shell.apply.disabled = busy || refreshing || Boolean(pendingAgentDraft);
      shell.applyNew.disabled = shell.apply.disabled;
      renderTemplateSave();
      if (refreshOverlay && quality === "preview") renderOverlay();
      if (LIVE_SCENE_DRAFT_ENABLED && quality === "preview" && phase === "ready" && !busy && !refreshing) {
        if (source.sceneContext || (baseline && task && !sameJsonValue(task, baseline))) sceneDraft.request();
        else clearSceneDraftFeedback();
      }
      return true;
    } catch (error) {
      if (currentGeneration !== generation) return false;
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;planeShadows.length=0;
      clearSceneDraftFeedback();
      shell.showError(input.formatError(error));
      shell.apply.disabled = true; shell.applyNew.disabled = true;
      return false;
    }
  }

  async function renderTaskOutput(quality: "preview" | "high",isCurrent:()=>boolean): Promise<boolean> {
    if (!task || task.kind === "mockup" || (quality === "preview" && editScope === "layers")) {
      if (canvas.width !== compositionCanvas.width) canvas.width = compositionCanvas.width;
      if (canvas.height !== compositionCanvas.height) canvas.height = compositionCanvas.height;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(compositionCanvas, 0, 0);
      return isCurrent();
    }
    const rendered = await renderCompositionOutput(task, compositionCanvas, wholeRenderer, outputRenderer, quality,undefined,isCurrent);
    if(!isCurrent())return false;
    if (canvas.width !== rendered.width) canvas.width = rendered.width;
    if (canvas.height !== rendered.height) canvas.height = rendered.height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(rendered, 0, 0);
    return true;
  }

  function renderControls(): void {
    sceneAnimation.sync();
    motionControls.sync();
    shell.preview.inert=busy||refreshing;
    for(const layer of shell.preview.querySelectorAll<HTMLElement>(".direct-point-layer"))layer.hidden=busy||refreshing;
    const spec = currentSpec();
    if (!spec) return;
    if (controlError) { controlError = undefined; previewFrames.request(); }
    editTarget.value = editScope;
    layersPanel.hidden = editScope !== "layers";
    wholePanel.hidden = editScope !== "whole";
    backdrop.textContent = input.copy().backdrop;
    backdrop.disabled = busy || refreshing || spec.planes.length < 2;
    fitQuad.textContent = input.copy().fitToQuad;
    fitQuad.hidden = fitToQuadCandidate(spec, source?.sources ?? []) === undefined;
    fitQuad.disabled = busy || refreshing;
    fitShape.textContent = input.copy().fitToShape;
    fitShape.hidden = fitToShapeCandidate(spec, source?.sources ?? []) === undefined;
    fitShape.disabled = busy || refreshing;
    bendShape.textContent=input.copy().bendToShape;
    const guideIndex=currentGuideIndex();
    bendShape.hidden=guideIndex===undefined;
    role<HTMLElement>(shell.inspector,"fit-guide-label").textContent=input.copy().fittingShape;
    role<HTMLElement>(shell.inspector,"fit-guide-field").hidden=bendShape.hidden;
    fitGuide.replaceChildren(...(source?.sources??[]).filter(item=>item.shapeGuide).map(item=>{
      const option=document.createElement("option");option.value=item.sourceNodeId;option.textContent=item.sourceName;return option;
    }));
    fitGuide.value=guideIndex===undefined ? "" : source!.sources[guideIndex]!.sourceNodeId;
    fitGuide.disabled=busy||refreshing;
    role<HTMLElement>(shell.inspector,"fit-domain-label").textContent=input.copy().fittingDomain;
    fitDomainField.hidden=bendShape.hidden;
    const guide=guideIndex===undefined ? undefined : source?.sources[guideIndex]?.shapeGuide;
    const key=guide ? JSON.stringify(guide) : undefined;
    if(key!==domainKey) {
      domainKey=key;domainOptions=undefined;const epoch=++domainEpoch;
      fitDomain.replaceChildren();fitDomain.disabled=true;
      if(guide) void shapeFitDomains(normalizedDocumentShape(guide)).then(options=>{
        if(domainEpoch!==epoch) return;
        domainOptions=options;renderControls();
      }).catch(error=>{if(domainEpoch===epoch) shell.showError(input.formatError(error));});
    }
    if(domainOptions) {
      const selected=fitDomain.value;
      fitDomain.replaceChildren(...domainOptions.map((option,index)=>{
        const element=document.createElement("option");element.value=String(index);
        element.textContent=option.kind === "nativeContour" ? input.copy().nativeOutline : option.kind === "convexEnvelope" ? input.copy().convexEnvelope : input.copy().boundsClip;
        return element;
      }));
      if(selected && domainOptions[Number(selected)]) fitDomain.value=selected;
      fitDomain.disabled=busy||refreshing;
    }
    bendShape.disabled=busy||refreshing||!domainOptions;
    width.value = String(spec.canvas.width);
    height.value = String(spec.canvas.height);
    const restorePlaneFocus = planes.contains(document.activeElement);
    planes.replaceChildren();
    for (const plane of spec.planes) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      const artwork = source ? sourceForPlane(source.sources, plane.sourceId) : undefined;
      const name = document.createElement("span");
      name.textContent = artwork?.sourceName ?? plane.id;
      button.append(name);
      button.title = name.textContent;
      button.tabIndex = plane.id === activePlaneId ? 0 : -1;
      if (artwork) {
        const thumbnail = document.createElement("canvas");
        thumbnail.width = 64; thumbnail.height = 52;
        thumbnail.setAttribute("aria-hidden", "true");
        const fit = Math.min(64 / artwork.image.width, 52 / artwork.image.height);
        const w = artwork.image.width * fit, h = artwork.image.height * fit;
        thumbnail.getContext("2d")?.drawImage(artwork.image, (64 - w) / 2, (52 - h) / 2, w, h);
        thumbnail.className = "plane-thumbnail";
        button.prepend(thumbnail);
      }
      button.setAttribute("aria-selected", String(plane.id === activePlaneId));
      button.addEventListener("click", () => { activePlaneId = plane.id; renderControls(); renderOverlay(); });
      button.addEventListener("keydown", event => {
        const tabs = [...planes.querySelectorAll<HTMLButtonElement>("button")];
        const index = tabs.indexOf(button);
        const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowDown" ? (index + 1) % tabs.length : event.key === "ArrowUp" ? (index + tabs.length - 1) % tabs.length : -1;
        if (next < 0) return;
        event.preventDefault();
        tabs[next]?.click();
      });
      planes.append(button);
    }
    if (restorePlaneFocus) planes.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    const active = activePlane();
    layerWarp.value = active?.transform.content?.warp?.preset ?? "";
    layerWarpAmountNumber.value = warpAmountPercent(active?.transform.content?.warp ?? undefined);
    layerWarpAmount.value = layerWarpAmountNumber.value;
    const surfaceFields = mockupSurfaceControls(active?.surface);
    surface.value = surfaceFields.kind;
    surfaceAmountNumber.value = surfaceFields.amount; surfaceAmount.value = surfaceFields.amount;
    surfaceTilt.value = surfaceFields.tilt; surfaceFolds.value = surfaceFields.folds; surfacePhase.value = surfaceFields.phase;
    surfaceLightNumber.value = surfaceFields.light; surfaceLight.value = surfaceFields.light;
    surfaceDirectionNumber.value = surfaceFields.direction; surfaceDirection.value = surfaceFields.direction;
    renderSurfaceFields();
    const shadow=active?.shadow;shadowOpacityNumber.value=String((shadow?.opacity??0)*100);shadowOpacity.value=shadowOpacityNumber.value;
    shadowBlur.value=String(shadow?.blurSigmaPx??12);shadowX.value=String(shadow?.offset.x??8);shadowY.value=String(shadow?.offset.y??16);shadowColor.value="#"+(shadow?.color??[0,0,0]).map(n=>n.toString(16).padStart(2,"0")).join("");
    opacity.value = String(Math.round((active?.opacity ?? 1) * 100));
    grid.checked = Boolean(active?.grid);
    gridSize.hidden = !active?.grid;
    columns.value = String(active?.grid?.columns ?? 4);
    rows.value = String(active?.grid?.rows ?? 4);
    if (task?.kind === "composition") renderWholeControls();
    shell.setPublicationTarget(source, "composition");
    if (source?.mockupDraftUnavailable) shell.status.textContent = unavailableDraftCopy();
    else if (agentDraftLoaded) shell.status.textContent = input.copy().agentDraft;
    agentConflict.hidden = !pendingAgentDraft && !source?.mockupDraftUnavailable && !agentDraftLoaded;
    agentConflictText.textContent = pendingAgentDraft ? input.copy().agentConflict
      : source?.mockupDraftUnavailable ? unavailableDraftCopy() : input.copy().agentDraft;
    agentConflictActions.hidden = !pendingAgentDraft;
    if (pendingAgentDraft) {
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      shell.status.textContent = input.copy().agentConflict;
    }
    renderTemplateSave();
  }

  function renderWholeControls(): void {
    const compositionTask = task;
    if (compositionTask?.kind !== "composition") return;
    const stage = wholeStage();
    if (!stage?.target_size) return;
    wholeWidth.value = String(stage.target_size.width);
    wholeHeight.value = String(stage.target_size.height);
    for (const [id, controls] of cornerInputs) {
      const point = stage.spec.destination.quad[id as keyof typeof stage.spec.destination.quad];
      controls.x.value = String(point.x);
      controls.y.value = String(point.y);
    }
    const content = stage.spec.content;
    warp.value = content?.warp?.preset ?? "";
    warpAmountNumber.value = warpAmountPercent(content?.warp ?? undefined);
    warpAmount.value = warpAmountNumber.value;
    outputMode.value = compositionTask.template.output.kind;
    variantPanel.hidden = compositionTask.template.output.kind !== "canvasSet";
    if (compositionTask.template.output.kind !== "canvasSet") return;
    const variants = compositionTask.template.output.spec.variants;
    variant.replaceChildren(...variants.map((item) => {
      const option = document.createElement("option"); option.value = item.id; option.textContent = item.id; return option;
    }));
    variant.value = compositionTask.previewOutputId;
    const active = variants.find((item) => item.id === compositionTask.previewOutputId) ?? variants[0];
    if (!active) return;
    variantId.value = active.id;
    variantOperation.value = active.operation.kind;
    const operation = active.operation;
    const crop = operation.kind === "crop";
    variantCrop.hidden = !crop;
    variantSize.hidden = crop;
    if (crop) {
      cropX.value = String(operation.rect.x);
      cropY.value = String(operation.rect.y);
      cropWidth.value = String(operation.rect.width);
      cropHeight.value = String(operation.rect.height);
    } else {
      const output = "output" in operation ? operation.output : stage.target_size;
      outputWidth.value = String(output.width);
      outputHeight.value = String(output.height);
    }
    addVariant.disabled = variants.length >= 8 || busy || refreshing;
    removeVariant.disabled = variants.length <= 1 || busy || refreshing;
  }

  function unavailableDraftCopy(): string {
    return task && baseline && !sameJsonValue(task, baseline)
      ? input.copy().agentDraftUnavailableWithEdits
      : input.copy().agentDraftUnavailable;
  }

  function renderOverlay(): void {
    overlay?.dispose();
    if (editScope !== "layers") return;
    const plane = activePlane();
    if (!plane) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas: source?.sceneContext ? sceneCanvas : canvas,
      coordinates: {
        project: point => sceneFrame ? sceneContextCoordinates(sceneFrame).project(point) : point,
        unproject: point => sceneFrame ? sceneContextCoordinates(sceneFrame).unproject(point) : point,
      },
      onMove(id, point, final) {
        const current = activePlane();
        if (!current || busy || refreshing || !active) return;
        const quad = { ...current.transform.destination.quad, [id]: point };
        const spec = currentSpec();
        if (!spec) return;
        replaceMockup({ ...spec, planes: spec.planes.map((candidate) => candidate.id === activePlaneId
          ? { ...candidate, transform: { ...candidate.transform, destination: { space: "normalized", quad } } }
          : candidate) });
        phase = "ready";
        undoRouted = false;
        appliedResultPending = false;
        previewFrames.request();
        if (final && task) { previewFrames.flush(); history?.push(task); }
      },
    });
    const copy = input.copy();
    overlay.set((["tl", "tr", "br", "bl"] as const).map((id) => ({ id, ...plane.transform.destination.quad[id], label: copy.corner.replace("{corner}", id.toUpperCase()) })));
  }

  async function apply(duplicate: boolean, sizeScene = false): Promise<void> {
    const spec = currentSpec();
    if (!active || !source || !spec || !task || busy || refreshing || pendingAgentDraft || controlError) return;
    if (sizeScene && (!source.sceneContext || !source.targetNodeId || duplicate)) return;
    overlay?.interrupt();
    clearSceneDraftFeedback();
    previewFrames.cancel();
    const appliedSource = source;
    const appliedTask = task;
    const epoch = ++publicationEpoch;
    const current = () => active && publicationEpoch === epoch && source === appliedSource && task === appliedTask;
    busy = true;
    phase = "applying";
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      const valid = await render("high");
      if (!current()) return;
      if (!valid) throw new Error("Mockup output is invalid");
      const bytes = await canvasPng(canvas);
      if (!current()) return;
      postDesignerResult({ post: input.post, source: appliedSource, task: appliedTask,
        bytes, width: canvas.width, height: canvas.height, duplicate, ...(sizeScene ? { sceneSizes: true } : {}) });
    } catch (error) {
      if (!current()) return;
      recoverFailedApply(input.formatError(error));
    }
  }

  function recoverFailedApply(message: string): void {
    const recoverySource = source;
    const recoveryTask = task;
    busy = false;
    phase = "ready";
    appliedResultPending = false;
    shell.setBusy(false);
    renderControls();
    renderTemplateSave();
    shell.showError(message);
    // Rebuild both panel and canvas feedback. render() clears stale errors on
    // success, so restore the publication error after the async frame lands.
    void render().then(() => {
      if (
        active &&
        !busy &&
        !refreshing &&
        phase === "ready" &&
        source === recoverySource &&
        task === recoveryTask
      ) shell.showError(message);
    });
  }

  function restoreHistory(restored: FigmaCompositionTask): void {
    task = restored;
    const spec = currentSpec();
    if (!spec) return;
    if (!spec.planes.some((plane) => plane.id === activePlaneId)) {
      activePlaneId = initialPlaneId();
    }
    renderControls();
    void render();
  }

  async function saveCurrentTemplate(): Promise<void> {
    const name = normalizeTemplateName(templateName.value);
    const spec = currentSpec();
    if (!spec || !task || !name || savingTemplate || controlError) return;
    clearFeedback();
    savingTemplate = true;
    renderTemplateSave();
    shell.status.textContent = input.copy().savingTemplate;
    try {
      const template = spatialTemplateFromCompositionTask(task);
      const savedSlots = templateSlotsFromSources(source?.sources ?? []);
      const plan = await planMockup(spec);
      const slots = new Set(plan.planes.map((plane) => plane.sourceId));
      if (slots.size !== templateSourceCount(template)) {
        throw new Error("The template is not compatible with this workspace");
      }
      const requestId = nextTemplateRequestId;
      nextTemplateRequestId += 1;
      pendingTemplateRequestId = requestId;
      input.post({
        type: "save-template",
        workspace: "mockup",
        requestId,
        name,
        template,
        ...(savedSlots ? { slots: savedSlots } : {}),
      });
    } catch (error) {
      savingTemplate = false;
      pendingTemplateRequestId = undefined;
      shell.status.textContent = "";
      templateFeedback = "error";
      renderTemplateSave();
      shell.showError(input.formatError(error));
    }
  }

  async function saveCurrentScene(): Promise<void> {
    const name = normalizeTemplateName(templateName.value);
    if (!active || !source?.sceneContext || !source.targetNodeId || !task || !name || busy || savingTemplate || refreshing || pendingAgentDraft || controlError) return;
    const savingSource = source, savingTask = task, epoch = publicationEpoch;
    const current = () => active && source === savingSource && task === savingTask && publicationEpoch === epoch;
    clearFeedback(); savingTemplate = true; busy = true; shell.setBusy(true);
    renderTemplateSave(); shell.status.textContent = input.copy().savingTemplate;
    try {
      overlay?.interrupt(); previewFrames.cancel();
      if (!await render("high") || !current()) throw new Error("The scene changed while it was being saved. Save it again.");
      const bytes = await canvasPng(canvas);
      if (!current()) return;
      const requestId = nextTemplateRequestId++; pendingTemplateRequestId = requestId;
      input.post({ type: "save-native-scene", generation: savingSource.selectionGeneration, requestId,
        targetNodeId: savingSource.targetNodeId!, name, task: savingTask, bytes, renderWidth: canvas.width, renderHeight: canvas.height });
    } catch (error) {
      if (!current()) return;
      savingTemplate = false; pendingTemplateRequestId = undefined; shell.status.textContent = "";
      shell.showError(input.formatError(error));
    } finally {
      if (current()) { busy = false; shell.setBusy(false); renderControls(); renderTemplateSave(); }
    }
  }

  function clearFeedback(): void {
    if (templateFeedback === "saved" || copyFeedback === "copied") shell.status.textContent = "";
    if (templateFeedback === "error" || copyFeedback === "error") shell.showError();
    templateFeedback = "none";
    copyFeedback = "none";
  }

  async function copyCurrentParameters(): Promise<void> {
    if (!task || controlError) return;
    clearFeedback();
    const copied = await copyPlacementParameters(compositionParametersJson(task));
    copyFeedback = copied ? "copied" : "error";
    shell.status.textContent = copied ? input.copy().parametersCopied : "";
    if (!copied) shell.showError(input.copy().copyParametersFailed);
  }

  function renderSurfaceFields(): void {
    role<HTMLElement>(shell.inspector,"surface-controls").hidden = surface.value === "";
    role<HTMLElement>(shell.inspector,"surface-tilt-field").hidden = surface.value !== "cylinder";
    role<HTMLElement>(shell.inspector,"surface-fabric-fields").hidden = surface.value !== "fabric";
    role<HTMLElement>(shell.inspector,"surface-amount-label").textContent = surface.value === "fabric" ? input.copy().surfaceDepth : input.copy().surfaceWrap;
  }

  function renderTemplateSave(): void {
    surface.disabled = busy || refreshing;
    for(const control of [shadowOpacity,shadowOpacityNumber,shadowBlur,shadowX,shadowY,shadowColor])control.disabled=busy||refreshing;
    for (const field of [surfaceAmount,surfaceAmountNumber,surfaceTilt,surfaceFolds,surfacePhase,surfaceLight,surfaceLightNumber,surfaceDirection,surfaceDirectionNumber]) field.disabled = busy || refreshing || surface.value === "";
    layerWarpAmount.disabled = layerWarpAmountNumber.disabled = busy || refreshing || layerWarp.value === "";
    warpAmount.disabled = warpAmountNumber.disabled = busy || refreshing || warp.value === "";
    templateName.disabled = busy || savingTemplate || !task;
    saveTemplate.disabled = busy || savingTemplate || !task || !normalizeTemplateName(templateName.value) || Boolean(controlError);
    saveScene.hidden = !source?.sceneContext;
    saveScene.textContent = input.copy().saveScene;
    saveScene.disabled = busy || savingTemplate || refreshing || !task || Boolean(pendingAgentDraft) || !normalizeTemplateName(templateName.value) || Boolean(controlError);
    sceneSizes.hidden = !source?.sceneContext;
    sceneSizes.textContent = input.copy().sceneSizes;
    sceneSizes.disabled = busy || savingTemplate || refreshing || !task || Boolean(pendingAgentDraft) || Boolean(controlError);
    copyParametersButton.disabled = busy || !task || Boolean(controlError);
  }

  return {
    enter() { active = true; sceneAnimation.sync();motionControls.sync(); shell.root.hidden = false; void render(); overlay?.refresh(); },
    leave() { sceneAnimation.suspend();motionControls.suspend(); overlay?.interrupt(); clearSceneDraftFeedback(); publicationEpoch += 1; active = false; busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false); shell.root.hidden = true; generation += 1; previewFrames.cancel(); previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;planeShadows.length=0; },
    selectionLoading() {
      sceneAnimation.suspend();motionControls.suspend();      overlay?.interrupt();
      clearSceneDraftFeedback();
      refreshing = true; publicationEpoch += 1; generation += 1; previewFrames.cancel();
      busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
    },
    setSource(next) {
      sceneAnimation.suspend();motionControls.suspend();refreshing = false;
      const retain = canRetainDesignerDraft(source, next) && task !== undefined;
      const sameEditableContext = Boolean(source && task && baseline &&
        sameDesignerSelection(source, next) && sameJsonValue(source.task, next.task) &&
        source.sources.every((candidate, index) => candidate.renderWidth === next.sources[index]?.renderWidth &&
          candidate.renderHeight === next.sources[index]?.renderHeight));
      const incomingAgentConflict = Boolean(source && sameEditableContext && next.mockupDraft &&
        !sameJsonValue(source.mockupDraft, next.mockupDraft) &&
        !sameJsonValue(task, baseline) &&
        !(agentDraftLoaded && source.mockupDraft && sameJsonValue(task, source.mockupDraft.task)));
      const loadedAgentDraftWithoutLocalEdits = Boolean(agentDraftLoaded && source?.mockupDraft && task &&
        sameJsonValue(task, source.mockupDraft.task));
      const unusableDraftRefresh = Boolean(sameEditableContext && next.mockupDraftUnavailable &&
        !sameJsonValue(task, baseline) && !loadedAgentDraftWithoutLocalEdits);

      publicationEpoch += 1; generation += 1; previewFrames.cancel();
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
      if (incomingAgentConflict) {
        pendingAgentDraft = structuredClone(next.mockupDraft!.task);
        previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;planeShadows.length=0;
        renderControls();
        if (active) void render();
        return;
      }
      if (unusableDraftRefresh) {
        pendingAgentDraft = undefined;
        previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;planeShadows.length=0;
        renderControls();
        if (active) void render();
        return;
      }
      if (retain) {
        renderControls();
        previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;planeShadows.length=0;
        if (active) void render();
        return;
      }
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;planeShadows.length=0;
      pendingAgentDraft = undefined;
      const loaded = loadMockupDraft(next);
      agentDraftLoaded = loaded.agentDraftLoaded;
      task = loaded.task;
      baseline = loaded.baseline;
      selectInitialEditScope(task);
      history = createWorkspaceHistory(task);
      phase = "ready";
      undoRouted = false;
      activePlaneId = initialPlaneId();
      clearFeedback();
      if (!savingTemplate) shell.status.textContent = next.mockupDraftUnavailable ? input.copy().agentDraftUnavailable
        : agentDraftLoaded ? input.copy().agentDraft : "";
      shell.showError();
      templateName.value = input.copy().templateNamePlaceholder;
      renderControls();
      renderTemplateSave();
      if (active) void render();
    },
    clearSource(error) { sceneAnimation.suspend();motionControls.suspend(); refreshing = false; clearSceneDraftFeedback(); publicationEpoch += 1; generation += 1; previewFrames.cancel(); overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; agentDraftLoaded = false; pendingAgentDraft = undefined; savingTemplate = false; pendingTemplateRequestId = undefined; templateFeedback = "none"; copyFeedback = "none"; shell.status.textContent = ""; shell.setBusy(false); source = undefined; task = undefined; history = undefined; previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;planeShadows.length=0; shell.showError(error); shell.apply.disabled = true; shell.applyNew.disabled = true; renderTemplateSave(); },
    updateLocale() {
      const copy = input.copy();
      retryScenePreview.textContent = copy.retryScenePreview;
      shell.setCopy(copy);
      for (const [name, text] of [
        ["edit-target-label", copy.editTarget],
        ["shadow-label",copy.shadow],["shadow-opacity-label",copy.shadowOpacity],["shadow-blur-label",copy.shadowBlur],["shadow-x-label",copy.shadowX],["shadow-y-label",copy.shadowY],["shadow-color-label",copy.shadowColor], ["whole-width-label", copy.wholeWidth],
        ["layer-warp-label", copy.warp], ["layer-warp-amount-label", copy.warpAmount],
        ["surface-label",copy.surface], ["surface-tilt-label",copy.surfaceTilt], ["surface-folds-label",copy.surfaceFolds], ["surface-phase-label",copy.surfacePhase], ["surface-light-label",copy.surfaceLight], ["surface-light-strength-label",copy.surfaceLightStrength], ["surface-direction-label",copy.surfaceLightDirection],
        ["whole-height-label", copy.wholeHeight], ["warp-label", copy.warp],
        ["whole-corners-label", copy.wholeCorners],
        ["warp-amount-label", copy.warpAmount], ["output-mode-label", copy.outputMode],
        ["variant-label", copy.outputVariants], ["variant-id-label", copy.outputName],
        ["variant-operation-label", copy.outputOperation], ["output-width-label", copy.outputWidth],
        ["output-height-label", copy.outputHeight], ["crop-x-label", copy.cropX],
        ["crop-y-label", copy.cropY], ["crop-width-label", copy.outputWidth],
        ["crop-height-label", copy.outputHeight], ["width-label", copy.width],
        ["height-label", copy.height], ["opacity-label", copy.opacity], ["grid-label", copy.grid],
        ["columns-label", copy.columns], ["rows-label", copy.rows], ["template-name-label", copy.templateName],
      ] as const) role<HTMLElement>(shell.inspector, name).textContent = text;
      shadowOpacity.setAttribute("aria-label",copy.shadowOpacity);
      shadowOpacityNumber.setAttribute("aria-label",copy.shadowOpacity);
      surface.options[0]!.textContent = copy.surfaceNone; surface.options[1]!.textContent = copy.cylinder; surface.options[2]!.textContent = copy.fabric;
      renderSurfaceFields();
      const targetOptions = editTarget.options;
      targetOptions[0]!.textContent = copy.editLayers;
      targetOptions[1]!.textContent = copy.editWhole;
      outputMode.options[0]!.textContent = copy.outputSingle;
      outputMode.options[1]!.textContent = copy.outputVariants;
      variantOperation.options[0]!.textContent = copy.contain;
      variantOperation.options[1]!.textContent = copy.cover;
      variantOperation.options[2]!.textContent = copy.stretch;
      variantOperation.options[3]!.textContent = copy.crop;
      addVariant.textContent = copy.addVariant;
      removeVariant.textContent = copy.removeVariant;
      [...cornerInputs].forEach(([corner, controls]) => {
        const labels = [controls.x.parentElement, controls.y.parentElement];
        labels[0]?.querySelector("span")?.replaceChildren(`${copy.wholeCorner.replace("{corner}", corner.toUpperCase())} X`);
        labels[1]?.querySelector("span")?.replaceChildren(`${copy.wholeCorner.replace("{corner}", corner.toUpperCase())} Y`);
      });
      [...warp.options].forEach((option, index) => {
        option.textContent = index === 0 ? copy.warpNone : copy.warpPresets[index - 1] ?? option.value;
      });
      [...layerWarp.options].forEach((option, index) => {
        option.textContent = index === 0 ? copy.warpNone : copy.warpPresets[index - 1] ?? option.value;
      });
      templateName.placeholder = copy.templateNamePlaceholder;
      saveTemplate.textContent = copy.saveTemplate;
      copyParametersButton.textContent = copy.copyParameters;
      agentConflictText.textContent = pendingAgentDraft ? copy.agentConflict
        : source?.mockupDraftUnavailable ? unavailableDraftCopy() : copy.agentDraft;
      reviewAgentButton.textContent = copy.reviewAgent;
      keepMineButton.textContent = copy.keepMine;
      renderOverlay();
    },
    handleMainMessage(message: MainToUiMessage) {
      if(sceneAnimation.handle(message))return true;
      if (message.type === "shape-fit-error") {
        if (active && source?.selectionGeneration === message.generation) shell.showError(input.formatError(message.message));
        return true;
      }
      if (message.type === "scene-context-preview") {
        const pending = pendingSceneContext;
        if (!active || !source?.sceneContext || message.generation !== source.selectionGeneration || !pending ||
          message.requestId !== pending.id || pending.revision !== generation) return true;
        const frame = message.frame;
        const accepts = () => active && source?.sceneContext && source.selectionGeneration === message.generation &&
          pendingSceneContext === pending && generation === pending.revision;
        const failed = () => { if (accepts()) { sceneFrame = undefined; sceneCanvas.width = canvas.width; sceneCanvas.height = canvas.height;
          sceneCanvas.getContext("2d")?.drawImage(canvas, 0, 0); fitPreviewCanvas(sceneCanvas, shell.preview); overlay?.refresh(); retryScenePreview.hidden = false;
          retryScenePreview.textContent = input.copy().retryScenePreview;
          scenePreviewError = input.copy().scenePreviewUnavailable; shell.showError(scenePreviewError); } };
        if (!frame) { failed(); return true; }
        const url = URL.createObjectURL(new Blob([new Uint8Array(frame.bytes)], { type: "image/png" }));
        const image = new Image(); image.src = url;
        void image.decode().then(() => {
          if (!accepts()) return;
          sceneContextCoordinates(frame);
          sceneFrame = frame; sceneCanvas.width = image.naturalWidth; sceneCanvas.height = image.naturalHeight;
          sceneCanvas.getContext("2d")?.drawImage(image, 0, 0);
          sceneCanvas.hidden = false; canvas.hidden = true; retryScenePreview.hidden = true;
          clearScenePreviewError();
          fitPreviewCanvas(sceneCanvas, shell.preview); overlay?.refresh();
        }).catch(failed).finally(() => URL.revokeObjectURL(url));
        return true;
      }
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      if (message.type === "apply-designer-error") recoverFailedApply(input.formatError(message.message));
      else {
        if (task && message.operation === "replace" && message.targetNodeId === source.targetNodeId) {
          const { mockupDraft: _draft, mockupDraftUnavailable: _unavailable, ...publishedSource } = source;
          source = { ...publishedSource, task: structuredClone(task) };
          baseline = structuredClone(task);
        }
        busy = false;
        shell.setBusy(false);
        renderTemplateSave();
        phase = "ready";
        appliedResultPending = true;
        agentDraftLoaded = false;
        pendingAgentDraft = undefined;
        undoRouted = false;
        shell.status.textContent = input.copy().applied;
      }
      return true;
    },
    handleKeydown(event) {
      if (event.key === "Escape") { event.preventDefault(); input.onBack(); return true; }
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    loadTemplate(template) {
      sceneAnimation.suspend();motionControls.suspend();      if (!source || templateSourceCount(template) !== source.sources.length) return false;
      const loadedTask: FigmaCompositionTask = template.operation.kind === "mockup"
        ? { kind: "mockup", spec: structuredClone(template.operation.spec) }
        : {
            kind: "composition",
            template: (({motion,...canonical})=>structuredClone(canonical))(template) as FigmaCompositionTemplate,
            ...(template.motion ? {motion:structuredClone(template.motion)} : {}),
            previewOutputId: template.output.kind === "single"
              ? template.output.id
              : template.output.spec.variants[0]?.id ?? "",
          };
      task = loadedTask;
      selectInitialEditScope(task);
      agentDraftLoaded = false;
      pendingAgentDraft = undefined;
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;planeShadows.length=0;
      baseline = structuredClone(loadedTask);
      history = createWorkspaceHistory(loadedTask);
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      activePlaneId = initialPlaneId();
      clearFeedback();
      if (!savingTemplate) shell.status.textContent = "";
      shell.showError();
      templateName.value = input.copy().templateNamePlaceholder;
      renderControls();
      renderTemplateSave();
      if (active) void render();
      return true;
    },
    finishTemplateSave(requestId, error) {
      if (!savingTemplate || pendingTemplateRequestId !== requestId) return;
      savingTemplate = false;
      pendingTemplateRequestId = undefined;
      templateFeedback = error ? "error" : "saved";
      shell.status.textContent = error ? "" : input.copy().templateSaved;
      renderTemplateSave();
      if (error) shell.showError(error);
    },
    dispose() { sceneAnimation.dispose();motionControls.dispose(); resizeObserver?.disconnect(); publicationEpoch += 1; generation += 1; active = false; clearSceneDraftFeedback(); previewFrames.cancel(); overlay?.dispose(); renderer.dispose(); wholeRenderer.dispose(); outputRenderer.dispose();planeLayers.length=0;planeShadows.length=0;shadowMask.width=shadowMask.height=1; },
  };
}

/** Geometry that requires a new solve. Opacity is presentation-only. */
export function mockupGeometryFingerprint(spec: MockupSpecInput): string {
  return JSON.stringify({
    canvas: spec.canvas,
    background: spec.background,
    seams: spec.seams,
    ...(spec.clip ? { clip: spec.clip } : {}),
    planes: spec.planes.map((plane) => ({
      id: plane.id,
      sourceId: plane.sourceId,
      transform: plane.transform,
      grid: plane.grid ?? null,
      surface: plane.surface ?? null,
      shadow:plane.shadow??null,
    })),
  });
}

export function defaultMockup(sources: readonly LoadedDesignerSource[]): MockupSpecInput {
  const left = Math.min(...sources.map((source) => source.placement.x));
  const top = Math.min(...sources.map((source) => source.placement.y));
  const right = Math.max(...sources.map((source) => source.placement.x + source.placement.width));
  const bottom = Math.max(...sources.map((source) => source.placement.y + source.placement.height));
  const scale = Math.min(1, 4096 / Math.max(1, right - left), 4096 / Math.max(1, bottom - top));
  const canvas = { width: Math.max(1, Math.round((right - left) * scale)), height: Math.max(1, Math.round((bottom - top) * scale)) };
  return {
    schema: "worldbend.mockup", version: "0.1", canvas, background: { kind: "transparent" }, seams: [],
    planes: sources.map((source, index) => {
      const x0 = ((source.placement.x - left) * scale) / canvas.width;
      const y0 = ((source.placement.y - top) * scale) / canvas.height;
      const x1 = ((source.placement.x + source.placement.width - left) * scale) / canvas.width;
      const y1 = ((source.placement.y + source.placement.height - top) * scale) / canvas.height;
      return { id: `plane-${index + 1}`, sourceId: `source-${index + 1}`, opacity: 1, transform: normalizedSpec({ tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, br: { x: x1, y: y1 }, bl: { x: x0, y: y1 } }) };
    }),
  };
}

/** Keep the accepted result as Reset's baseline while previewing a staged Agent edit. */
export function loadMockupDraft(next: DesignerWorkspaceSource): {
  task: FigmaCompositionTask; baseline: FigmaCompositionTask; agentDraftLoaded: boolean;
} {
  const published = next.task?.kind === "mockup" || next.task?.kind === "composition"
    ? next.task : undefined;
  const agentDraftLoaded = Boolean(next.mockupDraft && published);
  const task = next.mockupDraft && published
    ? structuredClone(next.mockupDraft.task)
    : published ? structuredClone(published) : { kind: "mockup", spec: defaultMockup(next.sources) } as const;
  return { task, baseline: published ? structuredClone(published) : structuredClone(task), agentDraftLoaded };
}

/** Human copy/export follows the current task shape. Once whole-result editing
 * exists, exporting only the inner Mockup would discard the continuation. */
export function compositionParametersJson(task: FigmaCompositionTask): string {
  return placementParametersJson(task.kind === "composition" ? task.template : task.spec);
}

function sourceForPlane(sources: readonly LoadedDesignerSource[], id: string): LoadedDesignerSource | undefined {
  const match = /^source-(\d+)$/.exec(id); return match ? sources[Number(match[1]) - 1] : undefined;
}
function drawGrid(context: CanvasRenderingContext2D, grid: NonNullable<MockupPlanOutput["planes"][number]["grid"]>, lineWidth: number): void {
  context.save(); context.strokeStyle = "rgba(13,153,255,.55)"; context.lineWidth = lineWidth;
  for (const line of [...grid.vertical, ...grid.horizontal]) { context.beginPath(); context.moveTo(line.start.x, line.start.y); for (const point of line.points?.slice(1) ?? [line.end]) context.lineTo(point.x, point.y); context.stroke(); }
  context.restore();
}
function role<T extends HTMLElement>(root: HTMLElement, name: string): T { const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`); if (!value) throw new Error(`Missing mockup workspace role ${name}`); return value as T; }

/** Explicit layout command; emits only the existing shared MockupSpec. */
export function placeOnBackdrop(spec: MockupSpecInput, planeId: string, sources: readonly LoadedDesignerSource[]): MockupSpecInput | undefined {
  const backdrop = spec.planes.find(plane => plane.id === planeId);
  const background = backdrop && sourceForPlane(sources, backdrop.sourceId);
  if (!backdrop || !background || spec.planes.length < 2) return undefined;
  const scale = Math.min(1, 4096 / background.placement.width, 4096 / background.placement.height);
  const canvas = { width: Math.max(1, Math.round(background.placement.width * scale)), height: Math.max(1, Math.round(background.placement.height * scale)) };
  const full = normalizedSpec({ tl:{x:0,y:0},tr:{x:1,y:0},br:{x:1,y:1},bl:{x:0,y:1} });
  const planes = [ { ...backdrop, opacity: 1, transform: full }, ...spec.planes.filter(plane => plane.id !== planeId).map(plane => {
    const artwork = sourceForPlane(sources, plane.sourceId);
    if (!artwork) return plane;
    const fit = Math.min(canvas.width * 0.65 / artwork.placement.width, canvas.height * 0.65 / artwork.placement.height);
    const w = artwork.placement.width * fit / canvas.width, h = artwork.placement.height * fit / canvas.height;
    const x = (1 - w) / 2, y = (1 - h) / 2;
    return { ...plane, transform: { ...plane.transform, destination: normalizedSpec({tl:{x,y},tr:{x:x+w,y},br:{x:x+w,y:y+h},bl:{x,y:y+h}}).destination } };
  }) ];
  return { ...spec, canvas, planes, seams: [] };
}

/** Put the non-guide selection onto one explicit straight four-corner Vector. */
export function fitArtworkToQuad(
  spec: MockupSpecInput,
  sources: readonly LoadedDesignerSource[],
): { spec: MockupSpecInput; artworkPlaneId: string } | undefined {
  const candidate = fitToQuadCandidate(spec, sources);
  if (!candidate) return undefined;
  const { guide, guidePlane, artworkPlane } = candidate;
  const { x, y, width, height } = guide.placement;
  const scale = Math.min(1, 4096 / width, 4096 / height);
  const canvas = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  const quad = guide.quadGuide!;
  const normalized = {
    tl: { x: (quad.tl.x - x) / width, y: (quad.tl.y - y) / height },
    tr: { x: (quad.tr.x - x) / width, y: (quad.tr.y - y) / height },
    br: { x: (quad.br.x - x) / width, y: (quad.br.y - y) / height },
    bl: { x: (quad.bl.x - x) / width, y: (quad.bl.y - y) / height },
  };
  const guideTransform = normalizedSpec({
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
  });
  const artworkTransform = normalizedSpec(normalized);
  return {
    artworkPlaneId: artworkPlane.id,
    spec: {
      ...spec,
      canvas,
      seams: [],
      planes: [
        // The Vector supplies placement geometry and remains bound for reopen,
        // but its own fill or stroke is not part of the fitted artwork result.
        { ...guidePlane, opacity: 0, transform: guideTransform },
        { ...artworkPlane, transform: artworkTransform },
      ],
    },
  };
}

function fitToQuadCandidate(
  spec: MockupSpecInput,
  sources: readonly LoadedDesignerSource[],
): {
  guide: LoadedDesignerSource;
  guidePlane: MockupPlane;
  artworkPlane: MockupPlane;
} | undefined {
  if (sources.length !== 2 || spec.planes.length !== 2) return undefined;
  const guides = sources.filter((item) => item.quadGuide);
  if (guides.length !== 1) return undefined;
  const guide = guides[0]!;
  const artwork = sources.find((item) => item.sourceNodeId !== guide.sourceNodeId);
  if (!artwork) return undefined;
  const guideIndex = sources.indexOf(guide);
  const artworkIndex = sources.indexOf(artwork);
  const guidePlane = spec.planes.find((plane) => plane.sourceId === `source-${guideIndex + 1}`);
  const artworkPlane = spec.planes.find((plane) => plane.sourceId === `source-${artworkIndex + 1}`);
  return guidePlane && artworkPlane ? { guide, guidePlane, artworkPlane } : undefined;
}

/** Put the non-guide selection inside one explicit closed Vector outline. The
 * shape clips the composed canvas; the artwork keeps its aspect by covering
 * the shape's box, and the corners stay freely editable afterwards. */
export function fitArtworkToShape(
  spec: MockupSpecInput,
  sources: readonly LoadedDesignerSource[],
): { spec: MockupSpecInput; artworkPlaneId: string } | undefined {
  const candidate = fitToShapeCandidate(spec, sources);
  if (!candidate) return undefined;
  const { guide, guidePlane, artworkPlane } = candidate;
  const shape = guide.shapeGuide!;
  const { x, y, width, height } = shape.bounds;
  const scale = Math.min(1, 4096 / width, 4096 / height);
  const canvas = {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
  const guideTransform = normalizedSpec({
    tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 },
  });
  // Cover the shape's box while preserving the artwork aspect, so no part of
  // the outline can show through as an uncovered gap.
  const artworkAspect = sourceAspect(sources, artworkPlane);
  const canvasAspect = canvas.width / canvas.height;
  // Covering scale is max(canvas/artwork) on both axes: the relatively wider
  // side fills its axis exactly and the other overflows.
  const fitWidth = artworkAspect >= canvasAspect ? artworkAspect / canvasAspect : 1;
  const fitHeight = artworkAspect >= canvasAspect ? 1 : canvasAspect / artworkAspect;
  const artworkTransform = normalizedSpec({
    tl: { x: (1 - fitWidth) / 2, y: (1 - fitHeight) / 2 },
    tr: { x: (1 + fitWidth) / 2, y: (1 - fitHeight) / 2 },
    br: { x: (1 + fitWidth) / 2, y: (1 + fitHeight) / 2 },
    bl: { x: (1 - fitWidth) / 2, y: (1 + fitHeight) / 2 },
  });
  const normalize = (point: { x: number; y: number }) => ({
    x: (point.x - x) / width,
    y: (point.y - y) / height,
  });
  return {
    artworkPlaneId: artworkPlane.id,
    spec: {
      ...spec,
      canvas,
      seams: [],
      clip: {
        contours: shape.contours.map((contour) => ({
          start: normalize(contour.start),
          segments: contour.segments.map((segment) => segment.kind === "line"
            ? { kind: "line" as const, to: normalize(segment.to) }
            : {
              kind: "cubic" as const,
              c1: normalize(segment.c1!),
              c2: normalize(segment.c2!),
              to: normalize(segment.to),
            }),
        })),
        fillRule: shape.fillRule,
        ...(shape.regions ? { regions: shape.regions.map(region => ({
          contourIndices: [...region.contourIndices], fillRule: region.fillRule,
        })) } : {}),
      },
      planes: [
        // The Vector supplies the clipping outline and remains bound for
        // reopen, but its own fill or stroke is not part of the fitted result.
        { ...guidePlane, opacity: 0, transform: guideTransform },
        { ...artworkPlane, transform: artworkTransform },
      ],
    },
  };
}

function sourceAspect(
  sources: readonly LoadedDesignerSource[],
  plane: MockupPlane,
): number {
  const match = /^source-(\d+)$/.exec(plane.sourceId);
  const source = match ? sources[Number(match[1]) - 1] : undefined;
  return source && source.renderWidth > 0 && source.renderHeight > 0
    ? source.renderWidth / source.renderHeight
    : 1;
}

function fitToShapeCandidate(
  spec: MockupSpecInput,
  sources: readonly LoadedDesignerSource[],
): {
  guide: LoadedDesignerSource;
  guidePlane: MockupPlane;
  artworkPlane: MockupPlane;
} | undefined {
  if (sources.length !== 2 || spec.planes.length !== 2) return undefined;
  // A straight four-corner outline is a quad target; fitting it as a generic
  // shape would hide the stronger perspective affordance.
  const guides = sources.filter((item) => item.shapeGuide && !item.quadGuide);
  if (guides.length !== 1) return undefined;
  const guide = guides[0]!;
  const artwork = sources.find((item) => item.sourceNodeId !== guide.sourceNodeId);
  if (!artwork) return undefined;
  const guideIndex = sources.indexOf(guide);
  const artworkIndex = sources.indexOf(artwork);
  const guidePlane = spec.planes.find((plane) => plane.sourceId === `source-${guideIndex + 1}`);
  const artworkPlane = spec.planes.find((plane) => plane.sourceId === `source-${artworkIndex + 1}`);
  return guidePlane && artworkPlane ? { guide, guidePlane, artworkPlane } : undefined;
}

/** Mask the composed canvas to the spec's clip. The composite carries
 * straight alpha, so `destination-in` multiplies exactly like the native
 * renderer's coverage mask. */
function applyClipToCanvas(
  context: CanvasRenderingContext2D,
  clip: NonNullable<MockupSpecInput["clip"]>,
  canvas: { width: number; height: number },
): void {
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("Could not create the shape region mask");
  paintClipMask(maskContext, clip, canvas);
  context.save();
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  context.restore();
}
