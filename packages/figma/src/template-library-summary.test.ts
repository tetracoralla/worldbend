import { describe, expect, it } from "vitest";
import { templateLibrarySummary } from "./template-library-summary";
import { checkedTemplateLibrary, spatialTemplateFromMockup, templateAppearance } from "./stored-template-library";
import { READY_SCENES, readySceneMockup } from "./ready-scenes";

describe("Agent template summary compatibility", () => {
  it("keeps geometry entries inspectable after a native scene is saved and reports its replaceable slots", () => {
    const template = spatialTemplateFromMockup(readySceneMockup(READY_SCENES[0]!));
    const nativeScene = { schema: "worldbend.figma.scene" as const, version: "0.1" as const,
      sceneId: "scene-identity-0001", pageId: "page", rootNodeId: "root", previewNodeId: "preview", resultNodeId: "result",
      sourceNodeIds: ["artwork", "guide"], replaceSourceNodeIds: ["artwork"] };
    const library = checkedTemplateLibrary([{ id: "geometry", name: "Geometry", template }, { id: "scene", name: "Scene", template,
      nativeScene, slots: [{ name: "Artwork", width: 440, height: 620 }], appearance: templateAppearance(template) }]);
    expect(library).toBeDefined();
    const summary = templateLibrarySummary(library);
    expect(summary?.map(entry => [entry.id, entry.sourceCount])).toEqual([["geometry", 2], ["scene", 1]]);
    expect(summary?.[1]?.nativeScene).toEqual(nativeScene);
    expect(templateLibrarySummary({ ...library, templates: [{ ...library!.templates[1], nativeScene: { ...nativeScene, sourceNodeIds: ["artwork"] } }] })).toBeUndefined();
  });
});
