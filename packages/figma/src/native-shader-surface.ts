import { SHARED_NAMESPACE } from "./stored-plane";
import { sameJsonValue } from "./json-value";
import {copyNativeSurfaceAppearance} from "./native-surface-appearance";

const TEMPLATE_KEY = "nativeShaderTemplate";
const TEMPLATE_MARKER = "worldbend.figma.native-shader-template/0.1";
let preparation:Promise<void>=Promise.resolve();
type SurfaceInput={shaderId?:string;properties?:Record<string,number>;appearance?:FrameNode|undefined;width:number;height:number;beforeCreate?:()=>void};

/** Configure one hidden page resource, then clone its immutable effect.
 * Figma's Shader setter checkpoints earlier scene writes and is itself outside
 * scene Undo. Published projections must be clones made after that setter;
 * changing a visible projection's Shader in place breaks Undo and Redo. */
export async function createNativeShaderSurface(input:SurfaceInput):Promise<()=>FrameNode> {
  // Hold the resource until its synchronous publication clone is consumed.
  // Awaiting a created clone lets Figma checkpoint that clone before the graph.
  const host=figma,pageId=figma.currentPage.id,fileKey=figma.fileKey;
  const previous=preparation;let release!:()=>void;
  preparation=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try{
    if(figma!==host||figma.currentPage.id!==pageId||figma.fileKey!==fileKey)throw Error("Scene changed. Select artwork and retry.");
    return await prepareSurface(input,release);
  }catch(error){release();throw error;}
}
async function prepareSurface(input:SurfaceInput,release:()=>void): Promise<()=>FrameNode> {
  if(input.shaderId&&!input.properties)throw Error("Native sampler properties unavailable");
  const page = figma.currentPage;
  const fileKey=figma.fileKey;
  const previousId = page.getSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY);
  const found = page.children.find(node => node.id === previousId);
  const reusable = found?.type === "FRAME" && !found.visible && found.locked &&
    found.children.length === 0 && found.layoutMode === "NONE" &&
    found.getSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY) === TEMPLATE_MARKER;
  const template = reusable ? found : figma.createFrame();
  let surface: FrameNode | undefined;
  try {
    // Resource ownership and visibility precede the setter, so host Undo does
    // not leave an unmarked visible Shader frame on the page.
    template.name = "Worldbend resources";
    template.visible = false; template.locked = true;
    template.fills = []; template.strokes = []; template.layoutMode = "NONE";
    template.clipsContent = true; template.x = 0; template.y = 0;
    template.resizeWithoutConstraints(input.width, input.height);
    template.setSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY, TEMPLATE_MARKER);
    page.setSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY, template.id);
    await copyNativeSurfaceAppearance(input.appearance,template);
    if(figma.currentPage.id!==page.id||figma.fileKey!==fileKey)throw Error("Scene changed. Select artwork and retry.");
    template.effects = input.shaderId?[{ type: "SHADER", visible: true, id: input.shaderId,
      properties: input.properties }] as unknown as Effect[]:[];
    const applied = template.effects[0];
    if (input.shaderId&&(template.effects.length !== 1 || applied?.type !== "SHADER" ||
      !applied.visible || !sameJsonValue(applied.properties, input.properties))) {
      throw Error("Native sampler did not retain its parameters");
    }
    let consumed=false;
    return ()=>{
      if(consumed)throw Error("Native surface preparation already consumed");consumed=true;
      try {
        if(figma.currentPage.id!==page.id||figma.fileKey!==fileKey)throw Error("Scene changed. Select artwork and retry.");
        input.beforeCreate?.();
        surface = template.clone();
        surface.setSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY, "");
        surface.visible = true; surface.locked = false;
        return surface;
      }catch(error){surface?.remove();throw error;}finally{release();}
    };
  } catch (error) {
    surface?.remove();
    if (!reusable) {
      template.remove();
      page.setSharedPluginData(SHARED_NAMESPACE, TEMPLATE_KEY, previousId);
    }
    throw error;
  }
}
