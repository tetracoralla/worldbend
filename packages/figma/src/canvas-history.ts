import { cloneCanvasDraft, type CanvasDraft } from "./canvas-state";

export interface CanvasHistory {
  push(draft: CanvasDraft): void;
  undo(): CanvasDraft | undefined;
  redo(): CanvasDraft | undefined;
  reset(draft: CanvasDraft): void;
  current(): CanvasDraft;
  canUndo(): boolean;
  canRedo(): boolean;
}

const MAX_ENTRIES = 100;

export function createCanvasHistory(baseline: CanvasDraft): CanvasHistory {
  let entries = [cloneCanvasDraft(baseline)];
  let pointer = 0;
  return {
    push(draft) {
      const next = cloneCanvasDraft(draft);
      if (JSON.stringify(entries[pointer]) === JSON.stringify(next)) return;
      entries = entries.slice(0, pointer + 1);
      entries.push(next);
      if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
      pointer = entries.length - 1;
    },
    undo() {
      if (pointer === 0) return undefined;
      pointer -= 1;
      return cloneCanvasDraft(entries[pointer]!);
    },
    redo() {
      if (pointer >= entries.length - 1) return undefined;
      pointer += 1;
      return cloneCanvasDraft(entries[pointer]!);
    },
    reset(draft) {
      entries = [cloneCanvasDraft(draft)];
      pointer = 0;
    },
    current: () => cloneCanvasDraft(entries[pointer]!),
    canUndo: () => pointer > 0,
    canRedo: () => pointer < entries.length - 1,
  };
}
