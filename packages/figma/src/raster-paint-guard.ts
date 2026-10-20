import { sameJsonValue } from "./json-value";
import { isRecord, SHARED_NAMESPACE } from "./stored-plane";

export const SHARED_RASTER_PAINT_KEY = "rasterPaint";
const MAX_PROOF_BYTES = 32 * 1024;
type RasterPaintReader = Pick<RectangleNode, "fills" | "getSharedPluginData">;

/** Publication owns the image fill, while native opacity, effects, strokes,
 * placement and corners stay the designer's. Only the fills it would replace
 * need a durable edit guard. A native Duplicate retains this proof by value. */
export function rasterPaintsIntact(node: RasterPaintReader): boolean {
  const raw = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY);
  // Older results have no publication proof. Keep them usable, with a
  // read-to-write snapshot until their next successful publication adds one.
  if (!raw) return true;
  if (raw.length > MAX_PROOF_BYTES) return false;
  try {
    const proof: unknown = JSON.parse(raw);
    return isRecord(proof) && Object.keys(proof).length === 3 &&
      proof["schema"] === "worldbend.figma.raster-paint" && proof["version"] === "0.1" &&
      Array.isArray(proof["fills"]) && Array.isArray(node.fills) &&
      sameJsonValue(proof["fills"], node.fills);
  } catch { return false; }
}

export function captureRasterPaints(node: RasterPaintReader): string | undefined {
  return Array.isArray(node.fills) ? JSON.stringify(node.fills) : undefined;
}

export function rasterPaintsMatch(node: RasterPaintReader, snapshot: string | undefined): boolean {
  if (snapshot === undefined) return true;
  try { return Array.isArray(node.fills) && sameJsonValue(JSON.parse(snapshot), node.fills); }
  catch { return false; }
}

export function writeRasterPaintProof(node: RasterPaintReader & Pick<RectangleNode, "setSharedPluginData">): void {
  if (!Array.isArray(node.fills)) throw new Error("Unsupported raster paints");
  const raw = JSON.stringify({ schema: "worldbend.figma.raster-paint", version: "0.1", fills: node.fills });
  if (raw.length > MAX_PROOF_BYTES) throw new Error("Raster paint proof exceeds its limit");
  node.setSharedPluginData(SHARED_NAMESPACE, SHARED_RASTER_PAINT_KEY, raw);
}
