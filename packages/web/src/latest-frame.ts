/** At most one running computation and one replaceable pending request. */
export function latestFrame<T>(compute: () => Promise<T | undefined>, publish: (value: T) => void, report: (error: unknown) => void) {
  let generation = 0;
  let disposed = false;
  let running = false;
  let frame: number | undefined;
  let pending: ((applied: boolean) => void) | undefined;
  let active: ((applied: boolean) => void) | undefined;
  const failure = (error: unknown) => {
    try { report(error); } catch (callbackError) { queueMicrotask(() => { throw callbackError; }); }
  };
  const invalidate = () => {
    generation++;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pending?.(false); active?.(false); pending = undefined;
  };
  const start = () => {
    if (!disposed && !running && pending && frame === undefined) {
      frame = requestAnimationFrame(() => { frame = undefined; void apply(); });
    }
  };
  const apply = async () => {
    const resolve = pending;
    if (!resolve || disposed) return;
    pending = undefined;
    active = resolve;
    const current = generation;
    running = true;
    try {
      const value = await compute();
      if (disposed || current !== generation || value === undefined) { resolve(false); return; }
      publish(value);
      resolve(true);
    } catch (error) {
      resolve(false);
      if (!disposed && current === generation) {
        failure(error);
      }
    } finally { running = false; active = undefined; start(); }
  };
  return {
    request(): Promise<boolean> {
      generation++;
      active?.(false);
      pending?.(false);
      if (disposed) return Promise.resolve(false);
      const promise = new Promise<boolean>(resolve => { pending = resolve; });
      start();
      return promise;
    },
    reject(error: unknown): Promise<boolean> {
      if (!disposed) { invalidate(); failure(error); }
      return Promise.resolve(false);
    },
    dispose() {
      disposed = true;
      invalidate();
    },
  };
}
