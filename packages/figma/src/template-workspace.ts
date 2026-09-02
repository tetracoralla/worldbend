import {
  createDesignerWorkspaceShell,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import { planMockup } from "./designer-plan";
import type { MainToUiMessage, UiToMainMessage } from "./messages";
import {
  templateSourceCount,
  type FigmaSpatialTemplate,
  type SavedSpatialTemplate,
} from "./stored-template-library";

export interface TemplateWorkspaceCopy extends DesignerWorkspaceCopy {
  empty: string;
  create: string;
  use: string;
  remove: string;
  confirmRemove: string;
  sourceCount: string;
  incompatible: string;
}

export function createTemplateWorkspace(input: {
  root: HTMLElement;
  copy(): TemplateWorkspaceCopy;
  onBack(): void;
  onCreate(): void;
  onUse(template: FigmaSpatialTemplate): boolean;
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
  let active = false;
  let useGeneration = 0;
  let usingTemplate = false;
  let pendingDeleteRequestId: number | undefined;
  let nextDeleteRequestId = 1;

  shell.back.addEventListener("click", input.onBack);
  shell.apply.addEventListener("click", () => void useSelected());
  shell.reset.addEventListener("click", removeSelected);

  function selected(): SavedSpatialTemplate | undefined {
    return templates.find((template) => template.id === selectedId);
  }

  function render(): void {
    if (!active) return;
    const copy = input.copy();
    shell.setCopy({ ...copy, apply: copy.use, reset: confirmingDelete ? copy.confirmRemove : copy.remove });
    list.replaceChildren();
    if (templates.length === 0) {
      const empty = document.createElement("div");
      empty.className = "template-empty";
      const label = document.createElement("p");
      label.textContent = copy.empty;
      const create = document.createElement("button");
      create.type = "button";
      create.className = "primary";
      create.textContent = copy.create;
      create.addEventListener("click", input.onCreate);
      empty.append(label, create);
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
      detail.textContent = copy.sourceCount.replace("{count}", String(count));
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
    const busy = usingTemplate || pendingDeleteRequestId !== undefined;
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
    if (!active || !record || !source || usingTemplate || pendingDeleteRequestId !== undefined) {
      return;
    }
    const count = templateSourceCount(record.template);
    if (count !== source.sources.length) {
      shell.showError(input.copy().incompatible.replace("{count}", String(count)));
      return;
    }
    const generation = ++useGeneration;
    usingTemplate = true;
    render();
    try {
      const plan = await planMockup(record.template.operation.spec);
      if (!active || generation !== useGeneration) return;
      if (
        new Set(plan.planes.map((plane) => plane.sourceId)).size !== count ||
        !input.onUse(record.template)
      ) throw new Error("The saved template is not compatible with this workspace");
      shell.showError();
    } catch (error) {
      if (!active || generation !== useGeneration) return;
      shell.showError(input.formatError(error));
    } finally {
      if (generation === useGeneration) {
        usingTemplate = false;
        render();
      }
    }
  }

  function removeSelected(): void {
    const record = selected();
    if (!active || !record || usingTemplate || pendingDeleteRequestId !== undefined) return;
    if (!confirmingDelete) {
      confirmingDelete = true;
      render();
      return;
    }
    confirmingDelete = false;
    const requestId = nextDeleteRequestId;
    nextDeleteRequestId += 1;
    pendingDeleteRequestId = requestId;
    render();
    input.post({ type: "delete-template", requestId, id: record.id });
  }

  return {
    enter() { active = true; useGeneration += 1; shell.root.hidden = false; render(); },
    leave() {
      active = false;
      useGeneration += 1;
      usingTemplate = false;
      shell.root.hidden = true;
      confirmingDelete = false;
    },
    setSource(next) { source = next; render(); },
    clearSource(error) { source = undefined; if (active) shell.showError(error); render(); },
    updateLocale() { render(); },
    handleMainMessage(message: MainToUiMessage) {
      if (message.type === "template-library") {
        templates = structuredClone(message.templates);
        if (!templates.some((template) => template.id === selectedId)) {
          selectedId = templates[0]?.id;
        }
        confirmingDelete = false;
        if (
          message.mutation?.kind === "delete" &&
          message.mutation.requestId === pendingDeleteRequestId
        ) {
          pendingDeleteRequestId = undefined;
          if (active) shell.showError();
        }
        render();
        return true;
      }
      if (message.type === "template-library-error") {
        if (
          message.mutation?.kind === "delete" &&
          message.mutation.requestId === pendingDeleteRequestId
        ) {
          pendingDeleteRequestId = undefined;
          if (active) shell.showError(input.formatError(message.message));
        } else if (!message.mutation && active) {
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
