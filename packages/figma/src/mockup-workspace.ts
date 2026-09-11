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
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
  type LoadedDesignerSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";
import {
  normalizeTemplateName,
  spatialTemplateFromMockup,
  templateSourceCount,
  type FigmaSpatialTemplate,
} from "./stored-template-library";

export interface MockupWorkspaceCopy extends DesignerWorkspaceCopy {
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
    <div class="designer-row"><label class="designer-field"><span data-role="width-label"></span><input data-role="width" type="number" min="1" max="4096" step="1"></label><label class="designer-field"><span data-role="height-label"></span><input data-role="height" type="number" min="1" max="4096" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="opacity-label"></span><input data-role="opacity" type="range" min="0" max="100" step="1"></label>
    <label class="designer-field"><span><input data-role="grid" type="checkbox"> <span data-role="grid-label"></span></span></label>
    <div class="designer-row" data-role="grid-size"><label class="designer-field"><span data-role="columns-label"></span><input data-role="columns" type="number" min="1" max="64" step="1"></label><label class="designer-field"><span data-role="rows-label"></span><input data-role="rows" type="number" min="1" max="64" step="1"></label></div>
    <div class="inspector-divider" aria-hidden="true"></div>
    <label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80"></label>
    <span class="designer-row"><button data-role="save-template" type="button"></button> <button data-role="copy-parameters" type="button"></button></span>`;
  const planes = role<HTMLDivElement>(shell.inspector, "planes");
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
  let busy = false;
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

  shell.back.addEventListener("click", input.onBack);
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
    if (!source || !spec) return false;
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
      shell.apply.disabled = false;
      if (refreshOverlay) renderOverlay();
      return true;
    } catch (error) {
      if (currentGeneration !== generation) return false;
      previewPlan = undefined;
      previewGeometryKey = "";
      planeLayers.length = 0;
      shell.showError(input.formatError(error));
      shell.apply.disabled = true;
      return false;
    }
  }

  function renderControls(): void {
    if (!spec) return;
    width.value = String(spec.canvas.width);
    height.value = String(spec.canvas.height);
    planes.replaceChildren();
    for (const plane of spec.planes) {
      const button = document.createElement("button");
      button.type = "button";
      button.role = "tab";
      button.textContent = plane.id;
      button.setAttribute("aria-selected", String(plane.id === activePlaneId));
      button.addEventListener("click", () => { activePlaneId = plane.id; renderControls(); renderOverlay(); });
      planes.append(button);
    }
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
    if (!source || !spec || busy) return;
    busy = true;
    phase = "applying";
    // A queued preview frame must not redraw capped pixels over the full
    // resolution output between render and encode.
    previewFrames.cancel();
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      if (!(await render("high"))) throw new Error("Mockup output is invalid");
      postDesignerResult({ post: input.post, source, task: { kind: "mockup", spec }, bytes: await canvasPng(canvas), width: spec.canvas.width, height: spec.canvas.height, duplicate });
    } catch (error) {
      busy = false;
      phase = "ready";
      shell.setBusy(false);
      shell.showError(input.formatError(error));
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
    leave() { overlay?.interrupt(); active = false; shell.root.hidden = true; generation += 1; previewFrames.cancel(); previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0; },
    setSource(next) {
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
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
    clearSource(error) { overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; savingTemplate = false; pendingTemplateRequestId = undefined; templateFeedback = "none"; copyFeedback = "none"; shell.status.textContent = ""; shell.setBusy(false); source = undefined; spec = undefined; history = undefined; previewPlan = undefined; previewGeometryKey = ""; planeLayers.length = 0; shell.showError(error); shell.apply.disabled = true; renderTemplateSave(); },
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
    dispose() { previewFrames.cancel(); overlay?.dispose(); renderer.dispose(); },
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
