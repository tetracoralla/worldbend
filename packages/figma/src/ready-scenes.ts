import type { MockupSpecInput, MockupSurface } from "@worldbend/web/types";
import { spatialTemplateFromMockup, templateAppearance, type SavedSpatialTemplate } from "./stored-template-library";
import { READY_SCENE_IDS, READY_SCENES, type ReadyScene, type ReadySceneId } from "./ready-scene-definitions";
export { READY_SCENE_IDS, READY_SCENES, readySceneDetails } from "./ready-scene-definitions";
export type { ReadyScene, ReadySceneId, ReadySceneDetail, ReadySceneGradient, SceneArtworkFit } from "./ready-scene-definitions";

export function isReadySceneId(value: unknown): value is ReadySceneId {
  return READY_SCENE_IDS.includes(value as ReadySceneId);
}

export function readyScene(id: ReadySceneId): ReadyScene {
  const scene = READY_SCENES.find(candidate => candidate.id === id);
  if (!scene) throw Error("Unknown ready scene");
  return scene;
}

export function readySceneMockup(scene: ReadyScene): MockupSpecInput {
  const quad = Object.fromEntries(Object.entries(scene.quad).map(([key, point]) =>
    [key, { x: point.x / scene.width, y: point.y / scene.height }])) as ReadyScene["quad"];
  return { schema: "worldbend.mockup", version: "0.1", canvas: { width: scene.width, height: scene.height },
    background: { kind: "transparent" }, seams: [], planes: [
      { id: "artwork", sourceId: "source-1", opacity: 1, transform: { schema: "worldbend.transform", version: "0.1",
        destination: { space: "normalized", quad }, content: { fit: "stretch" } },
        ...(scene.artworkSurface ? { surface: JSON.parse(JSON.stringify(scene.artworkSurface)) as MockupSurface } : {}) },
      { id: "surface-guide", sourceId: "source-2", opacity: 0, transform: { schema: "worldbend.transform", version: "0.1",
        destination: { space: "normalized", quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } },
        content: { fit: "stretch" } } },
    ] };
}

export function readySceneRecords(): SavedSpatialTemplate[] {
  return READY_SCENES.map(scene => {
    const template = spatialTemplateFromMockup(readySceneMockup(scene));
    return { id: `ready-${scene.id}`, name: scene.name, readyScene: scene.id, template,
      slots: [{ name: "Artwork", ...scene.surface }], appearance: templateAppearance(template) };
  });
}
