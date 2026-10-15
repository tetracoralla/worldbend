import type { SourceCaptureFacts, Size } from "@worldbend/web/types";
import type { NativeMatrix } from "./native-frame-record";
import { nativeCaptureSnapshot } from "./source-capture";

/** SVG_STRING currently uses one exported pixel unit per capture-space unit.
 * Read its actual root window instead of guessing a rounding policy. */
export function nativeSvgCaptureFacts(source:FrameNode,svg:string,logicalSize?:Size):SourceCaptureFacts {
  const root=svg.match(/^\s*<svg\b([^>]*)>/)?.[1];
  const viewBox=root?.match(/\bviewBox\s*=\s*["']([^"']+)["']/)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if(!viewBox||viewBox.length!==4||viewBox[0]!==0||viewBox[1]!==0||
    !viewBox.slice(2).every(n=>Number.isSafeInteger(n)&&n>0))throw Error("Unsupported native SVG capture window");
  const {box:_box,...snapshot}=nativeCaptureSnapshot(source);
  const size=logicalSize??snapshot.logicalSize;
  const sx=snapshot.logicalSize.width/size.width,sy=snapshot.logicalSize.height/size.height;
  const [[a,c,e],[b,d,f]]=snapshot.logicalToCaptureSpace;
  return {...snapshot,logicalSize:size,logicalToCaptureSpace:[[a*sx,c*sy,e],[b*sx,d*sy,f]],
    captureScale:1,pixelSize:{width:viewBox[2]!,height:viewBox[3]!},convention:"fixedDensityFromOrigin"};
}

/** The transform is calculated by core from the exact capture facts. Keeping
 * the native SVG nested preserves defs, clip paths, images and root defaults. */
export function logicalSourceSvg(svg:string,matrix:NativeMatrix,size:Size):string {
  if(![size.width,size.height,...matrix.flat()].every(Number.isFinite)||size.width<=0||size.height<=0)throw Error("Invalid logical source projection");
  const [[a,c,e],[b,d,f]]=matrix;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}"><g transform="matrix(${a} ${b} ${c} ${d} ${e} ${f})">${svg}</g></svg>`;
}
