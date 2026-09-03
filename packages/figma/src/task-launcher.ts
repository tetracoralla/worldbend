import type { ProductWorkspace } from "./product-workspace";

export type LaunchableWorkspace = Exclude<ProductWorkspace, "perspective">;

export interface TaskLauncher {
  setDisabled(disabled: boolean): void;
  setAvailability(available: Readonly<Record<LaunchableWorkspace, boolean>>): void;
  setLabels(label: string, workspaces: Readonly<Record<LaunchableWorkspace, string>>): void;
  close(options?: { restoreFocus?: boolean }): void;
  dispose(): void;
}

export function taskWorkspaceAvailability(
  sourceCount: number,
): Readonly<Record<LaunchableWorkspace, boolean>> {
  return {
    templates: sourceCount >= 1 && sourceCount <= 8,
    canvas: sourceCount === 1,
    mesh: sourceCount === 1,
    mockup: sourceCount >= 1 && sourceCount <= 8,
    remap: sourceCount === 1 || sourceCount === 2,
  };
}

export function createTaskLauncher(input: {
  trigger: HTMLButtonElement;
  menu: HTMLElement;
  onChoose(workspace: LaunchableWorkspace): void;
}): TaskLauncher {
  const buttons = Array.from(
    input.menu.querySelectorAll<HTMLButtonElement>("[data-workspace]"),
  );
  let open = false;

  const setOpen = (next: boolean, restoreFocus = false): void => {
    open = next;
    input.menu.hidden = !next;
    input.trigger.setAttribute("aria-expanded", String(next));
    if (next) queueMicrotask(() => buttons.find((button) => !button.disabled)?.focus());
    else if (restoreFocus) queueMicrotask(() => input.trigger.focus());
  };
  const onTrigger = (): void => setOpen(!open, open);
  const onMenuClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-workspace]")
      : null;
    const workspace = target?.dataset.workspace as LaunchableWorkspace | undefined;
    if (!workspace) return;
    setOpen(false);
    input.onChoose(workspace);
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    const enabledButtons = buttons.filter((button) => !button.disabled);
    if (enabledButtons.length === 0) return;
    const current = enabledButtons.indexOf(document.activeElement as HTMLButtonElement);
    const next = taskMenuTargetIndex(event.key, current, enabledButtons.length);
    if (next === undefined) return;
    event.preventDefault();
    enabledButtons[next]?.focus();
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!open || !(event.target instanceof Node)) return;
    if (!input.menu.contains(event.target) && !input.trigger.contains(event.target)) {
      setOpen(false);
    }
  };

  input.trigger.addEventListener("click", onTrigger);
  input.menu.addEventListener("click", onMenuClick);
  input.menu.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerDown);

  return {
    setDisabled(disabled) {
      input.trigger.disabled = disabled;
      if (disabled) setOpen(false);
    },
    setAvailability(available) {
      for (const button of buttons) {
        const workspace = button.dataset.workspace as LaunchableWorkspace | undefined;
        if (workspace) button.disabled = !available[workspace];
      }
      if (open && !buttons.some((button) => !button.disabled)) setOpen(false);
    },
    setLabels(label, workspaces) {
      input.trigger.setAttribute("aria-label", label);
      input.menu.setAttribute("aria-label", label);
      const triggerTooltip = input.trigger.querySelector<HTMLElement>(".action-tooltip");
      if (triggerTooltip) triggerTooltip.textContent = label;
      for (const button of buttons) {
        const workspace = button.dataset.workspace as LaunchableWorkspace | undefined;
        if (!workspace) continue;
        const workspaceLabel = workspaces[workspace];
        button.setAttribute("aria-label", workspaceLabel);
        const tooltip = button.querySelector<HTMLElement>(".action-tooltip");
        if (tooltip) tooltip.textContent = workspaceLabel;
      }
    },
    close(options) {
      setOpen(false, options?.restoreFocus ?? false);
    },
    dispose() {
      input.trigger.removeEventListener("click", onTrigger);
      input.menu.removeEventListener("click", onMenuClick);
      input.menu.removeEventListener("keydown", onKeydown);
      document.removeEventListener("pointerdown", onPointerDown);
    },
  };
}

export function taskMenuTargetIndex(
  key: string,
  current: number,
  length: number,
): number | undefined {
  if (length < 1) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return current < 0 ? 0 : (current + 1) % length;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return current <= 0 ? length - 1 : current - 1;
  }
  return undefined;
}
