import {
  TransformWebGLRenderer,
  solveTransformPreview,
  type EffectFrameAppearance,
  type EffectMotionSample,
  type EffectRecipe,
  type EffectState,
} from "@worldbend/web";
import { createEffectRecipe, planEffect } from "./designer-plan";
import { previewScaleFor, scaleSolveByFactor } from "./designer-preview";
import type { Phase } from "./editor-state";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import {
  canvasPng,
  canRetainDesignerDraft,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  sameDesignerSelection,
  sameJsonValue,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
  type LoadedDesignerSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, Placement, UiToMainMessage } from "./messages";
import { createSceneDraftClient } from "./scene-draft-client";
import { LIVE_SCENE_DRAFT_ENABLED } from "./scene-draft-policy";
import { isFigmaEffectRecipe, type FigmaSpatialEffectTask } from "./stored-designer-task";
import { createContextualHelp } from "./contextual-help";

const MAX_VIEWPORT_AXIS = Math.floor(4096 / 1.2);

export interface SpatialWorkspaceCopy extends DesignerWorkspaceCopy {
  width: string;
  height: string;
  sourceForRole: string;
  background: string;
  middle: string;
  foreground: string;
  distance: string;
  focalLength: string;
  travel: string;
  convergence: string;
  opticalFocus: string;
  depthOfField: string;
  focusRange: string;
  blurRadius: string;
  motionBlur: string;
  exposure: string;
  motionRadius: string;
  previewX: string;
  previewY: string;
  reducedMotion: string;
  dragPreview: string;
  previewHelp: string;
  agentDraft: string;
  invalidControls: string;
}

interface SpatialDraft {
  recipe: EffectRecipe;
  state: EffectState;
  sourceIds: string[];
}

export function createSpatialWorkspace(input: {
  root: HTMLElement;
  copy(): SpatialWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
}): DesignerTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  const previewHelp = createContextualHelp();
  previewHelp.button.dataset.role = "preview-help";
  shell.root.querySelector(".designer-header")?.append(previewHelp.button);
  shell.inspector.innerHTML = `
    <div class="designer-row"><label class="designer-field"><span data-role="width-label"></span><input data-role="width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="height-label"></span><input data-role="height" type="number" min="1" max="4096" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <div data-role="roles"></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="focal-length-label"></span><input data-role="focal-length" type="number" min="1" max="1000000" step="any"></label>
    <label class="designer-field"><span data-role="travel-label"></span><input data-role="travel" type="range" min="0" max="20" step="0.5"></label>
    <label class="designer-field"><span data-role="convergence-label"></span><select data-role="convergence"></select></label>
    <div class="designer-row"><label class="designer-field"><span data-role="preview-x-label"></span><input data-role="preview-x" type="range" min="-100" max="100" step="1"></label><label class="designer-field"><span data-role="preview-y-label"></span><input data-role="preview-y" type="range" min="-100" max="100" step="1"></label></div>
    <label class="designer-field"><span><input data-role="reduced-motion" type="checkbox"> <span data-role="reduced-motion-label"></span></span></label>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span><input data-role="depth-of-field" type="checkbox"> <span data-role="depth-of-field-label"></span></span></label>
    <div data-role="depth-controls"><label class="designer-field"><span data-role="optical-focus-label"></span><select data-role="optical-focus"></select></label>
    <label class="designer-field"><span data-role="focus-range-label"></span><input data-role="focus-range" type="number" min="1" max="1000000" step="any"></label>
    <label class="designer-field"><span data-role="blur-radius-label"></span><input data-role="blur-radius" type="range" min="0" max="64" step="1"></label></div>
    <label class="designer-field"><span><input data-role="motion-blur" type="checkbox"> <span data-role="motion-blur-label"></span></span></label>
    <div data-role="motion-controls"><label class="designer-field"><span data-role="exposure-label"></span><input data-role="exposure" type="range" min="0" max="100" step="1"></label>
    <label class="designer-field"><span data-role="motion-radius-label"></span><input data-role="motion-radius" type="range" min="0" max="64" step="1"></label></div>`;
  const canvas = document.createElement("canvas");
  canvas.tabIndex = 0;
  shell.preview.append(canvas);
  const context = requiredCanvasContext(canvas);
  const renderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  const roles = role<HTMLElement>(shell.inspector, "roles");
  const width = role<HTMLInputElement>(shell.inspector, "width");
  const height = role<HTMLInputElement>(shell.inspector, "height");
  const focalLength = role<HTMLInputElement>(shell.inspector, "focal-length");
  const travel = role<HTMLInputElement>(shell.inspector, "travel");
  const convergence = role<HTMLSelectElement>(shell.inspector, "convergence");
  const previewX = role<HTMLInputElement>(shell.inspector, "preview-x");
  const previewY = role<HTMLInputElement>(shell.inspector, "preview-y");
  const reducedMotion = role<HTMLInputElement>(shell.inspector, "reduced-motion");
  const depthOfField = role<HTMLInputElement>(shell.inspector, "depth-of-field");
  const depthControls = role<HTMLElement>(shell.inspector, "depth-controls");
  const opticalFocus = role<HTMLSelectElement>(shell.inspector, "optical-focus");
  const focusRange = role<HTMLInputElement>(shell.inspector, "focus-range");
  const blurRadius = role<HTMLInputElement>(shell.inspector, "blur-radius");
  const motionBlur = role<HTMLInputElement>(shell.inspector, "motion-blur");
  const motionControls = role<HTMLElement>(shell.inspector, "motion-controls");
  const exposure = role<HTMLInputElement>(shell.inspector, "exposure");
  const motionRadius = role<HTMLInputElement>(shell.inspector, "motion-radius");
  let source: DesignerWorkspaceSource | undefined;
  let draft: SpatialDraft | undefined;
  let baseline: SpatialDraft | undefined;
  let pendingPublication: SpatialDraft | undefined;
  let history: WorkspaceHistory<SpatialDraft> | undefined;
  let generation = 0;
  let publicationEpoch = 0;
  let active = false;
  let busy = false;
  let refreshing = false;
  let phase: Phase = "idle";
  let appliedResultPending = false;
  let undoRouted = false;
  let clearMotionTimer: ReturnType<typeof setTimeout> | undefined;
  let pointerState: { state: EffectState; time: number } | undefined;
  let pointerGestureId: number | undefined;
  let agentDraftLoaded = false;

  const sceneDraft = createSceneDraftClient({
    intervalMs: 250,
    render: async () => {
      if (!draft || !source || busy || refreshing || phase !== "ready" || !canvas.width || !canvas.height) return undefined;
      const placement = draftPlacement();
      return placement ? { bytes: await canvasPng(canvas), renderWidth: canvas.width, renderHeight: canvas.height, placement } : undefined;
    },
    send: (frame) => {
      if (source) input.post({ type: "scene-draft", generation: source.selectionGeneration, ...frame });
    },
    clear: () => {
      if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
    },
  });

  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => {
    if (!baseline) return;
    draft = structuredClone(baseline);
    agentDraftLoaded = false;
    renderControls();
    changed(true);
  });
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));
  for (const control of [width, height, focalLength, focusRange]) control.addEventListener("change", commitFromControls);
  for (const control of [travel, blurRadius, exposure, motionRadius]) {
    control.addEventListener("input", updateFromControls);
    control.addEventListener("change", commitFromControls);
  }
  for (const control of [convergence, opticalFocus, depthOfField, motionBlur, reducedMotion]) {
    control.addEventListener("change", commitFromControls);
  }
  for (const control of [previewX, previewY]) {
    control.addEventListener("input", updatePreviewState);
    control.addEventListener("change", commitHistory);
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (!draft || busy || refreshing || reducedMotion.checked || !event.isPrimary || event.button !== 0 || pointerGestureId !== undefined) return;
    pointerGestureId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    updatePointer(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pointerGestureId === event.pointerId && canvas.hasPointerCapture(event.pointerId)) updatePointer(event);
  });
  canvas.addEventListener("pointerup", (event) => finishPointerGesture(event.pointerId, true));
  canvas.addEventListener("pointercancel", (event) => finishPointerGesture(event.pointerId, true));
  canvas.addEventListener("lostpointercapture", (event) => finishPointerGesture(event.pointerId, false));

  function clearSceneDraft(): void {
    sceneDraft.cancel();
    if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
  }

  function draftPlacement(): Placement | undefined {
    if (!source || !draft) return undefined;
    if (source.targetPlacement) return { ...source.targetPlacement };
    const reference = orderedSources()[Math.floor(draft.sourceIds.length / 2)];
    if (!reference) return undefined;
    const fit = Math.min(reference.placement.width / draft.recipe.viewport.width, reference.placement.height / draft.recipe.viewport.height);
    const w = draft.recipe.viewport.width * fit;
    const h = draft.recipe.viewport.height * fit;
    return { x: reference.placement.x + (reference.placement.width - w) / 2, y: reference.placement.y + (reference.placement.height - h) / 2, width: w, height: h };
  }

  function updatePointer(event: PointerEvent): void {
    if (!draft || busy || refreshing || reducedMotion.checked) return;
    const rect = canvas.getBoundingClientRect();
    const next: EffectState = {
      ...draft.state,
      pointerX: clamp((event.clientX - rect.left) / rect.width * 2 - 1, -1, 1),
      pointerY: clamp((event.clientY - rect.top) / rect.height * 2 - 1, -1, 1),
    };
    const now = performance.now();
    const prior = pointerState;
    draft = { ...draft, state: next };
    pointerState = { state: structuredClone(next), time: now };
    previewX.value = String(Math.round(next.pointerX * 100));
    previewY.value = String(Math.round(next.pointerY * 100));
    const motion = prior ? { previousState: prior.state, elapsedSeconds: clamp((now - prior.time) / 1000, .001, 10) } : undefined;
    changed(false, motion);
    scheduleClearMotion();
  }

  function finishPointerGesture(pointerId: number, releaseCapture: boolean): void {
    if (pointerGestureId !== pointerId) return;
    pointerGestureId = undefined;
    if (releaseCapture && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    scheduleClearMotion();
    commitHistory();
  }

  function resetPointerInteraction(): void {
    const pointerId = pointerGestureId;
    pointerGestureId = undefined;
    pointerState = undefined;
    if (clearMotionTimer !== undefined) clearTimeout(clearMotionTimer);
    clearMotionTimer = undefined;
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      try { canvas.releasePointerCapture(pointerId); } catch {}
    }
  }

  function scheduleClearMotion(): void {
    if (clearMotionTimer !== undefined) clearTimeout(clearMotionTimer);
    clearMotionTimer = setTimeout(() => {
      clearMotionTimer = undefined;
      pointerState = undefined;
      if (active && !busy && !refreshing) void render("preview");
    }, 120);
  }

  function updatePreviewState(event: Event): void {
    if (!draft) return;
    // A range control displays rounded values. Editing one axis must retain
    // the full precision of the other axis received from an Agent.
    const axis = event.currentTarget === previewX ? "pointerX" : "pointerY";
    const control = event.currentTarget === previewX ? previewX : previewY;
    draft = { ...draft, state: { ...draft.state, [axis]: Number(control.value) / 100 } };
    changed(false);
  }

  function updateFromControls(event: Event): void {
    if (!draft) return;
    const current = draft;
    if (!controlsValid()) {
      // Number fields can hold out-of-range values and the far-to-near
      // ordering is product logic; both block Apply and need a visible reason.
      generation += 1;
      clearSceneDraft();
      shell.showError(input.copy().invalidControls);
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      return;
    }
    shell.showError();
    const control = event.currentTarget as HTMLInputElement | HTMLSelectElement;
    const recipe = structuredClone(current.recipe);
    const camera = recipe.camera!;
    // Patch only the explicit authoring action. Reconstructing the recipe
    // from every displayed control loses custom planes, focus and precision.
    if (control === width || control === height) {
      const viewport = { width: Number(width.value), height: Number(height.value) };
      const scale = { x: viewport.width / recipe.viewport.width, y: viewport.height / recipe.viewport.height };
      recipe.viewport = viewport;
      camera.travel = { x: camera.travel.x * scale.x, y: camera.travel.y * scale.y };
      for (const layer of recipe.layers) {
        if (layer.surface.kind !== "camera-plane") continue;
        layer.offset = { x: layer.offset.x * scale.x, y: layer.offset.y * scale.y };
        layer.surface.size = { width: layer.surface.size.width * scale.x, height: layer.surface.size.height * scale.y };
      }
    } else if (control === focalLength) camera.focalLength = Number(focalLength.value);
    else if (control === travel) camera.travel = { x: recipe.viewport.width * Number(travel.value) / 100, y: recipe.viewport.height * Number(travel.value) / 100 };
    else if (control === convergence) camera.focusDistance = selectedDistance(convergence);
    else if (control === depthOfField) {
      recipe.appearance ??= {};
      if (depthOfField.checked) recipe.appearance.depthOfField = {
        focusDistance: selectedDistance(opticalFocus), focusRange: Number(focusRange.value), maxBlurRadius: Number(blurRadius.value),
      };
      else delete recipe.appearance.depthOfField;
    } else if (control === motionBlur) {
      recipe.appearance ??= {};
      if (motionBlur.checked) recipe.appearance.motionBlur = { exposureFraction: Number(exposure.value) / 100, maxBlurRadius: Number(motionRadius.value) };
      else delete recipe.appearance.motionBlur;
    } else if (control === opticalFocus && recipe.appearance?.depthOfField) recipe.appearance.depthOfField.focusDistance = selectedDistance(opticalFocus);
    else if (control === focusRange && recipe.appearance?.depthOfField) recipe.appearance.depthOfField.focusRange = Number(focusRange.value);
    else if (control === blurRadius && recipe.appearance?.depthOfField) recipe.appearance.depthOfField.maxBlurRadius = Number(blurRadius.value);
    else if (control === exposure && recipe.appearance?.motionBlur) recipe.appearance.motionBlur.exposureFraction = Number(exposure.value) / 100;
    else if (control === motionRadius && recipe.appearance?.motionBlur) recipe.appearance.motionBlur.maxBlurRadius = Number(motionRadius.value);
    else if (control.dataset.distance) {
      const layer = recipe.layers.find(layer => layer.id === control.dataset.distance);
      if (layer?.surface.kind === "camera-plane") {
        layer.surface.distance = Number(control.value);
        if (convergence.value === layer.id) camera.focusDistance = layer.surface.distance;
        if (opticalFocus.value === layer.id && recipe.appearance?.depthOfField) recipe.appearance.depthOfField.focusDistance = layer.surface.distance;
      }
    }
    if ((control === depthOfField || control === motionBlur) && recipe.appearance && Object.keys(recipe.appearance).length === 0) delete recipe.appearance;
    if (!sameJsonValue(recipe, current.recipe)) recipe.origin = null;
    if (!isFigmaEffectRecipe(recipe)) {
      generation += 1;
      clearSceneDraft();
      shell.showError(input.copy().invalidControls);
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      return;
    }
    draft = {
      ...current,
      state: { ...current.state, reducedMotion: reducedMotion.checked },
      recipe,
    };
    changed(false);
    renderControls();
  }

  function controlsValid(): boolean {
    if (!draft) return false;
    const current = draft;
    const numeric = [width, height, focalLength, ...(depthOfField.checked ? [focusRange] : [])];
    const distances = [...roles.querySelectorAll<HTMLInputElement>('input[data-distance]')];
    if (![...numeric, ...distances].every((control) => control.validity.valid && Number.isFinite(Number(control.value)))) return false;
    const values = distances.map((control) => Number(control.value));
    const scale = { x: Number(width.value) / current.recipe.viewport.width, y: Number(height.value) / current.recipe.viewport.height };
    const layoutValid = current.recipe.layers.every(layer => layer.surface.kind === "camera-plane" &&
      [layer.surface.size.width * scale.x, layer.surface.size.height * scale.y]
        .every(axis => Number.isFinite(axis) && axis >= 1 && axis <= 4096) &&
      Math.abs(layer.offset.x * scale.x) <= 1_000_000 && Math.abs(layer.offset.y * scale.y) <= 1_000_000);
    return values.length === current.recipe.layers.length && values.length >= 2 && values.length <= 8 &&
      values.every((value, index) => index === 0 || values[index - 1]! > value) &&
      layoutValid && validFocus(convergence) && validFocus(opticalFocus);
  }

  function validFocus(select: HTMLSelectElement): boolean {
    return select.value === "" ? Number.isFinite(Number(select.selectedOptions[0]?.dataset.distance))
      : Boolean(draft?.recipe.layers.some(layer => layer.id === select.value));
  }

  function selectedDistance(select: HTMLSelectElement): number {
    return select.value === "" ? Number(select.selectedOptions[0]!.dataset.distance) : roleDistances()[select.value]!;
  }

  function roleDistances(): Record<string, number> {
    const values = [...roles.querySelectorAll<HTMLInputElement>('input[data-distance]')];
    return Object.fromEntries(values.map((input) => [input.dataset.distance!, Number(input.value)]));
  }

  function changed(commit: boolean, motion?: EffectMotionSample): void {
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    agentDraftLoaded = false;
    if (commit) history?.push(draft!);
    void render("preview", motion);
  }

  function commitFromControls(event: Event): void {
    if (!draft) return;
    updateFromControls(event);
    // Range inputs already update the draft on `input`; their release still
    // needs to publish that final value into workspace history. The history
    // owns duplicate suppression for no-op change events.
    if (!controlsValid()) return;
    commitHistory();
  }

  function commitHistory(): void {
    if (!draft) return;
    history?.push(draft);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
  }

  async function render(quality: "preview" | "high", motion?: EffectMotionSample): Promise<boolean> {
    if (!active || !source || !draft || (quality === "preview" && busy)) return false;
    const epoch = ++generation;
    if (!controlsValid()) {
      clearSceneDraft();
      shell.showError(input.copy().invalidControls);
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      return false;
    }
    try {
      const plan = await planEffect({ recipe: draft.recipe, state: draft.state, motion: motion ?? null });
      if (epoch !== generation) return false;
      const factor = quality === "preview" ? previewScaleFor(plan.viewport.width, plan.viewport.height) : 1;
      const outputWidth = Math.max(1, Math.round(plan.viewport.width * factor));
      const outputHeight = Math.max(1, Math.round(plan.viewport.height * factor));
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      fitPreviewCanvas(canvas, shell.preview);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, outputWidth, outputHeight);
      const sources = orderedSources();
      for (let index = 0; index < plan.frames.length; index += 1) {
        const frame = plan.frames[index]!;
        if (frame.surface.kind !== "plane") throw new Error("Spatial Figma preview requires camera planes");
        const artwork = sources[index];
        if (!artwork) throw new Error(`Missing source for ${frame.id}`);
        const stage = stageSource(artwork.image, frame.size.width, frame.size.height, frame.appearance, factor);
        const solved = await solveTransformPreview(frame.surface.plan.spec);
        if (epoch !== generation) return false;
        renderer.invalidateSource();
        renderer.render(stage, scaleSolveByFactor(solved, factor), undefined, quality);
        context.drawImage(renderer.canvas, Math.round(frame.offset.x * factor), Math.round(frame.offset.y * factor));
      }
      shell.showError();
      shell.apply.disabled = busy || refreshing || !controlsValid();
      shell.applyNew.disabled = shell.apply.disabled;
      if (quality === "preview" && LIVE_SCENE_DRAFT_ENABLED && phase === "ready" && !busy && !refreshing) {
        if (baseline && !sameJsonValue(draft, baseline)) sceneDraft.request();
        else clearSceneDraft();
      }
      return true;
    } catch (error) {
      if (epoch !== generation) return false;
      clearSceneDraft();
      shell.showError(input.formatError(error));
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      return false;
    }
  }

  function stageSource(image: HTMLImageElement, logicalWidth: number, logicalHeight: number, appearance: EffectFrameAppearance | null | undefined, factor: number): HTMLCanvasElement {
    const stage = document.createElement("canvas");
    stage.width = Math.max(1, Math.round(logicalWidth * factor));
    stage.height = Math.max(1, Math.round(logicalHeight * factor));
    const ctx = stage.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is required for Spatial appearance");
    const motion = appearance?.motionBlur?.sourceBlurVector;
    const motionLength = motion ? Math.hypot(motion.x, motion.y) * factor : 0;
    const samples = motionLength > .25 ? Math.min(12, Math.max(2, Math.ceil(motionLength / 2))) : 1;
    ctx.filter = appearance?.depthOfField ? `blur(${appearance.depthOfField.blurRadius * factor}px)` : "none";
    if (samples > 1) ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 1 / samples;
    for (let sample = 0; sample < samples; sample += 1) {
      const t = samples === 1 ? 0 : sample / (samples - 1);
      const dx = (motion?.x ?? 0) * factor * t;
      const dy = (motion?.y ?? 0) * factor * t;
      drawCover(ctx, image, stage.width, stage.height, dx, dy);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    return stage;
  }

  function renderControls(): void {
    if (!draft || !source) return;
    const currentSource = source;
    const copy = input.copy();
    width.value = String(draft.recipe.viewport.width);
    height.value = String(draft.recipe.viewport.height);
    focalLength.value = String(draft.recipe.camera?.focalLength ?? 1);
    travel.value = String(Math.round((draft.recipe.camera?.travel.x ?? 0) / draft.recipe.viewport.width * 1000) / 10);
    previewX.value = String(Math.round(draft.state.pointerX * 100));
    previewY.value = String(Math.round(draft.state.pointerY * 100));
    reducedMotion.checked = draft.state.reducedMotion;
    const depth = draft.recipe.appearance?.depthOfField;
    depthOfField.checked = Boolean(depth);
    depthControls.hidden = !depth;
    focusRange.value = String(depth?.focusRange ?? 300);
    blurRadius.value = String(depth?.maxBlurRadius ?? 14);
    const motion = draft.recipe.appearance?.motionBlur;
    motionBlur.checked = Boolean(motion);
    motionControls.hidden = !motion;
    exposure.value = String(Math.round((motion?.exposureFraction ?? .65) * 100));
    motionRadius.value = String(motion?.maxBlurRadius ?? 32);
    fillRoleOptions(convergence, draft.recipe.camera?.focusDistance ?? 1000);
    fillRoleOptions(opticalFocus, depth?.focusDistance ?? 1000);
    roles.replaceChildren();
    const sources = orderedSources();
    draft.recipe.layers.forEach((layer, index) => {
      const row = document.createElement("div");
      row.className = "spatial-role-row";
      const label = document.createElement("label");
      label.className = "designer-field";
      const title = document.createElement("span");
      title.textContent = roleLabel(layer.id, index, copy);
      const select = document.createElement("select");
      select.dataset.role = layer.id;
      currentSource.sources.forEach((candidate) => {
        const option = document.createElement("option");
        option.value = candidate.sourceNodeId;
        option.textContent = candidate.sourceName;
        option.selected = sources[index]?.sourceNodeId === candidate.sourceNodeId;
        select.append(option);
      });
      select.addEventListener("change", () => swapSource(layer.id, select.value));
      label.append(title, select);
      const distanceLabel = document.createElement("label");
      distanceLabel.className = "designer-field";
      const distanceTitle = document.createElement("span");
      distanceTitle.textContent = copy.distance;
      const distance = document.createElement("input");
      // Evenly spaced presets for arbitrary layer counts can be fractional
      // (five layers use 1287.5 and 862.5). Canonical camera-plane distances
      // are finite numbers rather than integers, so the browser control must
      // not reject a valid recipe through HTML step-mismatch validation.
      distance.type = "number"; distance.min = "1"; distance.max = "1000000"; distance.step = "any";
      distance.dataset.distance = layer.id;
      distance.value = String(layer.surface.kind === "camera-plane" ? layer.surface.distance : 1);
      distance.addEventListener("change", commitFromControls);
      distanceLabel.append(distanceTitle, distance);
      row.append(label, distanceLabel);
      roles.append(row);
    });
    shell.status.textContent = agentDraftLoaded ? copy.agentDraft : "";
    shell.setPublicationTarget(source, "effect");
  }

  function swapSource(roleName: string, nextId: string): void {
    if (!draft) return;
    const index = draft.recipe.layers.findIndex((layer) => layer.id === roleName);
    const other = draft.sourceIds.indexOf(nextId);
    if (index < 0 || other < 0 || index === other) return;
    const ids = [...draft.sourceIds];
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    draft = { ...draft, sourceIds: ids };
    changed(true);
    renderControls();
  }

  function orderedSources(): LoadedDesignerSource[] {
    if (!source || !draft) return [];
    return draft.sourceIds.map((id) => source!.sources.find((candidate) => candidate.sourceNodeId === id)).filter((candidate): candidate is LoadedDesignerSource => Boolean(candidate));
  }

  function fillRoleOptions(select: HTMLSelectElement, distance: number): void {
    select.replaceChildren();
    const copy = input.copy();
    const selected = draft?.recipe.layers.find(layer => layer.surface.kind === "camera-plane" && layer.surface.distance === distance)?.id;
    if (selected === undefined) {
      const option = document.createElement("option");
      option.value = "";
      option.dataset.distance = String(distance);
      option.textContent = `${copy.distance}: ${distance}`;
      option.selected = true;
      select.append(option);
    }
    for (const [index, layer] of (draft?.recipe.layers ?? []).entries()) {
      const option = document.createElement("option");
      option.value = layer.id;
      option.textContent = roleLabel(layer.id, index, copy);
      option.selected = layer.id === selected;
      select.append(option);
    }
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!active || !source || !draft || busy || refreshing || !controlsValid()) return;
    clearSceneDraft();
    const appliedSource = source;
    const appliedDraft = structuredClone(draft);
    const epoch = ++publicationEpoch;
    pendingPublication = undefined;
    busy = true;
    phase = "applying";
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      const valid = await render("high");
      if (!active || publicationEpoch !== epoch || source !== appliedSource) return;
      if (!valid) throw new Error("Spatial output is invalid");
      const bytes = await canvasPng(canvas);
      if (!active || publicationEpoch !== epoch || source !== appliedSource) return;
      const ordered = appliedDraft.sourceIds.map((id) => appliedSource.sources.find((candidate) => candidate.sourceNodeId === id)!);
      pendingPublication = structuredClone(appliedDraft);
      postDesignerResult({
        post: input.post,
        source: { ...appliedSource, sources: ordered },
        task: { kind: "effect", recipe: appliedDraft.recipe, state: appliedDraft.state },
        bytes,
        width: appliedDraft.recipe.viewport.width,
        height: appliedDraft.recipe.viewport.height,
        duplicate,
      });
    } catch (error) {
      if (!active || publicationEpoch !== epoch) return;
      recoverFailedApply(input.formatError(error));
    }
  }

  function recoverFailedApply(message: string): void {
    busy = false;
    phase = "ready";
    shell.setBusy(false);
    renderControls();
    shell.showError(message);
    void render("preview").then(() => shell.showError(message));
  }

  async function installSource(next: DesignerWorkspaceSource): Promise<void> {
    const installGeneration = ++generation;
    const published = next.task?.kind === "effect" ? next.task : undefined;
    let task: FigmaSpatialEffectTask;
    if (next.effectDraft && published && next.effectDraft.baseRevision > 0) {
      task = structuredClone(next.effectDraft.task);
      agentDraftLoaded = true;
    } else if (published) {
      task = structuredClone(published);
      agentDraftLoaded = false;
    } else {
      const viewport = defaultViewport(next.sources);
      const preset = await createEffectRecipe({ effect: "multiplane-camera", version: "3", viewport, intensity: .8 });
      if (installGeneration !== generation || source !== next) return;
      task = { kind: "effect", recipe: recipeForSourceCount(preset, next.sources.length), state: { progress: 1, pointerX: 0, pointerY: 0, reducedMotion: false } };
      agentDraftLoaded = false;
    }
    if (!isFigmaEffectRecipe(task.recipe)) throw new Error("This Spatial result is not supported by the Figma workspace");
    const sourceIds = next.sources.map((candidate) => candidate.sourceNodeId);
    if (sourceIds.length < 2 || sourceIds.length > 8 || sourceIds.length !== task.recipe.layers.length) throw new Error("Spatial scenes require 2–8 source layers matching the camera recipe");
    draft = { recipe: structuredClone(task.recipe), state: structuredClone(task.state), sourceIds };
    baseline = published
      ? { recipe: structuredClone(published.recipe), state: structuredClone(published.state), sourceIds: [...sourceIds] }
      : structuredClone(draft);
    history = createWorkspaceHistory(draft);
    phase = "ready";
    renderControls();
    if (active) void render("preview");
  }

  return {
    enter() { active = true; shell.root.hidden = false; if (draft) { renderControls(); void render("preview"); } },
    leave() { pendingPublication = undefined; previewHelp.close(); clearSceneDraft(); resetPointerInteraction(); publicationEpoch += 1; generation += 1; active = false; busy = false; shell.setBusy(false); shell.root.hidden = true; },
    selectionLoading() {
      pendingPublication = undefined; resetPointerInteraction(); refreshing = true; generation += 1; publicationEpoch += 1; busy = false; shell.setBusy(false); shell.apply.disabled = true; shell.applyNew.disabled = true; },
    setSource(next) {
      pendingPublication = undefined;
      refreshing = false;
      const retain = canRetainDesignerDraft(source, next) && draft !== undefined;
      publicationEpoch += 1;
      busy = false;
      shell.setBusy(false);
      // setBusy(false) restores every control after the selection-loading
      // state. Keep publication unavailable until installSource has produced
      // and rendered a valid first frame for this exact selection.
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
      if (retain) { renderControls(); if (active) void render("preview"); return; }
      draft = undefined; baseline = undefined; history = undefined; phase = "idle";
      shell.showError();
      void installSource(next).catch((error) => {
        if (source !== next) return;
        shell.showError(input.formatError(error));
        shell.apply.disabled = true; shell.applyNew.disabled = true;
      });
    },
    clearSource(error) { pendingPublication = undefined; refreshing = false; clearSceneDraft(); resetPointerInteraction(); generation += 1; publicationEpoch += 1; source = undefined; draft = undefined; baseline = undefined; history = undefined; busy = false; phase = "idle"; shell.setBusy(false); shell.showError(error); shell.apply.disabled = true; shell.applyNew.disabled = true; },
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      previewHelp.setCopy(copy.previewHelp, copy.dragPreview);
      for (const [name, text] of [
        ["width-label", copy.width], ["height-label", copy.height],
        ["focal-length-label", copy.focalLength], ["travel-label", copy.travel], ["convergence-label", copy.convergence],
        ["preview-x-label", copy.previewX], ["preview-y-label", copy.previewY], ["reduced-motion-label", copy.reducedMotion],
        ["depth-of-field-label", copy.depthOfField], ["optical-focus-label", copy.opticalFocus], ["focus-range-label", copy.focusRange],
        ["blur-radius-label", copy.blurRadius], ["motion-blur-label", copy.motionBlur], ["exposure-label", copy.exposure], ["motion-radius-label", copy.motionRadius],
      ] as const) role<HTMLElement>(shell.inspector, name).textContent = text;
      canvas.setAttribute("aria-label", copy.dragPreview);
      if (draft) renderControls();
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      if (message.type === "apply-designer-complete" && pendingPublication &&
        message.operation === "replace" && message.targetNodeId === source.targetNodeId) {
        const { effectDraft: _draft, ...publishedSource } = source;
        source = { ...publishedSource,
          sources: pendingPublication.sourceIds.map(id => publishedSource.sources.find(candidate => candidate.sourceNodeId === id)!),
          task: { kind: "effect", recipe: structuredClone(pendingPublication.recipe), state: structuredClone(pendingPublication.state) } };
        baseline = structuredClone(pendingPublication);
      }
      pendingPublication = undefined;
      if (message.type === "apply-designer-error") recoverFailedApply(input.formatError(message.message));
      else { busy = false; shell.setBusy(false); phase = "ready"; appliedResultPending = true; undoRouted = false; agentDraftLoaded = false; shell.status.textContent = input.copy().applied; }
      return true;
    },
    handleKeydown(event) {
      if (event.key === "Escape") { event.preventDefault(); input.onBack(); return true; }
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore(value) { draft = value; renderControls(); void render("preview"); } });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    dispose() { pendingPublication = undefined; previewHelp.dispose(); clearSceneDraft(); resetPointerInteraction(); generation += 1; publicationEpoch += 1; active = false; renderer.dispose(); },
  };
}

function defaultViewport(sources: readonly LoadedDesignerSource[]): { width: number; height: number } {
  const reference = sources[Math.floor(sources.length / 2)] ?? sources[0];
  const width = reference?.renderWidth ?? 1200;
  const height = reference?.renderHeight ?? 800;
  const scale = Math.min(1, MAX_VIEWPORT_AXIS / Math.max(width, height));
  return { width: Math.max(16, Math.round(width * scale)), height: Math.max(16, Math.round(height * scale)) };
}

function drawCover(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number, dx: number, dy: number): void {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  context.drawImage(image, (width - drawWidth) / 2 + dx, (height - drawHeight) / 2 + dy, drawWidth, drawHeight);
}

function roleLabel(roleName: string, index: number, copy: SpatialWorkspaceCopy): string {
  if (roleName === "background") return copy.background;
  if (roleName === "middle") return copy.middle;
  if (roleName === "foreground") return copy.foreground;
  return `${index + 1}. ${roleName}`;
}

function recipeForSourceCount(preset: EffectRecipe, sourceCount: number): EffectRecipe {
  if (sourceCount === 3) return preset;
  if (sourceCount < 2 || sourceCount > 8) throw new Error("Spatial scenes require 2–8 source layers");
  const first = preset.layers[0]!;
  if (!preset.camera || first.surface.kind !== "camera-plane") throw new Error("Spatial preset requires one shared camera and camera planes");
  const firstSurface = structuredClone(first.surface);
  const far = 1500;
  const near = 650;
  const layers = Array.from({ length: sourceCount }, (_, index) => {
    const distance = far - (far - near) * index / (sourceCount - 1);
    return {
      ...structuredClone(first),
      id: `layer-${index + 1}`,
      surface: { ...structuredClone(firstSurface), distance },
    };
  }) as EffectRecipe["layers"];
  const focusDistance = far - (far - near) * Math.floor(sourceCount / 2) / (sourceCount - 1);
  return {
    ...preset,
    origin: null,
    camera: { ...preset.camera, focusDistance },
    ...(preset.appearance?.depthOfField ? {
      appearance: { ...preset.appearance, depthOfField: { ...preset.appearance.depthOfField, focusDistance } },
    } : {}),
    layers,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing Spatial workspace role ${name}`);
  return value as T;
}

function requiredCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is required for Spatial preview");
  return context;
}
