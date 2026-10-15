import type { SourceRasterPayload, UiToMainMessage } from "./messages";
import type { FigmaDeformationTask, StoredDesignerTask } from "./stored-designer-task";
import {assertPersistableDesignerTask} from "./stored-designer-task";
import { deformationArtworkIndex, sameDesignerTaskFamily } from "./stored-designer-task";
import type { StoredEffectDraft, StoredMockupDraft } from "./stored-designer-task";
import { sameJsonValue } from "./json-value";
export { sameJsonValue } from "./json-value";

export type LoadedDesignerSource = Omit<SourceRasterPayload, "bytes"> & {
  image: HTMLImageElement;
};

export interface DesignerWorkspaceSource {
  sources: LoadedDesignerSource[];
  selectionGeneration: number;
  task?: StoredDesignerTask;
  deformationDraft?: FigmaDeformationTask;
  effectDraft?: StoredEffectDraft;
  mockupDraft?: StoredMockupDraft;
  mockupDraftUnavailable?: true;
  targetPlacement?: SourceRasterPayload["placement"];
  targetRasterSize?: { width: number; height: number };
  targetNodeId?: string;
  nativeVector?:true;
  nativeVectorTarget?:true;
  sceneContext?: true;
  sceneContextReadOnly?: true;
}

/** A publication in another view updates saved state without replacing this
 * view's draft or local Undo history. The UI checks target/generation first. */
export function withDesignerPublication(
  source: DesignerWorkspaceSource,
  task: StoredDesignerTask,
  publication?: { placement: SourceRasterPayload["placement"]; renderWidth: number; renderHeight: number },
): DesignerWorkspaceSource {
  const { deformationDraft: _draft, ...previous } = source;
  return {
    ...previous,
    task,
    ...(publication ? {
      targetPlacement: { ...publication.placement },
      targetRasterSize: { width: publication.renderWidth, height: publication.renderHeight },
    } : {}),
  };
}

export function designerDeformationTask(source?: DesignerWorkspaceSource): FigmaDeformationTask | undefined {
  return source?.deformationDraft ?? (source?.task?.kind === "deformation" ? source.task : undefined);
}

export function deformationArtworkSource(source?: DesignerWorkspaceSource): LoadedDesignerSource | undefined {
  return source?.sources[deformationArtworkIndex(designerDeformationTask(source))];
}

export function sameDesignerSelection(
  previous: DesignerWorkspaceSource | undefined,
  next: DesignerWorkspaceSource,
): boolean {
  return previous !== undefined && previous.targetNodeId === next.targetNodeId &&
    previous.sources.length === next.sources.length &&
    previous.sources.every((source, index) => source.sourceNodeId === next.sources[index]?.sourceNodeId);
}

/** Pixel refreshes retain a draft only while its source coordinate frame and
 * stored operation are unchanged. A different saved task is external work. */
export function canRetainDesignerDraft(previous: DesignerWorkspaceSource | undefined, next: DesignerWorkspaceSource): boolean {
  return sameDesignerSelection(previous, next) && previous !== undefined &&
    previous.sources.every((source, index) => source.renderWidth === next.sources[index]?.renderWidth &&
      source.renderHeight === next.sources[index]?.renderHeight) &&
    sameJsonValue(previous.task, next.task) && sameJsonValue(previous.deformationDraft, next.deformationDraft) && sameJsonValue(previous.effectDraft, next.effectDraft) &&
    sameJsonValue(previous.mockupDraft, next.mockupDraft);
}

export interface DesignerTaskWorkspace {
  enter(): void;
  leave(): void;
  setSource(source: DesignerWorkspaceSource): void;
  selectionLoading(): void;
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
  update: string;
  applying: string;
  applied: string;
  outputLabel?:string;vectorOutput?:string;imageOutput?:string;vectorApply?:string;vectorUpdate?:string;
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
  outputKind:HTMLSelectElement;
  error: HTMLParagraphElement;
  status: HTMLParagraphElement;
  setCopy(copy: DesignerWorkspaceCopy): void;
  setTargetName(name: string | undefined): void;
  setPublicationTarget(source: DesignerWorkspaceSource | undefined, kind: StoredDesignerTask["kind"]): void;
  setBusy(busy: boolean): void;
  showError(message?: string): void;
}

export function createDesignerWorkspaceShell(root: HTMLElement): DesignerWorkspaceShell {
  let targetName: string | undefined;
  let workspaceTitle = "";
  let actionCopy: DesignerWorkspaceCopy | undefined;
  let outputIdentity:string|undefined;
  let currentSource:DesignerWorkspaceSource|undefined;
  let currentKind:StoredDesignerTask["kind"]|undefined;
  let publicationLabel: "apply" | "applyNew" | "update" = "apply";
  root.classList.add("designer-workspace");
  root.innerHTML = `<header class="designer-header"><button class="designer-back" data-role="back" type="button"><span class="ui-icon" data-icon-id="icon-park:right-small" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 24.0083H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 12L36 24L24 36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button><h1 data-role="title"></h1></header>
    <div class="designer-body"><div class="designer-preview" data-role="preview"></div><aside class="designer-inspector" data-role="inspector"></aside></div>
    <footer class="designer-footer"><button data-role="reset" type="button"></button><span class="designer-publication"><select data-role="output-kind" hidden><option value="image"></option><option value="vector"></option></select><button data-role="apply-new" type="button" hidden></button> <button data-role="apply" class="primary" type="button"></button></span></footer>
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
    outputKind:role(root,"output-kind"),
    error: role(root, "error"),
    status: role(root, "status"),
    setCopy(copy) {
      actionCopy = copy;
      shell.back.setAttribute("aria-label", copy.back);
      shell.back.title = copy.back;
      workspaceTitle = copy.title;
      shell.title.textContent = targetName ?? workspaceTitle;
      shell.title.title = targetName ?? workspaceTitle;
      shell.reset.textContent = copy.reset;
      shell.apply.textContent=shell.outputKind.value==="vector"&&!shell.outputKind.hidden?
        (publicationLabel==="update"?copy.vectorUpdate??copy.update:copy.vectorApply??copy.apply):copy[publicationLabel];
      shell.applyNew.textContent=shell.outputKind.value==="vector"&&!shell.outputKind.hidden?copy.vectorApply??copy.applyNew:copy.applyNew;
      shell.outputKind.setAttribute("aria-label",copy.outputLabel??"Output");
      shell.outputKind.options[0]!.textContent=copy.imageOutput??"Linked HD Image";
      shell.outputKind.options[1]!.textContent=copy.vectorOutput??"Native Vector";
    },
    setTargetName(name) {
      targetName = name;
      shell.title.textContent = targetName ?? workspaceTitle;
      shell.title.title = targetName ?? workspaceTitle;
    },
    setPublicationTarget(source, kind) {
      currentSource=source;currentKind=kind;
      const identity=source?.targetNodeId??source?.sources.map(s=>s.sourceNodeId).join(":");
      if(identity!==outputIdentity){outputIdentity=identity;shell.outputKind.value=source?.nativeVectorTarget?"vector":"image";}
      shell.outputKind.hidden=kind!=="deformation"||!(source?.nativeVector||source?.nativeVectorTarget);
      shell.outputKind.options[1]!.disabled=!source?.nativeVector;
      const replace=canReplaceDesignerTask(source,kind)&&Boolean(source?.nativeVectorTarget)===(shell.outputKind.value==="vector");
      publicationLabel = replace ? "update" : source?.targetNodeId ? "applyNew" : "apply";
      shell.applyNew.hidden = !replace;
      if(actionCopy)shell.setCopy(actionCopy);
    },
    setBusy(busy) {
      for (const element of shell.root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")) {
        if (element.dataset.role === "back") continue;
        element.disabled = busy;
      }
    },
    showError(message) {
      shell.error.textContent = message ?? "";
      shell.error.hidden = !message;
      // A completed failure must not keep the previous Applying/Saving status
      // alongside enabled retry controls. Clearing an error alone does not
      // erase the next operation's independently assigned status.
      if (message) shell.status.textContent = "";
    },
  };
  shell.outputKind.addEventListener("change",()=>{if(currentKind)shell.setPublicationTarget(currentSource,currentKind);});
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
  rasterSize?: { width: number; height: number };
  duplicate?: boolean;
  sceneSizes?: true;
  nativeVector?:true;
  placement?: SourceRasterPayload["placement"];
  canvasChange?: import("./raster-canvas-change").RasterCanvasChange;
}): void {
  assertPersistableDesignerTask(input.task);
  const first = input.task.kind === "deformation" ? deformationArtworkSource(input.source) : input.source.sources[0];
  if (!first) throw new Error("No source is loaded");
  // A different tool starts a new linked result from these bound sources.
  // Only a compatible saved task is an in-place editing target.
  const duplicate=input.duplicate||Boolean(input.source.targetNodeId&&
    (!canReplaceDesignerTask(input.source,input.task.kind)||Boolean(input.source.nativeVectorTarget)!==Boolean(input.nativeVector)));
  input.post({
    type: "apply-designer",
    payload: {
      generation: input.source.selectionGeneration,
      task: input.task,
      sourceNodeIds: input.source.sources.map((source) => source.sourceNodeId),
      bytes: input.bytes,
      renderWidth: input.rasterSize?.width ?? input.width,
      renderHeight: input.rasterSize?.height ?? input.height,
      placement: input.placement ?? (!duplicate && input.source.targetPlacement
        ? { ...input.source.targetPlacement }
        : outputDocumentBox(input.task.kind === "deformation" ? [first] : input.source.sources, input.width, input.height)),
      ...(input.source.targetNodeId ? { targetNodeId: input.source.targetNodeId } : {}),
      ...(duplicate ? { duplicate: true } : {}),
      ...(input.sceneSizes ? { sceneSizes: true } : {}),
      ...(input.nativeVector ? { nativeVector: true } : {}),
      ...(!duplicate && !input.nativeVector && input.canvasChange ? { canvasChange: input.canvasChange } : {}),
    },
  });
}

function canReplaceDesignerTask(source: DesignerWorkspaceSource | undefined, kind: StoredDesignerTask["kind"]): boolean {
  return Boolean(source?.targetNodeId && source.task && sameDesignerTaskFamily(source.task.kind, kind));
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
  const style = getComputedStyle(host);
  const pixels = (value: string) => Number.parseFloat(value) || 0;
  // client dimensions include padding. Oversizing one axis lets CSS max-width
  // or max-height clamp it independently and stretches the displayed artwork.
  const availableWidth = Math.max(1, host.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight));
  const availableHeight = Math.max(1, host.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom));
  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
  const width = `${canvas.width * scale}px`;
  const height = `${canvas.height * scale}px`;
  if (canvas.style.width === width && canvas.style.height === height) return;
  canvas.style.width = width;
  canvas.style.height = height;
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
