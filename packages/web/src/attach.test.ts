import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitCssTransform = vi.fn();

vi.mock("./bridge", () => ({
  emitCssTransform: (...args: unknown[]) => emitCssTransform(...args),
}));

import { attachPerspective } from "./attach";
import { normalizedSpec, unitQuad } from "./types";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly callbacks: ResizeObserverCallback[] = [];

  constructor(callback: ResizeObserverCallback) {
    this.callbacks.push(callback);
    ResizeObserverStub.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  fire(...targets: FakeElement[]): void {
    const entries = targets.map(
      (target) =>
        ({
          target,
          borderBoxSize: [
            { inlineSize: target.box.width, blockSize: target.box.height },
          ],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: {
            width: target.box.width,
            height: target.box.height,
          },
        }) as unknown as ResizeObserverEntry,
    );
    for (const callback of this.callbacks) {
      callback(entries, this as unknown as ResizeObserver);
    }
  }
}

interface FakeElement {
  style: Record<string, string>;
  box: { width: number; height: number };
  dispatchEvent: ReturnType<typeof vi.fn>;
}

function fakeElement(): FakeElement {
  const element: FakeElement = {
    style: { transform: "", transformOrigin: "", width: "", height: "" },
    box: { width: 0, height: 0 },
    dispatchEvent: vi.fn(),
  };
  return element;
}

function fakeContainer(): FakeElement {
  return fakeElement();
}

beforeEach(() => {
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("getComputedStyle", () => ({
    writingMode: "horizontal-tb",
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
  }));
  emitCssTransform.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachPerspective", () => {
  it("stays silent on a hidden mount instead of reporting a size error", () => {
    const onError = vi.fn();
    const element = fakeElement();

    attachPerspective(
      element as unknown as HTMLElement,
      fakeContainer() as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
      { onError },
    );

    expect(emitCssTransform).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(element.dispatchEvent).not.toHaveBeenCalled();
  });

  it("applies the emitted transform once layout becomes real", async () => {
    emitCssTransform.mockResolvedValue({
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 8, 0, 1)",
      transformOrigin: "0 0",
    });
    const element = fakeElement();
    const container = fakeContainer();
    attachPerspective(
      element as unknown as HTMLElement,
      container as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
    );

    element.box.width = 640;
    element.box.height = 480;
    container.box.width = 1280;
    container.box.height = 720;
    ResizeObserverStub.instances[0]?.fire(element, container);
    await vi.waitFor(() => {
      expect(element.style.transform).toContain("matrix3d");
    });

    expect(emitCssTransform).toHaveBeenCalledWith(
      normalizedSpec(unitQuad()),
      { width: 640, height: 480 },
      { width: 1280, height: 720 },
    );
    expect(element.style.transformOrigin).toBe("0 0");
  });

  it("measures fractional layout boxes without integer rounding", async () => {
    emitCssTransform.mockResolvedValue({
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 8, 0, 1)",
      transformOrigin: "0 0",
    });
    const element = fakeElement();
    const container = fakeContainer();
    attachPerspective(
      element as unknown as HTMLElement,
      container as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
    );

    element.box.width = 640.6;
    element.box.height = 480.25;
    container.box.width = 1280;
    container.box.height = 720;
    ResizeObserverStub.instances[0]?.fire(element, container);
    await vi.waitFor(() => {
      expect(element.style.transform).toContain("matrix3d");
    });

    expect(emitCssTransform).toHaveBeenCalledWith(
      normalizedSpec(unitQuad()),
      { width: 640.6, height: 480.25 },
      { width: 1280, height: 720 },
    );
  });

  it("does not feed the applied transform back into source layout measurements", async () => {
    emitCssTransform.mockResolvedValue({
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 8, 0, 1)",
      transformOrigin: "0 0",
    });
    const element = fakeElement();
    const container = fakeContainer();
    element.box = { width: 640.5, height: 480.25 };
    container.box = { width: 1280, height: 720 };
    attachPerspective(
      element as unknown as HTMLElement,
      container as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
    );

    ResizeObserverStub.instances[0]?.fire(element, container);
    await vi.waitFor(() => expect(emitCssTransform).toHaveBeenCalledTimes(1));

    // A container-only resize must reuse the element's untransformed border
    // box from ResizeObserver. A visual AABB from getBoundingClientRect() could
    // be completely different after the matrix3d is applied.
    container.box = { width: 1440.75, height: 900.5 };
    ResizeObserverStub.instances[0]?.fire(container);
    await vi.waitFor(() => expect(emitCssTransform).toHaveBeenCalledTimes(2));
    expect(emitCssTransform).toHaveBeenLastCalledWith(
      normalizedSpec(unitQuad()),
      { width: 640.5, height: 480.25 },
      { width: 1440.75, height: 900.5 },
    );
  });

  it("restores the previous inline styles on dispose", async () => {
    emitCssTransform.mockResolvedValue({
      transform: "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 8, 0, 1)",
      transformOrigin: "0 0",
    });
    const element = fakeElement();
    element.style.transform = "scale(2)";
    const container = fakeContainer();
    const attached = attachPerspective(
      element as unknown as HTMLElement,
      container as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
    );

    element.box.width = 640;
    element.box.height = 480;
    container.box.width = 1280;
    container.box.height = 720;
    ResizeObserverStub.instances[0]?.fire(element, container);
    await vi.waitFor(() => {
      expect(element.style.transform).toContain("matrix3d");
    });

    attached.dispose();
    expect(element.style.transform).toBe("scale(2)");
  });

  it("reports emit failures through onError once layout is real", async () => {
    emitCssTransform.mockRejectedValue(new Error("E_QUAD_CONCAVE: quad is concave"));
    const onError = vi.fn();
    const element = fakeElement();
    const container = fakeContainer();
    attachPerspective(
      element as unknown as HTMLElement,
      container as unknown as HTMLElement,
      normalizedSpec(unitQuad()),
      { onError },
    );

    element.box.width = 640;
    element.box.height = 480;
    container.box.width = 1280;
    container.box.height = 720;
    ResizeObserverStub.instances[0]?.fire(element, container);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
  });
});
