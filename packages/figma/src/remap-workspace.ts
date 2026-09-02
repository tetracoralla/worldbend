import { RemapWebGLRenderer, type RemapOperation, type RemapSpecInput } from "@worldbend/web";
import { planRemap } from "./designer-plan";
import { scaledPreviewSize } from "./designer-preview";
import { createFrameCoalescer } from "./frame-coalescer";
import {
  createDesignerWorkspaceShell,
  fitPreviewCanvas,
  postDesignerResult,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import type { MainToUiMessage, UiToMainMessage } from "./messages";

export interface RemapWorkspaceCopy extends DesignerWorkspaceCopy {
  mode: string; lens: string; displacement: string; width: string; height: string;
  k1: string; k2: string; more: string; k3: string; p1: string; p2: string;
  centerX: string; centerY: string; scaleX: string; scaleY: string;
  xChannel: string; yChannel: string; neutral: string; boundary: string;
  red: string; green: string; blue: string; alpha: string; luminance: string;
  transparent: string; clamp: string; wrap: string; mapRequired: string;
}

export function createRemapWorkspace(input: {
  root: HTMLElement;
  copy(): RemapWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
}): DesignerTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.inspector.innerHTML = `<label class="designer-field"><span data-role="mode-label"></span><select data-role="mode"><option value="lens"></option><option value="displacement"></option></select></label>
    <div class="designer-row"><label class="designer-field"><span data-role="width-label"></span><input data-role="width" type="number" min="1" max="4096"></label><label class="designer-field"><span data-role="height-label"></span><input data-role="height" type="number" min="1" max="4096"></label></div>
    <div data-role="lens"><div class="designer-row"><label class="designer-field"><span data-role="k1-label"></span><input data-role="k1" type="number" min="-4" max="4" step="0.01"></label><label class="designer-field"><span data-role="k2-label"></span><input data-role="k2" type="number" min="-4" max="4" step="0.01"></label></div><div class="inspector-divider" aria-hidden="true"></div><button data-role="more" class="advanced-toggle" type="button" aria-expanded="false"><span data-role="more-label"></span><span class="ui-icon" data-icon-id="icon-park:right-small" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M36 24.0083H12" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 12L36 24L24 36" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button><div data-role="advanced" hidden></div></div>
    <div data-role="displacement" hidden><div class="designer-row"><label class="designer-field"><span data-role="x-channel-label"></span><select data-role="x-channel"></select></label><label class="designer-field"><span data-role="y-channel-label"></span><select data-role="y-channel"></select></label></div><div class="designer-row"><label class="designer-field"><span data-role="scale-x-label"></span><input data-role="scale-x" type="number" min="-4096" max="4096" step="1"></label><label class="designer-field"><span data-role="scale-y-label"></span><input data-role="scale-y" type="number" min="-4096" max="4096" step="1"></label></div><label class="designer-field"><span data-role="neutral-label"></span><input data-role="neutral" type="number" min="0" max="255" step="1"></label><label class="designer-field"><span data-role="boundary-label"></span><select data-role="boundary"></select></label></div>`;
  const advanced = role<HTMLElement>(shell.inspector, "advanced");
  advanced.innerHTML = `<div class="designer-row"><label class="designer-field"><span data-role="k3-label"></span><input data-role="k3" type="number" min="-4" max="4" step="0.01"></label><label class="designer-field"><span data-role="p1-label"></span><input data-role="p1" type="number" min="-4" max="4" step="0.01"></label></div><label class="designer-field"><span data-role="p2-label"></span><input data-role="p2" type="number" min="-4" max="4" step="0.01"></label><div class="designer-row"><label class="designer-field"><span data-role="center-x-label"></span><input data-role="center-x" type="number" min="-1" max="2" step="0.01"></label><label class="designer-field"><span data-role="center-y-label"></span><input data-role="center-y" type="number" min="-1" max="2" step="0.01"></label></div><div class="designer-row"><label class="designer-field"><span data-role="lens-scale-x-label"></span><input data-role="lens-scale-x" type="number" min="0.000001" max="10" step="0.01"></label><label class="designer-field"><span data-role="lens-scale-y-label"></span><input data-role="lens-scale-y" type="number" min="0.000001" max="10" step="0.01"></label></div>`;
  const renderer = new RemapWebGLRenderer(document.createElement("canvas"));
  shell.preview.append(renderer.canvas);
  const controls = controlMap(shell.inspector);
  fillSelect(controls["x-channel"] as HTMLSelectElement, ["red", "green", "blue", "alpha", "luminance"]);
  fillSelect(controls["y-channel"] as HTMLSelectElement, ["red", "green", "blue", "alpha", "luminance"]);
  fillSelect(controls["boundary"] as HTMLSelectElement, ["transparent", "clamp", "wrap"]);
  let source: DesignerWorkspaceSource | undefined;
  let spec: RemapSpecInput | undefined;
  let baseline: RemapSpecInput | undefined;
  let generation = 0;
  let busy = false;
  let active = false;
  // Numeric edits preview live at paint cadence; the change event remains the
  // commit boundary that echoes values back into the fields.
  const liveFrames = createFrameCoalescer(() => void render(false));

  shell.back.addEventListener("click", input.onBack);
  shell.reset.addEventListener("click", () => { if (baseline) { spec = structuredClone(baseline); renderControls(); void render(false); } });
  controls["more"]!.addEventListener("click", () => {
    advanced.hidden = !advanced.hidden;
    controls["more"]!.setAttribute("aria-expanded", String(!advanced.hidden));
  });
  for (const control of Object.values(controls)) {
    if (control === controls["more"]) continue;
    control.addEventListener("input", () => {
      if (control instanceof HTMLInputElement && control.type === "number") {
        // Live preview stays quiet while any numeric field is empty or
        // invalid; the explicit change event still surfaces the error.
        if (!numberInputsCommittable()) return;
      }
      commitControls();
    });
    control.addEventListener("change", () => {
      commitControls();
      renderControls();
      liveFrames.flush();
    });
  }
  shell.apply.addEventListener("click", () => void apply(false));
  shell.applyNew.addEventListener("click", () => void apply(true));

  function commitControls(): void {
    if (!spec) return;
    const mode = (controls["mode"] as HTMLSelectElement).value;
    const output = { width: number("width"), height: number("height") };
    const operation: RemapOperation = mode === "lens"
      ? { kind: "lens", coefficients: { k1: number("k1"), k2: number("k2"), k3: number("k3"), p1: number("p1"), p2: number("p2") }, center: { x: number("center-x"), y: number("center-y") }, scale: { x: number("lens-scale-x"), y: number("lens-scale-y") } }
      : { kind: "displacement", xChannel: select("x-channel") as "red", yChannel: select("y-channel") as "green", scaleXPixels: number("scale-x"), scaleYPixels: number("scale-y"), neutral: number("neutral"), boundary: select("boundary") as "transparent" };
    spec = { ...spec, output, operation };
    liveFrames.request();
  }

  function renderControls(): void {
    if (!spec) return;
    set("width", spec.output.width); set("height", spec.output.height);
    const operation = spec.operation;
    const lens = operation.kind === "lens";
    (controls["mode"] as HTMLSelectElement).value = operation.kind;
    role<HTMLElement>(shell.inspector, "lens").hidden = !lens;
    role<HTMLElement>(shell.inspector, "displacement").hidden = lens;
    if (operation.kind === "lens") {
      const c = operation.coefficients;
      for (const [name, value] of [["k1", c.k1 ?? 0], ["k2", c.k2 ?? 0], ["k3", c.k3 ?? 0], ["p1", c.p1 ?? 0], ["p2", c.p2 ?? 0], ["center-x", operation.center?.x ?? .5], ["center-y", operation.center?.y ?? .5], ["lens-scale-x", operation.scale?.x ?? .5], ["lens-scale-y", operation.scale?.y ?? .5]] as const) set(name, value);
    } else {
      selectSet("x-channel", operation.xChannel); selectSet("y-channel", operation.yChannel);
      set("scale-x", operation.scaleXPixels); set("scale-y", operation.scaleYPixels); set("neutral", operation.neutral ?? 128); selectSet("boundary", operation.boundary ?? "transparent");
    }
    (controls["mode"] as HTMLSelectElement).querySelector<HTMLOptionElement>('option[value="displacement"]')!.disabled = (source?.sources.length ?? 0) < 2;
    shell.applyNew.hidden = !source?.targetNodeId;
  }

  async function render(high = false): Promise<boolean> {
    if (!source || !spec) return false;
    const current = ++generation;
    try {
      const plan = await planRemap(spec);
      if (current !== generation) return false;
      const map = plan.requiresMap ? source.sources[1]?.image : undefined;
      if (plan.requiresMap && !map) {
        shell.showError(input.copy().mapRequired);
        shell.apply.disabled = true;
        return false;
      }
      // Preview draws the validated program at the shared capped axis; the
      // Apply path below renders the full requested output.
      renderer.render(
        source.sources[0]!.image,
        map,
        plan.spec,
        high,
        high ? undefined : scaledPreviewSize(spec.output.width, spec.output.height),
      );
      fitPreviewCanvas(renderer.canvas, shell.preview);
      shell.showError(); shell.apply.disabled = false;
      return true;
    } catch (error) {
      if (current !== generation) return false;
      shell.showError(input.formatError(error)); shell.apply.disabled = true;
      return false;
    }
  }

  async function apply(duplicate: boolean): Promise<void> {
    if (!source || !spec || busy) return;
    busy = true;
    // A queued preview frame must not redraw capped pixels over the full
    // resolution output between render and encode.
    liveFrames.cancel();
    shell.setBusy(true); shell.status.textContent = input.copy().applying;
    try {
      if (!(await render(true))) throw new Error("Remap output is invalid");
      postDesignerResult({ post: input.post, source, task: { kind: "remap", spec }, bytes: await renderer.exportPng(), width: spec.output.width, height: spec.output.height, duplicate });
    } catch (error) { busy = false; shell.setBusy(false); shell.showError(input.formatError(error)); }
  }

  return {
    enter() { active = true; shell.root.hidden = false; void render(false); }, leave() { active = false; shell.root.hidden = true; generation += 1; liveFrames.cancel(); },
    setSource(next) {
      busy = false; shell.setBusy(false);
      source = next;
      const first = next.sources[0]; if (!first) return;
      spec = next.task?.kind === "remap" ? structuredClone(next.task.spec) : defaultRemap(first.renderWidth, first.renderHeight, next.sources.length > 1);
      baseline = structuredClone(spec); renderControls(); if (active) void render();
    },
    clearSource(error) { busy = false; shell.setBusy(false); source = undefined; spec = undefined; shell.showError(error); shell.apply.disabled = true; },
    updateLocale() {
      const copy = input.copy(); shell.setCopy(copy);
      for (const [name, text] of [["mode-label", copy.mode], ["width-label", copy.width], ["height-label", copy.height], ["k1-label", copy.k1], ["k2-label", copy.k2], ["k3-label", copy.k3], ["p1-label", copy.p1], ["p2-label", copy.p2], ["center-x-label", copy.centerX], ["center-y-label", copy.centerY], ["lens-scale-x-label", copy.scaleX], ["lens-scale-y-label", copy.scaleY], ["x-channel-label", copy.xChannel], ["y-channel-label", copy.yChannel], ["scale-x-label", copy.scaleX], ["scale-y-label", copy.scaleY], ["neutral-label", copy.neutral], ["boundary-label", copy.boundary]] as const) role<HTMLElement>(shell.inspector, name).textContent = text;
      (controls["mode"] as HTMLSelectElement).options[0]!.textContent = copy.lens; (controls["mode"] as HTMLSelectElement).options[1]!.textContent = copy.displacement;
      role<HTMLElement>(shell.inspector, "more-label").textContent = copy.more;
      localizeOptions(controls["x-channel"] as HTMLSelectElement, copy); localizeOptions(controls["y-channel"] as HTMLSelectElement, copy); localizeOptions(controls["boundary"] as HTMLSelectElement, copy);
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!busy || (message.type !== "apply-designer-complete" && message.type !== "apply-designer-error")) return false;
      if (!source || message.generation !== source.selectionGeneration) return true;
      busy = false;
      shell.setBusy(false);
      renderControls();
      if (message.type === "apply-designer-error") shell.showError(input.formatError(message.message));
      else shell.status.textContent = input.copy().applied;
      return true;
    },
    handleKeydown(event) { if (event.key !== "Escape") return false; input.onBack(); return true; }, dispose() { liveFrames.cancel(); renderer.dispose(); },
  };

  function number(name: string): number { return Number((controls[name] as HTMLInputElement).value); }
  function numberInputsCommittable(): boolean {
    for (const candidate of Object.values(controls)) {
      if (
        candidate instanceof HTMLInputElement && candidate.type === "number" &&
        (!candidate.validity.valid || candidate.value.trim().length === 0)
      ) {
        return false;
      }
    }
    return true;
  }
  function select(name: string): string { return (controls[name] as HTMLSelectElement).value; }
  function set(name: string, value: number): void { (controls[name] as HTMLInputElement).value = String(value); }
  function selectSet(name: string, value: string): void { (controls[name] as HTMLSelectElement).value = value; }
}

export function defaultRemap(width: number, height: number, displacement: boolean): RemapSpecInput {
  return { schema: "worldbend.remap", version: "0.1", output: { width, height }, operation: displacement
    ? { kind: "displacement", xChannel: "red", yChannel: "green", scaleXPixels: 24, scaleYPixels: 24, neutral: 128, boundary: "transparent" }
    : { kind: "lens", coefficients: { k1: 0, k2: 0, k3: 0, p1: 0, p2: 0 }, center: { x: .5, y: .5 }, scale: { x: .5, y: .5 } } };
}
function controlMap(root: HTMLElement): Record<string, HTMLElement> { return Object.fromEntries(Array.from(root.querySelectorAll<HTMLElement>("[data-role]")).map((element) => [element.dataset.role!, element])); }
function fillSelect(select: HTMLSelectElement, values: readonly string[]): void { for (const value of values) { const option = document.createElement("option"); option.value = value; option.textContent = value; select.append(option); } }
function localizeOptions(select: HTMLSelectElement, copy: RemapWorkspaceCopy): void { for (const option of select.options) option.textContent = copy[option.value as keyof RemapWorkspaceCopy] ?? option.value; }
function role<T extends HTMLElement>(root: HTMLElement, name: string): T { const value = root.querySelector<HTMLElement>(`[data-role="${name}"]`); if (!value) throw new Error(`Missing remap workspace role ${name}`); return value as T; }
