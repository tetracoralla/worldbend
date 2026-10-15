// Plugin-local edit history for one editing session. Each entry is a full
// editor state (mode, control values, gesture translation, and the base and
// active transform frames); restoring recomposes from that state so undo and
// redo never rasterize and never invent geometry the core did not produce.

import type { Point } from "@worldbend/web";
import type { DistortMode, EditorMode } from "./editor-state";
import type { TransformInputValues } from "./transform-controls";
import type { TransformFrame } from "./transform-frame";

export interface EditHistoryEntry {
  mode: EditorMode;
  distortMode: DistortMode;
  /** Whether Distort still uses the stable source frame and needs tight framing at an operation boundary. */
  distortFrameDirty: boolean;
  values: TransformInputValues;
  gestureTranslation: Point;
  flip: { x: boolean; y: boolean };
  pivot: Point;
  rectifyOutput?: { width: string; height: string };
  baseFrame: TransformFrame;
  activeFrame: TransformFrame;
}

export interface EditHistory {
  /** Start (or restart) a session from one baseline state. */
  resetToBaseline(entry: EditHistoryEntry): void;
  /** Record a committed edit, truncating any redo tail. */
  push(entry: EditHistoryEntry): void;
  /** Step back one entry and return the state to restore. */
  undo(): EditHistoryEntry | undefined;
  /** Step forward one entry and return the state to restore. */
  redo(): EditHistoryEntry | undefined;
  canUndo(): boolean;
  canRedo(): boolean;
  current(): EditHistoryEntry;
}

const MAX_ENTRIES = 100;

export function createEditHistory(baseline: EditHistoryEntry): EditHistory {
  let entries: EditHistoryEntry[] = [baseline];
  let pointer = 0;

  return {
    resetToBaseline(entry) {
      entries = [entry];
      pointer = 0;
    },
    push(entry) {
      if (sameEntry(entries[pointer], entry)) return;
      entries = entries.slice(0, pointer + 1);
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
      pointer = entries.length - 1;
    },
    undo() {
      if (pointer === 0) return undefined;
      pointer -= 1;
      return entries[pointer];
    },
    redo() {
      if (pointer >= entries.length - 1) return undefined;
      pointer += 1;
      return entries[pointer];
    },
    canUndo() {
      return pointer > 0;
    },
    canRedo() {
      return pointer < entries.length - 1;
    },
    current() {
      const entry = entries[pointer];
      if (!entry) throw new Error("Edit history is empty");
      return entry;
    },
  };
}

function sameEntry(left: EditHistoryEntry | undefined, right: EditHistoryEntry): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Coalesces a field/gesture commit request until its asynchronous composition
 * has produced the matching active frame. A failed or superseded composition
 * clears the request instead of recording new controls with old geometry.
 */
export interface DeferredEditCommit {
  request(): void;
  clear(): void;
  flush(): boolean;
  isPending(): boolean;
}

export function createDeferredEditCommit(commit: () => void): DeferredEditCommit {
  let pending = false;
  return {
    request() {
      pending = true;
    },
    clear() {
      pending = false;
    },
    flush() {
      if (!pending) return false;
      pending = false;
      commit();
      return true;
    },
    isPending() {
      return pending;
    },
  };
}
