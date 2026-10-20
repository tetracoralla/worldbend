export interface ComponentNativeTopology {
  surface:FrameNode; basis:FrameNode; instance:InstanceNode; master:ComponentNode|InstanceNode;
  content:FrameNode; masterContent:FrameNode;
}

/** Resolve a duplicate exclusively through its own subtree. Old IDs are
 * validation data, never lookup targets for another result's mutable nodes. */
export function componentNativeTopology(result:FrameNode):ComponentNativeTopology {
  // Source view hides the projection, but its instance remains part of the
  // owned graph and must still be validated, copied and restored.
  figma.skipInvisibleInstanceChildren=false;
  const [surface,master]=result.children;
  const basis=surface?.type==="FRAME"?surface.children[0]:undefined;
  const instance=basis?.type==="FRAME"?basis.children[0]:undefined;
  const content=instance?.type==="INSTANCE"?instance.children[0]:undefined;
  const masterContent=master?.type==="COMPONENT"||master?.type==="INSTANCE"?master.children[0]:undefined;
  if(result.children.length!==2||surface?.type!=="FRAME"||(master?.type!=="COMPONENT"&&master?.type!=="INSTANCE")||
    surface.children.length!==1||basis?.type!=="FRAME"||basis.children.length!==1||
    instance?.type!=="INSTANCE"||instance.children.length!==1||content?.type!=="FRAME"||
    master.children.length!==1||masterContent?.type!=="FRAME")throw Error("Native projection structure changed");
  return {surface,basis,instance,master,content,masterContent};
}
