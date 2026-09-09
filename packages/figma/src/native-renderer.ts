/** Exact sampler build shipped with this plugin; never select an effect by name. */
export const BUNDLED_NATIVE_RENDERER = "20eff4c7-e099-4bf2-937b-1d83305c0851/610eb52f8eeb4810422bf37b504129cf83efa355";
const LEGACY_ALPHA_RENDERER = "25fbd473-a6d4-4978-9dac-0a679d35fbad/28a52aefe26125f1b8b4d8c221c5b668466c81d9";

/** Repair the measured alpha defect only when the caller requests a publication. */
export function publicationNativeRendererId(retained: string): string {
  const id = canonicalNativeRendererId(retained);
  return id === LEGACY_ALPHA_RENDERER ? BUNDLED_NATIVE_RENDERER : id;
}

// Figma stores the resource hash on effects but returns its UUID from import.
// Each pair was read back from the corresponding owned sampler resource.
// Preserve the legacy identity so existing work keeps its recorded build.
export function canonicalNativeRendererId(id: string): string {
  return id.replace(/^4bd7b3ab188e9447b9459d8ecc2f2ba4c8f035b7\//,
    "25fbd473-a6d4-4978-9dac-0a679d35fbad/")
    .replace(/^d5d769a7aecb88b7fe06550eaad56dd603840634\//,
      "20eff4c7-e099-4bf2-937b-1d83305c0851/");
}
