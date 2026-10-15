import {receivingInstanceId} from "./receiving-instance-id";
import {acquireSurfaceEnvironment} from './surface-environment';
import type { TextureDeliveryPlan } from "./generated/core-contract";
export type { TextureDeliveryPlan } from "./generated/core-contract";

export function validateTextureDelivery(next: TextureDeliveryPlan): void {
  const material = next.material;
  if (next.schema !== "worldbend.texture-delivery@0.1" || next.version !== "0.1" ||
    next.target !== "web" || !next.web || !material ||
    typeof material.visible !== "boolean" || typeof material.clipToShape !== "boolean" ||
    typeof next.web.grainTile !== "string" ||
    (material.visible && !next.web.grainTile.startsWith("data:image/svg+xml,")) ||
    !["normal", "multiply", "overlay"].includes(next.web.grainBlend) ||
    !Number.isFinite(next.web.grainTileSize) || next.web.grainTileSize <= 0 ||
    ![material.grain, material.grainSize, material.etch, material.etchSize].every(Number.isFinite) ||
    !/^#[0-9a-fA-F]{6}$/.test(material.grainColor) ||
    material.grain < 0 || material.grain > 1 ||
    material.grainSize < 0.5 || material.grainSize > 1000 ||
    material.etch < 0 || material.etch > 1000 ||
    material.etchSize < 0.5 || material.etchSize > 1000) {
    throw new Error("Invalid canonical Web texture delivery");
  }
  const etch = next.web.etch;
  if (etch && (!Number.isFinite(etch.baseFrequency) || !Number.isFinite(etch.surfaceScale) ||
    etch.baseFrequency <= 0 || etch.baseFrequency > 4 || etch.surfaceScale < 0 || etch.surfaceScale > 10)) {
    throw new Error("Invalid Web etch mapping");
  }
}

const attachedTextures = new WeakSet<HTMLElement>();

export interface TextureHandle {
  present(): void;
  update(plan: TextureDeliveryPlan): void;
  /** Host visibility is transient; it does not rewrite the design delivery fingerprint. */
  setVisible(visible: boolean | undefined): void;
  destroy(): void;
}

export interface TextureOptions {
  /** Prepare without changing the host until present(). */
  deferPresentation?: boolean;
  /** Corner radius in CSS pixels; defaults to the surface computed border radius. */
  cornerRadius?: number;
}

/**
 * Bind a canonical texture delivery to an existing DOM surface, preserving
 * its content. The delivery's grain tile drives one non-interactive overlay
 * layer; the etch route is a second overlay carrying achromatic SVG bump
 * lighting blended over the surface. The caller owns layout, transparency,
 * stacking, semantics and accessibility policy.
 */
export function attachTexture(
  element: HTMLElement,
  initial: TextureDeliveryPlan,
  options: TextureOptions = {},
): TextureHandle {
  if (attachedTextures.has(element)) throw new Error("This surface already has a texture handle");
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error("Texture needs a live document");
  const overlay = doc.createElement("div");
  overlay.setAttribute("aria-hidden", "true");
  overlay.className = "worldbend-texture";
  // The etch relief is its own layer above the grain: applying the filter to
  // the grain overlay would replace the tile instead of relieving it.
  const etchLayer = doc.createElement("div");
  etchLayer.setAttribute("aria-hidden", "true");
  etchLayer.className = "worldbend-texture-etch";
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  const defs = doc.createElementNS(ns, "defs");
  svg.append(defs);
  // Per-instance IDs avoid accidentally reusing another surface's filter.
  const filterId = `worldbend-etch-${receivingInstanceId(win.crypto)}`;
  let plan = initial;
  let destroyed = false,presented=false,releaseEnvironment:(()=>void)|undefined;
  let visibilityOverride: boolean | undefined;



  function outline(): string {
    if (options.cornerRadius === undefined) return win!.getComputedStyle(element).borderRadius;
    return `${Math.max(0, Math.min(element.clientWidth / 2, element.clientHeight / 2, options.cornerRadius))}px`;
  }

  /** Rebuild the etch filter from the plan's canonical numbers. */
  function renderFilter(): void {
    defs.replaceChildren();
    const etch = plan.web!.etch;
    if (!etch) {
      etchLayer.style.display = "none";
      return;
    }
    const filter = doc.createElementNS(ns, "filter");
    filter.id = filterId;
    filter.setAttribute("x", "-10%"); filter.setAttribute("y", "-10%");
    filter.setAttribute("width", "120%"); filter.setAttribute("height", "120%");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const turbulence = doc.createElementNS(ns, "feTurbulence");
    turbulence.setAttribute("type", "fractalNoise");
    turbulence.setAttribute("baseFrequency", String(etch.baseFrequency));
    turbulence.setAttribute("numOctaves", "2");
    turbulence.setAttribute("seed", "7");
    turbulence.setAttribute("result", "bump");
    const lighting = doc.createElementNS(ns, "feDiffuseLighting");
    lighting.setAttribute("in", "bump");
    lighting.setAttribute("lighting-color", "white");
    lighting.setAttribute("surfaceScale", String(etch.surfaceScale));
    lighting.setAttribute("diffuseConstant", "1");
    lighting.setAttribute("result", "light");
    const light = doc.createElementNS(ns, "feDistantLight");
    light.setAttribute("azimuth", "235");
    light.setAttribute("elevation", "55");
    lighting.append(light);
    // The lit bump composites back over the surface as paper relief; the
    // saturate step keeps the relief achromatic so the grain tint and the
    // surface under it keep their own color.
    const composite = doc.createElementNS(ns, "feComposite");
    composite.setAttribute("in", "light");
    composite.setAttribute("in2", "bump");
    composite.setAttribute("operator", "arithmetic");
    composite.setAttribute("k1", "1");
    composite.setAttribute("k2", "0");
    composite.setAttribute("k3", "0");
    composite.setAttribute("k4", "0");
    composite.setAttribute("result", "etched");
    const achromatic = doc.createElementNS(ns, "feColorMatrix");
    achromatic.setAttribute("in", "etched");
    achromatic.setAttribute("type", "saturate");
    achromatic.setAttribute("values", "0");
    filter.append(turbulence, lighting, composite, achromatic);
    defs.append(filter);
    etchLayer.style.removeProperty("display");
    etchLayer.style.setProperty("filter", `url("#${filterId}")`);
  }

  function render(): void {
    if (destroyed || !presented) return;
    const web = plan.web!;
    const material = plan.material;
    if (!material.visible || visibilityOverride === false) {
      overlay.style.removeProperty("background-image");
      etchLayer.style.display = "none";
      return;
    }
    const grainOutline = outline();
    const cornerRadius = material.clipToShape ? grainOutline : "0px";
    overlay.style.setProperty("background-image", `url("${web.grainTile}")`);
    overlay.style.setProperty("background-size", `${web.grainTileSize}px ${web.grainTileSize}px`);
    overlay.style.setProperty("mix-blend-mode", web.grainBlend);
    // Native NOISE always follows the shape. clipToShape belongs only to
    // TEXTURE/etch; disabling it must not expose rectangular grain corners.
    overlay.style.setProperty("border-radius", grainOutline);
    etchLayer.style.setProperty("border-radius", cornerRadius);
    // The filter region overscans the layer by 10% for clean relief edges;
    // the clip path keeps that overscan inside the surface outline.
    etchLayer.style.setProperty("clip-path", `inset(0 round ${cornerRadius})`);
    renderFilter();
  }

  validateTextureDelivery(initial); // Validate before writing any DOM or styles.
  overlay.style.cssText +=
    "position:absolute;inset:0;pointer-events:none;background-repeat:repeat";
  etchLayer.style.cssText +=
    "position:absolute;inset:0;pointer-events:none;mix-blend-mode:overlay";
  attachedTextures.add(element);
  const observer = new win.ResizeObserver(render);
  function present(){
    if(destroyed)throw Error('Texture handle is destroyed');if(presented)return;
    releaseEnvironment=acquireSurfaceEnvironment(element);presented=true;
    element.append(svg,overlay,etchLayer);observer.observe(element);render();
  }
  if(!options.deferPresentation)present();
  return {
    present,
    update(next) {
      if (destroyed) throw new Error("Texture handle is destroyed");
      validateTextureDelivery(next);
      plan = next;
      render();
    },
    setVisible(visible) {
      if (destroyed) throw new Error("Texture handle is destroyed");
      visibilityOverride = visible;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      attachedTextures.delete(element);
      observer.disconnect();
      svg.remove();
      overlay.remove();
      etchLayer.remove();
      releaseEnvironment?.();releaseEnvironment=undefined;
    },
  };
}
