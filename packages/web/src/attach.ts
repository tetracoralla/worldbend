import { emitCssTransform } from "./bridge";
import type { TransformSpec } from "./types";

export interface Disposable {
  dispose(): void;
}

export interface AttachPerspectiveOptions {
  onError?: (error: unknown) => void;
}

interface LayoutSize {
  width: number;
  height: number;
}

function observedBorderBox(entry: ResizeObserverEntry): LayoutSize {
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
  spec: TransformSpec,
  options: AttachPerspectiveOptions = {},
): Disposable {
  const attachedSpec = structuredClone(spec);
  const previous = {
    transform: element.style.transform,
    transformOrigin: element.style.transformOrigin,
    width: element.style.width,
    height: element.style.height,
  };
  let generation = 0;
  let disposed = false;
  let elementSize: LayoutSize | undefined;
  let destinationSize: LayoutSize | undefined;
  const update = async (
    currentElementSize: LayoutSize,
    currentDestinationSize: LayoutSize,
  ): Promise<void> => {
    const current = ++generation;
    // Hidden or collapsed boxes have nothing to compose yet; stay quiet and
    // let the observer re-run once layout becomes real, instead of reporting
    // a size error for a not-yet-visible mount.
    if (
      currentElementSize.width <= 0 ||
      currentElementSize.height <= 0 ||
      currentDestinationSize.width <= 0 ||
      currentDestinationSize.height <= 0
    ) {
      return;
    }
    try {
      const css = await emitCssTransform(
        attachedSpec,
        currentElementSize,
        currentDestinationSize,
      );
      if (disposed || current !== generation) return;
      element.style.transform = css.transform;
      element.style.transformOrigin = css.transformOrigin;
    } catch (error) {
      if (disposed || current !== generation) return;
      if (options.onError) options.onError(error);
      else element.dispatchEvent(new CustomEvent("worldbenderror", { detail: error }));
    }
  };
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
    if (elementSize && destinationSize) void update(elementSize, destinationSize);
  });
  observer.observe(container, { box: "border-box" });
  if (element !== container) observer.observe(element, { box: "border-box" });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      observer.disconnect();
      Object.assign(element.style, previous);
    },
  };
}
