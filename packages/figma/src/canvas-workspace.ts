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
  eventTargetEditsText,
  hexToRgba,
  imageRgba,
  inspectorControls,
  renderAnchors,
  renderVariantTabs,
  rgbaToHex,
  specFromDraft,
  type CanvasWorkspacePhase,
} from "./canvas-workspace-support";

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
  let visibleError = "";

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
  view.width.addEventListener("change", () => commitNumber("width", view.width.value));
  view.height.addEventListener("change", () => commitNumber("height", view.height.value));
  for (const [control, key] of [
    [view.cropX, "x"],
    [view.cropY, "y"],
    [view.cropWidth, "width"],
    [view.cropHeight, "height"],
  ] as const) {
    control.addEventListener("change", () => commitNestedNumber("crop", key, control.value));
  }
  view.trimThreshold.addEventListener("change", () =>
    commitNumber("trimThreshold", view.trimThreshold.value),
  );
  for (const [control, key] of [
    [view.padTop, "top"],
    [view.padRight, "right"],
    [view.padBottom, "bottom"],
    [view.padLeft, "left"],
  ] as const) {
    control.addEventListener("change", () => commitNestedNumber("insets", key, control.value));
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
    view.preview.replaceChildren(renderer.canvas);
    render();
    if (source && draft) void requestPlan();
    queueMicrotask(() => view.back.focus());
  }

  function leave(): void {
    if (!active) return;
    active = false;
    planGeneration += 1;
    plan = undefined;
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
    visibleError = "";
    if (!same || !draft) {
      draft = nextSource.canvas
        ? draftFromStoredCanvas(nextSource.canvas.operation, image.naturalWidth, image.naturalHeight)
        : createCanvasDraft(image.naturalWidth, image.naturalHeight);
      baseline = cloneCanvasDraft(draft);
      history = createCanvasHistory(draft);
    } else {
      draft = { ...draft, source: { width: image.naturalWidth, height: image.naturalHeight } };
      baseline = baseline
        ? { ...baseline, source: { ...draft.source } }
        : cloneCanvasDraft(draft);
    }
    phase = active ? "planning" : "ready";
    render();
    if (active) void requestPlan();
  }

  function selectionLoading(): void {
    if (!active) return;
    planGeneration += 1;
    phase = "planning";
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
    visibleError = error;
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
      render();
      return;
    }
    const generation = ++planGeneration;
    const plannedDraft = draft;
    phase = "planning";
    visibleError = "";
    render();
    try {
      const nextPlan = await planDraft(plannedDraft, sourceImage);
      if (!active || generation !== planGeneration || draft !== plannedDraft) return;
      plan = nextPlan;
      phase = "ready";
      renderActivePreview();
      render();
    } catch (error) {
      if (!active || generation !== planGeneration) return;
      plan = undefined;
      phase = "ready";
      visibleError = input.formatError(error);
      render();
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
    const generation = planGeneration;
    phase = "applying";
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
      visibleError = input.formatError(message.message);
      renderActivePreview();
      render();
      return true;
    }
    if (message.type === "apply-canvas-complete") {
      if (!source || message.generation !== activeGeneration(source)) return true;
      phase = "applied";
      undoRouted = false;
      visibleError = "";
      render();
      return true;
    }
    return false;
  }

  function handleKeydown(event: KeyboardEvent): boolean {
    if (!active) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      input.onBack();
      return true;
    }
    const command = event.metaKey || event.ctrlKey;
    if (!command || event.key.toLowerCase() !== "z") return false;
    if (eventTargetEditsText(event.target)) return false;
    event.preventDefault();
    if (phase === "applied" && !event.shiftKey && !undoRouted) {
      undoRouted = true;
      input.post({ type: "trigger-undo" });
      return true;
    }
    if (phase !== "ready" || !history) return true;
    const restored = event.shiftKey ? history.redo() : history.undo();
    if (restored) {
      draft = restored;
      void requestPlan();
    }
    return true;
  }

  function updateDraft(next: CanvasDraft): void {
    if (!draft || next === draft) return;
    draft = next;
    history?.push(next);
    phase = "ready";
    visibleError = "";
    render();
    void requestPlan();
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

  function commitNumber(key: "width" | "height" | "trimThreshold", value: string): void {
    if (!draft) return;
    updateDraft(updateCanvasVariant(draft, draft.activeId, { [key]: Number(value) }));
  }

  function commitNestedNumber(
    group: "crop" | "insets",
    key: string,
    value: string,
  ): void {
    if (!draft) return;
    const variant = activeCanvasVariant(draft);
    if (!variant) return;
    updateDraft(
      updateCanvasVariant(draft, draft.activeId, {
        [group]: { ...variant[group], [key]: Number(value) },
      }),
    );
  }

  function commitBackground(background: CanvasBackground): void {
    if (!draft) return;
    updateDraft(updateCanvasVariant(draft, draft.activeId, { background }));
  }

  function resetDraft(): void {
    if (!draft || !baseline) return;
    updateDraft(cloneCanvasDraft(baseline));
  }

  function render(): void {
    const copy = input.copy();
    view.applyCopy(copy);
    view.sourceName.textContent = source?.sourceName ?? "";
    renderVariantTabs(view, draft, plan, (id) => {
      if (!draft) return;
      draft = selectCanvasVariant(draft, id);
      renderActivePreview();
      render();
    });
    const variant = draft ? activeCanvasVariant(draft) : undefined;
    if (variant) renderInspector(variant, copy);
    const busy = phase === "planning" || phase === "applying";
    const ready = Boolean(source && variant) && phase === "ready" && !validateCanvasDraft(draft!);
    for (const control of inspectorControls(view)) control.disabled = busy || !variant;
    view.addVariant.disabled =
      busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length >= 8;
    view.removeVariant.disabled =
      busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length <= 1;
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
    view.status.textContent =
      phase === "planning"
        ? copy.planning
        : phase === "applying"
          ? copy.applying
          : phase === "applied"
            ? copy.applied
            : "";
    input.root.setAttribute("aria-busy", String(busy));
  }

  function renderInspector(variant: CanvasVariantDraft, copy: CanvasWorkspaceCopy): void {
    view.variantId.value = variant.id;
    view.operation.value = variant.kind;
    view.outputGroup.hidden = !["contain", "cover", "stretch"].includes(variant.kind);
    view.cropGroup.hidden = variant.kind !== "crop";
    view.trimGroup.hidden = variant.kind !== "trim";
    view.padGroup.hidden = variant.kind !== "pad";
    view.anchorField.hidden = !["contain", "cover"].includes(variant.kind);
    view.backgroundField.hidden = !["pad", "contain", "cover"].includes(variant.kind);
    view.backgroundColor.hidden =
      view.backgroundField.hidden || variant.background.kind !== "color";
    view.width.value = String(variant.width);
    view.height.value = String(variant.height);
    view.cropX.value = String(variant.crop.x);
    view.cropY.value = String(variant.crop.y);
    view.cropWidth.value = String(variant.crop.width);
    view.cropHeight.value = String(variant.crop.height);
    view.trimThreshold.value = String(variant.trimThreshold);
    view.padTop.value = String(variant.insets.top);
    view.padRight.value = String(variant.insets.right);
    view.padBottom.value = String(variant.insets.bottom);
    view.padLeft.value = String(variant.insets.left);
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
  specFromDraft,
  variantTabTargetIndex,
} from "./canvas-workspace-support";
