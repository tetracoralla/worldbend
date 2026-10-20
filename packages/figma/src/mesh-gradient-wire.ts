/** UI/native parameter transport; canonical shape and meaning belong to core. */
import type { MeshGradientColor, MeshGradientField, MeshGradientMaterial, MeshGradientRecipeSpec } from '@worldbend/web/types';
export type MeshGradientColorWire = MeshGradientColor;
export type MeshGradientMaterialWire = MeshGradientMaterial;
export type MeshGradientRecipeWire = MeshGradientRecipeSpec;
export type MeshGradientWireField = MeshGradientField;
export const MESH_GRADIENT_WIRE_FIELDS = ['visible','color-tl','color-tr','color-bl','color-br','warp','softness','duration-ms','phase-ms','flow-speed'] as const satisfies readonly MeshGradientField[];
export const MESH_GRADIENT_PROPERTY_FIELDS = ['visible','colorTl','colorTr','colorBl','colorBr','warp','softness','durationMs','phaseMs','flowSpeed'] as const;
export const MESH_GRADIENT_COLOR_PROPERTIES = ['colorTl','colorTr','colorBl','colorBr'] as const;
const colorKeys = ['r','g','b','a'] as const;
function record(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
export function isMeshGradientColorWire(value: unknown): value is MeshGradientColorWire {
  return record(value) && Object.keys(value).length === 4 && colorKeys.every(key => inRange(value[key], 0, 1));
}
export function meshGradientProperty(field: MeshGradientWireField): typeof MESH_GRADIENT_PROPERTY_FIELDS[number] {
  return field.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()) as typeof MESH_GRADIENT_PROPERTY_FIELDS[number];
}
export function isMeshGradientMaterialWire(value: unknown): value is MeshGradientMaterialWire {
  return record(value) && Object.keys(value).length === 10 && typeof value['visible'] === 'boolean' &&
    isMeshGradientColorWire(value['colorTl']) && isMeshGradientColorWire(value['colorTr']) &&
    isMeshGradientColorWire(value['colorBl']) && isMeshGradientColorWire(value['colorBr']) &&
    inRange(value['warp'], 0, 1) && inRange(value['softness'], 0, 1) &&
    inRange(value['durationMs'], 100, 60000) && inRange(value['phaseMs'], 0, 60000) &&
    inRange(value['flowSpeed'], 0, 2);
}
export function isMeshGradientRecipeWire(value: unknown): value is MeshGradientRecipeWire {
  return record(value) && Object.keys(value).length === 5 && value['schema'] === 'worldbend.mesh-gradient@0.1' &&
    value['version'] === '0.1' && typeof value['recipeId'] === 'string' && !!value['recipeId'].trim() &&
    [...value['recipeId']].length <= 64 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value['recipeId']) &&
    typeof value['recipeVersion'] === 'number' && Number.isInteger(value['recipeVersion']) &&
    value['recipeVersion'] >= 1 && value['recipeVersion'] <= 0xffff_ffff && isMeshGradientMaterialWire(value['material']);
}
/** Do not round authored floats or use a broad tolerance that hides edits. */
export function changedMeshGradientFields(live: MeshGradientMaterialWire, seed: MeshGradientMaterialWire): MeshGradientWireField[] {
  const number = (a: number, b: number) => a !== b && a !== Math.fround(b);
  const color = (a: MeshGradientColorWire, b: MeshGradientColorWire) => colorKeys.some(key => number(a[key], b[key]));
  return MESH_GRADIENT_WIRE_FIELDS.filter(field => {
    switch (field) {
      case 'visible': return live.visible !== seed.visible;
      case 'color-tl': return color(live.colorTl, seed.colorTl);
      case 'color-tr': return color(live.colorTr, seed.colorTr);
      case 'color-bl': return color(live.colorBl, seed.colorBl);
      case 'color-br': return color(live.colorBr, seed.colorBr);
      case 'warp': return number(live.warp, seed.warp);
      case 'softness': return number(live.softness, seed.softness);
      case 'duration-ms': return number(live.durationMs, seed.durationMs);
      case 'phase-ms': return number(live.phaseMs, seed.phaseMs);
      case 'flow-speed': return number(live.flowSpeed, seed.flowSpeed);
    }
  });
}
/** Saved RGBA values compare by value after transport, never object identity. */
export function sameMeshGradientMaterial(a: MeshGradientMaterialWire, b: MeshGradientMaterialWire): boolean {
  return a.visible === b.visible && a.warp === b.warp && a.softness === b.softness &&
    a.durationMs === b.durationMs && a.phaseMs === b.phaseMs && a.flowSpeed === b.flowSpeed &&
    (['colorTl','colorTr','colorBl','colorBr'] as const).every(name =>
      colorKeys.every(key => a[name][key] === b[name][key]));
}
