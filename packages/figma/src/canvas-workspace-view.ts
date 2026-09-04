export interface CanvasWorkspaceCopy {
  workspaceLabel: string;
  previewLabel: string;
  back: string;
  title: string;
  addVariant: string;
  removeVariant: string;
  templateName: string;
  templateNamePlaceholder: string;
  saveTemplate: string;
  savingTemplate: string;
  templateSaved: string;
  outputName: string;
  operation: string;
  crop: string;
  trim: string;
  pad: string;
  contain: string;
  cover: string;
  stretch: string;
  x: string;
  y: string;
  width: string;
  height: string;
  threshold: string;
  top: string;
  right: string;
  bottom: string;
  left: string;
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
  templateName: HTMLInputElement;
  saveTemplate: HTMLButtonElement;
  variantId: HTMLInputElement;
  operation: HTMLSelectElement;
  outputGroup: HTMLDivElement;
  width: HTMLInputElement;
  height: HTMLInputElement;
  cropGroup: HTMLDivElement;
  cropX: HTMLInputElement;
  cropY: HTMLInputElement;
  cropWidth: HTMLInputElement;
  cropHeight: HTMLInputElement;
  trimGroup: HTMLDivElement;
  trimThreshold: HTMLInputElement;
  padGroup: HTMLDivElement;
  padTop: HTMLInputElement;
  padRight: HTMLInputElement;
  padBottom: HTMLInputElement;
  padLeft: HTMLInputElement;
  anchorField: HTMLDivElement;
  anchorGrid: HTMLDivElement;
  backgroundField: HTMLLabelElement;
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
      <button id="canvas-back" class="canvas-back" type="button"><span class="ui-icon" data-icon-id="icon-park:right-small" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 24.0083H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 12L36 24L24 36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>
      <div class="canvas-heading"><p id="canvas-title" class="sr-only"></p></div>
      <button id="canvas-add-variant" type="button"></button>
    </header>
    <div id="canvas-variants" class="canvas-variants" role="tablist"></div>
    <div class="canvas-body">
      <div id="canvas-preview" class="canvas-preview" role="tabpanel"><output id="canvas-source-name" class="canvas-source-hud" aria-live="off"></output></div>
      <aside class="canvas-inspector">
        <label class="canvas-field"><span id="canvas-output-name-label"></span><input id="canvas-variant-id" type="text" maxlength="64" autocomplete="off" spellcheck="false"></label>
        <label class="canvas-field"><span id="canvas-operation-label"></span><select id="canvas-operation">
          <option value="crop"></option><option value="trim"></option><option value="pad"></option>
          <option value="contain"></option><option value="cover"></option><option value="stretch"></option>
        </select></label>
        <div id="canvas-output-group" class="canvas-size-row">
          <label><span id="canvas-width-label"></span><input id="canvas-width" type="number" min="1" max="4096" step="1" inputmode="numeric"></label>
          <label><span id="canvas-height-label"></span><input id="canvas-height" type="number" min="1" max="4096" step="1" inputmode="numeric"></label>
        </div>
        <div id="canvas-crop-group" class="canvas-quad-fields" hidden>
          <label><span id="canvas-crop-x-label"></span><input id="canvas-crop-x" type="number" min="0" max="4095" step="1"></label>
          <label><span id="canvas-crop-y-label"></span><input id="canvas-crop-y" type="number" min="0" max="4095" step="1"></label>
          <label><span id="canvas-crop-width-label"></span><input id="canvas-crop-width" type="number" min="1" max="4096" step="1"></label>
          <label><span id="canvas-crop-height-label"></span><input id="canvas-crop-height" type="number" min="1" max="4096" step="1"></label>
        </div>
        <div id="canvas-trim-group" class="canvas-field" hidden><label><span id="canvas-trim-threshold-label"></span><input id="canvas-trim-threshold" type="number" min="0" max="254" step="1"></label></div>
        <div id="canvas-pad-group" class="canvas-quad-fields" hidden>
          <label><span id="canvas-pad-top-label"></span><input id="canvas-pad-top" type="number" min="0" max="4096" step="1"></label>
          <label><span id="canvas-pad-right-label"></span><input id="canvas-pad-right" type="number" min="0" max="4096" step="1"></label>
          <label><span id="canvas-pad-bottom-label"></span><input id="canvas-pad-bottom" type="number" min="0" max="4096" step="1"></label>
          <label><span id="canvas-pad-left-label"></span><input id="canvas-pad-left" type="number" min="0" max="4096" step="1"></label>
        </div>
        <div class="inspector-divider" aria-hidden="true"></div>
        <div id="canvas-anchor-field" class="canvas-field"><span id="canvas-anchor-label"></span><div id="canvas-anchor-grid" class="canvas-anchor-grid" role="group"></div></div>
        <label id="canvas-background-field" class="canvas-field"><span id="canvas-background-label"></span><select id="canvas-background"><option value="transparent"></option><option value="color"></option></select></label>
        <input id="canvas-background-color" class="canvas-color" type="color" value="#ffffff" hidden>
        <div class="inspector-divider" aria-hidden="true"></div>
        <button id="canvas-remove-variant" class="canvas-remove" type="button"></button>
        <div class="inspector-divider" aria-hidden="true"></div>
        <div class="canvas-template-save"><input id="canvas-template-name" type="text" maxlength="80" autocomplete="off"><button id="canvas-save-template" class="icon-tooltip-host" type="button" aria-label="Save template"><span class="ui-icon" data-icon-id="icon-park:save" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9C6 7.34315 7.34315 6 9 6H34.2814L42 13.2065V39C42 40.6569 40.6569 42 39 42H9C7.34315 42 6 40.6569 6 39V9Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M24.0083 6L24 13.3846C24 13.7245 23.5523 14 23 14H15C14.4477 14 14 13.7245 14 13.3846L14 6" fill="none"/><path d="M24.0083 6L24 13.3846C24 13.7245 23.5523 14 23 14H15C14.4477 14 14 13.7245 14 13.3846L14 6H24.0083Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M9 6H34.2814" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 26H34" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 34H24.0083" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="action-tooltip" aria-hidden="true">Save template</span></button></div>
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
    templateName: required(root, "canvas-template-name"),
    saveTemplate: required(root, "canvas-save-template"),
    variantId: required(root, "canvas-variant-id"),
    operation: required(root, "canvas-operation"),
    outputGroup: required(root, "canvas-output-group"),
    width: required(root, "canvas-width"),
    height: required(root, "canvas-height"),
    cropGroup: required(root, "canvas-crop-group"),
    cropX: required(root, "canvas-crop-x"),
    cropY: required(root, "canvas-crop-y"),
    cropWidth: required(root, "canvas-crop-width"),
    cropHeight: required(root, "canvas-crop-height"),
    trimGroup: required(root, "canvas-trim-group"),
    trimThreshold: required(root, "canvas-trim-threshold"),
    padGroup: required(root, "canvas-pad-group"),
    padTop: required(root, "canvas-pad-top"),
    padRight: required(root, "canvas-pad-right"),
    padBottom: required(root, "canvas-pad-bottom"),
    padLeft: required(root, "canvas-pad-left"),
    anchorField: required(root, "canvas-anchor-field"),
    anchorGrid: required(root, "canvas-anchor-grid"),
    backgroundField: required(root, "canvas-background-field"),
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
      view.back.setAttribute("aria-label", copy.back);
      view.back.title = copy.back;
      required<HTMLElement>(root, "canvas-title").textContent = copy.title;
      view.addVariant.textContent = copy.addVariant;
      view.removeVariant.textContent = copy.removeVariant;
      view.templateName.setAttribute("aria-label", copy.templateName);
      view.templateName.placeholder = copy.templateNamePlaceholder;
      view.saveTemplate.setAttribute("aria-label", copy.saveTemplate);
      const templateTooltip = view.saveTemplate.querySelector<HTMLElement>(".action-tooltip");
      if (templateTooltip) templateTooltip.textContent = copy.saveTemplate;
      required<HTMLElement>(root, "canvas-output-name-label").textContent = copy.outputName;
      required<HTMLElement>(root, "canvas-operation-label").textContent = copy.operation;
      for (const [value, label] of [["crop", copy.crop], ["trim", copy.trim], ["pad", copy.pad], ["contain", copy.contain], ["cover", copy.cover], ["stretch", copy.stretch]] as const) {
        const option = view.operation.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
        if (option) option.textContent = label;
      }
      for (const [id, label] of [["canvas-width-label", copy.width], ["canvas-height-label", copy.height], ["canvas-crop-x-label", copy.x], ["canvas-crop-y-label", copy.y], ["canvas-crop-width-label", copy.width], ["canvas-crop-height-label", copy.height], ["canvas-trim-threshold-label", copy.threshold], ["canvas-pad-top-label", copy.top], ["canvas-pad-right-label", copy.right], ["canvas-pad-bottom-label", copy.bottom], ["canvas-pad-left-label", copy.left]] as const) {
        required<HTMLElement>(root, id).textContent = label;
      }
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
