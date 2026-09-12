import {
  createDesignerWorkspaceShell,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import { planMockup } from "./designer-plan";
import type { MainToUiMessage, TemplateMutationReceipt, UiToMainMessage } from "./messages";
import { taskWorkspaceAvailability } from "./task-launcher";
import {
  templateOutputCount,
  templateSourceCount,
  type FigmaTaskTemplate,
  type SavedSpatialTemplate,
} from "./stored-template-library";

export interface TemplateWorkspaceCopy extends DesignerWorkspaceCopy {
  empty: string;
  create: string;
  createCanvas: string;
  use: string;
  remove: string;
  confirmRemove: string;
  sourceCount: string;
  outputCount: string;
  incompatible: string;
  mockup: string;
  sizes: string;
  mesh: string;
  surface: string;
}

export class TemplateWorkspaceAsyncState {
  active = false;
  useGeneration = 0;
  usingTemplate = false;
  pendingDeleteRequestId: number | undefined;

  enter(): void {
    this.active = true;
    this.useGeneration += 1;
  }

  leave(): void {
    this.active = false;
    this.useGeneration += 1;
    this.usingTemplate = false;
  }

  beginUse(): number {
    this.useGeneration += 1;
    this.usingTemplate = true;
    return this.useGeneration;
  }

  acceptsUse(generation: number): boolean {
    return this.active && generation === this.useGeneration;
  }

  finishUse(generation: number): boolean {
    if (generation !== this.useGeneration) return false;
    this.usingTemplate = false;
    return true;
  }

  beginDelete(requestId: number): void {
    this.pendingDeleteRequestId = requestId;
  }

  finishDelete(mutation: TemplateMutationReceipt | undefined): boolean {
    if (
      mutation?.kind !== "delete" ||
      mutation.requestId !== this.pendingDeleteRequestId
    ) return false;
    this.pendingDeleteRequestId = undefined;
    return true;
  }

  busy(): boolean {
    return this.usingTemplate || this.pendingDeleteRequestId !== undefined;
  }
}

export function createTemplateWorkspace(input: {
  root: HTMLElement;
  copy(): TemplateWorkspaceCopy;
  onBack(): void;
  onCreate(target: "mockup" | "canvas"): void;
  onUse(template: FigmaTaskTemplate): boolean;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
}): DesignerTaskWorkspace {
  const shell = createDesignerWorkspaceShell(input.root);
  shell.root.classList.add("template-workspace");
  shell.inspector.hidden = true;
  const list = document.createElement("div");
  list.className = "template-list";
  shell.preview.replaceChildren(list);
  const footerElement = shell.root.querySelector<HTMLElement>(".designer-footer");
  if (!footerElement) throw new Error("Missing Template footer");
  const footer: HTMLElement = footerElement;

  let templates: SavedSpatialTemplate[] = [];
  let source: DesignerWorkspaceSource | undefined;
  let selectedId: string | undefined;
  let confirmingDelete = false;
  const asyncState = new TemplateWorkspaceAsyncState();
  let nextDeleteRequestId = 1;

  shell.back.addEventListener("click", input.onBack);
  shell.apply.addEventListener("click", () => void useSelected());
  shell.reset.addEventListener("click", removeSelected);

  function selected(): SavedSpatialTemplate | undefined {
    return templates.find((template) => template.id === selectedId);
  }

  function render(): void {
    if (!asyncState.active) return;
    const copy = input.copy();
    shell.setCopy({ ...copy, apply: copy.use, reset: confirmingDelete ? copy.confirmRemove : copy.remove });
    list.replaceChildren();
    if (templates.length === 0) {
      const empty = document.createElement("div");
      empty.className = "template-empty";
      const label = document.createElement("p");
      label.textContent = copy.empty;
      const createMockup = document.createElement("button");
      createMockup.type = "button";
      createMockup.className = "primary";
      createMockup.textContent = copy.create;
      createMockup.addEventListener("click", () => input.onCreate("mockup"));
      const createCanvas = document.createElement("button");
      createCanvas.type = "button";
      createCanvas.textContent = copy.createCanvas;
      createCanvas.addEventListener("click", () => input.onCreate("canvas"));
      const availability = taskWorkspaceAvailability(source?.sources.length ?? 0);
      createMockup.hidden = !availability.mockup;
      createCanvas.hidden = !availability.canvas;
      empty.append(label, createMockup, createCanvas);
      list.append(empty);
      footer.hidden = true;
      return;
    }
    footer.hidden = false;
    for (const template of templates) {
      const count = templateSourceCount(template.template);
      const compatible = source?.sources.length === count;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "template-item";
      button.dataset.templateId = template.id;
      button.setAttribute("aria-pressed", String(template.id === selectedId));
      button.innerHTML = `<span class="template-item-name"></span><span class="template-item-detail"></span>`;
      const name = button.querySelector<HTMLElement>(".template-item-name");
      const detail = button.querySelector<HTMLElement>(".template-item-detail");
      if (!name || !detail) throw new Error("Missing Template item labels");
      name.textContent = template.name;
      const kind = templateKindLabel(template.template.operation.kind, copy);
      const size = template.template.operation.kind === "canvas"
        ? copy.outputCount.replace("{count}", String(templateOutputCount(template.template) ?? 0))
        : copy.sourceCount.replace("{count}", String(count));
      detail.textContent = `${kind} · ${size}`;
      if (!compatible) button.title = copy.incompatible.replace("{count}", String(count));
      button.addEventListener("click", () => {
        selectedId = template.id;
        confirmingDelete = false;
        shell.showError();
        render();
      });
      list.append(button);
    }
    const selectedRecord = selected();
    const count = selectedRecord ? templateSourceCount(selectedRecord.template) : 0;
    const busy = asyncState.busy();
    shell.apply.disabled =
      busy || !selectedRecord || !source || count !== source.sources.length;
    shell.reset.disabled = busy || !selectedRecord;
    if (selectedRecord && source && count !== source.sources.length) {
      shell.apply.title = copy.incompatible.replace("{count}", String(count));
    } else {
      shell.apply.removeAttribute("title");
    }
  }

  async function useSelected(): Promise<void> {
    const record = selected();
    if (!asyncState.active || !record || !source || asyncState.busy()) {
      return;
    }
    const count = templateSourceCount(record.template);
    if (count !== source.sources.length) {
      shell.showError(input.copy().incompatible.replace("{count}", String(count)));
      return;
    }
    const generation = asyncState.beginUse();
    render();
    try {
      if (!asyncState.acceptsUse(generation)) return;
      if (record.template.operation.kind === "mockup") {
        const plan = await planMockup(record.template.operation.spec);
        if (!asyncState.acceptsUse(generation)) return;
        if (new Set(plan.planes.map((plane) => plane.sourceId)).size !== count) {
          throw new Error("The saved template is not compatible with this workspace");
        }
      }
      if (!input.onUse(record.template)) {
        throw new Error("The saved template is not compatible with this workspace");
      }
      shell.showError();
    } catch (error) {
      if (!asyncState.acceptsUse(generation)) return;
      shell.showError(input.formatError(error));
    } finally {
      if (asyncState.finishUse(generation)) {
        render();
      }
    }
  }

  function removeSelected(): void {
    const record = selected();
    if (!asyncState.active || !record || asyncState.busy()) return;
    if (!confirmingDelete) {
      confirmingDelete = true;
      render();
      return;
    }
    confirmingDelete = false;
    const requestId = nextDeleteRequestId;
    nextDeleteRequestId += 1;
    asyncState.beginDelete(requestId);
    render();
    input.post({ type: "delete-template", requestId, id: record.id });
  }

  return {
    enter() { asyncState.enter(); shell.root.hidden = false; render(); },
    leave() {
      asyncState.leave();
      shell.root.hidden = true;
      confirmingDelete = false;
    },
    setSource(next) { source = next; render(); },
    clearSource(error) { source = undefined; if (asyncState.active) shell.showError(error); render(); },
    updateLocale() { render(); },
    handleMainMessage(message: MainToUiMessage) {
      if (message.type === "template-library") {
        templates = structuredClone(message.templates);
        if (!templates.some((template) => template.id === selectedId)) {
          selectedId = templates[0]?.id;
        }
        confirmingDelete = false;
        if (asyncState.finishDelete(message.mutation)) {
          if (asyncState.active) shell.showError();
        }
        render();
        return true;
      }
      if (message.type === "template-library-error") {
        if (asyncState.finishDelete(message.mutation)) {
          if (asyncState.active) shell.showError(input.formatError(message.message));
        } else if (!message.mutation && asyncState.active) {
          shell.showError(input.formatError(message.message));
        }
        render();
        return true;
      }
      return false;
    },
    handleKeydown(event) {
      if (event.key !== "Escape") return false;
      if (confirmingDelete) {
        confirmingDelete = false;
        render();
      } else input.onBack();
      return true;
    },
    dispose() {},
  };
}

function templateKindLabel(
  kind: FigmaTaskTemplate["operation"]["kind"],
  copy: TemplateWorkspaceCopy,
): string {
  if (kind === "canvas") return copy.sizes;
  if (kind === "mesh") return copy.mesh;
  if (kind === "surface") return copy.surface;
  return copy.mockup;
}
