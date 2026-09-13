import { resampleEnvelope } from "./surface-envelope";
export { resampleEnvelope } from "./surface-envelope";
import { planeCoordinates } from "./plane-coordinates";
import {
  TransformWebGLRenderer,
  normalizedSpec,
  type BezierEnvelope,
  type Point,
  type SurfaceDeformationSpecInput,
  type TransformSpec,
  type WarpMesh,
} from "@worldbend/web";
import { planSurfaceDeformation } from "./designer-plan";
import { scalePreviewSolve } from "./designer-preview";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
import { transformForMesh } from "./mesh-workspace";
import {
  appendStrokeSample,
  anchorsForSubdivisions,
  envelopePointRole,
  MAX_SURFACE_ANCHORS,
  nextStrokeId,
  sourceUvFromWarped,
  warpedFromSource,
  strokeAppendLimit,
  strokeSample,
  toggleInteriorAnchor,
} from "./surface-authoring";
import {
  normalizeTemplateName,
} from "./stored-template-library";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import {
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  sameDesignerSelection,
  canRetainDesignerDraft,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface SurfaceWorkspaceCopy extends DesignerWorkspaceCopy {
  patches: string;
  subdivisions: string;
  pointLabel: string;
  handles: string;
  pin: string;
  brush: string;
  radius: string;
  strength: string;
  templateName: string;
  templateNamePlaceholder: string;
  saveTemplate: string;
  savingTemplate: string;
  templateSaved: string;
  splitRequired: string;
  pinDensity: string;
  pinLimit: string;
  strokeLimit: string;
  brushLimit: string;
  strokeSampleLimit: string;
  pinLabel: string;
}

export interface LivePerspectiveSurface {
  spec: TransformSpec;
  width: number;
  height: number;
}

/** Core default; 1×1 and 2×2 patches both divide it. */
export const DEFAULT_SURFACE_SUBDIVISIONS = 12;
export const DEFAULT_SURFACE_PATCHES = { columns: 1, rows: 1 } as const;
const CONTROL_MIN = -2;
const CONTROL_MAX = 3;
const PATCH_CHOICES = [
  { columns: 1, rows: 1 },
  { columns: 2, rows: 1 },
  { columns: 1, rows: 2 },
  { columns: 2, rows: 2 },
] as const;

export function createSurfaceWorkspace(input: {
  root: HTMLElement;
  copy(): SurfaceWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
  livePerspective?(): LivePerspectiveSurface | undefined;
}): DesignerTaskWorkspace & {
  loadTemplate(spec: SurfaceDeformationSpecInput): boolean;
  finishTemplateSave(requestId: number, error?: string): void;
} {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="patches-label"></span><select data-role="patches"></select></label><label class="designer-field"><span data-role="subdivisions-label"></span><select data-role="subdivisions"></select></label><div class="designer-tool-row" role="group" data-role="tools"><button data-role="tool-handles" type="button" aria-pressed="true"></button><button data-role="tool-pin" type="button" aria-pressed="false"></button><button data-role="tool-brush" type="button" aria-pressed="false"></button></div><label class="designer-field" data-role="radius-field"><span data-role="radius-label"></span><span class="designer-range-pair"><input data-role="radius" class="transform-slider" type="range" min="0.05" max="0.6" step="0.01" value="0.15"><input data-role="radius-number" type="number" min="0.05" max="0.6" step="0.01" value="0.15"></span></label><label class="designer-field" data-role="strength-field"><span data-role="strength-label"></span><span class="designer-range-pair"><input data-role="strength" class="transform-slider" type="range" min="0" max="1" step="0.05" value="0.5"><input data-role="strength-number" type="number" min="0" max="1" step="0.05" value="0.5"></span></label><label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80" autocomplete="off"><button data-role="save-template" type="button"></button></label>`;
  const patches = role<HTMLSelectElement>(shell.inspector, "patches");
  const subdivisions = role<HTMLSelectElement>(shell.inspector, "subdivisions");
  const toolHandles = role<HTMLButtonElement>(shell.inspector, "tool-handles");
  const toolPin = role<HTMLButtonElement>(shell.inspector, "tool-pin");
  const toolBrush = role<HTMLButtonElement>(shell.inspector, "tool-brush");
  const radiusField = role<HTMLElement>(shell.inspector, "radius-field");
  const strengthField = role<HTMLElement>(shell.inspector, "strength-field");
  const radius = role<HTMLInputElement>(shell.inspector, "radius");
  const radiusNumber = role<HTMLInputElement>(shell.inspector, "radius-number");
  const strength = role<HTMLInputElement>(shell.inspector, "strength");
  const strengthNumber = role<HTMLInputElement>(shell.inspector, "strength-number");
  const templateName = role<HTMLInputElement>(shell.inspector, "template-name");
  const saveTemplate = role<HTMLButtonElement>(shell.inspector, "save-template");
  for (const choice of PATCH_CHOICES) {
    const option = document.createElement("option");
    option.value = patchValue(choice.columns, choice.rows);
    option.textContent = `${choice.columns} × ${choice.rows}`;
    patches.append(option);
  }
  const renderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  const lattice = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  lattice.setAttribute("class", "direct-point-lattice");
  lattice.setAttribute("aria-hidden", "true");
  shell.preview.append(renderer.canvas, lattice);
  type SurfaceTool = "handles" | "pin" | "brush";
  let overlay: DirectPointOverlay | undefined;
  let source: DesignerWorkspaceSource | undefined;
  let spec: SurfaceDeformationSpecInput | undefined;
  let baseline: SurfaceDeformationSpecInput | undefined;
  let history: WorkspaceHistory<SurfaceDeformationSpecInput> | undefined;
  let generation = 0;
  let coordinates: ReturnType<typeof planeCoordinates> | undefined;
  let busy = false;
  let refreshing = false;
  let active = false;
  let phase: Phase = "idle";
  let undoRouted = false;
  let appliedResultPending = false;
  let tool: SurfaceTool = "handles";
  let lastMesh: WarpMesh | undefined;
  let brush: {
    pointerId: number; id: string; origin: SurfaceDeformationSpecInput;
    lastUv: Point; mesh: WarpMesh; coordinates: ReturnType<typeof planeCoordinates>;
    applied: boolean; undoRouted: boolean;
  } | undefined;
  let brushLimitReason: "samples" | "stroke" | undefined;
  let brushHover: Point | undefined;
  let nextTemplateRequestId = 1;
  let pendingTemplateRequestId: number | undefined;
  let savingTemplate = false;
  const moveFrames = createFrameCoalescer(() => void render(false));

  const latticeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
    if (active && spec) drawLattice(spec.envelope);
  });
  latticeObserver?.observe(shell.preview);
  latticeObserver?.observe(renderer.canvas);
  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => {
    if (!baseline || busy) return;
    finishBrush(); overlay?.interrupt(); brushLimitReason = undefined;
    spec = structuredClone(baseline);
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    renderControls();
    void render();
  });
  patches.addEventListener("change", () => {
    if (!spec || busy || refreshing) return;
    finishBrush(); overlay?.interrupt();
    const next = parsePatchValue(patches.value) ?? DEFAULT_SURFACE_PATCHES;
    const meshSubdivisions = compatibleSubdivisions(next.columns, next.rows, spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS);
    const anchors = anchorsForSubdivisions(spec.anchors ?? [], spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS, meshSubdivisions);
    try {
      if (!anchors) throw new Error(input.copy().pinDensity);
      const envelope = resampleEnvelope(spec.envelope, next.columns, next.rows);
      spec = { ...spec, meshSubdivisions, anchors, envelope };
    } catch (error) {
      renderControls();
      shell.showError(anchors ? input.copy().splitRequired : input.formatError(error));
      return;
    }
    commitEdit(); renderControls(); void render();
  });
  subdivisions.addEventListener("change", () => {
    if (!spec || busy || refreshing) return;
    finishBrush(); overlay?.interrupt();
    const next = Number(subdivisions.value);
    const anchors = anchorsForSubdivisions(spec.anchors ?? [], spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS, next);
    if (!anchors) { renderControls(); shell.showError(input.copy().pinDensity); return; }
    spec = { ...spec, meshSubdivisions: next, anchors };
    commitEdit(); renderControls(); void render();
  });
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));
  toolHandles.addEventListener("click", () => setTool("handles"));
  toolPin.addEventListener("click", () => setTool("pin"));
  toolBrush.addEventListener("click", () => setTool("brush"));
  for (const field of [radius, radiusNumber, strength, strengthNumber]) {
    field.addEventListener("input", () => {
      if (!field.value || !field.validity.valid) return;
      if (field === radius || field === radiusNumber) {
        radius.value = field.value;
        radiusNumber.value = field.value;
      } else {
        strength.value = field.value;
        strengthNumber.value = field.value;
      }
      if (spec) drawLattice(spec.envelope);
    });
  }
  templateName.addEventListener("input", () => renderTemplateSave());
  saveTemplate.addEventListener("click", () => void saveCurrentTemplate());
  renderer.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !active || busy || brush || tool !== "brush" || !spec || !lastMesh || !coordinates) return;
    event.preventDefault();
    const uv = pointerSourceUv(event, lastMesh, coordinates);
    if (!uv) return;
    const id = nextStrokeId(spec.strokes ?? []);
    if (!id) { shell.showError(input.copy().strokeLimit); return; }
    brushLimitReason = undefined;
    brushHover = uv;
    brush = { pointerId: event.pointerId, id, origin: spec, lastUv: uv, mesh: lastMesh, coordinates,
      applied: appliedResultPending, undoRouted };
    drawLattice(spec.envelope);
    try { renderer.canvas.setPointerCapture(event.pointerId); } catch { /* Window events still close the gesture. */ }
  });
  const brushMove = (event: PointerEvent) => {
    if (active && tool === "brush" && lastMesh && coordinates && !busy
      && (!brush || event.pointerId === brush.pointerId)) {
      brushHover = pointerSourceUv(event, brush?.mesh ?? lastMesh, brush?.coordinates ?? coordinates);
      if (spec) drawLattice(spec.envelope);
    }
    if (!brush || event.pointerId !== brush.pointerId) return;
    if (event.buttons === 0) { finishBrush(); return; }
    appendBrush(event);
  };
  const brushUp = (event: PointerEvent) => {
    if (!brush || event.pointerId !== brush.pointerId) return;
    appendBrush(event); finishBrush();
  };
  const brushInterrupted = (event?: PointerEvent) => {
    if (!event || brush?.pointerId === event.pointerId) finishBrush();
  };
  const brushBlur = () => finishBrush();
  const brushHidden = () => { if (document.visibilityState === "hidden") finishBrush(); };
  window.addEventListener("pointermove", brushMove);
  window.addEventListener("pointerup", brushUp);
  window.addEventListener("pointercancel", brushInterrupted);
  window.addEventListener("blur", brushBlur);
  document.addEventListener("visibilitychange", brushHidden);
  renderer.canvas.addEventListener("lostpointercapture", brushInterrupted);

  async function render(refreshOverlay = true): Promise<void> {
    if (!active || busy || !source || !spec) return;
    const first = source.sources[0];
    if (!first) return;
    const currentGeneration = ++generation;
    try {
      const plan = await planSurfaceDeformation(spec);
      if (currentGeneration !== generation) return;
      coordinates = planeCoordinates(plan.meshWarp.solve);
      lastMesh = plan.meshWarp.spec.mesh;
      renderer.render(
        first.image,
        scalePreviewSolve(plan.meshWarp.solve),
        plan.meshWarp.spec.mesh,
        "preview",
      );
      fitPreviewCanvas(renderer.canvas, shell.preview);
      shell.showError(brushCapacityMessage());
      if (refreshOverlay) renderOverlay();
      else drawLattice(spec.envelope);
      shell.apply.disabled = busy || refreshing;
      shell.applyNew.disabled = busy || refreshing;
    } catch (error) {
      if (currentGeneration !== generation) return;
      shell.showError(input.formatError(error));
      shell.apply.disabled = true;
      shell.applyNew.disabled = true;
    }
  }

  function renderControls(): void {
    if (spec) {
      // Stored tasks may carry contract-legal densities this workspace does
      // not author (3×3/4×4 arrive via Agent handoff). Rebuild the list so
      // those values display honestly without accumulating across tasks.
      const current = patchValue(spec.envelope.columns, spec.envelope.rows);
      patches.replaceChildren();
      for (const choice of patchChoicesFor(spec.envelope.columns, spec.envelope.rows)) {
        const option = document.createElement("option");
        option.value = patchValue(choice.columns, choice.rows);
        option.textContent = `${choice.columns} × ${choice.rows}`;
        patches.append(option);
      }
      patches.value = current;
      fillSubdivisionOptions(subdivisions, spec.envelope.columns, spec.envelope.rows, spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS);
    }
    toolHandles.setAttribute("aria-pressed", String(tool === "handles"));
    toolPin.setAttribute("aria-pressed", String(tool === "pin"));
    toolBrush.setAttribute("aria-pressed", String(tool === "brush"));
    radiusField.hidden = tool !== "brush";
    strengthField.hidden = tool !== "brush";
    renderer.canvas.style.touchAction = tool === "brush" ? "none" : "";
    renderer.canvas.style.cursor = tool === "brush" ? "crosshair" : "";
    renderTemplateSave();
    shell.applyNew.hidden = !source?.targetNodeId;
  }

  function applyControlMoves(
    moves: readonly { id: string; point: { x: number; y: number } }[],
    final: boolean,
  ): void {
    if (busy || !spec || moves.length === 0) return;
    const relocated = new Map(moves.map((move) => [Number(move.id), move.point]));
    const points = spec.envelope.points.map((candidate, index) => relocated.get(index) ?? candidate);
    const unchanged = points.every((point, index) => {
      const previous = spec!.envelope.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    });
    if (unchanged) {
      if (final) { moveFrames.flush(); history?.push(spec); }
      return;
    }
    spec = { ...spec, envelope: { ...spec.envelope, points: points as BezierEnvelope["points"] } };
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    moveFrames.request();
    if (final) {
      moveFrames.flush();
      history?.push(spec);
    }
  }

  function renderOverlay(): void {
    overlay?.dispose();
    if (!spec) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas: renderer.canvas,
      ...(coordinates ? { coordinates } : {}),
      selection: tool === "handles" ? "multiple" : "single",
      bounds: tool === "handles" ? { min: CONTROL_MIN, max: CONTROL_MAX } : { min: 0, max: 1 },
      draggable: tool === "handles",
      onMove(id, point, final) {
        if (tool === "handles") applyControlMoves([{ id, point }], final);
      },
      onMoves(moves, final) {
        if (tool === "handles") applyControlMoves(moves, final);
      },
      onActivate(id) {
        if (busy || tool !== "pin" || !spec) return false;
        const [column, row] = id.split(",").map(Number);
        if (column === undefined || row === undefined || !Number.isInteger(column) || !Number.isInteger(row)) return false;
        const anchors = spec.anchors ?? [];
        const pinned = anchors.some((anchor) => anchor.column === column && anchor.row === row);
        if (!pinned && anchors.length >= MAX_SURFACE_ANCHORS) {
          shell.showError(input.copy().pinLimit);
          return true;
        }
        spec = {
          ...spec,
          anchors: toggleInteriorAnchor(
            anchors,
            column,
            row,
            spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS,
          ),
        };
        commitEdit();
        void render();
        return true;
      },
    });
    const copy = input.copy();
    if (tool === "brush") {
      overlay.set([]);
    } else if (tool === "pin" && lastMesh) {
      const side = lastMesh.subdivisions + 1;
      const pinned = new Set((spec.anchors ?? []).map((anchor) => `${anchor.column},${anchor.row}`));
      overlay.set(lastMesh.vertices.flatMap((vertex, index) => {
        const column = index % side;
        const row = Math.floor(index / side);
        if (column === 0 || row === 0 || column + 1 === side || row + 1 === side) return [];
        return [{
          id: `${column},${row}`,
          x: vertex.warped.x,
          y: vertex.warped.y,
          tone: pinned.has(`${column},${row}`) ? "anchor" as const : "curve" as const,
          label: copy.pinLabel.replace("{x}", String(column)).replace("{y}", String(row)),
        }];
      }));
    } else {
      const envelope = spec.envelope;
      const columns = envelope.columns * 3 + 1;
      const rows = envelope.rows * 3 + 1;
      overlay.set(envelope.points.flatMap((point, index) => {
        const role = envelopePointRole(envelope.columns, envelope.rows, index);
        if (role === "boundary") return [];
        const x = index % columns;
        const y = Math.floor(index / columns);
        return [{
          id: String(index),
          x: point.x,
          y: point.y,
          tone: role,
          label: copy.pointLabel.replace("{x}", String(x)).replace("{y}", String(y)),
        }];
      }));
    }
    drawLattice(spec.envelope);
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!active || !source || !spec || busy || refreshing) return;
    finishBrush();
    overlay?.interrupt();
    moveFrames.cancel();
    const appliedSource = source;
    const appliedSpec = spec;
    const currentGeneration = ++generation;
    const current = () => active && generation === currentGeneration && source === appliedSource && spec === appliedSpec;
    busy = true;
    phase = "applying";
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      const first = appliedSource.sources[0];
      if (!first) throw new Error("No source is loaded");
      const plan = await planSurfaceDeformation(appliedSpec);
      if (!current()) return;
      renderer.render(first.image, plan.meshWarp.solve, plan.meshWarp.spec.mesh, "high");
      const bytes = await canvasPng(renderer.canvas);
      if (!current()) return;
      postDesignerResult({
        post: input.post,
        source: appliedSource,
        task: { kind: "surface", spec: appliedSpec },
        bytes,
        width: appliedSpec.targetSize?.width ?? first.renderWidth,
        height: appliedSpec.targetSize?.height ?? first.renderHeight,
        duplicate,
      });
    } catch (error) {
      if (!current()) return;
      busy = false;
      phase = "ready";
      shell.setBusy(false);
      renderControls();
      shell.showError(input.formatError(error));
    }
  }

  function restoreHistory(restored: SurfaceDeformationSpecInput): void {
    brushLimitReason = undefined;
    spec = restored;
    renderControls();
    void render();
  }

  async function seedAndRender(): Promise<void> {
    await seedFromPerspectiveIfNeeded();
    if (!active) return;
    void render();
  }

  async function seedFromPerspectiveIfNeeded(): Promise<void> {
    if (!source || nextTask(source)) return;
    if (history?.canUndo() || history?.canRedo() || appliedResultPending) return;
    const live = input.livePerspective?.();
    if (!live) return;
    spec = surfaceSpecFromPerspective(live);
    baseline = structuredClone(spec);
    history = createWorkspaceHistory(spec);
    phase = "ready";
    renderControls();
  }

  return {
    enter() {
      active = true;
      shell.root.hidden = false;
      void seedAndRender();
    },
    loadTemplate(next: SurfaceDeformationSpecInput) {
      if (!source?.sources[0]) return false;
      spec = structuredClone(next);
      spec.targetSize = { width: source.sources[0].renderWidth, height: source.sources[0].renderHeight };
      baseline = structuredClone(spec);
      history = createWorkspaceHistory(spec);
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      brushLimitReason = undefined;
      renderControls();
      if (active) void render();
      return true;
    },
    finishTemplateSave(requestId: number, error?: string) {
      if (!savingTemplate || pendingTemplateRequestId !== requestId) return;
      savingTemplate = false;
      pendingTemplateRequestId = undefined;
      shell.status.textContent = error ? "" : input.copy().templateSaved;
      renderTemplateSave();
      if (error) shell.showError(error);
    },
    leave() { finishBrush(); overlay?.interrupt(); brushHover = undefined; active = false; busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false); renderControls(); shell.root.hidden = true; generation += 1; moveFrames.cancel(); },
    selectionLoading() {
      finishBrush(); overlay?.interrupt();
      refreshing = true; generation += 1; moveFrames.cancel();
      busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
    },
    setSource(next) {
      refreshing = false;
      const retain = canRetainDesignerDraft(source, next) && spec !== undefined;

      finishBrush();
      generation += 1;
      moveFrames.cancel();
      overlay?.interrupt();
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) {
        appliedResultPending = false;
        brushHover = undefined;
      }
      source = next;
      if (retain) {
        renderControls();
        if (active) void render();
        return;
      }
      brushLimitReason = undefined;
      const first = next.sources[0];
      if (!first) return;
      spec = nextTask(next) ?? createSurfaceSpec(first.renderWidth, first.renderHeight);
      baseline = structuredClone(spec);
      history = createWorkspaceHistory(spec);
      phase = "ready";
      undoRouted = false;
      renderControls();
      if (active) void seedAndRender();
    },
    clearSource(error) { refreshing = false; finishBrush(); brushHover = undefined; brushLimitReason = undefined; generation += 1; moveFrames.cancel(); overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; shell.setBusy(false); source = undefined; spec = undefined; history = undefined; shell.showError(error); shell.apply.disabled = true; },
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      role<HTMLElement>(shell.inspector, "patches-label").textContent = copy.patches;
      role<HTMLElement>(shell.inspector, "subdivisions-label").textContent = copy.subdivisions;
      toolHandles.textContent = copy.handles;
      toolPin.textContent = copy.pin;
      toolBrush.textContent = copy.brush;
      role<HTMLElement>(shell.inspector, "radius-label").textContent = copy.radius;
      role<HTMLElement>(shell.inspector, "strength-label").textContent = copy.strength;
      radiusNumber.setAttribute("aria-label", copy.radius);
      strengthNumber.setAttribute("aria-label", copy.strength);
      role<HTMLElement>(shell.inspector, "template-name-label").textContent = copy.templateName;
      templateName.placeholder = copy.templateNamePlaceholder;
      saveTemplate.textContent = copy.saveTemplate;
      renderOverlay();
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      busy = false;
      shell.setBusy(false);
      if (message.type === "apply-designer-error") { phase = "ready"; appliedResultPending = false; shell.showError(input.formatError(message.message)); }
      else { phase = "ready"; appliedResultPending = true; undoRouted = false; shell.status.textContent = input.copy().applied; }
      return true;
    },
    handleKeydown(event) {
      if (event.key === "Escape") { event.preventDefault(); if (brush) finishBrush(true); else input.onBack(); return true; }
      if (brush && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") finishBrush();
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    dispose() { generation += 1; active = false; finishBrush(); latticeObserver?.disconnect();
      window.removeEventListener("pointermove", brushMove);
      window.removeEventListener("pointerup", brushUp);
      window.removeEventListener("pointercancel", brushInterrupted);
      window.removeEventListener("blur", brushBlur);
      document.removeEventListener("visibilitychange", brushHidden);
      renderer.canvas.removeEventListener("lostpointercapture", brushInterrupted); moveFrames.cancel(); overlay?.dispose(); renderer.dispose(); },
  };

  function setTool(next: SurfaceTool): void {
    finishBrush();
    if (next !== tool) {
      brushHover = undefined;
      if (next !== "brush") brushLimitReason = undefined;
    }
    tool = next;
    renderControls();
    renderOverlay();
  }

  function commitEdit(): void {
    if (spec) history?.push(spec);
    phase = "ready"; undoRouted = false; appliedResultPending = false;
  }

  function appendBrush(event: PointerEvent): void {
    if (!brush || !spec || busy || !active) return;
    const uv = pointerSourceUv(event, brush.mesh, brush.coordinates);
    if (!uv || Math.hypot(uv.x - brush.lastUv.x, uv.y - brush.lastUv.y) < 1e-6) return;
    if (Number(strength.value) === 0) { brush.lastUv = uv; return; }
    const next = appendStrokeSample(spec.strokes ?? [], brush.id,
      strokeSample(uv, brush.lastUv, Number(radius.value), Number(strength.value)));
    if (!next) {
      brushLimitReason = strokeAppendLimit(spec.strokes ?? [], brush.id) === "stroke" ? "stroke" : "samples";
      shell.showError(brushCapacityMessage());
      return;
    }
    brush.lastUv = uv;
    spec = { ...spec, strokes: next };
    phase = "ready"; undoRouted = false; appliedResultPending = false;
    moveFrames.request();
  }

  function brushCapacityMessage(): string | undefined {
    if (brushLimitReason === undefined) return undefined;
    const copy = input.copy();
    return brushLimitReason === "stroke" ? copy.strokeSampleLimit : copy.brushLimit;
  }

  function finishBrush(cancel = false): void {
    if (!brush) return;
    const completed = brush; brush = undefined;
    // A finished gesture ends its capacity feedback; the next capped sample
    // re-raises it, so guidance never outlives the stroke it describes.
    if (brushLimitReason !== undefined && shell.error.textContent === brushCapacityMessage()) {
      shell.showError();
    }
    brushLimitReason = undefined;
    if (cancel) {
      spec = completed.origin; appliedResultPending = completed.applied; undoRouted = completed.undoRouted;
      moveFrames.cancel(); void render(false);
    } else if (spec !== completed.origin) {
      commitEdit(); moveFrames.flush();
    }
    if (renderer.canvas.hasPointerCapture(completed.pointerId)) renderer.canvas.releasePointerCapture(completed.pointerId);
  }

  function pointerSourceUv(event: PointerEvent, mesh: WarpMesh, mapping: ReturnType<typeof planeCoordinates>): Point | undefined {
    const box = renderer.canvas.getBoundingClientRect();
    return sourceUvFromWarped(mesh, mapping.unproject({
      x: (event.clientX - box.left) / Math.max(1, box.width),
      y: (event.clientY - box.top) / Math.max(1, box.height),
    }));
  }

  function drawLattice(envelope: BezierEnvelope): void {
    const canvasBox = renderer.canvas.getBoundingClientRect();
    const hostBox = shell.preview.getBoundingClientRect();
    lattice.replaceChildren();
    lattice.setAttribute("width", String(hostBox.width));
    lattice.setAttribute("height", String(hostBox.height));
    const left = canvasBox.left - hostBox.left;
    const top = canvasBox.top - hostBox.top;
    if (tool === "brush") {
      if (!brushHover || !lastMesh || !coordinates) return;
      const mesh = brush?.mesh ?? lastMesh, mapping = brush?.coordinates ?? coordinates;
      let path = "", connected = false;
      for (let sample = 0; sample <= 48; sample += 1) {
        const angle = sample / 48 * Math.PI * 2;
        const warped = warpedFromSource(mesh, {
          x: brushHover.x + Number(radius.value) * Math.cos(angle),
          y: brushHover.y + Number(radius.value) * Math.sin(angle),
        });
        if (!warped) { connected = false; continue; }
        const point = mapping.project(warped);
        path += `${connected ? "L" : "M"}${left + point.x * canvasBox.width},${top + point.y * canvasBox.height} `;
        connected = true;
      }
      for (const [color, width] of [["#0009", 3], ["#fff", 1]] as const) {
        const ring = document.createElementNS("http://www.w3.org/2000/svg", "path");
        ring.setAttribute("d", path); ring.setAttribute("fill", "none");
        ring.setAttribute("stroke", color); ring.setAttribute("stroke-width", String(width));
        lattice.append(ring);
      }
      return;
    }
    const columns = envelope.columns * 3 + 1;
    const rows = envelope.rows * 3 + 1;
    const at = (column: number, row: number) => envelope.points[row * columns + column];
    const add = (from: Point | undefined, to: Point | undefined) => {
      if (!from || !to) return;
      from = coordinates?.project(from) ?? from;
      to = coordinates?.project(to) ?? to;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(left + from.x * canvasBox.width));
      line.setAttribute("y1", String(top + from.y * canvasBox.height));
      line.setAttribute("x2", String(left + to.x * canvasBox.width));
      line.setAttribute("y2", String(top + to.y * canvasBox.height));
      lattice.append(line);
    };
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (column + 1 < columns) add(at(column, row), at(column + 1, row));
        if (row + 1 < rows) add(at(column, row), at(column, row + 1));
      }
    }
  }

  async function saveCurrentTemplate(): Promise<void> {
    const name = normalizeTemplateName(templateName.value);
    if (!spec || !name || savingTemplate) return;
    savingTemplate = true;
    renderTemplateSave();
    shell.status.textContent = input.copy().savingTemplate;
    const requestId = nextTemplateRequestId;
    nextTemplateRequestId += 1;
    pendingTemplateRequestId = requestId;
    input.post({
      type: "save-template",
      workspace: "surface",
      requestId,
      name,
      template: {
        schema: "worldbend.figma-task-template",
        version: "0.1",
        operation: { kind: "surface", spec: structuredClone(spec) },
      },
    });
  }

  function renderTemplateSave(): void {
    templateName.disabled = busy || savingTemplate || !spec;
    saveTemplate.disabled = busy || savingTemplate || !spec || !normalizeTemplateName(templateName.value);
  }
}

export function createSurfaceSpec(
  width: number,
  height: number,
  transform: TransformSpec = normalizedSpec({
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 },
  }),
  columns: number = DEFAULT_SURFACE_PATCHES.columns,
  rows: number = DEFAULT_SURFACE_PATCHES.rows,
  meshSubdivisions: number = DEFAULT_SURFACE_SUBDIVISIONS,
): SurfaceDeformationSpecInput {
  return {
    schema: "worldbend.surface-deformation",
    version: "0.1",
    transform: transformForMesh(transform),
    targetSize: { width, height },
    meshSubdivisions: compatibleSubdivisions(columns, rows, meshSubdivisions),
    envelope: identityEnvelope(columns, rows),
    anchors: [],
    strokes: [],
  };
}

export function surfaceSpecFromPerspective(input: {
  spec: TransformSpec;
  width: number;
  height: number;
}): SurfaceDeformationSpecInput {
  return createSurfaceSpec(input.width, input.height, input.spec);
}

export function identityEnvelope(columns: number, rows: number): BezierEnvelope {
  const controlColumns = columns * 3 + 1;
  const controlRows = rows * 3 + 1;
  const points: Point[] = [];
  for (let row = 0; row < controlRows; row += 1) {
    for (let column = 0; column < controlColumns; column += 1) {
      points.push({
        x: column / (controlColumns - 1),
        y: row / (controlRows - 1),
      });
    }
  }
  return { columns, rows, points: points as BezierEnvelope["points"] };
}

/** Authored 1–2 splits, plus the current lattice when an Agent task used 3×3/4×4. */
export function patchChoicesFor(
  columns: number,
  rows: number,
): readonly { columns: number; rows: number }[] {
  if (PATCH_CHOICES.some((choice) => choice.columns === columns && choice.rows === rows)) {
    return PATCH_CHOICES;
  }
  return [...PATCH_CHOICES, { columns, rows }];
}

export function compatibleSubdivisions(columns: number, rows: number, preferred: number): number {
  const candidates: number[] = [];
  for (let value = 4; value <= 16; value += 1) {
    if (value % columns === 0 && value % rows === 0) candidates.push(value);
  }
  return candidates.reduce((best, value) =>
    Math.abs(value - preferred) < Math.abs(best - preferred) ? value : best, candidates[0] ?? 12);
}

function fillSubdivisionOptions(
  select: HTMLSelectElement,
  columns: number,
  rows: number,
  current: number,
): void {
  const next = compatibleSubdivisions(columns, rows, current);
  select.replaceChildren();
  for (let value = 4; value <= 16; value += 1) {
    if (value % columns !== 0 || value % rows !== 0) continue;
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} × ${value}`;
    select.append(option);
  }
  select.value = String(next);
}

function patchValue(columns: number, rows: number): string {
  return `${columns}x${rows}`;
}

function parsePatchValue(value: string): { columns: number; rows: number } | undefined {
  const match = /^([1-4])x([1-4])$/.exec(value);
  if (!match) return undefined;
  return { columns: Number(match[1]), rows: Number(match[2]) };
}

function nextTask(source: DesignerWorkspaceSource): SurfaceDeformationSpecInput | undefined {
  return source.task?.kind === "surface" ? source.task.spec : undefined;
}

function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing surface workspace role ${name}`);
  return value as T;
}
