export interface PointerSessionBoundary {
  pointerId: number;
  /** A real release owns its final viewport coordinate. */
  onRelease(event: PointerEvent | MouseEvent): void;
  /** Focus/capture interruption keeps the last sample already shown. */
  onInterrupt(): void;
}

/**
 * Close a direct-manipulation session even when an embedded host retargets the
 * release away from the element that owns pointer capture. The window capture
 * listener handles ordinary retargeting; mouseup covers hosts that drop the
 * PointerEvent compatibility pair; blur/pagehide provide a last-visible-sample
 * recovery path when the release never crosses the iframe boundary at all.
 */
export function observePointerSessionBoundary(
  session: PointerSessionBoundary,
): () => void {
  if (typeof window === "undefined") return () => {};
  let active = true;

  const cleanup = (): void => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("blur", onInterrupted);
    window.removeEventListener("pagehide", onInterrupted);
  };
  const release = (event: PointerEvent | MouseEvent): void => {
    if (!active) return;
    cleanup();
    session.onRelease(event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== session.pointerId) return;
    release(event);
  };
  const onMouseUp = (event: MouseEvent): void => {
    // A primary mouse session has only one active pointer. Pointer-capable
    // browsers run onPointerUp first and remove this compatibility fallback.
    if (event.button !== 0) return;
    release(event);
  };
  const onInterrupted = (): void => {
    if (!active) return;
    cleanup();
    session.onInterrupt();
  };

  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("blur", onInterrupted);
  window.addEventListener("pagehide", onInterrupted);
  return cleanup;
}
