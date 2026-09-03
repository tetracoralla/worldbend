import {
  TransformWebGLRenderer,
  normalizedSpec,
  type MeshWarpSpecInput,
  type WarpMesh,
} from "@worldbend/web";
import { planMeshWarp } from "./designer-plan";
import { scalePreviewSolve } from "./designer-preview";
import { createDirectPointOverlay, type DirectPointOverlay } from "./direct-point-overlay";
import { createFrameCoalescer } from "./frame-coalescer";
import {
  canvasPng,
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface MeshWorkspaceCopy extends DesignerWorkspaceCopy {
  subdivisions: string;
  pointLabel: string;
}

export function createMeshWorkspace(input: {
  root: HTMLElement;
  copy(): MeshWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
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
  let generation = 0;
  let busy = false;
  let active = false;
  // Live point moves collapse to one preview request per paint. The overlay
  // never rebuilds on a move: the dragged or nudged point is already
  // positioned by the overlay itself, and a rebuild would destroy the
  // focused button after a single keyboard press.
  const moveFrames = createFrameCoalescer(() => void render(false));

  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => {
    if (!baseline) return;
    spec = structuredClone(baseline);
    renderControls();
    void render();
  });
  subdivisions.addEventListener("change", () => {
    if (!spec) return;
    spec = { ...spec, mesh: identityMesh(Number(subdivisions.value)) };
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

  function renderOverlay(): void {
    overlay?.dispose();
    if (!spec) return;
    overlay = createDirectPointOverlay({
      host: shell.preview,
      canvas: renderer.canvas,
      onMove(id, point, final) {
        if (!spec) return;
        const index = Number(id);
        const vertex = spec.mesh.vertices[index];
        if (!vertex) return;
        const vertices = spec.mesh.vertices.map((candidate, candidateIndex) =>
          candidateIndex === index ? { ...candidate, warped: point } : candidate,
        );
        spec = { ...spec, mesh: { ...spec.mesh, vertices } };
        moveFrames.request();
        if (final) moveFrames.flush();
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
      shell.setBusy(false);
      shell.showError(input.formatError(error));
    }
  }

  return {
    enter() { active = true; shell.root.hidden = false; void render(); overlay?.refresh(); queueMicrotask(() => shell.back.focus()); },
    leave() { active = false; shell.root.hidden = true; generation += 1; moveFrames.cancel(); },
    setSource(next) {
      busy = false;
      shell.setBusy(false);
      source = next;
      const first = next.sources[0];
      if (!first) return;
      spec = nextTask(next, "mesh") ?? createMeshSpec(first.renderWidth, first.renderHeight, 2);
      baseline = structuredClone(spec);
      renderControls();
      if (active) void render();
    },
    clearSource(error) { busy = false; shell.setBusy(false); source = undefined; spec = undefined; shell.showError(error); shell.apply.disabled = true; },
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
      if (message.type === "apply-designer-error") shell.showError(input.formatError(message.message));
      else shell.status.textContent = input.copy().applied;
      return true;
    },
    handleKeydown(event) { if (event.key !== "Escape") return false; input.onBack(); return true; },
    dispose() { moveFrames.cancel(); overlay?.dispose(); renderer.dispose(); },
  };
}

export function createMeshSpec(width: number, height: number, subdivisions: number): MeshWarpSpecInput {
  return {
    schema: "worldbend.mesh-warp",
    version: "0.1",
    transform: normalizedSpec({ tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } }),
    targetSize: { width, height },
    mesh: identityMesh(subdivisions),
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

function nextTask(source: DesignerWorkspaceSource, kind: "mesh"): MeshWarpSpecInput | undefined {
  return source.task?.kind === kind ? source.task.spec : undefined;
}
function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing mesh workspace role ${name}`);
  return value as T;
}
