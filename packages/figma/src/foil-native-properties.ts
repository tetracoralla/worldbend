import { FOIL_PROPERTY_FIELDS } from './foil-wire';
import type { FoilWireField } from './foil-wire';
export type FoilProperty = typeof FOIL_PROPERTY_FIELDS[number];
export function foilProperty(field:FoilWireField):FoilProperty {
  return field.replace(/-([a-z])/g,(_,char:string)=>char.toUpperCase()) as FoilProperty;
}
export function foilPropertyType(field:FoilProperty):'BOOLEAN'|'NUMBER'|'COLOR' {
  return field==='visible'?'BOOLEAN':field.endsWith('Color')?'COLOR':'NUMBER';
}
/** Definition ids are build-specific. The adapter's one mapping serves read,
 * selective write, resource acquisition and explicit renderer adoption. */
export function foilDefinitions(shader:Shader):Record<FoilProperty,string> {
  if(shader.type!=='fill'||!shader.imported||!shader.propertyDefinitions)
    throw Error('E_FIGMA_RESOURCE: The exact Foil fill build has no readable definitions');
  const mapping={} as Record<FoilProperty,string>;
  for(const field of FOIL_PROPERTY_FIELDS){
    const matches=Object.entries(shader.propertyDefinitions).filter(([,definition])=>definition.name===field);
    if(matches.length!==1||matches[0]![1].type!==foilPropertyType(field))
      throw Error(`E_FIGMA_RESOURCE: Foil ${field} definition is missing or ambiguous`);
    mapping[field]=matches[0]![0];
  }
  return mapping;
}
export function foilColorValue(field:FoilProperty,value:unknown):unknown {
  if(foilPropertyType(field)==='COLOR'&&value&&typeof value==='object'&&!Array.isArray(value)){
    const color=value as Record<string,unknown>;
    // The API's RGB form is opaque; other incomplete objects remain invalid.
    if(Object.keys(color).length===3&&['r','g','b'].every(key=>Object.hasOwn(color,key)))return {...color,a:1};
  }
  return value;
}
