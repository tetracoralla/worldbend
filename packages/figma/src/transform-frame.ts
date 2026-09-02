import {
  normalizedSpec,
  unitQuad,
  type AffineComposition,
  type TransformSpec,
} from "@worldbend/web";
import type { Placement, SourcePayload } from "./messages";

export type TransformFrameErrorCode = "renderDimensionsInvalid" | "placementInvalid";

/** Typed placement failure so the UI maps reasons without matching prose. */
export class TransformFrameError extends Error {
  constructor(readonly code: TransformFrameErrorCode) {
    super(code);
  }
}

export interface TransformFrame {
  spec: TransformSpec;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
}

export function frameFromSource(payload: SourcePayload): TransformFrame {
  return {
    spec: payload.spec ?? normalizedSpec(unitQuad()),
    renderWidth: payload.renderWidth,
    renderHeight: payload.renderHeight,
    placement: { ...payload.placement },
  };
}

export function frameFromComposition(
  base: TransformFrame,
  composition: AffineComposition,
): TransformFrame {
  const renderWidth = Math.round(composition.canvas.size.width);
  const renderHeight = Math.round(composition.canvas.size.height);
  // The frame is logical geometry, not necessarily the final Figma image
  // resource. Output density is planned separately so a large placement may
  // remain intact while its raster is proportionally fitted to 4096 px.
  if (!isLogicalRenderAxis(renderWidth) || !isLogicalRenderAxis(renderHeight)) {
    throw new TransformFrameError("renderDimensionsInvalid");
  }
  const scaleX = base.placement.width / base.renderWidth;
  const scaleY = base.placement.height / base.renderHeight;
  const placement = {
    x: base.placement.x + composition.canvas.origin.x * scaleX,
    y: base.placement.y + composition.canvas.origin.y * scaleY,
    width: renderWidth * scaleX,
    height: renderHeight * scaleY,
  };
  if (!placementIsFinite(placement)) {
    throw new TransformFrameError("placementInvalid");
  }
  return {
    spec: composition.spec,
    renderWidth,
    renderHeight,
    placement,
  };
}

/**
 * Keep an in-progress transform attached when Figma reports that the selected
 * source or result moved or resized while the plugin was open.
 */
export function rebaseTransformFrame(
  previousInitial: TransformFrame,
  nextInitial: TransformFrame,
  current: TransformFrame,
): TransformFrame {
  const placementScaleX = nextInitial.placement.width / previousInitial.placement.width;
  const placementScaleY = nextInitial.placement.height / previousInitial.placement.height;
  const renderScaleX = nextInitial.renderWidth / previousInitial.renderWidth;
  const renderScaleY = nextInitial.renderHeight / previousInitial.renderHeight;
  const renderWidth = Math.max(1, Math.round(current.renderWidth * renderScaleX));
  const renderHeight = Math.max(1, Math.round(current.renderHeight * renderScaleY));
  if (!isLogicalRenderAxis(renderWidth) || !isLogicalRenderAxis(renderHeight)) {
    throw new TransformFrameError("renderDimensionsInvalid");
  }
  const placement = {
    x:
      nextInitial.placement.x +
      (current.placement.x - previousInitial.placement.x) * placementScaleX,
    y:
      nextInitial.placement.y +
      (current.placement.y - previousInitial.placement.y) * placementScaleY,
    width: current.placement.width * placementScaleX,
    height: current.placement.height * placementScaleY,
  };
  if (!placementIsFinite(placement)) {
    throw new TransformFrameError("placementInvalid");
  }
  return {
    spec: structuredClone(current.spec),
    renderWidth,
    renderHeight,
    placement,
  };
}

function isLogicalRenderAxis(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

function placementIsFinite(placement: Placement): boolean {
  return (
    Number.isFinite(placement.x) &&
    Number.isFinite(placement.y) &&
    Number.isFinite(placement.width) &&
    Number.isFinite(placement.height) &&
    placement.width > 0 &&
    placement.height > 0
  );
}
