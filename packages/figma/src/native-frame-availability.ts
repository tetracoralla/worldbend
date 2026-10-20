/** A core-confirmed affine frame needs no sampler. Existing sampled results
 * retain their carrier until an explicit migration is supported. */
export function nativeFrameAvailability(input: {
  renderer: boolean; rendererPending: boolean; corePending: boolean;
  coreKind?: "affine" | "projective"; legacyTarget: boolean;
}): { supported: boolean; preparing: boolean } {
  const affine = input.coreKind === "affine" && !input.legacyTarget;
  const supported = input.renderer || affine;
  return { supported, preparing: !supported && (input.rendererPending || input.corePending) };
}
