// Pure editor-state predicates shared by the Figma UI wiring and its tests.
// They encode the two promotion-gate behaviors that must not regress: mode
// switching bakes geometry without rasterizing, and an untouched published
// result can still be undone in the host without ending the editing session.

import type { DistortInteractionMode } from "@worldbend/web";

export type Phase = "idle" | "loading" | "ready" | "resetting" | "applying" | "applied";
export type EditorMode = "transform" | "distort" | "warp" | "rectify";
export type DistortMode = DistortInteractionMode;

/**
 * A new selection clears the UI-owned validity before the editor renders it.
 * The editor emits validity only on an edge, so a successful render must also
 * restore validity explicitly when its internal state was already true.
 */
export function validityAfterSourceLoad(
  currentValidity: boolean,
  renderCompleted: boolean,
): boolean {
  return currentValidity || renderCompleted;
}

export interface ModeSwitchState {
  nextMode: EditorMode;
  currentMode: EditorMode;
  hasEditor: boolean;
  hasFrame: boolean;
  valid: boolean;
  phase: Phase;
  composeInFlight: boolean;
  refreshInFlight: boolean;
}

/**
 * A mode switch may only bake the live spec into the next operation when the
 * editor is fully interactive: the switch itself performs no rasterization,
 * so an in-flight compose or selection refresh must land first.
 */
export function canSwitchEditorMode(state: ModeSwitchState): boolean {
  return (
    state.nextMode !== state.currentMode &&
    state.hasEditor &&
    state.hasFrame &&
    state.valid &&
    state.phase === "ready" &&
    !state.composeInFlight &&
    !state.refreshInFlight
  );
}

/**
 * A Transform gesture may only capture a pointer from the last committed
 * composition. A queued release boundary is still part of the preceding
 * gesture, even if the current async worker has just yielded between jobs.
 */
export function canStartTransformGesture(state: {
  composeInFlight: boolean;
  previewQueuePending: boolean;
}): boolean {
  return !state.composeInFlight && !state.previewQueuePending;
}

export interface AppliedUndoShortcutState {
  phase: Phase;
  appliedResultPending: boolean;
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  alreadyRouted: boolean;
}

/**
 * After Apply completes, an unmodified Cmd/Ctrl+Z routes to the Figma host so
 * one host Undo step removes the result. Apply is non-terminal: the editor
 * stays ready, and the caller disarms this route as soon as a local edit is
 * made. Shift variants and repeats stay with the plugin.
 */
export function shouldRouteAppliedUndo(state: AppliedUndoShortcutState): boolean {
  return (
    (state.phase === "ready" || state.phase === "applied") &&
    state.appliedResultPending &&
    !state.alreadyRouted &&
    !state.shiftKey &&
    (state.metaKey || state.ctrlKey) &&
    state.key.toLowerCase() === "z"
  );
}

export interface PluginHistoryShortcutState {
  phase: Phase;
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * While an editing session is live, the standard undo shortcut stays inside
 * the plugin and steps the plugin-local history instead of the host document.
 */
export function shouldUndoInPlugin(state: PluginHistoryShortcutState): boolean {
  return (
    state.phase === "ready" &&
    !state.shiftKey &&
    (state.metaKey || state.ctrlKey) &&
    state.key.toLowerCase() === "z"
  );
}

/** Redo is Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y while the session is live. */
export function shouldRedoInPlugin(state: PluginHistoryShortcutState): boolean {
  if (state.phase !== "ready" || !(state.metaKey || state.ctrlKey)) return false;
  const key = state.key.toLowerCase();
  return (state.shiftKey && key === "z") || key === "y";
}

export interface SessionActionState {
  phase: Phase;
  key: string;
  /** Focus sits in a control that owns Enter or Space natively. */
  targetOwnsKey: boolean;
  /** A popover menu is open and owns Escape/Enter semantics. */
  popoverOpen: boolean;
}

/** Enter applies the session unless a field or open menu owns the keystroke. */
export function shouldApplyOnEnter(state: SessionActionState): boolean {
  return (
    state.phase === "ready" &&
    state.key === "Enter" &&
    !state.targetOwnsKey &&
    !state.popoverOpen
  );
}

/** Escape cancels the whole editing session back to its loaded state. */
export function shouldCancelOnEscape(state: SessionActionState): boolean {
  return state.phase === "ready" && state.key === "Escape" && !state.popoverOpen;
}

/**
 * Holding space pans the preview. The guard skips form controls so keyboard
 * activation of focused buttons keeps working.
 */
export function shouldHoldSpacePan(state: {
  phase: Phase;
  key: string;
  targetOwnsKey: boolean;
}): boolean {
  return state.phase === "ready" && state.key === " " && !state.targetOwnsKey;
}

export type PreviewZoomCommand = "in" | "out" | "fit" | "actual";

/**
 * The preview keeps zoom off the persistent toolbar, while retaining the
 * standard editor shortcuts when the canvas rather than a form field owns the
 * keystroke: Cmd/Ctrl +/- zooms, 0 fits, and 1 restores 100%.
 */
export function previewZoomCommand(state: {
  phase: Phase;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  targetOwnsKey: boolean;
}): PreviewZoomCommand | undefined {
  if (
    state.phase !== "ready" ||
    state.targetOwnsKey ||
    !(state.metaKey || state.ctrlKey)
  ) {
    return undefined;
  }
  if (state.key === "+" || state.key === "=") return "in";
  if (state.key === "-" || state.key === "_") return "out";
  if (state.key === "0") return "fit";
  if (state.key === "1") return "actual";
  return undefined;
}
