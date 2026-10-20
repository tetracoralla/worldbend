import {
  PRODUCT_WORKSPACE_FAMILIES,
  type ProductWorkspace,
  type ProductWorkspaceFamily,
} from "./product-workspace";
import { createHorizontalStrip, type HorizontalStrip } from "./horizontal-strip";

export type LaunchableWorkspace = Exclude<ProductWorkspace, "perspective">;

export interface WorkspaceNavigation {
  setDisabled(disabled: boolean): void;
  setAvailability(available: Readonly<Record<LaunchableWorkspace, boolean>>): void;
  setCurrent(workspace: ProductWorkspace): void;
  setLabels(
    label: string,
    workspaces: Readonly<Record<ProductWorkspace, string>>,
    families: Readonly<Record<ProductWorkspaceFamily, string>>,
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
    spatial: sourceCount >= 2 && sourceCount <= 8,
    mesh: sourceCount === 1,
    surface: sourceCount === 1,
    mockup: sourceCount >= 1 && sourceCount <= 8,
    remap: sourceCount === 1 || sourceCount === 2,
    // Appearance reads the live selection itself; it must stay reachable for
    // effect-capable layers that never become raster sources.
    appearance: true,
    // Card pose authoring reads the live selection like Appearance.
    card: true,
    presets: true,
  };
}

/** One selected artwork, including a Group or Frame, starts in the direct
 * editor. Separate selected layers use the shared layout workspace, which
 * preserves their positions; this does not assign an effect to each layer. */
export function defaultWorkspaceForSourceCount(sourceCount: number): ProductWorkspace {
  return sourceCount > 1 && sourceCount <= 8 ? "mockup" : "perspective";
}

export function createWorkspaceNavigation(input: {
  root: HTMLElement;
  viewport: HTMLElement;
  backward: HTMLButtonElement;
  forward: HTMLButtonElement;
  onChoose(workspace: ProductWorkspace): void;
}): WorkspaceNavigation {
  const items = input.viewport.querySelector<HTMLElement>("#workspace-items");
  if (!items) throw new Error("Workspace navigation items are missing");
  for (const [family, workspaces] of Object.entries(PRODUCT_WORKSPACE_FAMILIES) as Array<[
    ProductWorkspaceFamily,
    readonly ProductWorkspace[],
  ]>) {
    const group = document.createElement("div");
    group.className = "workspace-group";
    group.dataset.workspaceFamily = family;
    group.setAttribute("role", "presentation");
    const label = document.createElement("span");
    label.className = "workspace-group-label";
    label.dataset.workspaceFamilyLabel = family;
    label.setAttribute("aria-hidden", "true");
    group.append(label);
    for (const workspace of workspaces) {
      const button = items.querySelector<HTMLButtonElement>(`[data-workspace="${workspace}"]`);
      if (!button) throw new Error(`Workspace navigation is missing ${workspace}`);
      group.append(button);
    }
    items.append(group);
  }
  const buttons = Array.from(
    input.viewport.querySelectorAll<HTMLButtonElement>("[data-workspace]"),
  );
  const compactNavigation = matchMedia("(max-width: 680px)");
  const renderOrientation = (): void => {
    items.setAttribute("aria-orientation", compactNavigation.matches ? "horizontal" : "vertical");
  };
  compactNavigation.addEventListener("change", renderOrientation);
  renderOrientation();
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
    strip.refresh();
  };
  const revealCurrent = (): void => {
    const button = buttons.find((item) => item.dataset.workspace === current);
    if (!button) return;
    const item = button.getBoundingClientRect();
    const viewport = input.viewport.getBoundingClientRect();
    if (item.left < viewport.left) input.viewport.scrollLeft += item.left - viewport.left;
    else if (item.right > viewport.right) input.viewport.scrollLeft += item.right - viewport.right;
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
  // The material chooser resizes the host asynchronously after selection.
  // Keep the current tool discoverable when that viewport actually changes.
  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(revealCurrent);
  resizeObserver?.observe(input.viewport);
  input.viewport.addEventListener("click", onClick);
  input.viewport.addEventListener("keydown", onKeydown);
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
      revealCurrent();
    },
    setLabels(label, workspaces, families, backwardLabel, forwardLabel) {
      input.root.setAttribute("aria-label", label);
      input.backward.setAttribute("aria-label", backwardLabel);
      input.forward.setAttribute("aria-label", forwardLabel);
      for (const familyLabel of input.viewport.querySelectorAll<HTMLElement>("[data-workspace-family-label]")) {
        const family = familyLabel.dataset.workspaceFamilyLabel as ProductWorkspaceFamily | undefined;
        if (family) familyLabel.textContent = families[family];
      }
      for (const button of buttons) {
        const workspace = button.dataset.workspace as ProductWorkspace | undefined;
        if (!workspace) continue;
        const workspaceLabel = workspaces[workspace];
        button.setAttribute("aria-label", workspaceLabel);
        const name = button.querySelector<HTMLElement>(".workspace-name");
        if (name) name.textContent = workspaceLabel;
      }
      // Label widths change with the locale; reveal the selected label again.
      strip.refresh();
      revealCurrent();
    },
    focusCurrent() {
      queueMicrotask(() => {
        buttons.find((button) => button.tabIndex === 0)?.focus({ preventScroll: true });
        revealCurrent();
      });
    },
    refresh: strip.refresh,
    dispose() {
      input.viewport.removeEventListener("click", onClick);
      input.viewport.removeEventListener("keydown", onKeydown);
      compactNavigation.removeEventListener("change", renderOrientation);
      resizeObserver?.disconnect();
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
