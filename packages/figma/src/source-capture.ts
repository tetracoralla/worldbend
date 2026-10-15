import type { SourceCaptureFacts } from "@worldbend/web/types";
import { pngRasterDimensions } from "./png-dimensions";

/** Read-only snapshot for an owned native Content plane. Arbitrary selections
 * keep their visible appearance; only the owning result requests this view. */
export function nativeCaptureSnapshot(source: FrameNode) {
  const box = source.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) throw new Error("Source has no visible bounds");
  return {
    logicalSize: { width: source.width, height: source.height },
    logicalToCaptureSpace: source.absoluteTransform.map(row => [...row]) as [[number,number,number],[number,number,number]],
    captureOrigin: { x: box.x, y: box.y },
    box: { ...box },
  };
}

export function nativeCaptureFacts(source: FrameNode, before: ReturnType<typeof nativeCaptureSnapshot>, bytes: Uint8Array, scale: number): SourceCaptureFacts {
  if (source.removed || JSON.stringify(nativeCaptureSnapshot(source)) !== JSON.stringify(before)) throw new Error("Source changed during capture");
  const { box: _box, ...facts } = before;
  return { ...facts, captureScale: scale, pixelSize: pngRasterDimensions(bytes), convention: "fixedDensityFromOrigin" };
}
