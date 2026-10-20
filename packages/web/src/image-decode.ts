const DEFAULT_DECODE_TIMEOUT_MS = 5_000;

/**
 * Wait for an image to be decodable without trusting `decode()` alone.
 *
 * Some embedded webview builds never settle `HTMLImageElement.decode()` for
 * blob: URLs, which would hang an entire load flow. `load`/`error` events stay
 * authoritative; the timeout is a last-resort release so callers proceed and
 * surface any real problem through their own pixel checks.
 */
export async function awaitImageDecoded(
  image: HTMLImageElement,
  timeoutMs: number = DEFAULT_DECODE_TIMEOUT_MS,
): Promise<void> {
  if (image.complete && image.naturalWidth > 0) return;
  // A completed image with no intrinsic width has already failed. Its error
  // event may have fired before this helper was attached, so waiting for the
  // fallback timeout would only turn a known failure into a five-second stall.
  if (image.complete) throw new Error("The image could not be decoded");
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error("The image could not be decoded"));
    };
    const onLoad = (): void => finish(true);
    const onError = (): void => finish(false);
    // The timeout must release, not fail: a genuinely broken image reports
    // through the error event, and a still-incomplete one is caught by the
    // caller's naturalWidth checks.
    const timer = setTimeout(() => finish(true), timeoutMs);
    image.addEventListener("load", onLoad, { once: true });
    image.addEventListener("error", onError, { once: true });
    if (typeof image.decode === "function") {
      image.decode().then(() => finish(true), () => undefined);
    }
  });
}
