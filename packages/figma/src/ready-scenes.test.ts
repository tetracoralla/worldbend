import { afterEach, describe, expect, it, vi } from "vitest";
import { planMockup } from "./designer-plan";
import { isUiToMainMessage } from "./messages";
import { createReadyScene } from "./ready-scenes-main";
import { READY_SCENES, readySceneDetails, readySceneMockup, readySceneRecords } from "./ready-scenes";
import { checkedTemplateLibrary, isSavedSpatialTemplate } from "./stored-template-library";

afterEach(() => vi.unstubAllGlobals());

describe("Original native ready scenes", () => {
  it("keeps editable scene acquisition distinct from its two canonical renderer slots", async () => {
    const records = readySceneRecords();
    expect(records.every(isSavedSpatialTemplate)).toBe(true);
    expect(checkedTemplateLibrary(records)).toBeUndefined();
    for (const scene of READY_SCENES) {
      const plan = await planMockup(readySceneMockup(scene));
      expect(plan.canvas).toEqual({ width: 1200, height: 900 });
      expect(plan.planes.map(plane => plane.sourceId)).toEqual(["source-1", "source-2"]);
      expect(records.find(record => record.readyScene === scene.id)?.slots).toEqual([{ name: "Artwork", ...scene.surface }]);
      expect(readySceneMockup(scene).background).toEqual({ kind: "transparent" });
      expect(readySceneMockup(scene).planes[1]?.opacity).toBe(0);
      expect(plan.planes[0]?.surface).toEqual(scene.artworkSurface);
    }
  });


  it("keeps carton and poster contact lighting as editable native Multiply decoration", () => {
    const carton = READY_SCENES.find(scene => scene.id === "carton-label")!;
    const cartonDetails = readySceneDetails(carton);
    const floor = cartonDetails.find(detail => detail.name === "Carton · floor contact");
    const topCast = cartonDetails.find(detail => detail.name === "Carton · top cast");
    expect(floor).toMatchObject({ blendMode: "MULTIPLY", blur: 10, shadow: false });
    expect(floor?.foreground).toBeUndefined();
    expect((floor?.opacity ?? 0) > 0).toBe(true);
    expect(topCast).toMatchObject({ blendMode: "MULTIPLY", foreground: true, shadow: false });
    expect(topCast?.gradient?.direction).toBe("vertical");
    expect(topCast?.gradient?.stops.some(stop => (stop.opacity ?? 1) === 0)).toBe(true);
    // Top panel is behind decoration; cast is foreground so it shades the label, not the flap fill.
    expect(cartonDetails.findIndex(detail => detail.name === "Carton · top"))
      .toBeLessThan(cartonDetails.findIndex(detail => detail.name === "Carton · top cast"));
    // Fail-before: stripping contact/cast leaves only structural side/top fills.
    const cartonWithout = cartonDetails.filter(detail =>
      !detail.name.includes("floor contact") && !detail.name.includes("top cast"));
    expect(cartonWithout.every(detail => detail.blendMode !== "MULTIPLY")).toBe(true);

    const poster = READY_SCENES.find(scene => scene.id === "studio-poster")!;
    const posterDetails = readySceneDetails(poster);
    const wall = posterDetails.find(detail => detail.name === "Poster · wall contact");
    const clipCast = posterDetails.find(detail => detail.name === "Poster · clip cast");
    const clip = posterDetails.find(detail => detail.name === "Hanging clip · native occlusion");
    expect(wall).toMatchObject({ blendMode: "MULTIPLY", blur: 10, shadow: false });
    expect(wall?.foreground).toBeUndefined();
    expect(clipCast).toMatchObject({ blendMode: "MULTIPLY", foreground: true, shadow: false });
    expect(clipCast?.gradient?.stops.some(stop => (stop.opacity ?? 1) === 0)).toBe(true);
    expect(clip).toMatchObject({ foreground: true });
    // Clip must paint after its cast so Multiply shade darkens poster, not the clip hardware.
    expect(posterDetails.findIndex(detail => detail.name === "Poster · clip cast"))
      .toBeLessThan(posterDetails.findIndex(detail => detail.name === "Hanging clip · native occlusion"));
    const posterWithout = posterDetails.filter(detail =>
      !detail.name.includes("wall contact") && !detail.name.includes("clip cast"));
    expect(posterWithout.every(detail => detail.blendMode !== "MULTIPLY")).toBe(true);
  });

  it("keeps desktop screen contact lighting and stand occlusion as editable native Multiply decoration", () => {
    const desktop = READY_SCENES.find(scene => scene.id === "desktop-screen")!;
    const details = readySceneDetails(desktop);
    const desk = details.find(detail => detail.name === "Screen · desk contact");
    const cast = details.find(detail => detail.name === "Screen · bezel cast");
    const stand = details.find(detail => detail.name === "Stand");
    expect(desk?.blendMode).toBe("MULTIPLY");
    expect(desk?.foreground).toBeUndefined();
    expect(desk?.blur).toBeGreaterThan(0);
    expect(cast?.blendMode).toBe("MULTIPLY");
    expect(cast?.foreground).toBe(true);
    expect(cast?.gradient?.stops.some(stop => (stop.opacity ?? 1) === 0)).toBe(true);
    expect(stand).toBeTruthy();
    expect(stand?.foreground).toBeUndefined();
    // Desk contact must precede stand so the base occludes the contact shade on the desk.
    expect(details.findIndex(detail => detail.name === "Screen · desk contact"))
      .toBeLessThan(details.findIndex(detail => detail.name === "Stand"));
    const without = details.filter(detail =>
      !detail.name.includes("desk contact") && !detail.name.includes("bezel cast"));
    expect(without.every(detail => detail.blendMode !== "MULTIPLY")).toBe(true);
    expect(readySceneRecords().find(record => record.readyScene === "desktop-screen")?.appearance?.supported)
      .not.toContain("lighting");
  });

  it("keeps hanging fabric contact lighting as editable native Multiply decoration", () => {
    const fabric = READY_SCENES.find(scene => scene.id === "hanging-fabric")!;
    const details = readySceneDetails(fabric);
    const contact = details.find(detail => detail.name === "Fabric · wall contact");
    const cast = details.find(detail => detail.name === "Fabric · rail cast");
    expect(contact).toMatchObject({ blendMode: "MULTIPLY", blur: 10, shadow: false });
    expect(contact?.foreground).toBeUndefined();
    expect((contact?.opacity ?? 0) > 0).toBe(true);
    expect(cast).toMatchObject({ blendMode: "MULTIPLY", foreground: true, shadow: false });
    expect(cast?.gradient?.direction).toBe("vertical");
    expect(cast?.gradient?.stops.some(stop => (stop.opacity ?? 1) === 0)).toBe(true);
    // Rail must paint after its cast so Multiply shade darkens fabric, not the rail hardware.
    expect(details.findIndex(detail => detail.name === "Fabric · rail cast"))
      .toBeLessThan(details.findIndex(detail => detail.name === "Fabric · hanging rail"));
    expect(readySceneRecords().find(record => record.readyScene === "hanging-fabric")?.appearance?.supported)
      .toContain("lighting");
    // Fail-before: stripping cast/contact leaves only mechanical rail/loops.
    const withoutLighting = details.filter(detail => !detail.name.includes("wall contact") && !detail.name.includes("rail cast"));
    expect(withoutLighting.every(detail => detail.blendMode !== "MULTIPLY")).toBe(true);
  });

  it("preserves the authored surface across independent ready records", () => {
    const can = READY_SCENES.find(scene => scene.id === "studio-can")!;
    const first = readySceneMockup(can);
    const second = readySceneMockup(can);
    if (first.planes[0]?.surface?.kind !== "cylinder") throw Error("Expected curved can");
    first.planes[0].surface.curvature = .2;
    expect(second.planes[0]?.surface).toEqual(can.artworkSurface);
    expect(readySceneRecords().find(record => record.readyScene === "studio-can")?.appearance?.supported).toContain("lighting");
  });

  it("keeps ready-scene routing out of user storage and rejects altered built-in geometry", () => {
    const [record] = readySceneRecords();
    expect(isSavedSpatialTemplate({ ...record, readyScene: undefined })).toBe(false);
    expect(isSavedSpatialTemplate({ ...record, id: "template-custom" })).toBe(false);
    const changed = structuredClone(record!);
    if (changed.template.operation.kind !== "mockup") throw Error("Expected Mockup");
    changed.template.operation.spec.canvas.width = 1199;
    expect(isSavedSpatialTemplate(changed)).toBe(false);
  });

  it("rejects ambiguous or unbounded scene commands at the UI boundary", () => {
    const valid = { type: "use-ready-scene", generation: 1, requestId: 1, id: "studio-poster", fit: "cover" };
    expect(isUiToMainMessage(valid)).toBe(true);
    for (const change of [{ generation: -1 }, { id: "unknown" }, { fit: "stretch" }, { extra: true }]) {
      expect(isUiToMainMessage({ ...valid, ...change })).toBe(false);
    }
  });

  it("rechecks the source after font loading before any scene or copy is created", async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const createFrame = vi.fn();
    const page = { id: "page", type: "PAGE", parent: null };
    const source = { id: "text", parent: page, type: "TEXT", visible: true, removed: false, getSharedPluginData: () => "",
      getStyledTextSegments: () => [{ fontName: { family: "Inter", style: "Regular" } }] } as unknown as SceneNode;
    vi.stubGlobal("figma", { currentPage: page, getNodeByIdAsync: async () => source, loadFontAsync: () => pending, createFrame });
    const begin = vi.fn();
    const creating = createReadyScene({ id: "studio-poster", artwork: source, fit: "contain", placement: { x: 0, y: 0 },
      begin, assertCurrent() { throw Error("selection changed"); } });
    finish();
    await expect(creating).rejects.toThrow("selection changed");
    expect(begin).not.toHaveBeenCalled();
    expect(createFrame).not.toHaveBeenCalled();
  });
});
