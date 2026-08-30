import { describe, expect, it, vi } from "vitest";
import {
  createFrameCoalescer,
  createLatestAsyncQueue,
  createLatestFrameCoalescer,
  type FrameScheduler,
} from "./frame-coalescer";

function controlledFrames(): {
  scheduler: FrameScheduler;
  fire(): void;
  cancel: ReturnType<typeof vi.fn>;
} {
  let callback: FrameRequestCallback | undefined;
  const cancel = vi.fn(() => {
    callback = undefined;
  });
  return {
    scheduler: {
      request(next) {
        callback = next;
        return 7;
      },
      cancel,
    },
    fire() {
      const next = callback;
      callback = undefined;
      next?.(0);
    },
    cancel,
  };
}

describe("frame coalescer", () => {
  it("renders only the latest state from a burst of pointer samples", () => {
    const frames = controlledFrames();
    const rendered: number[] = [];
    let latest = 0;
    const coalescer = createFrameCoalescer(() => rendered.push(latest), frames.scheduler);

    latest = 1;
    coalescer.request();
    latest = 2;
    coalescer.request();
    latest = 3;
    coalescer.request();

    expect(coalescer.pending()).toBe(true);
    frames.fire();
    expect(rendered).toEqual([3]);
    expect(coalescer.pending()).toBe(false);

    // Pointer-up can carry a newer coordinate than the last pointermove.
    latest = 4;
    coalescer.request();
    coalescer.flush();
    expect(rendered).toEqual([3, 4]);
  });

  it("flushes the final pointer sample before a gesture commits", () => {
    const frames = controlledFrames();
    const run = vi.fn();
    const coalescer = createFrameCoalescer(run, frames.scheduler);

    coalescer.request();
    coalescer.flush();

    expect(frames.cancel).toHaveBeenCalledWith(7);
    expect(run).toHaveBeenCalledTimes(1);
    frames.fire();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("drops a scheduled sample when the source session is replaced", () => {
    const frames = controlledFrames();
    const run = vi.fn();
    const coalescer = createFrameCoalescer(run, frames.scheduler);

    coalescer.request();
    coalescer.cancel();
    frames.fire();

    expect(frames.cancel).toHaveBeenCalledWith(7);
    expect(run).not.toHaveBeenCalled();
    expect(coalescer.pending()).toBe(false);
  });

  it("keeps the exact final value paired with its post-release policy", () => {
    const frames = controlledFrames();
    const rendered: Array<{ value: number; settleViewport: boolean }> = [];
    const coalescer = createLatestFrameCoalescer(
      (sample: { value: number; settleViewport: boolean }) => rendered.push(sample),
      frames.scheduler,
    );

    coalescer.request({ value: 1, settleViewport: false });
    coalescer.request({ value: 2, settleViewport: false });
    coalescer.request({ value: 3, settleViewport: true });
    coalescer.flush();

    expect(rendered).toEqual([{ value: 3, settleViewport: true }]);
  });

  it("runs one async preview at a time and preserves the exact newest sample", async () => {
    const releases: Array<() => void> = [];
    const started: number[] = [];
    const queue = createLatestAsyncQueue(async (value: number) => {
      started.push(value);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    queue.request(1);
    queue.request(2);
    queue.request(3);
    expect(started).toEqual([1]);

    releases.shift()?.();
    await vi.waitFor(() => expect(started).toEqual([1, 3]));
    expect(queue.pending()).toBe(true);

    releases.shift()?.();
    await queue.whenIdle();
    expect(started).toEqual([1, 3]);
    expect(queue.pending()).toBe(false);
  });

  it("drops a replaced session without losing work from the new session", async () => {
    let releaseFirst: (() => void) | undefined;
    const started: string[] = [];
    const queue = createLatestAsyncQueue(async (value: string) => {
      started.push(value);
      if (value === "old") await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });

    queue.request("old");
    queue.request("discarded");
    queue.cancel();
    queue.request("new");
    releaseFirst?.();
    await queue.whenIdle();

    expect(started).toEqual(["old", "new"]);
  });

  it("does not let a following gesture replace an exact final sample", async () => {
    const releases: Array<() => void> = [];
    const started: Array<{ value: number; final: boolean }> = [];
    const queue = createLatestAsyncQueue(
      async (sample: { value: number; final: boolean }) => {
        started.push(sample);
        await new Promise<void>((resolve) => releases.push(resolve));
      },
      { preserve: (sample) => sample.final },
    );

    queue.request({ value: 1, final: false });
    queue.request({ value: 2, final: true });
    queue.request({ value: 3, final: false });
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started[1]).toEqual({ value: 2, final: true });
    queue.request({ value: 4, final: false });
    releases.shift()?.();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(started[2]).toEqual({ value: 4, final: false });
    releases.shift()?.();
    await queue.whenIdle();
  });

  it("preserves every final boundary across several fast gestures", async () => {
    let releaseRunning: (() => void) | undefined;
    const started: Array<{ value: number; final: boolean }> = [];
    const queue = createLatestAsyncQueue(
      async (sample: { value: number; final: boolean }) => {
        started.push(sample);
        if (sample.value === 1) {
          await new Promise<void>((resolve) => { releaseRunning = resolve; });
        }
      },
      { preserve: (sample) => sample.final },
    );

    queue.request({ value: 1, final: false });
    queue.request({ value: 2, final: false });
    queue.request({ value: 3, final: true });
    queue.request({ value: 4, final: false });
    queue.request({ value: 5, final: true });
    queue.request({ value: 6, final: false });
    queue.request({ value: 7, final: false });

    releaseRunning?.();
    await queue.whenIdle();

    expect(started).toEqual([
      { value: 1, final: false },
      { value: 3, final: true },
      { value: 5, final: true },
      { value: 7, final: false },
    ]);
  });

  it("continues after a failed final without reordering later boundaries", async () => {
    const started: number[] = [];
    const queue = createLatestAsyncQueue(
      async (sample: { value: number; final: boolean }) => {
        started.push(sample.value);
        if (sample.value === 2) throw new Error("failed final");
      },
      { preserve: (sample) => sample.final },
    );

    queue.request({ value: 1, final: true });
    queue.request({ value: 2, final: true });
    queue.request({ value: 3, final: true });
    await queue.whenIdle();

    expect(started).toEqual([1, 2, 3]);
  });

  it("matches the FIFO-final/latest-intermediate model for every six-sample pattern", async () => {
    for (let mask = 0; mask < 64; mask += 1) {
      let releaseRunning: (() => void) | undefined;
      const started: Array<{ value: number; final: boolean }> = [];
      const queue = createLatestAsyncQueue(
        async (sample: { value: number; final: boolean }) => {
          started.push(sample);
          if (sample.value === 0) {
            await new Promise<void>((resolve) => {
              releaseRunning = resolve;
            });
          }
        },
        { preserve: (sample) => sample.final },
      );
      const samples = Array.from({ length: 7 }, (_, value) => ({
        value,
        final: value > 0 && (mask & (1 << (value - 1))) !== 0,
      }));
      for (const sample of samples) queue.request(sample);

      const expected = [samples[0]];
      for (const sample of samples.slice(1)) {
        const last = expected.at(-1);
        if (last !== undefined && last.value !== 0 && !last.final) {
          expected[expected.length - 1] = sample;
        } else {
          expected.push(sample);
        }
      }

      releaseRunning?.();
      await queue.whenIdle();
      expect(started, `mask=${mask.toString(2).padStart(6, "0")}`).toEqual(expected);
    }
  });
});
