import type { SceneContextFrame } from "./messages";

/** Viewport mapping only: canonical geometry remains in the result image.
 * Native frames, offsets and rotation determine where its handles are shown. */
export function sceneContextCoordinates(frame: SceneContextFrame) {
  const [[a, b, tx], [c, d, ty]] = frame.resultTransform;
  const box = frame.placement;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 || box.width <= 0 || box.height <= 0 ||
    frame.resultWidth <= 0 || frame.resultHeight <= 0) throw new Error("Scene coordinates unavailable");
  return {
    project(point: { x: number; y: number }) {
      return { x: (a * point.x * frame.resultWidth + b * point.y * frame.resultHeight + tx - box.x) / box.width,
        y: (c * point.x * frame.resultWidth + d * point.y * frame.resultHeight + ty - box.y) / box.height };
    },
    unproject(point: { x: number; y: number }) {
      const x = point.x * box.width + box.x - tx, y = point.y * box.height + box.y - ty;
      return { x: (d * x - b * y) / determinant / frame.resultWidth, y: (a * y - c * x) / determinant / frame.resultHeight };
    },
  };
}
