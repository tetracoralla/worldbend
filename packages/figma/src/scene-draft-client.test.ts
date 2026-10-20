import { afterEach, describe, expect, it, vi } from "vitest";
import { createSceneDraftClient } from "./scene-draft-client";

function frame(bytes: number) {
  return {
    bytes: new Uint8Array([bytes]),
    renderWidth: 10,
    renderHeight: 8,
    placement: { x: 0, y: 0, width: 10, height: 8 },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("scene draft client", () => {
  it("coalesces a request storm into one render per interval", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    const client = createSceneDraftClient({
      intervalMs: 200,
      render: async () => frame(sent.length + 1),
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => {},
    });
    client.request();
    client.request();
    client.request();
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toEqual([1]);
    // A burst at one moment still collapses into a single later frame.
    client.request();
    client.request();
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toEqual([1, 2]);
    // A request after a full interval delivers again.
    client.request();
    await vi.advanceTimersByTimeAsync(200);
    expect(sent).toEqual([1, 2, 3]);
  });

  it("drops queued and in-flight renders after cancel", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    let release: (() => void) | undefined;
    const client = createSceneDraftClient({
      intervalMs: 10,
      render: () => new Promise((resolve) => {
        release = () => resolve(frame(9));
      }),
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => {},
    });
    client.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(release).toBeDefined();
    client.cancel();
    release!();
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toEqual([]);
    // A fresh request after cancel still works.
    const client2 = createSceneDraftClient({
      intervalMs: 10,
      render: async () => frame(4),
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => {},
    });
    client2.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual([4]);
  });

  it("renders the latest trailing request instead of losing edits during export", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    let release: (() => void) | undefined;
    let renders = 0;
    const client = createSceneDraftClient({
      intervalMs: 10,
      render: () => {
        renders += 1;
        if (renders === 1) {
          return new Promise((resolve) => {
            release = () => resolve(frame(1));
          });
        }
        return Promise.resolve(frame(2));
      },
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => {},
    });
    client.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(release).toBeDefined();
    client.request();
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([2]);
    expect(renders).toBe(2);
  });

  it("swallows render failures so a skipped frame never interrupts editing", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    let cleared = 0;
    const client = createSceneDraftClient({
      intervalMs: 10,
      render: async () => {
        throw new Error("renderer unavailable");
      },
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => { cleared += 1; },
    });
    client.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual([]);
    expect(cleared).toBe(1);
    // The scheduler must be reusable after a failed frame.
    let delivered = false;
    const client2 = createSceneDraftClient({
      intervalMs: 10,
      render: async () => {
        delivered = true;
        return undefined;
      },
      send: () => {},
      clear: () => { cleared += 1; },
    });
    client2.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(delivered).toBe(true);
    expect(cleared).toBe(2);
  });

  it("skips sending when the renderer reports no frame", async () => {
    vi.useFakeTimers();
    const sent: number[] = [];
    let cleared = 0;
    const client = createSceneDraftClient({
      intervalMs: 10,
      render: async () => undefined,
      send: (value) => sent.push(value.bytes[0]!),
      clear: () => { cleared += 1; },
    });
    client.request();
    await vi.advanceTimersByTimeAsync(10);
    expect(sent).toEqual([]);
    expect(cleared).toBe(1);
  });
});
