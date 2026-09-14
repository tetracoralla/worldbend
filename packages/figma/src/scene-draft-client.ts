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
 * feedback, never an error surface. If a requested frame cannot be produced,
 * the previous frame is cleared rather than left behind as false WYSIWYG.
 */
export function createSceneDraftClient(input: {
  intervalMs?: number;
  render: () => Promise<SceneDraftFrame | undefined>;
  send: (frame: SceneDraftFrame) => void;
  clear: () => void;
}) {
  const intervalMs = input.intervalMs ?? 200;
  let generation = 0;
  let requestVersion = 0;
  let scheduledGeneration: number | undefined;
  let activeDelivery: { generation: number; version: number } | undefined;
  let lastSentAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function request(): void {
    requestVersion += 1;
    if (scheduledGeneration === generation || activeDelivery?.generation === generation) return;
    schedule();
  }

  function schedule(): void {
    const current = generation;
    scheduledGeneration = current;
    const wait = Math.max(0, intervalMs - (Date.now() - lastSentAt));
    timer = setTimeout(() => {
      void deliver(current);
    }, wait);
  }

  async function deliver(atGeneration: number): Promise<void> {
    if (scheduledGeneration === atGeneration) scheduledGeneration = undefined;
    timer = undefined;
    if (atGeneration !== generation) return;
    const delivery = { generation: atGeneration, version: requestVersion };
    activeDelivery = delivery;
    try {
      const frame = await input.render();
      if (atGeneration !== generation || delivery.version !== requestVersion) return;
      if (frame) {
        input.send(frame);
        lastSentAt = Date.now();
      } else input.clear();
    } catch {
      if (atGeneration === generation && delivery.version === requestVersion) input.clear();
    } finally {
      if (activeDelivery === delivery) activeDelivery = undefined;
      // A request that arrived during export is the latest state, not a burst
      // to discard. Render it on the trailing edge and suppress the stale frame.
      if (
        atGeneration === generation
        && delivery.version !== requestVersion
        && scheduledGeneration !== generation
        && activeDelivery?.generation !== generation
      ) schedule();
    }
  }

  function cancel(): void {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    scheduledGeneration = undefined;
  }

  return { request, cancel };
}
