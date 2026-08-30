import { describe, expect, it, vi } from "vitest";

import { withTimeout } from "./async-timeout";

describe("bounded async operations", () => {
  it("returns a completed operation and clears its timer", async () => {
    vi.useFakeTimers();
    await expect(
      withTimeout(Promise.resolve("done"), 25, () => new Error("timed out")),
    ).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("rejects a stalled operation with the caller-owned error", async () => {
    vi.useFakeTimers();
    const stalled = new Promise<never>(() => {});
    const result = withTimeout(stalled, 25, () => new Error("timed out"));
    const rejection = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(25);
    await rejection;
    vi.useRealTimers();
  });
});
