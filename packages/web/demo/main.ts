import {
  PerspectiveEditor,
  awaitImageDecoded,
  createPreviewViewport,
  emitCssTransform,
  initializeWorldbend,
  type CssTransform,
  type PreviewViewportHandle,
  type TransformSpec,
} from "../src";

const input = required<HTMLInputElement>("source");
const openButton = required<HTMLButtonElement>("open");
const workspace = required<HTMLElement>("workspace");
const mount = required<HTMLElement>("editor");
const errorMessage = required<HTMLParagraphElement>("error");
const statusMessage = required<HTMLParagraphElement>("status");
const resetButton = required<HTMLButtonElement>("reset");
const copyButton = required<HTMLButtonElement>("copy-css");
const copySpecButton = required<HTMLButtonElement>("copy-spec");
const downloadButton = required<HTMLButtonElement>("download");
const specOutput = required<HTMLPreElement>("spec-output");
const cssOutput = required<HTMLPreElement>("css-output");
const zoomOutButton = required<HTMLButtonElement>("zoom-out");
const zoomFitButton = required<HTMLButtonElement>("zoom-fit");
const zoomActualButton = required<HTMLButtonElement>("zoom-actual");
const zoomInButton = required<HTMLButtonElement>("zoom-in");
const zoomLevel = required<HTMLOutputElement>("zoom-level");

let sourceImage: HTMLImageElement | undefined;
let valid = false;
let loading = false;
let action: "reset" | "copy-css" | "copy-spec" | "download" | undefined;
let loadGeneration = 0;
let outputGeneration = 0;
let copied: "css" | "spec" | undefined;
let copyFeedbackTimer: number | undefined;
let currentCss = "";
let viewport: PreviewViewportHandle | undefined;

const editor = createEditor();
if (editor) mount.append(editor.element);
if (editor) {
  viewport = createPreviewViewport(editor, mount, {
    onScaleChange(scale) {
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    },
  });
}
renderState();
if (editor) void openExample();

function createEditor(): PerspectiveEditor | undefined {
  try {
    return new PerspectiveEditor({
      onError(error) {
        showError(error);
      },
      onChange(spec) {
        // While the quad is invalid the visible error belongs to that live
        // state and must survive per-frame change notifications; returning to
        // valid clears it via onValidityChange instead.
        if (valid) clearError();
        setStatus("");
        renderSpec(spec);
        void renderCss(spec);
      },
      onDistortGesture(event) {
        viewport?.handleDistortGesture(event);
      },
      onEditEnd() {
        viewport?.revealAllCorners({ animate: true });
      },
      onValidityChange(next) {
        valid = next;
        if (next) clearError();
        if (!next) {
          currentCss = "";
          cssOutput.textContent = "";
        }
        renderState();
      },
    });
  } catch (error) {
    showError(error);
    return undefined;
  }
}

openButton.addEventListener("click", () => {
  input.value = "";
  input.click();
});

input.addEventListener("change", () => void replaceImage());
resetButton.addEventListener("click", () => void resetPerspective());
copyButton.addEventListener("click", () => void copyCss());
copySpecButton.addEventListener("click", () => void copySpec());
downloadButton.addEventListener("click", () => void downloadPng());
zoomOutButton.addEventListener("click", () => viewport?.zoomOut());
zoomFitButton.addEventListener("click", () => viewport?.fit());
zoomActualButton.addEventListener("click", () => viewport?.resetScale());
zoomInButton.addEventListener("click", () => viewport?.zoomIn());
document.addEventListener("keydown", handleKeydown);
document.addEventListener("keyup", handleKeyup);
window.addEventListener("blur", () => viewport?.setPanActive(false));

async function openExample(): Promise<void> {
  if (!editor) return;
  const generation = ++loadGeneration;
  loading = true;
  clearError();
  setStatus("Opening example…");
  renderState();
  try {
    const imageUrl = new URL("worldbend-demo-source.png", window.location.href).href;
    const specUrl = new URL("plane.worldbend.json", window.location.href).href;
    const [image, spec] = await Promise.all([
      loadImageUrl(imageUrl),
      loadExampleSpec(specUrl),
      initializeWorldbend(),
    ]).then(([loadedImage, loadedSpec]) => [loadedImage, loadedSpec] as const);
    if (generation !== loadGeneration) return;
    const loaded = await editor.setSource(image, spec);
    if (generation !== loadGeneration) return;
    if (!loaded) throw new Error("The example image could not be previewed");
    sourceImage = image;
    workspace.hidden = false;
    viewport?.fit();
    renderSpec(editor.captureSpec());
    await renderCss(editor.captureSpec());
    setStatus("Example opened.");
  } catch (error) {
    if (generation !== loadGeneration) return;
    editor.clearSource();
    sourceImage = undefined;
    workspace.hidden = true;
    showError(error);
  } finally {
    if (generation === loadGeneration) {
      loading = false;
      renderState();
    }
  }
}

async function replaceImage(): Promise<void> {
  const file = input.files?.[0];
  if (!file || !editor) return;
  const generation = ++loadGeneration;
  const previousImage = sourceImage;
  const previousSpec = previousImage ? editor.captureSpec() : undefined;
  loading = true;
  clearError();
  setStatus("Opening image…");
  renderState();
  try {
    const image = await loadImage(file);
    if (generation !== loadGeneration) return;
    const loaded = await editor.setSource(image, previousSpec);
    if (generation !== loadGeneration) return;
    if (!loaded) throw new Error("The image could not be previewed");
    sourceImage = image;
    workspace.hidden = false;
    viewport?.fit();
    renderSpec(editor.captureSpec());
    await renderCss(editor.captureSpec());
    setStatus(previousImage ? "Image replaced." : "Image opened.");
  } catch (error) {
    if (generation !== loadGeneration) return;
    if (previousImage && previousSpec) {
      try {
        const restored = await editor.setSource(previousImage, previousSpec);
        if (restored) sourceImage = previousImage;
        else {
          editor.clearSource();
          sourceImage = undefined;
          workspace.hidden = true;
        }
      } catch {
        editor.clearSource();
        sourceImage = undefined;
        workspace.hidden = true;
      }
    }
    showError(error);
  } finally {
    if (generation === loadGeneration) {
      loading = false;
      renderState();
    }
  }
}

async function resetPerspective(): Promise<void> {
  if (!editor || !sourceImage || action || loading) return;
  action = "reset";
  clearError();
  setStatus("Resetting…");
  renderState();
  try {
    await editor.reset();
    if (valid) {
      viewport?.fit();
      renderSpec(editor.captureSpec());
      await renderCss(editor.captureSpec());
      setStatus("Worldbend reset.");
    }
  } catch (error) {
    showError(error);
  } finally {
    action = undefined;
    renderState();
  }
}

async function copyCss(): Promise<void> {
  if (!editor || !sourceImage || !valid || action || loading) return;
  const spec = editor.captureSpec();
  clearCopyFeedback();
  action = "copy-css";
  clearError();
  setStatus("Copying CSS…");
  renderState();
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Copying CSS requires a secure (https) browser context");
    }
    const css = await cssForSpec(spec);
    currentCss = formatCss(css);
    cssOutput.textContent = currentCss;
    await copyText(currentCss);
    showCopyFeedback("css");
    setStatus("CSS copied.");
  } catch (error) {
    showError(error);
  } finally {
    action = undefined;
    renderState();
  }
}

async function copySpec(): Promise<void> {
  if (!editor || !sourceImage || action || loading) return;
  clearCopyFeedback();
  action = "copy-spec";
  clearError();
  setStatus("Copying TransformSpec…");
  renderState();
  try {
    const text = JSON.stringify(editor.captureSpec(), null, 2);
    specOutput.textContent = text;
    await copyText(text);
    showCopyFeedback("spec");
    setStatus("TransformSpec copied.");
  } catch (error) {
    showError(error);
  } finally {
    action = undefined;
    renderState();
  }
}

async function downloadPng(): Promise<void> {
  if (!editor || !sourceImage || !valid || action || loading) return;
  const spec = editor.captureSpec();
  action = "download";
  clearError();
  setStatus("Preparing PNG…");
  renderState();
  try {
    // The export frame must contain outward-distorted corners the live
    // preview shows; in-bounds quads keep the natural source size.
    const corners = Object.values(spec.destination.quad);
    const spanX = Math.max(Math.max(...corners.map((corner) => corner.x)), 1) -
      Math.min(Math.min(...corners.map((corner) => corner.x)), 0);
    const spanY = Math.max(Math.max(...corners.map((corner) => corner.y)), 1) -
      Math.min(Math.min(...corners.map((corner) => corner.y)), 0);
    const bytes = await editor.exportPng(
      Math.round(sourceImage.naturalWidth * spanX),
      Math.round(sourceImage.naturalHeight * spanY),
      spec,
    );
    const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "worldbend.png";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setStatus("PNG downloaded.");
  } catch (error) {
    showError(error);
  } finally {
    action = undefined;
    renderState();
  }
}

function renderState(): void {
  const locked = loading || action !== undefined;
  editor?.setDisabled(locked || !sourceImage);
  openButton.disabled = locked || !editor;
  openButton.textContent = loading ? "Opening…" : sourceImage ? "Replace image" : "Open image";
  resetButton.disabled = locked || !sourceImage;
  copyButton.disabled = locked || !sourceImage || !valid;
  copySpecButton.disabled = locked || !sourceImage;
  downloadButton.disabled = locked || !sourceImage || !valid;
  for (const button of [zoomOutButton, zoomFitButton, zoomActualButton, zoomInButton]) {
    button.disabled = locked || !sourceImage;
  }
  resetButton.textContent = action === "reset" ? "Resetting…" : "Reset";
  copyButton.textContent =
    action === "copy-css" ? "Copying…" : copied === "css" ? "Copied" : "Copy CSS";
  copySpecButton.textContent =
    action === "copy-spec" ? "Copying…" : copied === "spec" ? "Copied" : "Copy JSON";
  downloadButton.textContent = action === "download" ? "Preparing…" : "Download PNG";
  workspace.setAttribute("aria-busy", String(locked));
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImageUrl(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImageUrl(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await awaitImageDecoded(image);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("The selected file is not a readable image");
  }
  return image;
}

async function loadExampleSpec(url: string): Promise<TransformSpec> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("The example TransformSpec could not be loaded");
  const spec = (await response.json()) as TransformSpec;
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

function renderSpec(spec: TransformSpec): void {
  specOutput.textContent = JSON.stringify(spec, null, 2);
}

async function renderCss(spec: TransformSpec): Promise<void> {
  if (!sourceImage || !valid) return;
  const generation = ++outputGeneration;
  try {
    const css = await cssForSpec(spec);
    if (generation !== outputGeneration) return;
    currentCss = formatCss(css);
    cssOutput.textContent = currentCss;
  } catch (error) {
    if (generation !== outputGeneration) return;
    currentCss = "";
    cssOutput.textContent = error instanceof Error ? error.message : String(error);
  }
}

function cssForSpec(spec: TransformSpec): Promise<CssTransform> {
  if (!sourceImage) return Promise.reject(new Error("No source image is loaded"));
  const size = { width: sourceImage.naturalWidth, height: sourceImage.naturalHeight };
  return emitCssTransform(spec, size, size);
}

function formatCss(css: CssTransform): string {
  return `width: ${css.width};\nheight: ${css.height};\ntransform: ${css.transform};\ntransform-origin: ${css.transformOrigin};`;
}

async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Copying requires a secure (https) browser context");
  }
  await navigator.clipboard.writeText(text);
}

function clearCopyFeedback(): void {
  copied = undefined;
  if (copyFeedbackTimer !== undefined) window.clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = undefined;
}

function showCopyFeedback(kind: "css" | "spec"): void {
  copied = kind;
  copyFeedbackTimer = window.setTimeout(() => {
    copied = undefined;
    copyFeedbackTimer = undefined;
    renderState();
  }, 1_500);
}

function handleKeydown(event: KeyboardEvent): void {
  if (!viewport || !sourceImage || loading || action || eventTargetEditsText(event.target)) return;
  if (event.key === " ") {
    event.preventDefault();
    viewport.setPanActive(true);
    return;
  }
  if (!(event.metaKey || event.ctrlKey)) return;
  if (event.key === "+" || event.key === "=") viewport.zoomIn();
  else if (event.key === "-" || event.key === "_") viewport.zoomOut();
  else if (event.key === "0") viewport.fit();
  else if (event.key === "1") viewport.resetScale();
  else return;
  event.preventDefault();
}

function handleKeyup(event: KeyboardEvent): void {
  if (event.key === " ") viewport?.setPanActive(false);
}

function eventTargetEditsText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function clearError(): void {
  if (errorMessage.hidden) return;
  errorMessage.textContent = "";
  errorMessage.hidden = true;
}

function showError(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  if (!errorMessage.hidden && errorMessage.textContent === text) {
    setStatus("");
    return;
  }
  errorMessage.textContent = text;
  errorMessage.hidden = false;
  setStatus("");
}

function setStatus(message: string): void {
  if (statusMessage.textContent === message) return;
  statusMessage.textContent = message;
}

window.addEventListener(
  "pagehide",
  () => {
    viewport?.dispose();
    editor?.dispose();
  },
  { once: true },
);
