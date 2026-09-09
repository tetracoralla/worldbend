import { attachPlanePose } from "./attach";
import { perspectiveOwners } from "./binding-ownership";
import type { AttachPerspectiveOptions, PerspectiveBinding } from "./attach";
import type { PlanePose } from "./types";

export interface PointerTiltOptions extends AttachPerspectiveOptions {
  /** Maximum additional X/Y rotations at the edges of the input surface, in degrees. */
  rangeX: number;
  rangeY: number;
}

/** Keep the input surface stable (normally the card's untransformed wrapper). */
export function attachPointerTilt(
  element: HTMLElement,
  surface: HTMLElement,
  pose: PlanePose,
  options: PointerTiltOptions,
): PerspectiveBinding<PlanePose> {
  if (![options.rangeX, options.rangeY].every(value => Number.isFinite(value) && value >= 0 && value <= 90)) {
    throw new RangeError("Pointer tilt ranges must be finite degrees in [0,90]");
  }
  let base = structuredClone(pose);
  const { rangeX, rangeY } = options;
  const binding = attachPlanePose(element, base, options);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const fine = matchMedia("(hover: hover) and (pointer: fine)");
  let x = 0;
  let y = 0;
  let disposed = false;
  const update = () => binding.update({
    ...base,
    rotateX: (base.rotateX ?? 0) - y * rangeX,
    rotateY: (base.rotateY ?? 0) + x * rangeY,
  });
  const reset = () => { x = 0; y = 0; void update(); };
  const move = (event: PointerEvent) => {
    if (reduced.matches || !fine.matches || event.pointerType === "touch") return;
    const box = surface.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
    y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
    void update();
  };
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerleave", reset);
  surface.addEventListener("pointercancel", reset);
  reduced.addEventListener("change", reset);
  fine.addEventListener("change", reset);
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  const controller: PerspectiveBinding<PlanePose> = {
    update(value) {
      if (disposed) return Promise.resolve(false);
      try { base = structuredClone(value); }
      catch { return binding.update(value); }
      return update();
    },
    getSpec: () => binding.getSpec(),
    dispose() {
      if (disposed) return;
      disposed = true;
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", reset);
      surface.removeEventListener("pointercancel", reset);
      reduced.removeEventListener("change", reset);
      fine.removeEventListener("change", reset);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", reset);
      binding.dispose();
      if (perspectiveOwners.get(element) === controller) perspectiveOwners.delete(element);
    },
  };
  perspectiveOwners.set(element, controller);
  return controller;
}
