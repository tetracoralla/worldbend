import { describe, expect, it } from "vitest";
import {
  canStartTransformGesture,
  canSwitchEditorMode,
  previewZoomCommand,
  shouldApplyOnEnter,
  shouldCancelOnEscape,
  shouldHoldSpacePan,
  shouldRedoInPlugin,
  shouldRouteAppliedUndo,
  shouldUndoInPlugin,
  validityAfterSourceLoad,
} from "./editor-state";

const readySwitch = {
  hasEditor: true,
  hasFrame: true,
  valid: true,
  phase: "ready" as const,
  composeInFlight: false,
  refreshInFlight: false,
};

describe("source-load validity synchronization", () => {
  it("restores UI validity when an already-valid editor renders a new source", () => {
    expect(validityAfterSourceLoad(false, true)).toBe(true);
  });

  it("preserves the current invalid state when no render completes", () => {
    expect(validityAfterSourceLoad(false, false)).toBe(false);
  });
});

describe("mode-switch gating", () => {
  it("allows a ready interactive switch between transform and distort", () => {
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort" }))
      .toBe(true);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "warp", currentMode: "distort" }))
      .toBe(true);
  });

  it("rejects a redundant switch or a busy editor", () => {
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "distort", currentMode: "distort" }))
      .toBe(false);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", composeInFlight: true }))
      .toBe(false);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", refreshInFlight: true }))
      .toBe(false);
  });

  it("rejects a switch without an editor, frame, valid quad, or ready phase", () => {
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", hasEditor: false }))
      .toBe(false);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", hasFrame: false }))
      .toBe(false);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", valid: false }))
      .toBe(false);
    expect(canSwitchEditorMode({ ...readySwitch, nextMode: "transform", currentMode: "distort", phase: "applying" }))
      .toBe(false);
  });
});

describe("Transform gesture admission", () => {
  it("starts only from a fully committed preview boundary", () => {
    expect(canStartTransformGesture({ composeInFlight: false, previewQueuePending: false }))
      .toBe(true);
    expect(canStartTransformGesture({ composeInFlight: true, previewQueuePending: false }))
      .toBe(false);
    expect(canStartTransformGesture({ composeInFlight: false, previewQueuePending: true }))
      .toBe(false);
  });
});

describe("applied-state undo shortcut routing", () => {
  const shortcut = {
    key: "z",
    shiftKey: false,
    metaKey: true,
    ctrlKey: false,
    appliedResultPending: true,
    alreadyRouted: false,
  };

  it("routes an unmodified Cmd/Ctrl+Z while a fresh result is still pending host undo", () => {
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "applied" })).toBe(true);
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "ready" })).toBe(true);
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "applied", ctrlKey: true, metaKey: false }))
      .toBe(true);
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "ready", appliedResultPending: false }))
      .toBe(false);
  });

  it("keeps shift variants and repeats inside the plugin", () => {
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "applied", shiftKey: true })).toBe(false);
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "applied", alreadyRouted: true }))
      .toBe(false);
    expect(
      shouldRouteAppliedUndo({ ...shortcut, phase: "applied", key: "Z", shiftKey: true }),
    ).toBe(false);
  });

  it("ignores other keys and bare keystrokes", () => {
    expect(shouldRouteAppliedUndo({ ...shortcut, phase: "applied", key: "y" })).toBe(false);
    expect(
      shouldRouteAppliedUndo({ ...shortcut, phase: "applied", metaKey: false, ctrlKey: false }),
    ).toBe(false);
  });
});

describe("plugin-local history shortcuts", () => {
  const shortcut = {
    key: "z",
    shiftKey: false,
    metaKey: true,
    ctrlKey: false,
  };

  it("claims undo only while a ready session is live", () => {
    expect(shouldUndoInPlugin({ ...shortcut, phase: "ready" })).toBe(true);
    expect(shouldUndoInPlugin({ ...shortcut, phase: "ready", ctrlKey: true, metaKey: false }))
      .toBe(true);
    expect(shouldUndoInPlugin({ ...shortcut, phase: "applied" })).toBe(false);
    expect(shouldUndoInPlugin({ ...shortcut, phase: "ready", shiftKey: true })).toBe(false);
  });

  it("claims redo for shift-Z and Y variants in the ready phase", () => {
    expect(
      shouldRedoInPlugin({ ...shortcut, phase: "ready", key: "Z", shiftKey: true }),
    ).toBe(true);
    expect(shouldRedoInPlugin({ ...shortcut, phase: "ready", key: "y" })).toBe(true);
    expect(shouldRedoInPlugin({ ...shortcut, phase: "ready", key: "y", ctrlKey: true, metaKey: false }))
      .toBe(true);
    expect(shouldRedoInPlugin({ ...shortcut, phase: "ready" })).toBe(false);
    expect(shouldRedoInPlugin({ ...shortcut, phase: "ready", key: "a" })).toBe(false);
    expect(shouldRedoInPlugin({ ...shortcut, phase: "applied", key: "y" })).toBe(false);
  });
});

describe("session keyboard actions", () => {
  const session = {
    phase: "ready" as const,
    key: "Enter",
    targetOwnsKey: false,
    popoverOpen: false,
  };

  it("applies on Enter only outside form controls and menus", () => {
    expect(shouldApplyOnEnter(session)).toBe(true);
    expect(shouldApplyOnEnter({ ...session, targetOwnsKey: true })).toBe(false);
    expect(shouldApplyOnEnter({ ...session, popoverOpen: true })).toBe(false);
    expect(shouldApplyOnEnter({ ...session, phase: "applying" })).toBe(false);
  });

  it("ignores every other key for both session actions", () => {
    // Regression: without the key check any plain keystroke applied or
    // cancelled the whole session while the canvas held focus.
    for (const key of ["a", "Shift", "Tab", " ", "ArrowLeft", "Backspace"]) {
      expect(shouldApplyOnEnter({ ...session, key })).toBe(false);
      expect(shouldCancelOnEscape({ ...session, key })).toBe(false);
    }
  });

  it("cancels on Escape unless a menu owns it", () => {
    expect(shouldCancelOnEscape({ ...session, key: "Escape" })).toBe(true);
    expect(shouldCancelOnEscape({ ...session, key: "Escape", popoverOpen: true })).toBe(false);
    expect(shouldCancelOnEscape({ ...session, key: "Escape", phase: "applied" })).toBe(false);
  });

  it("holds space to pan only outside form controls", () => {
    expect(shouldHoldSpacePan({ phase: "ready", key: " ", targetOwnsKey: false })).toBe(true);
    expect(shouldHoldSpacePan({ phase: "ready", key: " ", targetOwnsKey: true })).toBe(false);
    expect(shouldHoldSpacePan({ phase: "ready", key: "Enter", targetOwnsKey: false }))
      .toBe(false);
  });
});

describe("preview zoom shortcuts", () => {
  const shortcut = {
    phase: "ready" as const,
    metaKey: true,
    ctrlKey: false,
    targetOwnsKey: false,
  };

  it("keeps standard zoom commands available without persistent zoom buttons", () => {
    expect(previewZoomCommand({ ...shortcut, key: "+" })).toBe("in");
    expect(previewZoomCommand({ ...shortcut, key: "=" })).toBe("in");
    expect(previewZoomCommand({ ...shortcut, key: "-" })).toBe("out");
    expect(previewZoomCommand({ ...shortcut, key: "0" })).toBe("fit");
    expect(previewZoomCommand({ ...shortcut, key: "1" })).toBe("actual");
  });

  it("does not steal zoom-like keys from fields or inactive sessions", () => {
    expect(previewZoomCommand({ ...shortcut, key: "+", targetOwnsKey: true }))
      .toBeUndefined();
    expect(previewZoomCommand({ ...shortcut, key: "+", phase: "loading" }))
      .toBeUndefined();
    expect(previewZoomCommand({ ...shortcut, key: "+", metaKey: false }))
      .toBeUndefined();
    expect(previewZoomCommand({ ...shortcut, key: "2" })).toBeUndefined();
  });
});
