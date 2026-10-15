import { FOIL_NATIVE_PROFILE, FOIL_NATIVE_SOURCE_SHA256 } from './foil-resource.generated';

/** Exact, externally source-checked identities. Available is not adoption. */
export interface FoilResourceEvidence { importId:string; paintId:string; sourceSha256:string }
export type FoilNativeProfile = typeof FOIL_NATIVE_PROFILE | 'worldbend.foil.prototype@0.1';
const LEGACY_SOURCE = 'sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6';
export function foilResourceProfile(resource:FoilResourceEvidence):FoilNativeProfile {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource) ||
      Object.keys(resource).length !== 3 ||
      Object.keys(resource).some(key=>!['importId','paintId','sourceSha256'].includes(key)) ||
      [resource.importId,resource.paintId].some(id=>typeof id !== 'string' || !id || id.length>256 || /[\u0000-\u001f\u007f-\u009f]/u.test(id)))
    throw Error('E_SCHEMA: Foil needs exact import/paint identity and verified source evidence');
  if(resource.sourceSha256===FOIL_NATIVE_SOURCE_SHA256)return FOIL_NATIVE_PROFILE;
  if(resource.sourceSha256===LEGACY_SOURCE)return 'worldbend.foil.prototype@0.1';
  throw Error('E_FIGMA_RESOURCE: This Shader source is not a supported Foil profile');
}
