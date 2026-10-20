import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emitCssTransform = vi.fn();
const projectPlanePose = vi.fn();
const projectPlaneStrip = vi.fn();

vi.mock("./perspective-bridge", () => ({
  emitCssTransform: (...args: unknown[]) => emitCssTransform(...args),
  projectPlanePose: (...args: unknown[]) => projectPlanePose(...args),
  projectPlaneStrip: (...args: unknown[]) => projectPlaneStrip(...args),
}));

import { attachPerspective, attachPlanePose } from "./attach";
import { attachPerspectiveStrip } from "./attach-strip";
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
  style: CSSStyleDeclaration;
  box: { width: number; height: number };
  dispatchEvent: ReturnType<typeof vi.fn>;
}

function fakeElement(): FakeElement {
  const priorities: Record<string, string> = {};
  const declarations = { transform: "", transformOrigin: "", width: "", height: "" };
  const style = {
    get transform() { return declarations.transform; }, set transform(v: string) { declarations.transform = v; },
    get transformOrigin() { return declarations.transformOrigin; }, set transformOrigin(v: string) { declarations.transformOrigin = v; },
    get width() { return declarations.width; }, set width(v: string) { declarations.width = v; },
    get height() { return declarations.height; }, set height(v: string) { declarations.height = v; },
    getPropertyValue(name: string) { return declarations[name === "transform-origin" ? "transformOrigin" : name as "transform"] ?? ""; },
    getPropertyPriority(name: string) { return priorities[name] ?? ""; },
    setProperty(name: string, value: string, priority = "") {
      declarations[name === "transform-origin" ? "transformOrigin" : name as "transform"] = value;
      priorities[name] = priority;
    },
    removeProperty(name: string) { declarations[name === "transform-origin" ? "transformOrigin" : name as "transform"] = ""; priorities[name] = ""; },
  } as unknown as CSSStyleDeclaration;
  const element: FakeElement = {
    style,
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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
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
  projectPlanePose.mockReset();
  projectPlaneStrip.mockReset();
});

describe("dynamic binding lifecycle", () => {
  const css = (x: number) => ({ transform: `translateX(${x}px)`, transformOrigin: "0 0", width: "640px", height: "360px", matrix3d: [] });
  const asElement = (value: FakeElement) => value as unknown as HTMLElement;
  const visible = () => { const el = fakeElement(); el.box = { width: 640, height: 360 }; return el; };

  it("coalesces a burst and does not publish stale work while a newer update waits", async () => {
    let finish!: (value: ReturnType<typeof css>) => void;
    emitCssTransform.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    emitCssTransform.mockResolvedValue(css(2));
    const element = visible();
    const initial = normalizedSpec(unitQuad());
    const binding = attachPerspective(asElement(element), asElement(element), initial);
    ResizeObserverStub.instances[0]!.fire(element);
    await vi.waitFor(() => expect(emitCssTransform).toHaveBeenCalledTimes(1));
    const updates = Array.from({ length: 100 }, () => binding.update(initial));
    finish(css(1));
    await vi.waitFor(() => expect(element.style.transform).toBe("translateX(2px)"));
    expect(emitCssTransform).toHaveBeenCalledTimes(2);
    expect((await Promise.all(updates)).filter(Boolean)).toHaveLength(1);
    binding.dispose();
  });

  it("retains last valid state on failure then recovers and returns an isolated snapshot", async () => {
    const element = visible(); const onError = vi.fn();
    emitCssTransform.mockResolvedValue(css(1));
    const spec = normalizedSpec(unitQuad());
    const binding = attachPerspective(asElement(element), asElement(element), spec, { onError });
    ResizeObserverStub.instances[0]!.fire(element);
    await vi.waitFor(() => expect(element.style.transform).toBe("translateX(1px)"));
    emitCssTransform.mockRejectedValueOnce(new Error("invalid geometry"));
    expect(await binding.update(spec)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(element.style.transform).toBe("translateX(1px)");
    expect(await binding.update(spec)).toBe(true);
    const saved = binding.getSpec()!; saved.destination.quad.tl.x = 900;
    expect(binding.getSpec()!.destination.quad.tl.x).toBe(0);
    binding.dispose();
  });

  it("rejects uncloneable updates without allowing earlier pending work to publish", async () => {
    let finish!: (value: ReturnType<typeof css>) => void;
    emitCssTransform.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const element = visible(); const onError = vi.fn(); const spec = normalizedSpec(unitQuad());
    const binding = attachPerspective(asElement(element), asElement(element), spec, { onError });
    ResizeObserverStub.instances[0]!.fire(element);
    await vi.waitFor(() => expect(emitCssTransform).toHaveBeenCalledOnce());
    const pending = binding.update(spec);
    expect(await binding.update({ ...spec, invalid: () => {} } as typeof spec)).toBe(false);
    expect(await pending).toBe(false);
    finish(css(1)); await new Promise(resolve => setTimeout(resolve, 10));
    expect(element.style.transform).toBe(""); expect(onError).toHaveBeenCalledOnce();
    emitCssTransform.mockResolvedValue(css(2));
    expect(await binding.update(spec)).toBe(true);
    expect(element.style.transform).toBe("translateX(2px)");binding.dispose();
  });

  it("settles pending updates and prevents late writes on dispose; preserves unrelated layout", async () => {
    let finish!: (value: ReturnType<typeof css>) => void;
    emitCssTransform.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const element = visible();
    element.style.setProperty("transform", "scale(2)", "important");
    const spec = normalizedSpec(unitQuad());
    const binding = attachPerspective(asElement(element), asElement(element), spec);
    ResizeObserverStub.instances[0]!.fire(element);
    await vi.waitFor(() => expect(emitCssTransform).toHaveBeenCalledOnce());
    const pending = binding.update(spec);
    element.style.width = "90%";
    binding.dispose(); binding.dispose();
    expect(await pending).toBe(false);
    expect(await binding.update(spec)).toBe(false);
    finish(css(9)); await new Promise(resolve => setTimeout(resolve, 10));
    expect(element.style.transform).toBe("scale(2)");
    expect(element.style.getPropertyPriority("transform")).toBe("important");
    expect(element.style.width).toBe("90%");
  });

  it("replaces a previous binding and recomputes poses from the current border box", async () => {
    const element = visible();
    emitCssTransform.mockResolvedValue(css(1));
    const first = attachPerspective(asElement(element), asElement(element), normalizedSpec(unitQuad()));
    const pose = { perspective: 1000, rotateY: -8 };
    projectPlanePose.mockResolvedValue({ spec: normalizedSpec(unitQuad()), css: css(3) });
    const binding = attachPlanePose(asElement(element), pose);
    expect(await first.update(normalizedSpec(unitQuad()))).toBe(false);
    ResizeObserverStub.instances[1]!.fire(element);
    await vi.waitFor(() => expect(element.style.transform).toBe("translateX(3px)"));
    element.box = { width: 320, height: 180 };
    ResizeObserverStub.instances[1]!.fire(element);
    await vi.waitFor(() => expect(projectPlanePose).toHaveBeenLastCalledWith({ elementSize: element.box, pose }));
    expect(await binding.update({ perspective: 900, rotateY: 5 })).toBe(true);
    expect(projectPlanePose).toHaveBeenLastCalledWith({ elementSize: element.box, pose: { perspective: 900, rotateY: 5 } });
    binding.dispose();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("attachPerspectiveStrip", () => {
  const itemCss = (x: number) => ({ transform: `matrix3d(${x})`, transformOrigin: "0 0", width: "1px", height: "1px", matrix3d: [] });
  const items = (ids: string[]) => ids.map((id, index) => ({ id, spec: normalizedSpec(unitQuad()), css: itemCss(index + 1) }));
  const asElement = (value: FakeElement) => value as unknown as HTMLElement;

  function group() {
    const container = fakeElement(); container.box = { width: 900, height: 400 };
    const outer = fakeElement(); outer.box = { width: 320, height: 400 };
    const inner = fakeElement(); inner.box = { width: 320, height: 400 };
    return { container, outer, inner };
  }

  it("rejects invalid groups before computing anything", () => {
    const { container, outer } = group();
    expect(() => attachPerspectiveStrip(asElement(container), [], normalizedSpec(unitQuad()))).toThrow(RangeError);
    expect(() => attachPerspectiveStrip(asElement(container), [
      { id: "a", element: asElement(outer), start: 0, end: 0.5 },
      { id: "b", element: asElement(outer), start: 0.6, end: 1 },
    ], normalizedSpec(unitQuad()))).toThrow(RangeError);
    expect(() => attachPerspectiveStrip(asElement(container), [
      { id: "a", element: asElement(container), start: 0, end: 1 },
    ], normalizedSpec(unitQuad()))).toThrow(RangeError);
    expect(projectPlaneStrip).not.toHaveBeenCalled();
  });

  it("publishes the complete plan to every member with correlated element sizes", async () => {
    const { container, outer, inner } = group();
    projectPlaneStrip.mockResolvedValue({ items: items(["outer", "inner"]) });
    const plane = normalizedSpec(unitQuad());
    const binding = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 0.47 },
      { id: "inner", element: asElement(inner), start: 0.53, end: 1 },
    ], plane);
    ResizeObserverStub.instances[0]!.fire(container, outer, inner);
    await vi.waitFor(() => {
      expect(outer.style.transform).toBe("matrix3d(1)");
      expect(inner.style.transform).toBe("matrix3d(2)");
      expect(inner.style.transformOrigin).toBe("0 0");
    });
    expect(projectPlaneStrip).toHaveBeenLastCalledWith({
      spec: plane,
      destinationSize: { width: 900, height: 400 },
      panels: [
        { id: "outer", start: 0, end: 0.47, elementSize: { width: 320, height: 400 } },
        { id: "inner", start: 0.53, end: 1, elementSize: { width: 320, height: 400 } },
      ],
    });
    const saved = binding.getSpecs()!;
    saved[0]!.css.transform = "tampered";
    expect(binding.getSpecs()![0]!.css.transform).toBe("matrix3d(1)");
    binding.dispose();
  });

  it("keeps the last valid plan when an update is rejected, then recovers", async () => {
    const { container, outer } = group();
    projectPlaneStrip.mockResolvedValue({ items: items(["outer"]) });
    const plane = normalizedSpec(unitQuad());
    const onError = vi.fn();
    const binding = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 1 },
    ], plane, { onError });
    ResizeObserverStub.instances[0]!.fire(container, outer);
    await vi.waitFor(() => expect(outer.style.transform).toBe("matrix3d(1)"));
    projectPlaneStrip.mockRejectedValueOnce(new Error("panel intervals out of order"));
    expect(await binding.update(plane)).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
    expect(outer.style.transform).toBe("matrix3d(1)");
    expect(binding.getSpecs()).toHaveLength(1);
    expect(await binding.update(plane)).toBe(true);
    binding.dispose();
  });

  it("holds publication while any member lacks a real layout size", async () => {
    const { container, outer, inner } = group();
    inner.box = { width: 0, height: 0 };
    projectPlaneStrip.mockResolvedValue({ items: items(["outer", "inner"]) });
    const binding = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 0.47 },
      { id: "inner", element: asElement(inner), start: 0.53, end: 1 },
    ], normalizedSpec(unitQuad()));
    ResizeObserverStub.instances[0]!.fire(container, outer, inner);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(projectPlaneStrip).not.toHaveBeenCalled();
    expect(outer.style.transform).toBe("");
    inner.box = { width: 320, height: 400 };
    ResizeObserverStub.instances[0]!.fire(inner);
    await vi.waitFor(() => expect(outer.style.transform).toBe("matrix3d(1)"));
    binding.dispose();
  });

  it("disposes the whole group and restores every sibling when one member is rebound", async () => {
    const { container, outer, inner } = group();
    inner.style.setProperty("transform", "scale(2)", "important");
    projectPlaneStrip.mockResolvedValue({ items: items(["outer", "inner"]) });
    const plane = normalizedSpec(unitQuad());
    const row = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 0.47 },
      { id: "inner", element: asElement(inner), start: 0.53, end: 1 },
    ], plane);
    ResizeObserverStub.instances[0]!.fire(container, outer, inner);
    await vi.waitFor(() => expect(inner.style.transform).toBe("matrix3d(2)"));
    projectPlanePose.mockResolvedValue({ spec: normalizedSpec(unitQuad()), css: itemCss(9) });
    const takeover = attachPlanePose(asElement(outer), { perspective: 1000 });
    ResizeObserverStub.instances[1]!.fire(outer);
    await vi.waitFor(() => expect(outer.style.transform).toBe("matrix3d(9)"));
    expect(inner.style.transform).toBe("scale(2)");
    expect(inner.style.getPropertyPriority("transform")).toBe("important");
    expect(await row.update(plane)).toBe(false);
    takeover.dispose();
    row.dispose();
  });

  it("releases a member's earlier binding before snapshotting its inline styles", async () => {
    const { container, outer, inner } = group();
    projectPlanePose.mockResolvedValue({ spec: normalizedSpec(unitQuad()), css: itemCss(7) });
    const solo = attachPlanePose(asElement(outer), { perspective: 1000 });
    ResizeObserverStub.instances[0]!.fire(outer);
    await vi.waitFor(() => expect(outer.style.transform).toBe("matrix3d(7)"));
    projectPlaneStrip.mockResolvedValue({ items: items(["outer", "inner"]) });
    const row = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 0.47 },
      { id: "inner", element: asElement(inner), start: 0.53, end: 1 },
    ], normalizedSpec(unitQuad()));
    expect(await solo.update({ perspective: 1000 })).toBe(false);
    ResizeObserverStub.instances[1]!.fire(container, outer, inner);
    await vi.waitFor(() => {
      expect(outer.style.transform).toBe("matrix3d(1)");
      expect(inner.style.transform).toBe("matrix3d(2)");
    });
    row.dispose();
    expect(outer.style.transform).toBe("");
    expect(inner.style.transform).toBe("");
  });

  it("restores previous inline declarations on disposal and refuses later updates", async () => {
    const { container, outer, inner } = group();
    outer.style.setProperty("transform", "rotate(1deg)", "important");
    projectPlaneStrip.mockResolvedValue({ items: items(["outer", "inner"]) });
    const binding = attachPerspectiveStrip(asElement(container), [
      { id: "outer", element: asElement(outer), start: 0, end: 0.47 },
      { id: "inner", element: asElement(inner), start: 0.53, end: 1 },
    ], normalizedSpec(unitQuad()));
    ResizeObserverStub.instances[0]!.fire(container, outer, inner);
    await vi.waitFor(() => expect(outer.style.transform).toBe("matrix3d(1)"));
    binding.dispose(); binding.dispose();
    expect(outer.style.transform).toBe("rotate(1deg)");
    expect(outer.style.getPropertyPriority("transform")).toBe("important");
    expect(inner.style.transform).toBe("");
    expect(await binding.update(normalizedSpec(unitQuad()))).toBe(false);
  });
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
