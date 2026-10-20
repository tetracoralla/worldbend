/** Read the actual PNG header; Figma's fractional bounds do not imply a
 * universal rounding rule for its exported raster dimensions. */
export function pngRasterDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24 || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value) ||
    ![73,72,68,82].every((value,index) => bytes[index + 12] === value)) throw new Error("Invalid exported PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height) throw new Error("Empty exported PNG");
  return { width, height };
}
