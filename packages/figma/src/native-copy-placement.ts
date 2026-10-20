import {coordinateParent,pointInCoordinateParent} from "./coordinate-parent";
import {nativeOutputBounds} from "./native-output-position";
import {SHARED_NAMESPACE} from "./stored-plane";

export const NATIVE_PLACEMENT_KEY="nativePlacement";
const marker="worldbend.figma.coordinate-container/0.1";
const clone=(matrix:Transform):Transform=>matrix.map(row=>[...row]) as Transform;
const linear=(matrix:Transform):Transform=>[[matrix[0][0],matrix[0][1],0],[matrix[1][0],matrix[1][1],0]];
export function isNativePlacementContainer(node:BaseNode|null):node is FrameNode {
  return node?.type==="FRAME"&&node.getSharedPluginData(SHARED_NAMESPACE,NATIVE_PLACEMENT_KEY)===marker;
}
export function nativePlacementContainers(node:BaseNode):FrameNode[] {
  const containers:FrameNode[]=[];
  for(let parent=node.parent;isNativePlacementContainer(parent);parent=parent.parent){
    if(containers.length>=64)throw Error("Native coordinate context exceeds 64 levels");containers.push(parent);
  }
  return containers;
}
/** A selected coordinate wrapper still edits its one owned native work. */
export function nativePlacementSelection(node:SceneNode):SceneNode {
  let current=node;
  for(let depth=0;isNativePlacementContainer(current)&&depth<64;depth++){
    if(current.children.length!==1||current.children[0]?.type!=="FRAME")return node;
    current=current.children[0];
  }
  return current;
}
/** Fit transparent coordinate layers without moving the artwork in page space.
 * This is host coordinate transport; the native/core projection is unchanged. */
export function fitNativePlacementContainers(node:FrameNode):void {
  let child=node;
  for(const parent of nativePlacementContainers(node)){
    if(parent.children.length!==1||parent.children[0]?.id!==child.id||parent.clipsContent||parent.layoutMode!=="NONE")
      throw Error("Native coordinate context changed");
    const bounds=nativeOutputBounds(child,child.relativeTransform),matrix=clone(parent.relativeTransform),childMatrix=clone(child.relativeTransform);
    matrix[0][2]+=matrix[0][0]*bounds.x+matrix[0][1]*bounds.y;
    matrix[1][2]+=matrix[1][0]*bounds.x+matrix[1][1]*bounds.y;
    childMatrix[0][2]-=bounds.x;childMatrix[1][2]-=bounds.y;
    parent.resizeWithoutConstraints(bounds.width,bounds.height);parent.relativeTransform=matrix;child.relativeTransform=childMatrix;
    child=parent;
  }
}
function needsIndependentContext(node:BaseNode):boolean {
  let parent=node.parent;
  for(let depth=0;parent&&parent.type!=="PAGE"&&parent.type!=="DOCUMENT";depth++,parent=parent.parent){
    if(depth>=64)throw Error("Native coordinate ancestry exceeds 64 levels");
    if(isNativePlacementContainer(parent)||"clipsContent" in parent&&parent.clipsContent||"layoutMode" in parent&&parent.layoutMode!=="NONE")return true;
  }
  return false;
}
function contextMatrices(original:FrameNode):Transform[] {
  const absolute=original.absoluteTransform;
  if(!needsIndependentContext(original)||[0,1].every(column=>Math.abs(Math.hypot(absolute[0][column]!,absolute[1][column]!)-1)<=1e-7))return [];
  const matrices:Transform[]=[];
  for(let parent=coordinateParent(original);parent&&"absoluteTransform" in parent;parent=coordinateParent(parent)){
    if(matrices.length>=64||!("relativeTransform" in parent))throw Error("Native coordinate ancestry unavailable");
    matrices.unshift(linear(parent.relativeTransform));
  }
  return matrices;
}
export const nativeCopyPlacementNodeCount=(original:FrameNode)=>contextMatrices(original).length;
/** Keep ordinary unconstrained parents. Escape clipping and layout ownership;
 * when Figma cannot store the composed affine basis on one Frame, retain only
 * its legal coordinate matrices in transparent, fitted page-root layers. */
export function placeIndependentNativeCopy(result:FrameNode,original:FrameNode,origin:{x:number;y:number}):FrameNode {
  if(![origin.x,origin.y].every(Number.isFinite))throw Error("Native copy position unavailable");
  if(!needsIndependentContext(original)){
    if(!original.parent||!("appendChild" in original.parent))throw Error("Native copy parent unavailable");
    original.parent.appendChild(result);result.relativeTransform=clone(original.relativeTransform);
    const point=pointInCoordinateParent(result,origin);result.x=point.x;result.y=point.y;return result;
  }
  const absolute=original.absoluteTransform;
  if([0,1].every(column=>Math.abs(Math.hypot(absolute[0][column]!,absolute[1][column]!)-1)<=1e-7)){
    figma.currentPage.appendChild(result);result.relativeTransform=[[absolute[0][0],absolute[0][1],origin.x],[absolute[1][0],absolute[1][1],origin.y]];
    return result;
  }
  const matrices=contextMatrices(original);
  const owned:FrameNode[]=[];
  try {
    let parent:PageNode|FrameNode=figma.currentPage;
    for(const matrix of matrices){
      const frame=figma.createFrame();owned.push(frame);frame.name=owned.length===1?result.name:"Coordinate space";
      frame.fills=[];frame.strokes=[];frame.effects=[];frame.layoutMode="NONE";frame.clipsContent=false;
      frame.setSharedPluginData(SHARED_NAMESPACE,NATIVE_PLACEMENT_KEY,marker);parent.appendChild(frame);frame.relativeTransform=matrix;parent=frame;
    }
    const outer=owned[0];if(!outer)throw Error("Native coordinate ancestry unavailable");
    parent.appendChild(result);result.relativeTransform=linear(original.relativeTransform);
    const matrix=clone(outer.relativeTransform);matrix[0][2]=origin.x;matrix[1][2]=origin.y;outer.relativeTransform=matrix;
    fitNativePlacementContainers(result);return outer;
  }catch(error){for(const frame of owned.reverse())if(!frame.removed)frame.remove();throw error;}
}
