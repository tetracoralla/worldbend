import { afterEach, describe, expect, it, vi } from "vitest";
import { fitEditorToContainer } from "./editor-fit";
import type { PerspectiveEditor } from "./editor";

class ResizeObserverStub {
  static callback: ResizeObserverCallback | undefined;
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverStub.callback = callback;
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => vi.unstubAllGlobals());

describe("fitEditorToContainer", () => {
  it("fits both axes inside the container content box and restores styles", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("getComputedStyle", () => ({
      paddingLeft: "10px",
      paddingRight: "10px",
      paddingTop: "20px",
      paddingBottom: "20px",
    }));
    const element = { style: { width: "", height: "" } };
    const setPresentationSize = vi.fn();
    const editor = {
      element,
      canvas: { width: 1200, height: 800 },
      setPresentationSize,
    } as unknown as PerspectiveEditor;
    const container = { clientWidth: 1000, clientHeight: 500 } as HTMLElement;

    const fit = fitEditorToContainer(editor, container);
    expect(element.style.width).toBe("690px");
    expect(element.style.height).toBe("460px");
    expect(setPresentationSize).toHaveBeenLastCalledWith({ width: 690, height: 460 });

    (container as unknown as { clientWidth: number; clientHeight: number }).clientWidth = 620;
    (container as unknown as { clientWidth: number; clientHeight: number }).clientHeight = 900;
    ResizeObserverStub.callback?.([], {} as ResizeObserver);
    expect(element.style.width).toBe("600px");
    expect(element.style.height).toBe("400px");
    expect(setPresentationSize).toHaveBeenLastCalledWith({ width: 600, height: 400 });

    fit.dispose();
    expect(element.style).toEqual({ width: "", height: "" });
    expect(setPresentationSize).toHaveBeenLastCalledWith(undefined);
  });

  it("re-fits when a Distort gesture grows the backing canvas", () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("getComputedStyle", () => ({
      paddingLeft: "0px",
      paddingRight: "0px",
      paddingTop: "0px",
      paddingBottom: "0px",
    }));
    const element = { style: { width: "", height: "" } };
    const setPresentationSize = vi.fn();
    const editor = {
      element,
      canvas: { width: 200, height: 100 },
      setPresentationSize,
    } as unknown as PerspectiveEditor;
    const container = { clientWidth: 600, clientHeight: 400 } as HTMLElement;

    const fit = fitEditorToContainer(editor, container);
    expect(element.style.width).toBe("200px");
    expect(element.style.height).toBe("100px");

    // An outward corner drag expands the workspace canvas; the fit must
    // follow it even though the container never resized.
    (editor.canvas as unknown as { width: number; height: number }).width = 272;
    (editor.canvas as unknown as { width: number; height: number }).height = 152;
    ResizeObserverStub.callback?.([], {} as ResizeObserver);
    expect(element.style.width).toBe("272px");
    expect(element.style.height).toBe("152px");
    expect(setPresentationSize).toHaveBeenLastCalledWith({ width: 272, height: 152 });

    fit.dispose();
  });
});
