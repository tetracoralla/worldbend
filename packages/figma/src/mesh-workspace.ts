import { createDeformationBoundaryControl, type DeformationBoundaryCopy } from "./deformation-boundary-control";
import {nativeVectorStatusMessage} from "./native-vector-status";
import { createFitLandmarkControls, type FitLandmarkCopy } from "./fit-landmark-controls";
import { deformationTask, type FigmaPsdAdoption } from "./stored-designer-task";
import { sameJsonValue } from "./json-value";
import { warpedFromSource } from "./surface-authoring";
import { createDeformationCoordinateCache, type DeformationCoordinates } from "./deformation-coordinates";
import {
  TransformWebGLRenderer,
  buildWarpMesh,
  normalizedSpec,
  type DeformationWorkSpecInput,
  type MeshWarpSpecInput,
  type TransformSpec,
  type WarpMesh,
  type GridWarpMesh,
  requireGridMesh,
} from "@worldbend/web";
import { planDeformationWork } from "./designer-plan";
import {
  deformationWorkFromMesh,
  deformationWorkFromMeshView,
  deformationWorkHasPinEdits,
  meshViewFromDeformationPlan,
} from "./deformation-work-state";
import { scalePreviewSolve } from "./designer-preview";
import { deformationCanvasChange, deformationPublicationPlacement, prepareDeformationRaster, type CaptureDeformationRaster } from "./deformation-raster";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
import { DesignerDraftOriginState } from "./designer-draft-origin";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import { deformationTemplateFromWork, normalizeTemplateName, templateSlotsFromSources } from "./stored-template-library";
import {
  deformationArtworkSource,
  designerDeformationTask,
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  sameDesignerSelection,
  canRetainDesignerDraft,
  withDesignerPublication,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface MeshWorkspaceCopy extends DesignerWorkspaceCopy, DeformationBoundaryCopy, FitLandmarkCopy {
  update: string;
  subdivisions: string;
  densityLocked: string;
  pinDensityGuidance: string;
  pointLabel: string;
  templateName: string;
  templateNamePlaceholder: string;
  saveTemplate: string;
  savingTemplate: string;
  templateSaved: string;
}

export interface LivePerspectiveMesh {
  spec: TransformSpec;
  width: number;
  height: number;
}

export function createMeshWorkspace(input: {
  root: HTMLElement;
  copy(): MeshWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
  captureSourceRaster: CaptureDeformationRaster;
  livePerspective?(): LivePerspectiveMesh | undefined;
}): DesignerTaskWorkspace & {
  loadTemplate(spec: MeshWarpSpecInput): boolean;
  loadDeformationWork(spec: DeformationWorkSpecInput, adoption?: FigmaPsdAdoption): Promise<boolean>;
  loadDeformationTemplate(spec: DeformationWorkSpecInput, current: () => boolean): Promise<boolean>;
  currentDeformationWork(): DeformationWorkSpecInput | undefined;
  currentSource(): DesignerWorkspaceSource | undefined;
  currentPsdAdoption(): FigmaPsdAdoption | undefined;
  acceptPublication(task: Parameters<typeof withDesignerPublication>[1], publication?: Parameters<typeof withDesignerPublication>[2]): void;
  /** True when this draft holds work a plane seed cannot reproduce. */
  deformationDraftAuthored(): boolean;
  finishTemplateSave(requestId: number, error?: string): void;
  showPinDensityGuidance(): void;
} {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="subdivisions-label"></span><select data-role="subdivisions"></select></label><details class="designer-template-disclosure"><summary data-role="template-disclosure-label"></summary><label class="designer-field"><span data-role="template-name-label"></span><input data-role="template-name" type="text" maxlength="80" autocomplete="off"><button data-role="save-template" type="button"></button></label></details>`;
  const subdivisions = role<HTMLSelectElement>(shell.inspector, "subdivisions");
  const templateName = role<HTMLInputElement>(shell.inspector, "template-name");
  const saveTemplate = role<HTMLButtonElement>(shell.inspector, "save-template");
  for (let value = 2; value <= 16; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value} × ${value}`;
    subdivisions.append(option);
  }
  const renderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  shell.preview.append(renderer.canvas);
  let overlay: DirectPointOverlay | undefined;
  let source: DesignerWorkspaceSource | undefined;
  let spec: MeshWarpSpecInput | undefined;
  let baseWork: DeformationWorkSpecInput | undefined;
  /** Adapter provenance carried from an adopted PSD curve when the work
   * switches views before publication. */
  let psdAdoption: FigmaPsdAdoption | undefined;
  /** The plan's `meshEditBaseline`: the replay after Liquify, before mesh
   * edits, so new placements are never measured against stale geometry. */
  let editBaseline: WarpMesh | undefined;
  type MeshDraft = { spec:MeshWarpSpecInput; shapeFit?:DeformationWorkSpecInput["shapeFit"] };
  const draft=():MeshDraft=>({spec:spec!,...(baseWork?.shapeFit ? {shapeFit:baseWork.shapeFit} : {})});
  let baseline: MeshDraft | undefined;
  let pendingPublication: { work: DeformationWorkSpecInput; draft: MeshDraft } | undefined;
  let history: WorkspaceHistory<MeshDraft> | undefined;
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
  let nextTemplateRequestId = 1;
  let pendingTemplateRequestId: number | undefined;
  let savingTemplate = false;
  // Live point moves collapse to one preview request per paint. The overlay
  // never rebuilds on a move: the dragged or nudged point is already
  // positioned by the overlay itself, and a rebuild would destroy the
  // focused button after a single keyboard press.
  const moveFrames = createFrameCoalescer(() => void render(false));
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
    if (!active || !spec) return;
    fitPreviewCanvas(renderer.canvas, shell.preview);
    overlay?.refresh(); fitControls.refresh();
  });
  resizeObserver?.observe(shell.preview);
  let fitPositions:readonly number[]|undefined;
  let fitPoints:readonly {x:number;y:number}[]|undefined;
  const fitControls=createFitLandmarkControls({inspector:shell.inspector,preview:shell.preview,canvas:renderer.canvas,
    copy:input.copy,commit:positions=>void changeFitCorners(positions)});
  async function changeFitCorners(positions:[number,number,number,number]|undefined):Promise<void> {
    if (!spec || !baseWork?.shapeFit || !source || !active || busy || refreshing) return;
    const loaded=source,previous=spec,owner=++generation;
    const work=deformationWorkFromMeshView(spec,baseWork,editBaseline);
    const {cornerPositions:_positions,...fit}=work.shapeFit!;
    work.shapeFit={...fit,...(positions ? {cornerPositions:positions} : {})};
    refreshing=true;renderControls();shell.apply.disabled=true;shell.applyNew.disabled=true;
    try {
      await planDeformationWork(work);
      if(source!==loaded || generation!==owner || spec!==previous || !active) return;
      baseWork={...baseWork,shapeFit:work.shapeFit};
      history?.push(draft());draftOrigin.mark("user");phase="ready";undoRouted=false;appliedResultPending=false;
      refreshing=false;renderControls();void render();
    } catch(error) {
      if(source!==loaded || generation!==owner) return;
      refreshing=false;renderControls();shell.showError(input.formatError(error));
      shell.apply.disabled=false;shell.applyNew.disabled=false;
    }
  }


  const boundaryControl = createDeformationBoundaryControl({inspector:shell.inspector,copy:input.copy,
    change: boundary => void changeBoundary(boundary)});
  async function changeBoundary(boundary: "fixed" | "free"): Promise<void> {
    if (!active || !source || !spec || busy || refreshing) return;
    overlay?.interrupt(); overlay?.dispose(); overlay = undefined; moveFrames.cancel();
    const previous = spec, loaded = source, owner = ++generation;
    const applyDisabled = shell.apply.disabled;
    const {boundary: _boundary, ...mesh} = previous.mesh;
    const next: MeshWarpSpecInput = {...previous,mesh:{...mesh,...(boundary === "free" ? {boundary} : {})}};
    refreshing = true; renderControls(); shell.apply.disabled = true; shell.applyNew.disabled = true;
    try {
      await planDeformationWork(deformationWorkFromMeshView(next, baseWork, editBaseline));
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
    restoreDraft(structuredClone(baseline));
    draftOrigin.mark("user");
    history?.push(draft());
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    renderControls();
    void render();
  });
  subdivisions.addEventListener("change", () => {
    if (!spec) return;
    void adoptMeshDensity(Number(subdivisions.value));
  });
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));
  templateName.addEventListener("input", () => renderTemplateSave());
  saveTemplate.addEventListener("click", () => {
    const name = normalizeTemplateName(templateName.value);
    if (!active || refreshing || busy || !spec || !name || savingTemplate) return;
    let template;
    try { template = deformationTemplateFromWork(deformationWorkFromMeshView(spec, baseWork, editBaseline), "mesh"); }
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
      workspace: "mesh",
      requestId,
      name,
      template,
      ...(savedSlots ? { slots: savedSlots } : {}),
    });
  });

  async function render(refreshOverlay = true): Promise<void> {
    if (!active || busy || refreshing || !source || !spec) return;
    const first = deformationArtworkSource(source);
    if (!first) return;
    const currentGeneration = ++generation;
    try {
      const work = deformationWorkFromMeshView(spec, baseWork, editBaseline);
      const plan = await planDeformationWork(work);
      if (currentGeneration !== generation) return;
      coordinates = await coordinateCache.resolve(plan);
      if (currentGeneration !== generation) return;
      fitPositions=plan.shapeFitView?.fit.cornerPositions;
      fitPoints=fitPositions ? [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(point=>coordinates!.project(point)) : undefined;
      // Preview draws at the shared capped axis; Apply re-plans and renders
      // the full requested resolution below.
      renderer.render(first.image, scalePreviewSolve(plan.meshWarp.solve), plan.meshWarp.spec.mesh, "preview", plan.clip ?? undefined);
      fitPreviewCanvas(renderer.canvas, shell.preview);
      fitControls.update(fitPositions,fitPoints,busy||refreshing);
      shell.showError();
      if (refreshOverlay) renderOverlay();
      else overlay?.refresh();
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
    boundaryControl.update(spec?.mesh.boundary, busy || refreshing || !spec);
    shell.setTargetName(deformationArtworkSource(source)?.sourceName);
    const copy = input.copy();
    fitControls.update(baseWork?.shapeFit ? fitPositions : undefined,baseWork?.shapeFit ? fitPoints : undefined,busy||refreshing);
    shell.setPublicationTarget(source, "deformation");
    const grid = spec && "subdivisions" in spec.mesh ? spec.mesh : undefined;
    subdivisions.value = String(grid?.subdivisions ?? 2);
    const densityLocked = !!spec && !grid || deformationWorkHasPinEdits(baseWork);
    subdivisions.disabled = busy || refreshing || densityLocked;
    subdivisions.title = densityLocked ? input.copy().densityLocked : "";
    templateName.disabled = busy || refreshing || savingTemplate || !spec;
    saveTemplate.disabled = busy || refreshing || savingTemplate || !spec || !normalizeTemplateName(templateName.value);
  }

  function renderTemplateSave(): void {
    renderControls();
  }

  function applyVertexMoves(
    moves: readonly { id: string; point: { x: number; y: number } }[],
    final: boolean,
  ): void {
    if (busy || refreshing || !spec || moves.length === 0) return;
    const grid = requireGridMesh(spec.mesh);
    const relocated = new Map(moves.map((move) => [Number(move.id), move.point]));
    const vertices = grid.vertices.map((candidate, index) => {
      const point = relocated.get(index);
      return point ? { ...candidate, warped: point } : candidate;
    });
    const unchanged = vertices.every((vertex, index) => {
      const previous = spec!.mesh.vertices[index];
      return previous !== undefined &&
        vertex.warped.x === previous.warped.x &&
        vertex.warped.y === previous.warped.y;
    });
    if (unchanged) {
      if (final) { moveFrames.flush(); history?.push(draft()); }
      return;
    }
    spec = { ...spec, mesh: { ...grid, vertices } };
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
    const overlayState = overlay?.state();
    overlay?.dispose();
    if (!spec) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas: renderer.canvas,
      coordinates: {
        project: (point, id) => coordinates?.project(point, id) ?? point,
        unproject: (point, id) => coordinates ? coordinates.unproject(point, id) : point,
      },
      selection: "multiple",
      ...(overlayState ? { initialState: overlayState } : {}),
      bounds: spec.mesh.boundary === "free" ? { min: -2, max: 3 } : { min: 0, max: 1 },
      onMove(id, point, final) {
        applyVertexMoves([{ id, point }], final);
      },
      onMoves(moves, final) {
        applyVertexMoves(moves, final);
      },
    });
    const count = requireGridMesh(spec.mesh).subdivisions;
    const copy = input.copy();
    overlay.set(spec.mesh.vertices.flatMap((vertex, index) => {
      const x = index % (count + 1);
      const y = Math.floor(index / (count + 1));
      if (spec!.mesh.boundary !== "free" && (x === 0 || y === 0 || x === count || y === count)) return [];
      return [{ id: String(index), x: vertex.warped.x, y: vertex.warped.y, label: copy.pointLabel.replace("{x}", String(x)).replace("{y}", String(y)) }];
    }));
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!active || !source || !spec || busy || refreshing) return;

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
      const work = deformationWorkFromMeshView(appliedSpec, baseWork, editBaseline);
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
          task: deformationTask(work, "mesh",
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
        task: deformationTask(work,"mesh",designerDeformationTask(appliedSource)?.shapeGuideSourceIndex,designerDeformationTask(appliedSource)?.shapeGuideDomain,psdAdoption),
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

  function restoreDraft(restored:MeshDraft):void {
    spec=restored.spec;
    if (baseWork) { const {shapeFit:_fit,...rest}=baseWork;baseWork={...rest,...(restored.shapeFit ? {shapeFit:restored.shapeFit} : {})}; }
  }

  function restoreHistory(restored: MeshDraft): void {
    restoreDraft(restored);
    draftOrigin.mark("user");
    renderControls();
    void render();
  }

  async function seedAndRender(): Promise<void> {
    await seedFromPerspectiveIfNeeded();
    if (!active || refreshing) return;
    void render();
    overlay?.refresh();
  }

  async function seedFromPerspectiveIfNeeded(): Promise<void> {
    // A shared-work handoff is planned asynchronously. Entering Mesh during
    // that handoff must not start a Perspective seed that invalidates it.
    if (!source || refreshing || designerDeformationTask(source) || nextTask(source, "mesh")) return;
    if (!draftOrigin.shouldSeedFromPerspective()) return;
    const live = input.livePerspective?.();
    if (!live) return;
    const seededSource = source;
    const seededSpec = spec;
    const seedGeneration = ++generation;
    try {
      const next = await meshSpecFromPerspective(live);
      if (!active || generation !== seedGeneration || source !== seededSource || spec !== seededSpec) return;
      spec = next;
      baseWork = deformationWorkFromMesh(next);
      editBaseline = undefined;
      draftOrigin.mark("perspective");
      baseline = structuredClone(draft());
      history = createWorkspaceHistory(draft());
      phase = "ready";
      renderControls();
    } catch (error) {
      if (!active || generation !== seedGeneration || source !== seededSource || spec !== seededSpec) return;
      shell.showError(input.formatError(error));
    }
  }

  return {
    showPinDensityGuidance() { shell.showError(input.copy().pinDensityGuidance); },
    enter() {
      active = true;
      shell.root.hidden = false;
      void seedAndRender();
    },
    leave() { pendingPublication = undefined; overlay?.interrupt(); active = false; busy = false; refreshing = false; phase = source ? "ready" : "idle"; shell.setBusy(false); renderControls(); shell.root.hidden = true; generation += 1; moveFrames.cancel(); },
    selectionLoading() {
      pendingPublication = undefined;
      overlay?.interrupt();
      refreshing = true; generation += 1; moveFrames.cancel();
      busy = false; phase = source ? "ready" : "idle"; shell.setBusy(false);
      shell.apply.disabled = true; shell.applyNew.disabled = true;
    },
    setSource(next) {
      pendingPublication = undefined;
      refreshing = false;
      const retain = canRetainDesignerDraft(source, next) && spec !== undefined;

      if (!retain) { overlay?.dispose(); overlay = undefined; }

      generation += 1;
      moveFrames.cancel();
      overlay?.interrupt();
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
      if (retain) {
        renderControls();
        if (active) void render();
        return;
      }
      psdAdoption = undefined;
      const first = deformationArtworkSource(next);
      if (!first) return;
      if (designerDeformationTask(next)) {
        void loadWork(designerDeformationTask(next)!.spec, "source", () => true,
          designerDeformationTask(next)!.psdAdoption);
        return;
      }
      const storedTask = nextTask(next, "mesh");
      spec = storedTask ?? createMeshSpec(first.renderWidth, first.renderHeight);
      baseWork = deformationWorkFromMesh(spec);
      editBaseline = undefined;
      draftOrigin.loadSource(storedTask !== undefined);
      baseline = structuredClone(draft());
      history = createWorkspaceHistory(draft());
      phase = "ready";
      undoRouted = false;
      renderControls();
      if (active) void seedAndRender();
    },
    clearSource(error) { pendingPublication = undefined; psdAdoption = undefined; refreshing = false; generation += 1; moveFrames.cancel(); overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; draftOrigin.clear(); shell.setBusy(false); source = undefined; shell.setTargetName(undefined); spec = undefined; baseWork = undefined; editBaseline = undefined; history = undefined; shell.showError(error); shell.apply.disabled = true; },
    loadTemplate(next: MeshWarpSpecInput) {
      const artwork=deformationArtworkSource(source);
      if (!artwork) return false;
      psdAdoption = undefined;
      spec = structuredClone(next);
      spec.targetSize = { width: artwork.renderWidth, height: artwork.renderHeight };
      baseWork = deformationWorkFromMesh(spec);
      editBaseline = undefined;
      draftOrigin.mark("template");
      baseline = structuredClone(draft());
      history = createWorkspaceHistory(draft());
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      renderControls();
      if (active) void render();
      return true;
    },
    async loadDeformationWork(next: DeformationWorkSpecInput, adoption?: FigmaPsdAdoption) {
      return loadWork(next, "user", () => true, adoption);
    },
    async loadDeformationTemplate(next: DeformationWorkSpecInput, current: () => boolean) {
      return loadWork(next, "template", current);
    },
    currentDeformationWork() {
      if (!spec) return undefined;
      return deformationWorkFromMeshView(spec, baseWork, editBaseline);
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
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      role<HTMLElement>(shell.inspector, "subdivisions-label").textContent = copy.subdivisions;
      role<HTMLElement>(shell.inspector, "template-disclosure-label").textContent = copy.saveTemplate;
      role<HTMLElement>(shell.inspector, "template-name-label").textContent = copy.templateName;
      templateName.placeholder = copy.templateNamePlaceholder;
      saveTemplate.textContent = copy.saveTemplate;
      renderControls();
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
          task: deformationTask(structuredClone(pendingPublication.work), "mesh",
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
      // density locks the publication must not lift.
      renderControls();
      return true;
    },
    handleKeydown(event) {
      if (refreshing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); return true; }
      if (event.key === "Escape") { event.preventDefault(); input.onBack(); return true; }
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    dispose() { pendingPublication = undefined; generation += 1; active = false; resizeObserver?.disconnect(); moveFrames.cancel(); overlay?.dispose(); coordinateCache.dispose(); renderer.dispose(); },
  };

  /** A Liquify block is density-independent state, so a density change keeps
   * it live instead of baking its displacement into explicit edits: the new
   * baseline is the pre-edit replay at the new density, re-planned through the
   * canonical planner exactly as a view switch does. */
  async function adoptMeshDensity(next: number): Promise<void> {
    const currentSpec = spec;
    if (!currentSpec || busy || refreshing || deformationWorkHasPinEdits(baseWork)) return;
    const adoptGeneration = ++generation;
    refreshing = true;
    overlay?.interrupt();
    moveFrames.cancel();
    shell.apply.disabled = true;
    shell.applyNew.disabled = true;
    renderControls();
    try {
      const probe = baseWork?.liquify
        ? await planDeformationWork({ ...structuredClone(baseWork), meshSubdivisions: next, meshEdits: [] })
        : undefined;
      if (!active || spec !== currentSpec || generation !== adoptGeneration) return;
      const candidate = { ...currentSpec, mesh: resampleMesh(currentSpec.mesh, next) };
      const candidateBaseline = probe ? structuredClone(probe.meshEditBaseline) : undefined;
      await planDeformationWork(deformationWorkFromMeshView(candidate, baseWork, candidateBaseline));
      if (!active || spec !== currentSpec || generation !== adoptGeneration) return;
      spec = candidate;
      editBaseline = candidateBaseline;
      draftOrigin.mark("user");
      history?.push(draft());
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      refreshing = false;
      renderControls();
      void render();
    } catch (error) {
      if (active && spec === currentSpec && generation === adoptGeneration) {
        refreshing = false;
        shell.showError(input.formatError(error));
        renderControls();
        void render();
      }
    }
  }

  async function loadWork(
    next: DeformationWorkSpecInput,
    origin: "source" | "user" | "template",
    current: () => boolean = () => true,
    adoption?: FigmaPsdAdoption,
  ): Promise<boolean> {
    const loadedSource = source;
    const loadGeneration = ++generation;
    const previousSpec = spec;
    refreshing = true;
    overlay?.interrupt();
    shell.apply.disabled = true;
    shell.applyNew.disabled = true;
    try {
      const plan = await planDeformationWork(next);
      if (!source || source !== loadedSource || generation !== loadGeneration) return false;
      refreshing = false;
      if (!current()) { renderControls(); return false; }
      const nextSpec = meshViewFromDeformationPlan(plan);
      psdAdoption = adoption;
      const retainLocalHistory = origin === "user" && previousSpec !== undefined &&
        sameJsonValue(deformationWorkFromMeshView(previousSpec, baseWork, editBaseline), next);
      baseWork = structuredClone(next);
      editBaseline = structuredClone(plan.meshEditBaseline);
      spec = nextSpec;
      if (!retainLocalHistory) {
        draftOrigin.loadSource(origin === "source");
        if (origin !== "source") draftOrigin.mark(origin);
        baseline = structuredClone(draft());
        history = createWorkspaceHistory(draft());
      }
      phase = "ready";
      undoRouted = false;
      appliedResultPending = false;
      renderControls();
      if (active) void render();
      return true;
    } catch (error) {
      if (source === loadedSource && generation === loadGeneration) {
        refreshing = false;
        renderControls();
        shell.showError(input.formatError(error));
      }
      return false;
    }
  }
}

/** Photoshop-style 4×4 cells / 5×5 interior-capable grid. */
export const DEFAULT_MESH_SUBDIVISIONS = 4;

export function createMeshSpec(
  width: number,
  height: number,
  subdivisions: number = DEFAULT_MESH_SUBDIVISIONS,
  transform: TransformSpec = normalizedSpec({
    tl: { x: 0, y: 0 },
    tr: { x: 1, y: 0 },
    br: { x: 1, y: 1 },
    bl: { x: 0, y: 1 },
  }),
): MeshWarpSpecInput & { mesh: GridWarpMesh } {
  return {
    schema: "worldbend.mesh-warp",
    version: "0.1",
    transform: transformForMesh(transform),
    targetSize: { width, height },
    mesh: identityMesh(subdivisions),
  };
}

/** Mesh warp cannot carry a preset Warp; the custom grid is the deformation. */
export function transformForMesh(spec: TransformSpec): TransformSpec {
  const { warp: _warp, ...content } = spec.content;
  return {
    ...spec,
    destination: structuredClone(spec.destination),
    content,
  };
}

export async function meshSpecFromPerspective(input: {
  spec: TransformSpec;
  width: number;
  height: number;
}): Promise<MeshWarpSpecInput & { mesh: GridWarpMesh }> {
  const warp = input.spec.content.warp;
  const mesh = warp && warp.amount !== 0
    ? await buildWarpMesh(warp)
    : identityMesh(DEFAULT_MESH_SUBDIVISIONS);
  return {
    schema: "worldbend.mesh-warp",
    version: "0.1",
    transform: transformForMesh(input.spec),
    targetSize: { width: input.width, height: input.height },
    mesh,
  };
}

function identityMesh(subdivisions: number): GridWarpMesh {
  const vertices = [];
  for (let y = 0; y <= subdivisions; y += 1) {
    for (let x = 0; x <= subdivisions; x += 1) {
      const point = { x: x / subdivisions, y: y / subdivisions };
      vertices.push({ source: point, warped: { ...point } });
    }
  }
  return { subdivisions, vertices };
}

/**
 * Rebuild an authored mesh at a new regular density. Editable warped
 * positions sample the actual triangular mesh consumed by the renderer so changing
 * 3×3 / 4×4 / 5×5 does not discard the current deformation.
 */
export function resampleMesh(inputMesh: WarpMesh, subdivisions: number): GridWarpMesh {
  const mesh = requireGridMesh(inputMesh);
  const next = Math.max(2, Math.min(16, Math.round(subdivisions)));
  if (next === mesh.subdivisions && mesh.vertices.length === (next + 1) ** 2) {
    return mesh;
  }
  const vertices = [];
  for (let y = 0; y <= next; y += 1) {
    for (let x = 0; x <= next; x += 1) {
      const source = { x: x / next, y: y / next };
      const boundary = x === 0 || y === 0 || x === next || y === next;
      vertices.push({
        source,
        warped: boundary && mesh.boundary !== "free" ? { ...source } : (warpedFromSource(mesh, source) ?? (() => { throw new Error("Mesh source grid is invalid"); })()),
      });
    }
  }
  return { subdivisions: next, vertices, ...(mesh.boundary === "free" ? {boundary: "free"} : {}) };
}

function nextTask(source: DesignerWorkspaceSource, kind: "mesh"): MeshWarpSpecInput | undefined {
  return source.task?.kind === kind ? source.task.spec : undefined;
}
function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing mesh workspace role ${name}`);
  return value as T;
}
