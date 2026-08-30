// Pure pointer-gesture to TransformRecipe math for the Figma transform mode.
// Everything operates on one GestureFrame captured at gesture start: the last
// affine composition (its matrix maps base destination pixels to raw output
// pixels), the tight output canvas, the base destination quad, and
// the recipe that produced them. Geometry stays owned by the Rust core; this
// module only derives the next recipe for it to compose.

import type { NineNumbers, Point, Quad, Size, TransformRecipe } from "@worldbend/web";
import type { TransformHandle } from "@worldbend/web";

/** Matched to the transform controls' numeric domain (0.1% to 1000%). */
export const MIN_GESTURE_SCALE = 0.001;
export const MAX_GESTURE_SCALE = 10;

/** Below this a scale ratio is treated as a flip attempt and clamped. */
const MIN_AXIS_RATIO = 0.01;

const GENTLE_SNAP_DEGREES = 3;
const HARD_SNAP_DEGREES = 15;
const QUARTER_TURN_DEGREES = 90;

export interface GestureFrame {
  /** Base destination pixels -> raw output pixels, row-major 3x3 affine. */
  matrix: NineNumbers;
  canvasOrigin: Point;
  /** Tight output canvas size in resolved destination pixels. */
  canvasSize: Size;
  /** Base destination quad in base pixels (before the recipe). */
  baseQuad: Quad;
  /** The recipe that was live when the gesture started. */
  recipe: TransformRecipe;
}

/** Translate the plane by the pointer drag delta, in base destination pixels. */
export function applyMoveGesture(
  frame: GestureFrame,
  startPointer: Point,
  pointer: Point,
): TransformRecipe {
  return {
    ...frame.recipe,
    translation: {
      x: frame.recipe.translation.x + (pointer.x - startPointer.x) * frame.canvasSize.width,
      y: frame.recipe.translation.y + (pointer.y - startPointer.y) * frame.canvasSize.height,
    },
  };
}

/**
 * Scale from a corner or edge handle. Corner handles scale both axes (or one
 * uniform radial factor); edge handles scale only their perpendicular axis.
 */
export function applyScaleGesture(
  frame: GestureFrame,
  handle: TransformHandle,
  pointer: Point,
  uniform: boolean,
): TransformRecipe {
  const anchor = handleAnchor(frame.baseQuad, handle);
  const pivot = pivotPoint(frame);
  const q = rawToBase(frame, toRaw(frame, pointer));
  let ratioX = axisRatio(q.x, pivot.x, anchor.x);
  let ratioY = axisRatio(q.y, pivot.y, anchor.y);
  const isCornerHandle = handle === "tl" || handle === "tr" || handle === "br" || handle === "bl";
  if (!isCornerHandle) {
    // Edge handles drive only their perpendicular axis.
    if (handle === "top" || handle === "bottom") ratioX = 1;
    else ratioY = 1;
  } else if (uniform) {
    // Uniform corner scaling follows the radial distance from the pivot.
    const anchorDistance = Math.hypot(anchor.x - pivot.x, anchor.y - pivot.y);
    const pointerDistance = Math.hypot(q.x - pivot.x, q.y - pivot.y);
    const factor = pointerDistance / Math.max(1e-9, anchorDistance);
    ratioX = factor;
    ratioY = factor;
  }
  return {
    ...frame.recipe,
    scale: {
      x: frame.recipe.scale.x * clampRatio(ratioX, frame.recipe.scale.x),
      y: frame.recipe.scale.y * clampRatio(ratioY, frame.recipe.scale.y),
    },
  };
}

/**
 * Rotate around the recipe pivot by the swept pointer angle. Shift snaps to
 * the 15-degree grid; free rotation gently snaps within 3 degrees of quarter
 * turns.
 */
export function applyRotateGesture(
  frame: GestureFrame,
  startPointer: Point,
  pointer: Point,
  shiftKey: boolean,
): TransformRecipe {
  const pivotRaw = applyAffine(frame.matrix, pivotPoint(frame));
  const start = toRaw(frame, startPointer);
  const end = toRaw(frame, pointer);
  const startAngle = Math.atan2(start.y - pivotRaw.y, start.x - pivotRaw.x);
  const endAngle = Math.atan2(end.y - pivotRaw.y, end.x - pivotRaw.x);
  const swept = ((endAngle - startAngle) * 180) / Math.PI;
  let degrees = frame.recipe.rotationDegrees + swept;
  if (shiftKey) {
    degrees = Math.round(degrees / HARD_SNAP_DEGREES) * HARD_SNAP_DEGREES;
  } else {
    const nearest = Math.round(degrees / QUARTER_TURN_DEGREES) * QUARTER_TURN_DEGREES;
    if (Math.abs(degrees - nearest) <= GENTLE_SNAP_DEGREES) degrees = nearest;
  }
  return { ...frame.recipe, rotationDegrees: normalizeDegrees(degrees) };
}

/**
 * Change the reference point while preserving the current affine geometry.
 * Pivot only determines where subsequent scale/rotate/skew operations anchor;
 * choosing it must not move an already transformed plane.
 */
export function changePivotWithoutMoving(
  frame: GestureFrame,
  pivot: Point,
): TransformRecipe {
  const previousPoint = pivotPoint(frame);
  const nextFrame: GestureFrame = {
    ...frame,
    recipe: { ...frame.recipe, pivot: { ...pivot } },
  };
  const nextPoint = pivotPoint(nextFrame);
  const delta = {
    x: previousPoint.x - nextPoint.x,
    y: previousPoint.y - nextPoint.y,
  };
  const [a, b, , c, d] = frame.matrix;
  return {
    ...frame.recipe,
    pivot: { ...pivot },
    translation: {
      x:
        frame.recipe.translation.x +
        (1 - a) * delta.x -
        b * delta.y,
      y:
        frame.recipe.translation.y -
        c * delta.x +
        (1 - d) * delta.y,
    },
  };
}

/** Drag the visible reference point and preserve the current output geometry. */
export function applyPivotGesture(
  frame: GestureFrame,
  pointer: Point,
): TransformRecipe {
  const point = rawToBase(frame, toRaw(frame, pointer));
  const bounds = quadBounds(frame.baseQuad);
  const pivot = {
    x: (point.x - bounds.minX) / Math.max(1e-9, bounds.maxX - bounds.minX),
    y: (point.y - bounds.minY) / Math.max(1e-9, bounds.maxY - bounds.minY),
  };
  return changePivotWithoutMoving(frame, pivot);
}

/** Current pivot location in normalized output-preview coordinates. */
export function pivotPreviewPoint(frame: GestureFrame): Point {
  const raw = applyAffine(frame.matrix, pivotPoint(frame));
  return {
    x: (raw.x - frame.canvasOrigin.x) / frame.canvasSize.width,
    y: (raw.y - frame.canvasOrigin.y) / frame.canvasSize.height,
  };
}

function handleAnchor(quad: Quad, handle: TransformHandle): Point {
  const midpoint = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  switch (handle) {
    case "tl":
      return quad.tl;
    case "tr":
      return quad.tr;
    case "br":
      return quad.br;
    case "bl":
      return quad.bl;
    case "top":
      return midpoint(quad.tl, quad.tr);
    case "right":
      return midpoint(quad.tr, quad.br);
    case "bottom":
      return midpoint(quad.br, quad.bl);
    case "left":
      return midpoint(quad.bl, quad.tl);
  }
}

/** The recipe pivot resolved against the base destination bounds, in pixels. */
export function pivotPoint(frame: GestureFrame): Point {
  const { minX, maxX, minY, maxY } = quadBounds(frame.baseQuad);
  return {
    x: minX + frame.recipe.pivot.x * (maxX - minX),
    y: minY + frame.recipe.pivot.y * (maxY - minY),
  };
}

function quadBounds(quad: Quad): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function axisRatio(value: number, pivotValue: number, anchorValue: number): number {
  const denominator = anchorValue - pivotValue;
  if (Math.abs(denominator) < 1e-9) return 1;
  return (value - pivotValue) / denominator;
}

function clampRatio(ratio: number, currentScale: number): number {
  // Crossing the pivot would mirror the plane; hold a small positive floor so
  // the composition surfaces a normal scale, never a silent flip.
  const positive = Math.max(ratio, MIN_AXIS_RATIO);
  return Math.min(
    Math.max(positive, MIN_GESTURE_SCALE / currentScale),
    MAX_GESTURE_SCALE / currentScale,
  );
}

function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -180) ? 180 : wrapped;
}

/** Wrap an angle into the signed half turn (-180, 180], the field domain. */
export function wrapDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return normalizeDegrees(degrees);
}

/** Normalized preview coordinates -> raw output pixels. */
export function toRaw(frame: GestureFrame, pointer: Point): Point {
  return {
    x: frame.canvasOrigin.x + pointer.x * frame.canvasSize.width,
    y: frame.canvasOrigin.y + pointer.y * frame.canvasSize.height,
  };
}

/** Raw output pixels -> base destination pixels through the inverted affine. */
export function rawToBase(frame: GestureFrame, point: Point): Point {
  const [a, b, tx, c, d, ty] = frame.matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) return point;
  const dx = point.x - tx;
  const dy = point.y - ty;
  return {
    x: (d * dx - b * dy) / determinant,
    y: (a * dy - c * dx) / determinant,
  };
}

function applyAffine(matrix: NineNumbers, point: Point): Point {
  return {
    x: matrix[0] * point.x + matrix[1] * point.y + matrix[2],
    y: matrix[3] * point.x + matrix[4] * point.y + matrix[5],
  };
}
