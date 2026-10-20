import {acquireSurfaceEnvironment} from './surface-environment';
import type { MeshGradientDeliveryPlan, MeshGradientMaterial } from './generated/core-contract';
import { MESH_GRADIENT_KERNEL_RESOURCES } from './generated/mesh-gradient-kernel';
export type { MeshGradientDeliveryPlan, MeshGradientMaterial } from './generated/core-contract';
export type MeshGradientGpuDevice = GPUDevice;

const attached = new WeakSet<HTMLElement>();
const fingerprint = /^sha256:[0-9a-f]{64}$/;
export interface MeshGradientState {
  status: 'ready' | 'lost' | 'recovering' | 'error' | 'destroyed';
  fingerprint: string; kernelId:string; time: number; paused: boolean; reducedMotion: boolean;
  width: number; height: number; error: string | null;
}
export interface MeshGradientHandle {
  /** Publish a deferred binding after every candidate is prepared. */
  present(): void;
  getState(): MeshGradientState;
  update(plan: MeshGradientDeliveryPlan): void;
  setPaused(paused: boolean): void;
  setVisible(visible: boolean | undefined): void;
  seek(milliseconds: number): void;
  /** Retry device acquisition after loss; state and elapsed time survive. */
  recover(): Promise<void>;
  destroy(): void;
}
export interface MeshGradientOptions {
  /** Prepare resources without changing DOM or host styles until present(). */
  deferPresentation?: boolean;
  paused?: boolean;
  /** Respect the person's OS preference by default. */
  respectReducedMotion?: boolean;
  /** Backing-store scale; default follows DPR up to 2. Device limits still apply. */
  pixelRatio?: number;
  /** Per-surface backing-store budget; default 16,777,216 pixels. */
  maxPixels?: number;
  signal?: AbortSignal;
  /** Optional host-owned device; the binding destroys only its own buffers. */
  device?: MeshGradientGpuDevice;
  onError?: (error: Error) => void;
}

/** Reject malformed plans before touching the host or requesting a GPU. */
export function validateMeshGradientDelivery(plan: MeshGradientDeliveryPlan): void {
  const m: MeshGradientMaterial | undefined = plan?.material;
  const kernel=MESH_GRADIENT_KERNEL_RESOURCES.find(value=>value.id===plan?.kernel?.id);
  if (plan?.schema !== 'worldbend.mesh-gradient-delivery@0.1' || plan.version !== '0.1' ||
      plan.target !== 'web' || !fingerprint.test(plan.fingerprint) || !fingerprint.test(plan.recipeFingerprint) ||
      typeof plan.recipeId !== 'string' || !plan.recipeId.trim() || [...plan.recipeId].length > 64 ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(plan.recipeId) || !Number.isInteger(plan.recipeVersion) || plan.recipeVersion < 1 ||
      !kernel || plan.kernel.sha256 !== kernel.sha256 || plan.kernel.uniformBytes !== 128 ||
      typeof plan.kernel.source !== 'string' || !m || typeof m.visible !== 'boolean' ||
      ![m.warp, m.softness, m.durationMs, m.phaseMs, m.flowSpeed].every(Number.isFinite) ||
      m.warp < 0 || m.warp > 1 || m.softness < 0 || m.softness > 1 ||
      m.durationMs < 100 || m.durationMs > 60000 || m.phaseMs < 0 || m.phaseMs > 60000 ||
      m.flowSpeed < 0 || m.flowSpeed > 2 ||
      [m.colorTl, m.colorTr, m.colorBl, m.colorBr].some(color => !color ||
        [color.r,color.g,color.b,color.a].some(value => !Number.isFinite(value) || value < 0 || value > 1))) {
    throw new Error('Invalid or unsupported canonical mesh-gradient delivery');
  }
  if(plan.kernel.source!==kernel.source)throw Error('Mesh-gradient kernel source failed its integrity check');
}

async function checkKernel(plan: MeshGradientDeliveryPlan, win: Window): Promise<void> {
  const bytes = new TextEncoder().encode(plan.kernel.source);
  const digest = await win.crypto.subtle.digest('SHA-256', bytes);
  const hash = 'sha256:' + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== plan.kernel.sha256) throw new Error('Mesh-gradient kernel source failed its integrity check');
}

async function cancellable<T>(promise: Promise<T>, signal: AbortSignal | undefined, release?: (value: T) => void): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    let cancelled = signal.aborted;
    const abort = () => { cancelled = true; reject(new DOMException('Mesh-gradient attachment cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    if (cancelled) abort();
    promise.then(value => {
      signal.removeEventListener('abort', abort);
      if (cancelled) release?.(value); else resolve(value);
    }, error => { signal.removeEventListener('abort', abort); if (!cancelled) reject(error); });
  });
}

/** Execute the delivered kernel behind existing content. All visual buffers,
 * clocks, observers and owned device resources belong to this one handle.
 */
export async function attachMeshGradient(element: HTMLElement, initial: MeshGradientDeliveryPlan, options: MeshGradientOptions = {}): Promise<MeshGradientHandle> {
  validateMeshGradientDelivery(initial);
  if ((options.pixelRatio !== undefined && (!Number.isFinite(options.pixelRatio) || options.pixelRatio <= 0)) ||
      (options.maxPixels !== undefined && (!Number.isSafeInteger(options.maxPixels) || options.maxPixels < 1))) {
    throw new Error('Mesh-gradient pixelRatio must be positive and finite; maxPixels must be a positive safe integer');
  }
  if (attached.has(element)) throw new Error('This surface already has a mesh-gradient handle');
  const doc = element.ownerDocument, windowRef = doc.defaultView;
  if (!windowRef) throw new Error('Mesh-gradient needs a live document');
  const win = windowRef;
  const gpu = win.navigator.gpu;
  if (!gpu) throw new Error('Mesh-gradient needs WebGPU on this receiving target');
  if (options.signal?.aborted) throw new DOMException('Mesh-gradient attachment cancelled', 'AbortError');
  attached.add(element); // Reserve during async setup; concurrent attachment cannot overwrite it.
  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;border-radius:inherit';
  const context = canvas.getContext('webgpu') as unknown as GPUCanvasContext | null;
  let presented=false,releaseEnvironment:(()=>void)|undefined;
  let plan = structuredClone(initial), device: GPUDevice | undefined;
  let uniform: GPUBuffer | undefined, quad: GPUBuffer | undefined;
  let pipeline: Awaited<ReturnType<GPUDevice['createRenderPipelineAsync']>> | undefined;
  const profiles=new Map<string,{pipeline:GPURenderPipeline;bindGroup:GPUBindGroup}>();
  let bindGroup: GPUBindGroup | undefined, destroyed = false;
  let status: MeshGradientState['status'] = 'recovering', failure: string | null = null;
  let time = 0, lastWall: number | undefined, raf: number | undefined;
  let paused = options.paused ?? false, visibility: boolean | undefined, intersecting = true;
  let recovery: Promise<void> | undefined;
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => options.respectReducedMotion !== false && media.matches;
  const current = () => presented && !destroyed && status === 'ready' && plan.material.visible && visibility !== false &&
    !paused && !reduced() && !doc.hidden && intersecting && element.isConnected &&
    element.clientWidth > 0 && element.clientHeight > 0 && plan.material.flowSpeed > 0;
  const stop = () => { if (raf !== undefined) win.cancelAnimationFrame(raf); raf = undefined; lastWall = undefined; };
  const active = () => { if (destroyed) throw new Error('Mesh-gradient handle is destroyed'); };
  function fail(value: unknown) {
    failure = value instanceof Error ? value.message : String(value); status = 'error'; stop();
    options.onError?.(new Error(failure));
  }
  function releaseBuffers() { uniform?.destroy(); quad?.destroy(); uniform = undefined; quad = undefined; pipeline = undefined; bindGroup=undefined;profiles.clear(); }
  async function acquire(): Promise<void> {
    const adapter = options.device ? null : await cancellable(gpu!.requestAdapter(), options.signal);
    if (!options.device && !adapter) throw new Error('No WebGPU adapter is available for mesh-gradient');
    const next = options.device ?? await cancellable(adapter!.requestDevice(), options.signal, value => value.destroy());
    try {
      if (destroyed) throw new Error('Mesh-gradient handle is destroyed');
      const prepared:Array<{id:string;pipeline:GPURenderPipeline}>=[];
      for(const resource of MESH_GRADIENT_KERNEL_RESOURCES){
      const module = next.createShaderModule({ code: resource.source });
      const compilation = await cancellable(module.getCompilationInfo(), options.signal);
      const errors = compilation.messages.filter(message => message.type === 'error');
      if (errors.length) throw new Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n'));
      const nextPipeline = await cancellable(next.createRenderPipelineAsync({ layout:'auto',
        vertex:{ module,entryPoint:'vs_main',buffers:[{arrayStride:16,attributes:[{shaderLocation:0,format:'float32x2',offset:0},{shaderLocation:1,format:'float32x2',offset:8}]}]},
        fragment:{module,entryPoint:'fs_main',targets:[{format:gpu!.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'},
      }), options.signal);
      prepared.push({id:resource.id,pipeline:nextPipeline});
      }
      if (destroyed) throw new Error('Mesh-gradient handle is destroyed');
      releaseBuffers();
      if (device && !options.device) device.destroy();
      device = next;
      quad = next.createBuffer({ size:96, usage:32, mappedAtCreation:true });
      new Float32Array(quad.getMappedRange()).set([-1,-1,0,1,1,-1,1,1,-1,1,0,0,-1,1,0,0,1,-1,1,1,1,1,1,0]); quad.unmap();
      uniform = next.createBuffer({size:128,usage:64|8});
      for(const entry of prepared)profiles.set(entry.id,{pipeline:entry.pipeline,bindGroup:next.createBindGroup({layout:entry.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]})});
      ({pipeline,bindGroup}=profiles.get(plan.kernel.id)!);
      context!.configure({device:next,format:gpu!.getPreferredCanvasFormat(),alphaMode:'premultiplied'});
      status = 'ready'; failure = null;
      void next.lost.then(info => {
        if (!destroyed && device === next) { status = 'lost'; failure = info.message || info.reason; stop(); options.onError?.(new Error(`Mesh-gradient device lost: ${failure}`)); }
      });
    } catch (error) { if (!options.device) next.destroy(); throw error; }
  }
  function draw() {
    if (!presented || destroyed || status !== 'ready' || !device || !pipeline || !uniform || !quad) return;
    const cssWidth = element.clientWidth, cssHeight = element.clientHeight;
    if (!cssWidth || !cssHeight) return;
    // Bound backing-store memory and device dimensions while retaining aspect.
    const scale = Math.min(options.pixelRatio ?? Math.min(win.devicePixelRatio || 1, 2), device.limits.maxTextureDimension2D / cssWidth,
      device.limits.maxTextureDimension2D / cssHeight, Math.sqrt((options.maxPixels ?? 16_777_216) / cssWidth / cssHeight));
    const width = Math.max(1,Math.floor(cssWidth * scale)), height = Math.max(1,Math.floor(cssHeight * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const m = plan.material, tl = m.colorTl, tr = m.colorTr, bl = m.colorBl, br = m.colorBr;
    device.queue.writeBuffer(uniform,0,new Float32Array([
      time * .001, Math.max(m.durationMs, 100) * .001, Math.max(m.phaseMs, 0) * .001, m.flowSpeed,
      width, height, 0, 0,
      tl.r, tl.g, tl.b, tl.a, tr.r, tr.g, tr.b, tr.a,
      bl.r, bl.g, bl.b, bl.a, br.r, br.g, br.b, br.a,
      m.warp, m.softness, 0, 0,
      m.visible && visibility !== false ? 1 : 0, 1, 0, 0])); // flags.y: canvas expects premultiplied RGBA.
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({colorAttachments:[{view:context!.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});
    pass.setPipeline(pipeline); pass.setBindGroup(0,bindGroup!); pass.setVertexBuffer(0,quad); pass.draw(6); pass.end();
    device.queue.submit([encoder.finish()]);
  }
  function frame(now: number) {
    raf = undefined;
    if (!current()) { lastWall = undefined; return; }
    if (lastWall !== undefined) time += Math.max(0,now - lastWall);
    lastWall = now;
    try { draw(); raf = win.requestAnimationFrame(frame); } catch (error) { fail(error); }
  }
  function refresh() { stop(); try { draw(); if (current()) raf = win.requestAnimationFrame(frame); } catch (error) { fail(error); } }
  const resize = new win.ResizeObserver(refresh);
  const intersection = new win.IntersectionObserver(entries => { intersecting = entries.some(entry => entry.isIntersecting); refresh(); });
  const abort = () => destroy();
  function destroy() {
    if (destroyed) return; destroyed = true; status = 'destroyed'; stop();
    resize.disconnect(); intersection.disconnect(); media.removeEventListener('change',refresh); doc.removeEventListener('visibilitychange',refresh);
    options.signal?.removeEventListener('abort',abort); context?.unconfigure(); releaseBuffers();
    if (device && !options.device) device.destroy(); device = undefined;
    canvas.remove(); attached.delete(element);
    releaseEnvironment?.();releaseEnvironment=undefined;
  }
  function present(){
    active();if(presented)return;
    releaseEnvironment=acquireSurfaceEnvironment(element,true);presented=true;
    element.prepend(canvas);resize.observe(element);intersection.observe(element);
    media.addEventListener('change',refresh);doc.addEventListener('visibilitychange',refresh);
    refresh();if(failure!==null)throw Error(failure);
  }
  try {
    if (!context) throw new Error('The browser did not provide a WebGPU canvas');
    await cancellable(checkKernel(plan,win),options.signal); await acquire();
    options.signal?.addEventListener('abort',abort,{once:true});
    if (options.signal?.aborted) throw new DOMException('Material attachment cancelled','AbortError');
    if(!options.deferPresentation)present();
    if (failure !== null) throw new Error(failure);
  } catch (error) { destroy(); throw error; }
  return {
    present,
    getState: () => ({status,fingerprint:plan.fingerprint,kernelId:plan.kernel.id,time,paused,reducedMotion:reduced(),width:canvas.width,height:canvas.height,error:failure}),
    update(next) { active(); validateMeshGradientDelivery(next); const prepared=profiles.get(next.kernel.id);if(status==='ready'&&!prepared)throw Error('Mesh-gradient profile is not prepared');plan = structuredClone(next);if(prepared)({pipeline,bindGroup}=prepared);refresh(); },
    setPaused(value) { active(); if (typeof value !== 'boolean') throw new Error('Mesh-gradient paused must be boolean'); paused = value; refresh(); },
    setVisible(value) { active(); if (value !== undefined && typeof value !== 'boolean') throw new Error('Mesh-gradient visibility must be boolean or undefined'); visibility = value; refresh(); },
    seek(value) { active(); if (!Number.isFinite(value) || value < 0) throw new Error('Mesh-gradient seek needs a finite nonnegative millisecond time'); time = value; refresh(); },
    recover() { active(); if (status === 'ready') return Promise.resolve(); if (recovery) return recovery;
      status = 'recovering'; stop(); recovery = acquire().then(refresh).catch(error => { if (!destroyed) fail(error); throw error; }).finally(() => { recovery = undefined; }); return recovery; },
    destroy,
  };
}
