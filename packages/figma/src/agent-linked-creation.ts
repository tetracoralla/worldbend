import { nodePage } from "./native-document";
import { placementBeside } from "./result-placement";
import { writeStoredBinding } from "./stored-binding";
import { writeStoredOperation, type StoredOperation } from "./stored-operation";
import { linkedTargetExpected } from "./agent-linked-results";
import type { Placement } from "./messages";
import { recoverCreation } from "./creation-recovery";

export interface LinkedCreationInput {
  fileKey: string; pageId: string; sourceNodeIds: string[]; requestId: string; name?: string;
}

/** Recover the exact original, including after native reparenting. A native
 * duplicate carries the marker but cannot acquire its original's identity. */
export async function createLinkedArtifact<Snapshot>(input: LinkedCreationInput, operation: StoredOperation,
  size: {width:number;height:number}|(()=>Promise<{width:number;height:number}>), options: {key:string;identity:string;schema:string;defaultName?:string;inspect(result:RectangleNode):Promise<Snapshot>}) {
  if (figma.fileKey !== input.fileKey) throw Error("E_FIGMA_SCOPE: the granted file does not match the active file");
  const page = await figma.getNodeByIdAsync(input.pageId);
  const assertScope = () => {
    if (figma.fileKey !== input.fileKey || page?.type !== "PAGE" || page.removed || figma.currentPage.id !== input.pageId) {
      throw Error("E_FIGMA_SCOPE: create work on the granted live page in this Figma file");
    }
  };
  assertScope();
  const identity = options.identity;
  const describe = async (result: RectangleNode, reused: boolean) => {
    const snapshot = await options.inspect(result);
    assertScope();
    const published = result.fills !== figma.mixed && result.fills.some(fill => fill.type === "IMAGE" && !!fill.imageHash);
    return { schema: options.schema, version: "0.1", fileKey: input.fileKey, pageId: input.pageId,
      requestId: input.requestId, reused, status: published ? "published" : "needs-publication", snapshot,
      affectedNodeIds: reused ? [] : [result.id] };
  };
  const findCreated = (create?: () => RectangleNode) => {
    assertScope();
    return recoverCreation(page as PageNode, input.requestId, options.key, identity,
      (node): node is RectangleNode => node.type === "RECTANGLE", create, create ? 1 : 0);
  };
  const existing = await findCreated();
  if (existing) return describe(existing, true);
  // Recovery describes the original's current bindings. A provisional size
  // must not require obsolete sources after an explicit source replacement.
  const initialSize=typeof size==="function"?await size():size;
  assertScope();
  const sources = await Promise.all(input.sourceNodeIds.map(id => figma.getNodeByIdAsync(id)));
  const assertSources = () => {
    assertScope();
    if (!sources.every(node => node && !node.removed && "exportAsync" in node && "width" in node && "height" in node &&
      nodePage(node)?.id === input.pageId && Number.isFinite(node.width) && node.width > 0 && Number.isFinite(node.height) && node.height > 0)) {
      throw Error("E_FIGMA_INPUT: work sources must be exportable artwork on the granted page");
    }
  };
  assertSources();
  const bounds = (node: BaseNode | null): Placement | undefined => {
    if (!node || !("absoluteBoundingBox" in node)) return undefined;
    const box = node.absoluteBoundingBox;
    return box && Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0 ? box : undefined;
  };
  let result: RectangleNode | undefined;
  let initial: string | undefined;
  const signature = (node: RectangleNode) => JSON.stringify({
    state: linkedTargetExpected(node),
    creation: node.getSharedPluginData("worldbend", options.key),
  });
  try {
    // The final retry scan and first write share one synchronous step. New
    // Page roots observed at this boundary are included before that step;
    // concurrent retries cannot both finish a read-only scan then create.
    const accepted = await findCreated(() => {
      assertSources();
      const placement = placementBeside(sources.map(bounds).filter((box): box is Placement => !!box), initialSize,
        (page as PageNode).children.map(bounds).filter((box): box is Placement => !!box));
      result = figma.createRectangle();
      result.name = input.name?.trim() ?? options.defaultName ?? "Worldbend work";
      result.resize(placement.width, placement.height);
      result.x = placement.x; result.y = placement.y; result.fills = []; result.strokes = [];
      writeStoredOperation(result, operation);
      writeStoredBinding(result, { sourceNodeIds: input.sourceNodeIds, renderWidth: placement.width, renderHeight: placement.height });
      result.setSharedPluginData("worldbend", options.key, JSON.stringify({ requestId: input.requestId, identity, nodeId: result.id }));
      initial = signature(result);
      return result;
    });
    if (!accepted) throw Error("E_FIGMA_STATE: work creation did not produce a result");
    return await describe(accepted, accepted !== result);
  } catch (error) {
    // Remove only the unused object this call still owns; an edit made while
    // its sources were exported must remain available for recovery.
    if (result && !result.removed && (initial === undefined || signature(result) === initial)) result.remove();
    throw error;
  }
}
