export interface CanvasWorkspaceCopy {
  workspaceLabel: string;
  previewLabel: string;
  fitLabel: string;
  back: string;
  title: string;
  addVariant: string;
  removeVariant: string;
  width: string;
  height: string;
  contain: string;
  cover: string;
  anchor: string;
  background: string;
  transparent: string;
  solid: string;
  reset: string;
  apply: string;
  applyVariants: string;
  replace: string;
  applyNew: string;
  planning: string;
  applying: string;
  applied: string;
  invalid: string;
  anchors: readonly string[];
}

export interface CanvasWorkspaceView {
  root: HTMLElement;
  back: HTMLButtonElement;
  sourceName: HTMLElement;
  variants: HTMLDivElement;
  addVariant: HTMLButtonElement;
  removeVariant: HTMLButtonElement;
  width: HTMLInputElement;
  height: HTMLInputElement;
  contain: HTMLButtonElement;
  cover: HTMLButtonElement;
  anchorGrid: HTMLDivElement;
  background: HTMLSelectElement;
  backgroundColor: HTMLInputElement;
  preview: HTMLDivElement;
  reset: HTMLButtonElement;
  applyNew: HTMLButtonElement;
  apply: HTMLButtonElement;
  error: HTMLParagraphElement;
  status: HTMLParagraphElement;
  applyCopy(copy: CanvasWorkspaceCopy): void;
}

export function createCanvasWorkspaceView(root: HTMLElement): CanvasWorkspaceView {
  root.innerHTML = `
    <header class="canvas-header">
      <button id="canvas-back" class="canvas-back" type="button"></button>
      <div class="canvas-heading"><h1 id="canvas-source-name"></h1><p id="canvas-title"></p></div>
      <button id="canvas-add-variant" type="button"></button>
    </header>
    <div id="canvas-variants" class="canvas-variants" role="tablist"></div>
    <div class="canvas-body">
      <div id="canvas-preview" class="canvas-preview" role="tabpanel"></div>
      <aside class="canvas-inspector">
        <div class="canvas-size-row">
          <label><span id="canvas-width-label"></span><input id="canvas-width" type="number" min="1" max="4096" step="1" inputmode="numeric"></label>
          <label><span id="canvas-height-label"></span><input id="canvas-height" type="number" min="1" max="4096" step="1" inputmode="numeric"></label>
        </div>
        <div id="canvas-fit-group" class="canvas-segment" role="group">
          <button id="canvas-fit-contain" type="button" aria-pressed="true"></button>
          <button id="canvas-fit-cover" type="button" aria-pressed="false"></button>
        </div>
        <div class="canvas-field"><span id="canvas-anchor-label"></span><div id="canvas-anchor-grid" class="canvas-anchor-grid" role="group"></div></div>
        <label class="canvas-field"><span id="canvas-background-label"></span><select id="canvas-background"><option value="transparent"></option><option value="color"></option></select></label>
        <input id="canvas-background-color" class="canvas-color" type="color" value="#ffffff" hidden>
        <button id="canvas-remove-variant" class="canvas-remove" type="button"></button>
      </aside>
    </div>
    <footer class="canvas-footer">
      <button id="canvas-reset" type="button"></button>
      <span class="canvas-footer-actions"><button id="canvas-apply-new" type="button" hidden></button><button id="canvas-apply" class="primary" type="button"></button></span>
    </footer>
    <p id="canvas-error" role="alert" hidden></p>
    <p id="canvas-status" class="sr-only" role="status" aria-live="polite"></p>`;

  const view: CanvasWorkspaceView = {
    root,
    back: required(root, "canvas-back"),
    sourceName: required(root, "canvas-source-name"),
    variants: required(root, "canvas-variants"),
    addVariant: required(root, "canvas-add-variant"),
    removeVariant: required(root, "canvas-remove-variant"),
    width: required(root, "canvas-width"),
    height: required(root, "canvas-height"),
    contain: required(root, "canvas-fit-contain"),
    cover: required(root, "canvas-fit-cover"),
    anchorGrid: required(root, "canvas-anchor-grid"),
    background: required(root, "canvas-background"),
    backgroundColor: required(root, "canvas-background-color"),
    preview: required(root, "canvas-preview"),
    reset: required(root, "canvas-reset"),
    applyNew: required(root, "canvas-apply-new"),
    apply: required(root, "canvas-apply"),
    error: required(root, "canvas-error"),
    status: required(root, "canvas-status"),
    applyCopy(copy) {
      view.root.setAttribute("aria-label", copy.workspaceLabel);
      view.preview.setAttribute("aria-label", copy.previewLabel);
      required<HTMLElement>(root, "canvas-fit-group").setAttribute("aria-label", copy.fitLabel);
      view.back.textContent = copy.back;
      view.back.setAttribute("aria-label", copy.back);
      required<HTMLElement>(root, "canvas-title").textContent = copy.title;
      view.addVariant.textContent = copy.addVariant;
      view.removeVariant.textContent = copy.removeVariant;
      required<HTMLElement>(root, "canvas-width-label").textContent = copy.width;
      required<HTMLElement>(root, "canvas-height-label").textContent = copy.height;
      view.contain.textContent = copy.contain;
      view.cover.textContent = copy.cover;
      required<HTMLElement>(root, "canvas-anchor-label").textContent = copy.anchor;
      view.anchorGrid.setAttribute("aria-label", copy.anchor);
      required<HTMLElement>(root, "canvas-background-label").textContent = copy.background;
      view.background.options[0]!.textContent = copy.transparent;
      view.background.options[1]!.textContent = copy.solid;
      view.reset.textContent = copy.reset;
      view.applyNew.textContent = copy.applyNew;
    },
  };
  return view;
}

function required<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const element = root.querySelector<HTMLElement>(`#${id}`);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
