import type { Placement } from "./messages";

const DRAFT_MARKER = "sceneDraft";

export interface SceneDraftPayload {
  generation: number;
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
}

/** Draft nodes carry only this private marker — never a stored operation or binding. */
export function isSceneDraftNode(node: BaseNode): boolean {
  return node.getPluginData(DRAFT_MARKER) === "1";
}

let draftNodeId: string | undefined;

/**
 * Identity check that also covers a nodechange reporting an already-removed
 * draft, where only the id survives.
 */
export function isSceneDraftNodeId(id: string): boolean {
  return id === draftNodeId;
}

/** Remove drafts left behind by an abnormal exit; they are never reused. */
export function sweepStaleSceneDrafts(page: PageNode): void {
  for (const node of [...page.children]) {
    if (isSceneDraftNode(node)) node.remove();
  }
}

/**
 * Remove the live draft and close its undo episode. One boundary after
 * removal keeps the whole draft lifetime inside a single host undo step;
 * updates themselves never commit.
 */
export function clearSceneDraft(page: PageNode): void {
  let removed = false;
  for (const node of [...page.children]) {
    if (isSceneDraftNode(node)) {
      node.remove();
      removed = true;
    }
  }
  draftNodeId = undefined;
  if (removed) figma.commitUndo();
}

/**
 * Maintain the single locked canvas draft. The pre-create commit snapshots
 * the document before the draft exists; subsequent fill swaps merge into the
 * same pending undo step so dragging never produces per-frame history.
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
    if (existing) existing.remove();
    const created = figma.createRectangle();
    created.setPluginData(DRAFT_MARKER, "1");
    created.locked = true;
    figma.commitUndo();
    page.appendChild(created);
    draftNodeId = created.id;
    paintDraft(created, payload, sourceName, image.hash);
    return;
  }
  draftNodeId = node.id;
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
  node.name = `${sourceName} · Worldbend draft`;
  node.resize(width, height);
  node.x = payload.placement.x;
  node.y = payload.placement.y;
  node.fills = [{ type: "IMAGE", imageHash, scaleMode: "FILL" }];
}
