/** Filter lengths and image extents use the surface's untransformed CSS
 * border box. A screen-space bounding rectangle includes ancestor transforms
 * and cannot supply that local basis after a card scales or rotates.
 */
export function surfaceLocalSize(element: HTMLElement, style: CSSStyleDeclaration): { width: number; height: number } {
  const px = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  let width = Number.parseFloat(style.width), height = Number.parseFloat(style.height);
  if (style.boxSizing !== "border-box") {
    width += px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
    height += px(style.paddingTop) + px(style.paddingBottom) + px(style.borderTopWidth) + px(style.borderBottomWidth);
  }
  return {
    width: Math.max(1, Number.isFinite(width) ? width : element.offsetWidth),
    height: Math.max(1, Number.isFinite(height) ? height : element.offsetHeight),
  };
}
