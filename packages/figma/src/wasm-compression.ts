/** Decode the carrier-owned gzip payload only when the shared WASM bridge is first used. */
export async function decompressGzipBase64(value: string): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This Figma runtime cannot decompress the embedded Worldbend engine");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const stream = new Blob([bytes.buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
