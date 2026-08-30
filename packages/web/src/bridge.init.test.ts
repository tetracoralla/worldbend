import { describe, expect, it, vi } from "vitest";

vi.mock("@worldbend/wasm", () => ({
  default: vi.fn(),
  solve_json: vi.fn(),
  css_json: vi.fn(),
}));

import initWasm, { type InitOutput } from "@worldbend/wasm";
import { initializeWorldbend } from "./bridge";

describe("initializeWorldbend", () => {
  it("retries initialization after a failed attempt instead of caching the rejection", async () => {
    const init = vi.mocked(initWasm);
    init.mockRejectedValueOnce(new Error("wasm unavailable"));
    await expect(initializeWorldbend()).rejects.toThrow("wasm unavailable");
    init.mockResolvedValue({} as InitOutput);
    await expect(initializeWorldbend()).resolves.toBeUndefined();
    expect(init).toHaveBeenCalledTimes(2);
  });
});
