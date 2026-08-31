import generatedInit from "@worldbend/wasm-bindings";
import compressedWasm from "virtual:worldbend-figma-wasm-gzip";
import { decompressGzipBase64 } from "./wasm-compression";

export * from "@worldbend/wasm-bindings";

let decompressedWasm: Promise<Uint8Array> | undefined;

/**
 * Carrier-specific loading only: the engine and every semantic operation stay
 * in the generated Rust WASM module, while the single-file plugin stores that
 * module as gzip instead of paying base64 expansion on its raw bytes.
 */
export default async function initFigmaWasm(): ReturnType<typeof generatedInit> {
  try {
    const bytes = await (decompressedWasm ??= decompressGzipBase64(compressedWasm));
    return await generatedInit({ module_or_path: bytes });
  } catch (error) {
    decompressedWasm = undefined;
    throw error;
  }
}
