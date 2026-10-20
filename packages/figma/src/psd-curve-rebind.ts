import type { DeformationWorkSpecInput } from "@worldbend/web";
import type { PsdCurveWorkPlanWire } from "./psd-curve-import";

/** Rebind an adopted PSD curve's work into the Figma editor's authoring space.
 *
 * The interop contract carries the adopted curve's placement in Photoshop
 * document pixels (`Trnf` in PSD pixel space with the document as the
 * reference), while Figma-authored works use a normalized destination quad
 * and main-thread publication validates exactly that shape. Divide the pixel
 * quad by the PSD document size and drop the pixel reference; the controls
 * are already normalized by their own bounding box, so only the outer
 * transform needs the conversion. Without the rebind, every later Apply is
 * rejected by the main thread's normalized-space validation and the panel
 * stalls on "Applying…".
 */
export function rebindPsdCurveWorkToEditorSpace(plan: PsdCurveWorkPlanWire): DeformationWorkSpecInput {
  type QuadCorner = "tl" | "tr" | "br" | "bl";
  const work = structuredClone(plan.work) as unknown as DeformationWorkSpecInput & {
    transform?: { destination?: { space?: string; quad?: Record<QuadCorner, { x: number; y: number }>; reference?: unknown } };
  };
  const document = plan.source?.document;
  const destination = work.transform?.destination;
  if (
    destination?.space === "pixel" &&
    destination.quad &&
    document &&
    Number.isFinite(document.width) && document.width > 0 &&
    Number.isFinite(document.height) && document.height > 0
  ) {
    (destination as { space: string }).space = "normalized";
    // Normalized destinations carry no reference dimensions; the pixel
    // document size moves into the divided quad instead.
    delete (destination as { reference?: unknown }).reference;
    for (const corner of ["tl", "tr", "br", "bl"] as const) {
      destination.quad[corner].x /= document.width;
      destination.quad[corner].y /= document.height;
    }
  }
  return work;
}
