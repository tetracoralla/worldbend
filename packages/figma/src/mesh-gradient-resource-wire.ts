import { MESH_GRADIENT_NATIVE_PROFILE, MESH_GRADIENT_NATIVE_SOURCE_SHA256, MESH_GRADIENT_V1_NATIVE_PROFILE, MESH_GRADIENT_V1_NATIVE_SOURCE_SHA256 } from './mesh-gradient-resource.generated';

/** Exact, externally source-checked identities. Available is not adoption.
 * The legacy hash is a reserved non-current source class, not an account or
 * import id. Unknown hashes are refused
 * so a different build cannot silently become the accepted renderer. */
export const MESH_GRADIENT_LEGACY_SOURCE_SHA256 = 'sha256:86628a8917131534a39ff171245cb9e84394237237b77cc23d287d13de7fc9a7';
export const MESH_GRADIENT_LEGACY_PROFILE = 'worldbend.mesh-gradient.legacy@0.1' as const;
export interface MeshGradientResourceEvidence { importId:string; paintId:string; sourceSha256:string }
export type MeshGradientNativeProfile = typeof MESH_GRADIENT_NATIVE_PROFILE | typeof MESH_GRADIENT_LEGACY_PROFILE | typeof MESH_GRADIENT_V1_NATIVE_PROFILE;
export function meshGradientResourceProfile(resource:MeshGradientResourceEvidence):MeshGradientNativeProfile {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource) ||
      Object.keys(resource).length !== 3 ||
      Object.keys(resource).some(key => !['importId','paintId','sourceSha256'].includes(key)) ||
      [resource.importId, resource.paintId].some(id => typeof id !== 'string' || !id || id.length > 256 || /[\u0000-\u001f\u007f-\u009f]/u.test(id)))
    throw Error('E_SCHEMA: Mesh-gradient needs exact import/paint identity and verified source evidence');
  if (resource.sourceSha256 === MESH_GRADIENT_NATIVE_SOURCE_SHA256) return MESH_GRADIENT_NATIVE_PROFILE;
  if (resource.sourceSha256 === MESH_GRADIENT_V1_NATIVE_SOURCE_SHA256) return MESH_GRADIENT_V1_NATIVE_PROFILE;
  if (resource.sourceSha256 === MESH_GRADIENT_LEGACY_SOURCE_SHA256) return MESH_GRADIENT_LEGACY_PROFILE;
  throw Error('E_FIGMA_RESOURCE: This Shader source is not a supported mesh-gradient profile');
}
