import type { MeshGradientMaterialWire, MeshGradientRecipeWire, MeshGradientWireField } from './mesh-gradient-wire';
import type { MeshGradientNativeProfile, MeshGradientResourceEvidence } from './mesh-gradient-resource-wire';

/** UI transport deliberately has no Plugin API globals or executable proof. */
export interface MeshGradientNodeSnapshot {
  nodeId: string; name: string; eligible: boolean;
  reason?: 'unavailable' | 'unverified' | 'invalid' | 'multiple' | 'locked' | 'no-fills';
  state: 'absent' | 'removed' | 'untagged-native' | 'tagged' | 'customized';
  live: MeshGradientMaterialWire | null; provenance: MeshGradientRecipeWire | null; customized: MeshGradientWireField[];
  profile: MeshGradientNativeProfile | null; resource: MeshGradientResourceEvidence | null; available: MeshGradientResourceEvidence | null;
  canChoose: boolean; canAdopt: boolean; warnings: string[];
}
/** Human RGB and opacity controls may update one channel group while core
 * recipes and revision merges continue to own the complete RGBA field. */
export type MeshGradientColorChannels = Partial<Record<'color-tl' | 'color-tr' | 'color-bl' | 'color-br', ('r' | 'g' | 'b' | 'a')[]>>;
const color = (r: number, g: number, b: number, a = 1) => ({ r, g, b, a });
export const BUILTIN_MESH_GRADIENT_RECIPES: readonly MeshGradientRecipeWire[] = [
  { schema: 'worldbend.mesh-gradient@0.1', version: '0.1', recipeId: 'soft-fluid', recipeVersion: 1,
    material: { visible: true, colorTl: color(.18, .42, .92), colorTr: color(.55, .22, .86), colorBl: color(.12, .72, .68), colorBr: color(.95, .55, .22), warp: .35, softness: .55, durationMs: 8000, phaseMs: 0, flowSpeed: .45 } },
  { schema: 'worldbend.mesh-gradient@0.1', version: '0.1', recipeId: 'dawn-wash', recipeVersion: 1,
    material: { visible: true, colorTl: color(.98, .72, .45), colorTr: color(.96, .45, .55), colorBl: color(.55, .28, .62), colorBr: color(.98, .86, .55), warp: .22, softness: .72, durationMs: 12000, phaseMs: 400, flowSpeed: .28 } },
  { schema: 'worldbend.mesh-gradient@0.1', version: '0.1', recipeId: 'night-current', recipeVersion: 1,
    material: { visible: true, colorTl: color(.05, .08, .22), colorTr: color(.12, .28, .62), colorBl: color(.02, .16, .28), colorBr: color(.42, .18, .62), warp: .62, softness: .4, durationMs: 6000, phaseMs: 0, flowSpeed: .85 } },
];
