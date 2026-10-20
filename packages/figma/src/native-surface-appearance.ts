/** Replacing the sampler must retain authored appearance and its live links.
 * Geometry, clipping, visibility and effects belong to native publication. */
export async function copyNativeSurfaceAppearance(source:FrameNode|undefined,target:FrameNode):Promise<void> {
  const fields=["opacity","blendMode","strokeWeight","strokeTopWeight","strokeRightWeight","strokeBottomWeight","strokeLeftWeight",
    "strokeAlign","strokeCap","strokeJoin","strokeMiterLimit","dashPattern","cornerSmoothing",
    "topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"] as const;
  const variableFields=["opacity","strokeWeight","strokeTopWeight","strokeRightWeight","strokeBottomWeight","strokeLeftWeight",
    "cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"] as const;
  const state=()=>source?JSON.stringify({fields:fields.map(key=>[key,key in source?source[key]:null]),
    fills:source.fills,strokes:source.strokes,fillStyleId:source.fillStyleId,strokeStyleId:source.strokeStyleId,
    boundVariables:source.boundVariables,explicitVariableModes:source.explicitVariableModes,resolvedVariableModes:source.resolvedVariableModes}):"";
  const expected=state(),validate=()=>{if(source?.removed||state()!==expected)throw Error("Scene changed. Select artwork and retry.");};
  const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
  const defaults={opacity:1,blendMode:"PASS_THROUGH",strokeWeight:1,strokeTopWeight:1,strokeRightWeight:1,strokeBottomWeight:1,strokeLeftWeight:1,
    strokeAlign:"INSIDE",strokeCap:"NONE",strokeJoin:"MITER",strokeMiterLimit:4,dashPattern:[],cornerSmoothing:0,
    topLeftRadius:0,topRightRadius:0,bottomLeftRadius:0,bottomRightRadius:0};
  const values:Array<readonly[string,unknown]>=[];
  for(const key of fields)if(!source||key in source&&source[key]!==figma.mixed)values.push([key,source?copy(source[key]):defaults[key]]);
  const fills=source?copy(source.fills):[],strokes=source?copy(source.strokes):[];
  const fillStyle=source?.fillStyleId,strokeStyle=source?.strokeStyleId;
  const aliases=variableFields.flatMap(field=>{
    const alias=source?.boundVariables?.[field];return alias?[{field,id:alias.id}]:[];
  });
  const modeEntries=Object.entries(source?.explicitVariableModes??{});
  const previousModeIds=Object.keys(target.explicitVariableModes??{});
  const [bindings,modes]=await Promise.all([
    Promise.all(aliases.map(async alias=>{
      const variable=await figma.variables.getVariableByIdAsync(alias.id);
      if(!variable)throw Error("Native surface variable unavailable");return {...alias,variable};
    })),
    Promise.all([...new Set([...modeEntries.map(([id])=>id),...previousModeIds])].map(async(id)=>{
      const mode=modeEntries.find(([key])=>key===id)?.[1];
      const collection=await figma.variables.getVariableCollectionByIdAsync(id);
      if(!collection||mode&&!collection.modes.some(item=>item.modeId===mode))throw Error("Native surface variable mode unavailable");
      return {collection,mode};
    })),
  ]);
  validate();
  for(const field of variableFields)if(target.boundVariables?.[field])target.setBoundVariable(field,null);
  for(const {collection} of modes)if(previousModeIds.includes(collection.id))target.clearExplicitVariableModeForCollection(collection);
  if(target.fillStyleId)await target.setFillStyleIdAsync("");
  if(target.strokeStyleId)await target.setStrokeStyleIdAsync("");
  target.fills=fills;target.strokes=strokes;
  for(const [key,value] of values)(target as unknown as Record<string,unknown>)[key]=value;
  for(const {collection,mode} of modes)if(mode)target.setExplicitVariableModeForCollection(collection,mode);
  if(typeof fillStyle==="string"&&fillStyle)await target.setFillStyleIdAsync(fillStyle);
  if(typeof strokeStyle==="string"&&strokeStyle)await target.setStrokeStyleIdAsync(strokeStyle);
  for(const {field,variable} of bindings)target.setBoundVariable(field,variable);
  validate();
}
