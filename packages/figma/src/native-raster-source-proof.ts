import { figmaError } from "./state-fingerprint";
import { sceneSourcesFingerprint } from "./native-scene-read-proof";
import type { effectSourceGraph } from "./agent-handoff";

export const RASTER_SOURCE_PROOF_ENABLED = true;

function supportedStyles(value:unknown):boolean {
  if(!value || typeof value!=="object")return true;
  if(Array.isArray(value))return value.every(supportedStyles);
  return Object.entries(value).every(([key,field])=>{
    if(Array.isArray(field) && (key==="fills" || key==="strokes")) {
      if(field.some(p=>p.visible!==false && p.opacity!==0 && !["SOLID","IMAGE","VARIABLE_ALIAS"].includes(p.type) && !p.type?.startsWith("GRADIENT_")))return false;
    }
    if(key==="effects" && Array.isArray(field) && field.some(e=>e.visible!==false && !["DROP_SHADOW","INNER_SHADOW","LAYER_BLUR","NOISE","TEXTURE"].includes(e.type)))return false;
    return supportedStyles(field);
  });
}

function textStyles(node:TextNode) {
  return JSON.stringify(node.getStyledTextSegments(["fontName","fontSize","fontWeight","fontStyle","openTypeFeatures","textDecoration",
    "textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","textCase",
    "lineHeight","letterSpacing","fills","textStyleId","fillStyleId","listOptions","listSpacing","indentation","paragraphIndent",
    "paragraphSpacing","textWrapStyle","hyperlink","boundVariables","textStyleOverrides"]));
}

/** A root supplies its own backdrop when its appearance does not depend on
 * pixels behind it. Open, transparent, and glass sources retain the pixel
 * proof. This is a freshness proof, not a PNG content digest: Figma export
 * bytes can change while the native node does not. */
function isolated(node: SceneNode): boolean {
  if (!("opacity" in node) || !("blendMode" in node)) return false;
  const effects = "effects" in node ? node.effects : [];
  return node.opacity === 1 && ["NORMAL","PASS_THROUGH"].includes(node.blendMode) && Array.isArray(effects) &&
    effects.every(effect => effect.visible === false || !["BACKGROUND_BLUR","GLASS"].includes(effect.type));
}
function opaqueCover(paint: Paint): boolean {
  return paint.visible !== false && (paint.opacity ?? 1) === 1 && (paint.blendMode ?? "NORMAL") === "NORMAL" &&
    (paint.type === "SOLID" || (paint.type.startsWith("GRADIENT_") && "gradientStops" in paint &&
      paint.gradientStops.length > 0 && paint.gradientStops.every(stop => stop.color.a === 1)));
}
function closedBackdrop(node: BaseNode): node is FrameNode {
  if (node.type !== "FRAME") return false;
  const frame = node as FrameNode;
  return !!frame.clipsContent && isolated(frame) && Array.isArray(frame.fills) && frame.fills.some(opaqueCover);
}
/** An opaque vector's path, fill, and stroke are the whole source. A fitting
 * guide is this case: its clip is native geometry, and a later PNG export of
 * the same path must not look like a changed prerequisite. */
function selfContainedVector(node: BaseNode): node is VectorNode {
  if (node.type !== "VECTOR") return false;
  const vector = node as VectorNode;
  return isolated(vector) && Array.isArray(vector.fills) && vector.fills.some(opaqueCover);
}
/** One NORMAL image paint has immutable pixels, including its transparent
 * areas. Track its hash, crop, filters and graph; translucent/mixed paints
 * stay on the pixel proof. Backdrop effects are excluded separately. */
function selfContainedImage(node: BaseNode): boolean {
  if (node.type !== "RECTANGLE" && node.type !== "FRAME") return false;
  const shape = node as RectangleNode | FrameNode;
  if (!isolated(shape) || !Array.isArray(shape.fills) || (shape.type === "FRAME" && !shape.clipsContent)) return false;
  const visible = shape.fills.filter(paint => paint.visible !== false && (paint.opacity ?? 1) !== 0);
  const paint = visible[0];
  return visible.length === 1 && !!paint && paint.type === "IMAGE" && (paint.opacity ?? 1) === 1 &&
    (paint.blendMode ?? "NORMAL") === "NORMAL";
}
function selfContainedRoot(node: BaseNode | undefined): boolean {
  return !!node && (closedBackdrop(node) || selfContainedVector(node) || selfContainedImage(node));
}

function aliases(value: unknown, found: Set<string>) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach(item => aliases(item,found)); return; }
  const object=value as Record<string,unknown>;
  if (object.type === "VARIABLE_ALIAS" && typeof object.id === "string") found.add(object.id);
  Object.values(object).forEach(item => aliases(item,found));
}

export async function prepareRasterSourceProof(ids: readonly string[], graph: Awaited<ReturnType<typeof effectSourceGraph>>) {
  const roots=ids.map(id=>graph.states.find(stamp=>stamp.node.id===id)?.node);
  if (!roots.every(selfContainedRoot)) return undefined;
  if(graph.states.some(({node,state})=>!"FRAME,GROUP,RECTANGLE,ELLIPSE,POLYGON,STAR,LINE,VECTOR,BOOLEAN_OPERATION,TEXT,INSTANCE,COMPONENT,COMPONENT_SET".split(",").includes(node.type) || !supportedStyles(JSON.parse(state))))return undefined;
  const texts:Array<{node:TextNode;state:string}>=[];
  try {
    for(const {node} of graph.states)if(node.type==="TEXT") {
      const state=textStyles(node as TextNode);if(!supportedStyles(JSON.parse(state)))return undefined;
      texts.push({node:node as TextNode,state});
    }
  }catch{return undefined;}
  const references=new Set<string>();
  [...graph.states,...texts].forEach(stamp=>aliases(JSON.parse(stamp.state),references));
  const variables=new Map<string,{variable:Variable;state:string}>();
  const collections=new Map<string,{collection:VariableCollection;state:string}>();
  let bytes=[...graph.states,...texts].reduce((sum,stamp)=>sum+stamp.state.length*2,0);
  if(bytes>16*1024*1024)throw figmaError("LIMIT","source state exceeds 16 MiB");
  const account=(state:string) => {
    bytes+=state.length*2;
    if(bytes>16*1024*1024 || graph.states.length+variables.size+collections.size>=20000) throw figmaError("LIMIT","source and variable state exceed 20000 records / 16 MiB");
  };
  const variableState=(v:Variable)=>JSON.stringify({id:v.id,collection:v.variableCollectionId,type:v.resolvedType,values:v.valuesByMode});
  const collectionState=(c:VariableCollection)=>JSON.stringify({id:c.id,defaultModeId:c.defaultModeId,modes:c.modes});
  async function visit(id:string,active:Set<string>):Promise<void> {
    if(active.has(id)) throw figmaError("CYCLE","cyclic source variables");
    if(variables.has(id)) return;
    if(active.size>=64 || variables.size+collections.size+graph.states.length>=20000) throw figmaError("LIMIT","source variable limit exceeded");
    const variable=await figma.variables.getVariableByIdAsync(id);graph();
    if(!variable) throw figmaError("STATE","source variable unavailable");
    const state=variableState(variable);account(state);variables.set(id,{variable,state});
    if(!collections.has(variable.variableCollectionId)) {
      const collection=await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);graph();
      if(!collection) throw figmaError("STATE","source variable collection unavailable");
      const state=collectionState(collection);account(state);collections.set(collection.id,{collection,state});
    }
    // Follow the captured definition, not a possibly changed live alias after
    // awaiting its collection. The final guard verifies that same definition.
    const nested=new Set<string>();aliases(JSON.parse(state).values,nested);
    active.add(id);for(const next of nested) await visit(next,active);active.delete(id);
  }
  for(const id of references) await visit(id,new Set());
  const validate=()=>{
    graph();
    try {
      // graph() already guards every property used by selfContainedRoot.
      if([...variables.values()].some(({variable,state})=>variableState(variable)!==state) ||
        [...collections.values()].some(({collection,state})=>collectionState(collection)!==state) ||
        texts.some(({node,state})=>textStyles(node)!==state)) throw Error("changed");
    } catch { throw figmaError("CONFLICT","native source or variable state changed; inspect again"); }
  };
  validate();
  const stamps=[...graph.states,
    ...texts.map(({node,state})=>({node:{id:`text:${node.id}`},state})),
    ...[...variables].map(([id,{state}])=>({node:{id:`variable:${id}`},state})),
    ...[...collections].map(([id,{state}])=>({node:{id:`collection:${id}`},state}))];
  return {fingerprint:sceneSourcesFingerprint(ids,stamps),validate};
}
