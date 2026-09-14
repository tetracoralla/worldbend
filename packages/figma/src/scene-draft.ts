import type { Placement } from "./messages";

const DRAFT_MARKER = "sceneDraft";

export interface SceneDraftPayload {
  generation: number;
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
}

/** Preview nodes carry only this private marker — never a stored operation or binding. */
export function isSceneDraftNode(node: BaseNode): boolean {
  return node.getPluginData(DRAFT_MARKER) === "1";
}

// Figma batches nodechange delivery, so a DELETE can arrive after a draft was
// cleared and a later one was created. Keep every draft id from this plugin run
// instead of only the current id; otherwise an older DELETE can masquerade as
// source deletion and reload the active editing session.
const draftNodeIds = new Set<string>();

/**
 * Identity check that also covers a nodechange reporting an already-removed
 * draft, where only the id survives.
 */
export function isSceneDraftNodeId(id: string): boolean {
  return draftNodeIds.has(id);
}

/** Release a removed draft id after its host DELETE notification arrives. */
export function forgetSceneDraftNodeId(id: string): void {
  draftNodeIds.delete(id);
}

/** Remove previews left behind by an abnormal exit; they are never reused. */
export function sweepStaleSceneDrafts(page: PageNode): void {
  // Same removal as a live clear: an uncommitted delete merges into the
  // user's next undo step and can resurrect the leftover with Cmd+Z.
  clearSceneDraft(page);
}

/**
 * Remove the live working preview without replaying host history.
 *
 * Figma exposes no draft-only scene layer. Using triggerUndo here is unsafe:
 * an artwork edit made after the draft boundary can sit above the draft and
 * would be undone first. Direct removal can leave a no-op host Undo item, but
 * it never trades history cleanliness for the user's document data.
 */
export function clearSceneDraft(page: PageNode): void {
  let removed = false;
  for (const node of [...page.children]) {
    if (isSceneDraftNode(node)) {
      draftNodeIds.add(node.id);
      node.remove();
      removed = true;
    }
  }
  if (removed) figma.commitUndo();
}

/**
 * Maintain the single locked canvas working preview in one host transaction. Commit the
 * user's pending artwork changes before creating it, so direct cleanup cannot
 * merge with or roll back those changes. Frame updates never add history
 * entries of their own.
 */
export function updateSceneDraft(
  page: PageNode,
  payload: SceneDraftPayload,
  sourceName: string,
): void {
  if (payload.bytes.byteLength < 1) return;
  const existing = page.children.find(isSceneDraftNode);
  const image = figma.createImage(payload.bytes);
  const node = existing?.type === "RECTANGLE" ? existing : undefined;
  if (!node) {
    if (existing) {
      draftNodeIds.add(existing.id);
      existing.remove();
    }
    figma.commitUndo();
    const created = figma.createRectangle();
    created.setPluginData(DRAFT_MARKER, "1");
    created.locked = true;
    draftNodeIds.add(created.id);
    paintDraft(created, payload, sourceName, image.hash);
    return;
  }
  draftNodeIds.add(node.id);
  paintDraft(node, payload, sourceName, image.hash);
}

function paintDraft(
  node: RectangleNode,
  payload: SceneDraftPayload,
  sourceName: string,
  imageHash: string,
): void {
  const width = Math.max(0.01, Math.min(Number.MAX_SAFE_INTEGER, payload.placement.width));
  const height = Math.max(0.01, Math.min(Number.MAX_SAFE_INTEGER, payload.placement.height));
  node.name = `${sourceName} · Worldbend Working Preview`;
  node.resize(width, height);
  node.x = payload.placement.x;
  node.y = payload.placement.y;
  node.fills = [{ type: "IMAGE", imageHash, scaleMode: "FILL" }];
}
