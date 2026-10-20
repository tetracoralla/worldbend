import {inverseBasisPoint} from "./native-output-position";
/** Figma x/y and relativeTransform use the containing coordinate system.
 * Groups and booleans derive their bounds from children and do not establish
 * a new basis. See the Plugin API's relativeTransform container-parent rules. */
export function coordinateParent(node: BaseNode): BaseNode | null {
  let parent = node.parent;
  while (parent?.type === "GROUP" || parent?.type === "BOOLEAN_OPERATION") parent = parent.parent;
  return parent;
}

/** Origin is a point in page space; width and height remain intrinsic content
 * units. A rotated axis-aligned bounding box is never an editable view box. */
export function nativePagePlacement(node:FrameNode,size:{width:number;height:number}=node) {
  const matrix=node.absoluteTransform;
  const placement={x:matrix[0][2],y:matrix[1][2],width:size.width,height:size.height};
  if(!Object.values(placement).every(Number.isFinite)||size.width<=0||size.height<=0)throw Error("Invalid native placement");
  return placement;
}

/** Convert page-space position through the actual containing basis, including
 * rotation, reflection and shear. Groups do not introduce a coordinate basis. */
export function pointInCoordinateParent(node:BaseNode,point:{x:number;y:number}):{x:number;y:number} {
  const parent=coordinateParent(node);
  if(!parent||!("absoluteTransform" in parent))return {...point};
  return inverseBasisPoint(parent.absoluteTransform,point);
}
