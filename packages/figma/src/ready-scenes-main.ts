import { readyScene, readySceneMockup, readySceneDetails, type ReadySceneGradient, type ReadySceneId, type SceneArtworkFit } from "./ready-scenes";
import { writeStoredBinding } from "./stored-binding";
import { clonedNativeGraph, rebindClonedNativeGraph } from "./native-clone-bindings";
import { writeStoredOperation } from "./stored-operation";
import { NATIVE_SCENE_KEY, newNativeSceneId, type NativeSceneReference } from "./native-scene-model";
import { prepareNativeCopy, pruneSceneDependencies, sceneDependencyArea } from "./native-copy-closure";

function paint(hex: string): SolidPaint {
  return { type: "SOLID", color: { r: parseInt(hex.slice(0, 2), 16) / 255,
    g: parseInt(hex.slice(2, 4), 16) / 255, b: parseInt(hex.slice(4, 6), 16) / 255 } };
}

function surfacePaint(color: string, gradient?: ReadySceneGradient): Paint {
  if (!gradient) return paint(color);
  return { type: "GRADIENT_LINEAR", gradientTransform: gradient.direction === "horizontal"
    ? [[1, 0, 0], [0, 1, 0]] : [[0, 1, 0], [-1, 0, 1]],
    gradientStops: gradient.stops.map(stop => ({ position: stop.at, color: { ...paint(stop.color).color, a: stop.opacity ?? 1 } })) };
}

export async function loadSourceFonts(source: SceneNode) {
  const texts = source.type === "TEXT" ? [source] : "findAll" in source
    ? source.findAll(node => node.type === "TEXT") as TextNode[] : [];
  const fonts = new Map<string, FontName>();
  for (const text of texts) for (const segment of text.getStyledTextSegments(["fontName"])) {
    fonts.set(JSON.stringify(segment.fontName), segment.fontName);
  }
  await Promise.all([...fonts.values()].map(font => figma.loadFontAsync(font)));
}

export function replaceSceneArtwork(artwork: FrameNode, source: SceneNode, fit: SceneArtworkFit,
  prepared: Awaited<ReturnType<typeof prepareNativeCopy>>, dependencies: FrameNode): void {
  const clone = source.clone();
  let content: GroupNode | undefined;
  const created: SceneNode[] = [clone];
  try {
    // Own-scene slots may have been saved with clipsContent=false. Cover/Contain
    // different-aspect replacement must clip to the slot so native decoration
    // outside the artwork Frame is not painted over by overflow.
    artwork.clipsContent = true;
    content = figma.group([clone], figma.currentPage);
    const scale = (fit === "contain" ? Math.min : Math.max)(artwork.width / content.width, artwork.height / content.height);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("Artwork needs nonempty dimensions.");
    content.rescale(scale); artwork.appendChild(content);
    content.x = (artwork.width - content.width) / 2; content.y = (artwork.height - content.height) / 2;
    const graph = clonedNativeGraph(source, clone);
    for (const original of prepared.roots) if (!graph.copies.has(original.id)) {
      const copy = original.clone(); created.push(copy); dependencies.appendChild(copy);
      const dependency = clonedNativeGraph(original, copy);
      for (const [id, node] of dependency.copies) graph.copies.set(id, node);
    }
    rebindClonedNativeGraph(graph.copies, prepared.originals, id => graph.copies.get(id), true);
    for (const child of [...artwork.children]) if (child !== content) child.remove();
  } catch (error) { if (content && !content.removed) content.remove(); for (const node of created.reverse()) if (!node.removed) node.remove(); throw error; }
}

/** Construct a native editable scene around a canonical linked projection.
 * Selection and async source guards belong to the caller. Applying in the
 * Composition workspace publishes the actual image through the normal core. */
export async function createReadyScene(input: {
  id: ReadySceneId; artwork: SceneNode; fit: SceneArtworkFit;
  placement: { x: number; y: number }; assertCurrent(): void | Promise<void>; begin(): void;
}) {
  const scene = readyScene(input.id);
  const prepared = await prepareNativeCopy([input.artwork]);
  await Promise.all(prepared.roots.map(loadSourceFonts));
  const ready = input.assertCurrent();
  if (ready) await ready;
  prepared.validate();
  input.begin();
  const created: SceneNode[] = [];
  function frame(name: string, width: number, height: number) {
    const node = figma.createFrame(); created.push(node);
    node.name = name; node.resize(width, height); node.fills = [];
    return node;
  }
  function vector(parent: FrameNode, name: string, path: string, color: string, gradient?: ReadySceneGradient, windingRule: "NONZERO" | "EVENODD" = "NONZERO") {
    const node = figma.createVector(); created.push(node); parent.appendChild(node);
    node.name = name; node.vectorPaths = [{ windingRule, data: path }];
    node.fills = [surfacePaint(color, gradient)]; node.strokes = []; return node;
  }
  try {
    const root = frame(`${scene.name} · Worldbend scene`, scene.surface.width + 96 + scene.width, Math.max(scene.surface.height, scene.height));
    root.layoutMode = "HORIZONTAL"; root.primaryAxisSizingMode = "AUTO"; root.counterAxisSizingMode = "AUTO";
    root.itemSpacing = 96; root.clipsContent = false; root.x = input.placement.x; root.y = input.placement.y;
    const artwork = frame("Artwork · edit this source", scene.surface.width, scene.surface.height);
    root.appendChild(artwork); artwork.clipsContent = true;
    const dependencies = sceneDependencyArea(root);
    replaceSceneArtwork(artwork, input.artwork, input.fit, prepared, dependencies);
    const preview = frame(scene.name, scene.width, scene.height);
    root.appendChild(preview); preview.fills = [surfacePaint(scene.background, scene.backgroundGradient)]; preview.clipsContent = true;
    const body = vector(preview, "Surface · native shape and shadow", scene.outer, scene.body, scene.bodyGradient);
    body.effects = [{ type: "DROP_SHADOW", color: { r: .08, g: .12, b: .10, a: .22 }, offset: { x: 18, y: 32 },
      radius: 32, spread: 0, visible: true, blendMode: "NORMAL" }];
    function decoration(detail: ReturnType<typeof readySceneDetails>[number]) {
      const node = vector(preview, detail.name, detail.path, detail.color, detail.gradient, detail.windingRule);
      node.blendMode = detail.blendMode ?? "NORMAL";
      node.opacity = detail.opacity ?? 1;
      if (detail.blur) node.effects = [{ type: "LAYER_BLUR", blurType: "NORMAL", radius: detail.blur, visible: true }];
      return node;
    }
    for (const detail of readySceneDetails(scene).filter(detail => !detail.foreground)) decoration(detail);
    const result = figma.createRectangle(); created.push(result); preview.appendChild(result);
    result.name = "Artwork · Worldbend"; result.resize(scene.width, scene.height); result.x = 0; result.y = 0; result.fills = [];
    const q = scene.quad;
    const guide = vector(preview, "Surface guide", `M ${q.tl.x} ${q.tl.y} L ${q.tr.x} ${q.tr.y} L ${q.br.x} ${q.br.y} L ${q.bl.x} ${q.bl.y} Z`, "FFFFFF");
    guide.visible = false;
    for (const detail of readySceneDetails(scene).filter(detail => detail.foreground)) {
      const clip = decoration(detail);
      if (detail.shadow !== false) clip.effects = [...clip.effects, { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: .24 }, offset: { x: 0, y: 4 }, radius: 4, spread: 0, visible: true, blendMode: "NORMAL" }];
    }
    writeStoredOperation(result, { kind: "task", task: { kind: "mockup", spec: readySceneMockup(scene) } });
    writeStoredBinding(result, { sourceNodeIds: [artwork.id, guide.id], renderWidth: scene.width, renderHeight: scene.height });
    const reference: NativeSceneReference = { schema: "worldbend.figma.scene", version: "0.1", sceneId: newNativeSceneId(),
      pageId: figma.currentPage.id, rootNodeId: root.id, previewNodeId: preview.id, resultNodeId: result.id,
      sourceNodeIds: [artwork.id, guide.id], replaceSourceNodeIds: [artwork.id] };
    root.setSharedPluginData("worldbend", NATIVE_SCENE_KEY, JSON.stringify(reference));
    pruneSceneDependencies(root);
    return { root, preview, result, artwork, guide, reference };
  } catch (error) {
    for (const node of created.reverse()) if (!node.removed) node.remove();
    throw error;
  }
}
