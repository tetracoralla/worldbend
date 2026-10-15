/** Keep legal local ancestry until native outline/flatten. Assigning a compound
 * absolute matrix to a detached leaf can silently normalize its columns. */
export type NativeCaptureHost = Pick<PluginAPI, "currentPage" | "createFrame">;
export class NativeCaptureBasisError extends Error {
  constructor(readonly reason:string,message:string){super(message);}
}
type CaptureLeaf = SceneNode & { relativeTransform: Transform };
function copyMatrix(value: Transform): Transform { return [[...value[0]], [...value[1]]]; }
function sameMatrix(left: Transform, right: Transform): boolean {
  return left.length === 2 && right.length === 2 && left.every((row, i) => row.length === 3 &&
    row.every((value, j) => Number.isFinite(value) && value === right[i]![j]));
}

/** Prepare BEFORE cloning: a clone can temporarily participate in the source's
 * auto-layout. Its immediate reparent uses the original captured local basis,
 * size and world basis, never the transient source layout after clone(). */
export function prepareNativeCapturePlacement(
  source: SceneNode, host: NativeCaptureHost, track: <N extends SceneNode>(node: N) => N,
): { ancestors: FrameNode[]; place: (node: CaptureLeaf) => void } {
  const local = copyMatrix(source.relativeTransform);
  const absolute = copyMatrix(source.absoluteTransform);
  const size = { width: source.width, height: source.height };
  const originals: Array<{ matrix: Transform; width: number; height: number }> = [];
  let current = source.parent;
  while (current && current.type !== "PAGE" && current.type !== "DOCUMENT") {
    // Figma's containing-coordinate rules: these bounds wrappers add no basis.
    if (current.type === "GROUP" || current.type === "BOOLEAN_OPERATION") { current = current.parent; continue; }
    // Section typings omit this property; current native hosts expose it.
    if (!("relativeTransform" in current) || !("width" in current) || originals.length >= 64)
      throw new NativeCaptureBasisError("nativeAncestryUnavailableOrDepthBudget","Native vector capture ancestry is unavailable or exceeds its depth budget");
    const original = current as SceneNode;
    originals.push({ matrix: copyMatrix(original.relativeTransform), width: original.width, height: original.height });
    current = current.parent;
  }
  const ancestors: FrameNode[] = [];
  let parent: PageNode | FrameNode = host.currentPage;
  for (const original of originals.reverse()) {
    const frame = track(host.createFrame()); ancestors.push(frame);
    frame.visible = false; frame.fills = []; frame.strokes = []; frame.effects = [];
    frame.clipsContent = false; frame.layoutMode = "NONE"; frame.opacity = 1; frame.blendMode = "PASS_THROUGH";
    frame.resizeWithoutConstraints(original.width, original.height);
    parent.appendChild(frame); frame.relativeTransform = original.matrix;
    if (frame.width !== original.width || frame.height !== original.height ||
      !sameMatrix(frame.relativeTransform, original.matrix))
      throw new NativeCaptureBasisError("nativeAncestorBasisChanged","Native vector capture did not preserve its local ancestor basis");
    parent = frame;
  }
  return { ancestors, place(node) {
    parent.appendChild(node); node.relativeTransform = local;
    if (!sameMatrix(node.relativeTransform, local) || node.width !== size.width || node.height !== size.height ||
      !sameMatrix(node.absoluteTransform, absolute))
      throw new NativeCaptureBasisError("nativeSourceBasisOrSizeChanged","Native vector capture did not preserve its source basis and size");
  } };
}
export function placeNativeCapture(
  node: CaptureLeaf, source: SceneNode, host: NativeCaptureHost, track: <N extends SceneNode>(node: N) => N,
): FrameNode[] {
  const prepared = prepareNativeCapturePlacement(source, host, track);
  prepared.place(node); return prepared.ancestors;
}

/** The native outlineStroke API creates its result on Page while retaining
 * the working leaf's parent-local matrix (including the stroke offset). Restore
 * that legal ancestry before flatten transfers the complete basis into paths.
 * Assigning the computed absolute matrix on Page can silently normalize shear. */
export function restoreNativeStrokeOutlineParent(outline: VectorNode, working: SceneNode, page: PageNode): void {
  const parent = working.parent;
  if (!parent || !("appendChild" in parent))
    throw new NativeCaptureBasisError("nativeStrokeParentUnavailable", "Native stroke outline parent is unavailable");
  if (outline.parent === parent) return;
  if (outline.parent !== page)
    throw new NativeCaptureBasisError("nativeStrokeParentUnexpected", "Native stroke outline has an unexpected parent");
  const local = copyMatrix(outline.relativeTransform), width = outline.width, height = outline.height;
  parent.appendChild(outline); outline.relativeTransform = local;
  if (!sameMatrix(outline.relativeTransform, local) || outline.width !== width || outline.height !== height)
    throw new NativeCaptureBasisError("nativeStrokeBasisOrSizeChanged", "Native stroke outline did not preserve its parent-local basis and size");
}
