import { loadSourceFonts, replaceSceneArtwork } from "./ready-scenes-main";
import { NATIVE_SCENE_KEY, newNativeSceneId, parseNativeSceneReference, type NativeSceneReference } from "./native-scene-model";
import { sameJsonValue } from "./json-value";
import { nodePage } from "./native-document";
import { readResultBinding, writeStoredBinding } from "./stored-binding";
import { readStoredOperationSlots, writeStoredOperation, type StoredOperationSlots } from "./stored-operation";
import { SHARED_MOCKUP_DRAFT_KEY, type FigmaCompositionTask } from "./stored-designer-task";
import type { SceneArtworkFit } from "./ready-scenes";
import { rebindClonedNativeGraph } from "./native-clone-bindings";
import { checkCopyBudget, prepareNativeCopy, pruneSceneDependencies, sceneDependencyArea } from "./native-copy-closure";
import { writeRasterPaintProof } from "./raster-paint-guard";

const unavailable = () => new Error("The saved scene is unavailable. Open its Figma file and page, or save the scene again.");
function within(node: BaseNode, root: BaseNode): boolean {
  for (let current: BaseNode | null = node; current; current = current.parent) if (current.id === root.id) return true;
  return false;
}
export function nativeSceneForResult(result: SceneNode): NativeSceneReference | undefined {
  for (let parent = result.parent; parent && parent.type !== "PAGE"; parent = parent.parent) {
    const scene = parseNativeSceneReference(parent.getSharedPluginData("worldbend", NATIVE_SCENE_KEY));
    if (scene && scene.rootNodeId === parent.id && scene.resultNodeId === result.id) return scene;
  }
  return undefined;
}
export function canSaveNativeScene(result: SceneNode): boolean {
  return result.type === "RECTANGLE" && result.parent?.type === "FRAME" && readResultBinding(result) !== undefined;
}
function pairNodes(original: SceneNode, copy: SceneNode, map: Map<string, SceneNode>, originals: Map<string, SceneNode>) {
  map.set(original.id, copy); originals.set(original.id, original);
  if ("children" in original && "children" in copy) {
    if (original.children.length !== copy.children.length) throw unavailable();
    original.children.forEach((child, index) => pairNodes(child, copy.children[index]!, map, originals));
  }
}
function frame(name: string, width: number, height: number): FrameNode {
  const node = figma.createFrame(); node.name = name; node.resize(width, height); node.fills = []; node.clipsContent = false; return node;
}

/** Clone the native graph and rebind its canonical result before replacing any
 * artwork. A save captures a complete native master; a use clones that master.
 * Source fonts and all freshness guards run before the first document write. */
export async function copyNativeScene(input: {
  result: RectangleNode; reference?: NativeSceneReference; expectedSlots?: StoredOperationSlots; task: FigmaCompositionTask;
  name: string; renderSize?: { width: number; height: number }; placement: { x: number; y: number }; replacements?: readonly SceneNode[]; fit?: SceneArtworkFit;
  assertCurrent(): void | Promise<void>; begin(): void;
}) {
  const originalResult = input.result;
  const binding = readResultBinding(originalResult);
  const existing = nativeSceneForResult(originalResult);
  if (input.expectedSlots && !sameJsonValue(readStoredOperationSlots(originalResult), input.expectedSlots)) throw unavailable();
  if (!binding || !canSaveNativeScene(originalResult)) throw unavailable();
  if (input.reference && (!existing || !sameJsonValue(existing, input.reference))) throw unavailable();
  const rootNode = existing ? await figma.getNodeByIdAsync(existing.rootNodeId) : originalResult.parent;
  const previewNode = existing ? await figma.getNodeByIdAsync(existing.previewNodeId) : originalResult.parent;
  if (!rootNode || rootNode.type !== "FRAME" || !previewNode || previewNode.type !== "FRAME") throw unavailable();
  const root: FrameNode = rootNode, preview: FrameNode = previewNode;
  if (!within(originalResult, preview) || !within(preview, root) || (existing && !sameJsonValue(existing.sourceNodeIds, binding.sourceNodeIds))) throw unavailable();
  const sources = await Promise.all(binding.sourceNodeIds.map(id => figma.getNodeByIdAsync(id)));
  if (!sources.every((source): source is SceneNode => source !== null && "visible" in source && !source.removed && nodePage(source)?.id === nodePage(root)?.id)) throw unavailable();
  if (sources.some(source => within(originalResult, source))) throw unavailable();
  const replaceIds = existing?.replaceSourceNodeIds ?? sources.filter(source => source.visible).map(source => source.id);
  if (!replaceIds.length || replaceIds.some(id => !binding.sourceNodeIds.includes(id)) ||
    (input.replacements && input.replacements.length !== replaceIds.length)) throw unavailable();
  const before = JSON.stringify([binding, readStoredOperationSlots(originalResult), existing, root.width, root.height, preview.width, preview.height]);
  const prepared = await prepareNativeCopy(existing ? [root] : [preview, ...sources],
    input.replacements ? new Set(replaceIds) : undefined);
  const replacements = await Promise.all((input.replacements ?? []).map(source => prepareNativeCopy([source])));
  checkCopyBudget([prepared, ...replacements]);
  await Promise.all([...prepared.roots, ...replacements.flatMap(plan => plan.roots)].map(loadSourceFonts));
  const ready = input.assertCurrent();
  if (ready) await ready;
  if ((input.expectedSlots && !sameJsonValue(readStoredOperationSlots(originalResult), input.expectedSlots)) || root.removed || originalResult.removed || sources.some(source => source.removed) ||
    before !== JSON.stringify([readResultBinding(originalResult), readStoredOperationSlots(originalResult), nativeSceneForResult(originalResult), root.width, root.height, preview.width, preview.height])) throw unavailable();
  prepared.validate(); for (const replacement of replacements) replacement.validate();
  input.begin();
  let copyRoot: FrameNode | undefined;
  try {
    const map = new Map<string, SceneNode>(), originals = new Map<string, SceneNode>();
    if (existing) { copyRoot = root.clone(); pairNodes(root, copyRoot, map, originals); figma.currentPage.appendChild(copyRoot); }
    else {
      copyRoot = frame(`${input.name} · Worldbend scene`, 1, 1);
      copyRoot.layoutMode = "HORIZONTAL"; copyRoot.primaryAxisSizingMode = "AUTO"; copyRoot.counterAxisSizingMode = "AUTO"; copyRoot.itemSpacing = 96;
      const sourceArea = frame("Sources · edit originals here", 1, 1); copyRoot.appendChild(sourceArea);
      sourceArea.layoutMode = "VERTICAL"; sourceArea.primaryAxisSizingMode = "AUTO"; sourceArea.counterAxisSizingMode = "AUTO"; sourceArea.itemSpacing = 48;
      const copy = preview.clone(); copyRoot.appendChild(copy); pairNodes(preview, copy, map, originals);
      for (const source of sources) if (!map.has(source.id)) { const clone = source.clone(); sourceArea.appendChild(clone); pairNodes(source, clone, map, originals); }
    }
    const dependencies = sceneDependencyArea(copyRoot);
    for (const source of prepared.roots) if (!map.has(source.id)) {
      const clone = source.clone(); dependencies.appendChild(clone); pairNodes(source, clone, map, originals);
    }
    copyRoot.name = `${input.name} · Worldbend scene`; copyRoot.x = input.placement.x; copyRoot.y = input.placement.y;
    const copyResult = map.get(originalResult.id), copyPreview = map.get(preview.id);
    if (!copyResult || copyResult.type !== "RECTANGLE" || !copyPreview || copyPreview.type !== "FRAME") throw unavailable();
    const slotMap = new Map<string, SceneNode>();
    for (const id of replaceIds) {
      const copy = map.get(id);
      if (!copy) throw unavailable();
      if (copy.type === "FRAME" && !readResultBinding(originals.get(id)!)) { slotMap.set(id, copy); continue; }
      const parent = copy.parent;
      if (!parent || !("appendChild" in parent)) throw unavailable();
      const slotIndex = parent.children.indexOf(copy);
      if (slotIndex < 0) throw unavailable();
      const group = figma.group([copy], parent);
      const wrapper = frame(copy.name, Math.max(1, group.width), Math.max(1, group.height));
      // Wrapping a source changes its container, not its paint order. An
      // appended wrapper would move embedded artwork above foreground masks,
      // ribbons and contact lighting retained in the copied native scene.
      parent.insertChild(slotIndex, wrapper); wrapper.x = group.x; wrapper.y = group.y; wrapper.clipsContent = true;
      wrapper.appendChild(group); group.x = 0; group.y = 0; slotMap.set(id, wrapper);
    }
    const copiedSource = (id: string) => slotMap.get(id) ?? map.get(id);
    const copiedSources = binding.sourceNodeIds.map(copiedSource);
    if (!copiedSources.every((node): node is SceneNode => node !== undefined)) throw unavailable();
    // The scene's primary result gets its new task and first revision below.
    const retained = new Map(prepared.originals); retained.delete(originalResult.id);
    if (input.replacements) for (const id of replaceIds) retained.delete(id);
    rebindClonedNativeGraph(map, retained, copiedSource, true);
    if (input.replacements) for (const original of retained.values()) {
      const slotId = replaceIds.find(id => within(original, prepared.originals.get(id)!));
      if (!slotId || (original.parent?.id !== slotId && original.parent && retained.has(original.parent.id))) continue;
      const copy = map.get(original.id);
      if (copy) dependencies.appendChild(copy);
    }
    const copyReplace = replaceIds.map(copiedSource);
    if (!copyReplace.every((node): node is SceneNode => node !== undefined)) throw unavailable();
    // Artwork slots must clip: Cover/Contain different-aspect content otherwise
    // paints over native decoration outside the slot. Enforce on save and reuse.
    for (const slot of copyReplace) {
      if (slot.type !== "FRAME") throw new Error("Scene artwork slots must be native Frames. Wrap the source in a Frame before saving the scene.");
      slot.clipsContent = true;
    }
    if (input.replacements) for (let index = 0; index < copyReplace.length; index++) {
      replaceSceneArtwork(copyReplace[index] as FrameNode, input.replacements[index]!, input.fit ?? "cover", replacements[index]!, dependencies);
    }
    writeStoredOperation(copyResult, { kind: "task", task: input.task });
    copyResult.setSharedPluginData("worldbend", SHARED_MOCKUP_DRAFT_KEY, "");
    writeStoredBinding(copyResult, { sourceNodeIds: copiedSources.map(node => node.id), renderWidth: input.renderSize?.width ?? binding.renderWidth, renderHeight: input.renderSize?.height ?? binding.renderHeight }, { newResult: true });
    if (input.replacements) {
      copyResult.fills = [];
      writeRasterPaintProof(copyResult);
    }
    const reference: NativeSceneReference = { schema: "worldbend.figma.scene", version: "0.1", sceneId: newNativeSceneId(), pageId: figma.currentPage.id,
      rootNodeId: copyRoot.id, previewNodeId: copyPreview.id, resultNodeId: copyResult.id,
      sourceNodeIds: copiedSources.map(node => node.id), replaceSourceNodeIds: copyReplace.map(node => node.id) };
    copyRoot.setSharedPluginData("worldbend", NATIVE_SCENE_KEY, JSON.stringify(reference));
    pruneSceneDependencies(copyRoot);
    return { root: copyRoot, preview: copyPreview, result: copyResult, reference, replaceSources: copyReplace };
  } catch (error) { if (copyRoot && !copyRoot.removed) copyRoot.remove(); throw error; }
}
