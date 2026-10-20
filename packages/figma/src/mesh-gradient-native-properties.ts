import { MESH_GRADIENT_PROPERTY_FIELDS, meshGradientProperty } from './mesh-gradient-wire';
import type { MeshGradientWireField } from './mesh-gradient-wire';
export type MeshGradientProperty = typeof MESH_GRADIENT_PROPERTY_FIELDS[number];
export function meshGradientNativeProperty(field: MeshGradientWireField): MeshGradientProperty {
  return meshGradientProperty(field);
}
export function meshGradientPropertyType(field: MeshGradientProperty): 'BOOLEAN' | 'NUMBER' | 'COLOR' {
  return field === 'visible' ? 'BOOLEAN' : field.startsWith('color') ? 'COLOR' : 'NUMBER';
}
/** Definition ids are build-specific. The adapter's one mapping serves read,
 * selective write, resource acquisition and explicit renderer adoption. */
export function meshGradientDefinitions(shader: Shader): Record<MeshGradientProperty, string> {
  if (shader.type !== 'fill' || !shader.imported || !shader.propertyDefinitions)
    throw Error('E_FIGMA_RESOURCE: The exact mesh-gradient fill build has no readable definitions');
  const mapping = {} as Record<MeshGradientProperty, string>;
  for (const field of MESH_GRADIENT_PROPERTY_FIELDS) {
    const matches = Object.entries(shader.propertyDefinitions).filter(([, definition]) => definition.name === field);
    if (matches.length !== 1 || matches[0]![1].type !== meshGradientPropertyType(field))
      throw Error(`E_FIGMA_RESOURCE: Mesh-gradient ${field} definition is missing or ambiguous`);
    mapping[field] = matches[0]![0];
  }
  return mapping;
}
export function meshGradientColorValue(field: MeshGradientProperty, value: unknown): unknown {
  if (meshGradientPropertyType(field) === 'COLOR' && value && typeof value === 'object' && !Array.isArray(value)) {
    const color = value as Record<string, unknown>;
    if (Object.keys(color).length === 3 && ['r','g','b'].every(key => Object.hasOwn(color, key))) return { ...color, a: 1 };
  }
  return value;
}
