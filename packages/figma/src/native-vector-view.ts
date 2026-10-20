/** Host-independent persisted input-window contract. Pixel sample dimensions
 * do not change this logical source domain. */
export interface NativeVectorSourceView {
  policy:"logical"|"appearance";
  /** Automatic source refresh may reselect its current native input window.
   * Explicit Agent choices, and legacy records without this field, stay fixed. */
  selection?:"automatic"|"explicit";
  bounds:{x:number;y:number;width:number;height:number};
  /** Core's continuous full-geometry enclosure may correct a rounded native
   * appearance getter. The original getter remains the freshness witness. */
  reportedBounds?:{x:number;y:number;width:number;height:number};
}
type Box=NativeVectorSourceView["bounds"];
/** Native SDK readback for the admitted0.01 lower endpoint is binary32.
 * Pixel-axis admission remains a separate integer contract. */
export function isNativeVectorAxis(value:unknown):value is number {
  return typeof value==="number"&&Number.isFinite(value)&&value>=Math.fround(.01)&&value<=4096;
}
function box(value:unknown):value is Box {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).sort().join(",")==="height,width,x,y"&&Object.values(v).every(n=>typeof n==="number"&&Number.isFinite(n))&&Number(v.width)>0&&Number(v.height)>0&&
    Number.isFinite(Number(v.x)+Number(v.width))&&Number.isFinite(Number(v.y)+Number(v.height));
}
export function isNativeVectorSourceView(value:unknown):value is NativeVectorSourceView {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const keys=["bounds","policy",...(v.reportedBounds===undefined?[]:["reportedBounds"]),...(v.selection===undefined?[]:["selection"])].sort().join(",");
  if(Object.keys(v).sort().join(",")!==keys||
    (v.selection!==undefined&&!['automatic','explicit'].includes(String(v.selection)))||
    !["logical","appearance"].includes(String(v.policy))||!box(v.bounds))return false;
  if(v.reportedBounds===undefined)return true;
  if(v.policy!=="appearance"||!box(v.reportedBounds))return false;
  const a=v.bounds,b=v.reportedBounds;
  return a.x<=b.x&&a.y<=b.y&&a.x+a.width>=b.x+b.width&&a.y+a.height>=b.y+b.height;
}
export function resolvedNativeVectorSourceView(view:NativeVectorSourceView,bounds?:Box|null):NativeVectorSourceView {
  if(!bounds||(["x","y","width","height"] as const).every(k=>bounds[k]===view.bounds[k]))return view;
  const next={...view,bounds:{...bounds},reportedBounds:{...(view.reportedBounds??view.bounds)}};
  if(!isNativeVectorSourceView(next))throw Error("E_FIGMA_INTEGRITY: invalid resolved native source window");
  return next;
}
