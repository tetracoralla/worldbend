import {
  appearanceNodeSnapshot,
  applyAppearanceToNodes,
  APPEARANCE_NAMESPACE,
  SHARED_APPEARANCE_KEY,
} from "./appearance";
import { textureNodeSnapshot, applyTextureToNodes } from "./texture";
import { isMaterialEdit, type MaterialEditWire } from "./material-edit-wire";

import { applyFoilMaterialEdit } from './foil-material';
import type { FoilNodeSnapshot } from './foil-material-wire';
import { applyMeshGradientMaterialEdit } from './mesh-gradient-material';
import type { MeshGradientNodeSnapshot } from './mesh-gradient-material-wire';
export type { MaterialOutcome } from './material-edit-wire';
import type { MaterialOutcome } from './material-edit-wire';
export async function applyMaterialEditAsync(nodes:readonly SceneNode[],edit:MaterialEditWire,
  observed?:ReadonlyMap<string,FoilNodeSnapshot|MeshGradientNodeSnapshot>,assertScope:()=>void=()=>{},beforeWrite:()=>void=()=>{}) {
  if(edit.family==='foil')return applyFoilMaterialEdit(nodes,edit,observed as ReadonlyMap<string,FoilNodeSnapshot>|undefined,assertScope,beforeWrite);
  if(edit.family==='mesh-gradient')return applyMeshGradientMaterialEdit(nodes,edit,observed as ReadonlyMap<string,MeshGradientNodeSnapshot>|undefined,assertScope,beforeWrite);
  assertScope();beforeWrite();return applyMaterialEdit(nodes,edit);
}
const fieldKey = (field: string): string =>
  field.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());

/** A human field edit is selective; choosing a card replaces its declared look.
 * Execute synchronously after preflight, preserving each target's native extras
 * and provenance when only fields change. Roll back the complete selection on
 * failure, including a failed setter on the current target. */
export function applyMaterialEdit(
  nodes: readonly SceneNode[],
  edit: MaterialEditWire,
):
  | { ok: true; outcomes: MaterialOutcome[] }
  | { ok: false; error: string; unrestoredNodeIds: string[] } {
  if (!isMaterialEdit(edit) || edit.family==="foil" || edit.family==="mesh-gradient")
    return { ok: false, error: "Invalid material edit", unrestoredNodeIds: [] };
  const key = edit.family === "glass" ? SHARED_APPEARANCE_KEY : "texture";
  const backups: {
    node: SceneNode & { effects: readonly Effect[] };
    effects: readonly Effect[];
    provenance: string;
  }[] = [];
  const outcomes: MaterialOutcome[] = [];
  try {
    for (const node of nodes) {
      const snapshot =
        edit.family === "glass"
          ? appearanceNodeSnapshot(node)
          : textureNodeSnapshot(node);
      if (!snapshot.eligible) {
        outcomes.push({
          nodeId: node.id,
          outcome: "skipped",
          reason: snapshot.reason ?? "no-effects",
        });
        continue;
      }
      if (!("effects" in node)) continue;
      backups.push({
        node,
        effects: [...node.effects],
        provenance: node.getSharedPluginData(APPEARANCE_NAMESPACE, key),
      });
      if (edit.remove) {
        node.effects = node.effects.filter((e) =>
          edit.family === "glass"
            ? e.type !== "GLASS"
            : e.type !== "NOISE" && e.type !== "TEXTURE",
        );
        outcomes.push({
          nodeId: node.id,
          outcome: "applied",
          replacedUntagged: false,
        });
        continue;
      }
      const values = { ...(snapshot.live ?? edit.recipe.material) } as Record<
        string,
        unknown
      >;
      if (edit.fields)
        for (const field of edit.fields)
          values[fieldKey(field)] = (
            edit.material as unknown as Record<string, unknown>
          )[fieldKey(field)];
      const result =
        edit.family === "glass"
          ? applyAppearanceToNodes(
              [node],
              edit.fields
                ? (appearanceNodeSnapshot(node).provenance ?? edit.recipe)
                : edit.recipe,
              edit.fields
                ? (values as unknown as typeof edit.material)
                : edit.material,
            )
          : applyTextureToNodes(
              [node],
              edit.fields
                ? (textureNodeSnapshot(node).provenance ?? edit.recipe)
                : edit.recipe,
              edit.fields
                ? (values as unknown as typeof edit.material)
                : edit.material,
            );
      if (!result.ok) throw new Error(result.error);
      outcomes.push(...result.outcomes);
    }
    return { ok: true, outcomes };
  } catch (error) {
    const unrestoredNodeIds: string[] = [];
    for (const backup of backups.reverse()) {
      let restored = true;
      try {
        backup.node.effects = backup.effects;
      } catch {
        restored = false;
      }
      try {
        backup.node.setSharedPluginData(
          APPEARANCE_NAMESPACE,
          key,
          backup.provenance,
        );
      } catch {
        restored = false;
      }
      if (!restored) unrestoredNodeIds.push(backup.node.id);
    }
    return { ok: false, error: String(error), unrestoredNodeIds };
  }
}
