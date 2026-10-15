import {
  shouldRedoInPlugin,
  shouldRouteAppliedUndo,
  shouldUndoInPlugin,
  type Phase,
} from "./editor-state";
import type { UiToMainMessage } from "./messages";

export interface WorkspaceHistoryLike<T> {
  undo(): T | undefined;
  redo(): T | undefined;
}

export function eventTargetEditsText(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  const owner = target.closest<HTMLElement>("input, textarea, [contenteditable='true']");
  if (!owner) return false;
  if (!(owner instanceof HTMLInputElement)) return true;
  return !["range", "checkbox", "radio", "color", "button", "submit", "reset"].includes(
    owner.type,
  );
}

/**
 * One recovery contract for every editable plugin workspace. Draft history is
 * local; after Apply, unmodified Undo is routed to Figma's document history.
 */
export function handleWorkspaceHistoryShortcut<T>(input: {
  event: KeyboardEvent;
  phase: Phase;
  appliedResultPending: boolean;
  undoRouted: boolean;
  history: WorkspaceHistoryLike<T> | undefined;
  post(message: UiToMainMessage): void;
  restore(value: T): void;
}): { handled: boolean; undoRouted: boolean } {
  const shortcut = {
    key: input.event.key,
    shiftKey: input.event.shiftKey,
    metaKey: input.event.metaKey,
    ctrlKey: input.event.ctrlKey,
  };
  if (shouldRouteAppliedUndo({
    ...shortcut,
    phase: input.phase,
    appliedResultPending: input.appliedResultPending,
    alreadyRouted: input.undoRouted,
  })) {
    input.event.preventDefault();
    input.post({ type: "trigger-undo" });
    return { handled: true, undoRouted: true };
  }
  if (eventTargetEditsText(input.event.target)) {
    return { handled: false, undoRouted: input.undoRouted };
  }
  const direction = shouldUndoInPlugin({ ...shortcut, phase: input.phase })
    ? "undo"
    : shouldRedoInPlugin({ ...shortcut, phase: input.phase })
      ? "redo"
      : undefined;
  if (!direction) return { handled: false, undoRouted: input.undoRouted };
  input.event.preventDefault();
  const restored = direction === "undo" ? input.history?.undo() : input.history?.redo();
  if (restored) input.restore(restored);
  return { handled: true, undoRouted: input.undoRouted };
}
