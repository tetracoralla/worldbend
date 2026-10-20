/** Focused entry point for live webpage planes; no editor or canvas UI. */
export { attachPerspective, attachPlanePose } from "./attach";
export { attachPointerTilt } from "./pointer-tilt";
export { attachPerspectiveStrip } from "./attach-strip";
export { attachCardController } from "./card";
export type { PerspectivePanel, PerspectiveStripBinding } from "./attach-strip";
export type { PointerTiltOptions } from "./pointer-tilt";
export type {
  CardController,
  CardControllerOptions,
  CardControllerState,
} from "./card";
export type { AttachPerspectiveOptions, PerspectiveBinding, Disposable } from "./attach";
export { projectPlanePose, projectPlaneStrip, emitCssTransform, initializeWorldbend, TransformError } from "./perspective-bridge";
export { projectCardPose, sampleCardPointer, sampleCardIdle, sampleCardTurn } from "./perspective-bridge";
export { normalizedSpec, unitQuad } from "./types";
export type { PlanePose, PlanePoseInput, PlanePoseOutput, PlaneStripInput, PlaneStripOutput, TransformSpec, TransformSpecInput, Quad, CssTransform, CardRig, CardView, CardFace, CardAction, CardTilt, CardGeometry, CardPoseInput, CardPoseOutput, CardPointerInput, CardPointerOutput, CardIdleInput, CardTurnInput, CardTurnOutput } from "./types";
