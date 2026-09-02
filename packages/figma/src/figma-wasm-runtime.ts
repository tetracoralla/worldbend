import generatedInit from "@worldbend/wasm-bindings";
import compressedWasm from "virtual:worldbend-figma-wasm-gzip";
import { decompressGzipBase64 } from "./wasm-compression";

export * from "@worldbend/wasm-bindings";

// The shared Web bridge exposes generic Template/Variation calls, while this
// size-bounded human carrier links only the Mockup planner it actually uses.
// Closed stubs preserve module linkage if another Web export is imported by
// the bundle; the task-native Figma workflow never routes through them.
export function spatial_template_inspect_json(): never {
  throw JSON.stringify({
    code: "E_SCHEMA",
    message: "Generic Spatial Template inspection is not included in this carrier build",
  });
}

export function variation_job_plan_json(): never {
  throw JSON.stringify({
    code: "E_SCHEMA",
    message: "Variation Job planning is not included in this carrier build",
  });
}

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
