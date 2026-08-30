import {
  PerspectiveEditor,
  awaitImageDecoded,
  emitCssTransform,
  fitEditorToContainer,
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
const downloadButton = required<HTMLButtonElement>("download");

let sourceImage: HTMLImageElement | undefined;
let valid = false;
let loading = false;
let action: "reset" | "copy" | "download" | undefined;
let loadGeneration = 0;
let copyConfirmed = false;
let copyFeedbackTimer: number | undefined;

const editor = createEditor();
if (editor) mount.append(editor.element);
const editorFit = editor ? fitEditorToContainer(editor, mount) : undefined;
renderState();
if (editor) void openExample();

function createEditor(): PerspectiveEditor | undefined {
  try {
    return new PerspectiveEditor({
      onError(error) {
        showError(error);
      },
      onChange() {
        // While the quad is invalid the visible error belongs to that live
        // state and must survive per-frame change notifications; returning to
        // valid clears it via onValidityChange instead.
        if (valid) clearError();
        setStatus("");
      },
      onValidityChange(next) {
        valid = next;
        if (next) clearError();
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
downloadButton.addEventListener("click", () => void downloadPng());

async function openExample(): Promise<void> {
  if (!editor) return;
  const generation = ++loadGeneration;
  loading = true;
  clearError();
  setStatus("Opening example…");
  renderState();
  try {
    const url = new URL("worldbend-demo-source.png", window.location.href).href;
    const image = await loadImageUrl(url);
    if (generation !== loadGeneration) return;
    const loaded = await editor.setSource(image);
    if (generation !== loadGeneration) return;
    if (!loaded) throw new Error("The example image could not be previewed");
    sourceImage = image;
    workspace.hidden = false;
    editorFit?.update();
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
    editorFit?.update();
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
    if (valid) setStatus("Worldbend reset.");
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
  copyConfirmed = false;
  if (copyFeedbackTimer !== undefined) window.clearTimeout(copyFeedbackTimer);
  action = "copy";
  clearError();
  setStatus("Copying CSS…");
  renderState();
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Copying CSS requires a secure (https) browser context");
    }
    const css = await emitCssTransform(
      spec,
      { width: sourceImage.naturalWidth, height: sourceImage.naturalHeight },
      { width: sourceImage.naturalWidth, height: sourceImage.naturalHeight },
    );
    await navigator.clipboard.writeText(
      `width: ${css.width};\nheight: ${css.height};\ntransform: ${css.transform};\ntransform-origin: ${css.transformOrigin};`,
    );
    copyConfirmed = true;
    copyFeedbackTimer = window.setTimeout(() => {
      copyConfirmed = false;
      copyFeedbackTimer = undefined;
      renderState();
    }, 1_500);
    setStatus("CSS copied.");
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
  downloadButton.disabled = locked || !sourceImage || !valid;
  resetButton.textContent = action === "reset" ? "Resetting…" : "Reset";
  copyButton.textContent = action === "copy" ? "Copying…" : copyConfirmed ? "Copied" : "Copy CSS";
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
    editorFit?.dispose();
    editor?.dispose();
  },
  { once: true },
);
