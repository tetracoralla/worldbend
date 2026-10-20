import { prepareNativeFrameSource } from "./agent-native-frame-source";
import type { NineNumbers, TransformSpec, NativeFramePlan } from "@worldbend/web/types";
import { recoverCreation } from "./creation-recovery";
import { inspect } from "./agent-handoff";
import { canUseNativeSource, nativeAppearanceInsideViewport, loadNativeRenderer, nodePage, publishNativeResult } from "./native-document";
import { prepareNativeCopy } from "./native-copy-closure";
import { isOwnedTransformSpec } from "./stored-plane";
import { placementBeside } from "./result-placement";
import type { Placement } from "./messages";
import {nativeOutputBounds,nativeOutputAtBounds} from "./native-output-position";
import {nativeCopyPlacementNodeCount} from "./native-copy-placement";

export interface NativeCreateInput {
  fileKey: string; pageId: string; sourceNodeId: string; requestId: string; name?: string;
  spec: TransformSpec; inverse: NineNumbers; width: number; height: number;
  renderWidth: number; renderHeight: number;
  nativePlan?:NativeFramePlan;
  sourceFacts?:{sourceNodeId:string;width:number;height:number;expected:string};
}

/** Publish the same independent, editable native Content used by the human
 * Perspective entry. Canonical solving belongs to the packet preparer.
 */
export async function createNative(input: NativeCreateInput) {
  if (!isOwnedTransformSpec(input.spec) || input.spec.content.warp || input.spec.destination.space !== "normalized" ||
    ![input.width, input.height].every(v => Number.isFinite(v) && v >= .01 && v <= 4096) ||
    input.renderWidth !== Math.ceil(input.width) || input.renderHeight !== Math.ceil(input.height) ||
    input.inverse.length !== 9 || !input.inverse.every(Number.isFinite) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(input.requestId) ||
    (input.name !== undefined && (!input.name.trim() || Array.from(input.name).length > 80))) throw Error("E_FIGMA_INPUT: invalid native creation");
  const page = await figma.getNodeByIdAsync(input.pageId);
  const scope = () => {
    if (figma.fileKey !== input.fileKey || page?.type !== "PAGE" || page.removed || figma.currentPage.id !== input.pageId) {
      throw Error("E_FIGMA_SCOPE: create on the granted live page");
    }
  };
  scope();
  const identity = JSON.stringify(input);
  const find = (create?: () => Promise<FrameNode>, reserveNodes = 0) => {
    scope();
    return recoverCreation(page as PageNode, input.requestId, "nativeCreation", identity,
      (node): node is FrameNode => node.type === "FRAME", create, reserveNodes);
  };
  const describe = async (result: FrameNode, reused: boolean) => {
    const snapshot = await inspect(result.id, input.fileKey, input.pageId);
    scope();
    return { schema: "worldbend.figma.native-creation", version: "0.1", fileKey: input.fileKey,
      pageId: input.pageId, nodeId: result.id, requestId: input.requestId, reused, status: "published",
      snapshot, affectedNodeIds: reused ? [] : [result.id] };
  };
  const existing = await find();
  if (existing) return describe(existing, true);
  const prepared=await prepareNativeFrameSource(input.sourceNodeId,input.fileKey,input.pageId);
  const {source:artwork,proof}=prepared;
  scope();
  if(input.sourceFacts&&(input.sourceFacts.sourceNodeId!==prepared.facts.sourceNodeId||input.sourceFacts.width!==prepared.facts.width||
    input.sourceFacts.height!==prepared.facts.height||input.sourceFacts.expected!==prepared.facts.expected))throw Error("E_FIGMA_CONFLICT: native source facts changed; read again");
  if(input.nativePlan&&!input.sourceFacts)throw Error("E_FIGMA_INPUT: native plan needs read source facts");
  const renderer = input.nativePlan?.kind==="affine"?undefined:await loadNativeRenderer(page as PageNode, undefined, "publish");
  const validate = () => {
    scope();
    try { proof.validate(); } catch { throw Error("E_FIGMA_CONFLICT: source changed; reread before creating native work"); }
  };
  validate();
  if (!renderer&&input.nativePlan?.kind!=="affine") throw Error("E_FIGMA_RENDERER: the native sampler is unavailable; use linked HD or retry after it becomes available");
  const bounds = (node: SceneNode): Placement[] => {
    const box = node.visible && node.absoluteBoundingBox;
    return box && Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0 ? [box] : [];
  };
  let created: FrameNode | undefined;
  const size={width:input.width,height:input.height};
  const freeBounds=placementBeside(bounds(artwork),nativeOutputBounds(size,prepared.pageBasis),(page as PageNode).children.flatMap(bounds));
  const pageBasis=nativeOutputAtBounds(size,freeBounds,prepared.pageBasis);
  const accepted = await find(() => publishNativeResult({
    source: artwork, ...(renderer?{renderer}:{}), ...(input.nativePlan?{nativePlan:input.nativePlan}:{}), spec: input.spec, inverse: input.inverse,
    placement:{...size,x:pageBasis[0][2],y:pageBasis[1][2]},
    renderWidth: input.renderWidth, renderHeight: input.renderHeight,
    beforeWrite: validate,
    onCreated: result => {
      created = result;
      result.setSharedPluginData("worldbend", "nativeCreation", JSON.stringify({ nodeId: result.id, requestId: input.requestId, identity }));
      if (input.name) result.name = input.name.trim();
    },
  }), (prepared.owner?proof.nodeCount+nativeCopyPlacementNodeCount(prepared.owner):input.nativePlan?proof.nodeCount*2+5:proof.nodeCount+2)
    // A first sampled publication can also create its hidden page resource.
    + (prepared.owner || renderer ? 1 : 0));
  if (!accepted) throw Error("E_FIGMA_STATE: native creation did not produce a result");
  return describe(accepted, accepted !== created);
}

/** Read-only first phase of the same creation tool. No request is published. */
export async function probeNativeSource(input:Pick<NativeCreateInput,"fileKey"|"pageId"|"sourceNodeId">) {
  const {facts}=await prepareNativeFrameSource(input.sourceNodeId,input.fileKey,input.pageId);
  return {schema:"worldbend.figma.native-source-facts",version:"0.1",fileKey:input.fileKey,pageId:input.pageId,sourceFacts:facts,
    next:"Repeat figma_native_create with these sourceFacts; core will plan the native frame before publication."};
}
