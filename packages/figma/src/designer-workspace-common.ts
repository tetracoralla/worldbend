import type { SourceRasterPayload, UiToMainMessage } from "./messages";
import type { StoredDesignerTask } from "./stored-designer-task";

export type LoadedDesignerSource = Omit<SourceRasterPayload, "bytes"> & {
  image: HTMLImageElement;
};

export interface DesignerWorkspaceSource {
  sources: LoadedDesignerSource[];
  selectionGeneration: number;
  task?: StoredDesignerTask;
  targetPlacement?: SourceRasterPayload["placement"];
  targetNodeId?: string;
}

export function sameDesignerSelection(
  previous: DesignerWorkspaceSource | undefined,
  next: DesignerWorkspaceSource,
): boolean {
  return previous !== undefined && previous.targetNodeId === next.targetNodeId &&
    previous.sources.length === next.sources.length &&
    previous.sources.every((source, index) => source.sourceNodeId === next.sources[index]?.sourceNodeId);
}

export interface DesignerTaskWorkspace {
  enter(): void;
  leave(): void;
  setSource(source: DesignerWorkspaceSource): void;
  clearSource(error?: string): void;
  updateLocale(): void;
  handleMainMessage(message: { type: string; generation?: number; message?: unknown }): boolean;
  handleKeydown(event: KeyboardEvent): boolean;
  dispose(): void;
}

export interface DesignerWorkspaceCopy {
  back: string;
  title: string;
  reset: string;
  apply: string;
  applyNew: string;
  applying: string;
  applied: string;
}

export interface DesignerWorkspaceShell {
  root: HTMLElement;
  back: HTMLButtonElement;
  title: HTMLElement;
  preview: HTMLDivElement;
  inspector: HTMLElement;
  reset: HTMLButtonElement;
  applyNew: HTMLButtonElement;
  apply: HTMLButtonElement;
  error: HTMLParagraphElement;
  status: HTMLParagraphElement;
  setCopy(copy: DesignerWorkspaceCopy): void;
  setBusy(busy: boolean): void;
  showError(message?: string): void;
}

export function createDesignerWorkspaceShell(root: HTMLElement): DesignerWorkspaceShell {
  root.classList.add("designer-workspace");
  root.innerHTML = `<header class="designer-header"><button class="designer-back" data-role="back" type="button"><span class="ui-icon" data-icon-id="icon-park:right-small" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 24.0083H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 12L36 24L24 36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button><h1 data-role="title"></h1></header>
    <div class="designer-body"><div class="designer-preview" data-role="preview"></div><aside class="designer-inspector" data-role="inspector"></aside></div>
    <footer class="designer-footer"><button data-role="reset" type="button"></button><span><button data-role="apply-new" type="button" hidden></button> <button data-role="apply" class="primary" type="button"></button></span></footer>
    <p class="designer-error" data-role="error" role="alert" hidden></p><p class="sr-only" data-role="status" role="status" aria-live="polite"></p>`;
  const shell: DesignerWorkspaceShell = {
    root,
    back: role(root, "back"),
    title: role(root, "title"),
    preview: role(root, "preview"),
    inspector: role(root, "inspector"),
    reset: role(root, "reset"),
    applyNew: role(root, "apply-new"),
    apply: role(root, "apply"),
    error: role(root, "error"),
    status: role(root, "status"),
    setCopy(copy) {
      shell.back.setAttribute("aria-label", copy.back);
      shell.back.title = copy.back;
      shell.title.textContent = copy.title;
      shell.reset.textContent = copy.reset;
      shell.apply.textContent = copy.apply;
      shell.applyNew.textContent = copy.applyNew;
    },
    setBusy(busy) {
      for (const element of shell.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
        element.disabled = busy;
      }
    },
    showError(message) {
      shell.error.textContent = message ?? "";
      shell.error.hidden = !message;
    },
  };
  return shell;
}

export function postDesignerResult(input: {
  post(message: UiToMainMessage): void;
  source: DesignerWorkspaceSource;
  task: Extract<UiToMainMessage, { type: "apply-designer" }>[
    "payload"
  ]["task"];
  bytes: Uint8Array;
  width: number;
  height: number;
  duplicate?: boolean;
}): void {
  const first = input.source.sources[0];
  if (!first) throw new Error("No source is loaded");
  input.post({
    type: "apply-designer",
    payload: {
      generation: input.source.selectionGeneration,
      task: input.task,
      sourceNodeIds: input.source.sources.map((source) => source.sourceNodeId),
      bytes: input.bytes,
      renderWidth: input.width,
      renderHeight: input.height,
      placement: !input.duplicate && input.source.targetPlacement
        ? { ...input.source.targetPlacement }
        : outputDocumentBox(input.source.sources, input.width, input.height),
      ...(input.source.targetNodeId ? { targetNodeId: input.source.targetNodeId } : {}),
      ...(input.duplicate ? { duplicate: true } : {}),
    },
  });
}

/**
 * Document-space output size for a new designer result. x/y is a canonical
 * placeholder on purpose: publication placement is decided in main beside
 * the live inputs with page-wide obstacles, so only width/height here are
 * authoritative.
 */
export function outputDocumentBox(
  sources: readonly LoadedDesignerSource[],
  width: number,
  height: number,
): SourceRasterPayload["placement"] {
  const first = sources[0];
  if (!first) return { x: 0, y: 0, width, height };
  const documentScaleX = first.placement.width / first.renderWidth;
  const documentScaleY = first.placement.height / first.renderHeight;
  return {
    x: 0,
    y: 0,
    width: width * documentScaleX,
    height: height * documentScaleY,
  };
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Unable to encode output")), "image/png");
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export function fitPreviewCanvas(canvas: HTMLCanvasElement, host: HTMLElement): void {
  const availableWidth = Math.max(1, host.clientWidth - 40);
  const availableHeight = Math.max(1, host.clientHeight - 40);
  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
  canvas.style.width = `${Math.max(1, Math.round(canvas.width * scale))}px`;
  canvas.style.height = `${Math.max(1, Math.round(canvas.height * scale))}px`;
}

export function numericInput(value: number, minimum: number, maximum: number, step = "1"): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = step;
  input.inputMode = "decimal";
  return input;
}

function role<T extends HTMLElement>(root: HTMLElement, name: string): T {
  const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`);
  if (!value) throw new Error(`Missing designer workspace role ${name}`);
  return value as T;
}
