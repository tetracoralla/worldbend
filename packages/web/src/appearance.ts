import {receivingInstanceId} from "./receiving-instance-id";
import type { AppearanceDeliveryPlan } from "./generated/core-contract";
import {surfaceLocalSize} from "./surface-local-size";
export type { AppearanceDeliveryPlan } from "./generated/core-contract";

export function validateAppearanceDelivery(next: AppearanceDeliveryPlan): void {
  const m = next.material;
  if (next.schema !== "worldbend.appearance-delivery@0.1" || next.version !== "0.1" || (next.target !== "web" && next.target !== "web-color-preserving") || !next.web || !m ||
    ![m.radius, m.depth, m.refraction, m.dispersion, m.lightIntensity, m.lightAngle].every(Number.isFinite) ||
    m.radius < 0 || m.radius > 1000 || m.depth < 1 || m.depth > 1000 ||
    m.refraction < 0 || m.refraction > 1 || m.dispersion < 0 || m.dispersion > 1 || m.lightIntensity < 0 || m.lightIntensity > 1 || m.lightAngle < 0 || m.lightAngle >= 360 || typeof m.visible !== "boolean") throw new Error("Invalid canonical Web appearance delivery");
  if (next.web.displacement && (!Number.isFinite(next.web.displacement.scale) || !Number.isFinite(next.web.displacement.chromaticOffset) || next.web.displacement.scale < 0 || next.web.displacement.scale > 96 || next.web.displacement.chromaticOffset < 0 || next.web.displacement.chromaticOffset > 24)) throw new Error("Invalid Web optical mapping");
  if (next.web.rimDepth != null && (!Number.isFinite(next.web.rimDepth) || next.web.rimDepth < 0 || next.web.rimDepth > 100)) throw new Error("Invalid Web rim depth");
  if (next.target === "web-color-preserving" &&
    ((m.visible ? !/^blur\((?:\d+(?:\.\d+)?)px\)$/.test(next.web.backdropFilter) : next.web.backdropFilter !== "") || next.web.couplings?.length !== 0)) {
    throw new Error("Color-preserving delivery cannot contain global color compensation; request its canonical profile receipt");
  }
}

const attachedSurfaces = new WeakSet<HTMLElement>();

export interface AppearanceHandle {
  present(): void;
  /** SVG backdrop optics require browser support; frost-only is an explicit fallback. */
  readonly mode: "svg-optics" | "frost-only";
  /** Inline declarations changed by the host are relinquished for this binding. */
  readonly preservedProperties: readonly string[];
  update(plan: AppearanceDeliveryPlan): void;
  /** Host visibility is transient; it does not rewrite the design delivery fingerprint. */
  setVisible(visible: boolean | undefined): void;
  destroy(): void;
}
export interface AppearanceOptions {
  /** Prepare without changing the host until present(). */
  deferPresentation?: boolean;
  /** Use frost-only when the browser cannot render SVG backdrop filters. */
  optics?: "svg" | "frost-only";
  /** Corner radius in CSS pixels; defaults to the surface computed border radius. */
  cornerRadius?: number;
  interactive?: boolean;
}

/** Bind a canonical delivery to an existing DOM surface, preserving its content.
 * The browser samples live DOM behind the surface, including text, scrolling
 * and video. No page screenshot or DOM-to-image capture is involved.
 */
export function attachAppearance(element: HTMLElement, initial: AppearanceDeliveryPlan, options: AppearanceOptions = {}): AppearanceHandle {
  if (attachedSurfaces.has(element)) throw new Error("This surface already has an appearance handle");
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error("Appearance needs a live document");
  const ns = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
  const defs = doc.createElementNS(ns, "defs");
  svg.append(defs);
  const filter = doc.createElementNS(ns, "filter");
  // Per-instance IDs avoid accidentally sampling another control's map.
  const id = `worldbend-glass-${receivingInstanceId(win.crypto)}`;
  filter.id = id;
  filter.setAttribute("color-interpolation-filters", "sRGB");
  filter.setAttribute("x", "-20%"); filter.setAttribute("y", "-20%");
  filter.setAttribute("width", "140%"); filter.setAttribute("height", "140%");
  defs.append(filter);
  const map = doc.createElement("canvas");
  const context = map.getContext("2d");
  if (!context) throw new Error("Appearance displacement map needs Canvas 2D");
  const mode = options.optics === "frost-only" || !win.CSS.supports("backdrop-filter", `url("#${id}")`) ? "frost-only" : "svg-optics";
  const keys = ["backdrop-filter", "-webkit-backdrop-filter", "box-shadow", "border"];
  const saved = new Map(keys.map(k => [k, { value: element.style.getPropertyValue(k), priority: element.style.getPropertyPriority(k) }]));
  const owned = new Map<string, string>();
  const preserved = new Set<string>();
  let plan = initial;
  let destroyed = false,presented=false;
  let pressed = false;
  let visibilityOverride: boolean | undefined;
  let frame = 0;


  function write(key: string, value: string): void {
    if (preserved.has(key)) return;
    if (owned.has(key) && (element.style.getPropertyValue(key) !== owned.get(key) ||
      element.style.getPropertyPriority(key) !== "")) {
      preserved.add(key); owned.delete(key); return;
    }
    if (value) element.style.setProperty(key, value); else element.style.removeProperty(key);
    owned.set(key, element.style.getPropertyValue(key));
  }
  function primitive(tag: string, attrs: Record<string, string>): SVGElement {
    const e = doc.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
    filter.append(e); return e;
  }
  function render(): void {
    frame = 0;
    if (destroyed || !presented) return;
    const web = plan.web!;
    const m = plan.material;
    filter.replaceChildren();
    if (!m.visible || visibilityOverride === false) {
      for (const key of keys) write(key, "");
      return;
    }
    let backdrop = web.backdropFilter;
    if (mode === "svg-optics" && web.displacement) {
      const style = win!.getComputedStyle(element);
      const {width,height} = surfaceLocalSize(element,style);
      const ratio = Math.min(1, 256 / Math.max(width, height));
      map.width = Math.max(1, Math.round(width * ratio)); map.height = Math.max(1, Math.round(height * ratio));
      const radius = Math.max(0, Math.min(width / 2, height / 2, options.cornerRadius ?? (parseFloat(style.borderTopLeftRadius) || 0)));
      const rimDepth = Number.isFinite(web.rimDepth) ? web.rimDepth : Math.min(m.depth, 20);
      const rim = Math.min(width / 2, height / 2, 8 + rimDepth * 1.8);
      const pixels = context!.createImageData(map.width, map.height);
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        const px = (x + .5) / map.width * width - width / 2;
        const py = (y + .5) / map.height * height - height / 2;
        const qx = Math.abs(px) - (width / 2 - radius);
        const qy = Math.abs(py) - (height / 2 - radius);
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
        const len = Math.hypot(ox, oy);
        const sd = len + Math.min(Math.max(qx, qy), 0) - radius;
        const strength = Math.pow(Math.max(0, 1 - Math.max(0, -sd) / rim), 2);
        let nx = 0, ny = 0;
        if (len > 0) { nx = ox / len * Math.sign(px); ny = oy / len * Math.sign(py); }
        else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
        const i = (y * map.width + x) * 4;
        pixels.data[i] = Math.round(127.5 - nx * strength * 127.5);
        pixels.data[i + 1] = Math.round(127.5 - ny * strength * 127.5);
        pixels.data[i + 2] = 128; pixels.data[i + 3] = 255;
      }
      context!.putImageData(pixels, 0, 0);
      // Percentages resolve against the hidden SVG viewport (zero sized),
      // not this CSS surface. Empty maps displace the whole backdrop. Use the
      // same explicit logical extent that authored the edge field instead.
      primitive("feImage", { href: map.toDataURL(), result: "map", preserveAspectRatio: "none", x: "0", y: "0", width: String(width), height: String(height) });
      const scale = web.displacement.scale * (pressed ? .7 : 1);
      const chromatic = web.displacement.chromaticOffset;
      const base = { in: "SourceGraphic", in2: "map", xChannelSelector: "R", yChannelSelector: "G" };
      primitive("feDisplacementMap", { ...base, scale: String(scale), result: "glass" });
      if (chromatic > 0) {
        primitive("feDisplacementMap", { ...base, in: "glass", scale: String(chromatic), result: "rs" });
        primitive("feColorMatrix", { in: "rs", values: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0", result: "r" });
        primitive("feColorMatrix", { in: "glass", values: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0", result: "g" });
        primitive("feDisplacementMap", { ...base, in: "glass", scale: String(-chromatic), result: "bs" });
        primitive("feColorMatrix", { in: "bs", values: "0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0", result: "b" });
        primitive("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" });
        primitive("feBlend", { in: "rg", in2: "b", mode: "screen" });
      }
      backdrop += ` url("#${id}")`;
    }
    write("backdrop-filter", backdrop); write("-webkit-backdrop-filter", backdrop);
    write("box-shadow", pressed ? `${web.boxShadow}, inset 0 0 12px rgba(255,255,255,.3)` : web.boxShadow);
    write("border", `1px solid rgba(255,255,255,${.08 + .25 * m.lightIntensity})`);
  }
  function schedule(): void { if (!destroyed && !frame) frame = win!.requestAnimationFrame(render); }
  function down(): void { pressed = true; schedule(); }
  function up(): void { pressed = false; schedule(); }
  validateAppearanceDelivery(initial); // Validate before writing any DOM or styles.
  attachedSurfaces.add(element);
  const observer = new win.ResizeObserver(schedule);
  function present(){
    if(destroyed)throw Error('Appearance handle is destroyed');if(presented)return;presented=true;
    element.append(svg);observer.observe(element);
    if (options.interactive !== false) {
      element.addEventListener("pointerdown", down); win!.addEventListener("pointerup", up); win!.addEventListener("pointercancel", up); win!.addEventListener("blur", up);
      element.addEventListener("keydown", keydown); element.addEventListener("keyup", keyup); element.addEventListener("blur", up);
    }
    render();
  }

  function keydown(e: KeyboardEvent): void { if (e.key === " " || e.key === "Enter") down(); }
  function keyup(e: KeyboardEvent): void { if (e.key === " " || e.key === "Enter") up(); }
  if(!options.deferPresentation)present();
  return {
    present,
    mode,
    get preservedProperties() { return [...preserved]; },
    update(next) { if (destroyed) throw new Error("Appearance handle is destroyed"); validateAppearanceDelivery(next); plan = next; schedule(); },
    setVisible(visible) { if (destroyed) throw new Error("Appearance handle is destroyed"); visibilityOverride = visible; schedule(); },
    destroy() {
      if (destroyed) return; destroyed = true; attachedSurfaces.delete(element); observer.disconnect(); if (frame) win!.cancelAnimationFrame(frame); svg.remove();
      element.removeEventListener("pointerdown", down); win!.removeEventListener("pointerup", up); win!.removeEventListener("pointercancel", up); win!.removeEventListener("blur", up);
      element.removeEventListener("keydown", keydown); element.removeEventListener("keyup", keyup); element.removeEventListener("blur", up);
      for (const key of keys) if (owned.has(key) && element.style.getPropertyValue(key) === owned.get(key) &&
        element.style.getPropertyPriority(key) === "") {
        const old = saved.get(key)!; if (old.value) element.style.setProperty(key, old.value, old.priority); else element.style.removeProperty(key);
      }
    },
  };
}
