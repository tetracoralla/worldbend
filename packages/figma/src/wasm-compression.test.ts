import { describe, expect, it } from "vitest";
import { decompressGzipBase64 } from "./wasm-compression";

describe("Figma embedded WASM compression", () => {
  it("restores the exact gzip payload bytes", async () => {
    const compressed =
      "H4sIAAAAAAAC/wvPL8pJSUrNS1FwTswrSyxWKCrNK8nMTQUAvEh/fhgAAAA=";
    await expect(decompressGzipBase64(compressed)).resolves.toEqual(
      new TextEncoder().encode("Worldbend Canvas runtime"),
    );
  });
});
