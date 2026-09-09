import { latestFrame } from "./latest-frame";
import { emitCssTransform, projectPlanePose } from "./perspective-bridge";
import { perspectiveOwners as owners } from "./binding-ownership";
import type { CssTransform, PlanePose, TransformSpecInput } from "./types";

export interface Disposable {
  dispose(): void;
}

export interface AttachPerspectiveOptions {
  onError?: (error: unknown) => void;
}

export interface PerspectiveBinding<T> extends Disposable {
  /** Replace the complete input. False means invalid, hidden, disposed or superseded. */
  update(input: T): Promise<boolean>;
  /** Last successfully applied mapping; safe to save or reuse for raster export. */
  getSpec(): TransformSpecInput | undefined;
}

interface LayoutSize {
  width: number;
  height: number;
}

export function observedBorderBox(entry: ResizeObserverEntry): LayoutSize {
  const boxes = entry.borderBoxSize;
  const box = Array.isArray(boxes) ? boxes[0] : boxes;
  if (box) {
    const writingMode = getComputedStyle(entry.target).writingMode;
    const vertical = writingMode.startsWith("vertical") || writingMode.startsWith("sideways");
    return vertical
      ? { width: box.blockSize, height: box.inlineSize }
      : { width: box.inlineSize, height: box.blockSize };
  }

  // Older ResizeObserver implementations may omit borderBoxSize. contentRect
  // is still pre-transform, so reconstruct the physical border box without
  // consulting getBoundingClientRect(), which includes the transform we apply.
  const style = getComputedStyle(entry.target);
  const pixels = (value: string): number => Number.parseFloat(value) || 0;
  return {
    width:
      entry.contentRect.width +
      pixels(style.paddingLeft) +
      pixels(style.paddingRight) +
      pixels(style.borderLeftWidth) +
      pixels(style.borderRightWidth),
    height:
      entry.contentRect.height +
      pixels(style.paddingTop) +
      pixels(style.paddingBottom) +
      pixels(style.borderTopWidth) +
      pixels(style.borderBottomWidth),
  };
}

export function attachPerspective(
  element: HTMLElement,
  container: HTMLElement,
  spec: TransformSpecInput,
  options: AttachPerspectiveOptions = {},
): PerspectiveBinding<TransformSpecInput> {
  return bindPerspective(element, container, spec, async (value, source, destination) => ({
    spec: value,
    css: await emitCssTransform(value, source, destination),
  }), options);
}

/** Live tilt without hand-written matrix math. Ordinary CSS layout owns placement. */
export function attachPlanePose(
  element: HTMLElement,
  pose: PlanePose,
  options: AttachPerspectiveOptions = {},
): PerspectiveBinding<PlanePose> {
  return bindPerspective(element, element, pose, (value, size) =>
    projectPlanePose({ elementSize: size, pose: value }), options);
}

function bindPerspective<T>(
  element: HTMLElement,
  container: HTMLElement,
  initial: T,
  compute: (input: T, source: LayoutSize, destination: LayoutSize) => Promise<{
    spec: TransformSpecInput; css: CssTransform;
  }>,
  options: AttachPerspectiveOptions,
): PerspectiveBinding<T> {
  let input = structuredClone(initial);
  owners.get(element)?.dispose();
  const previous = ["transform", "transform-origin"].map((name) => ({
    name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
  }));
  let disposed = false;
  let lastSpec: TransformSpecInput | undefined;
  let elementSize: LayoutSize | undefined;
  let destinationSize: LayoutSize | undefined;

  const report = (error: unknown): void => {
    if (options.onError) options.onError(error);
    else element.dispatchEvent(new CustomEvent("worldbenderror", { detail: error }));
  };
  const queue = latestFrame(async () => {
    const source = elementSize;
    const destination = destinationSize;
    if (!source || !destination || source.width <= 0 || source.height <= 0 ||
        destination.width <= 0 || destination.height <= 0) return undefined;
    return compute(input, source, destination);
  }, (result) => {
    element.style.setProperty("transform", result.css.transform);
    element.style.setProperty("transform-origin", result.css.transformOrigin);
    lastSpec = structuredClone(result.spec);
  }, report);
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      // ResizeObserver box sizes are fractional layout boxes and deliberately
      // exclude CSS transforms. getBoundingClientRect() cannot be used here:
      // after the first update it would feed the applied perspective back in
      // as a new source size on the next container resize.
      const size = observedBorderBox(entry);
      if (entry.target === element) elementSize = size;
      if (entry.target === container) destinationSize = size;
    }
    if (elementSize && destinationSize) void queue.request();
  });
  observer.observe(container, { box: "border-box" });
  if (element !== container) observer.observe(element, { box: "border-box" });
  const binding: PerspectiveBinding<T> = {
    update(value) {
      if (disposed) return Promise.resolve(false);
      try { input = structuredClone(value); }
      catch (error) { return queue.reject(error); }
      return queue.request();
    },
    getSpec() { return lastSpec ? structuredClone(lastSpec) : undefined; },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.dispose();
      observer.disconnect();
      for (const { name, value, priority } of previous) {
        if (value) element.style.setProperty(name, value, priority);
        else element.style.removeProperty(name);
      }
      if (owners.get(element) === binding) owners.delete(element);
    },
  };
  owners.set(element, binding);
  return binding;
}
