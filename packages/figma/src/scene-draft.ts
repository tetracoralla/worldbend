import type { Placement } from "./messages";
import { isSceneDraftToken } from "./scene-draft-id";

const DRAFT_MARKER = "sceneDraft";
const DRAFT_SESSION_MARKER = "sceneDraftSession";
const DRAFT_RETIRED_MARKER = "sceneDraftRetired";

export interface SceneDraftPayload {
  generation: number;
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
}

export interface SceneDraftSession {
  readonly sessionId: string;
  isOwnedNode(node: BaseNode): boolean;
  isOwnedNodeId(id: string): boolean;
  forgetNodeId(id: string): void;
  sweepRetired(page: PageNode): void;
  clear(page: PageNode): void;
  update(page: PageNode, payload: SceneDraftPayload, sourceName: string): void;
}

/** All private-marked previews are excluded from source selection and placement. */
export function isSceneDraftNode(node: BaseNode): boolean {
  return node.getPluginData(DRAFT_MARKER) === "1";
}

/**
 * Own one canvas-preview lifecycle.
 *
 * The session id is new for every plugin invocation. A run therefore never
 * updates or removes another run's live node, including another collaborator's
 * preview. Cleanup marks its own node retired before removal, giving later
 * runs a positive, document-local signal they may safely sweep if host Undo
 * resurrects the node. An unretired node is never guessed to be stale.
 */
export function createSceneDraftSession(sessionId: string): SceneDraftSession {
  if (!isSceneDraftToken(sessionId)) {
    throw new Error("Scene draft identity is invalid");
  }

  // Figma batches nodechange delivery, so a DELETE can arrive after a draft
  // was cleared and a later one was created. Retain ids until those DELETE
  // notifications arrive; otherwise they can masquerade as source changes.
  const draftNodeIds = new Set<string>();

  const isOwnedNode = (node: BaseNode): boolean =>
    isSceneDraftNode(node) &&
    node.getPluginData(DRAFT_SESSION_MARKER) === sessionId &&
    node.getPluginData(DRAFT_RETIRED_MARKER) !== "1";

  const retireOwnedNode = (node: SceneNode): boolean => {
    if (!isOwnedNode(node)) return false;
    try { node.setPluginData(DRAFT_RETIRED_MARKER, "1"); } catch { /* still remove only our node */ }
    return true;
  };

  const remove = (page: PageNode, accepts: (node: SceneNode) => boolean): boolean => {
    let removed = false;
    for (const node of [...page.children]) {
      if (!accepts(node)) continue;
      draftNodeIds.add(node.id);
      node.remove();
      removed = true;
    }
    return removed;
  };

  const session: SceneDraftSession = {
    sessionId,
    isOwnedNode,
    isOwnedNodeId(id) {
      return draftNodeIds.has(id);
    },
    forgetNodeId(id) {
      draftNodeIds.delete(id);
    },
    sweepRetired(page) {
      // Retired is written by that session's own synchronous cleanup before
      // removal. Session age, client identity, or a marker alone do not prove
      // that another plugin instance is no longer active.
      if (remove(page, (node) =>
        isSceneDraftNode(node) && node.getPluginData(DRAFT_RETIRED_MARKER) === "1"
      )) figma.commitUndo();
    },
    clear(page) {
      // If host Undo later resurrects the removed node, its retired marker
      // makes the next cleanup safe without relying on session-age guesses.
      if (remove(page, retireOwnedNode)) figma.commitUndo();
    },
    update(page, payload, sourceName) {
      if (payload.bytes.byteLength < 1) return;
      let created: RectangleNode | undefined;
      try {
        const existing = page.children.find(isOwnedNode);
        const image = figma.createImage(payload.bytes);
        const node = existing?.type === "RECTANGLE" ? existing : undefined;
        if (!node) {
          if (existing) {
            draftNodeIds.add(existing.id);
            existing.remove();
          }
          figma.commitUndo();
          created = figma.createRectangle();
          created.setPluginData(DRAFT_SESSION_MARKER, sessionId);
          created.setPluginData(DRAFT_RETIRED_MARKER, "0");
          created.setPluginData(DRAFT_MARKER, "1");
          created.locked = true;
          draftNodeIds.add(created.id);
          paintDraft(created, payload, sourceName, image.hash);
          return;
        }
        draftNodeIds.add(node.id);
        paintDraft(node, payload, sourceName, image.hash);
      } catch {
        // The host rejected this frame. Remove only the partially painted node
        // from this session; another collaborator's feedback is never cleanup.
        if (created && !created.removed) {
          draftNodeIds.add(created.id);
          try { created.setPluginData(DRAFT_RETIRED_MARKER, "1"); } catch { /* host rejected metadata */ }
          try { created.remove(); } catch { /* host already discarded it */ }
        }
        remove(page, retireOwnedNode);
      }
    },
  };
  return session;
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
