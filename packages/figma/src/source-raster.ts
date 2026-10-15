import { canUseNativeSource, nativeAppearanceInsideViewport } from "./native-document";
import type {NativeVectorSourceView} from "./native-vector";
import {isNativeVectorSourceView} from "./native-vector-view";

/** Persist the actual current input-view policy, not an output-carrier guess. */
export function nativeVectorSourceView(source:SceneNode,policy?:NativeVectorSourceView["policy"]):NativeVectorSourceView {
  const chosen=policy??(sourceRasterBounds(source).useAbsoluteBounds?"logical":"appearance");
  const bounds=chosen==="logical"?source.absoluteBoundingBox:renderBounds(source)??source.absoluteBoundingBox;
  if(!validBox(bounds))throw Error("E_FIGMA_STATE: native Vector source window unavailable");
  return {policy:chosen,selection:policy===undefined?"automatic":"explicit",bounds:{...bounds}};
}
/** Refresh automatic admission, retaining a fixed policy only when its author
 * requested it or a legacy record already carried that older restriction. */
export function currentNativeVectorSourceView(source:SceneNode,view?:NativeVectorSourceView):NativeVectorSourceView {
  const next=nativeVectorSourceView(source,view?.selection==="automatic"?undefined:view?.policy);
  if(view&&view.selection===undefined)delete next.selection;
  return next;
}
/** A retained full-geometry window is bound to its original host report, not
 * incorrectly compared to that rounded report as if they were equal. Whole
 * source/role proofs independently guard glyphs, paints, aliases and bases. */
export function nativeVectorSourceViewMatches(source:SceneNode,view:NativeVectorSourceView):boolean {
  if(!isNativeVectorSourceView(view))return false;
  const fresh=currentNativeVectorSourceView(source,view),actual=fresh.bounds,expected=view.reportedBounds??view.bounds;
  return fresh.policy===view.policy&&(["x","y","width","height"] as const).every(k=>actual[k]===expected[k]);
}
export function retainedNativeVectorSourceView(source:SceneNode,view?:NativeVectorSourceView):NativeVectorSourceView {
  // Retain the authored policy/provenance, never a previous derived enclosure.
  // A fresh capture/export starts at its current reported native window; the
  // canonical whole-geometry resolver independently recomputes any correction.
  return currentNativeVectorSourceView(source,view);
}

/** Preserve a clipped Frame's empty margins and region-painted Vector domain,
 * while allowing the host's full appearance crop when paint extends outside
 * the logical box. In particular, clipsContent does not clip the Frame's own
 * outside border, shadow or blur. Capture remains read-only.
 */
export function sourceRasterBounds(source: SceneNode, logicalViewport = false): Pick<ExportSettingsImage, "useAbsoluteBounds"> {
  const regionOnlyVector = source.type === "VECTOR" && !Array.isArray(source.fills) &&
    source.strokes.every(paint => paint.visible === false || paint.opacity === 0) &&
    source.effects.every(effect => effect.visible === false);
  return logicalViewport || regionOnlyVector || (canUseNativeSource(source) && nativeAppearanceInsideViewport(source))
    ? { useAbsoluteBounds: true } : {};
}

/** The image domain actually exported by sourceRasterBounds. This is raster
 * transport metadata, not a replacement for native geometry's logical bounds.
 * Use it for capture density, raster placement and axis budgets together.
 */
export function sourceRasterViewBox(source: SceneNode, logicalViewport = false, nativeView?:NativeVectorSourceView): Rect | null {
  if(nativeView)return retainedNativeVectorSourceView(source,nativeView).bounds;
  const box = sourceRasterBounds(source, logicalViewport).useAbsoluteBounds
    ? source.absoluteBoundingBox
    : renderBounds(source) ?? source.absoluteBoundingBox;
  return validBox(box) ? { ...box } : null;
}

export function sameSourceRasterViewBox(source: SceneNode, expected: Rect, logicalViewport = false): boolean {
  const current = sourceRasterViewBox(source, logicalViewport);
  return current !== null && (["x", "y", "width", "height"] as const).every(key => current[key] === expected[key]);
}

function renderBounds(source: SceneNode): Rect | null {
  return "absoluteRenderBounds" in source ? source.absoluteRenderBounds : null;
}

function validBox(box: Rect | null | undefined): box is Rect {
  return !!box &&
    [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}
