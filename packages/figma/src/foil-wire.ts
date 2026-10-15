/** UI/native parameter transport; canonical shape and meaning belong to core. */
import type { FoilColor, FoilField, FoilMaterial, FoilRecipeSpec } from '@worldbend/web/types';
export type FoilColorWire = FoilColor;
export type FoilMaterialWire = FoilMaterial;
export type FoilRecipeWire = FoilRecipeSpec;
export type FoilWireField = FoilField;
export const FOIL_WIRE_FIELDS = ['visible','base-color','highlight-color','light-angle','intensity','roughness','flow-speed'] as const satisfies readonly FoilField[];
export const FOIL_PROPERTY_FIELDS = ['visible','baseColor','highlightColor','lightAngle','intensity','roughness','flowSpeed'] as const;
const colorKeys = ['r','g','b','a'];
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function finiteRange(value: unknown, max: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max; }
export function isFoilColorWire(value: unknown): value is FoilColorWire {
  return record(value) && Object.keys(value).length === 4 && colorKeys.every(key => finiteRange(value[key],1));
}
export function isFoilMaterialWire(value: unknown): value is FoilMaterialWire {
  return record(value) && Object.keys(value).length === 7 && typeof value['visible'] === 'boolean' &&
    isFoilColorWire(value['baseColor']) && isFoilColorWire(value['highlightColor']) &&
    finiteRange(value['lightAngle'],360) && finiteRange(value['intensity'],1) &&
    finiteRange(value['roughness'],1) && finiteRange(value['flowSpeed'],2);
}
export function isFoilRecipeWire(value: unknown): value is FoilRecipeWire {
  return record(value) && Object.keys(value).length === 5 && value['schema'] === 'worldbend.foil@0.1' &&
    value['version'] === '0.1' && typeof value['recipeId'] === 'string' && !!value['recipeId'].trim() &&
    [...value['recipeId']].length <= 64 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value['recipeId']) &&
    typeof value['recipeVersion'] === 'number' && Number.isInteger(value['recipeVersion']) &&
    value['recipeVersion'] >= 1 && value['recipeVersion'] <= 0xffff_ffff && isFoilMaterialWire(value['material']);
}
/** Do not round authored floats or use a broad tolerance that hides edits. */
export function changedFoilFields(live: FoilMaterialWire, seed: FoilMaterialWire): FoilWireField[] {
  const number = (a: number,b: number) => a !== b && a !== Math.fround(b);
  const color = (a: FoilColorWire,b: FoilColorWire) => number(a.r,b.r) || number(a.g,b.g) || number(a.b,b.b) || number(a.a,b.a);
  return FOIL_WIRE_FIELDS.filter(field => {
    switch (field) {
      case 'visible': return live.visible !== seed.visible;
      case 'base-color': return color(live.baseColor,seed.baseColor);
      case 'highlight-color': return color(live.highlightColor,seed.highlightColor);
      case 'light-angle': return number(live.lightAngle,seed.lightAngle);
      case 'intensity': return number(live.intensity,seed.intensity);
      case 'roughness': return number(live.roughness,seed.roughness);
      case 'flow-speed': return number(live.flowSpeed,seed.flowSpeed);
    }
  });
}
/** Saved RGBA values compare by value after transport, never object identity. */
export function sameFoilMaterial(a: FoilMaterialWire,b: FoilMaterialWire): boolean {
  return a.visible === b.visible && a.lightAngle === b.lightAngle && a.intensity === b.intensity &&
    a.roughness === b.roughness && a.flowSpeed === b.flowSpeed &&
    colorKeys.every(key => a.baseColor[key as keyof FoilColorWire] === b.baseColor[key as keyof FoilColorWire] &&
      a.highlightColor[key as keyof FoilColorWire] === b.highlightColor[key as keyof FoilColorWire]);
}
