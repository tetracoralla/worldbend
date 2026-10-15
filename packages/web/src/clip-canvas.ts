import type { MockupClip, MockupClipPlan } from "./types";

/** Paint compound fills by union of their original regions. Coordinates have
 * already been projected by the core and are normalized to this canvas. */
export function paintClipMask(
  context: CanvasRenderingContext2D,
  clip: MockupClip | MockupClipPlan,
  canvas: { width: number; height: number },
): void {
  const generated = "bounds" in clip;
  const maximum = generated ? 2048 : 512;
  let total = 0;
  const point = (p: { x: number; y: number }) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (clip.contours.length < 1 || clip.contours.length > 8 ||
    clip.fillRule !== undefined && clip.fillRule !== "nonZero" && clip.fillRule !== "evenOdd" ||
    clip.contours.some(contour => !point(contour.start) || contour.segments.length < 2 ||
      contour.segments.length > (generated ? 2048 : 128) ||
      (total += contour.segments.length) > maximum || contour.segments.some(segment =>
        !point(segment.to) || (segment.kind !== "line" && (segment.kind !== "cubic" || !point(segment.c1) || !point(segment.c2)))))) {
    throw new Error("The shape mask has invalid or excessive contours");
  }
  const referenced = new Set<number>();
  if ((clip.regions?.length ?? 0) > 8 || clip.regions?.some(region =>
    region.fillRule !== undefined && region.fillRule !== "nonZero" && region.fillRule !== "evenOdd" ||
    region.contourIndices.length < 1 || region.contourIndices.length > clip.contours.length ||
    new Set(region.contourIndices).size !== region.contourIndices.length || region.contourIndices.some(index => {
      if (!Number.isInteger(index) || index < 0 || index >= clip.contours.length) return true;
      referenced.add(index); return false;
    })) || clip.regions?.length && referenced.size !== clip.contours.length) {
    throw new Error("The shape mask has invalid regions");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  const regions = clip.regions?.length ? clip.regions
    : [{ contourIndices: clip.contours.map((_, index) => index), fillRule: clip.fillRule ?? "nonZero" }];
  for (const region of regions) {
    const path = new Path2D();
    for (const index of region.contourIndices) {
      const contour = clip.contours[index]!;
      path.moveTo(contour.start.x * canvas.width, contour.start.y * canvas.height);
      for (const segment of contour.segments) {
        if (segment.kind === "line") path.lineTo(segment.to.x * canvas.width, segment.to.y * canvas.height);
        else path.bezierCurveTo(
          segment.c1.x * canvas.width, segment.c1.y * canvas.height,
          segment.c2.x * canvas.width, segment.c2.y * canvas.height,
          segment.to.x * canvas.width, segment.to.y * canvas.height,
        );
      }
      path.closePath();
    }
    context.fill(path, region.fillRule === "evenOdd" ? "evenodd" : "nonzero");
  }
}
