import { componentNativeTopology, type ComponentNativeTopology } from "./native-component-topology";
import type { NativeComponentProjection } from "./native-frame-record";
import { placeIndependentNativeCopy } from "./native-copy-placement";
import { nativeOutputAtBounds, nativeOutputBounds } from "./native-output-position";
import { placementBeside } from "./result-placement";

function hasExternalConsumer(result:FrameNode,old:ComponentNativeTopology):boolean {
  const ids=new Set<string>();let count=0;
  function collect(node:SceneNode,depth=0){if(++count>20000||depth>64)throw Error("Native copy exceeds 20000 nodes / 64 levels");ids.add(node.id);if("children"in node)for(const child of node.children)collect(child,depth+1);}
  collect(old.master);collect(old.instance);
  const queue:[SceneNode,number][]=figma.currentPage.children.map(n=>[n,0]);count=0;
  while(queue.length){const [node,depth]=queue.pop()!;if(node.id===result.id)continue;
    if(++count>20000||depth>64)throw Error("Native consumer scan exceeds 20000 nodes / 64 levels");
    const raw=node.getSharedPluginData("worldbend","binding");
    if(raw.length>128*1024)throw Error("Native consumer binding exceeds 128 KiB");
    if(raw)try{const binding=JSON.parse(raw);if(Array.isArray(binding?.sourceNodeIds)&&binding.sourceNodeIds.some((id:unknown)=>typeof id==="string"&&ids.has(id)))return true;}catch{/* A damaged unrelated binding is not a reference. */}
    if("children"in node){if(queue.length+node.children.length+count>20000)throw Error("Native consumer scan exceeds 20000 nodes");for(const child of node.children)queue.push([child,depth+1]);}
  }
  return false;
}

export async function componentMasterMatches(resultId:string,record:NativeComponentProjection,parts:ComponentNativeTopology):Promise<boolean> {
  const main=await parts.instance.getMainComponentAsync();
  return parts.master.type==="COMPONENT"?main?.id===parts.master.id:
    record.resultNodeId!==resultId&&main?.id===record.frame.masterNodeId&&
    (await parts.master.getMainComponentAsync())?.id===main?.id;
}

/** Frame Duplicate turns a nested component into an instance of the original.
 * Reads admit that host representation without writes. At an explicit write,
 * materialize the duplicate's current live appearance as its own component.
 * Keep the old local nodes until the enclosing publication can commit. */
export function localizeComponentCopy(result:FrameNode,old:ComponentNativeTopology,sourceEditing=false) {
  if(old.master.type==="COMPONENT")return {parts:old,commit(){},rollback(){}};
  const preserve=hasExternalConsumer(result,old);
  const masterVisible=old.master.visible,instanceVisible=old.instance.visible;
  let clone:InstanceNode|undefined,detached:FrameNode|undefined,master:ComponentNode|undefined,instance:InstanceNode|undefined;
  let movedMaster=false,movedInstance=false;
  let retained:FrameNode|undefined,retainedOuter:FrameNode|undefined;
  const rollback=()=>{
    if(movedMaster){result.insertChild(1,old.master);old.master.visible=masterVisible;}
    if(movedInstance){old.basis.insertChild(0,old.instance);old.instance.visible=instanceVisible;}
    if(instance&&!instance.removed)instance.remove();
    if(master&&!master.removed)master.remove();
    if(detached&&!detached.removed)detached.remove();
    if(clone&&!clone.removed)clone.remove();
    if(retainedOuter&&!retainedOuter.removed)retainedOuter.remove();
    if(retained&&!retained.removed)retained.remove();
  };
  try {
    const source=sourceEditing?old.master:old.instance;
    clone=source.clone();detached=clone.detachInstance();clone=undefined;
    if(!sourceEditing)detached.rescale(1/old.instance.scaleFactor);
    master=figma.createComponentFromNode(detached);detached=undefined;
    master.name=old.master.name;master.visible=false;master.x=0;master.y=0;
    instance=master.createInstance();instance.name=old.instance.name;
    instance.scaleFactor=sourceEditing?1:old.instance.scaleFactor;instance.relativeTransform=old.instance.relativeTransform;
    instance.visible=instanceVisible;
    const content=instance.children[0],masterContent=master.children[0];
    const expected=sourceEditing?old.masterContent:old.content;
    if(instance.children.length!==1||content?.type!=="FRAME"||master.children.length!==1||masterContent?.type!=="FRAME"||
      Math.abs(content.width-expected.width)>1e-3||Math.abs(content.height-expected.height)>1e-3)throw Error("Native copy content changed");
    let retiredBasis:FrameNode|undefined;
    if(preserve){
      const bounds=nativeOutputBounds(result,result.absoluteTransform),box=result.absoluteBoundingBox;
      if(!box)throw Error("Native copy bounds unavailable");
      const occupied=figma.currentPage.children.flatMap(n=>n.visible&&n.absoluteBoundingBox?[n.absoluteBoundingBox]:[]);
      const origin=nativeOutputAtBounds(result,placementBeside([box],bounds,occupied),result.absoluteTransform);
      retained=result.clone();retained.name=`Previous artwork · ${result.name}`;
      retainedOuter=placeIndependentNativeCopy(retained,result,{x:origin[0][2],y:origin[1][2]});
      const parts=componentNativeTopology(retained);parts.instance.remove();parts.master.remove();retiredBasis=parts.basis;
    }
    figma.currentPage.appendChild(old.master);movedMaster=true;old.master.visible=false;
    result.insertChild(1,master);
    figma.currentPage.appendChild(old.instance);movedInstance=true;old.instance.visible=false;
    old.basis.insertChild(0,instance);
    if(retained&&retiredBasis){retained.appendChild(old.master);old.master.visible=masterVisible;retiredBasis.appendChild(old.instance);old.instance.visible=instanceVisible;}
    return {parts:{...old,master,masterContent,instance,content},rollback,
      commit(){if(!retained){old.instance.remove();old.master.remove();}}};
  }catch(error){rollback();throw error;}
}
