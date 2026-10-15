import { describe, expect, it, vi } from "vitest";
import { createLocalePreferenceSettings } from "./locale-preference";

function deferredStorage() {
  const writes: Array<{ record: unknown; resolve: () => void; reject: (error: Error) => void }> = [];
  const storage = {
    read: vi.fn(async () => undefined),
    write: vi.fn(
      (record: unknown) =>
        new Promise<void>((resolve, reject) => {
          writes.push({ record, resolve, reject });
        }),
    ),
  };
  return { storage, writes };
}

describe("locale preference persistence", () => {
  it("reads a stored versioned preference and falls back to system", async () => {
    const failing = createLocalePreferenceSettings({
      read: vi.fn(async () => Promise.reject(new Error("storage unavailable"))),
      write: vi.fn(),
    });
    await expect(failing.readStoredPreference()).resolves.toBe("system");

    const stored = createLocalePreferenceSettings({
      read: vi.fn(async () => ({ version: 1, locale: "zh-CN" })),
      write: vi.fn(),
    });
    await expect(stored.readStoredPreference()).resolves.toBe("zh-CN");

    const corrupt = createLocalePreferenceSettings({
      read: vi.fn(async () => ({ version: 99 })),
      write: vi.fn(),
    });
    await expect(corrupt.readStoredPreference()).resolves.toBe("system");
  });

  it("serializes queued writes in order", async () => {
    const { storage, writes } = deferredStorage();
    const settings = createLocalePreferenceSettings(storage);
    const onWriteFailed = vi.fn();

    settings.queueWrite("en", onWriteFailed);
    settings.queueWrite("zh-CN", onWriteFailed);
    await Promise.resolve(); // the queued chain starts the first write
    expect(writes.map((write) => write.record)).toEqual([{ version: 1, locale: "en" }]);
    expect(storage.write).toHaveBeenCalledTimes(1); // second write waits

    writes[0]!.resolve();
    await vi.waitFor(() => expect(storage.write).toHaveBeenCalledTimes(2));
    expect(writes[1]!.record).toEqual({ version: 1, locale: "zh-CN" });
  });

  it("reports a failure only for the latest queued write", async () => {
    const failures: string[] = [];
    const failing = createLocalePreferenceSettings({
      read: vi.fn(),
      write: vi.fn(() => Promise.reject(new Error("write failed"))),
    });
    failing.queueWrite("en", () => failures.push("en"));
    failing.queueWrite("zh-CN", () => failures.push("zh-CN"));
    await vi.waitFor(() => expect(failures).toEqual(["zh-CN"]));
  });
});
