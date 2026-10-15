/** Figma can clip its nested plugin iframe without changing innerHeight.
 * Measure across iframe ancestors instead of assuming a title-bar height.
 * The root keeps its viewport size; only the working body shrinks, avoiding
 * feedback into the observed rectangle. */
export function observeHostVisibleViewport(): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const observer = new IntersectionObserver(entries => {
    const entry = entries[0];
    if (!entry || entry.intersectionRect.top > 1 || entry.intersectionRect.left > 1) return;
    const { width, height } = entry.intersectionRect;
    // Ignore a hidden/minimized iframe and transient developer-console crops.
    if (width < 280 || height < 200) return;
    document.body.style.setProperty("--wb-visible-width", `${Math.floor(width)}px`);
    document.body.style.setProperty("--wb-visible-height", `${Math.floor(height)}px`);
    document.dispatchEvent(new Event("host-visible-resize"));
  }, { threshold: Array.from({ length: 1001 }, (_, index) => index / 1000) });
  const measure = (): void => {
    // Resizing the iframe can preserve the intersection ratio, especially
    // horizontally. Re-observe to request its current visible rectangle.
    observer.unobserve(document.documentElement);
    observer.observe(document.documentElement);
  };
  measure();
  window.addEventListener("resize", measure);
  return () => { window.removeEventListener("resize", measure); observer.disconnect(); };
}

export function visibleViewportSize(): { width: number; height: number } {
  return { width: document.body.clientWidth, height: document.body.clientHeight };
}
