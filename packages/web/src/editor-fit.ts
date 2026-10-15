import type { PerspectiveEditor } from "./editor";

export interface EditorFitHandle {
  update(): void;
  dispose(): void;
}

/**
 * Fit the editor's complete interactive plane inside a container's content
 * box. Sizing the editor rather than clipping its canvas keeps all four corner
 * handles aligned and reachable for wide, tall, and small source images.
 */
export function fitEditorToContainer(
  editor: PerspectiveEditor,
  container: HTMLElement,
): EditorFitHandle {
  const previous = {
    width: editor.element.style.width,
    height: editor.element.style.height,
  };
  let disposed = false;

  const update = (): void => {
    if (disposed) return;
    const style = getComputedStyle(container);
    const availableWidth =
      container.clientWidth - numericPixels(style.paddingLeft) - numericPixels(style.paddingRight);
    const availableHeight =
      container.clientHeight - numericPixels(style.paddingTop) - numericPixels(style.paddingBottom);
    const sourceWidth = editor.canvas.width;
    const sourceHeight = editor.canvas.height;
    if (
      availableWidth <= 0 ||
      availableHeight <= 0 ||
      sourceWidth <= 1 ||
      sourceHeight <= 1
    ) {
      return;
    }
    const scale = Math.min(1, availableWidth / sourceWidth, availableHeight / sourceHeight);
    const presentation = {
      width: displayPixels(sourceWidth * scale),
      height: displayPixels(sourceHeight * scale),
    };
    editor.element.style.width = `${presentation.width}px`;
    editor.element.style.height = `${presentation.height}px`;
    editor.setPresentationSize(presentation);
  };

  const observer = new ResizeObserver(update);
  observer.observe(container);
  // Distort gestures can grow the backing canvas beyond the source frame
  // while the container stays still; re-fit then too, or the overlay and the
  // clamped canvas drift apart for every fit-style host.
  observer.observe(editor.canvas);
  update();
  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      editor.element.style.width = previous.width;
      editor.element.style.height = previous.height;
      editor.setPresentationSize(undefined);
    },
  };
}

function numericPixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayPixels(value: number): number {
  return Math.max(1, Math.round(value * 1_000) / 1_000);
}
