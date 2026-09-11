import {
  TransformWebGLRenderer,
  normalizedSpec,
  type BezierEnvelope,
  type Point,
  type SurfaceDeformationSpecInput,
  type TransformSpec,
} from "@worldbend/web";
import { planSurfaceDeformation } from "./designer-plan";
import { scalePreviewSolve } from "./designer-preview";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
import { transformForMesh } from "./mesh-workspace";
import { createWorkspaceHistory, type WorkspaceHistory } from "./workspace-history";
import { handleWorkspaceHistoryShortcut } from "./workspace-shortcuts";
import {
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  sameDesignerSelection,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface SurfaceWorkspaceCopy extends DesignerWorkspaceCopy {
  patches: string;
  subdivisions: string;
  pointLabel: string;
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
}): DesignerTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="patches-label"></span><select data-role="patches"></select></label><label class="designer-field"><span data-role="subdivisions-label"></span><select data-role="subdivisions"></select></label>`;
  const patches = role<HTMLSelectElement>(shell.inspector, "patches");
  const subdivisions = role<HTMLSelectElement>(shell.inspector, "subdivisions");
  for (const choice of PATCH_CHOICES) {
    const option = document.createElement("option");
    option.value = patchValue(choice.columns, choice.rows);
    option.textContent = `${choice.columns} × ${choice.rows}`;
    patches.append(option);
  }
  const renderer = new TransformWebGLRenderer(document.createElement("canvas"), { preserveDrawingBuffer: true });
  shell.preview.append(renderer.canvas);
  let overlay: DirectPointOverlay | undefined;
  let source: DesignerWorkspaceSource | undefined;
  let spec: SurfaceDeformationSpecInput | undefined;
  let baseline: SurfaceDeformationSpecInput | undefined;
  let history: WorkspaceHistory<SurfaceDeformationSpecInput> | undefined;
  let generation = 0;
  let busy = false;
  let active = false;
  let phase: Phase = "idle";
  let undoRouted = false;
  let appliedResultPending = false;
  const moveFrames = createFrameCoalescer(() => void render(false));

  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => {
    if (!baseline) return;
    spec = structuredClone(baseline);
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    renderControls();
    void render();
  });
  patches.addEventListener("change", () => {
    if (!spec) return;
    const next = parsePatchValue(patches.value) ?? DEFAULT_SURFACE_PATCHES;
    const meshSubdivisions = compatibleSubdivisions(next.columns, next.rows, spec.meshSubdivisions ?? DEFAULT_SURFACE_SUBDIVISIONS);
    spec = {
      ...spec,
      meshSubdivisions,
      envelope: resampleEnvelope(spec.envelope, next.columns, next.rows),
    };
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    renderControls();
    void render();
  });
  subdivisions.addEventListener("change", () => {
    if (!spec) return;
    spec = { ...spec, meshSubdivisions: Number(subdivisions.value) };
    history?.push(spec);
    phase = "ready";
    undoRouted = false;
    appliedResultPending = false;
    void render();
  });
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));

  async function render(refreshOverlay = true): Promise<void> {
    if (!source || !spec) return;
    const first = source.sources[0];
    if (!first) return;
    const currentGeneration = ++generation;
    try {
      const plan = await planSurfaceDeformation(spec);
      if (currentGeneration !== generation) return;
      renderer.render(
        first.image,
        scalePreviewSolve(plan.meshWarp.solve),
        plan.meshWarp.spec.mesh,
        "preview",
      );
      fitPreviewCanvas(renderer.canvas, shell.preview);
      shell.showError();
      if (refreshOverlay) renderOverlay();
      shell.apply.disabled = false;
    } catch (error) {
      if (currentGeneration !== generation) return;
      shell.showError(input.formatError(error));
      shell.apply.disabled = true;
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
    shell.applyNew.hidden = !source?.targetNodeId;
  }

  function applyControlMoves(
    moves: readonly { id: string; point: { x: number; y: number } }[],
    final: boolean,
  ): void {
    if (!spec || moves.length === 0) return;
    const relocated = new Map(moves.map((move) => [Number(move.id), move.point]));
    const points = spec.envelope.points.map((candidate, index) => relocated.get(index) ?? candidate);
    const unchanged = points.every((point, index) => {
      const previous = spec!.envelope.points[index];
      return previous !== undefined && point.x === previous.x && point.y === previous.y;
    });
    if (unchanged) return;
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
      selection: "multiple",
      bounds: { min: CONTROL_MIN, max: CONTROL_MAX },
      onMove(id, point, final) {
        applyControlMoves([{ id, point }], final);
      },
      onMoves(moves, final) {
        applyControlMoves(moves, final);
      },
    });
    const envelope = spec.envelope;
    const columns = envelope.columns * 3 + 1;
    const rows = envelope.rows * 3 + 1;
    const copy = input.copy();
    overlay.set(envelope.points.flatMap((point, index) => {
      const x = index % columns;
      const y = Math.floor(index / columns);
      if (x === 0 || y === 0 || x + 1 === columns || y + 1 === rows) return [];
      return [{
        id: String(index),
        x: point.x,
        y: point.y,
        label: copy.pointLabel.replace("{x}", String(x)).replace("{y}", String(y)),
      }];
    }));
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!source || !spec || busy) return;
    busy = true;
    phase = "applying";
    moveFrames.cancel();
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      const first = source.sources[0];
      if (!first) throw new Error("No source is loaded");
      const plan = await planSurfaceDeformation(spec);
      renderer.render(first.image, plan.meshWarp.solve, plan.meshWarp.spec.mesh, "high");
      postDesignerResult({
        post: input.post,
        source,
        task: { kind: "surface", spec },
        bytes: await canvasPng(renderer.canvas),
        width: spec.targetSize?.width ?? first.renderWidth,
        height: spec.targetSize?.height ?? first.renderHeight,
        duplicate,
      });
    } catch (error) {
      busy = false;
      phase = "ready";
      shell.setBusy(false);
      shell.showError(input.formatError(error));
    }
  }

  function restoreHistory(restored: SurfaceDeformationSpecInput): void {
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
    if (history?.canUndo() || appliedResultPending) return;
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
    leave() { overlay?.interrupt(); active = false; shell.root.hidden = true; generation += 1; moveFrames.cancel(); },
    setSource(next) {
      busy = false;
      shell.setBusy(false);
      if (!sameDesignerSelection(source, next)) appliedResultPending = false;
      source = next;
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
    clearSource(error) { overlay?.interrupt(); busy = false; phase = "idle"; appliedResultPending = false; shell.setBusy(false); source = undefined; spec = undefined; history = undefined; shell.showError(error); shell.apply.disabled = true; },
    updateLocale() {
      const copy = input.copy();
      shell.setCopy(copy);
      role<HTMLElement>(shell.inspector, "patches-label").textContent = copy.patches;
      role<HTMLElement>(shell.inspector, "subdivisions-label").textContent = copy.subdivisions;
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
      if (event.key === "Escape") { event.preventDefault(); input.onBack(); return true; }
      const result = handleWorkspaceHistoryShortcut({ event, phase, appliedResultPending, undoRouted, history, post: input.post, restore: restoreHistory });
      undoRouted = result.undoRouted;
      return result.handled;
    },
    dispose() { moveFrames.cancel(); overlay?.dispose(); renderer.dispose(); },
  };
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

/**
 * Rebuild a fixed-boundary Bezier lattice at a new patch density. Interior
 * controls are bilinear samples of the previous lattice so 1×1 → 2×2 does
 * not discard the current deformation.
 */
export function resampleEnvelope(envelope: BezierEnvelope, columns: number, rows: number): BezierEnvelope {
  if (envelope.columns === columns && envelope.rows === rows) return envelope;
  const previousColumns = envelope.columns * 3 + 1;
  const previousRows = envelope.rows * 3 + 1;
  const next = identityEnvelope(columns, rows);
  const nextColumns = columns * 3 + 1;
  const nextRows = rows * 3 + 1;
  const points = next.points.map((identity, index) => {
    const column = index % nextColumns;
    const row = Math.floor(index / nextColumns);
    if (column === 0 || row === 0 || column + 1 === nextColumns || row + 1 === nextRows) return identity;
    return clampControl(sampleEnvelope(
      envelope,
      previousColumns,
      previousRows,
      column / (nextColumns - 1),
      row / (nextRows - 1),
    ));
  });
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

function sampleEnvelope(
  envelope: BezierEnvelope,
  columns: number,
  rows: number,
  u: number,
  v: number,
): Point {
  const x = u * (columns - 1);
  const y = v * (rows - 1);
  const x0 = Math.min(columns - 2, Math.max(0, Math.floor(x)));
  const y0 = Math.min(rows - 2, Math.max(0, Math.floor(y)));
  const tx = x - x0;
  const ty = y - y0;
  const at = (column: number, row: number) =>
    envelope.points[row * columns + column] ?? { x: column / (columns - 1), y: row / (rows - 1) };
  return lerpPoint(
    lerpPoint(at(x0, y0), at(x0 + 1, y0), tx),
    lerpPoint(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx),
    ty,
  );
}

function lerpPoint(start: Point, end: Point, amount: number): Point {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function clampControl(point: Point): Point {
  return {
    x: Math.max(CONTROL_MIN, Math.min(CONTROL_MAX, point.x)),
    y: Math.max(CONTROL_MIN, Math.min(CONTROL_MAX, point.y)),
  };
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
