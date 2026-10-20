/** Optional live spatial-window carrier. */
import { createWindowBinding } from "./surface-window-binding";
import { planSurfaceWindow } from "./window-bridge";
import type { SurfaceWindowOptions, SurfaceWindowBinding } from "./surface-window-binding";
import type { WindowSource } from "./window-renderer";
import type { SurfaceWindowSpec } from "./generated/core-contract";
export { windowBackingSize } from "./surface-window-binding";
export function attachSurfaceWindow(canvas:HTMLCanvasElement,source:WindowSource,spec:SurfaceWindowSpec,options:SurfaceWindowOptions={}):SurfaceWindowBinding {
  return createWindowBinding(canvas,source,spec,options,undefined,planSurfaceWindow);
}
export type { SurfaceWindowOptions, SurfaceWindowBinding } from "./surface-window-binding";
export { planSurfaceWindow } from "./window-bridge";
export { TransformError } from "./transform-error";
export type { WindowSource } from "./window-renderer";
export type { SurfaceWindowSpec, SurfaceWindowPlan, SurfaceWindowMapping, SurfaceVisibility, WindowFrost } from "./generated/core-contract";
