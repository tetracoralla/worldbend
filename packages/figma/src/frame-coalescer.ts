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

export interface LatestAsyncQueue<T> {
  /** Start immediately when idle; retain ordered boundaries and the newest intermediate. */
  request(value: T): void;
  /** Drop queued work and prevent an older session from consuming newer values. */
  cancel(): void;
  pending(): boolean;
  whenIdle(): Promise<void>;
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

/**
 * Bound an asynchronous preview pipeline to one job in flight. Superseded
 * samples are discarded before they enter expensive core/render work, while
 * the newest (including pointer-up) sample is guaranteed a turn.
 */
export function createLatestAsyncQueue<T>(
  run: (value: T) => Promise<unknown>,
  options: { preserve?: (value: T) => boolean } = {},
): LatestAsyncQueue<T> {
  const pending: T[] = [];
  let running = false;
  let generation = 0;
  let idleResolvers: Array<() => void> = [];

  const resolveIdle = (): void => {
    if (running || pending.length > 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) resolve();
  };

  const pump = async (session: number): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (session === generation && pending.length > 0) {
        const value = pending.shift();
        if (value === undefined) continue;
        // Preview tasks own their user-visible error handling. A failed
        // obsolete sample must not wedge delivery of a newer final sample.
        await run(value).catch(() => undefined);
      }
    } finally {
      running = false;
      if (pending.length > 0) {
        void pump(generation);
      } else {
        resolveIdle();
      }
    }
  };

  return {
    request(value) {
      // Pointer-up is a semantic boundary, not an obsolete intermediate. Keep
      // every such boundary in order. Within the open segment after the newest
      // boundary, only the latest intermediate matters; a final replaces that
      // segment's waiting intermediate because it already contains its exact
      // release value.
      const last = pending.at(-1);
      if (last !== undefined && !options.preserve?.(last)) pending[pending.length - 1] = value;
      else pending.push(value);
      void pump(generation);
    },
    cancel() {
      generation += 1;
      pending.length = 0;
      resolveIdle();
    },
    pending: () => running || pending.length > 0,
    whenIdle() {
      if (!running && pending.length === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => idleResolvers.push(resolve));
    },
  };
}
