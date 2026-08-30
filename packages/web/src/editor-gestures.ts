// Pure routing types and predicates for the editor's transform-mode gestures.
// The editor owns pointer plumbing and overlay visuals; converting a gesture
// into a semantic recipe stays with the host so no second transform model
// appears inside the web package.

import { pointToQuadOutlineDistance, quadContainsPoint } from "./quad-edits";
import type { Quad } from "./types";

export type EditorInteractionMode = "distort" | "transform";

/** The eight Free Transform handles: four corners plus four edge midpoints. */
export type TransformHandle = "tl" | "tr" | "br" | "bl" | "top" | "right" | "bottom" | "left";

export type TransformGestureKind = "move" | "scale" | "rotate" | "pivot";

export type TransformGestureEvent =
  | {
      phase: "start";
      kind: TransformGestureKind;
      handle?: TransformHandle;
      /** Pointer position in normalized preview coordinates at gesture start. */
      pointer: { x: number; y: number };
      /** Quad in normalized preview coordinates at gesture start. */
      quad: Quad;
    }
  | {
      phase: "update";
      pointer: { x: number; y: number };
      shiftKey: boolean;
    }
  | {
      phase: "end";
      pointer: { x: number; y: number };
      shiftKey: boolean;
    };

export type GestureSurfaceZone = "none" | "move" | "rotate";

/** Display-pixel band outside the quad used to grab rotation. */
export const ROTATE_START_MARGIN_PX = 8;
export const ROTATE_END_MARGIN_PX = 56;

/**
 * Classify a pointer over the gesture surface (and not over a handle): inside
 * the quad moves it, a bounded band outside the quad rotates it, and both the
 * near-edge margin and far-away workspace stay inert. Distances are measured
 * in display pixels so wide and tall previews have the same grab target.
 */
export function classifySurfacePointer(input: {
  quad: Quad;
  pointer: { x: number; y: number };
  previewSize: { width: number; height: number };
  rotateMarginPx?: number;
  rotateEndMarginPx?: number;
}): GestureSurfaceZone {
  const startMargin = input.rotateMarginPx ?? ROTATE_START_MARGIN_PX;
  const endMargin = input.rotateEndMarginPx ?? ROTATE_END_MARGIN_PX;
  if (input.previewSize.width <= 0 || input.previewSize.height <= 0) return "none";
  if (quadContainsPoint(input.quad, input.pointer)) return "move";
  const toPixels = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: point.x * input.previewSize.width,
    y: point.y * input.previewSize.height,
  });
  const pixelQuad: Quad = {
    tl: toPixels(input.quad.tl),
    tr: toPixels(input.quad.tr),
    br: toPixels(input.quad.br),
    bl: toPixels(input.quad.bl),
  };
  const outline = pointToQuadOutlineDistance(pixelQuad, toPixels(input.pointer));
  return outline > startMargin && outline <= endMargin ? "rotate" : "none";
}
