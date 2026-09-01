import {
  PerspectiveEditor,
  TransformWebGLRenderer,
  awaitImageDecoded,
  createPreviewViewport,
  initializeWorldbend,
  type PreviewViewportHandle,
  type TransformSpec,
} from "../src";

interface MemoryPerformance extends Performance {
  memory?: { usedJSHeapSize: number };
}

interface ResourceCounts {
  programs: number;
  textures: number;
  buffers: number;
}

const mount = required<HTMLElement>("mount");
const status = required<HTMLParagraphElement>("status");
const startButton = required<HTMLButtonElement>("start");
const stopButton = required<HTMLButtonElement>("stop");
const disposeButton = required<HTMLButtonElement>("dispose");
const warpInput = required<HTMLInputElement>("warp");
const warpSampleButton = required<HTMLButtonElement>("warp-sample");
const output = required<HTMLPreElement>("output");

const created: ResourceCounts = { programs: 0, textures: 0, buffers: 0 };
const deleted: ResourceCounts = { programs: 0, textures: 0, buffers: 0 };
const knownPrograms = new WeakSet<WebGLProgram>();
const knownTextures = new WeakSet<WebGLTexture>();
const knownBuffers = new WeakSet<WebGLBuffer>();
const gl = WebGL2RenderingContext.prototype;
const original = {
  drawArrays: gl.drawArrays,
  createProgram: gl.createProgram,
  deleteProgram: gl.deleteProgram,
  createTexture: gl.createTexture,
  deleteTexture: gl.deleteTexture,
  createBuffer: gl.createBuffer,
  deleteBuffer: gl.deleteBuffer,
};

let running = false;
let disposed = false;
let frameRequest: number | undefined;
let previousFrame: number | undefined;
let inputCount = 0;
let pointerMoveCount = 0;
let arrowKeyCount = 0;
let rangeInputCount = 0;
let warpSampleCount = 0;
let drawCount = 0;
let latestInputSequence = 0;
let matchedInputSequence = 0;
let latestInputTime = 0;
let heapStart: number | null = null;
let inputToDraw: number[] = [];
let frameDeltas: number[] = [];
let longTasks: number[] = [];
let longTaskObserver: PerformanceObserver | undefined;
let viewport: PreviewViewportHandle | undefined;
let sourceSize: { width: number; height: number } | undefined;
let warpSampleIndex = 0;

installGraphicsObservation();

const editor = new PerspectiveEditor({
  onDistortGesture(event) {
    viewport?.handleDistortGesture(event);
  },
  onEditEnd() {
    viewport?.revealAllCorners();
  },
  onError(error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  },
});
mount.append(editor.element);
viewport = createPreviewViewport(editor, mount);

startButton.addEventListener("click", beginObservation);
stopButton.addEventListener("click", endObservation);
disposeButton.addEventListener("click", () => {
  if (disposed) return;
  disposed = true;
  viewport?.dispose();
  viewport = undefined;
  editor.dispose();
  disposeButton.disabled = true;
  startButton.disabled = true;
  warpInput.disabled = true;
  warpSampleButton.disabled = true;
  status.textContent = "Editor disposed. Stop to capture released resources.";
});
warpInput.addEventListener("input", () => {
  applyWarpAmount(Number(warpInput.value));
});
warpSampleButton.addEventListener("click", (event) => {
  if (running) {
    warpSampleCount += 1;
    inputCount += 1;
    latestInputSequence += 1;
    latestInputTime = event.timeStamp;
  }
  warpSampleIndex += 1;
  const amount = Math.sin((warpSampleIndex / 120) * Math.PI * 12) * 0.9;
  warpInput.value = amount.toFixed(3);
  applyWarpAmount(amount);
});

function applyWarpAmount(amount: number): void {
  if (disposed || !sourceSize) return;
  const spec = editor.captureSpec();
  void editor.setSpec(
    {
      ...spec,
      content: {
        ...spec.content,
        warp: { preset: "wave", amount },
      },
    },
    sourceSize,
  );
}

void loadExample();

async function loadExample(): Promise<void> {
  try {
    const [image, spec] = await Promise.all([
      loadImage(new URL("worldbend-demo-source.png", window.location.href).href),
      fetch(new URL("plane.worldbend.json", window.location.href)).then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load example spec (${response.status})`);
        return normalizeExampleSpec((await response.json()) as TransformSpec);
      }),
      initializeWorldbend(),
    ]).then(([image, spec]) => [image, spec] as const);
    if (!(await editor.setSource(image, spec))) throw new Error("Unable to preview the example");
    sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
    viewport?.fit();
    status.textContent = "Ready. Start, then drag a corner continuously.";
    startButton.disabled = false;
    disposeButton.disabled = false;
    warpInput.disabled = false;
    warpSampleButton.disabled = false;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}

function beginObservation(): void {
  if (running || disposed) return;
  running = true;
  inputCount = 0;
  pointerMoveCount = 0;
  arrowKeyCount = 0;
  rangeInputCount = 0;
  warpSampleCount = 0;
  drawCount = 0;
  latestInputSequence = 0;
  matchedInputSequence = 0;
  latestInputTime = 0;
  inputToDraw = [];
  frameDeltas = [];
  longTasks = [];
  previousFrame = undefined;
  heapStart = currentHeap();
  output.textContent = "";
  status.textContent = "Observing continuous edit…";
  startButton.disabled = true;
  stopButton.disabled = false;
  document.addEventListener("pointermove", observePointerMove, true);
  document.addEventListener("keydown", observeKeydown, true);
  warpInput.addEventListener("input", observeRangeInput, true);
  frameRequest = requestAnimationFrame(observeFrame);
  try {
    longTaskObserver = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) longTasks.push(entry.duration);
    });
    longTaskObserver.observe({ type: "longtask" });
  } catch {
    longTaskObserver = undefined;
  }
}

function endObservation(): void {
  if (!running) return;
  running = false;
  if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
  frameRequest = undefined;
  longTaskObserver?.disconnect();
  longTaskObserver = undefined;
  document.removeEventListener("pointermove", observePointerMove, true);
  document.removeEventListener("keydown", observeKeydown, true);
  warpInput.removeEventListener("input", observeRangeInput, true);
  const heapEnd = currentHeap();
  const observation = {
    kind: "worldbend.browser-canvas-observation.v1",
    environment: {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    workload: {
      inputCount,
      pointerMoveCount,
      arrowKeyCount,
      rangeInputCount,
      warpSampleCount,
      drawCount,
    },
    inputToDrawMs: summarize(inputToDraw),
    frameDeltaMs: summarize(frameDeltas),
    delayedFrames: {
      over20ms: frameDeltas.filter((value) => value > 20).length,
      over34ms: frameDeltas.filter((value) => value > 34).length,
    },
    longTasksMs: summarize(longTasks),
    heapBytes: {
      start: heapStart,
      end: heapEnd,
      delta: heapStart === null || heapEnd === null ? null : heapEnd - heapStart,
    },
    graphicsResources: {
      created: { ...created },
      deleted: { ...deleted },
      retained: {
        programs: created.programs - deleted.programs,
        textures: created.textures - deleted.textures,
        buffers: created.buffers - deleted.buffers,
      },
    },
    disposed,
  };
  output.textContent = JSON.stringify(observation, null, 2);
  status.textContent = disposed ? "Disposed observation captured." : "Observation captured.";
  startButton.disabled = disposed;
  stopButton.disabled = true;
}

function observePointerMove(event: PointerEvent): void {
  pointerMoveCount += 1;
  inputCount += 1;
  latestInputSequence += 1;
  latestInputTime = event.timeStamp;
}

function observeKeydown(event: KeyboardEvent): void {
  if (!event.key.startsWith("Arrow")) return;
  arrowKeyCount += 1;
  inputCount += 1;
  latestInputSequence += 1;
  latestInputTime = event.timeStamp;
}

function observeRangeInput(event: Event): void {
  rangeInputCount += 1;
  inputCount += 1;
  latestInputSequence += 1;
  latestInputTime = event.timeStamp;
}

function observeFrame(time: number): void {
  if (!running) return;
  if (previousFrame !== undefined) frameDeltas.push(time - previousFrame);
  previousFrame = time;
  frameRequest = requestAnimationFrame(observeFrame);
}

function installGraphicsObservation(): void {
  gl.createProgram = function createProgram(): WebGLProgram {
    const value = original.createProgram.call(this);
    if (value && !knownPrograms.has(value)) {
      knownPrograms.add(value);
      created.programs += 1;
    }
    return value;
  };
  gl.deleteProgram = function deleteProgram(value: WebGLProgram | null): void {
    if (value && knownPrograms.has(value)) deleted.programs += 1;
    original.deleteProgram.call(this, value);
  };
  gl.createTexture = function createTexture(): WebGLTexture {
    const value = original.createTexture.call(this);
    if (value && !knownTextures.has(value)) {
      knownTextures.add(value);
      created.textures += 1;
    }
    return value;
  };
  gl.deleteTexture = function deleteTexture(value: WebGLTexture | null): void {
    if (value && knownTextures.has(value)) deleted.textures += 1;
    original.deleteTexture.call(this, value);
  };
  gl.createBuffer = function createBuffer(): WebGLBuffer {
    const value = original.createBuffer.call(this);
    if (value && !knownBuffers.has(value)) {
      knownBuffers.add(value);
      created.buffers += 1;
    }
    return value;
  };
  gl.deleteBuffer = function deleteBuffer(value: WebGLBuffer | null): void {
    if (value && knownBuffers.has(value)) deleted.buffers += 1;
    original.deleteBuffer.call(this, value);
  };
  gl.drawArrays = function drawArrays(mode: number, first: number, count: number): void {
    original.drawArrays.call(this, mode, first, count);
    if (!running) return;
    drawCount += 1;
    if (latestInputSequence > matchedInputSequence) {
      inputToDraw.push(performance.now() - latestInputTime);
      matchedInputSequence = latestInputSequence;
    }
  };
}

function summarize(values: readonly number[]): Record<string, number | null> {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: values.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

function quantile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? null;
}

function currentHeap(): number | null {
  return (performance as MemoryPerformance).memory?.usedJSHeapSize ?? null;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await awaitImageDecoded(image);
  return image;
}

function normalizeExampleSpec(spec: TransformSpec): TransformSpec {
  if (spec.destination.space === "normalized") return spec;
  const { width, height } = spec.destination.reference;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("The example TransformSpec has an invalid pixel reference");
  }
  const { quad } = spec.destination;
  return {
    ...spec,
    destination: {
      space: "normalized",
      quad: {
        tl: { x: quad.tl.x / width, y: quad.tl.y / height },
        tr: { x: quad.tr.x / width, y: quad.tr.y / height },
        br: { x: quad.br.x / width, y: quad.br.y / height },
        bl: { x: quad.bl.x / width, y: quad.bl.y / height },
      },
    },
  };
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
