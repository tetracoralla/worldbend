import type { FoilMaterialWire, FoilRecipeWire, FoilWireField } from './foil-wire';
import type { FoilNativeProfile, FoilResourceEvidence } from './foil-resource-wire';

/** UI transport deliberately has no Plugin API globals or executable proof. */
export interface FoilNodeSnapshot {
  nodeId:string;name:string;eligible:boolean;
  reason?:'unavailable'|'unverified'|'invalid'|'multiple'|'locked'|'no-fills';
  state:'absent'|'removed'|'untagged-native'|'tagged'|'customized';
  live:FoilMaterialWire|null;provenance:FoilRecipeWire|null;customized:FoilWireField[];
  profile:FoilNativeProfile|null;resource:FoilResourceEvidence|null;available:FoilResourceEvidence|null;
  canChoose:boolean;canAdopt:boolean;warnings:string[];
}
/** Human RGB and opacity controls may update one channel group while core
 * recipes and revision merges continue to own the complete RGBA field. */
export type FoilColorChannels = Partial<Record<'base-color'|'highlight-color',('r'|'g'|'b'|'a')[]>>;
export const BUILTIN_FOIL_RECIPES:readonly FoilRecipeWire[] = [
  {schema:'worldbend.foil@0.1',version:'0.1',recipeId:'warm-foil',recipeVersion:1,
    material:{visible:true,baseColor:{r:.72,g:.71,b:.68,a:1},highlightColor:{r:.98,g:.92,b:.78,a:1},lightAngle:120,intensity:.6,roughness:.45,flowSpeed:.25}},
  {schema:'worldbend.foil@0.1',version:'0.1',recipeId:'silver-foil',recipeVersion:1,
    material:{visible:true,baseColor:{r:.18,g:.21,b:.27,a:1},highlightColor:{r:.94,g:.97,b:1,a:1},lightAngle:35,intensity:.8,roughness:.2,flowSpeed:.18}},
  {schema:'worldbend.foil@0.1',version:'0.1',recipeId:'rose-foil',recipeVersion:1,
    material:{visible:true,baseColor:{r:.48,g:.16,b:.23,a:1},highlightColor:{r:1,g:.78,b:.65,a:.9},lightAngle:155,intensity:.68,roughness:.55,flowSpeed:.12}},
];
