import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitImageDecoded } from "./image-decode";

type Listener = (event: unknown) => void;

function fakeImage(options: {
  complete: boolean;
  naturalWidth: number;
  decode?: () => Promise<void>;
}): HTMLImageElement & { emit: (type: string) => void } {
  const listeners = new Map<string, Set<Listener>>();
  const image = {
    complete: options.complete,
    naturalWidth: options.naturalWidth,
    decode: options.decode ?? ((): Promise<void> => Promise.resolve()),
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      listeners.get(type)?.delete(listener);
    },
    emit: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener({});
    },
  };
  return image as unknown as HTMLImageElement & { emit: (type: string) => void };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("awaitImageDecoded", () => {
  it("returns immediately for an already-decoded image", async () => {
    const image = fakeImage({ complete: true, naturalWidth: 100 });
    await expect(awaitImageDecoded(image)).resolves.toBeUndefined();
  });

  it("rejects an already-failed image without waiting for a missed error event", async () => {
    const image = fakeImage({ complete: true, naturalWidth: 0 });
    await expect(awaitImageDecoded(image, 60_000)).rejects.toThrow(
      "The image could not be decoded",
    );
  });

  it("settles through the load event when decode() never resolves", async () => {
    // Regression guard: embedded webview builds can wedge decode() forever on
    // blob URLs; the load event must remain the authority.
    const image = fakeImage({
      complete: false,
      naturalWidth: 0,
      decode: () => new Promise<void>(() => {}),
    });
    const pending = awaitImageDecoded(image, 60_000);
    (image as unknown as { naturalWidth: number }).naturalWidth = 640;
    image.emit("load");
    await expect(pending).resolves.toBeUndefined();
  });

  it("rejects when the image fails to load", async () => {
    const image = fakeImage({
      complete: false,
      naturalWidth: 0,
      decode: () => new Promise<void>(() => {}),
    });
    const pending = awaitImageDecoded(image, 60_000);
    image.emit("error");
    await expect(pending).rejects.toThrow("The image could not be decoded");
  });

  it("releases through the timeout when no signal ever arrives", async () => {
    vi.useFakeTimers();
    try {
      const image = fakeImage({
        complete: false,
        naturalWidth: 0,
        decode: () => new Promise<void>(() => {}),
      });
      const pending = awaitImageDecoded(image, 1_000);
      vi.advanceTimersByTime(1_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not fail when decode() rejects after load already settled", async () => {
    const image = fakeImage({
      complete: false,
      naturalWidth: 0,
      // A decode() rejection racing an already-successful load must not turn
      // the wait into a failure.
      decode: () => Promise.reject(new Error("decode states disagree")),
    });
    const pending = awaitImageDecoded(image, 60_000);
    (image as unknown as { naturalWidth: number }).naturalWidth = 640;
    image.emit("load");
    await expect(pending).resolves.toBeUndefined();
  });
});
