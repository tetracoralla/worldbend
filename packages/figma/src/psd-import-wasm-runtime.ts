import generatedInit from "@worldbend/psd-import-bindings";
import compressedWasm from "virtual:worldbend-psd-import-wasm-gzip";
import { decompressGzipBase64 } from "./wasm-compression";

export * from "@worldbend/psd-import-bindings";

let decompressedWasm: Promise<Uint8Array> | undefined;

/**
 * Lazy loader for the bounded PSD import module. The parser rides only in
 * this dedicated carrier payload; it is decompressed and instantiated on the
 * first import request, never at plugin startup.
 */
export default async function initPsdImportWasm(): ReturnType<typeof generatedInit> {
  try {
    const bytes = await (decompressedWasm ??= decompressGzipBase64(compressedWasm));
    return await generatedInit({ module_or_path: bytes });
  } catch (error) {
    decompressedWasm = undefined;
    throw error;
  }
}
