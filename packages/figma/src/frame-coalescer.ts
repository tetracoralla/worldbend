// Collapse high-frequency pointer samples into one preview request per paint.
// The final sample can still be flushed synchronously on pointer-up so Apply
// never observes an older transform than the one the user just finished.

export interface FrameCoalescer {
  request(): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
}

export interface LatestFrameCoalescer<T> {
  request(value: T): void;
  flush(): void;
  cancel(): void;
  pending(): boolean;
}

export function createFrameCoalescer(
  run: () => void,
  scheduler: FrameScheduler = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  },
): FrameCoalescer {
  let frame: number | undefined;

  const invoke = (): void => {
    frame = undefined;
    run();
  };

  return {
    request() {
      if (frame !== undefined) return;
      frame = scheduler.request(invoke);
    },
    flush() {
      if (frame === undefined) return;
      scheduler.cancel(frame);
      invoke();
    },
    cancel() {
      if (frame === undefined) return;
      scheduler.cancel(frame);
      frame = undefined;
    },
    pending: () => frame !== undefined,
  };
}

/**
 * Coalesce a changing value while keeping the value and its release semantics
 * in one sample. This prevents a final pointer value from being rendered with
 * an earlier sample's camera/history policy.
 */
export function createLatestFrameCoalescer<T>(
  run: (value: T) => void,
  scheduler?: FrameScheduler,
): LatestFrameCoalescer<T> {
  let latest: T | undefined;
  const frames = createFrameCoalescer(() => {
    const value = latest;
    latest = undefined;
    if (value !== undefined) run(value);
  }, scheduler);

  return {
    request(value) {
      latest = value;
      frames.request();
    },
    flush: () => frames.flush(),
    cancel() {
      frames.cancel();
      latest = undefined;
    },
    pending: () => frames.pending(),
  };
}

export { createLatestAsyncQueue, type LatestAsyncQueue } from "./latest-async-queue";
