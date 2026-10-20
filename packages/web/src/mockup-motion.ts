import {receivingInstanceId} from "./receiving-instance-id";
import {
  authorMockupMotion,
  buildWarpMesh,
  buildMockupPlaneMesh,
  planMockup,
  planMockupMotion,
} from "./bridge";
import type {
  MockupMotionAuthoringOutput,
  MockupMotionEdit,
} from "./generated/core-contract";
import { paintClipMask } from "./clip-canvas";
import { paintMockupShadow } from "./mockup-shadow";
import { TransformWebGLRenderer } from "./webgl-renderer";
import {CanvasRasterRenderer} from "./canvas-renderer";
import type {
  MockupMotionPlan,
  MockupMotionSpec,
  MockupPlan,
  WarpMesh,
} from "./types";

export type { MockupMotionPlan, MockupMotionSpec } from "./types";

/** Each image is snapshotted once. Changing caller-owned pixels requires update. */
export interface MockupMotionSource {
  id: string;
  image: CanvasImageSource;
}
export interface MockupMotionOutput {
  /** Explicit final sRGB8 matte, applied after clipping and output framing. */
  backgroundRgb?: readonly [number, number, number];
}
export interface MockupMotionOptions extends MockupMotionOutput {
  paused?: boolean;
  loop?: boolean;
  respectReducedMotion?: boolean;
  signal?: AbortSignal;
  onChange?: (state: MockupMotionState) => void;
  onError?: (error: Error) => void;
}
export interface MockupMotionState {
  revision: number;
  status: "ready" | "lost" | "disposed";
  paused: boolean;
  reducedMotion: boolean;
  visible: boolean;
  ended: boolean;
  timeMs: number;
  durationMs: number;
  frameIndex: number;
  frameCount: number;
}
export interface MockupMotionController {
  readonly canvas: HTMLCanvasElement;
  getState(): MockupMotionState;
  getSpec(): MockupMotionSpec;
  getAuthoring(): MockupMotionAuthoringOutput;
  getAuthoringGuard(): MockupMotionAuthoringGuard;
  author(
    edit: MockupMotionEdit,
    guard: MockupMotionAuthoringGuard & { signal?: AbortSignal },
  ): Promise<MockupMotionAuthoringReceipt>;
  play(): boolean;
  pause(): void;
  seek(timeMs: number): void;
  setVisible(visible: boolean): void;
  /** Atomic source/design replacement. Preserves the latest local playhead and pause. */
  update(
    spec: MockupMotionSpec,
    sources: readonly MockupMotionSource[],
    guard: { expectedRevision: number; signal?: AbortSignal },
    output?: MockupMotionOutput,
  ): Promise<void>;
  destroy(): void;
}
export interface MockupMotionAuthoringGuard {
  instanceId: string;
  expectedRevision: number;
  fingerprint: string;
}
export interface MockupMotionAuthoringReceipt {
  authoring: MockupMotionAuthoringOutput;
  guard: MockupMotionAuthoringGuard;
}

interface Prepared {
  authoring: MockupMotionAuthoringOutput;
  spec: MockupMotionSpec;
  motion: MockupMotionPlan;
  plans: MockupPlan[];
  images: Map<string, ImageBitmap>;
  meshes: (WarpMesh | undefined)[];
  presentationMesh: WarpMesh | undefined;
  frameMs: number;
  durationMs: number;
}
function outputMatte(value:MockupMotionOutput):readonly [number,number,number]|undefined {
  const rgb=value.backgroundRgb;
  if(rgb!==undefined&&(!Array.isArray(rgb)||rgb.length!==3||!rgb.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=255)))throw Error("Invalid scene output matte");
  return rgb?[...rgb] as [number,number,number]:undefined;
}
const attached = new WeakSet<HTMLElement>();
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
function cancelled(): DOMException {
  return new DOMException("Scene receiving cancelled", "AbortError");
}
function close(prepared: Prepared): void {
  for (const image of prepared.images.values()) image.close();
}
function sourceSize(image: CanvasImageSource): [number, number] {
  if ("naturalWidth" in image) return [image.naturalWidth, image.naturalHeight];
  if ("videoWidth" in image) return [image.videoWidth, image.videoHeight];
  if ("displayWidth" in image) return [image.displayWidth, image.displayHeight];
  const width = image.width,
    height = image.height;
  return [
    typeof width === "number" ? width : width.baseVal.value,
    typeof height === "number" ? height : height.baseVal.value,
  ];
}
async function prepare(
  spec: MockupMotionSpec,
  sources: readonly MockupMotionSource[],
  check: () => void,
  signals: readonly AbortSignal[] = [],
): Promise<Prepared> {
  check();
  const ownedSpec = structuredClone(spec);
  const authoring = await authorMockupMotion({
    action: "inspect",
    spec: ownedSpec,
  });
  check();
  const motion = await planMockupMotion(ownedSpec);
  check();
  if (
    sources.length !== motion.sourceIds.length ||
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some((s) => !motion.sourceIds.includes(s.id))
  )
    throw new Error("Scene sources must exactly match authored source IDs");
  let pixels = 0;
  for (const { image } of sources) {
    const [width, height] = sourceSize(image);
    if (
      ![width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
      (pixels += width * height) > MAX_SOURCE_PIXELS
    )
      throw new Error("Scene source snapshots exceed the decoded pixel budget");
  }
  const images = new Map<string, ImageBitmap>();
  try {
    for (const source of sources) {
      const bitmap = await snapshot(source.image, signals, check);
      images.set(source.id, bitmap);
      check();
    }
    const plans: MockupPlan[] = [];
    // Expand/solve once, not on every animation tick. Allow cancellation between frames.
    for (const frame of motion.frameSpecs) {
      plans.push(await planMockup(frame));
      check();
      // Yield to controls and abort delivery; resolved Promise chains alone starve native input.
      if (plans.length % 16 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        check();
      }
    }
    const meshes: (WarpMesh | undefined)[] = [];
    for (const plane of motion.frameSpecs[0]!.planes) {
      meshes.push(await buildMockupPlaneMesh(plane));
      check();
    }
    const frameMs =
      (1000 * motion.timebase.denominator) / motion.timebase.numerator;
    const warp=motion.presentation?.spec.transform.content?.warp;
    const presentationMesh=warp?await buildWarpMesh(warp):undefined;
    check();
    return {
      authoring,
      spec: ownedSpec,
      motion,
      plans,
      images,
      meshes,
      presentationMesh,
      frameMs,
      durationMs: frameMs * plans.length,
    };
  } catch (error) {
    for (const image of images.values()) image.close();
    throw error;
  }
}
function snapshot(
  image: CanvasImageSource,
  signals: readonly AbortSignal[],
  check: () => void,
): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () =>
      signals.forEach((signal) => signal.removeEventListener("abort", abort));
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(cancelled());
    };
    try {
      check();
      if (signals.some((signal) => signal.aborted)) {
        abort();
        return;
      }
      signals.forEach((signal) =>
        signal.addEventListener("abort", abort, { once: true }),
      );
      void createImageBitmap(image).then(
        (bitmap) => {
          if (settled) {
            bitmap.close();
            return;
          }
          try {
            check();
            settled = true;
            cleanup();
            resolve(bitmap);
          } catch (error) {
            settled = true;
            cleanup();
            bitmap.close();
            reject(error);
          }
        },
        (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        },
      );
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });
}

/** Receive the same multi-plane scene program used by still/video delivery.
 * The binding creates only its decorative canvas; application content/actions remain owned by the host.
 */
export async function attachMockupMotion(
  host: HTMLElement,
  spec: MockupMotionSpec,
  sources: readonly MockupMotionSource[],
  options: MockupMotionOptions = {},
): Promise<MockupMotionController> {
  if (attached.has(host))
    throw new Error("This host already receives a motion scene");
  if (options.signal?.aborted) throw cancelled();
  const instanceId = receivingInstanceId(crypto);
  let matte=outputMatte(options);
  attached.add(host);
  let disposed = false,
    status: MockupMotionState["status"] = "ready";
  const lifetime = new AbortController();
  let prepared: Prepared | undefined;
  let renderer: TransformWebGLRenderer | undefined;
  let shadowRenderer: TransformWebGLRenderer | undefined;
  let wholeRenderer:TransformWebGLRenderer|undefined;
  let framingRenderer:CanvasRasterRenderer|undefined;
  const lostRenderers = new Set<TransformWebGLRenderer>();
  let revision = 1,
    pending = false,
    raf = 0,
    lastTick: number | undefined;
  let timeMs = 0,
    frameIndex = -1,
    paused = options.paused ?? true,
    visible = true,
    onscreen = true;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const canvas = document.createElement("canvas"),
    composite = document.createElement("canvas"),
    mask = document.createElement("canvas");
  const shadowMask = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "display:block;width:100%;height:auto;pointer-events:none";
  const output = canvas.getContext("2d"),
    context = composite.getContext("2d"),
    maskContext = mask.getContext("2d");
  let observer: IntersectionObserver | undefined;
  const check = (signal?: AbortSignal): void => {
    if (disposed || options.signal?.aborted || signal?.aborted)
      throw cancelled();
  };
  const getState = (): MockupMotionState => ({
    revision,
    status,
    paused,
    reducedMotion: options.respectReducedMotion !== false && reduced.matches,
    visible: visible && onscreen && !document.hidden,
    ended: timeMs >= (prepared?.durationMs ?? Infinity),
    timeMs,
    durationMs: prepared?.durationMs ?? 0,
    frameIndex: Math.max(0, frameIndex),
    frameCount: prepared?.plans.length ?? 0,
  });
  const report = (error: unknown): void => {
    try {
      options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } catch {
      /* Host callbacks cannot corrupt receiving state. */
    }
  };
  const notify = (): void => {
    try {
      options.onChange?.(getState());
    } catch (error) {
      report(error);
    }
  };
  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTick = undefined;
  };
  const eligible = (): boolean =>
    !disposed &&
    status === "ready" &&
    !paused &&
    getState().visible &&
    !getState().reducedMotion;
  const render = (candidate: Prepared, position: number, background:readonly [number,number,number]|null=matte??null): number => {
    if (!context || !output || !maskContext || !renderer)
      throw new Error("Scene canvas is unavailable");
    const index = Math.min(
      candidate.plans.length - 1,
      Math.floor(position / candidate.frameMs),
    );
    const plan = candidate.plans[index]!;
    if (composite.width !== plan.canvas.width)
      composite.width = plan.canvas.width;
    if (composite.height !== plan.canvas.height)
      composite.height = plan.canvas.height;
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, composite.width, composite.height);
    if (plan.background.kind === "color") {
      const [r, g, b, a] = plan.background.rgba;
      context.fillStyle = `rgba(${r},${g},${b},${a / 255})`;
      context.fillRect(0, 0, composite.width, composite.height);
    }
    for (let i = 0; i < plan.planes.length; i++) {
      const plane = plan.planes[i]!;
      if (
        plane.shadow &&
        plane.shadow.shadow.opacity > 0 &&
        plane.opacity > 0
      ) {
        // Keep the expanded caster's drawing buffer separate: switching one
        // GL canvas between scene/shadow sizes reallocates it twice per plane.
        shadowRenderer ??= createRenderer();
        shadowRenderer.render(
          candidate.images.get(plane.sourceId)!,
          plane.shadow.solve,
          candidate.meshes[i],
          "high",
        );
        paintMockupShadow(
          context,
          shadowRenderer.canvas,
          plane.shadow,
          plane.opacity,
          1,
          shadowMask,
        );
      }
      renderer.render(
        candidate.images.get(plane.sourceId)!,
        plane.solve,
        candidate.meshes[i],
        "high",
      );
      context.globalAlpha = plane.opacity;
      context.drawImage(renderer.canvas, 0, 0);
    }
    context.globalAlpha = 1;
    if (plan.clip) {
      mask.width = composite.width;
      mask.height = composite.height;
      paintClipMask(maskContext, plan.clip, plan.canvas);
      context.globalCompositeOperation = "destination-in";
      context.drawImage(mask, 0, 0);
      context.globalCompositeOperation = "source-over";
    }
    let presented=composite;
    const presentation=candidate.motion.presentationFrames?.[index]??candidate.motion.presentation;
    if(presentation){
      wholeRenderer??=createRenderer();
      wholeRenderer.invalidateSource();
      wholeRenderer.render(composite,presentation.solve,candidate.presentationMesh,"high");
      presented=wholeRenderer.canvas;
      if(presentation.canvas){
        framingRenderer??=new CanvasRasterRenderer();
        framingRenderer.render(presented,presentation.canvas,"high");
        presented=framingRenderer.canvas;
      }
    }
    // Publish only after composition, whole-scene rendering and framing succeed.
    if (canvas.width !== presented.width) canvas.width = presented.width;
    if (canvas.height !== presented.height) canvas.height = presented.height;
    output.clearRect(0, 0, canvas.width, canvas.height);
    if(background){output.fillStyle=`rgb(${background.join(",")})`;output.fillRect(0,0,canvas.width,canvas.height);}
    output.drawImage(presented, 0, 0);
    return index;
  };
  const paint = (force = false): void => {
    if (!prepared || disposed || status !== "ready") return;
    const next = Math.min(
      prepared.plans.length - 1,
      Math.floor(timeMs / prepared.frameMs),
    );
    if (force || next !== frameIndex) frameIndex = render(prepared, timeMs);
  };
  const schedule = (): void => {
    if (!raf && eligible()) raf = requestAnimationFrame(tick);
  };
  const tick = (now: number): void => {
    raf = 0;
    if (!eligible() || !prepared) {
      lastTick = undefined;
      return;
    }
    if (lastTick !== undefined) timeMs += Math.max(0, now - lastTick);
    lastTick = now;
    if (timeMs >= prepared.durationMs) {
      if (options.loop) timeMs %= prepared.durationMs;
      else {
        timeMs = prepared.durationMs;
        paused = true;
        stop();
      }
    }
    try {
      paint();
      notify();
      schedule();
    } catch (error) {
      paused = true;
      stop();
      report(error);
      notify();
    }
  };
  const visibilityChange = (): void => {
    stop();
    schedule();
    notify();
  };
  const reducedChange = (): void => {
    stop();
    schedule();
    notify();
  };
  const destroy = (): void => {
    if (disposed) return;
    disposed = true;
    status = "disposed";
    stop();
    observer?.disconnect();
    lifetime.abort();
    document.removeEventListener("visibilitychange", visibilityChange);
    reduced.removeEventListener("change", reducedChange);
    options.signal?.removeEventListener("abort", destroy);
    renderer?.dispose();
    shadowRenderer?.dispose();
    wholeRenderer?.dispose();
    framingRenderer?.dispose();
    lostRenderers.clear();
    if (prepared) close(prepared);
    canvas.remove();
    composite.width = mask.width = shadowMask.width = 1;
    composite.height = mask.height = shadowMask.height = 1;
    attached.delete(host);
  };
  options.signal?.addEventListener("abort", destroy, { once: true });
  function createRenderer(): TransformWebGLRenderer {
    let instance: TransformWebGLRenderer;
    instance = new TransformWebGLRenderer(undefined, {
      preserveDrawingBuffer: true,
      onContextLost() {
        if (disposed) return;
        lostRenderers.add(instance);
        status = "lost";
        stop();
        notify();
      },
      onContextRestored() {
        if (disposed) return;
        lostRenderers.delete(instance);
        if (lostRenderers.size) return;
        status = "ready";
        try {
          paint(true);
          schedule();
          notify();
        } catch (error) {
          status = "lost";
          report(error);
          notify();
        }
      },
    });
    return instance;
  }
  try {
    if (!output || !context || !maskContext)
      throw new Error("Canvas 2D is required for scene receiving");
    prepared = await prepare(spec, sources, () => check(), [
      lifetime.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    check();
    renderer = createRenderer();
    frameIndex = render(prepared, 0);
    check();
    host.append(canvas);
    observer = new IntersectionObserver((entries) => {
      onscreen = entries.some((entry) => entry.isIntersecting);
      visibilityChange();
    });
    observer.observe(host);
    document.addEventListener("visibilitychange", visibilityChange);
    reduced.addEventListener("change", reducedChange);
    schedule();
    notify();
  } catch (error) {
    if (disposed && prepared) {
      close(prepared);
      prepared = undefined;
    }
    destroy();
    throw error;
  }
  const currentGuard = (): MockupMotionAuthoringGuard => ({
    instanceId,
    expectedRevision: revision,
    fingerprint: prepared!.authoring.fingerprint,
  });
  const replace = async (
    nextSpec: MockupMotionSpec,
    nextSources: readonly MockupMotionSource[],
    guard: { expectedRevision: number; signal?: AbortSignal },
    deliveryOutput?: MockupMotionOutput,
  ): Promise<MockupMotionAuthoringGuard> => {
    const nextMatte=deliveryOutput===undefined?matte:outputMatte(deliveryOutput);
    check(guard.signal);
    if (guard.expectedRevision !== revision)
      throw Error("Stale scene revision");
    if (pending) throw Error("A scene update is already pending");
    if (status !== "ready") throw Error("Scene context is lost");
    pending = true;
    let next: Prepared | undefined;
    try {
      next = await prepare(nextSpec, nextSources, () => check(guard.signal), [
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
        ...(guard.signal ? [guard.signal] : []),
      ]);
      check(guard.signal);
      if (guard.expectedRevision !== revision)
        throw Error("Stale scene revision");
      if (status !== "ready") throw Error("Scene context is lost");
      const nextTime = (timeMs / prepared!.durationMs) * next.durationMs,
        nextIndex = render(next, nextTime,nextMatte??null),
        previous = prepared!;
      prepared = next;
      matte=nextMatte;
      next = undefined;
      timeMs = nextTime;
      frameIndex = nextIndex;
      revision++;
      close(previous);
      if(!prepared.motion.presentation){
        wholeRenderer?.dispose();wholeRenderer=undefined;
        framingRenderer?.dispose();framingRenderer=undefined;
      }
      lastTick = undefined;
      // Stamp this publication before host callbacks can queue another write.
      const receipt = currentGuard();
      notify();
      return receipt;
    } finally {
      if (next) close(next);
      pending = false;
    }
  };
  const controller: MockupMotionController = {
    canvas,
    getState,
    getSpec: () => structuredClone(prepared!.spec),
    getAuthoring() {
      check();
      return structuredClone(prepared!.authoring);
    },
    getAuthoringGuard() {
      check();
      return currentGuard();
    },
    async author(edit, guard) {
      check(guard.signal);
      if (guard.instanceId !== instanceId)
        throw Error(
          "Motion authoring guard belongs to another receiving instance",
        );
      if (guard.expectedRevision !== revision)
        throw Error("Stale scene revision");
      if (pending) throw Error("A scene update is already pending");
      if (status !== "ready") throw Error("Scene context is lost");
      const base = prepared!;
      const next = await authorMockupMotion({
        action: "revise",
        spec: base.spec,
        expectedFingerprint: guard.fingerprint,
        edit: structuredClone(edit),
      });
      check(guard.signal);
      if (guard.expectedRevision !== revision)
        throw Error("Stale scene revision");
      if (pending) throw Error("A scene update is already pending");
      if (status !== "ready") throw Error("Scene context is lost");
      if (!next.changed)
        return { authoring: structuredClone(next), guard: currentGuard() };
      const nextSources = next.sourceIds.map((id) => {
        const image = base.images.get(id);
        if (!image)
          throw Error(
            "Provide a source update before assigning an unavailable image",
          );
        return { id, image };
      });
      const receipt = await replace(next.spec, nextSources, {
        expectedRevision: guard.expectedRevision,
        ...(guard.signal ? { signal: guard.signal } : {}),
      });
      return { authoring: structuredClone(next), guard: receipt };
    },
    play() {
      check();
      if (getState().reducedMotion || status !== "ready") return false;
      if (timeMs >= prepared!.durationMs) {
        timeMs = 0;
        paint();
      }
      paused = false;
      stop();
      schedule();
      notify();
      return true;
    },
    pause() {
      check();
      paused = true;
      stop();
      notify();
    },
    seek(value) {
      check();
      if (!Number.isFinite(value) || value < 0)
        throw new Error("Scene time must be finite and nonnegative");
      if (status !== "ready") throw new Error("Scene context is lost");
      const next = Math.min(value, prepared!.durationMs);
      const painted = render(prepared!, next);
      timeMs = next;
      frameIndex = painted;
      lastTick = undefined;
      notify();
    },
    setVisible(value) {
      check();
      visible = value;
      visibilityChange();
    },
    async update(nextSpec, nextSources, guard,deliveryOutput) {
      await replace(nextSpec, nextSources, guard,deliveryOutput);
    },
    destroy,
  };
  return controller;
}
