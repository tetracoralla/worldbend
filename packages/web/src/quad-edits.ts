// Pure quad edit primitives shared by the interactive editor and its tests.
// Symmetric perspective is axis-selective. A horizontal gesture moves the
// dragged corner and mirrors only its same-row neighbour; a vertical gesture
// moves the dragged corner and mirrors only its same-column neighbour. The
// remaining two corners stay fixed. Applying deltas to the drag-start quad is
// important: axis capture or a Shift-mode change must never make an existing
// distortion jump to a newly inferred bounding box. Coordinates intentionally
// remain unbounded; the core, not the preview frame, owns geometric validity.

import { cloneQuad, type Point, type Quad } from "./types";

export type QuadCorner = "tl" | "tr" | "br" | "bl";
export type PerspectiveAxis = "horizontal" | "vertical";

const rowPartner: Record<QuadCorner, QuadCorner> = { tl: "tr", tr: "tl", br: "bl", bl: "br" };
const columnPartner: Record<QuadCorner, QuadCorner> = { tl: "bl", bl: "tl", tr: "br", br: "tr" };

/**
 * Capture one physical drag axis after a small screen-space dead zone.
 * Ties resolve horizontally and the result is intended to stay locked until
 * release, preventing ordinary mouse jitter from switching the linked pair.
 */
export function resolvePerspectiveAxis(
  delta: Point,
  deadZone = 4,
): PerspectiveAxis | undefined {
  const x = Math.abs(delta.x);
  const y = Math.abs(delta.y);
  if (Math.max(x, y) < deadZone) return undefined;
  return x >= y ? "horizontal" : "vertical";
}

/** Apply one captured-axis symmetric perspective edit. */
export function applySymmetricPerspective(
  quad: Quad,
  corner: QuadCorner,
  pointer: Point,
  axis: PerspectiveAxis,
): Quad {
  const start = quad[corner];
  const next = cloneQuad(quad);
  if (axis === "horizontal") {
    const partner = rowPartner[corner];
    const dx = pointer.x - start.x;
    next[corner] = { x: start.x + dx, y: start.y };
    next[partner] = { x: quad[partner].x - dx, y: quad[partner].y };
    return next;
  }
  const partner = columnPartner[corner];
  const dy = pointer.y - start.y;
  next[corner] = { x: start.x, y: start.y + dy };
  next[partner] = { x: quad[partner].x, y: quad[partner].y - dy };
  return next;
}

/**
 * Whether a point lies inside (or on the boundary of) a convex quad with
 * tl -> tr -> br -> bl corner order. Invalid quads are not sanitized here;
 * callers rely on the solved preview for validity reporting.
 */
export function quadContainsPoint(quad: Quad, point: Point): boolean {
  const points: Point[] = [quad.tl, quad.tr, quad.br, quad.bl];
  const orientation = signedArea(quad) >= 0 ? 1 : -1;
  for (const [a, b] of quadEdges(points)) {
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (cross * orientation < 0) return false;
  }
  return true;
}

/** Shortest distance from a point to the quad's outline, in the same units. */
export function pointToQuadOutlineDistance(quad: Quad, point: Point): number {
  const points: Point[] = [quad.tl, quad.tr, quad.br, quad.bl];
  let distance = Number.POSITIVE_INFINITY;
  for (const [a, b] of quadEdges(points)) {
    distance = Math.min(distance, pointToSegmentDistance(a, b, point));
  }
  return distance;
}

function quadEdges(points: Point[]): Array<[Point, Point]> {
  const edges: Array<[Point, Point]> = [];
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (a && b) edges.push([a, b]);
  }
  return edges;
}

export function pointToSegmentDistance(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function signedArea(quad: Quad): number {
  const points: Point[] = [quad.tl, quad.tr, quad.br, quad.bl];
  let sum = 0;
  for (const [a, b] of quadEdges(points)) {
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
