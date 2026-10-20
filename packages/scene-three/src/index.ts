import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { CanvasRasterRenderer, planCanvas } from "@worldbend/web";
import { planSpatialDocumentDelivery } from "@worldbend/web/spatial-document";
import type {
  Scene3DPlan,
  SpatialDocumentSpec,
  SpatialDocumentAsset,
} from "@worldbend/web/spatial-document";
import { inspectGlb, inspectPng } from "./glb";
export { inspectGlb } from "./glb";
export type { Scene3DPlan, SpatialDocumentSpec };
export interface SceneGuard {
  instance: string;
  revision: number;
  documentFingerprint: string;
}
export interface SceneState {
  guard: SceneGuard;
  status: "ready" | "lost" | "disposed";
  busy: boolean;
  timeMs: number;
  durationMs: number;
  frame: number;
  paused: boolean;
  reducedMotion: boolean;
}
export interface SceneOptions {
  resolveAsset(
    asset: SpatialDocumentAsset,
    signal: AbortSignal,
  ): Promise<Uint8Array>;
  paused?: boolean;
  signal?: AbortSignal;
  onChange?(state: SceneState): void;
  onError?(error: Error): void;
}
export interface SceneSession {
  readonly canvas: HTMLCanvasElement;
  getState(): SceneState;
  getDocument(): SpatialDocumentSpec;
  seek(ms: number): void;
  play(): boolean;
  pause(): void;
  revise(
    document: SpatialDocumentSpec,
    guard: SceneGuard,
    signal?: AbortSignal,
  ): Promise<void>;
  exportPng(): Promise<Blob>;
  destroy(): void;
}
type Pool = {
  urls: Set<string>;
  lights: Set<THREE.Light>;
  skeletons: Set<THREE.Skeleton>;
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  retired: boolean;
};
type Prepared = {
  document: SpatialDocumentSpec;
  fingerprint: string;
  plan: Scene3DPlan;
  gltf: GLTF;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  mixer: THREE.AnimationMixer | undefined;
  clip: THREE.AnimationClip | undefined;
  pool: Pool;
};
const hosts = new WeakSet<HTMLElement>();
function abortError() {
  return new DOMException("Scene receiving cancelled", "AbortError");
}
function disposeTexture(texture: THREE.Texture) {
  texture.dispose();
  const image = texture.source.data as { close?: () => void } | undefined;
  image?.close?.();
  if (image instanceof HTMLCanvasElement) {
    image.width = 0;
    image.height = 0;
  }
}
function retire(pool: Pool) {
  if (pool.retired) return;
  pool.retired = true;
  for (const url of pool.urls) URL.revokeObjectURL(url);
  pool.urls.clear();
  for (const light of pool.lights) light.dispose();
  pool.lights.clear();
  for (const skeleton of pool.skeletons) skeleton.dispose();
  pool.skeletons.clear();
  for (const g of pool.geometries) g.dispose();
  for (const m of pool.materials) m.dispose();
  for (const t of pool.textures) disposeTexture(t);
  pool.geometries.clear();
  pool.materials.clear();
  pool.textures.clear();
}
function collect(pool: Pool, root: THREE.Object3D) {
  root.traverse((node) => {
    if (node instanceof THREE.Light) pool.lights.add(node);
    // loadMesh completes before loadNode binds the skin. Collect the actual
    // skeleton only once it exists; early mesh retirement still owns its maps.
    if (node instanceof THREE.SkinnedMesh && node.skeleton) pool.skeletons.add(node.skeleton);
    if (!(
      node instanceof THREE.Mesh ||
      node instanceof THREE.Line ||
      node instanceof THREE.Points
    ))
      return;
    pool.geometries.add(node.geometry);
    for (const m of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      pool.materials.add(m);
      for (const v of Object.values(m))
        if (v instanceof THREE.Texture) pool.textures.add(v);
    }
  });
  if (pool.retired) {
    pool.retired = false;
    retire(pool);
  }
}
function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (!settled) {
        settled = true;
        reject(abortError());
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (settled) {
          late?.(value);
          return;
        }
        settled = true;
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        if (!settled) {
          settled = true;
          reject(error);
        }
      },
    );
  });
}
function safe(callback: () => unknown) {
  try {
    const result = callback();
    if (result && typeof (result as PromiseLike<unknown>).then === "function")
      Promise.resolve(result).catch(() => {});
  } catch {
    /* Host reporting is not a lifecycle authority. */
  }
}
async function sha(bytes: Uint8Array) {
  return (
    "sha256:" +
    Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("")
  );
}
async function asset(
  document: SpatialDocumentSpec,
  id: string,
  options: SceneOptions,
  signal: AbortSignal,
) {
  const ref = document.assets.find((a) => a.id === id);
  if (!ref) throw Error("Scene asset is unavailable");
  const resolved = await waitFor(options.resolveAsset({ ...ref }, signal), signal);
  if (signal.aborted) throw abortError();
  if (!ArrayBuffer.isView(resolved) || Object.prototype.toString.call(resolved) !== "[object Uint8Array]" ||
      !resolved.byteLength || resolved.byteLength > 64 * 1024 * 1024)
    throw Error("Scene asset exceeds receiving byte budget");
  // The resolver owns acquisition. Check its view before making our own
  // immutable copy, so oversized host data never triggers a second allocation.
  const bytes = new Uint8Array(resolved);
  if (
    ref.contentVersion?.startsWith("sha256:") &&
    (await sha(bytes)) !== ref.contentVersion
  )
    throw Error("Scene asset bytes changed; reread before revising");
  if (signal.aborted) throw abortError();
  return bytes;
}
async function prepare(
  document: SpatialDocumentSpec,
  id: string,
  options: SceneOptions,
  signal: AbortSignal,
): Promise<Prepared> {
  const owned = structuredClone(document),
    delivery = await waitFor(
      planSpatialDocumentDelivery({ document: owned }),
      signal,
    );
  if (signal.aborted) throw abortError();
  const expression = delivery.deliveries.find((d) => d.id === id);
  if (expression?.kind !== "scene3d")
    throw Error("Select a three-dimensional scene expression");
  const plan = expression.scene,
    bound = (slot: string) => {
      const b = expression.bindings.find((b) => b.slotId === slot);
      if (!b) throw Error("Scene slot is unbound");
      return b.assetId;
    };
  const bytes = await asset(owned, bound(plan.spec.sceneSlot), options, signal);
  const admission = inspectGlb(bytes.buffer);
  let pixels = admission.decodedPixels;
  const pool: Pool = {
    urls: new Set(),
    lights: new Set(),
    skeletons: new Set(),
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    retired: false,
  };
  let gltf: GLTF | undefined;
  try {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      if (url.startsWith("blob:")) {
        if (pool.retired) URL.revokeObjectURL(url);
        else pool.urls.add(url);
      }
      return url;
    });
    const loader = new GLTFLoader(manager);
    // Supported loader plugin owns all resources, including late completions
    // after an aborted parse or a failed sibling material.
    loader.register((parser) => ({
      name: "WORLDBEND_owned_resources",
      loadTexture(index: number) {
        return parser.loadTexture(index).then((texture) => {
          // The adopted loader converts an image-decode failure into null.
          // A missing authored texture must reject the complete candidate.
          if (!texture) throw Error("An embedded scene texture could not be decoded");
          if (pool.retired) disposeTexture(texture);
          else pool.textures.add(texture);
          return texture;
        });
      },
      loadMesh(index: number) {
        return parser.loadMesh(index).then((mesh) => {
          collect(pool, mesh);
          return mesh;
        });
      },
    }));
    const parsing = loader.parseAsync(bytes.buffer, "");
    gltf = await new Promise<GLTF>((resolve, reject) => {
      let settled = false;
      const aborted = () => {
        if (!settled) {
          settled = true;
          retire(pool);
          reject(abortError());
        }
      };
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      parsing.then(
        (value) => {
          signal.removeEventListener("abort", aborted);
          if (settled) {
            collect(pool, value.scene);
            return;
          }
          settled = true;
          resolve(value);
        },
        (error) => {
          signal.removeEventListener("abort", aborted);
          if (!settled) {
            settled = true;
            reject(error);
          }
        },
      );
    });
    if (signal.aborted) throw abortError();
    collect(pool, gltf.scene);
    const parser = gltf.parser;
    // Loader names are sanitized for animation binding. Selection belongs to
    // the exported source name, including spaces, dots and Unicode.
    const exportedCameraName = (object: THREE.Object3D) => {
      let current: THREE.Object3D | null = object;
      while (current) {
        const nodeIndex = parser.associations.get(current)?.nodes;
        const definition =
          nodeIndex === undefined ? undefined : admission.gltf.nodes[nodeIndex];
        if (definition?.camera !== undefined)
          return (
            definition.name ?? admission.gltf.cameras?.[definition.camera]?.name
          );
        current = current.parent;
      }
      return undefined;
    };
    const matching: THREE.Object3D[] = [];
    gltf.scene.traverse((n) => {
      if (
        exportedCameraName(n) === plan.spec.camera &&
        (n instanceof THREE.PerspectiveCamera ||
          n instanceof THREE.OrthographicCamera)
      )
        matching.push(n);
    });
    if (matching.length !== 1)
      throw Error("The exported camera is missing or ambiguous");
    const camera = matching[0] as Prepared["camera"];
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.aspect = plan.spec.canvas.width / plan.spec.canvas.height;
      camera.updateProjectionMatrix();
    } else {
      const center = (camera.left + camera.right) / 2,
        width =
          ((camera.top - camera.bottom) * plan.spec.canvas.width) /
          plan.spec.canvas.height;
      camera.left = center - width / 2;
      camera.right = center + width / 2;
      camera.updateProjectionMatrix();
    }
    const clip = plan.spec.animation
      ? gltf.animations.find((a) => a.name === plan.spec.animation)
      : undefined;
    if (
      plan.spec.animation &&
      gltf.animations.filter((a) => a.name === plan.spec.animation).length !== 1
    )
      throw Error("The exported animation is missing or ambiguous");
    const mixer = clip ? new THREE.AnimationMixer(gltf.scene) : undefined;
    if (clip) {
      const action = mixer!.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
    }
    for (const artwork of plan.spec.artworks ?? []) {
      const materials = [...pool.materials].filter(
        (m) => m.name === artwork.material,
      ) as THREE.MeshStandardMaterial[];
      if (!materials.length || materials.some((m) => !("map" in m)))
        throw Error("An artwork material is unavailable");
      const source = await asset(owned, bound(artwork.slotId), options, signal);
      let bitmap: ImageBitmap | undefined;
      try {
        pixels +=
          inspectPng(source.buffer, 16_777_216) +
          artwork.surfaceSize.width * artwork.surfaceSize.height;
        if (pixels > 64 * 1024 * 1024)
          throw Error("Combined scene artwork exceeds receiving pixel budget");
        bitmap = await waitFor(
          createImageBitmap(new Blob([source])),
          signal,
          (late) => late.close(),
        );
        if (signal.aborted) throw abortError();
        if (
          bitmap.width * bitmap.height > 16_777_216 ||
          Math.max(bitmap.width, bitmap.height) > 8192
        )
          throw Error("Artwork exceeds receiving pixel budget");
        const fit = artwork.fit;
        const canvas = await planCanvas(
          {
            schema: "worldbend.canvas",
            version: "0.1",
            operation:
              fit === "stretch"
                ? { kind: "stretch", output: artwork.surfaceSize }
                : {
                    kind: fit,
                    output: artwork.surfaceSize,
                    anchor: { x: 0.5, y: 0.5 },
                    background: {
                      kind: "color",
                      space: "srgb8",
                      rgba: [237, 227, 194, 255],
                    },
                  },
          },
          { width: bitmap.width, height: bitmap.height },
        );
        const raster = new CanvasRasterRenderer();
        raster.render(bitmap, canvas, "high");
        const texture = new THREE.CanvasTexture(raster.canvas);
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        pool.textures.add(texture);
        for (const material of materials) {
          material.map = texture;
          material.needsUpdate = true;
        }
      } finally {
        bitmap?.close();
      }
    }
    if (signal.aborted) throw abortError();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(
      ...(plan.spec.backgroundRgb.map((v) => v / 255) as [
        number,
        number,
        number,
      ]),
    ).convertSRGBToLinear();
    scene.add(gltf.scene);
    scene.add(
      new THREE.HemisphereLight(0xfff3d3, 0x67735f, plan.spec.ambientIntensity),
    );
    gltf.scene.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.castShadow = true;
        n.receiveShadow = true;
      }
      if (n instanceof THREE.DirectionalLight) {
        n.castShadow = true;
        n.shadow.mapSize.set(2048, 2048);
        n.shadow.camera.left = -0.7;
        n.shadow.camera.right = 0.7;
        n.shadow.camera.top = 0.7;
        n.shadow.camera.bottom = -0.7;
        n.shadow.camera.near = 0.01;
        n.shadow.camera.far = 10;
        n.shadow.bias = -0.0002;
      }
    });
    return {
      document: owned,
      fingerprint: delivery.documentFingerprint,
      plan,
      gltf,
      scene,
      camera,
      mixer,
      clip,
      pool,
    };
  } catch (error) {
    if (gltf) collect(pool, gltf.scene);
    retire(pool);
    throw error;
  }
}
/** Optional adopted scene carrier over the ordinary canonical document. */
export async function attachScene3d(
  host: HTMLElement,
  document: SpatialDocumentSpec,
  expressionId: string,
  options: SceneOptions,
): Promise<SceneSession> {
  if (hosts.has(host)) throw Error("This surface already receives a scene");
  if (options.signal?.aborted) throw abortError();
  hosts.add(host);
  const lifetime = new AbortController();
  const stopLifetime = () => lifetime.abort();
  options.signal?.addEventListener("abort", stopLifetime, { once: true });
  const instance = crypto.randomUUID();
  let revision = 1,
    status: SceneState["status"] = "ready",
    busy = false,
    disposed = false,
    paused = options.paused ?? true,
    timeMs = 0,
    raf = 0,
    last: number | undefined,
    pending: AbortController | undefined;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let accepted: Prepared | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  const canvas = host.ownerDocument.createElement("canvas");
  canvas.setAttribute("aria-label", "Authored scene");
  canvas.style.cssText = "display:block;width:100%;height:auto";
  const getState = (): SceneState => ({
    guard: {
      instance,
      revision,
      documentFingerprint: accepted?.fingerprint ?? "",
    },
    status,
    busy,
    timeMs,
    durationMs: accepted?.plan.durationMs ?? 0,
    frame: Math.min(
      (accepted?.plan.spec.frameCount ?? 1) - 1,
      Math.floor(
        (timeMs * (accepted?.plan.spec.timebase.numerator ?? 1)) /
          (1000 * (accepted?.plan.spec.timebase.denominator ?? 1)) +
          1e-8,
      ),
    ),
    paused,
    reducedMotion: reduced.matches,
  });
  const report = (error: unknown) =>
    safe(() =>
      options.onError?.(error instanceof Error ? error : Error(String(error))),
    );
  const notify = () => safe(() => options.onChange?.(getState()));
  const alive = () => {
    if (disposed || lifetime.signal.aborted) throw abortError();
  };
  const guard = (expected: SceneGuard) => {
    alive();
    const now = getState().guard;
    if (
      !expected ||
      expected.instance !== now.instance ||
      expected.revision !== now.revision ||
      expected.documentFingerprint !== now.documentFingerprint
    )
      throw Error("Stale scene revision; reopen the current work");
  };
  const configure = (work: Prepared) => {
    // The pinned renderer creates WebGL2 contexts; upstream typings retain a
    // legacy context union that predates this renderer profile.
    const gl = renderer!.getContext() as WebGL2RenderingContext;
    const layers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
    for (const geometry of work.pool.geometries) {
      const targets = geometry.morphAttributes.position ?? geometry.morphAttributes.normal ?? geometry.morphAttributes.color;
      if (targets && targets.length > layers)
        throw Error("Scene morph targets exceed this device's texture layers");
      if (targets?.length) {
        const stride = geometry.morphAttributes.color ? 3 : geometry.morphAttributes.normal ? 2 : 1;
        const cells = geometry.getAttribute("position").count * stride;
        if (Math.ceil(cells / renderer!.capabilities.maxTextureSize) > renderer!.capabilities.maxTextureSize)
          throw Error("Scene morph targets exceed this device's texture dimensions");
      }
    }
    renderer!.setSize(
      work.plan.spec.canvas.width,
      work.plan.spec.canvas.height,
      false,
    );
    renderer!.toneMappingExposure = work.plan.spec.exposure;
  };
  const render = () => {
    if (disposed || status !== "ready" || !accepted) return;
    const plan = accepted.plan;
    const frame = getState().frame;
    const sample = plan.samples[frame]!;
    if (accepted.mixer && accepted.clip) {
      accepted.mixer.clipAction(accepted.clip).reset().play();
      accepted.mixer.setTime(accepted.clip.duration * sample.progress);
    }
    accepted.scene.updateMatrixWorld(true);
    renderer!.render(accepted.scene, accepted.camera);
  };
  const schedule = () => {
    if (
      raf ||
      disposed ||
      paused ||
      reduced.matches ||
      documentHidden() ||
      status !== "ready"
    )
      return;
    raf = requestAnimationFrame(tick);
  };
  const documentHidden = () => host.ownerDocument.hidden;
  const tick = (now: number) => {
    raf = 0;
    if (last !== undefined)
      timeMs = Math.min(
        accepted!.plan.durationMs,
        timeMs + Math.max(0, now - last),
      );
    last = now;
    render();
    if (timeMs >= accepted!.plan.durationMs) paused = true;
    notify();
    schedule();
  };
  const cancelFrame = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = undefined;
  };
  const environment = () => {
    cancelFrame();
    render();
    notify();
    schedule();
  };
  const lost = (event: Event) => {
    event.preventDefault();
    status = "lost";
    cancelFrame();
    notify();
  };
  const restored = () => {
    if (disposed) return;
    try {
      status = "ready";
      configure(accepted!);
      render();
      notify();
      schedule();
    } catch (error) {
      status = "lost";
      report(error);
    }
  };
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    status = "disposed";
    lifetime.abort();
    pending?.abort();
    cancelFrame();
    host.ownerDocument.removeEventListener("visibilitychange", environment);
    reduced.removeEventListener("change", environment);
    canvas.removeEventListener("webglcontextlost", lost);
    canvas.removeEventListener("webglcontextrestored", restored);
    options.signal?.removeEventListener("abort", stopLifetime);
    lifetime.signal.removeEventListener("abort", destroy);
    accepted?.mixer?.stopAllAction();
    if (accepted) retire(accepted.pool);
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas.remove();
    canvas.width = 0;
    canvas.height = 0;
    accepted = undefined;
    renderer = undefined;
    hosts.delete(host);
    notify();
  };
  try {
    accepted = await prepare(document, expressionId, options, lifetime.signal);
    alive();
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    configure(accepted);
    host.append(canvas);
    render();
    host.ownerDocument.addEventListener("visibilitychange", environment);
    reduced.addEventListener("change", environment);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    lifetime.signal.addEventListener("abort", destroy, { once: true });
    notify();
    schedule();
    return {
      canvas,
      getState,
      getDocument: () => {
        alive();
        return structuredClone(accepted!.document);
      },
      seek(ms) {
        alive();
        if (!Number.isFinite(ms) || ms < 0)
          throw Error("Choose a time inside the scene");
        timeMs = Math.min(ms, accepted!.plan.durationMs);
        last = undefined;
        render();
        notify();
      },
      play() {
        alive();
        if (reduced.matches || status !== "ready") return false;
        if (timeMs >= accepted!.plan.durationMs) timeMs = 0;
        paused = false;
        last = undefined;
        schedule();
        notify();
        return true;
      },
      pause() {
        alive();
        paused = true;
        cancelFrame();
        notify();
      },
      async revise(next, expected, signal) {
        guard(expected);
        if (busy) throw Error("Another scene revision is preparing");
        busy = true;
        const own = new AbortController();
        pending = own;
        const abort = () => own.abort();
        signal?.addEventListener("abort", abort, { once: true });
        lifetime.signal.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) own.abort();
        let candidate: Prepared | undefined;
        try {
          candidate = await prepare(next, expressionId, options, own.signal);
          guard(expected);
          if (own.signal.aborted) throw abortError();
          if (status !== "ready")
            throw Error("Restore the current renderer before revising");
          const before = accepted!,
            beforeTime = timeMs;
          const nextTime = before.plan.durationMs
            ? (timeMs / before.plan.durationMs) * candidate.plan.durationMs
            : 0;
          try {
            configure(candidate);
            accepted = candidate;
            timeMs = nextTime;
            render();
          } catch (error) {
            accepted = before;
            timeMs = beforeTime;
            configure(before);
            render();
            throw error;
          }
          revision++;
          retire(before.pool);
          before.mixer?.stopAllAction();
          candidate = undefined;
          notify();
        } finally {
          if (candidate) retire(candidate.pool);
          pending = undefined;
          busy = false;
          signal?.removeEventListener("abort", abort);
          lifetime.signal.removeEventListener("abort", abort);
          notify();
        }
      },
      async exportPng() {
        alive();
        if (status !== "ready")
          throw Error("Restore scene rendering before export");
        render();
        return new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(Error("Scene PNG encoding failed")),
            "image/png",
          ),
        );
      },
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}

export interface SceneFrameReceipt {
  schema: "worldbend.scene3d-frames";
  version: "0.1";
  documentFingerprint: string;
  sceneFingerprint: string;
  canvas: { width: number; height: number };
  timebase: { numerator: number; denominator: number };
  frameCount: number;
  durationMs: number;
}
/** Render a frozen document in an isolated session. The host owns encoding or
 * storage; interactive receiving state is never sought or paused by export. */
export async function renderSceneFrames(
  spec: SpatialDocumentSpec,
  expressionId: string,
  options: SceneOptions,
  onFrame: (frame: number, png: Blob, signal: AbortSignal) => Promise<void>,
): Promise<SceneFrameReceipt> {
  const controller = new AbortController(),
    abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let session: SceneSession | undefined;
  try {
    const snapshot = structuredClone(spec),
      delivery = await planSpatialDocumentDelivery({ document: snapshot }),
      selected = delivery.deliveries.find((d) => d.id === expressionId);
    if (selected?.kind !== "scene3d")
      throw Error("Select a scene for frame delivery");
    const host = globalThis.document.createElement("div");
    session = await attachScene3d(host, snapshot, expressionId, {
      ...options,
      signal: controller.signal,
      paused: true,
      onChange: undefined,
    });
    for (const frame of selected.scene.samples) {
      if (controller.signal.aborted) throw abortError();
      session.seek(frame.milliseconds);
      const png = await waitFor(session.exportPng(), controller.signal);
      await waitFor(
        onFrame(frame.frame, png, controller.signal),
        controller.signal,
      );
    }
    return {
      schema: "worldbend.scene3d-frames",
      version: "0.1",
      documentFingerprint: delivery.documentFingerprint,
      sceneFingerprint: selected.scene.fingerprint,
      canvas: selected.scene.spec.canvas,
      timebase: selected.scene.spec.timebase,
      frameCount: selected.scene.spec.frameCount,
      durationMs: selected.scene.durationMs,
    };
  } finally {
    session?.destroy();
    options.signal?.removeEventListener("abort", abort);
  }
}
