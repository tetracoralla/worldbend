import type { CardPoseOutput, TransformSpec } from "@worldbend/web/types";
import type { TransformWebGLRenderer } from "@worldbend/web";

/** Bitmap authoring can use the shared mip/coverage renderer without flattening
 * a developer's interactive DOM. The transparent image layers remain the input
 * targets; the canvas only presents the already projected core sample. */
export function createCardRasterPreview(stage: HTMLElement, onError: (error: unknown) => void) {
  const makeCanvas = () => {
    const node = document.createElement("canvas");
    node.className = "card-raster-preview";
    node.setAttribute("aria-hidden", "true");
    return node;
  };
  let canvas = makeCanvas();
  stage.append(canvas);
  let renderer: TransformWebGLRenderer | undefined;
  let ticket = 0;
  let uploadedSrc = "";
  let contextUnavailable = false;
  let reportedError = "";
  let mirror: {src: string; ready: Promise<ImageBitmap>} | undefined;
  let last: {pose: CardPoseOutput; front: HTMLImageElement; back?: HTMLImageElement} | undefined;
  const decoded = new WeakMap<HTMLImageElement, {src: string; ready: Promise<void>}>();
  const ready = (image: HTMLImageElement) => {
    const cached = decoded.get(image);
    if (cached?.src === image.src) return cached.ready;
    const value = {src: image.src, ready: image.decode()}; decoded.set(image, value);
    return value.ready;
  };
  function draw(pose: CardPoseOutput, front: HTMLImageElement, back?: HTMLImageElement): void {
    last = {pose, front, ...(back ? {back} : {})};
    const current = ++ticket;
    const width = stage.clientWidth, height = stage.clientHeight;
    if (width <= 0 || height <= 0) return;
    const q = pose.quad;
    const points = [q.tl, q.tr, q.br, q.bl];
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const fit = Math.min(1, Math.max(1,width-32) / Math.max(1,maxX-minX), Math.max(1,height-32) / Math.max(1,maxY-minY));
    const x = (width - (minX+maxX)*fit) / 2, y = (height - (minY+maxY)*fit) / 2;
    // Keep the whole projected artwork visible. Position and independent scale
    // also fit the transparent input layers; the core still owns their transform.
    for (const layer of [front, ...(back ? [back] : [])]) {
      layer.style.left = `${x}px`; layer.style.top = `${y}px`;
      layer.style.setProperty("scale", String(fit));
    }
    if (contextUnavailable) return;
    if (pose.face === "edge") {
      canvas.width = canvas.width; // Clear an edge view without an invalid solve.
      stage.classList.add("has-raster-preview");
      return;
    }
    const image = pose.face === "back" && back ? back : front;
    void (async () => {
      const [web] = await Promise.all([import("@worldbend/web"), ready(image)]);
      if (current !== ticket || !stage.isConnected) return;
      const displayScale = stage.getBoundingClientRect().width / width;
      const density = Math.min((devicePixelRatio || 1) * displayScale, 4096 / Math.max(width, height));
      const point = (p: {x: number; y: number}) => ({x: (p.x * fit + x) * density, y: (p.y * fit + y) * density});
      const target = pose.face === "back" ? {tl:q.tr,tr:q.tl,br:q.bl,bl:q.br} : q;
      const solved = await web.solveTransformPreview({schema:"worldbend.transform",version:"0.1",
        destination:{space:"pixel",reference:{width:width*density,height:height*density},
          quad:{tl:point(target.tl),tr:point(target.tr),br:point(target.br),bl:point(target.bl)}},
        content:{fit:"stretch"}} satisfies TransformSpec);
      if (current !== ticket) return;
      renderer ??= new web.TransformWebGLRenderer(canvas, {
        onContextLost: () => {contextUnavailable = true; stage.classList.remove("has-raster-preview");},
        onContextRestored: () => {contextUnavailable = false; if (last) draw(last.pose,last.front,last.back);},
      });
      let texture: HTMLImageElement | ImageBitmap = image;
      if (pose.face === "back" && !back) {
        if (mirror?.src !== front.src) {
          releaseMirror();
          const reflected = document.createElement("canvas");
          reflected.width = front.naturalWidth; reflected.height = front.naturalHeight;
          const context = reflected.getContext("2d");
          if (!context) throw new Error("Card back preview unavailable");
          context.translate(reflected.width,0); context.scale(-1,1); context.drawImage(front,0,0);
          // Immutable texture storage lets the shared renderer reuse the
          // mirrored face across animation frames without uploading it again.
          mirror = {src:front.src,ready:createImageBitmap(reflected)};
        }
        texture = await mirror.ready;
        if (current !== ticket) return;
      }
      if (uploadedSrc !== image.src) {renderer.invalidateSource(); uploadedSrc = image.src;}
      renderer.render(texture,solved,undefined,"high");
      reportedError = "";
      stage.classList.add("has-raster-preview");
    })().catch(error => {
      if (current !== ticket) return;
      stage.classList.remove("has-raster-preview");
      const message = String(error);
      if (message !== reportedError) {reportedError = message; onError(error); }
    });
  }
  function releaseMirror(): void {
    void mirror?.ready.then(bitmap => bitmap.close(), () => undefined);
    mirror = undefined;
  }
  function clear(): void {
    ++ticket; last = undefined; releaseMirror(); uploadedSrc = "";
    contextUnavailable = false; reportedError = "";
    if (renderer) {
      renderer.dispose(); renderer = undefined;
      // Disposal permanently releases this canvas's context. A later artwork
      // must get a fresh canvas instead of reopening the lost context.
      const next = makeCanvas(); canvas.replaceWith(next); canvas = next;
    }
    canvas.width = 1; canvas.height = 1;
    stage.classList.remove("has-raster-preview");
  }
  const resized = () => {if (last) draw(last.pose, last.front, last.back);};
  window.addEventListener("resize", resized);
  return {draw, clear, dispose() {window.removeEventListener("resize", resized); clear(); canvas.remove();}};
}
