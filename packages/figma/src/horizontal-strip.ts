export interface HorizontalStripState {
  overflow: boolean;
  canScrollBackward: boolean;
  canScrollForward: boolean;
}

export function horizontalStripState(input: {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): HorizontalStripState {
  const overflow = input.scrollWidth - input.clientWidth > 1;
  return {
    overflow,
    canScrollBackward: overflow && input.scrollLeft > 1,
    canScrollForward:
      overflow && input.scrollLeft + input.clientWidth < input.scrollWidth - 1,
  };
}

export interface HorizontalStrip {
  refresh(): void;
  dispose(): void;
}

/**
 * Adds quiet overflow affordances to a same-level horizontal control group.
 * Native trackpad/touch scrolling remains available; the arrows are an
 * explicit fallback and disappear when every item fits.
 */
export function createHorizontalStrip(input: {
  viewport: HTMLElement;
  backward: HTMLButtonElement;
  forward: HTMLButtonElement;
}): HorizontalStrip {
  const refresh = (): void => {
    const state = horizontalStripState(input.viewport);
    input.backward.hidden = !state.overflow;
    input.forward.hidden = !state.overflow;
    input.backward.disabled = !state.canScrollBackward;
    input.forward.disabled = !state.canScrollForward;
  };
  const scroll = (direction: -1 | 1): void => {
    const distance = Math.max(96, Math.round(input.viewport.clientWidth * 0.72));
    input.viewport.scrollBy({ left: direction * distance, behavior: "smooth" });
    requestAnimationFrame(refresh);
  };
  const backward = (): void => scroll(-1);
  const forward = (): void => scroll(1);
  const resizeObserver = typeof ResizeObserver === "undefined"
    ? undefined
    : new ResizeObserver(refresh);

  input.backward.addEventListener("click", backward);
  input.forward.addEventListener("click", forward);
  input.viewport.addEventListener("scroll", refresh, { passive: true });
  resizeObserver?.observe(input.viewport);
  queueMicrotask(refresh);

  return {
    refresh,
    dispose() {
      input.backward.removeEventListener("click", backward);
      input.forward.removeEventListener("click", forward);
      input.viewport.removeEventListener("scroll", refresh);
      resizeObserver?.disconnect();
    },
  };
}
