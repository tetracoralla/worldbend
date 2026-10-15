/** Exact in-memory ownership of native preparation nodes. No page/name scan,
 * source tags or original/user layers enter this registry. Main's synchronous
 * close hook runs while the SDK can still remove these owned resources. */
type TemporaryNode = { readonly removed: boolean; remove(): void };
interface TemporarySession { cancel(): void }
const sessions = new Set<TemporarySession>();
export function beginNativeTemporarySession() {
  const nodes = new Set<TemporaryNode>();
  let cancelled = false;
  const assertActive = () => {
    if (cancelled) throw Error("E_FIGMA_CANCELLED: native preparation session closed");
  };
  const session = {
    assertActive,
    track<T extends TemporaryNode>(node: T): T {
      nodes.add(node);
      if (cancelled) { if (!node.removed) node.remove(); assertActive(); }
      return node;
    },
    dispose() {
      // A failed cancellation still owns its exact remaining nodes. Do not
      // orphan them when an asynchronous caller reaches its finally block;
      // a subsequent cleanup can retry without scanning user content.
      if (cancelled && [...nodes].some(node => !node.removed)) return;
      sessions.delete(session); nodes.clear();
    },
    cancel() {
      cancelled = true;
      let failure: unknown;
      let failed = false;
      for (const node of [...nodes].reverse()) {
        try { if (!node.removed) node.remove(); } catch (error) { if (!failed) { failed = true; failure = error; } }
      }
      if (failed) throw failure;
      sessions.delete(session);
    },
  };
  sessions.add(session);
  return session;
}
export function cancelNativeTemporarySessions() {
  let failure: unknown;
  let failed = false;
  for (const session of [...sessions]) {
    try { session.cancel(); } catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed) throw failure;
}
