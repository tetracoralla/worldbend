export interface PointerSessionBoundary {
  pointerId: number;
  /** Only mouse/unknown host pointers may use the untyped mouseup fallback. */
  pointerType?: string;
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
  let mouseFallbackAmbiguous = false;

  const cleanup = (): void => {
    if (!active) return;
    active = false;
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("blur", onInterrupted);
    window.removeEventListener("pagehide", onInterrupted);
    doc?.removeEventListener?.("visibilitychange", onVisibilityChange);
  };
  const release = (event: PointerEvent | MouseEvent): void => {
    if (!active) return;
    cleanup();
    session.onRelease(event);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== session.pointerId) {
      // Other primary devices can emit delayed/grouped compatibility events.
      // Once mixed input is observed, untyped mouseup no longer identifies an
      // owner. Keep the matching pointer release/interruption authoritative.
      if (event.isPrimary !== false) mouseFallbackAmbiguous = true;
      return;
    }
    release(event);
  };
  const onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    if (mouseFallbackAmbiguous) return;
    // Mouse events carry no pointer identity. They cannot close a touch/pen
    // owner; its matching pointer release or interruption remains authoritative.
    if (session.pointerType && session.pointerType !== "mouse") return;
    // Pointer-capable browsers run matching pointerup first and remove this
    // fallback before its compatibility mouseup arrives.
    release(event);
  };
  const onInterrupted = (): void => {
    if (!active) return;
    cleanup();
    session.onInterrupt();
  };
  // A zero-button move can precede the real release in an embedded host. It
  // does not authorize hover edits or prove termination. If that release is
  // missing altogether, a new press by the same pointer retires the old owner
  // before the target begins its next gesture; another pointer cannot steal it.
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerId === session.pointerId && event.button === 0) onInterrupted();
    else if (event.pointerId !== session.pointerId && event.isPrimary !== false) mouseFallbackAmbiguous = true;
  };
  const onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === session.pointerId) onInterrupted();
  };
  const doc = typeof document === "undefined" ? undefined : document;
  const onVisibilityChange = (): void => {
    if (doc?.visibilityState === "hidden") onInterrupted();
  };

  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("blur", onInterrupted);
  window.addEventListener("pagehide", onInterrupted);
  doc?.addEventListener?.("visibilitychange", onVisibilityChange);
  return cleanup;
}
