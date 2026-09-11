import {
  TransformWebGLRenderer,
  buildWarpMesh,
  normalizedSpec,
  type MeshWarpSpecInput,
  type TransformSpec,
  type WarpMesh,
} from "@worldbend/web";
import { planMeshWarp } from "./designer-plan";
import { scalePreviewSolve } from "./designer-preview";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import type { Phase } from "./editor-state";
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

export interface MeshWorkspaceCopy extends DesignerWorkspaceCopy {
  subdivisions: string;
  pointLabel: string;
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
  livePerspective?(): LivePerspectiveMesh | undefined;
}): DesignerTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="subdivisions-label"></span><select data-role="subdivisions"></select></label>`;
  const subdivisions = role<HTMLSelectElement>(shell.inspector, "subdivisions");
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
  let baseline: MeshWarpSpecInput | undefined;
  let history: WorkspaceHistory<MeshWarpSpecInput> | undefined;
  let generation = 0;
  let busy = false;
  let active = false;
  let phase: Phase = "idle";
  let undoRouted = false;
  let appliedResultPending = false;
  // Live point moves collapse to one preview request per paint. The overlay
  // never rebuilds on a move: the dragged or nudged point is already
  // positioned by the overlay itself, and a rebuild would destroy the
  // focused button after a single keyboard press.
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
  subdivisions.addEventListener("change", () => {
    if (!spec) return;
    spec = { ...spec, mesh: resampleMesh(spec.mesh, Number(subdivisions.value)) };
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
      const plan = await planMeshWarp(spec);
      if (currentGeneration !== generation) return;
      // Preview draws at the shared capped axis; Apply re-plans and renders
      // the full requested resolution below.
      renderer.render(first.image, scalePreviewSolve(plan.solve), spec.mesh, "preview");
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
    subdivisions.value = String(spec?.mesh.subdivisions ?? 2);
    shell.applyNew.hidden = !source?.targetNodeId;
  }

  function applyVertexMoves(
    moves: readonly { id: string; point: { x: number; y: number } }[],
    final: boolean,
  ): void {
    if (!spec || moves.length === 0) return;
    const relocated = new Map(moves.map((move) => [Number(move.id), move.point]));
    const vertices = spec.mesh.vertices.map((candidate, index) => {
      const point = relocated.get(index);
      return point ? { ...candidate, warped: point } : candidate;
    });
    const unchanged = vertices.every((vertex, index) => {
      const previous = spec!.mesh.vertices[index];
      return previous !== undefined &&
        vertex.warped.x === previous.warped.x &&
        vertex.warped.y === previous.warped.y;
    });
    if (unchanged) return;
    spec = { ...spec, mesh: { ...spec.mesh, vertices } };
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
      onMove(id, point, final) {
        applyVertexMoves([{ id, point }], final);
      },
      onMoves(moves, final) {
        applyVertexMoves(moves, final);
      },
    });
    const count = spec.mesh.subdivisions;
    const copy = input.copy();
    overlay.set(spec.mesh.vertices.flatMap((vertex, index) => {
      const x = index % (count + 1);
      const y = Math.floor(index / (count + 1));
      if (x === 0 || y === 0 || x === count || y === count) return [];
      return [{ id: String(index), x: vertex.warped.x, y: vertex.warped.y, label: copy.pointLabel.replace("{x}", String(x)).replace("{y}", String(y)) }];
    }));
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!source || !spec || busy) return;
    busy = true;
    phase = "applying";
    // A queued preview frame must not redraw capped pixels over the full
    // resolution output between render and encode.
    moveFrames.cancel();
    shell.setBusy(true);
    shell.status.textContent = input.copy().applying;
    try {
      const first = source.sources[0];
      if (!first) throw new Error("No source is loaded");
      const plan = await planMeshWarp(spec);
      renderer.render(first.image, plan.solve, spec.mesh, "high");
      postDesignerResult({
        post: input.post,
        source,
        task: { kind: "mesh", spec },
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

  function restoreHistory(restored: MeshWarpSpecInput): void {
    spec = restored;
    renderControls();
    void render();
  }

  async function seedAndRender(): Promise<void> {
    await seedFromPerspectiveIfNeeded();
    if (!active) return;
    void render();
    overlay?.refresh();
  }

  async function seedFromPerspectiveIfNeeded(): Promise<void> {
    if (!source || nextTask(source, "mesh")) return;
    if (history?.canUndo() || appliedResultPending) return;
    const live = input.livePerspective?.();
    if (!live) return;
    try {
      spec = await meshSpecFromPerspective(live);
      baseline = structuredClone(spec);
      history = createWorkspaceHistory(spec);
      phase = "ready";
      renderControls();
    } catch (error) {
      shell.showError(input.formatError(error));
    }
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
      spec = nextTask(next, "mesh") ?? createMeshSpec(first.renderWidth, first.renderHeight);
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
): MeshWarpSpecInput {
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
}): Promise<MeshWarpSpecInput> {
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

function identityMesh(subdivisions: number): WarpMesh {
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
 * Rebuild a fixed-boundary mesh at a new regular density. Interior warped
 * positions are bilinear samples of the previous source grid so changing
 * 3×3 / 4×4 / 5×5 does not discard the current deformation.
 */
export function resampleMesh(mesh: WarpMesh, subdivisions: number): WarpMesh {
  const next = Math.max(2, Math.min(16, Math.round(subdivisions)));
  if (next === mesh.subdivisions && mesh.vertices.length === (next + 1) ** 2) {
    return mesh;
  }
  const previous = Math.max(1, mesh.subdivisions);
  const previousSide = previous + 1;
  const vertices = [];
  for (let y = 0; y <= next; y += 1) {
    for (let x = 0; x <= next; x += 1) {
      const source = { x: x / next, y: y / next };
      const boundary = x === 0 || y === 0 || x === next || y === next;
      vertices.push({
        source,
        warped: boundary ? { ...source } : sampleWarped(mesh, previous, previousSide, source),
      });
    }
  }
  return { subdivisions: next, vertices };
}

function sampleWarped(
  mesh: WarpMesh,
  subdivisions: number,
  side: number,
  point: { x: number; y: number },
): { x: number; y: number } {
  const x = point.x * subdivisions;
  const y = point.y * subdivisions;
  const x0 = Math.min(subdivisions - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(subdivisions - 1, Math.max(0, Math.floor(y)));
  const tx = x - x0;
  const ty = y - y0;
  const at = (column: number, row: number) =>
    mesh.vertices[row * side + column]?.warped ?? { x: column / subdivisions, y: row / subdivisions };
  return lerpPoint(
    lerpPoint(at(x0, y0), at(x0 + 1, y0), tx),
    lerpPoint(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx),
    ty,
  );
}

function lerpPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  amount: number,
): { x: number; y: number } {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function nextTask(source: DesignerWorkspaceSource, kind: "mesh"): MeshWarpSpecInput | undefined {
  return source.task?.kind === kind ? source.task.spec : undefined;
}
function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing mesh workspace role ${name}`);
  return value as T;
}
