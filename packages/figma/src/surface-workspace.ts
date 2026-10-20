import { createDeformationBoundaryControl, type DeformationBoundaryCopy } from "./deformation-boundary-control";
import {nativeVectorStatusMessage} from "./native-vector-status";
import { deformationTask, type FigmaPsdAdoption } from "./stored-designer-task";
import { sameJsonValue } from "./json-value";
import { requireGridMesh } from "@worldbend/web";
import { resampleEnvelope } from "./surface-envelope";
export { resampleEnvelope } from "./surface-envelope";
import { createDeformationCoordinateCache, type DeformationCoordinates } from "./deformation-coordinates";
import {
  TransformWebGLRenderer,
  observePointerSessionBoundary,
  normalizedSpec,
  type BezierEnvelope,
  type DeformationWorkSpecInput,
  type LiquifyControls,
  type LiquifyMode,
  type Point,
  type SurfaceDeformationSpecInput,
  type TransformSpec,
  type WarpMesh,
} from "@worldbend/web";
import { planDeformationWork } from "./designer-plan";
import {
  deformationWorkFromSurface,
  deformationWorkFromSurfaceView,
  surfaceViewFromDeformationWork,
} from "./deformation-work-state";
import { scalePreviewSolve } from "./designer-preview";
import { deformationCanvasChange, deformationPublicationPlacement, prepareDeformationRaster, type CaptureDeformationRaster } from "./deformation-raster";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
import { DesignerDraftOriginState } from "./designer-draft-origin";
import { transformForMesh } from "./mesh-workspace";
import {
  appendLiquifySample,
  appendStrokeSample,
  anchorsForSubdivisions,
  envelopePointRole,
  liquifyAppendLimit,
  liquifyStrokeCount,
  MAX_SURFACE_ANCHORS,
  nextLiquifyStrokeId,
  nextStrokeId,
  sourceUvFromWarped,
  warpedFromSource,
  strokeAppendLimit,
  strokeSample,
  toggleInteriorAnchor,
} from "./surface-authoring";
import {
  deformationTemplateFromWork,
  normalizeTemplateName,
  templateSlotsFromSources,
} from "./stored-template-library";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import {
  deformationArtworkSource,
  designerDeformationTask,
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  sameDesignerSelection,
  withDesignerPublication,
  canRetainDesignerDraft,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface SurfaceWorkspaceCopy extends DesignerWorkspaceCopy, DeformationBoundaryCopy {
  update: string;
  patches: string;
  subdivisions: string;
  densityLocked: string;
  pointLabel: string;
  handles: string;
  pin: string;
  brush: string;
  liquify: string;
  liquifyPush: string;
  liquifyBloat: string;
  liquifyPucker: string;
  liquifyTwirl: string;
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
  liquifyStrokeLimit: string;
  liquifyLimit: string;
  liquifyStrokeSampleLimit: string;
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
  captureSourceRaster: CaptureDeformationRaster;
  livePerspective?(): LivePerspectiveSurface | undefined;
}): DesignerTaskWorkspace & {
  loadTemplate(spec: SurfaceDeformationSpecInput): boolean;
  loadDeformationWork(spec: DeformationWorkSpecInput, origin?: "user" | "template", psdAdoption?: FigmaPsdAdoption): boolean;
  currentDeformationWork(): DeformationWorkSpecInput | undefined;
  currentSource(): DesignerWorkspaceSource | undefined;
  currentPsdAdoption(): FigmaPsdAdoption | undefined;
  acceptPublication(task: Parameters<typeof withDesignerPublication>[1], publication?: Parameters<typeof withDesignerPublication>[2]): void;
  /** True when this draft holds work a plane seed cannot reproduce. */
  deformationDraftAuthored(): boolean;
  finishTemplateSave(requestId: number, error?: string): void;
} {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="patches-label"></span><select data-role="patches"></select></label><label class="designer-field"><span data-role="subdivisions-label"></span><select data-role="subdivisions"></select></label><div class="designer-tool-row" role="group" data-role="tools"><button data-role="tool-handles" type="button" aria-pressed="true"></button><button data-role="tool-pin" type="button" aria-pressed="false"></button><button data-role="tool-brush" type="button" aria-pressed="false"></button><button data-role="tool-liquify" type="button" aria-pressed="false"></button></div><div class="designer-tool-row" role="group" data-role="liquify-modes" hidden><button data-role="mode-push" type="button" aria-pressed="true"></button><button data-role="mode-bloat" type="button" aria-pressed="false"></button><button data-role="mode-pucker" type="button" aria-pressed="false"></button><button data-role="mode-twirl" type="button" aria-pressed="false"></button></div><label class="designer-field" data-role="radius-field"><span data-role="radius-label"></span><span class="designer-range-pair"><input data-role="radius" class="transform-slider" type="range" min="0.05" max="0.6" step="0.01" value="0.15"><input data-role="radius-number" type="number" min="0.05" max="0.6" step="0.01" value="0.15"></span></label><label class="designer-field" data-role="strength-field"><span data-role="strength-label"></span><span class="designer-range-pair"><input data-role="strength" class="transform-slider" type="range" min="0" max="1" step="0.05" value="0.5"><input data-role="strength-number" type="number" min="0" max="1" step="0.05" value="0.5"></span></label><details class="designer-template-disclosure"><summary data-role="template-disclosure-label"></summary><label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80" autocomplete="off"><button data-role="save-template" type="button"></button></label></details>`;
  const patches = role<HTMLSelectElement>(shell.inspector, "patches");
  const subdivisions = role<HTMLSelectElement>(shell.inspector, "subdivisions");
  const toolHandles = role<HTMLButtonElement>(shell.inspector, "tool-handles");
  const toolPin = role<HTMLButtonElement>(shell.inspector, "tool-pin");
  const toolBrush = role<HTMLButtonElement>(shell.inspector, "tool-brush");
  const toolLiquify = role<HTMLButtonElement>(shell.inspector, "tool-liquify");
  const liquifyModes = role<HTMLElement>(shell.inspector, "liquify-modes");
  const modeButtons = {
    push: role<HTMLButtonElement>(shell.inspector, "mode-push"),
    bloat: role<HTMLButtonElement>(shell.inspector, "mode-bloat"),
    pucker: role<HTMLButtonElement>(shell.inspector, "mode-pucker"),
    twirl: role<HTMLButtonElement>(shell.inspector, "mode-twirl"),
  } as const;
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
  type SurfaceTool = "handles" | "pin" | "brush" | "liquify";
  /** One Pin draft: the surface controls plus the work's Liquify strokes. */
  type PinDraft = { spec: SurfaceDeformationSpecInput; liquify?: LiquifyControls };
  let overlay: DirectPointOverlay | undefined;
  let source: DesignerWorkspaceSource | undefined;
  let spec: SurfaceDeformationSpecInput | undefined;
  let baseWork: DeformationWorkSpecInput | undefined;
  let baseline: PinDraft | undefined;
  let pendingPublication: { work: DeformationWorkSpecInput; draft: PinDraft } | undefined;
  let history: WorkspaceHistory<PinDraft> | undefined;
  /** The work's Liquify strokes; absent until this draft authors one. */
  let liquify: LiquifyControls | undefined;
  let liquifyMode: LiquifyMode = "push";
  /** Adapter provenance of the adopted PSD curve this session edits, when the
   * work entered through curve adoption; rides along every publication. */
  let psdAdoption: FigmaPsdAdoption | undefined;
  let generation = 0;
  const coordinateCache = createDeformationCoordinateCache();
  let coordinates: DeformationCoordinates | undefined;
  let busy = false;
  let refreshing = false;
  let active = false;
  let phase: Phase = "idle";
  let undoRouted = false;
  let appliedResultPending = false;
  const draftOrigin = new DesignerDraftOriginState();
  let tool: SurfaceTool = "handles";
  let lastMesh: WarpMesh | undefined;
  let lastBrushMesh: WarpMesh | undefined;
  let brush: {
    pointerId: number; id: string; target: "surface" | "liquify"; origin: PinDraft;
    lastUv: Point; mesh: WarpMesh; coordinates: DeformationCoordinates;
    applied: boolean; undoRouted: boolean;
  } | undefined;
  let brushLimitReason: "samples" | "stroke" | undefined;
  let detachBrushBoundary = () => {};
  let brushHover: Point | undefined;
  let nextTemplateRequestId = 1;
  let pendingTemplateRequestId: number | undefined;
  let savingTemplate = false;
  const moveFrames = createFrameCoalescer(() => void render(false));

  /** The value-semantic draft state one history entry covers. */
  function draft(): PinDraft {
    return { spec: spec!, ...(liquify ? { liquify } : {}) };
  }

  const latticeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
    if (active && spec) { fitPreviewCanvas(renderer.canvas, shell.preview); overlay?.refresh(); drawLattice(spec.envelope); }
  });
  latticeObserver?.observe(shell.preview);
  latticeObserver?.observe(renderer.canvas);
  const boundaryControl = createDeformationBoundaryControl({inspector:shell.inspector,copy:input.copy,
    change: boundary => void changeBoundary(boundary)});
  async function changeBoundary(boundary: "fixed" | "free"): Promise<void> {
    if (!active || !source || !spec || busy || refreshing) return;
    finishBrush(); overlay?.interrupt(); overlay?.dispose(); overlay = undefined; moveFrames.cancel();
    const previous = spec, loaded = source, owner = ++generation;
    const applyDisabled = shell.apply.disabled;
    const {boundary: _boundary, ...rest} = previous;
    const next: SurfaceDeformationSpecInput = {...rest,...(boundary === "free" ? {boundary} : {})};
    refreshing = true; renderControls(); shell.apply.disabled = true; shell.applyNew.disabled = true;
    try {
      await planDeformationWork(deformationWorkFromSurfaceView(next, baseWork, liquify));
      if (!active || source !== loaded || spec !== previous || generation !== owner) return;
      spec = next;
      draftOrigin.mark("user"); history?.push(draft()); phase = "ready";
      undoRouted = false; appliedResultPending = false;
      refreshing = false; renderControls(); void render();
    } catch (error) {
      if (source !== loaded || spec !== previous || generation !== owner) return;
      refreshing = false; renderControls(); renderOverlay(); shell.showError(input.formatError(error));
      shell.apply.disabled = applyDisabled; shell.applyNew.disabled = applyDisabled;
    }
  }

  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => {
    if (!baseline || busy || refreshing) return;
    finishBrush(); overlay?.interrupt(); brushLimitReason = undefined;
    spec = structuredClone(baseline.spec);
    liquify = baseline.liquify ? structuredClone(baseline.liquify) : undefined;
    draftOrigin.mark("user");
    history?.push(draft());
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    renderControls();
    void render();
  });
  patches.addEventListener("change", () => {
    if (!spec || busy || refreshing || (baseWork?.meshEdits?.length ?? 0) > 0) return;
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
    if (!spec || busy || refreshing || (baseWork?.meshEdits?.length ?? 0) > 0) return;
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
  toolLiquify.addEventListener("click", () => setTool("liquify"));
  for (const mode of Object.keys(modeButtons) as (keyof typeof modeButtons)[]) {
    modeButtons[mode].addEventListener("click", () => {
      if (liquifyMode === mode) return;
      liquifyMode = mode;
      renderControls();
    });
  }
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
    if (event.button !== 0 || !active || busy || refreshing || brush ||
      (tool !== "brush" && tool !== "liquify") || !spec || !lastBrushMesh || !coordinates) return;
    event.preventDefault();
    const uv = pointerSourceUv(event, lastBrushMesh, coordinates);
    if (!uv) return;
    const liquifyGesture = tool === "liquify";
    const id = liquifyGesture
      ? nextLiquifyStrokeId(liquify?.strokes ?? [])
      : nextStrokeId(spec.strokes ?? []);
    if (!id) { shell.showError(liquifyGesture ? input.copy().liquifyStrokeLimit : input.copy().strokeLimit); return; }
    brushLimitReason = undefined;
    brushHover = uv;
    brush = { pointerId: event.pointerId, id, target: liquifyGesture ? "liquify" : "surface",
      origin: draft(), lastUv: uv, mesh: lastBrushMesh, coordinates,
      applied: appliedResultPending, undoRouted };
    drawLattice(spec.envelope);
    try { renderer.canvas.setPointerCapture(event.pointerId); } catch { /* Window events still close the gesture. */ }
    detachBrushBoundary = observePointerSessionBoundary({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      onRelease: released => {
        if (brush?.pointerId !== event.pointerId) return;
        appendBrush(released); finishBrush();
      },
      onInterrupt: () => { finishBrush(); },
    });
  });
  const brushMove = (event: PointerEvent) => {
    if (active && (tool === "brush" || tool === "liquify") && lastBrushMesh && coordinates && !busy
      && (!brush || event.pointerId === brush.pointerId)) {
      brushHover = pointerSourceUv(event, brush?.mesh ?? lastBrushMesh, brush?.coordinates ?? coordinates);
      if (spec) drawLattice(spec.envelope);
    }
    if (!brush || event.pointerId !== brush.pointerId) return;
    if (event.buttons === 0) return;
    appendBrush(event);
  };
  const brushInterrupted = (event?: PointerEvent) => {
    if (!event || brush?.pointerId === event.pointerId) finishBrush();
  };
  window.addEventListener("pointermove", brushMove);
  renderer.canvas.addEventListener("lostpointercapture", brushInterrupted);

  async function render(refreshOverlay = true): Promise<void> {
    if (!active || busy || refreshing || !source || !spec) return;
    const first = deformationArtworkSource(source);
    if (!first) return;
    const currentGeneration = ++generation;
    try {
      const work = deformationWorkFromSurfaceView(spec, baseWork, liquify);
      const plan = await planDeformationWork(work);
      if (currentGeneration !== generation) return;
      coordinates = await coordinateCache.resolve(plan, spec.envelope);
      if (currentGeneration !== generation) return;
      // Pin controls live on the planner's pre-edit mesh. Explicit Mesh-view
      // placements render later but must not move the Pin hit targets or make
      // a view switch bake those placements into the Pin state.
      lastMesh = plan.pinView?.resolvedMesh ?? plan.meshEditBaseline;
      // Painting follows the visible authored interior, including Liquify and
      // Mesh placements. Pin targets retain their separate pre-edit meaning.
      lastBrushMesh = plan.shapeFitView?.interiorMesh ?? plan.authoredView?.mesh ?? plan.meshWarp.spec.mesh;
      renderer.render(
        first.image,
        scalePreviewSolve(plan.meshWarp.solve),
        plan.meshWarp.spec.mesh,
        "preview",
        plan.clip ?? undefined,
      );
      fitPreviewCanvas(renderer.canvas, shell.preview);
      shell.showError(brushCapacityMessage());
      if (refreshOverlay) renderOverlay();
      else { overlay?.refresh(); drawLattice(spec.envelope); }
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
    shell.reset.disabled = busy || refreshing || !baseline;
    boundaryControl.update(spec?.boundary, busy || refreshing || !spec);
    shell.setTargetName(deformationArtworkSource(source)?.sourceName);
    shell.setPublicationTarget(source, "deformation");
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
    const densityLocked = (baseWork?.meshEdits?.length ?? 0) > 0;
    patches.disabled = busy || refreshing || densityLocked;
    subdivisions.disabled = busy || refreshing || densityLocked;
    patches.title = densityLocked ? input.copy().densityLocked : "";
    subdivisions.title = densityLocked ? input.copy().densityLocked : "";
    for (const button of [toolHandles,toolPin,toolBrush,toolLiquify]) button.disabled = busy || refreshing || !spec;
    toolHandles.setAttribute("aria-pressed", String(tool === "handles"));
    toolPin.setAttribute("aria-pressed", String(tool === "pin"));
    toolBrush.setAttribute("aria-pressed", String(tool === "brush"));
    toolLiquify.setAttribute("aria-pressed", String(tool === "liquify"));
    liquifyModes.hidden = tool !== "liquify";
    for (const mode of Object.keys(modeButtons) as (keyof typeof modeButtons)[]) {
      modeButtons[mode].setAttribute("aria-pressed", String(liquifyMode === mode));
    }
    const paints = tool === "brush" || tool === "liquify";
    radiusField.hidden = !paints;
    strengthField.hidden = !paints;
    renderer.canvas.style.touchAction = paints ? "none" : "";
    renderer.canvas.style.cursor = paints ? "crosshair" : "";
    renderTemplateSave();
  }

  function applyControlMoves(
    moves: readonly { id: string; point: { x: number; y: number } }[],
    final: boolean,
  ): void {
    if (busy || refreshing || !spec || moves.length === 0) return;
    const relocated = new Map(moves.map((move) => [Number(move.id), move.point]));
    const points = spec.envelope.points.map((candidate, index) => relocated.get(index) ?? candidate);
    const unchanged = points.every((point, index) => {
      const previous = spec!.envelope.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    });
    if (unchanged) {
      if (final) { moveFrames.flush(); history?.push(draft()); }
      return;
    }
    spec = { ...spec, envelope: { ...spec.envelope, points: points as BezierEnvelope["points"] } };
    draftOrigin.mark("user");
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    moveFrames.request();
    if (final) {
      moveFrames.flush();
      history?.push(draft());
    }
  }

  function renderOverlay(): void {
    overlay?.dispose();
    if (!spec) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas: renderer.canvas,
      coordinates: {
        project: (point, id) => coordinates?.project(point, id) ?? point,
        unproject: (point, id) => coordinates ? coordinates.unproject(point, id) : point,
      },
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
    if (tool === "brush" || tool === "liquify") {
      overlay.set([]);
    } else if (tool === "pin" && lastMesh) {
      const side = requireGridMesh(lastMesh).subdivisions + 1;
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
        if (role === "boundary" && spec!.boundary !== "free") return [];
        const x = index % columns;
        const y = Math.floor(index / columns);
        return [{
          id: String(index),
          x: point.x,
          y: point.y,
          tone: role === "boundary" ? (x % 3 === 0 && y % 3 === 0 ? "curve" : "handle") : role,
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
    pendingPublication = undefined;
    busy = true;
    phase = "applying";
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    shell.showError();
    try {
      const first = deformationArtworkSource(appliedSource);
      if (!first) throw new Error("No source is loaded");
      const work = deformationWorkFromSurfaceView(appliedSpec, baseWork, liquify);
      const plan = await planDeformationWork(work);
      if (!current()) return;
      const placement = await deformationPublicationPlacement(appliedSource, plan, duplicate);
      if (!current()) return;
      if (shell.outputKind.value === "vector") {
        if (!appliedSource.nativeVector) throw Error("Native Vector capture unavailable; preserve this work and use linked HD");
        pendingPublication = { work: structuredClone(work), draft: structuredClone(draft()) };
        postDesignerResult({
          post: input.post,
          source: appliedSource,
          task: deformationTask(work, "pin",
            designerDeformationTask(appliedSource)?.shapeGuideSourceIndex, designerDeformationTask(appliedSource)?.shapeGuideDomain, psdAdoption),
          bytes: new Uint8Array(0),
          width: plan.meshWarp.solve.resolvedDestination.reference.width,
          height: plan.meshWarp.solve.resolvedDestination.reference.height,
          placement,
          duplicate,
          nativeVector: true,
        });
        return;
      }
      const canvasChange = await deformationCanvasChange(appliedSource, plan, duplicate);
      if (!current()) return;
      const raster = await prepareDeformationRaster(appliedSource, plan, input.captureSourceRaster);
      if (!current()) return;
      let bytes: Uint8Array;
      try {
        renderer.render(raster.image, raster.solve, plan.meshWarp.spec.mesh, "high", plan.clip ?? undefined);
        bytes = await canvasPng(renderer.canvas);
      } finally {
        // Export quality and resolution belong to the published PNG. Keep the
        // continued editing preview stable, including an encoder failure.
        // A newer source owns its own canvas after a selection interruption.
        if (current()) {
          renderer.render(first.image, scalePreviewSolve(plan.meshWarp.solve), plan.meshWarp.spec.mesh, "preview", plan.clip ?? undefined);
          fitPreviewCanvas(renderer.canvas, shell.preview);
        }
      }
      if (!current()) return;
      pendingPublication = { work: structuredClone(work), draft: structuredClone(draft()) };
      postDesignerResult({
        post: input.post,
        source: appliedSource,
        task: deformationTask(work, "pin",
          designerDeformationTask(appliedSource)?.shapeGuideSourceIndex, designerDeformationTask(appliedSource)?.shapeGuideDomain, psdAdoption),
        bytes,
        rasterSize: raster.size,
        ...(canvasChange ? { canvasChange } : {}),
        width: plan.meshWarp.solve.resolvedDestination.reference.width,
        height: plan.meshWarp.solve.resolvedDestination.reference.height,
        placement,
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

  function restoreHistory(restored: PinDraft): void {
    brushLimitReason = undefined;
    spec = restored.spec;
    liquify = restored.liquify;
    draftOrigin.mark("user");
    renderControls();
    void render();
  }

  async function seedAndRender(): Promise<void> {
    await seedFromPerspectiveIfNeeded();
    if (!active) return;
    void render();
  }

  async function seedFromPerspectiveIfNeeded(): Promise<void> {
    if (!source || designerDeformationTask(source) || nextTask(source)) return;
    if (!draftOrigin.shouldSeedFromPerspective()) return;
    const live = input.livePerspective?.();
    if (!live) return;
    spec = surfaceSpecFromPerspective(live);
    baseWork = deformationWorkFromSurface(spec);
    liquify = undefined;
    draftOrigin.mark("perspective");
    baseline = structuredClone(draft());
    history = createWorkspaceHistory(draft());
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
      const artwork=deformationArtworkSource(source);
      if (!artwork) return false;
      psdAdoption = undefined;
      spec = structuredClone(next);
      spec.targetSize = { width: artwork.renderWidth, height: artwork.renderHeight };
      baseWork = deformationWorkFromSurface(spec);
      liquify = undefined;
      draftOrigin.mark("template");
      baseline = structuredClone(draft());
      history = createWorkspaceHistory(draft());
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      brushLimitReason = undefined;
      renderControls();
      if (active) void render();
      return true;
    },
    loadDeformationWork(next: DeformationWorkSpecInput, origin = "user", adoption?: FigmaPsdAdoption) {
      if (!deformationArtworkSource(source)) return false;
      try {
        const nextSpec = surfaceViewFromDeformationWork(next);
        const nextLiquify = next.liquify ? structuredClone(next.liquify) : undefined;
        psdAdoption = adoption;
        // An unchanged Pin projection can still carry new Mesh placements,
        // a new fitting recipe or a different density baseline. Old history
        // cannot be replayed over those blocks as if the work were unchanged.
        const retainLocalHistory = origin !== "template" && spec !== undefined &&
          sameJsonValue(deformationWorkFromSurfaceView(spec, baseWork, liquify), next);
        spec = nextSpec;
        baseWork = structuredClone(next);
        liquify = nextLiquify;
        if (!retainLocalHistory) {
          draftOrigin.mark(origin);
          baseline = structuredClone(draft());
          history = createWorkspaceHistory(draft());
        }
        phase = "ready";
        undoRouted = false;
        appliedResultPending = false;
        brushLimitReason = undefined;
        renderControls();
        if (active) void render();
        return true;
      } catch (error) {
        shell.showError(input.formatError(error));
        return false;
      }
    },
    currentDeformationWork() {
      if (!spec) return undefined;
      return deformationWorkFromSurfaceView(spec, baseWork, liquify);
    },
    currentSource() {
      return source;
    },
    currentPsdAdoption() {
      return psdAdoption;
    },
    acceptPublication(task, publication) {
      if (source) source = withDesignerPublication(source, task, publication);
    },
    deformationDraftAuthored() {
      return draftOrigin.current === "user" || draftOrigin.current === "stored-task" ||
        draftOrigin.current === "template";
    },
    finishTemplateSave(requestId: number, error?: string) {
      if (!savingTemplate || pendingTemplateRequestId !== requestId) return;
      savingTemplate = false;
      pendingTemplateRequestId = undefined;
      shell.status.textContent = error ? "" : input.copy().templateSaved;
      renderTemplateSave();
      if (error) shell.showError(error);
    },
    leave() { pendingPublication = undefined; finishBrush(); overlay?.interrupt(); brushHover = undefined; active = false; busy = false; refreshing = false; phase = source ? "ready" : "idle"; shell.setBusy(false); renderControls(); shell.root.hidden = true; generation += 1; moveFrames.cancel(); },
    selectionLoading() {
      pendingPublication = undefined;
      finishBrush(); overlay?.interrupt();
      refreshing = true; generation += 1; moveFrames.cancel();
      busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
    },
    setSource(next) {
      pendingPublication = undefined;
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
      psdAdoption = undefined;
      const first = deformationArtworkSource(next);
      if (!first) return;
      if (designerDeformationTask(next) !== undefined) {
        try {
          psdAdoption = designerDeformationTask(next)!.psdAdoption;
          spec = surfaceViewFromDeformationWork(designerDeformationTask(next)!.spec);
          baseWork = structuredClone(designerDeformationTask(next)!.spec);
          const strokes=designerDeformationTask(next)!.spec.liquify;
          liquify = strokes ? structuredClone(strokes) : undefined;
          draftOrigin.loadSource(true);
          baseline = structuredClone(draft());
          history = createWorkspaceHistory(draft());
          phase = "ready";
          undoRouted = false;
          renderControls();
          if (active) void render();
        } catch (error) {
          spec = undefined;
          baseWork = undefined;
          liquify = undefined;
          shell.showError(input.formatError(error));
          shell.apply.disabled = true;
        }
        return;
      }
      const storedTask = nextTask(next);
      spec = storedTask ?? createSurfaceSpec(first.renderWidth, first.renderHeight);
      baseWork = deformationWorkFromSurface(spec);
      liquify = undefined;
      draftOrigin.loadSource(storedTask !== undefined);
      baseline = structuredClone(draft());
      history = createWorkspaceHistory(draft());
      phase = "ready";
      undoRouted = false;
      renderControls();
      if (active) void seedAndRender();
    },
    clearSource(error) { pendingPublication = undefined; psdAdoption = undefined; refreshing = false; finishBrush(); brushHover = undefined; brushLimitReason = undefined; generation += 1; moveFrames.cancel(); overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; draftOrigin.clear(); shell.setBusy(false); source = undefined; shell.setTargetName(undefined); spec = undefined; baseWork = undefined; liquify = undefined; history = undefined; shell.showError(error); shell.apply.disabled = true; },
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      renderControls();
      role<HTMLElement>(shell.inspector, "patches-label").textContent = copy.patches;
      role<HTMLElement>(shell.inspector, "subdivisions-label").textContent = copy.subdivisions;
      toolHandles.textContent = copy.handles;
      toolPin.textContent = copy.pin;
      toolBrush.textContent = copy.brush;
      toolLiquify.textContent = copy.liquify;
      modeButtons.push.textContent = copy.liquifyPush;
      modeButtons.bloat.textContent = copy.liquifyBloat;
      modeButtons.pucker.textContent = copy.liquifyPucker;
      modeButtons.twirl.textContent = copy.liquifyTwirl;
      role<HTMLElement>(shell.inspector, "radius-label").textContent = copy.radius;
      role<HTMLElement>(shell.inspector, "strength-label").textContent = copy.strength;
      radiusNumber.setAttribute("aria-label", copy.radius);
      strengthNumber.setAttribute("aria-label", copy.strength);
      role<HTMLElement>(shell.inspector, "template-disclosure-label").textContent = copy.saveTemplate;
      role<HTMLElement>(shell.inspector, "template-name-label").textContent = copy.templateName;
      templateName.placeholder = copy.templateNamePlaceholder;
      saveTemplate.textContent = copy.saveTemplate;
      renderOverlay();
    },
    handleMainMessage(message: MainToUiMessage) {
      // A main-thread refusal of the whole request (including validation
      // rejection before any apply started) must release this workspace's busy
      // state too; otherwise a refused Apply leaves the panel stuck on
      // "Applying…" with every control disabled and no error shown.
      if (busy && message.type === "apply-error" && source && message.generation === source.selectionGeneration) {
        busy = false;
        phase = "ready";
        appliedResultPending = false;
        pendingPublication = undefined;
        shell.setBusy(false);
        renderControls();
        shell.showError(input.formatError(message.message));
        return true;
      }
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      if (message.type === "apply-designer-complete" && pendingPublication &&
        message.operation === "replace" && message.targetNodeId === source.targetNodeId) {
        const { deformationDraft: _draft, ...publishedSource } = source;
        source = {
          ...publishedSource,
          ...(message.publication ? {
            targetPlacement: message.publication.placement,
            targetRasterSize: { width: message.publication.renderWidth, height: message.publication.renderHeight },
          } : {}),
          task: deformationTask(structuredClone(pendingPublication.work), "pin",
            designerDeformationTask(source)?.shapeGuideSourceIndex, designerDeformationTask(source)?.shapeGuideDomain, psdAdoption),
        };
        baseline = structuredClone(pendingPublication.draft);
      }
      pendingPublication = undefined;
      busy = false;
      shell.setBusy(false);
      if (message.type === "apply-designer-error") { phase = "ready"; appliedResultPending = false; shell.showError(input.formatError(message.message)); }
      else { phase = "ready"; appliedResultPending = true; undoRouted = false; shell.status.textContent = message.vectorFidelity?input.formatError(nativeVectorStatusMessage(message.vectorFidelity)):input.copy().applied; }
      // setBusy(false) force-enables every control; restore the state-driven
      // locks (density, template save) the publication must not lift.
      renderControls();
      return true;
    },
    handleKeydown(event) {
      if (refreshing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); return true; }
      if (event.key === "Escape") { event.preventDefault(); if (brush) finishBrush(true); else input.onBack(); return true; }
      if (brush && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") finishBrush();
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    dispose() { pendingPublication = undefined; generation += 1; active = false; finishBrush(); latticeObserver?.disconnect();
      window.removeEventListener("pointermove", brushMove);
      renderer.canvas.removeEventListener("lostpointercapture", brushInterrupted); moveFrames.cancel(); overlay?.dispose(); coordinateCache.dispose(); renderer.dispose(); },
  };

  function setTool(next: SurfaceTool): void {
    if (busy || refreshing) return;
    finishBrush();
    if (next !== tool) {
      brushHover = undefined;
      if (next !== "brush" && next !== "liquify") brushLimitReason = undefined;
    }
    tool = next;
    renderControls();
    renderOverlay();
  }

  function commitEdit(): void {
    draftOrigin.mark("user");
    if (spec) history?.push(draft());
    phase = "ready"; undoRouted = false; appliedResultPending = false;
    // Keep template controls in sync with the completed brush draft.
    renderTemplateSave();
  }

  function appendBrush(event: Pick<MouseEvent, "clientX" | "clientY">): void {
    if (!brush || !spec || busy || refreshing || !active) return;
    const uv = pointerSourceUv(event, brush.mesh, brush.coordinates);
    if (!uv || Math.hypot(uv.x - brush.lastUv.x, uv.y - brush.lastUv.y) < 1e-6) return;
    if (Number(strength.value) === 0) { brush.lastUv = uv; return; }
    const sample = strokeSample(uv, brush.lastUv, Number(radius.value), Number(strength.value));
    if (brush.target === "liquify") {
      const strokes = liquify?.strokes ?? [];
      const next = appendLiquifySample(strokes, brush.id, liquifyMode, sample);
      if (!next) {
        brushLimitReason = liquifyAppendLimit(strokes, brush.id) === "stroke" ? "stroke" : "samples";
        shell.showError(brushCapacityMessage());
        return;
      }
      brush.lastUv = uv;
      liquify = { strokes: next };
    } else {
      const next = appendStrokeSample(spec.strokes ?? [], brush.id, sample);
      if (!next) {
        brushLimitReason = strokeAppendLimit(spec.strokes ?? [], brush.id) === "stroke" ? "stroke" : "samples";
        shell.showError(brushCapacityMessage());
        return;
      }
      brush.lastUv = uv;
      spec = { ...spec, strokes: next };
    }
    draftOrigin.mark("user");
    phase = "ready"; undoRouted = false; appliedResultPending = false;
    moveFrames.request();
  }

  function brushCapacityMessage(): string | undefined {
    if (brushLimitReason === undefined) return undefined;
    const copy = input.copy();
    if (tool === "liquify") {
      return brushLimitReason === "stroke" ? copy.liquifyStrokeSampleLimit : copy.liquifyLimit;
    }
    return brushLimitReason === "stroke" ? copy.strokeSampleLimit : copy.brushLimit;
  }

  function finishBrush(cancel = false): void {
    if (!brush) return;
    const completed = brush; brush = undefined;
    detachBrushBoundary();
    // A finished gesture ends its capacity feedback; the next capped sample
    // re-raises it, so guidance never outlives the stroke it describes.
    if (brushLimitReason !== undefined && shell.error.textContent === brushCapacityMessage()) {
      shell.showError();
    }
    brushLimitReason = undefined;
    if (cancel) {
      spec = completed.origin.spec;
      liquify = completed.origin.liquify;
      appliedResultPending = completed.applied; undoRouted = completed.undoRouted;
      moveFrames.cancel(); void render(false);
    } else if (spec !== completed.origin.spec || liquify !== completed.origin.liquify) {
      commitEdit(); moveFrames.flush();
    }
    if (renderer.canvas.hasPointerCapture(completed.pointerId)) renderer.canvas.releasePointerCapture(completed.pointerId);
  }

  function pointerSourceUv(event: Pick<MouseEvent, "clientX" | "clientY">, mesh: WarpMesh, mapping: DeformationCoordinates): Point | undefined {
    const box = renderer.canvas.getBoundingClientRect();
    const point = mapping.unproject({
      x: (event.clientX - box.left) / Math.max(1, box.width),
      y: (event.clientY - box.top) / Math.max(1, box.height),
    });
    return point ? sourceUvFromWarped(mesh, point) : undefined;
  }

  function drawLattice(envelope: BezierEnvelope): void {
    const canvasBox = renderer.canvas.getBoundingClientRect();
    const hostBox = shell.preview.getBoundingClientRect();
    lattice.replaceChildren();
    lattice.setAttribute("width", String(hostBox.width));
    lattice.setAttribute("height", String(hostBox.height));
    const left = canvasBox.left - hostBox.left;
    const top = canvasBox.top - hostBox.top;
    if (tool === "brush" || tool === "liquify") {
      if (!brushHover || !lastBrushMesh || !coordinates) return;
      const mesh = brush?.mesh ?? lastBrushMesh, mapping = brush?.coordinates ?? coordinates;
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
    const add = (from: Point | undefined, to: Point | undefined, fromId: number, toId: number) => {
      if (!from || !to) return;
      from = coordinates?.project(from, String(fromId)) ?? from;
      to = coordinates?.project(to, String(toId)) ?? to;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(left + from.x * canvasBox.width));
      line.setAttribute("y1", String(top + from.y * canvasBox.height));
      line.setAttribute("x2", String(left + to.x * canvasBox.width));
      line.setAttribute("y2", String(top + to.y * canvasBox.height));
      lattice.append(line);
    };
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (column + 1 < columns) add(at(column, row), at(column + 1, row), row * columns + column, row * columns + column + 1);
        if (row + 1 < rows) add(at(column, row), at(column, row + 1), row * columns + column, (row + 1) * columns + column);
      }
    }
  }

  async function saveCurrentTemplate(): Promise<void> {
    const name = normalizeTemplateName(templateName.value);
    if (!active || refreshing || busy || !spec || !name || savingTemplate) return;
    finishBrush();
    let template;
    try { template = deformationTemplateFromWork(deformationWorkFromSurfaceView(spec, baseWork, liquify), "pin"); }
    catch (error) { shell.showError(input.formatError(error)); return; }
    savingTemplate = true;
    renderTemplateSave();
    shell.status.textContent = input.copy().savingTemplate;
    const requestId = nextTemplateRequestId;
    nextTemplateRequestId += 1;
    pendingTemplateRequestId = requestId;
    const savedSlots = templateSlotsFromSources(deformationArtworkSource(source) ? [deformationArtworkSource(source)!] : []);
    input.post({
      type: "save-template",
      workspace: "surface",
      requestId,
      name,
      template,
      ...(savedSlots ? { slots: savedSlots } : {}),
    });
  }

  function renderTemplateSave(): void {
    templateName.disabled = busy || refreshing || savingTemplate || !spec;
    saveTemplate.disabled = busy || refreshing || savingTemplate || !spec || !normalizeTemplateName(templateName.value);
    saveTemplate.title = "";
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
