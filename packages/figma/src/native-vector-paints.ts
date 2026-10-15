/** Native output freezes the current solid appearance. Keeping a color alias
 * on a page-level capture would resolve it in a different ancestor mode. The
 * source retains its variables/styles and remains the place to revise them. */
export function capturedPaints(paints: readonly Paint[]): Paint[] {
  return paints.map(paint => {
    const value = JSON.parse(JSON.stringify(paint)) as Paint;
    if (value.type === "SOLID") delete (value as { boundVariables?: unknown }).boundVariables;
    return value;
  });
}

export function capturedNetwork(network: VectorNetwork): VectorNetwork {
  const value = JSON.parse(JSON.stringify(network)) as VectorNetwork;
  return { ...value, ...(value.regions ? { regions: value.regions.map(region => {
    const frozen = { ...region };
    delete frozen.fillStyleId;
    return { ...frozen, ...(Array.isArray(region.fills) ? { fills: capturedPaints(region.fills) } : {}) };
  }) } : {}) };
}

/** Freeze paints before a text/Boolean clone leaves its original context. */
export async function freezeClonePaints(source: SceneNode, target: SceneNode): Promise<void> {
  if ("fills" in source && "fills" in target && Array.isArray(source.fills)) target.fills = capturedPaints(source.fills);
  if (source.type === "TEXT" && target.type === "TEXT" && !Array.isArray(source.fills)) {
    for (const segment of source.getStyledTextSegments(["fills"])) target.setRangeFills(segment.start, segment.end, capturedPaints(segment.fills));
  }
  if ("strokes" in source && "strokes" in target) target.strokes = capturedPaints(source.strokes);
  // Preserve the native clone's complete network, including per-vertex stroke
  // semantics. A network setter may normalize coordinates/size; it is not a
  // paint-only write. Resolved modes were restored before this call, so native
  // outline/flatten resolves region styles and aliases in the source context.
  // Detached snapshot then freezes their resolved paints without a host write.
  if ("children" in source && "children" in target) for (const [index,node] of source.children.entries()) {
    const child = target.children[index];
    if (!child) throw Error("Native capture clone changed");
    await freezeClonePaints(node, child);
  }
}
