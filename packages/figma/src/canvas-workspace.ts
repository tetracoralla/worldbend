import {
  CanvasRasterRenderer,
  planCanvasSet,
  type CanvasSetPlan,
} from "@worldbend/web";
import type { MainToUiMessage, SourcePayload, UiToMainMessage } from "./messages";
import {
  activeCanvasVariant,
  addCanvasVariant,
  cloneCanvasDraft,
  createCanvasDraft,
  removeCanvasVariant,
  selectCanvasVariant,
  updateCanvasVariant,
  validateCanvasDraft,
  type CanvasAnchor,
  type CanvasBackground,
  type CanvasDraft,
} from "./canvas-state";
import { createCanvasHistory, type CanvasHistory } from "./canvas-history";
import type { OwnedCanvasSetSpec } from "./stored-canvas";
import {
  createCanvasWorkspaceView,
  type CanvasWorkspaceCopy,
  type CanvasWorkspaceView,
} from "./canvas-workspace-view";

type WorkspaceSource = Omit<SourcePayload, "bytes"> & { selectionGeneration: number };
type WorkspacePhase = "idle" | "planning" | "ready" | "applying" | "applied";

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
  requestSourceRaster(source: WorkspaceSource, desired: { width: number; height: number }): Promise<Uint8Array>;
  decodeImage(bytes: Uint8Array): Promise<HTMLImageElement>;
  formatError(error: unknown): string;
}): CanvasWorkspace {
  const view = createCanvasWorkspaceView(input.root);
  let active = false;
  let source: WorkspaceSource | undefined;
  let sourceImage: HTMLImageElement | undefined;
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
  view.width.addEventListener("change", () => commitAxis("width", view.width.value));
  view.height.addEventListener("change", () => commitAxis("height", view.height.value));
  view.contain.addEventListener("click", () => commitFit("contain"));
  view.cover.addEventListener("click", () => commitFit("cover"));
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
  view.reset.addEventListener("click", () => resetDraft());
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
    undoRouted = false;
    visibleError = "";
    if (!same || !draft) {
      draft = nextSource.canvas
        ? draftFromStoredCanvas(nextSource.canvas.operation)
        : createCanvasDraft(nextSource.renderWidth, nextSource.renderHeight);
      baseline = cloneCanvasDraft(draft);
      history = createCanvasHistory(draft);
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
      const nextPlan = await planCanvasSet(specFromDraft(plannedDraft), {
        width: sourceImage.naturalWidth,
        height: sourceImage.naturalHeight,
      });
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
      const desired = applyingDraft.variants.reduce(
        (size, variant) => ({
          width: Math.max(size.width, variant.width),
          height: Math.max(size.height, variant.height),
        }),
        { width: 1, height: 1 },
      );
      const bytes = await input.requestSourceRaster(applyingSource, desired);
      const finalSource = await input.decodeImage(bytes);
      const finalPlan = await planCanvasSet(specFromDraft(applyingDraft), {
        width: finalSource.naturalWidth,
        height: finalSource.naturalHeight,
      });
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

  function commitAxis(axis: "width" | "height", value: string): void {
    if (!draft) return;
    const parsed = Number(value);
    updateDraft(updateCanvasVariant(draft, draft.activeId, { [axis]: parsed }));
  }

  function commitFit(fit: "contain" | "cover"): void {
    if (!draft) return;
    updateDraft(updateCanvasVariant(draft, draft.activeId, { fit }));
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
    renderVariantTabs(view, draft, (id) => {
      if (!draft) return;
      draft = selectCanvasVariant(draft, id);
      renderActivePreview();
      render();
    });
    const variant = draft ? activeCanvasVariant(draft) : undefined;
    if (variant) {
      view.width.value = String(variant.width);
      view.height.value = String(variant.height);
      view.contain.setAttribute("aria-pressed", String(variant.fit === "contain"));
      view.cover.setAttribute("aria-pressed", String(variant.fit === "cover"));
      renderAnchors(view, variant.anchor, copy, (anchor) => {
        if (!draft) return;
        updateDraft(updateCanvasVariant(draft, draft.activeId, { anchor }));
      });
      view.background.value = variant.background.kind;
      view.backgroundColor.hidden = variant.background.kind !== "color";
      if (variant.background.kind === "color") {
        view.backgroundColor.value = rgbaToHex(variant.background.rgba);
      }
    }
    const busy = phase === "planning" || phase === "applying";
    const ready = Boolean(source && variant) && phase === "ready" && !validateCanvasDraft(draft!);
    for (const control of [
      view.width,
      view.height,
      view.contain,
      view.cover,
      view.background,
      view.backgroundColor,
      ...view.anchorGrid.querySelectorAll<HTMLButtonElement>("button"),
    ]) {
      control.disabled = busy || !variant;
    }
    view.addVariant.disabled = busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length >= 8;
    view.removeVariant.disabled = busy || !draft || Boolean(source?.targetNodeId) || draft.variants.length <= 1;
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

export function canvasPrimaryActionLabel(
  copy: Pick<CanvasWorkspaceCopy, "apply" | "applyVariants" | "applying" | "replace">,
  state: { phase: WorkspacePhase; replacing: boolean; variantCount: number },
): string {
  if (state.phase === "applying") return copy.applying;
  if (state.replacing) return copy.replace;
  return state.variantCount > 1 ? copy.applyVariants : copy.apply;
}

export function canvasResultPlacements(
  base: SourcePayload["placement"],
  sizes: readonly { width: number; height: number }[],
  replacing: boolean,
): SourcePayload["placement"][] {
  if (replacing && sizes.length === 1) {
    return [{ x: base.x, y: base.y, width: sizes[0]!.width, height: sizes[0]!.height }];
  }
  let x = base.x + base.width + 48;
  return sizes.map((size) => {
    const placement = { x, y: base.y, width: size.width, height: size.height };
    x += size.width + 48;
    return placement;
  });
}

function specFromDraft(draft: CanvasDraft): OwnedCanvasSetSpec {
  return {
    schema: "worldbend.canvas-set",
    version: "0.1",
    variants: draft.variants.map((variant) => ({
      id: variant.id,
      operation: {
        kind: variant.fit,
        output: { width: variant.width, height: variant.height },
        anchor: { ...variant.anchor },
        background:
          variant.background.kind === "transparent"
            ? { kind: "transparent" }
            : { ...variant.background, rgba: [...variant.background.rgba] },
      },
    })),
  };
}

function draftFromStoredCanvas(operation: OwnedCanvasSetSpec["variants"][number]["operation"]): CanvasDraft {
  const draft = createCanvasDraft(operation.output.width, operation.output.height);
  draft.variants[0] = {
    ...draft.variants[0]!,
    fit: operation.kind,
    anchor: { ...operation.anchor },
    background:
      operation.background.kind === "transparent"
        ? { kind: "transparent" }
        : { ...operation.background, rgba: [...operation.background.rgba] },
  };
  return draft;
}

function renderVariantTabs(
  view: CanvasWorkspaceView,
  draft: CanvasDraft | undefined,
  select: (id: string) => void,
): void {
  view.variants.replaceChildren();
  const variants = draft?.variants ?? [];
  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index]!;
    const button = document.createElement("button");
    button.type = "button";
    button.role = "tab";
    button.id = `canvas-variant-tab-${variant.id}`;
    button.dataset.variantId = variant.id;
    const active = variant.id === draft?.activeId;
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", "canvas-preview");
    button.tabIndex = active ? 0 : -1;
    button.textContent = `${variant.width} × ${variant.height}`;
    button.addEventListener("click", () => select(variant.id));
    button.addEventListener("keydown", (event) => {
      const targetIndex = variantTabTargetIndex(event.key, index, variants.length);
      if (targetIndex === undefined) return;
      event.preventDefault();
      const next = variants[targetIndex];
      if (!next) return;
      select(next.id);
      queueMicrotask(() => {
        view.variants
          .querySelector<HTMLButtonElement>(`[data-variant-id="${next.id}"]`)
          ?.focus();
      });
    });
    view.variants.append(button);
    if (active) view.preview.setAttribute("aria-labelledby", button.id);
  }
}

export function variantTabTargetIndex(
  key: string,
  current: number,
  count: number,
): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  return undefined;
}

function eventTargetEditsText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function renderAnchors(
  view: CanvasWorkspaceView,
  selected: { x: CanvasAnchor; y: CanvasAnchor },
  copy: CanvasWorkspaceCopy,
  choose: (anchor: { x: CanvasAnchor; y: CanvasAnchor }) => void,
): void {
  view.anchorGrid.replaceChildren();
  const values: CanvasAnchor[] = [0, 0.5, 1];
  let index = 0;
  for (const y of values) {
    for (const x of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", copy.anchors[index++] ?? copy.anchor);
      button.setAttribute("aria-pressed", String(x === selected.x && y === selected.y));
      button.addEventListener("click", () => choose({ x, y }));
      view.anchorGrid.append(button);
    }
  }
}

function activeGeneration(source: WorkspaceSource): number {
  return source.selectionGeneration;
}

function hexToRgba(value: string): [number, number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return [255, 255, 255, 255];
  const packed = Number.parseInt(match[1]!, 16);
  return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255, 255];
}

function rgbaToHex(rgba: readonly number[]): string {
  return `#${rgba.slice(0, 3).map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}
