import { inspectMockup } from "./agent-handoff";
import { copyNativeScene, nativeSceneForResult } from "./native-scene-main";
import { NATIVE_SCENE_TEMPLATE_KEY, NATIVE_SCENE_CREATION_KEY, parseNativeSceneTemplateMarker, parseNativeSceneReference } from "./native-scene-model";
import type { NativeSceneReference } from "./native-scene-model";
import { createReadyScene } from "./ready-scenes-main";
import { isReadySceneId, readyScene, type ReadySceneId, type SceneArtworkFit } from "./ready-scenes";
import { nodePage } from "./native-document";
import { readStoredOperationSlots } from "./stored-operation";
import { placementBeside } from "./result-placement";
import type { Placement } from "./messages";

type SceneChoice = { kind: "ready"; id: ReadySceneId } |
  { kind: "native"; nodeId: string; revision: number; expected: string };
export interface AgentSceneCreateInput {
  fileKey: string; pageId: string; scene: SceneChoice; artworkNodeIds: string[];
  fit: SceneArtworkFit; name?: string; requestId: string;
}
const conflict = () => Error("E_FIGMA_CONFLICT: inspect changed scene");
class ExistingCreation extends Error {
  constructor(readonly root: FrameNode) { super(); }
}
function bounds(node: SceneNode): Placement | undefined {
  const box = node.absoluteBoundingBox;
  return box && [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0 ? box : undefined;
}

/** Create an independent editable instance, then return the actual new
 * snapshot for ordinary source export/core rendering/guarded publication.
 * Until that publication its projection is deliberately empty. */
type CreatedScene = { root: FrameNode; preview: FrameNode; result: RectangleNode; reference: NativeSceneReference };
type CreationContext = { artwork: SceneNode[]; occupied: Placement[]; obstacles: Placement[]; assertBeforeCreate(): Promise<void> };

export function createScene(input: AgentSceneCreateInput) {
  return input.scene.kind === "ready" ? createReadySceneInstance(input) : createNativeSceneInstance(input);
}

export function createReadySceneInstance(input: AgentSceneCreateInput) {
  if (input.scene.kind !== "ready") throw Error("E_FIGMA_INPUT: choose ready scene");
  const choice = input.scene;
  return createSceneWith(input, async ({ artwork, occupied, obstacles, assertBeforeCreate }) => {
    if (!isReadySceneId(choice.id) || artwork.length !== 1) throw Error("E_FIGMA_INPUT: choose one artwork");
    const scene = readyScene(choice.id);
    return createReadyScene({ id: choice.id, artwork: artwork[0]!, fit: input.fit,
      placement: placementBeside(occupied, { width: scene.surface.width + 96 + scene.width, height: Math.max(scene.surface.height, scene.height) }, obstacles),
      assertCurrent: assertBeforeCreate, begin: () => {} });
  });
}

export function createNativeSceneInstance(input: AgentSceneCreateInput) {
  if (input.scene.kind !== "native") throw Error("E_FIGMA_INPUT: choose native scene");
  const choice = input.scene;
  return createSceneWith(input, async ({ artwork, occupied, obstacles, assertBeforeCreate }) => {
    const fresh = await inspectMockup(choice.nodeId, input.fileKey, input.pageId);
    if (fresh.expected !== choice.expected || fresh.revision !== choice.revision) throw conflict();
    const result = await figma.getNodeByIdAsync(choice.nodeId);
    if (result?.type !== "RECTANGLE") throw conflict();
    const reference = nativeSceneForResult(result);
    if (!reference || reference.replaceSourceNodeIds.length !== artwork.length) throw Error("E_FIGMA_INPUT: artwork per slot required");
    const root = await figma.getNodeByIdAsync(reference.rootNodeId);
    if (root?.type !== "FRAME" || !bounds(root)) throw conflict();
    const marker = parseNativeSceneTemplateMarker(root.getSharedPluginData("worldbend", NATIVE_SCENE_TEMPLATE_KEY));
    const created = await copyNativeScene({ result, reference, expectedSlots: readStoredOperationSlots(result), task: fresh.task,
      name: input.name?.trim() ?? marker?.name ?? root.name.replace(/ · Worldbend scene$/, ""),
      placement: placementBeside([...occupied, bounds(root)!], { width: root.width, height: root.height }, obstacles),
      replacements: artwork, fit: input.fit, begin: () => {}, assertCurrent: async () => {
        const current = await inspectMockup(choice.nodeId, input.fileKey, input.pageId);
        if (current.expected !== choice.expected || current.revision !== choice.revision) throw conflict();
        await assertBeforeCreate();
      } });
    created.root.setSharedPluginData("worldbend", NATIVE_SCENE_TEMPLATE_KEY, "");
    return created;
  });
}

async function createSceneWith(input: AgentSceneCreateInput, build: (context: CreationContext) => Promise<CreatedScene>) {
  if (!input.artworkNodeIds.length || input.artworkNodeIds.length > 8 ||
    new Set(input.artworkNodeIds).size !== input.artworkNodeIds.length ||
    !input.artworkNodeIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 256) ||
    !["cover", "contain"].includes(input.fit) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId) ||
    (input.name !== undefined && (!input.name.trim() || Array.from(input.name).length > 80)) ||
    !["ready", "native"].includes(input.scene.kind)) throw Error("E_FIGMA_INPUT: invalid scene");
  const page = await figma.getNodeByIdAsync(input.pageId);
  const assertScope = () => {
    if (figma.fileKey !== input.fileKey || !page || page.type !== "PAGE" || page.removed || figma.currentPage.id !== input.pageId) {
      throw Error("E_FIGMA_SCOPE: wrong file/page");
    }
  };
  assertScope();
  const identity = JSON.stringify(input);
  const findCreated = async () => {
    const pending: Array<readonly [BaseNode, number]> = (page as PageNode).children.map(node => [node, 0]);
    let visited = 0;
    while (pending.length) {
      const [ref, depth] = pending.pop()!;
      if (++visited > 20000 || depth > 64) throw Error("E_FIGMA_LIMIT: 20000 nodes / 64 levels");
      const root = await figma.getNodeByIdAsync(ref.id);
      if (!root) continue;
      if ("children" in root) pending.push(...root.children.map(node => [node, depth + 1] as const));
      if (root.type !== "FRAME") continue;
      const raw = root.getSharedPluginData("worldbend", NATIVE_SCENE_CREATION_KEY);
      if (!raw) continue;
      let saved: { requestId?: string; identity?: string; rootNodeId?: string };
      try { saved = JSON.parse(raw); if (!saved || typeof saved !== "object") continue; } catch { continue; }
      const owner = saved.rootNodeId ?? parseNativeSceneReference(root.getSharedPluginData("worldbend", "nativeScene"))?.rootNodeId;
      if (saved.requestId !== input.requestId || (owner && owner !== root.id)) continue;
      if (saved.identity !== identity) throw Error("E_FIGMA_CONFLICT: identity changed");
      return root;
    }
    return undefined;
  };
  const describe = async (root: FrameNode, reused: boolean) => {
    const reference = parseNativeSceneReference(root.getSharedPluginData("worldbend", "nativeScene"));
    if (!reference || reference.rootNodeId !== root.id) throw Error("E_FIGMA_STATE: repair scene");
    const result = await figma.getNodeByIdAsync(reference.resultNodeId);
    if (result?.type !== "RECTANGLE" || nativeSceneForResult(result)?.sceneId !== reference.sceneId) throw Error("E_FIGMA_STATE: inspect scene");
    const snapshot = await inspectMockup(result.id, input.fileKey, input.pageId);
    assertScope();
    const published = result.fills !== figma.mixed && result.fills.some(fill => fill.type === "IMAGE" && !!fill.imageHash);
    return { schema: "worldbend.figma.scene-creation", version: "0.1", fileKey: input.fileKey, pageId: input.pageId,
      requestId: input.requestId, reused, status: published ? "published" : "needs-publication", nativeScene: reference, snapshot,
      affectedNodeIds: reused ? [] : [root.id, reference.previewNodeId, result.id, ...reference.sourceNodeIds] };
  };
  const existing = await findCreated();
  if (existing) return describe(existing, true);
  const artwork = await Promise.all(input.artworkNodeIds.map(id => figma.getNodeByIdAsync(id)));
  if (!artwork.every((node): node is SceneNode => !!node && "visible" in node && !node.removed &&
    !!nodePage(node) && Number.isFinite(node.width) && Number.isFinite(node.height) && node.width > 0 && node.height > 0)) {
    throw Error("E_FIGMA_INPUT: invalid artwork");
  }
  const artworkPages = artwork.map(node => nodePage(node)!.id);
  const assertArtwork = () => {
    assertScope();
    if (artwork.some((node, index) => node.removed || nodePage(node)?.id !== artworkPages[index] ||
      !Number.isFinite(node.width) || !Number.isFinite(node.height) || node.width <= 0 || node.height <= 0)) throw conflict();
  };
  const assertBeforeCreate = async () => {
    const existing = await findCreated();
    if (existing) throw new ExistingCreation(existing);
    assertArtwork();
  };
  const pageNodes = await Promise.all((page as PageNode).children.map(node => figma.getNodeByIdAsync(node.id)));
  const obstacles = pageNodes.filter((node): node is SceneNode => !!node && "visible" in node && node.visible)
    .map(bounds).filter((box): box is Placement => !!box);
  const occupied = artwork.filter(node => nodePage(node)?.id === input.pageId).map(bounds).filter((box): box is Placement => !!box);
  let created: CreatedScene | undefined;
  try {
    created = await build({ artwork, occupied, obstacles, assertBeforeCreate });
    if (input.name) created.root.name = `${input.name.trim()} · Worldbend scene`;
    created.root.setSharedPluginData("worldbend", NATIVE_SCENE_CREATION_KEY, JSON.stringify({ requestId: input.requestId, identity, rootNodeId: created.root.id }));
    assertScope();
    return await describe(created.root, false);
  } catch (error) {
    if (created && !created.root.removed) created.root.remove();
    if (error instanceof ExistingCreation) return describe(error.root, true);
    throw error;
  }
}
