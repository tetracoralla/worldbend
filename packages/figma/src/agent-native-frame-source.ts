import { canUseNativeSource, nativeAppearanceInsideViewport, nodePage } from "./native-document";
import { componentNativeSourceOwner } from "./native-component";
import { prepareNativeCopy, nativeNodeSnapshot } from "./native-copy-closure";
import { fingerprintState, figmaError } from "./state-fingerprint";

/** Source facts are read in the host, solved in core, then checked again at
 * publication. A caller-supplied size is never a replacement for this proof. */
export async function prepareNativeFrameSource(sourceNodeId:string,fileKey:string,pageId:string) {
  if(figma.fileKey!==fileKey||figma.currentPage.id!==pageId)throw figmaError("SCOPE","use the granted native source page");
  const node=await figma.getNodeByIdAsync(sourceNodeId);
  if(node?.type!=="FRAME"||nodePage(node)?.id!==pageId)throw figmaError("INPUT","native source Frame unavailable");
  const owner=await componentNativeSourceOwner(node);
  if(!owner&&(!canUseNativeSource(node)||!nativeAppearanceInsideViewport(node)))throw figmaError("INPUT","native output needs a clipped Frame with its appearance inside the source, or an owned native Content Frame");
  const proof=await prepareNativeCopy([owner??node]);
  const expected=fingerprintState(JSON.stringify([...proof.originals.values()].map(n=>[n.id,nativeNodeSnapshot(n)]).sort(([a],[b])=>a!<b!?-1:a!>b!?1:0)));
  return {source:node,proof,owner,...(owner?{pageBasis:owner.absoluteTransform.map(row=>[...row]) as Transform}:{}),
    facts:{sourceNodeId:node.id,width:node.width,height:node.height,expected}};
}
