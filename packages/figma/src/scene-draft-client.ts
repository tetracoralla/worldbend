import type { Placement } from "./messages";

export interface SceneDraftFrame {
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
}

/**
 * Coalesced emitter for the live canvas draft. Editing storms schedule at
 * most one render per interval; a canceled generation drops any render that
 * is still queued or in flight. A failed render skips a frame — the draft is
 * feedback, never an error surface.
 */
export function createSceneDraftClient(input: {
  intervalMs?: number;
  render: () => Promise<SceneDraftFrame | undefined>;
  send: (frame: SceneDraftFrame) => void;
}) {
  const intervalMs = input.intervalMs ?? 200;
  let generation = 0;
  let scheduled = false;
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function request(): void {
    if (scheduled) return;
    scheduled = true;
    const current = ++generation;
    const wait = Math.max(0, intervalMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      void deliver(current);
    }, wait);
  }

  async function deliver(atGeneration: number): Promise<void> {
    try {
      if (atGeneration !== generation) return;
      const frame = await input.render();
      if (atGeneration !== generation) return;
      if (frame) {
        input.send(frame);
        lastSentAt = Date.now();
      }
    } catch {
      // A skipped draft frame must never interrupt editing.
    } finally {
      scheduled = false;
    }
  }

  function cancel(): void {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    scheduled = false;
  }

  return { request, cancel };
}
