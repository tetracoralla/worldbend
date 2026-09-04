export interface WorkspaceHistory<T> {
  push(value: T): void;
  undo(): T | undefined;
  redo(): T | undefined;
  reset(value: T): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

const MAX_ENTRIES = 100;

/** A bounded, value-semantic history for task workspaces with plain-data specs. */
export function createWorkspaceHistory<T>(baseline: T): WorkspaceHistory<T> {
  let entries = [structuredClone(baseline)];
  let pointer = 0;
  return {
    push(value) {
      const next = structuredClone(value);
      if (JSON.stringify(entries[pointer]) === JSON.stringify(next)) return;
      entries = entries.slice(0, pointer + 1);
      entries.push(next);
      if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
      pointer = entries.length - 1;
    },
    undo() {
      if (pointer === 0) return undefined;
      pointer -= 1;
      return structuredClone(entries[pointer]!);
    },
    redo() {
      if (pointer >= entries.length - 1) return undefined;
      pointer += 1;
      return structuredClone(entries[pointer]!);
    },
    reset(value) {
      entries = [structuredClone(value)];
      pointer = 0;
    },
    canUndo: () => pointer > 0,
    canRedo: () => pointer < entries.length - 1,
  };
}
