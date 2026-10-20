import {
  GLASS_WIRE_FIELDS,
  isAppearanceRecipeWire,
  isGlassMaterialWire,
  type AppearanceRecipeWire,
  type GlassMaterialWire,
  type GlassWireField,
} from "./appearance-wire";
import {
  TEXTURE_WIRE_FIELDS,
  isTextureRecipeWire,
  isTextureMaterialWire,
  type TextureRecipeWire,
  type TextureMaterialWire,
  type TextureWireField,
} from "./texture-wire";
import type { AppearanceApplyOutcome } from "./appearance-wire";
import type { TextureApplyOutcome } from "./texture-wire";
import { FOIL_WIRE_FIELDS, isFoilRecipeWire, isFoilMaterialWire, sameFoilMaterial } from './foil-wire';
import type { FoilRecipeWire, FoilMaterialWire, FoilWireField } from './foil-wire';
import type { FoilColorChannels } from './foil-material-wire';
import { MESH_GRADIENT_WIRE_FIELDS, isMeshGradientRecipeWire, isMeshGradientMaterialWire, sameMeshGradientMaterial } from './mesh-gradient-wire';
import type { MeshGradientRecipeWire, MeshGradientMaterialWire, MeshGradientWireField } from './mesh-gradient-wire';
import type { MeshGradientColorChannels } from './mesh-gradient-material-wire';

export type MaterialOutcome = AppearanceApplyOutcome | TextureApplyOutcome | {nodeId:string;outcome:'applied'|'removed'|'skipped';reason?:string};

export type MaterialEditWire =
  | {
      family: "glass";
      recipe: AppearanceRecipeWire;
      material: GlassMaterialWire;
      fields?: GlassWireField[];
      remove?: boolean;
    }
  | {
      family: "texture";
      recipe: TextureRecipeWire;
      material: TextureMaterialWire;
      fields?: TextureWireField[];
      remove?: boolean;
    }
  | {family:'foil';recipe:FoilRecipeWire;material:FoilMaterialWire;fields?:FoilWireField[];remove?:boolean;
      /** Explicitly changing the renderer is separate from choosing a look. */
      adopt?:boolean;colorChannels?:FoilColorChannels}
  | {family:'mesh-gradient';recipe:MeshGradientRecipeWire;material:MeshGradientMaterialWire;fields?:MeshGradientWireField[];remove?:boolean;
      adopt?:boolean;colorChannels?:MeshGradientColorChannels};

export interface SavedMaterial {
  name: string;
  edit: MaterialEditWire;
  /** Native thumbnail captured from the edited artwork. */
  thumbnail?: string;
}

export function isMaterialEdit(value: unknown): value is MaterialEditWire {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) => !["family", "recipe", "material", "fields", "remove", ...(v['family']==='foil'||v['family']==='mesh-gradient'?['adopt','colorChannels']:[])].includes(k),
    )
  )
    return false;
  const fields =
    v["family"] === "glass" ? GLASS_WIRE_FIELDS : v['family']==='foil'?FOIL_WIRE_FIELDS:v['family']==='mesh-gradient'?MESH_GRADIENT_WIRE_FIELDS:TEXTURE_WIRE_FIELDS;
  if(v['family']==='foil'||v['family']==='mesh-gradient') {
    if(v['adopt']!==undefined && typeof v['adopt']!=='boolean')return false;
    if(v['adopt'] && (v['remove'] || v['fields']!==undefined || v['colorChannels']!==undefined))return false;
    const channels=v['colorChannels'];
    const colorFields=v['family']==='foil'?['base-color','highlight-color']:['color-tl','color-tr','color-bl','color-br'];
    if(channels!==undefined && (!channels || typeof channels!=='object' || Array.isArray(channels) ||
        !Object.keys(channels).length || v['remove'] || !Array.isArray(v['fields']) ||
        Object.entries(channels).some(([field,keys])=>!colorFields.includes(field) ||
          !(v['fields'] as unknown[]).includes(field) || !Array.isArray(keys) || !keys.length || keys.length>4 ||
          new Set(keys).size!==keys.length || keys.some(key=>!['r','g','b','a'].includes(key)))))return false;
  }
  return (
    (v["family"] === "glass"
      ? isAppearanceRecipeWire(v["recipe"]) &&
        isGlassMaterialWire(v["material"])
      : v['family']==='foil' ? isFoilRecipeWire(v['recipe']) && isFoilMaterialWire(v['material'])
      : v['family']==='mesh-gradient' ? isMeshGradientRecipeWire(v['recipe']) && isMeshGradientMaterialWire(v['material'])
      : v["family"] === "texture" &&
        isTextureRecipeWire(v["recipe"]) &&
        isTextureMaterialWire(v["material"])) &&
    (v["remove"] === undefined || typeof v["remove"] === "boolean") &&
    (v["fields"] === undefined ||
      (Array.isArray(v["fields"]) &&
        v["fields"].length > 0 &&
        v["fields"].length <= fields.length &&
        new Set(v["fields"]).size === v["fields"].length &&
        v["fields"].every((f) => (fields as readonly unknown[]).includes(f))))
  );
}

export function isSavedMaterial(value: unknown): value is SavedMaterial {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const edit = v["edit"];
  if (!isMaterialEdit(edit)) return false;
  return (
    Object.keys(v).every((k) => ["name", "edit", "thumbnail"].includes(k)) &&
    typeof v["name"] === "string" &&
    v["name"].trim().length > 0 &&
    [...v["name"]].length <= 64 &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(v["name"]) &&
    (edit.family==='foil' ? sameFoilMaterial(edit.recipe.material,edit.material) && edit.adopt===undefined && edit.colorChannels===undefined
      : edit.family==='mesh-gradient' ? sameMeshGradientMaterial(edit.recipe.material,edit.material) && edit.adopt===undefined && edit.colorChannels===undefined
      : Object.entries(edit.recipe.material).every(
      ([key, value]) =>
        value === (edit.material as unknown as Record<string, unknown>)[key],
    )) &&
    !edit.remove &&
    edit.fields === undefined &&
    (v["thumbnail"] === undefined ||
      (typeof v["thumbnail"] === "string" &&
        v["thumbnail"].length <= 65536 &&
        /^[A-Za-z0-9+/]+={0,2}$/.test(v["thumbnail"])))
  );
}
