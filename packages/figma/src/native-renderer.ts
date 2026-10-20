/** Exact sampler build shipped with this plugin; never select an effect by name. */
export const BUNDLED_NATIVE_RENDERER = "edccbf77-f5ec-453f-9470-039a38ec22d6/c91ce20ddf24f476a3eec8aa68c9f7c00883383c";

/** Public companion-effect listing. Acquisition still requires a published Community resource. */
export const NATIVE_EFFECT_LISTING_URL = "https://www.figma.com/community/shader/1692554770100764677";
const LEGACY_ALPHA_RENDERER = "25fbd473-a6d4-4978-9dac-0a679d35fbad/28a52aefe26125f1b8b4d8c221c5b668466c81d9";
const PREVIOUS_LABEL_RENDERER = "20eff4c7-e099-4bf2-937b-1d83305c0851/610eb52f8eeb4810422bf37b504129cf83efa355";
const PREVIOUS_SAMPLER_RENDERER = "20eff4c7-e099-4bf2-937b-1d83305c0851/c057f52be7f1dc060486f0173a9d5c1e50976598";

/** Explicit publication upgrades only verified builds: the alpha correction
 * and the same sampler's label and resource updates. Reads keep recorded bytes. */
export function publicationNativeRendererId(retained: string): string {
  const id = canonicalNativeRendererId(retained);
  return id === LEGACY_ALPHA_RENDERER || id === PREVIOUS_LABEL_RENDERER || id === PREVIOUS_SAMPLER_RENDERER
    ? BUNDLED_NATIVE_RENDERER : id;
}

// Figma stores the resource hash on effects but returns its UUID from import.
// Each pair was read back from the corresponding owned sampler resource.
// Preserve the legacy identity so existing work keeps its recorded build.
export function canonicalNativeRendererId(id: string): string {
  return id.replace(/^4bd7b3ab188e9447b9459d8ecc2f2ba4c8f035b7\//,
    "25fbd473-a6d4-4978-9dac-0a679d35fbad/")
    .replace(/^d5d769a7aecb88b7fe06550eaad56dd603840634\//,
      "20eff4c7-e099-4bf2-937b-1d83305c0851/")
    .replace(/^e2434f089cc9f3e784cf62b93083dbbb9a113117\//,
      "edccbf77-f5ec-453f-9470-039a38ec22d6/");
}
