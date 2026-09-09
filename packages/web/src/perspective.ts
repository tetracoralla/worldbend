/** Focused entry point for live webpage planes; no editor or canvas UI. */
export { attachPerspective, attachPlanePose } from "./attach";
export { attachPointerTilt } from "./pointer-tilt";
export { attachPerspectiveStrip } from "./attach-strip";
export type { PerspectivePanel, PerspectiveStripBinding } from "./attach-strip";
export type { PointerTiltOptions } from "./pointer-tilt";
export type { AttachPerspectiveOptions, PerspectiveBinding, Disposable } from "./attach";
export { projectPlanePose, projectPlaneStrip, emitCssTransform, initializeWorldbend, TransformError } from "./perspective-bridge";
export { normalizedSpec, unitQuad } from "./types";
export type { PlanePose, PlanePoseInput, PlanePoseOutput, PlaneStripInput, PlaneStripOutput, TransformSpec, TransformSpecInput, Quad, CssTransform } from "./types";
