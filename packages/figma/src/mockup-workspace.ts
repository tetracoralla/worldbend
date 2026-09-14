import {
  TransformWebGLRenderer,
  normalizedSpec,
  type MockupPlane,
  type MockupPlanOutput,
  type MockupSpecInput,
} from "@worldbend/web";
import { planMockup } from "./designer-plan";
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
  sameDesignerSelection,
  canRetainDesignerDraft,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
  type LoadedDesignerSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, Placement, UiToMainMessage } from "./messages";
import { createSceneDraftClient } from "./scene-draft-client";
import { LIVE_SCENE_DRAFT_ENABLED } from "./scene-draft-policy";
import {
  normalizeTemplateName,
  spatialTemplateFromMockup,
  templateSourceCount,
  type FigmaSpatialTemplate,
} from "./stored-template-library";

export interface MockupWorkspaceCopy extends DesignerWorkspaceCopy {
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
  savingTemplate: string;
  templateSaved: string;
  copyParameters: string;
  parametersCopied: string;
  copyParametersFailed: string;
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
}): MockupTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<div class="designer-tabs" data-role="planes" role="tablist"></div>
    <button data-role="backdrop" type="button"></button>
    <div class="designer-row"><label class="designer-field"><span data-role="width-label"></span><input data-role="width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="height-label"></span><input data-role="height" type="number" min="1" max="4096" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="opacity-label"></span><input data-role="opacity" type="range" min="0" max="100" step="1"></label>
    <label class="designer-field"><span><input data-role="grid" type="checkbox"> <span data-role="grid-label"></span></span></label>
    <div class="designer-row" data-role="grid-size"><label class="designer-field"><span data-role="columns-label"></span><input data-role="columns" type="number" min="1" max="64" step="1"></label><label class="designer-field"><span data-role="rows-label"></span><input data-role="rows" type="number" min="1" max="64" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80"></label>
    <span class="designer-row"><button data-role="save-template" type="button"></button> <button data-role="copy-parameters" type="button"></button></span>`;
  const planes = role<HTMLDivElement>(shell.inspector, "planes");
  const backdrop = role<HTMLButtonElement>(shell.inspector, "backdrop");
  const width = role<HTMLInputElement>(shell.inspector, "width");
  const height = role<HTMLInputElement>(shell.inspector, "height");
  const opacity = role<HTMLInputElement>(shell.inspector, "opacity");
  const grid = role<HTMLInputElement>(shell.inspector, "grid");
  const gridSize = role<HTMLElement>(shell.inspector, "grid-size");
  const columns = role<HTMLInputElement>(shell.inspector, "columns");
  const rows = role<HTMLInputElement>(shell.inspector, "rows");
  const templateName = role<HTMLInputElement>(shell.inspector, "template-name");
  const saveTemplate = role<HTMLButtonElement>(shell.inspector, "save-template");
  const copyParametersButton = role<HTMLButtonElement>(shell.inspector, "copy-parameters");
  const canvas = document.createElement("canvas");
  shell.preview.append(canvas);
  const maybeContext = canvas.getContext("2d");
  if (!maybeContext) throw new Error("Canvas 2D is required for Mockup preview");
  const context: CanvasRenderingContext2D = maybeContext;
  let source: DesignerWorkspaceSource | undefined;
  let spec: MockupSpecInput | undefined;
  let baseline: MockupSpecInput | undefined;
  let history: WorkspaceHistory<MockupSpecInput> | undefined;
  let activePlaneId = "plane-1";
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
  let previewPlan: MockupPlanOutput | undefined;
  let previewGeometryKey = "";
  const planeLayers: HTMLCanvasElement[] = [];
  // Continuous plan changes (opacity drags, corner moves) collapse to one
  // preview request per paint. Overlay moves never rebuild the point layer:
  // the moved point is already positioned by the overlay itself, and a
  // rebuild would destroy the focused button after a single keyboard press.
  const previewFrames = createFrameCoalescer(() => void render("preview", false));

  // Publication-parity feedback on the real Figma canvas. It starts after a
  // composition edit, rather than mutating the document merely on entry.
  const sceneDraft = createSceneDraftClient({
    intervalMs: 250,
    render: async () => {
      if (!spec || !source || busy || refreshing || phase !== "ready" || !canvas.width || !canvas.height) return undefined;
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
      input.post({ type: "scene-draft", generation: source.selectionGeneration, ...frame });
    },
    clear: () => {
      if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
    },
  });
  function clearSceneDraftFeedback(): void {
    sceneDraft.cancel();
    if (source) input.post({ type: "scene-draft-clear", generation: source.selectionGeneration });
  }
  function mockupDraftPlacement(): Placement | undefined {
    if (!source || !spec) return undefined;
    if (source.targetPlacement) return { ...source.targetPlacement };
    // With no stored target, anchor the composite at its lead plane (the
    // backdrop after Use as backdrop) so the draft covers the real scene,
    // fitted to the composite's aspect inside that document box.
    const leadSourceId = spec.planes[0]?.sourceId;
    const lead = (leadSourceId ? sourceForPlane(source.sources, leadSourceId) : undefined) ?? source.sources[0];
    if (!lead) return undefined;
    const fit = Math.min(
      lead.placement.width / spec.canvas.width,
      lead.placement.height / spec.canvas.height,
    );
    const width = spec.canvas.width * fit;
    const height = spec.canvas.height * fit;
    return {
      x: lead.placement.x + (lead.placement.width - width) / 2,
      y: lead.placement.y + (lead.placement.height - height) / 2,
      width,
      height,
    };
  }

  shell.back.addEventListener("click", input.onBack);
  backdrop.addEventListener("click", () => {
    if (!spec || !source || busy || refreshing) return;
    const next = placeOnBackdrop(spec, activePlaneId, source.sources);
    if (!next) return;
    spec = next;
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    activePlaneId = spec.planes[1]?.id ?? spec.planes[0]!.id;
    clearFeedback();
    renderControls();
    void render();
  });
  shell.reset.addEventListener("click", () => {
    if (!baseline) return;
    spec = structuredClone(baseline);
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    activePlaneId = spec.planes[0]?.id ?? "plane-1";
    renderControls();
    void render();
  });
  for (const control of [width, height]) control.addEventListener("change", commitCanvasSize);
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
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));
  templateName.addEventListener("input", () => {
    clearFeedback();
    renderTemplateSave();
  });
  saveTemplate.addEventListener("click", () => void saveCurrentTemplate());
  copyParametersButton.addEventListener("click", () => void copyCurrentParameters());

  function commitCanvasSize(): void {
    if (!spec || !width.validity.valid || !height.validity.valid) return;
    spec = { ...spec, canvas: { width: Number(width.value), height: Number(height.value) } };
    commitHistory();
    previewFrames.request();
  }
  function activePlane(): MockupPlane | undefined { return spec?.planes.find((plane) => plane.id === activePlaneId); }
  function updateActivePlane(patch: Partial<MockupPlane>, commit: boolean): void {
    if (!spec) return;
    spec = { ...spec, planes: spec.planes.map((plane) => plane.id === activePlaneId ? { ...plane, ...patch } : plane) };
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    if (commit) history?.push(spec);
    previewFrames.request();
  }

  function commitHistory(): void {
    if (!spec) return;
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
  }

  async function render(quality: "preview" | "high" = "preview", refreshOverlay = true): Promise<boolean> {
    if (!active || (quality === "preview" && busy) || !source || !spec) return false;
    const currentGeneration = ++generation;
    try {
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
      if (canvas.width !== previewWidth) canvas.width = previewWidth;
      if (canvas.height !== previewHeight) canvas.height = previewHeight;
      fitPreviewCanvas(canvas, shell.preview);
      if (!reusePreview) {
        planeLayers.length = 0;
        for (let index = 0; index < plan.planes.length; index += 1) {
          const plane = plan.planes[index]!;
          const image = sourceForPlane(source.sources, plane.sourceId);
          if (!image) throw new Error(`Missing ${plane.sourceId}`);
          renderer.render(image.image, scaleSolveByFactor(plane.solve, factor), undefined, quality);
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
      context.setTransform(factor, 0, 0, factor, 0, 0);
      context.clearRect(0, 0, plan.canvas.width, plan.canvas.height);
      if (plan.background.kind === "color") {
        const [r, g, b, a] = plan.background.rgba;
        context.fillStyle = `rgba(${r} ${g} ${b} / ${a / 255})`;
        context.fillRect(0, 0, plan.canvas.width, plan.canvas.height);
      }
      for (let index = 0; index < plan.planes.length; index += 1) {
        const plane = plan.planes[index]!;
        const layer = planeLayers[index];
        if (!layer) throw new Error(`Missing ${plane.id}`);
        const opacity = spec.planes.find((candidate) => candidate.id === plane.id)?.opacity ?? plane.opacity;
        context.save();
        context.globalAlpha = opacity;
        context.drawImage(
          layer,
          0,
          0,
          plane.solve.resolvedDestination.reference.width,
          plane.solve.resolvedDestination.reference.height,
        );
        context.restore();
        if (plane.grid) drawGrid(context, plane.grid, 1 / factor);
      }
      shell.showError();
      shell.apply.disabled = busy || refreshing; shell.applyNew.disabled = busy || refreshing;
      if (refreshOverlay && quality === "preview") renderOverlay();
      if (LIVE_SCENE_DRAFT_ENABLED && quality === "preview" && phase === "ready" && !busy && !refreshing) {
        if (baseline && JSON.stringify(spec) !== JSON.stringify(baseline)) sceneDraft.request();
        else clearSceneDraftFeedback();
      }
      return true;
    } catch (error) {
      if (currentGeneration !== generation) return false;
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;
      clearSceneDraftFeedback();
      shell.showError(input.formatError(error));
      shell.apply.disabled = true; shell.applyNew.disabled = true;
      return false;
    }
  }

  function renderControls(): void {
    if (!spec) return;
    backdrop.textContent = input.copy().backdrop;
    backdrop.disabled = busy || refreshing || spec.planes.length < 2;
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
    opacity.value = String(Math.round((active?.opacity ?? 1) * 100));
    grid.checked = Boolean(active?.grid);
    gridSize.hidden = !active?.grid;
    columns.value = String(active?.grid?.columns ?? 4);
    rows.value = String(active?.grid?.rows ?? 4);
    shell.applyNew.hidden = !source?.targetNodeId;
  }

  function renderOverlay(): void {
    overlay?.dispose();
    const plane = activePlane();
    if (!plane) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas,
      onMove(id, point, final) {
        const current = activePlane();
        if (!current) return;
        const quad = { ...current.transform.destination.quad, [id]: point };
        if (!spec) return;
        spec = { ...spec, planes: spec.planes.map((candidate) => candidate.id === activePlaneId
          ? { ...candidate, transform: { ...candidate.transform, destination: { space: "normalized", quad } } }
          : candidate) };
        phase = "ready";
        undoRouted = false;
        appliedResultPending = false;
        previewFrames.request();
        if (final) { previewFrames.flush(); history?.push(spec); }
      },
    });
    const copy = input.copy();
    overlay.set((["tl", "tr", "br", "bl"] as const).map((id) => ({ id, ...plane.transform.destination.quad[id], label: copy.corner.replace("{corner}", id.toUpperCase()) })));
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!active || !source || !spec || busy || refreshing) return;
    overlay?.interrupt();
    clearSceneDraftFeedback();
    previewFrames.cancel();
    const appliedSource = source;
    const appliedSpec = spec;
    const epoch = ++publicationEpoch;
    const current = () => active && publicationEpoch === epoch && source === appliedSource && spec === appliedSpec;
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
      postDesignerResult({ post: input.post, source: appliedSource, task: { kind: "mockup", spec: appliedSpec },
        bytes, width: appliedSpec.canvas.width, height: appliedSpec.canvas.height, duplicate });
    } catch (error) {
      if (!current()) return;
      busy = false; phase = "ready"; shell.setBusy(false); renderControls(); shell.showError(input.formatError(error));
    }
  }

  function restoreHistory(restored: MockupSpecInput): void {
    spec = restored;
    if (!spec.planes.some((plane) => plane.id === activePlaneId)) {
      activePlaneId = spec.planes[0]?.id ?? "plane-1";
    }
    renderControls();
    void render();
  }

  async function saveCurrentTemplate(): Promise<void> {
    const name = normalizeTemplateName(templateName.value);
    if (!spec || !name || savingTemplate) return;
    clearFeedback();
    savingTemplate = true;
    renderTemplateSave();
    shell.status.textContent = input.copy().savingTemplate;
    try {
      const template = spatialTemplateFromMockup(spec);
      const plan = await planMockup(template.operation.spec);
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

  function clearFeedback(): void {
    if (templateFeedback === "saved" || copyFeedback === "copied") shell.status.textContent = "";
    if (templateFeedback === "error" || copyFeedback === "error") shell.showError();
    templateFeedback = "none";
    copyFeedback = "none";
  }

  async function copyCurrentParameters(): Promise<void> {
    if (!spec) return;
    clearFeedback();
    const copied = await copyPlacementParameters(placementParametersJson(spec));
    copyFeedback = copied ? "copied" : "error";
    shell.status.textContent = copied ? input.copy().parametersCopied : "";
    if (!copied) shell.showError(input.copy().copyParametersFailed);
  }

  function renderTemplateSave(): void {
    templateName.disabled = busy || savingTemplate || !spec;
    saveTemplate.disabled = busy || savingTemplate || !spec || !normalizeTemplateName(templateName.value);
    copyParametersButton.disabled = busy || !spec;
  }

  return {
    enter() { active = true; shell.root.hidden = false; void render(); overlay?.refresh(); },
    leave() { overlay?.interrupt(); clearSceneDraftFeedback(); publicationEpoch += 1; active = false; busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false); shell.root.hidden = true; generation += 1; previewFrames.cancel(); previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0; },
    selectionLoading() {
      overlay?.interrupt();
      clearSceneDraftFeedback();
      refreshing = true; publicationEpoch += 1; generation += 1; previewFrames.cancel();
      busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
    },
    setSource(next) {
      refreshing = false;
      const retain = canRetainDesignerDraft(source, next) && spec !== undefined;

      publicationEpoch += 1; generation += 1; previewFrames.cancel();
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
      if (retain) {
        renderControls();
        previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0;
        if (active) void render();
        return;
      }
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;
      spec = next.task?.kind === "mockup" ? structuredClone(next.task.spec) : defaultMockup(next.sources);
      baseline = structuredClone(spec);
      history = createWorkspaceHistory(spec);
      phase = "ready";
      undoRouted = false;
      activePlaneId = spec.planes[0]?.id ?? "plane-1";
      clearFeedback();
      if (!savingTemplate) shell.status.textContent = "";
      shell.showError();
      templateName.value = input.copy().templateNamePlaceholder;
      renderControls();
      renderTemplateSave();
      if (active) void render();
    },
    clearSource(error) { refreshing = false; clearSceneDraftFeedback(); publicationEpoch += 1; generation += 1; previewFrames.cancel(); overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; savingTemplate = false; pendingTemplateRequestId = undefined; templateFeedback = "none"; copyFeedback = "none"; shell.status.textContent = ""; shell.setBusy(false); source = undefined; spec = undefined; history = undefined; previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0; shell.showError(error); shell.apply.disabled = true; shell.applyNew.disabled = true; renderTemplateSave(); },
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      for (const [name, text] of [["width-label", copy.width], ["height-label", copy.height], ["opacity-label", copy.opacity], ["grid-label", copy.grid], ["columns-label", copy.columns], ["rows-label", copy.rows], ["template-name-label", copy.templateName]] as const) role<HTMLElement>(shell.inspector, name).textContent = text;
      templateName.placeholder = copy.templateNamePlaceholder;
      saveTemplate.textContent = copy.saveTemplate;
      copyParametersButton.textContent = copy.copyParameters;
      renderOverlay();
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      busy = false; shell.setBusy(false); renderTemplateSave();
      if (message.type === "apply-designer-error") { phase = "ready"; appliedResultPending = false; shell.showError(input.formatError(message.message)); }
      else { phase = "ready"; appliedResultPending = true; undoRouted = false; shell.status.textContent = input.copy().applied; }
      return true;
    },
    handleKeydown(event) {
      if (event.key === "Escape") { event.preventDefault(); input.onBack(); return true; }
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    loadTemplate(template) {
      if (!source || templateSourceCount(template) !== source.sources.length) return false;
      spec = structuredClone(template.operation.spec);
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;
      baseline = structuredClone(spec);
      history = createWorkspaceHistory(spec);
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      activePlaneId = spec.planes[0]?.id ?? "plane-1";
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
    dispose() { publicationEpoch += 1; generation += 1; active = false; clearSceneDraftFeedback(); previewFrames.cancel(); overlay?.dispose(); renderer.dispose(); },
  };
}

/** Geometry that requires a new solve. Opacity is presentation-only. */
export function mockupGeometryFingerprint(spec: MockupSpecInput): string {
  return JSON.stringify({
    canvas: spec.canvas,
    background: spec.background,
    seams: spec.seams,
    planes: spec.planes.map((plane) => ({
      id: plane.id,
      sourceId: plane.sourceId,
      transform: plane.transform,
      grid: plane.grid ?? null,
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

function sourceForPlane(sources: readonly LoadedDesignerSource[], id: string): LoadedDesignerSource | undefined {
  const match = /^source-(\d+)$/.exec(id); return match ? sources[Number(match[1]) - 1] : undefined;
}
function drawGrid(context: CanvasRenderingContext2D, grid: { vertical: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }>; horizontal: Array<{ start: { x: number; y: number }; end: { x: number; y: number } }> }, lineWidth: number): void {
  context.save(); context.strokeStyle = "rgba(13,153,255,.55)"; context.lineWidth = lineWidth;
  for (const line of [...grid.vertical, ...grid.horizontal]) { context.beginPath(); context.moveTo(line.start.x, line.start.y); context.lineTo(line.end.x, line.end.y); context.stroke(); }
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
