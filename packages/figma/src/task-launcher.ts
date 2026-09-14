import type { ProductWorkspace } from "./product-workspace";
import { createHorizontalStrip, type HorizontalStrip } from "./horizontal-strip";

export type LaunchableWorkspace = Exclude<ProductWorkspace, "perspective">;

export interface WorkspaceNavigation {
  setDisabled(disabled: boolean): void;
  setAvailability(available: Readonly<Record<LaunchableWorkspace, boolean>>): void;
  setCurrent(workspace: ProductWorkspace): void;
  setLabels(
    label: string,
    workspaces: Readonly<Record<ProductWorkspace, string>>,
    backwardLabel: string,
    forwardLabel: string,
  ): void;
  focusCurrent(): void;
  refresh(): void;
  dispose(): void;
}

export function taskWorkspaceAvailability(
  sourceCount: number,
): Readonly<Record<LaunchableWorkspace, boolean>> {
  return {
    templates: sourceCount >= 1 && sourceCount <= 8,
    canvas: sourceCount === 1,
    mesh: sourceCount === 1,
    surface: sourceCount === 1,
    mockup: sourceCount >= 1 && sourceCount <= 8,
    remap: sourceCount === 1 || sourceCount === 2,
  };
}

export function createWorkspaceNavigation(input: {
  root: HTMLElement;
  viewport: HTMLElement;
  backward: HTMLButtonElement;
  forward: HTMLButtonElement;
  secondaryControl: HTMLButtonElement;
  secondaryButtons: readonly HTMLButtonElement[];
  onChoose(workspace: ProductWorkspace): void;
}): WorkspaceNavigation {
  const buttons = Array.from(
    input.viewport.querySelectorAll<HTMLButtonElement>("[data-workspace]"),
  );
  let current: ProductWorkspace = "perspective";
  let disabled = true;
  let availability = taskWorkspaceAvailability(0);
  const strip: HorizontalStrip = createHorizontalStrip({
    viewport: input.viewport,
    backward: input.backward,
    forward: input.forward,
  });

  const render = (): void => {
    const requestedFocusableWorkspace = workspaceNavigationFocusableWorkspace(
      current,
      disabled,
      availability,
    );
    const focusableWorkspace = buttons.some(
      (button) => button.dataset.workspace === requestedFocusableWorkspace,
    ) ? requestedFocusableWorkspace : "perspective";
    for (const button of buttons) {
      const workspace = button.dataset.workspace as ProductWorkspace | undefined;
      if (!workspace) continue;
      const selected = workspace === current;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = workspace === focusableWorkspace ? 0 : -1;
      button.disabled = isWorkspaceNavigationDisabled(workspace, disabled, availability);
    }
    let secondaryActive = false;
    for (const button of input.secondaryButtons) {
      const workspace = button.dataset.workspace as ProductWorkspace | undefined;
      if (!workspace) continue;
      const selected = workspace === current;
      secondaryActive ||= selected;
      button.disabled = isWorkspaceNavigationDisabled(workspace, disabled, availability);
      if (selected) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    input.secondaryControl.dataset.active = String(secondaryActive);
    strip.refresh();
  };
  const onClick = (event: Event): void => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("[data-workspace]")
      : null;
    const workspace = target?.dataset.workspace as ProductWorkspace | undefined;
    if (!workspace || !target || target.disabled) return;
    input.onChoose(workspace);
  };
  const onKeydown = (event: KeyboardEvent): void => {
    const enabled = buttons.filter((button) => !button.disabled);
    if (enabled.length === 0) return;
    const focused = enabled.indexOf(document.activeElement as HTMLButtonElement);
    const next = workspaceNavigationTargetIndex(event.key, focused, enabled.length);
    if (next === undefined) return;
    event.preventDefault();
    enabled[next]?.focus();
  };
  input.viewport.addEventListener("click", onClick);
  input.viewport.addEventListener("keydown", onKeydown);
  for (const button of input.secondaryButtons) button.addEventListener("click", onClick);
  render();

  return {
    setDisabled(next) {
      disabled = next;
      render();
    },
    setAvailability(next) {
      availability = next;
      render();
    },
    setCurrent(next) {
      current = next;
      render();
      buttons.find((button) => button.dataset.workspace === next)?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    },
    setLabels(label, workspaces, backwardLabel, forwardLabel) {
      input.root.setAttribute("aria-label", label);
      input.backward.setAttribute("aria-label", backwardLabel);
      input.forward.setAttribute("aria-label", forwardLabel);
      for (const button of buttons) {
        const workspace = button.dataset.workspace as ProductWorkspace | undefined;
        if (!workspace) continue;
        const workspaceLabel = workspaces[workspace];
        button.setAttribute("aria-label", workspaceLabel);
        const name = button.querySelector<HTMLElement>(".workspace-name");
        if (name) name.textContent = workspaceLabel;
      }
      for (const button of input.secondaryButtons) {
        const workspace = button.dataset.workspace as ProductWorkspace | undefined;
        if (!workspace) continue;
        const workspaceLabel = workspaces[workspace];
        button.setAttribute("aria-label", workspaceLabel);
        const name = button.querySelector<HTMLElement>("[data-workspace-name]");
        if (name) name.textContent = workspaceLabel;
      }
    },
    focusCurrent() {
      queueMicrotask(() => {
        if (input.secondaryButtons.some((button) => button.dataset.workspace === current)) {
          input.secondaryControl.focus();
        } else {
          buttons.find((button) => button.tabIndex === 0)?.focus();
        }
      });
    },
    refresh: strip.refresh,
    dispose() {
      input.viewport.removeEventListener("click", onClick);
      input.viewport.removeEventListener("keydown", onKeydown);
      for (const button of input.secondaryButtons) button.removeEventListener("click", onClick);
      strip.dispose();
    },
  };
}

export function isWorkspaceNavigationDisabled(
  workspace: ProductWorkspace,
  temporarilyDisabled: boolean,
  availability: Readonly<Record<LaunchableWorkspace, boolean>>,
): boolean {
  // Perspective is the recovery workspace. It stays reachable while a source
  // refresh is in flight or the current task has lost its valid selection.
  return workspace !== "perspective" && (temporarilyDisabled || !availability[workspace]);
}

export function workspaceNavigationFocusableWorkspace(
  current: ProductWorkspace,
  temporarilyDisabled: boolean,
  availability: Readonly<Record<LaunchableWorkspace, boolean>>,
): ProductWorkspace {
  return isWorkspaceNavigationDisabled(current, temporarilyDisabled, availability)
    ? "perspective"
    : current;
}

export function workspaceNavigationTargetIndex(
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
