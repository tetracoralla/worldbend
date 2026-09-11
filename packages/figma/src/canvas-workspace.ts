import {
  CanvasRasterRenderer,
  planCanvasSet,
  planCanvasSetFromRgba,
  type CanvasSetPlan,
} from "@worldbend/web";
import type { MainToUiMessage, SourcePayload, UiToMainMessage } from "./messages";
import {
  activeCanvasVariant,
  addCanvasVariant,
  cloneCanvasDraft,
  createCanvasDraft,
  parseCanvasNumericPreview,
  removeCanvasVariant,
  renameCanvasVariant,
  selectCanvasVariant,
  updateCanvasVariant,
  validateCanvasDraft,
  type CanvasBackground,
  type CanvasDraft,
  type CanvasOperationKind,
  type CanvasVariantDraft,
} from "./canvas-state";
import { createCanvasHistory, type CanvasHistory } from "./canvas-history";
import {
  createCanvasWorkspaceView,
  type CanvasWorkspaceCopy,
} from "./canvas-workspace-view";
import {
  canvasPrimaryActionLabel,
  canvasResultPlacements,
  cloneBackground,
  draftFromStoredCanvas,
  draftFromStoredCanvasSet,
  hexToRgba,
  imageRgba,
  inspectorControls,
  renderAnchors,
  renderVariantTabs,
  rgbaToHex,
  specFromDraft,
  type CanvasWorkspacePhase,
} from "./canvas-workspace-support";
import { createFrameCoalescer } from "./frame-coalescer";
import {
  canvasTemplateFromSet,
  normalizeTemplateName,
} from "./stored-template-library";
import type { OwnedCanvasSetSpec } from "./stored-canvas";
import type { Phase } from "./editor-state";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";

type WorkspaceSource = Omit<SourcePayload, "bytes" | "sources"> & { selectionGeneration: number };
type WorkspacePhase = CanvasWorkspacePhase;

export interface CanvasWorkspace {
  enter(): void;
  leave(): void;
  setSource(source: WorkspaceSource, image: HTMLImageElement): void;
  selectionLoading(): void;
  clearSource(error?: string): void;
  updateLocale(): void;
  handleMainMessage(message: MainToUiMessage): boolean;
  handleKeydown(event: KeyboardEvent): boolean;
  loadTemplate(spec: OwnedCanvasSetSpec): boolean;
  finishTemplateSave(requestId: number, error?: string): void;
  dispose(): void;
}

export function createCanvasWorkspace(input: {
  root: HTMLElement;
  copy(): CanvasWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  requestSourceRaster(
    source: WorkspaceSource,
    desired: { width: number; height: number },
  ): Promise<Uint8Array>;
  decodeImage(bytes: Uint8Array): Promise<HTMLImageElement>;
  formatError(error: unknown): string;
}): CanvasWorkspace {
  const view = createCanvasWorkspaceView(input.root);
  let active = false;
  let source: WorkspaceSource | undefined;
  let sourceImage: HTMLImageElement | undefined;
  let sourceRgba: Uint8Array | undefined;
  let draft: CanvasDraft | undefined;
  let baseline: CanvasDraft | undefined;
  let history: CanvasHistory | undefined;
  let plan: CanvasSetPlan | undefined;
  let renderer: CanvasRasterRenderer | undefined;
  let phase: WorkspacePhase = "idle";
  let planGeneration = 0;
  let undoRouted = false;
  let appliedResultPending = false;
  let visibleError = "";
  let savingTemplate = false;
  let pendingTemplateRequestId: number | undefined;
  let nextTemplateRequestId = 1;
  let savedNotice = false;
  const planFrames = createFrameCoalescer(() => void requestPlan());

  view.back.addEventListener("click", input.onBack);
  view.addVariant.addEventListener("click", () => {
    if (!draft || source?.targetNodeId) return;
    updateDraft(addCanvasVariant(draft));
  });
  view.removeVariant.addEventListener("click", () => {
    if (!draft || source?.targetNodeId) return;
    updateDraft(removeCanvasVariant(draft, draft.activeId));
  });
  view.variantId.addEventListener("change", commitVariantId);
  view.operation.addEventListener("change", () => {
    if (!draft) return;
    updateDraft(
      updateCanvasVariant(draft, draft.activeId, {
        kind: view.operation.value as CanvasOperationKind,
      }),
    );
  });
  bindNumericField(view.width, (value) => ({ width: value }));
  bindNumericField(view.height, (value) => ({ height: value }));
  bindNumericField(view.trimThreshold, (value) => ({ trimThreshold: value }));
  for (const [control, key] of [
    [view.cropX, "x"],
    [view.cropY, "y"],
    [view.cropWidth, "width"],
    [view.cropHeight, "height"],
  ] as const) {
    bindNumericField(control, (value) => {
      const variant = draft ? activeCanvasVariant(draft) : undefined;
      return variant ? { crop: { ...variant.crop, [key]: value } } : undefined;
    });
  }
  for (const [control, key] of [
    [view.padTop, "top"],
    [view.padRight, "right"],
    [view.padBottom, "bottom"],
    [view.padLeft, "left"],
  ] as const) {
    bindNumericField(control, (value) => {
      const variant = draft ? activeCanvasVariant(draft) : undefined;
      return variant ? { insets: { ...variant.insets, [key]: value } } : undefined;
    });
  }
  view.background.addEventListener("change", () => {
    commitBackground(
      view.background.value === "color"
        ? { kind: "color", space: "srgb8", rgba: hexToRgba(view.backgroundColor.value) }
        : { kind: "transparent" },
    );
  });
  view.backgroundColor.addEventListener("change", () => {
    if (view.background.value === "color") {
      commitBackground({
        kind: "color",
        space: "srgb8",
        rgba: hexToRgba(view.backgroundColor.value),
      });
    }
  });
  view.reset.addEventListener("click", resetDraft);
  view.apply.addEventListener("click", () => void apply(false));
  view.applyNew.addEventListener("click", () => void apply(true));
  view.templateName.addEventListener("input", () => {
    savedNotice = false;
    render();
  });
  view.saveTemplate.addEventListener("click", saveCurrentTemplate);
  input.root.hidden = true;
  input.root.inert = true;
  view.applyCopy(input.copy());
  render();

  function enter(): void {
    if (active) return;
    active = true;
    input.root.hidden = false;
    input.root.inert = false;
    renderer = new CanvasRasterRenderer();
    renderer.canvas.className = "canvas-preview-raster";
    view.preview.replaceChildren(renderer.canvas, view.sourceName);
    render();
    if (source && draft) void requestPlan();
  }

  function leave(): void {
    if (!active) return;
    active = false;
    planGeneration += 1;
    planFrames.cancel();
    plan = undefined;
    savedNotice = false;
    renderer?.dispose();
    renderer = undefined;
    view.preview.replaceChildren();
    input.root.hidden = true;
    input.root.inert = true;
  }

  function setSource(nextSource: WorkspaceSource, image: HTMLImageElement): void {
    const same =
      source?.sourceNodeId === nextSource.sourceNodeId &&
      source?.targetNodeId === nextSource.targetNodeId;
    source = nextSource;
    sourceImage = image;
    sourceRgba = undefined;
    undoRouted = false;
    if (!same) appliedResultPending = false;
    visibleError = "";
    savedNotice = false;
    if (!same || !draft) {
      draft = nextSource.canvas
        ? draftFromStoredCanvas(nextSource.canvas.operation, image.naturalWidth, image.naturalHeight)
        : createCanvasDraft(image.naturalWidth, image.naturalHeight);
      baseline = cloneCanvasDraft(draft);
      history = createCanvasHistory(draft);
      plan = undefined;
      view.templateName.value = input.copy().templateNamePlaceholder;
    } else {
      draft = { ...draft, source: { width: image.naturalWidth, height: image.naturalHeight } };
      baseline = baseline
        ? { ...baseline, source: { ...draft.source } }
        : cloneCanvasDraft(draft);
      if (!normalizeTemplateName(view.templateName.value)) {
        view.templateName.value = input.copy().templateNamePlaceholder;
      }
    }
    phase = active ? "planning" : "ready";
    render();
    if (active) {
      planFrames.cancel();
      void requestPlan();
    }
  }

  function selectionLoading(): void {
    if (!active) return;
    planGeneration += 1;
    phase = "planning";
    savedNotice = false;
    visibleError = "";
    render();
  }

  function clearSource(error = ""): void {
    source = undefined;
    sourceImage = undefined;
    sourceRgba = undefined;
    draft = undefined;
    baseline = undefined;
    history = undefined;
    plan = undefined;
    phase = "idle";
    appliedResultPending = false;
    visibleError = error;
    savedNotice = false;
    savingTemplate = false;
    pendingTemplateRequestId = undefined;
    if (renderer) {
      renderer.canvas.width = 1;
      renderer.canvas.height = 1;
    }
    render();
  }

  async function requestPlan(): Promise<void> {
    if (!active || !sourceImage || !draft) return;
    const issue = validateCanvasDraft(draft);
    if (issue) {
      plan = undefined;
      phase = "ready";
      visibleError = input.copy().invalid;
      renderChrome();
      return;
    }
    const generation = ++planGeneration;
    const plannedDraft = draft;
    savedNotice = false;
    visibleError = "";
    try {
      const nextPlan = await planDraft(plannedDraft, sourceImage);
      if (!active || generation !== planGeneration || draft !== plannedDraft) return;
      plan = nextPlan;
      phase = "ready";
      renderActivePreview();
      renderChrome();
      const variant = activeCanvasVariant(plannedDraft);
      if (variant) renderVariantTabs(view, plannedDraft, plan, selectVariant);
    } catch (error) {
      if (!active || generation !== planGeneration) return;
      plan = undefined;
      phase = "ready";
      visibleError = input.formatError(error);
      renderChrome();
    }
  }

  async function planDraft(plannedDraft: CanvasDraft, image: HTMLImageElement): Promise<CanvasSetPlan> {
    const spec = specFromDraft(plannedDraft);
    const sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
    if (!plannedDraft.variants.some((variant) => variant.kind === "trim")) {
      return planCanvasSet(spec, sourceSize);
    }
    sourceRgba ??= imageRgba(image);
    return planCanvasSetFromRgba(spec, sourceSize, sourceRgba);
  }

  function renderActivePreview(): void {
    if (!renderer || !sourceImage || !draft || !plan) return;
    const activePlan = plan.variants.find((variant) => variant.id === draft?.activeId)?.plan;
    if (!activePlan) return;
    renderer.render(sourceImage, activePlan, "preview", 1024);
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!active || !source || !sourceImage || !draft || phase !== "ready") return;
    if (validateCanvasDraft(draft) || (source.targetNodeId && draft.variants.length !== 1)) {
      visibleError = input.copy().invalid;
      render();
      return;
    }
    const applyingSource = source;
    const applyingDraft = draft;
    planFrames.cancel();
    const generation = ++planGeneration;
    phase = "applying";
    savedNotice = false;
    visibleError = "";
    render();
    try {
      const bytes = await input.requestSourceRaster(applyingSource, {
        width: sourceImage.naturalWidth,
        height: sourceImage.naturalHeight,
      });
      const finalSource = await input.decodeImage(bytes);
      sourceRgba = undefined;
      const finalPlan = await planDraft(applyingDraft, finalSource);
      if (
        !active ||
        generation !== planGeneration ||
        source !== applyingSource ||
        draft !== applyingDraft ||
        !renderer
      ) {
        return;
      }
      const outputs = [] as Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"]["outputs"];
      const placements = canvasResultPlacements(
        applyingSource.placement,
        finalPlan.variants.map((variant) => variant.plan.outputSize),
        Boolean(applyingSource.targetNodeId && !duplicate),
      );
      for (let index = 0; index < finalPlan.variants.length; index += 1) {
        const variant = finalPlan.variants[index]!;
        renderer.render(finalSource, variant.plan, "high");
        outputs.push({
          id: variant.id,
          bytes: await renderer.exportPng(),
          renderWidth: variant.plan.outputSize.width,
          renderHeight: variant.plan.outputSize.height,
          placement: placements[index]!,
        });
      }
      if (!active || generation !== planGeneration || source !== applyingSource) return;
      input.post({
        type: "apply-canvas",
        payload: {
          generation: activeGeneration(applyingSource),
          sourceNodeId: applyingSource.sourceNodeId,
          setSpec: specFromDraft(applyingDraft),
          outputs,
          ...(applyingSource.targetNodeId ? { targetNodeId: applyingSource.targetNodeId } : {}),
          ...(duplicate ? { duplicate: true } : {}),
        },
      });
    } catch (error) {
      if (!active || source !== applyingSource) return;
      phase = "ready";
      visibleError = input.formatError(error);
      renderActivePreview();
      render();
    }
  }

  function handleMainMessage(message: MainToUiMessage): boolean {
    if (message.type === "apply-canvas-error") {
      if (!source || message.generation !== activeGeneration(source)) return true;
      phase = "ready";
      appliedResultPending = false;
      visibleError = input.formatError(message.message);
      renderActivePreview();
      render();
      return true;
    }
    if (message.type === "apply-canvas-complete") {
      if (!source || message.generation !== activeGeneration(source)) return true;
      // Publishing is non-terminal. Keep the original draft and every control
      // live so another parameter variant can be generated immediately.
      phase = "ready";
      appliedResultPending = true;
      undoRouted = false;
      visibleError = "";
      render();
      return true;
    }
    return false;
  }

  function saveCurrentTemplate(): void {
    const name = normalizeTemplateName(view.templateName.value);
    if (
      !draft ||
      !plan ||
      phase !== "ready" ||
      savingTemplate ||
      validateCanvasDraft(draft) ||
      !name
    ) return;
    const requestId = nextTemplateRequestId;
    nextTemplateRequestId += 1;
    savingTemplate = true;
    pendingTemplateRequestId = requestId;
    visibleError = "";
    input.post({
      type: "save-template",
      workspace: "canvas",
      requestId,
      name,
      template: canvasTemplateFromSet(specFromDraft(draft)),
    });
    render();
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (!active) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      input.onBack();
      return true;
    }
    const shortcutPhase: Phase = phase === "ready" || phase === "applied" ? phase : "loading";
    const result = handleWorkspaceHistoryShortcut({
      event,
      phase: shortcutPhase,
      appliedResultPending,
      undoRouted,
      history,
      post: input.post,
      restore(restored) {
        draft = restored;
        render();
        planFrames.cancel();
        void requestPlan();
      },
    });
    undoRouted = result.undoRouted;
    return result.handled;
  }

  function selectVariant(id: string): void {
    if (!draft) return;
    draft = selectCanvasVariant(draft, id);
    renderActivePreview();
    render();
  }

  function previewDraft(next: CanvasDraft): void {
    if (!draft || next === draft) return;
    draft = next;
    phase = "ready";
    appliedResultPending = false;
    undoRouted = false;
    visibleError = "";
    planFrames.request();
    renderChrome();
  }

  function updateDraft(next: CanvasDraft): void {
    if (!draft || next === draft) return;
    draft = next;
    history?.push(next);
    phase = "ready";
    appliedResultPending = false;
    undoRouted = false;
    visibleError = "";
    render();
    // Numeric typing already queued a coalesced preview behind this commit;
    // flush it. Every other commit path (operation, background, anchor,
    // reset, variant add/remove) changed geometry with nothing queued, and
    // without a fresh plan the preview and variant sizes freeze on the old
    // plan.
    if (planFrames.pending()) planFrames.flush();
    else void requestPlan();
  }

  function bindNumericField(
    control: HTMLInputElement,
    patch: (value: number) => Partial<Omit<CanvasVariantDraft, "id">> | undefined,
  ): void {
    control.addEventListener("input", () => {
      if (!draft) return;
      const value = parseCanvasNumericPreview(control.value);
      if (value === undefined) return;
      const nextPatch = patch(value);
      if (!nextPatch) return;
      const next = updateCanvasVariant(draft, draft.activeId, nextPatch);
      if (next === draft || validateCanvasDraft(next)) return;
      previewDraft(next);
    });
    control.addEventListener("change", () => {
      if (!draft) return;
      const nextPatch = patch(Number(control.value));
      if (!nextPatch) return;
      updateDraft(updateCanvasVariant(draft, draft.activeId, nextPatch));
    });
  }

  function commitVariantId(): void {
    if (!draft) return;
    const currentId = draft.activeId;
    const nextId = view.variantId.value.trim();
    const next = renameCanvasVariant(draft, currentId, nextId);
    if (next === draft && nextId !== currentId) {
      visibleError = input.copy().invalid;
      render();
      return;
    }
    updateDraft(next);
  }

  function commitBackground(background: CanvasBackground): void {
    if (!draft) return;
    updateDraft(updateCanvasVariant(draft, draft.activeId, { background }));
  }

  function resetDraft(): void {
    if (!draft || !baseline) return;
    updateDraft(cloneCanvasDraft(baseline));
  }

  function renderTemplateSave(): void {
    const busy = phase === "applying";
    view.templateName.disabled = busy || savingTemplate || !draft;
    const saveDisabled =
      busy ||
      savingTemplate ||
      !plan ||
      !draft ||
      Boolean(validateCanvasDraft(draft)) ||
      !normalizeTemplateName(view.templateName.value);
    view.saveTemplate.disabled = saveDisabled;
    view.saveTemplate.title = saveDisabled ? input.copy().saveTemplate : "";
  }

  function render(): void {
    const copy = input.copy();
    view.applyCopy(copy);
    view.sourceName.textContent = source?.sourceName ?? "";
    renderVariantTabs(view, draft, plan, selectVariant);
    const variant = draft ? activeCanvasVariant(draft) : undefined;
    if (variant) renderInspector(variant, copy);
    renderChrome();
  }

  function renderChrome(): void {
    const copy = input.copy();
    const variant = draft ? activeCanvasVariant(draft) : undefined;
    const busy = phase === "applying";
    const ready = Boolean(source && variant && plan) && phase === "ready" && !validateCanvasDraft(draft!);
    for (const control of inspectorControls(view)) control.disabled = busy || !variant;
    view.addVariant.disabled =
      busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length >= 8;
    view.removeVariant.disabled =
      busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length <= 1;
    renderTemplateSave();
    view.reset.disabled = busy || !baseline;
    view.apply.disabled = !ready;
    view.applyNew.hidden = !source?.targetNodeId;
    view.applyNew.disabled = !ready;
    view.apply.textContent = canvasPrimaryActionLabel(copy, {
      phase,
      replacing: Boolean(source?.targetNodeId),
      variantCount: draft?.variants.length ?? 0,
    });
    view.error.hidden = visibleError.length === 0;
    view.error.textContent = visibleError;
    view.status.textContent = savingTemplate
      ? copy.savingTemplate
      : savedNotice
        ? copy.templateSaved
        : phase === "planning"
          ? copy.planning
          : phase === "applying"
            ? copy.applying
            : phase === "applied"
              ? copy.applied
              : "";
    input.root.setAttribute("aria-busy", String(busy));
  }

  function syncField(field: HTMLInputElement, value: string): void {
    if (document.activeElement === field) return;
    if (field.value !== value) field.value = value;
  }

  function renderInspector(variant: CanvasVariantDraft, copy: CanvasWorkspaceCopy): void {
    view.operation.value = variant.kind;
    for (const button of view.operationChoices.querySelectorAll<HTMLButtonElement>("button[data-operation]")) {
      button.setAttribute("aria-pressed", String(button.dataset.operation === variant.kind));
    }
    view.outputGroup.hidden = !["contain", "cover", "stretch"].includes(variant.kind);
    view.cropGroup.hidden = variant.kind !== "crop";
    view.trimGroup.hidden = variant.kind !== "trim";
    view.padGroup.hidden = variant.kind !== "pad";
    view.anchorField.hidden = !["contain", "cover"].includes(variant.kind);
    view.backgroundField.hidden = !["pad", "contain", "cover"].includes(variant.kind);
    view.backgroundColor.hidden =
      view.backgroundField.hidden || variant.background.kind !== "color";
    syncField(view.variantId, variant.id);
    syncField(view.width, String(variant.width));
    syncField(view.height, String(variant.height));
    syncField(view.cropX, String(variant.crop.x));
    syncField(view.cropY, String(variant.crop.y));
    syncField(view.cropWidth, String(variant.crop.width));
    syncField(view.cropHeight, String(variant.crop.height));
    syncField(view.trimThreshold, String(variant.trimThreshold));
    syncField(view.padTop, String(variant.insets.top));
    syncField(view.padRight, String(variant.insets.right));
    syncField(view.padBottom, String(variant.insets.bottom));
    syncField(view.padLeft, String(variant.insets.left));
    renderAnchors(view, variant.anchor, copy, (anchor) => {
      if (!draft) return;
      updateDraft(updateCanvasVariant(draft, draft.activeId, { anchor }));
    });
    view.background.value = variant.background.kind;
    if (variant.background.kind === "color") {
      view.backgroundColor.value = rgbaToHex(variant.background.rgba);
    }
  }

  return {
    enter,
    leave,
    setSource,
    selectionLoading,
    clearSource,
    updateLocale: render,
    handleMainMessage,
    handleKeydown,
    loadTemplate(spec) {
      if (!source || !sourceImage) return false;
      const next = draftFromStoredCanvasSet(
        spec,
        sourceImage.naturalWidth,
        sourceImage.naturalHeight,
      );
      if (validateCanvasDraft(next)) return false;
      draft = next;
      baseline = cloneCanvasDraft(next);
      history = createCanvasHistory(next);
      plan = undefined;
      phase = active ? "planning" : "ready";
      savedNotice = false;
      view.templateName.value = input.copy().templateNamePlaceholder;
      visibleError = "";
      render();
      if (active) {
        planFrames.cancel();
        void requestPlan();
      }
      return true;
    },
    finishTemplateSave(requestId, error) {
      if (!savingTemplate || pendingTemplateRequestId !== requestId) return;
      savingTemplate = false;
      pendingTemplateRequestId = undefined;
      savedNotice = !error;
      if (error) visibleError = error;
      render();
    },
    dispose() {
      leave();
      input.root.replaceChildren();
    },
  };
}

function activeGeneration(source: WorkspaceSource): number {
  return source.selectionGeneration;
}

export {
  canvasPrimaryActionLabel,
  canvasResultPlacements,
  draftFromStoredCanvasSet,
  specFromDraft,
  variantTabTargetIndex,
} from "./canvas-workspace-support";
