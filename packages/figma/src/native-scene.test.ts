import { afterEach, describe, expect, it, vi } from "vitest";
import { copyNativeScene } from "./native-scene-main";
import { isNativeSceneReference, parseNativeSceneReference, type NativeSceneReference } from "./native-scene-model";
import { readStoredBinding, writeStoredBinding } from "./stored-binding";
import { readStoredOperation, writeStoredOperation } from "./stored-operation";
import { continuedCompositionTask } from "./stored-designer-task";
import { READY_SCENES, readySceneMockup } from "./ready-scenes";
import { isUiToMainMessage } from "./messages";
import { spatialTemplateFromCompositionTask } from "./stored-template-library";
import { createReadyScene } from "./ready-scenes-main";
import { prepareSceneReadProof, writeSceneReadProof, matchesSceneReadProof } from "./native-scene-read-proof";
import { rasterPaintsIntact, writeRasterPaintProof } from "./raster-paint-guard";

function setup() {
  let id = 0;
  const nodes = new Map<string, Node>();
  class Node {
    id = `node-${++id}`; name = "Artwork"; type: string; parent: Node | null = null;
    children: Node[] = []; visible = true; removed = false; width = 440; height = 620; x = 0; y = 0;
    isMask = false; maskType = "ALPHA"; blendMode = "NORMAL";
    vectorPaths: Array<{ windingRule: "NONZERO" | "EVENODD"; data: string }> = [];
    clipsContent = false; opacity = 1; fills: unknown[] = []; effects: Effect[] = []; shared = new Map<string, string>(); characters = "Original headline"; fontName = { family: "Example", style: "Regular" };
    constructor(type: string) { this.type = type; nodes.set(this.id, this); }
    appendChild(node: Node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); this.children.push(node); node.parent = this; }
    insertChild(index: number, node: Node) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); this.children.splice(index, 0, node); node.parent = this; }
    getSharedPluginData(_namespace: string, key: string) { return this.shared.get(key) ?? ""; }
    setSharedPluginData(_namespace: string, key: string, value: string) { this.shared.set(key, value); }
    getStyledTextSegments() { return [{ fontName: this.fontName }]; }
    findAll(predicate: (node: Node) => boolean): Node[] { return this.children.flatMap(node => [...(predicate(node) ? [node] : []), ...node.findAll(predicate)]); }
    resize(width: number, height: number) { this.width = width; this.height = height; }
    rescale(scale: number) { this.width *= scale; this.height *= scale; }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; this.removed = true; this.children.forEach(child => child.remove()); }
    clone(): Node { const copy = new Node(this.type); Object.assign(copy, { name: this.name, characters: this.characters, width: this.width, height: this.height, visible: this.visible, clipsContent: this.clipsContent, opacity: this.opacity, isMask: this.isMask, maskType: this.maskType, blendMode: this.blendMode, vectorPaths: structuredClone(this.vectorPaths), fills: structuredClone(this.fills), effects: structuredClone(this.effects), shared: new Map(this.shared) }); this.children.forEach(child => copy.appendChild(child.clone())); return copy; }
  }
  const page = new Node("PAGE"), root = new Node("FRAME"), artwork = new Node("FRAME"), preview = new Node("FRAME"), result = new Node("RECTANGLE"), guide = new Node("VECTOR");
  page.appendChild(root); root.appendChild(artwork); root.appendChild(preview); preview.appendChild(result); preview.appendChild(guide); guide.visible = false;
  const text = new Node("TEXT"); artwork.appendChild(text);
  const task = continuedCompositionTask(readySceneMockup(READY_SCENES[0]!));
  writeStoredOperation(result as unknown as RectangleNode, { kind: "task", task });
  writeStoredBinding(result as unknown as RectangleNode, { sourceNodeIds: [artwork.id, guide.id], renderWidth: 1200, renderHeight: 900 });
  const reference: NativeSceneReference = { schema: "worldbend.figma.scene", version: "0.1", sceneId: "scene-identity-0001", pageId: page.id,
    rootNodeId: root.id, previewNodeId: preview.id, resultNodeId: result.id, sourceNodeIds: [artwork.id, guide.id], replaceSourceNodeIds: [artwork.id] };
  root.setSharedPluginData("worldbend", "nativeScene", JSON.stringify(reference));
  const loadFontAsync = vi.fn(async (_font: unknown) => {});
  vi.stubGlobal("figma", { currentPage: page, getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
    loadFontAsync, createFrame: () => new Node("FRAME"), createRectangle: () => new Node("RECTANGLE"), createVector: () => new Node("VECTOR"),
    group(children: Node[], parent: Node) { const group = new Node("GROUP"); group.resize(children[0]!.width, children[0]!.height); parent.appendChild(group); children.forEach(child => group.appendChild(child)); return group; },
  });
  const input = { result: result as unknown as RectangleNode, reference, task, name: "My scene", placement: { x: 1000, y: 0 }, assertCurrent: vi.fn(), begin: vi.fn() };
  return { page, root, preview, result, artwork, guide, text, nodes, loadFontAsync, input, Node };
}
afterEach(() => vi.unstubAllGlobals());

describe("Native scene copies and identity", () => {
  it("retains native cutout-mask scope, winding, blend and shadow across changed-aspect reuse", async () => {
    const f = setup();
    const foreground = new f.Node("GROUP"), mask = new f.Node("VECTOR"), material = new f.Node("RECTANGLE");
    foreground.name = "Foreground · cutout ribbon";foreground.blendMode = "PASS_THROUGH";
    foreground.effects = [{ type: "DROP_SHADOW", visible: true, radius: 10, offset: { x: 4, y: 10 }, color: { r: .08, g: .16, b: .16, a: .25 }, spread: 0, blendMode: "MULTIPLY" }];
    mask.name = "Cutout mask";mask.isMask = true;mask.maskType = "VECTOR";
    mask.vectorPaths = [{ windingRule: "EVENODD", data: "M 0 0 L 200 0 L 200 80 L 0 80 Z M 60 20 L 80 20 L 80 60 L 60 60 Z" }];
    material.name = "Native material";material.opacity = .8;material.fills = [{ type: "SOLID", color: { r: .5, g: .6, b: .5 } }];
    foreground.appendChild(mask);foreground.appendChild(material);f.preview.appendChild(foreground);
    const wide = new f.Node("FRAME");wide.resize(1280, 720);f.page.appendChild(wide);
    const result = await copyNativeScene({ ...f.input, replacements: [wide as unknown as SceneNode], fit: "contain" });
    const kept = (result.preview as unknown as InstanceType<typeof f.Node>).children.find(n => n.name === foreground.name)!;
    expect(kept.id).not.toBe(foreground.id);
    expect(kept.blendMode).toBe("PASS_THROUGH");expect(kept.effects).toEqual(foreground.effects);
    expect(kept.children.map(n => n.name)).toEqual(["Cutout mask", "Native material"]);
    expect(kept.children[0]).toMatchObject({ isMask: true, maskType: "VECTOR", vectorPaths: mask.vectorPaths });
    expect(kept.children[1]).toMatchObject({ opacity: .8, fills: material.fills });
    expect(result.preview.children.indexOf(kept as unknown as SceneNode)).toBeGreaterThan(result.preview.children.indexOf(result.result));
    expect(foreground.children).toEqual([mask, material]);expect(f.artwork.children).toEqual([f.text]);
  });

  it("rejects native mask-mode edits during asynchronous preparation before creating a scene", async () => {
    const f = setup(), mask = new f.Node("VECTOR");mask.isMask = true;mask.maskType = "VECTOR";f.preview.appendChild(mask);
    let release!: () => void;
    f.loadFontAsync.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const copying = copyNativeScene(f.input);await vi.waitFor(() => expect(release).toBeDefined());
    mask.maskType = "LUMINANCE";release();await expect(copying).rejects.toThrow("changed");
    expect(f.input.begin).not.toHaveBeenCalled();expect(f.page.children).toEqual([f.root]);
  });

  it("accepts unchanged native text and fills across carrier property orders, but rejects real edits", async () => {
    const f = setup();
    vi.stubGlobal("figma", { currentPage: f.page, fileKey: "fixture", getNodeByIdAsync: async (id: string) => f.nodes.get(id) });
    f.text.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.4, b: 0.6 }, opacity: 1 }];
    f.result.fills = [{ type: "IMAGE", imageHash: "published-image", scaleMode: "FILL" }];
    const sources = [f.artwork, f.guide] as unknown as SceneNode[];
    const proof = await prepareSceneReadProof(sources);
    writeSceneReadProof(f.result as unknown as RectangleNode, proof.fingerprint);
    f.text.fontName = { style: "Regular", family: "Example" };
    f.text.fills = [{ opacity: 1, color: { b: 0.6, r: 0.2, g: 0.4 }, type: "SOLID" }];
    f.result.fills = [{ scaleMode: "FILL", imageHash: "published-image", type: "IMAGE" }];
    const same = await prepareSceneReadProof(sources);
    expect(same.fingerprint).toBe(proof.fingerprint);
    expect(matchesSceneReadProof(f.result as unknown as RectangleNode, same.fingerprint)).toBe(true);
    f.text.characters = "Changed headline";
    expect(matchesSceneReadProof(f.result as unknown as RectangleNode, (await prepareSceneReadProof(sources)).fingerprint)).toBe(false);
    f.text.characters = "Original headline";
    f.result.fills = [{ type: "IMAGE", imageHash: "changed-image", scaleMode: "FILL" }];
    expect(matchesSceneReadProof(f.result as unknown as RectangleNode, proof.fingerprint)).toBe(false);
  });
  it("clones the scene and rewrites both result identity and local source bindings", async () => {
    const fixture = setup(); const original = fixture.root.getSharedPluginData("worldbend", "nativeScene");
    fixture.root.setSharedPluginData("worldbend", "sceneCreation", JSON.stringify({ requestId: "original-creation" }));
    const replacement = new fixture.Node("FRAME"); replacement.resize(700, 420); fixture.page.appendChild(replacement);
    const result = await copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode], fit: "contain" });
    const binding = readStoredBinding(result.result)!;
    expect(binding.resultNodeId).toBe(result.result.id);
    expect(binding.revision).toBe(1);
    expect(binding.sourceNodeIds).toEqual(result.reference.sourceNodeIds);
    expect(binding.sourceNodeIds).not.toContain(fixture.artwork.id);
    expect(binding.sourceNodeIds).not.toContain(fixture.guide.id);
    expect(result.result.fills).toEqual([]);
    expect(readStoredOperation(result.result)).toEqual({ status: "valid", operation: { kind: "task", task: fixture.input.task } });
    expect(isNativeSceneReference(result.reference)).toBe(true);
    expect(result.reference.sceneId).not.toBe(fixture.input.reference.sceneId);
    expect(fixture.root.getSharedPluginData("worldbend", "nativeScene")).toBe(original);
    expect(result.root.getSharedPluginData("worldbend", "sceneCreation")).toBe("");
    expect(fixture.root.getSharedPluginData("worldbend", "sceneCreation")).toContain("original-creation");
    expect(fixture.artwork.children).toEqual([fixture.text]);
    expect(replacement.removed).toBe(false);
  });

  it("rewrites the cloned paint proof when a scene copy clears the result image", async () => {
    const fixture = setup();
    fixture.result.fills = [{ type: "IMAGE", imageHash: "published-image", scaleMode: "FILL" }];
    writeRasterPaintProof(fixture.result as unknown as RectangleNode);
    const originalProof = fixture.result.getSharedPluginData("worldbend", "rasterPaint");
    const replacement = new fixture.Node("FRAME"); replacement.resize(700, 420); fixture.page.appendChild(replacement);
    const copied = await copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode], fit: "contain" });
    expect(copied.result.fills).toEqual([]);
    expect(rasterPaintsIntact(copied.result)).toBe(true);
    expect(JSON.parse(copied.result.getSharedPluginData("worldbend", "rasterPaint")).fills).toEqual([]);
    expect(fixture.result.getSharedPluginData("worldbend", "rasterPaint")).toBe(originalProof);
    expect(rasterPaintsIntact(fixture.result as unknown as RectangleNode)).toBe(true);
  });

  it("keeps a matching cloned paint proof when the copy does not replace the fills", async () => {
    const fixture = setup();
    fixture.result.fills = [{ type: "IMAGE", imageHash: "published-image", scaleMode: "FILL" }];
    writeRasterPaintProof(fixture.result as unknown as RectangleNode);
    const copied = await copyNativeScene(fixture.input);
    expect(copied.result.fills).toEqual(fixture.result.fills);
    expect(rasterPaintsIntact(copied.result)).toBe(true);
    expect(JSON.parse(copied.result.getSharedPluginData("worldbend", "rasterPaint")).fills).toEqual(copied.result.fills);
  });

  it("does not create a scene after a font load lets the source or master change", async () => {
    const fixture = setup(); let release!: () => void;
    fixture.loadFontAsync.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const copying = copyNativeScene(fixture.input);
    await vi.waitFor(() => expect(fixture.loadFontAsync).toHaveBeenCalled());
    writeStoredBinding(fixture.result as unknown as RectangleNode, { sourceNodeIds: [fixture.artwork.id, fixture.guide.id], renderWidth: 1200, renderHeight: 900 });
    release(); await expect(copying).rejects.toThrow("unavailable");
    expect(fixture.input.begin).not.toHaveBeenCalled();
    expect(fixture.page.children).toEqual([fixture.root]);
  });

  it("rejects corner smoothing edits made while scene fonts are loading", async () => {
    const fixture = setup(); Object.assign(fixture.guide, { cornerSmoothing: 0 });
    let release!: () => void;
    fixture.loadFontAsync.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const copying = copyNativeScene(fixture.input);
    await vi.waitFor(() => expect(release).toBeDefined());
    Object.assign(fixture.guide, { cornerSmoothing: .75 }); release();
    await expect(copying).rejects.toThrow("changed");
    expect(fixture.input.begin).not.toHaveBeenCalled();
    expect(fixture.page.children).toEqual([fixture.root]);
  });

  it("removes an incomplete copy when artwork cloning fails and leaves existing work intact", async () => {
    const fixture = setup(); const replacement = new fixture.Node("FRAME"); fixture.page.appendChild(replacement);
    replacement.clone = () => { throw Error("clone refused"); };
    await expect(copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode] })).rejects.toThrow("clone refused");
    expect(fixture.page.children).toEqual([fixture.root, replacement]);
    expect(fixture.root.removed).toBe(false); expect(fixture.result.removed).toBe(false);
  });

  it("rejects malformed scene identity and unbound replacement slots", () => {
    const { input } = setup(); expect(parseNativeSceneReference(JSON.stringify(input.reference))).toEqual(input.reference);
    for (const invalid of [{ sceneId: "short" }, { sourceNodeIds: [] }, { replaceSourceNodeIds: ["other-node"] }, { extra: true }, { sourceNodeIds: [input.result.id] }]) {
      expect(isNativeSceneReference({ ...input.reference, ...invalid })).toBe(false);
    }
  });

  it("accepts a composition template save and bounds scene save bytes and commands", () => {
    const { input } = setup();
    const geometry = { type: "save-template", workspace: "mockup", requestId: 1, name: "Geometry", template: spatialTemplateFromCompositionTask(input.task) };
    expect(isUiToMainMessage(geometry)).toBe(true);
    const saving = { type: "save-native-scene", generation: 1, requestId: 2, targetNodeId: input.result.id, name: "Scene", task: input.task, bytes: new Uint8Array([1]), renderWidth: 1200, renderHeight: 900 };
    expect(isUiToMainMessage(saving)).toBe(true);
    for (const invalid of [{ bytes: new Uint8Array() }, { renderWidth: 4097 }, { task: {} }, { generation: 0 }, { extra: true }]) expect(isUiToMainMessage({ ...saving, ...invalid })).toBe(false);
  });
});

describe("Independent copied scene dependencies", () => {
  function graph() {
    const fixture = setup();
    const source = new fixture.Node("FRAME"); source.name = "External original"; fixture.page.appendChild(source);
    const text = new fixture.Node("TEXT"); source.appendChild(text); text.fontName = { family: "Dependency", style: "Regular" };
    const middle = new fixture.Node("RECTANGLE"); middle.name = "External first result"; fixture.page.appendChild(middle);
    const nested = new fixture.Node("RECTANGLE"); nested.name = "Nested second result"; fixture.artwork.appendChild(nested);
    for (const [result, input] of [[middle, source], [nested, middle]] as const) {
      writeStoredBinding(result as unknown as SceneNode, { sourceNodeIds: [input.id], renderWidth: 440, renderHeight: 620 });
      writeStoredOperation(result as unknown as SceneNode, { kind: "transform", spec: {
        ...readySceneMockup(READY_SCENES[0]!).planes[0]!.transform, content: { fit: "stretch" } } });
    }
    return { ...fixture, source, externalText: text, middle, nested };
  }

  it("copies every transitive source once and keeps nested refreshes inside the new scene", async () => {
    const fixture = graph();
    const second = new fixture.Node("RECTANGLE"); second.name = "Shared dependency"; fixture.artwork.appendChild(second);
    writeStoredBinding(second as unknown as SceneNode, { sourceNodeIds: [fixture.source.id], renderWidth: 440, renderHeight: 620 });
    const copied = await copyNativeScene(fixture.input);
    const all = copied.root.findAll(() => true);
    const source = all.find(node => node.name === "External original")!;
    const middle = all.find(node => node.name === "External first result")!;
    const nested = all.find(node => node.name === "Nested second result")!;
    expect(all.filter(node => node.name === "External original")).toHaveLength(1);
    expect(readStoredBinding(middle)?.sourceNodeIds).toEqual([source.id]);
    expect(readStoredBinding(nested)?.sourceNodeIds).toEqual([middle.id]);
    expect(readStoredBinding(all.find(node => node.name === "Shared dependency")!)?.sourceNodeIds).toEqual([source.id]);
    expect(fixture.loadFontAsync).toHaveBeenCalledWith({ family: "Dependency", style: "Regular" });
    fixture.externalText.characters = "Original changed later";
    expect((source as unknown as { children: Array<{ characters: string }> }).children[0]?.characters).toBe("Original headline");
    expect(readStoredBinding(fixture.nested as unknown as SceneNode)?.sourceNodeIds).toEqual([fixture.middle.id]);
  });

  it("includes linked replacement dependencies in ready scenes and native scene reuse", async () => {
    const fixture = graph();
    for (const creating of [
      () => createReadyScene({ id: "studio-poster", artwork: fixture.nested as unknown as SceneNode, fit: "contain", placement: { x: 0, y: 0 }, assertCurrent() {}, begin() {} }),
      () => copyNativeScene({ ...fixture.input, replacements: [fixture.nested as unknown as SceneNode], fit: "cover" }),
    ]) {
      const copied = await creating();
      const all = copied.root.findAll(() => true);
      const source = all.find(node => node.name === "External original")!;
      const middle = all.find(node => node.name === "External first result")!;
      const nested = all.find(node => node.name === "Nested second result")!;
      expect(source).toBeDefined(); expect(middle).toBeDefined(); expect(nested).toBeDefined();
      expect(readStoredBinding(nested)?.sourceNodeIds).toEqual([middle.id]);
      expect(readStoredBinding(middle)?.sourceNodeIds).toEqual([source.id]);
      copied.root.remove();
    }
    expect(fixture.source.removed).toBe(false); expect(fixture.nested.removed).toBe(false);
  });

  it("prunes only unused plugin-owned dependency copies after replacing artwork", async () => {
    const fixture = graph();
    const area = new fixture.Node("FRAME"); area.name = "Owned old source area"; area.setSharedPluginData("worldbend", "sceneDependencies", "1");
    fixture.root.appendChild(area); area.appendChild(fixture.source); area.appendChild(fixture.middle);
    const replacement = new fixture.Node("FRAME"); replacement.name = "Replacement"; fixture.page.appendChild(replacement);
    const copied = await copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode] });
    expect(copied.root.findAll(node => ["External original", "External first result", "Owned old source area"].includes(node.name))).toHaveLength(0);
    expect(fixture.source.removed).toBe(false); expect(area.removed).toBe(false);
    expect(fixture.root.children).toContain(area);
  });

  it("retains old artwork children that another scene layer still consumes", async () => {
    const fixture = setup();
    const linkedDecoration = new fixture.Node("RECTANGLE"); linkedDecoration.name = "Linked decoration";
    fixture.preview.appendChild(linkedDecoration);
    writeStoredBinding(linkedDecoration as unknown as SceneNode, { sourceNodeIds: [fixture.text.id], renderWidth: 100, renderHeight: 100 });
    const replacement = new fixture.Node("FRAME"); fixture.page.appendChild(replacement);
    const copied = await copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode] });
    const all = copied.root.findAll(() => true);
    const decoration = all.find(node => node.name === "Linked decoration")!;
    const sourceId = readStoredBinding(decoration)!.sourceNodeIds[0];
    const source = all.find(node => node.id === sourceId);
    expect(source).toBeDefined(); expect(source!.removed).toBe(false);
    expect(source!.getSharedPluginData("worldbend", "binding")).toBe("");
    expect(sourceId).not.toBe(fixture.text.id);
    expect(fixture.text.removed).toBe(false);
  });

  it("bounds physical cloning of discarded artwork before creating the replacement", async () => {
    const fixture = setup(); let parent = fixture.artwork;
    for (let i = 0; i < 65; i++) { const child = new fixture.Node("FRAME"); parent.appendChild(child); parent = child; }
    const replacement = new fixture.Node("FRAME"); fixture.page.appendChild(replacement);
    const before = [...fixture.page.children];
    await expect(copyNativeScene({ ...fixture.input, replacements: [replacement as unknown as SceneNode] })).rejects.toThrow(/64.*levels/);
    expect(fixture.input.begin).not.toHaveBeenCalled(); expect(fixture.page.children).toEqual(before);
  });

  it("preserves current nested draft bytes on the copy's new revision without blessing stale drafts", async () => {
    for (const baseRevision of [4, 1, 99]) {
      const fixture = graph();
      for (let i = 0; i < 3; i++) writeStoredBinding(fixture.nested as unknown as SceneNode,
        { sourceNodeIds: [fixture.middle.id, fixture.guide.id], renderWidth: 1200, renderHeight: 900 });
      writeStoredOperation(fixture.nested as unknown as SceneNode, { kind: "task", task: fixture.input.task });
      const draft = { schema: "worldbend.figma.mockup-draft", version: "0.1", baseRevision, task: fixture.input.task };
      fixture.nested.setSharedPluginData("worldbend", "mockupDraft", JSON.stringify(draft));
      const copied = await copyNativeScene(fixture.input);
      const nested = copied.root.findAll(node => node.name === "Nested second result")[0]!;
      expect(JSON.parse(nested.getSharedPluginData("worldbend", "mockupDraft"))).toEqual({ ...draft, baseRevision: baseRevision === 4 ? 1 : baseRevision === 1 ? 0 : 99 });
      expect(JSON.parse(fixture.nested.getSharedPluginData("worldbend", "mockupDraft"))).toEqual(draft);
    }
  });

  it("rejects source edits during dependency font loading before creating anything", async () => {
    const fixture = graph(); let finish!: () => void;
    fixture.loadFontAsync.mockImplementation(font => (font as { family: string }).family === "Dependency"
      ? new Promise<void>(resolve => { finish = resolve; }) : Promise.resolve());
    const before = [...fixture.page.children]; const copying = copyNativeScene(fixture.input);
    await vi.waitFor(() => expect(finish).toBeDefined());
    fixture.externalText.characters = "Changed while fonts loaded"; finish();
    await expect(copying).rejects.toThrow("changed");
    expect(fixture.input.begin).not.toHaveBeenCalled(); expect(fixture.page.children).toEqual(before);
  });

  it("rejects missing, malformed and cyclic links without partial copies", async () => {
    for (const kind of ["missing", "malformed", "damaged-native", "damaged-vector", "ancestor-cycle", "external-cycle"] as const) {
      const fixture = graph(); const before = [...fixture.page.children];
      if (kind === "malformed") fixture.middle.setSharedPluginData("worldbend", "binding", "{broken");
      else if (kind === "damaged-native" || kind === "damaged-vector") fixture.middle.setSharedPluginData("worldbend", kind === "damaged-native" ? "native" : "nativeVector", "{broken");
      else writeStoredBinding(fixture.middle as unknown as SceneNode, { sourceNodeIds: [kind === "missing" ? "deleted-node" : kind === "ancestor-cycle" ? fixture.artwork.id : fixture.nested.id], renderWidth: 440, renderHeight: 620 });
      await expect(copyNativeScene(fixture.input)).rejects.toThrow(kind === "missing" || kind === "malformed" || kind.startsWith("damaged-") ? "unavailable" : "cycle");
      expect(fixture.input.begin).not.toHaveBeenCalled(); expect(fixture.page.children).toEqual(before);
    }
  });

  it("checks the longest dependency path even when its shared tail was first read on a shallow branch", async () => {
    const fixture = setup();
    const chain = Array.from({ length: 64 }, () => new fixture.Node("FRAME"));
    chain.forEach(node => fixture.page.appendChild(node));
    for (let i = 0; i < chain.length - 1; i++) writeStoredBinding(chain[i] as unknown as SceneNode,
      { sourceNodeIds: [chain[i + 1]!.id], renderWidth: 100, renderHeight: 100 });
    fixture.root.appendChild(chain[0]!);
    fixture.root.children = [chain[0]!, ...fixture.root.children.filter(node => node !== chain[0])];
    const nested = new fixture.Node("RECTANGLE"); fixture.artwork.appendChild(nested);
    writeStoredBinding(nested as unknown as SceneNode, { sourceNodeIds: [chain[0]!.id], renderWidth: 100, renderHeight: 100 });
    const before = [...fixture.page.children];
    await expect(copyNativeScene(fixture.input)).rejects.toThrow(/64.*levels/);
    expect(fixture.input.begin).not.toHaveBeenCalled(); expect(fixture.page.children).toEqual(before);
  });
});

describe("Own-scene changed-aspect reuse retains native decoration", () => {
  it("keeps an embedded non-Frame artwork slot below its native foreground when wrapping and replacing it", async () => {
    const fixture = setup();
    const slot = new fixture.Node("RECTANGLE"); slot.name = "Embedded artwork slot";
    fixture.preview.insertChild(0, slot);
    const foreground = new fixture.Node("VECTOR"); foreground.name = "Book · foreground ribbon";
    foreground.fills = [{ type: "SOLID", color: { r: 0.9, g: 0.3, b: 0.1 } }];
    fixture.preview.appendChild(foreground);
    const reference = { ...fixture.input.reference, sourceNodeIds: [slot.id, fixture.guide.id], replaceSourceNodeIds: [slot.id] };
    fixture.root.setSharedPluginData("worldbend", "nativeScene", JSON.stringify(reference));
    writeStoredBinding(fixture.result as unknown as RectangleNode,
      { sourceNodeIds: reference.sourceNodeIds, renderWidth: 1200, renderHeight: 900 });
    const originalOrder = fixture.preview.children.map(node => node.name);
    const wide = new fixture.Node("FRAME"); wide.resize(880, 220); fixture.page.appendChild(wide);
    for (const replacements of [undefined, [wide as unknown as SceneNode]]) {
      const copied = await copyNativeScene({ ...fixture.input, reference,
        ...(replacements ? { replacements } : {}), fit: "cover" });
      expect(copied.preview.children.map(node => node.name)).toEqual(originalOrder);
      expect(copied.replaceSources[0]?.parent?.id).toBe(copied.preview.id);
      expect(copied.preview.children.indexOf(copied.replaceSources[0]!))
        .toBeLessThan(copied.preview.children.findIndex(node => node.name === foreground.name));
      expect(fixture.preview.children.map(node => node.name)).toEqual(originalOrder);
      expect(foreground.fills).toEqual([{ type: "SOLID", color: { r: 0.9, g: 0.3, b: 0.1 } }]);
    }
  });

  it("clips different-aspect cover/contain replacements and keeps preview decoration", async () => {
    const fixture = setup();
    // Simulate an own-scene slot saved without clipping (common Frame default).
    fixture.artwork.clipsContent = false;
    fixture.artwork.resize(440, 620);
    const decoration = new fixture.Node("VECTOR");
    decoration.name = "Book · native cast shadow";
    decoration.opacity = 0.72;
    decoration.effects = [{ type: "LAYER_BLUR", radius: 8, visible: true } as Effect];
    fixture.preview.appendChild(decoration);
    const wide = new fixture.Node("FRAME");
    wide.name = "Wide replacement";
    wide.resize(880, 220); // 4:1 vs slot ~0.71
    const text = new fixture.Node("TEXT");
    text.characters = "Wide artwork";
    wide.appendChild(text);
    fixture.page.appendChild(wide);

    for (const fit of ["cover", "contain"] as const) {
      const copied = await copyNativeScene({
        ...fixture.input,
        replacements: [wide as unknown as SceneNode],
        fit,
      });
      const slot = copied.replaceSources[0] as unknown as {
        type: string; width: number; height: number; clipsContent: boolean; children: Array<{
          type: string; width: number; height: number; x: number; y: number; children: Array<{ characters?: string }>;
        }>;
      };
      expect(slot.type).toBe("FRAME");
      expect(slot.clipsContent).toBe(true);
      expect(slot.width).toBe(440);
      expect(slot.height).toBe(620);
      expect(slot.children).toHaveLength(1);
      const content = slot.children[0]!;
      const scale = (fit === "contain" ? Math.min : Math.max)(440 / 880, 620 / 220);
      expect(content.width).toBeCloseTo(880 * scale);
      expect(content.height).toBeCloseTo(220 * scale);
      expect(content.x).toBeCloseTo((440 - content.width) / 2);
      expect(content.y).toBeCloseTo((620 - content.height) / 2);
      // replaceSceneArtwork groups the cloned source, so text sits under GROUP → FRAME.
      const nestedText = (node: { children?: Array<{ characters?: string; children?: unknown[] }> }): boolean =>
        Boolean(node.children?.some(child => child.characters === "Wide artwork" || nestedText(child as { children?: Array<{ characters?: string }> })));
      expect(nestedText(content)).toBe(true);

      const preview = copied.preview as unknown as { children: Array<{ name: string; opacity?: number; effects?: Effect[]; id: string }> };
      const kept = preview.children.find(child => child.name === "Book · native cast shadow");
      expect(kept).toBeDefined();
      expect(kept!.opacity).toBe(0.72);
      expect(kept!.effects).toEqual(decoration.effects);
      // Master decoration and unclipped original slot remain untouched.
      expect(fixture.artwork.clipsContent).toBe(false);
      expect(fixture.preview.children.some(child => child.name === "Book · native cast shadow")).toBe(true);
      copied.root.remove();
    }
  });

  it("applies the same clip guarantee across multiple own-scene artwork slots", async () => {
    const fixture = setup();
    const spine = new fixture.Node("FRAME");
    spine.name = "Spine · artwork slot";
    spine.resize(80, 620);
    spine.clipsContent = false;
    fixture.root.appendChild(spine);
    const spineText = new fixture.Node("TEXT");
    spineText.characters = "Spine";
    spine.appendChild(spineText);
    writeStoredBinding(fixture.result as unknown as RectangleNode, {
      sourceNodeIds: [fixture.artwork.id, spine.id, fixture.guide.id],
      renderWidth: 1200, renderHeight: 900,
    });
    const reference = {
      ...fixture.input.reference,
      sourceNodeIds: [fixture.artwork.id, spine.id, fixture.guide.id],
      replaceSourceNodeIds: [fixture.artwork.id, spine.id],
    };
    fixture.root.setSharedPluginData("worldbend", "nativeScene", JSON.stringify(reference));
    fixture.artwork.clipsContent = false;

    const front = new fixture.Node("FRAME"); front.resize(700, 900); fixture.page.appendChild(front);
    const spineArt = new fixture.Node("FRAME"); spineArt.resize(40, 900); fixture.page.appendChild(spineArt);
    const copied = await copyNativeScene({
      ...fixture.input,
      reference,
      replacements: [front as unknown as SceneNode, spineArt as unknown as SceneNode],
      fit: "contain",
    });
    expect(copied.replaceSources).toHaveLength(2);
    for (const slot of copied.replaceSources) {
      expect((slot as unknown as { clipsContent: boolean }).clipsContent).toBe(true);
    }
    expect(copied.reference.replaceSourceNodeIds).toHaveLength(2);
    expect(copied.reference.sourceNodeIds).toHaveLength(3);
  });
});
