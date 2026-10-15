import { nativeNodeSnapshot } from "./native-copy-closure";
import { clonedNativeGraph, rebindClonedNativeGraph } from "./native-clone-bindings";
import { FOLD_GLASS, parsePresetEffectRecord, PRESET_EFFECT_KEY, type PresetEffectRecord, type PresetEffectSpec, type PresetEffectRaster } from "./preset-effect";

const role = (node: BaseNode): string => node.getSharedPluginData("worldbend","presetRole");
export function presetParts(root: SceneNode): {root: FrameNode; source: SceneNode; holder: FrameNode; presentation: FrameNode; record: PresetEffectRecord} | undefined {
  const saved = parsePresetEffectRecord(root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY));
  if (!saved || root.type !== "FRAME") return;
  // Native copies carry old IDs. Resolve only the copied local structure;
  // never read or update another workpiece's original by those stale IDs.
  const holders=root.children.filter(n=>n.type==="FRAME"&&role(n)==="source");
  const views=root.children.filter(n=>n.type==="FRAME"&&role(n)==="presentation");
  if (holders.length!==1 || views.length!==1 || root.children.length!==2) return;
  const holder=holders[0] as FrameNode, presentation=views[0] as FrameNode;
  if (holder.children.length!==1) return;
  const source=holder.children[0]!;
  return {root,source,holder,presentation,record:{...saved,rootNodeId:root.id,sourceHolderId:holder.id,
    sourceNodeId:source.id,presentationNodeId:presentation.id}};
}
/** Selection inside an owned workpiece always edits that local workpiece. */
export function presetOwner(selected: SceneNode): ReturnType<typeof presetParts> {
  let node: BaseNode | null=selected;
  while(node && node.type!=="PAGE" && node.type!=="DOCUMENT") {
    if(node.getSharedPluginData("worldbend",PRESET_EFFECT_KEY)) {
      const parts=presetParts(node as SceneNode);
      if(!parts)throw Error("The preset workpiece has lost its original or effect layers.");
      return parts;
    }
    node=node.parent;
  }
  return;
}
export function presetSourceSnapshot(node: SceneNode): string {
  const snapshots: string[] = [];
  let bytes = 0;
  const visit = (current: SceneNode, depth: number): void => {
    if (depth > 64 || snapshots.length >= 20000) throw Error("Artwork exceeds the snapshot node limit.");
    const snapshot = JSON.stringify({ absolute: current.absoluteTransform, native: nativeNodeSnapshot(current) });
    bytes += snapshot.length;
    if (bytes > 1_000_000) throw Error("Artwork exceeds the snapshot size limit.");
    snapshots.push(snapshot);
    if ("children" in current) for (const child of current.children) visit(child, depth + 1);
  };
  visit(node, 0);
  const result = JSON.stringify(snapshots);
  if (result.length > 1_000_000) throw Error("Artwork exceeds the snapshot size limit.");
  return result;
}
export async function loadPresetFonts(source: SceneNode): Promise<void> {
  const texts=source.type==="TEXT"?[source]:"findAll" in source?source.findAll(n=>n.type==="TEXT") as TextNode[]:[];
  const fonts=new Map<string,FontName>();
  texts.forEach(text=>text.getStyledTextSegments(["fontName"]).forEach(s=>fonts.set(JSON.stringify(s.fontName),s.fontName)));
  await Promise.all([...fonts.values()].map(font=>figma.loadFontAsync(font)));
}
/** Coordinate conversion between native parent bases; no spatial-effect math. */
function relativeTo(parent: BaseNode, absolute: Transform): Transform {
  if (!("absoluteTransform" in parent)) return absolute;
  const [[a,c,e],[b,d,f]]=(parent as SceneNode).absoluteTransform, determinant=a*d-b*c;
  if (!Number.isFinite(determinant)||Math.abs(determinant)<1e-10) throw Error("The containing frame has a singular transform.");
  const [[u,v,x],[w,z,y]]=absolute;
  return [[(d*u-c*w)/determinant,(d*v-c*z)/determinant,(d*(x-e)-c*(y-f))/determinant],
    [(-b*u+a*w)/determinant,(-b*v+a*z)/determinant,(-b*(x-e)+a*(y-f))/determinant]];
}
export function publishPresetEffect(input:{source:SceneNode; existing?:ReturnType<typeof presetParts>; spec:PresetEffectSpec;
  raster:PresetEffectRaster; sourceBox:Rect; beforeWrite():void}): FrameNode {
  const {source,raster,sourceBox}=input;
  if (!("resizeWithoutConstraints" in source) || !("layoutSizingHorizontal" in source) || !("layoutSizingVertical" in source) || !("layoutPositioning" in source)) throw Error("This layer cannot be arranged as an effect workpiece.");
  const previousParent=source.parent;
  if (!previousParent || !("insertChild" in previousParent)) throw Error("The source no longer has an editable parent.");
  const previousIndex=previousParent.children.indexOf(source), previousTransform=source.relativeTransform;
  const absolute=source.absoluteTransform;
  const originalSize={width:source.width,height:source.height};
  const originalLayout={horizontal:source.layoutSizingHorizontal,vertical:source.layoutSizingVertical,
    positioning:source.layoutPositioning};
  const previousResult=input.existing ? {width:input.existing.root.width,height:input.existing.root.height,
    transform:input.existing.root.relativeTransform,holderTransform:input.existing.holder.relativeTransform,
    holderWidth:input.existing.holder.width,holderHeight:input.existing.holder.height,
    record:input.existing.root.getSharedPluginData("worldbend",PRESET_EFFECT_KEY),
    sourceVisible:input.existing.holder.visible,presentationVisible:input.existing.presentation.visible} : undefined;
  let root=input.existing?.root, presentation:FrameNode|undefined, holder=input.existing?.holder;
  let moved=false;
  const created:SceneNode[]=[];
  const own=<T extends SceneNode>(node:T):T=>{created.push(node);return node;};
  try {
    input.beforeWrite();
    presentation=own(figma.createFrame());presentation.name="Effect";presentation.fills=[];presentation.clipsContent=false;
    presentation.resize(raster.width,raster.height);presentation.setSharedPluginData("worldbend","presetRole","presentation");
    if (raster.baseWidth !== undefined) {
      const base=own(figma.createFrame());base.name="Stationary content";base.fills=[];base.clipsContent=true;
      base.resize(raster.baseWidth,sourceBox.height);presentation.appendChild(base);base.x=-raster.origin.x;base.y=-raster.origin.y;
      const copy=own(source.clone());base.appendChild(copy);copy.visible=true;
      if("resizeWithoutConstraints" in copy)copy.resizeWithoutConstraints(originalSize.width,originalSize.height);
      const graph=clonedNativeGraph(source,copy);rebindClonedNativeGraph(graph.copies,graph.originals);
      copy.relativeTransform=[[absolute[0][0],absolute[0][1],absolute[0][2]-sourceBox.x],
        [absolute[1][0],absolute[1][1],absolute[1][2]-sourceBox.y]];
    }
    for (const layer of raster.layers) {
      const face=own(figma.createFrame());face.name=layer.name;face.fills=[];face.clipsContent=false;face.resize(raster.width,raster.height);
      presentation.appendChild(face);face.x=0;face.y=0;
      const mask=own(figma.createVector());mask.name="Effect mask";
      const {tl,tr,br,bl}=layer.quad;
      mask.vectorPaths=[{windingRule:"NONZERO",data:`M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`}];
      face.appendChild(mask); // vectorPaths normalizes its local coordinates.
      mask.x=Math.min(tl.x,tr.x,br.x,bl.x);mask.y=Math.min(tl.y,tr.y,br.y,bl.y);
      mask.fills=[{type:"SOLID",color:{r:1,g:1,b:1}}];mask.isMask=true;
      const image=own(figma.createRectangle());image.name="Projected artwork";image.resize(raster.width,raster.height);
      image.fills=[{type:"IMAGE",imageHash:figma.createImage(figma.base64Decode(layer.bytes)).hash,scaleMode:"FILL"}];
      face.appendChild(image);image.x=0;image.y=0;
      if(input.spec.effect==="fold-screen"&&input.spec.amount>0) {
        const glass=own(figma.createVector());glass.name="Folding glass";
        glass.vectorPaths=mask.vectorPaths;presentation.appendChild(glass);glass.x=mask.x;glass.y=mask.y;
        const {fill,stroke,shadow}=FOLD_GLASS,k=input.spec.amount;
        glass.fills=[{type:"SOLID",color:{r:fill.r,g:fill.g,b:fill.b},opacity:fill.opacity*k}];
        glass.strokes=[{type:"SOLID",color:{r:stroke.r,g:stroke.g,b:stroke.b},opacity:stroke.opacity*k}];
        glass.strokeWeight=stroke.width;glass.strokeAlign="CENTER";
        // Keep the finish outside the image's mask group so its edge and
        // shadow can extend beyond the sampled content.
        glass.effects=[{type:"DROP_SHADOW",color:{r:shadow.r,g:shadow.g,b:shadow.b,a:shadow.opacity*k*k},
          offset:{x:shadow.x,y:shadow.y},radius:shadow.radius,spread:0,visible:true,blendMode:"NORMAL"}];
      }
    }
    if (!root) {
      root=own(figma.createFrame());root.name=source.name;root.fills=[];root.clipsContent=false;root.resize(raster.width,raster.height);
      previousParent.insertChild(previousIndex,root);
      root.relativeTransform=relativeTo(previousParent,[[1,0,sourceBox.x+raster.origin.x],[0,1,sourceBox.y+raster.origin.y]]);
      if ("layoutMode" in previousParent && previousParent.layoutMode!=="NONE") {
        root.layoutPositioning=originalLayout.positioning;
        root.layoutSizingHorizontal=originalLayout.horizontal;root.layoutSizingVertical=originalLayout.vertical;
      }
      holder=own(figma.createFrame());holder.name="Editable artwork";holder.fills=[];holder.clipsContent=false;
      holder.resize(sourceBox.width,sourceBox.height);root.appendChild(holder);
      holder.x=-raster.origin.x;holder.y=-raster.origin.y;holder.setSharedPluginData("worldbend","presetRole","source");
      holder.appendChild(source);moved=true;
      source.resizeWithoutConstraints(originalSize.width,originalSize.height);
      source.relativeTransform=relativeTo(holder,absolute);holder.visible=false;
    }
    root.appendChild(presentation);presentation.x=0;presentation.y=0;
    const previous=input.existing?.presentation;
    root.resizeWithoutConstraints(raster.width,raster.height);
    if(input.existing) {
      const parent=root.parent;
      if(!parent)throw Error("The effect workpiece no longer has a parent.");
      root.relativeTransform=relativeTo(parent,[[1,0,sourceBox.x+raster.origin.x],[0,1,sourceBox.y+raster.origin.y]]);
      holder!.resizeWithoutConstraints(sourceBox.width,sourceBox.height);
      holder!.relativeTransform=[[1,0,-raster.origin.x],[0,1,-raster.origin.y]];
      source.relativeTransform=relativeTo(holder!,absolute);
    }
    // Auto-layout may own the wrapper's position independently of the effect
    // bounds. Anchor its visible layers to the actual source in world space.
    presentation.relativeTransform=relativeTo(root,[[1,0,sourceBox.x+raster.origin.x],[0,1,sourceBox.y+raster.origin.y]]);
    const record:PresetEffectRecord={schema:"worldbend.figma.preset-result",version:"0.1",spec:input.spec,
      rootNodeId:root.id,sourceHolderId:holder!.id,sourceNodeId:source.id,presentationNodeId:presentation.id};
    root.setSharedPluginData("worldbend",PRESET_EFFECT_KEY,JSON.stringify(record));
    holder!.visible=false;presentation.visible=true;
    previous?.remove();
    return root;
  } catch(error) {
    if (moved && !source.removed) {
      previousParent.insertChild(previousIndex,source);
      source.resizeWithoutConstraints(originalSize.width,originalSize.height);source.relativeTransform=previousTransform;
      source.layoutPositioning=originalLayout.positioning;
      source.layoutSizingHorizontal=originalLayout.horizontal;source.layoutSizingVertical=originalLayout.vertical;
    }
    for(const node of created.reverse())if(!node.removed)node.remove();
    if (input.existing && previousResult) {
      root!.resizeWithoutConstraints(previousResult.width,previousResult.height);
      root!.relativeTransform=previousResult.transform;
      input.existing.holder.resizeWithoutConstraints(previousResult.holderWidth,previousResult.holderHeight);
      input.existing.holder.relativeTransform=previousResult.holderTransform;
      source.relativeTransform=previousTransform;
      root!.setSharedPluginData("worldbend",PRESET_EFFECT_KEY,previousResult.record);
      input.existing.holder.visible=previousResult.sourceVisible;
      input.existing.presentation.visible=previousResult.presentationVisible;
    }
    throw error;
  }
}
