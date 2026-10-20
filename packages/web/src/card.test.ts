import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectCardPose = vi.fn();
const sampleCardPointer = vi.fn();
const sampleCardIdle = vi.fn();
const sampleCardTurn = vi.fn();

vi.mock("./perspective-bridge", () => ({
  projectCardPose: (...args: unknown[]) => projectCardPose(...args),
  sampleCardPointer: (...args: unknown[]) => sampleCardPointer(...args),
  sampleCardIdle: (...args: unknown[]) => sampleCardIdle(...args),
  sampleCardTurn: (...args: unknown[]) => sampleCardTurn(...args),
}));

import { attachCardController } from "./card";
import type { CardRig } from "./types";

function rig(patch: Record<string, unknown> = {}): CardRig {
  return {
    schema: "worldbend.card",
    version: "0.1",
    elementSize: { width: 320, height: 200 },
    geometry: { perspective: 900 },
    tilt: { maxRotateX: 10, maxRotateY: 14 },
    action: {},
    ...patch,
  } as CardRig;
}

interface FakeNode {
  style: CSSStyleDeclaration & { properties: Map<string, { value: string; priority: string }> };
  listeners: Map<string, Set<(event: never) => void>>;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  dispatchEvent(event: { type: string } & Record<string, unknown>): boolean;
  dispatched: unknown[];
}

function fakeNode(): FakeNode {
  const properties = new Map<string, { value: string; priority: string }>();
  const listeners = new Map<string, Set<(event: never) => void>>();
  const dispatched: unknown[] = [];
  const style = new Proxy(properties, {
    get(target, property, receiver) {
      if (property === "properties") return properties;
      if (property === "setProperty")
        return (name: string, value: string, priority = "") => {
          target.set(name, { value, priority });
        };
      if (property === "getPropertyValue")
        return (name: string) => target.get(name)?.value ?? "";
      if (property === "getPropertyPriority")
        return (name: string) => target.get(name)?.priority ?? "";
      if (property === "removeProperty")
        return (name: string) => {
          target.delete(name);
        };
      if (typeof property === "string") {
        // CSSOM reads hyphenated declarations through camelCase accessors.
        const kebab = property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
        return target.get(property)?.value ?? target.get(kebab)?.value ?? "";
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as FakeNode["style"];
  const node: FakeNode = {
    style,
    listeners,
    dispatched,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event as never);
      }
      return true;
    },
  };
  return node;
}

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
}

interface Harness {
  element: FakeNode;
  surface: FakeNode;
  listeners: Map<string, Set<(event: never) => void>>;
  rafCallbacks: (() => void)[];
  reducedMatches(): boolean;
  setReduced(value: boolean): void;
  fireReducedChange(): void;
  fireVisibility(hidden: boolean): void;
  fireAnimationFrame(): void;
}

function harness(): Harness {
  const element = fakeNode(),
    surface = fakeNode(),
    window = fakeNode(),
    document = fakeNode();
  const reducedState = { matches: false };
  const fineState = { matches: true };
  const reducedListeners = new Set<() => void>();
  const fineListeners = new Set<() => void>();
  const rafCallbacks: (() => void)[] = [];
  const asElement = (node: FakeNode) => node as unknown as HTMLElement;
  surface.listeners; // both nodes already carry their own listener maps
  vi.stubGlobal("window", {
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  });
  vi.stubGlobal("document", {
    addEventListener: document.addEventListener.bind(document),
    removeEventListener: document.removeEventListener.bind(document),
    hidden: false,
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced") ? reducedState.matches : fineState.matches,
    addEventListener: (_: string, listener: () => void) => {
      (query.includes("reduced") ? reducedListeners : fineListeners).add(listener);
    },
    removeEventListener: (_: string, listener: () => void) => {
      (query.includes("reduced") ? reducedListeners : fineListeners).delete(listener);
    },
  }));
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  vi.stubGlobal("performance", { now: () => 0 });
  (asElement(surface) as HTMLElement & {
    getBoundingClientRect: () => DOMRect;
  }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
  ResizeObserverStub.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  return {
    element,
    surface,
    listeners: surface.listeners,
    rafCallbacks,
    reducedMatches: () => reducedState.matches,
    setReduced(value: boolean) {
      reducedState.matches = value;
    },
    fireReducedChange() {
      for (const listener of reducedListeners) listener();
    },
    fireVisibility(hidden: boolean) {
      (globalThis as { document: { hidden: boolean } }).document.hidden = hidden;
      for (const listener of document.listeners.get("visibilitychange") ?? []) {
        (listener as unknown as () => void)();
      }
    },
    fireAnimationFrame() {
      const pending = rafCallbacks.splice(0);
      for (const callback of pending) callback();
    },
  };
}

describe("attachCardController", () => {
  let setup: Harness;

  beforeEach(() => {
    setup = harness();
    projectCardPose.mockReset();
    projectCardPose.mockImplementation(async ({rig, view}: {rig: CardRig; view: {rotateX?: number; rotateY?: number; rotateZ?: number}}) => ({
      face: "front", rigidCss: `perspective(${rig.geometry.perspective}px) translate3d(0px, 0px, 0px) rotateZ(${view.rotateZ ?? 0}deg) rotateY(${view.rotateY ?? 0}deg) rotateX(${view.rotateX ?? 0}deg)`,
      backCss: `perspective(${rig.geometry.perspective}px) rotateY(180deg)`,
    }));
    sampleCardPointer.mockReset();
    sampleCardIdle.mockReset();
    sampleCardTurn.mockReset();
    sampleCardPointer.mockResolvedValue({ clampX: 0, clampY: 0, tiltX: 0, tiltY: 0 });
    sampleCardIdle.mockResolvedValue({ clampX: 0, clampY: 0, tiltX: 0, tiltY: 0 });
    sampleCardTurn.mockImplementation(async (input: { rig: CardRig; progress: number }) => ({
      easedProgress: input.progress,
      angle:
        (input.rig.action.direction ?? 1) * (input.rig.action.turns ?? 1) * 360 * input.progress,
      revolutions: input.progress,
      face: "front",
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const element = (): HTMLElement => setup.element as unknown as HTMLElement;

  it("applies the documented pose order with the rig perspective and pivot", async () => {
    const controller = attachCardController(
      element(),
      rig({
        geometry: {
          perspective: 900,
          pivot: { x: 0.25, y: 0.75 },
          perspectiveOrigin: { x: 0.5, y: 0.5 },
        },
      }),
      { surface: setup.surface as unknown as HTMLElement },
    );
    await controller.ready;
    expect(element().style.transform).toContain("perspective(900px)");
    expect(element().style.transform).toContain(
      "translate3d(0px, 0px, 0px) rotateZ(0deg) rotateY(0deg) rotateX(0deg)",
    );
    expect(element().style.transformOrigin).toBe("0px 0px");
    expect(element().style.perspectiveOrigin).toBe("");
    controller.dispose();
  });

  it("follows the core pointer sample inside the declared envelope", async () => {
    const controller = attachCardController(
      element(),
      rig({ tilt: { maxRotateX: 10, maxRotateY: 14, smoothingMs: 0 } }),
      { surface: setup.surface as unknown as HTMLElement },
    );
    await controller.ready;
    sampleCardPointer.mockResolvedValue({ clampX: 0.5, clampY: -0.5, tiltX: 5, tiltY: 7 });
    setup.surface.dispatchEvent({
      type: "pointermove",
      clientX: 250,
      clientY: 50,
      pointerType: "mouse",
      button: 0,
    });
    await Promise.resolve();
    expect(sampleCardPointer).toHaveBeenCalledWith(
      expect.objectContaining({
        rig: expect.objectContaining({ schema: "worldbend.card" }),
        x: 0.625,
        y: 0.25,
      }),
    );
    // Instant smoothing reaches the sampled envelope tilt within one frame.
    for (let index = 0; index < 40; index += 1) {
      setup.fireAnimationFrame();
      await Promise.resolve();
    }
    expect(element().style.transform).toContain("rotateY(7deg)");
    expect(element().style.transform).toContain("rotateX(5deg)");
    controller.dispose();
  });

  it("runs one action at a time and retains completed revolution counts", async () => {
    const controller = attachCardController(
      element(),
      rig({ action: { turns: 2, direction: -1, durationMs: 400 } }),
      { surface: setup.surface as unknown as HTMLElement },
    );
    await controller.ready;
    let clock = 0;
    vi.stubGlobal("performance", { now: () => clock });
    expect(controller.activate()).toBe(true);
    expect(controller.getState().actionActive).toBe(true);
    expect(controller.activate()).toBe(false);

    clock = 200;
    setup.fireAnimationFrame();
    await Promise.resolve();
    await Promise.resolve();
    setup.fireAnimationFrame();
    await Promise.resolve();
    expect(controller.getState().turnAngle).toBe(-360);
    clock = 450;
    setup.fireAnimationFrame();
    await Promise.resolve();
    const state = controller.getState();
    expect(state.actionActive).toBe(false);
    // Rendering wraps whole revolutions; retained state keeps their count.
    expect(Math.abs(state.turnAngle % 360)).toBe(0);
    expect(state.turnAngle).toBe(-720);
    expect(state.revolutions).toBe(-2);
    expect(element().style.transform).toContain("rotateY(0deg)");
    controller.dispose();
  });

  it("reduced motion disables animation and jumps activation to the final state", async () => {
    setup.setReduced(true);
    const controller = attachCardController(element(), rig(), {
      surface: setup.surface as unknown as HTMLElement,
    });
    await controller.ready;
    setup.surface.dispatchEvent({
      type: "pointermove",
      clientX: 300,
      clientY: 100,
      pointerType: "mouse",
      button: 0,
    });
    expect(sampleCardPointer).not.toHaveBeenCalled();
    expect(controller.activate()).toBe(true);
    expect(element().style.transform).toContain("rotateY(0deg)");
    controller.dispose();
  });

  it("disposes back to the caller's own styles and stops late writes", async () => {
    setup.element.style.setProperty("transform", "translateX(4px)");
    const controller = attachCardController(element(), rig(), {
      surface: setup.surface as unknown as HTMLElement,
    });
    await controller.ready;
    controller.dispose();
    expect(element().style.transform).toBe("translateX(4px)");
    expect(element().style.transformOrigin).toBe("");
    expect(element().style.perspectiveOrigin).toBe("");
    sampleCardPointer.mockResolvedValue({ clampX: 1, clampY: 1, tiltX: 10, tiltY: 14 });
    setup.surface.dispatchEvent({
      type: "pointermove",
      clientX: 390,
      clientY: 190,
      pointerType: "mouse",
      button: 0,
    });
    await Promise.resolve();
    expect(element().style.transform).toBe("translateX(4px)");
  });

  it("drives a provided back layer through the same pose plus a half turn", async () => {
    const back = fakeNode();
    const controller = attachCardController(element(), rig(), {
      surface: setup.surface as unknown as HTMLElement,
      back: back as unknown as HTMLElement,
    });
    await controller.ready;
    expect(back.style.transform).toContain("rotateY(180deg)");
    expect(back.style.backfaceVisibility).toBe("hidden");
    expect(element().style.backfaceVisibility).toBe("hidden");
    controller.dispose();
    expect(back.style.transform).toBe("");
    expect(back.style.backfaceVisibility).toBe("");
  });

  it("pauses the action clock while the page is hidden", async () => {
    let clock = 0;
    vi.stubGlobal("performance", { now: () => clock });
    const controller = attachCardController(element(), rig(), {
      surface: setup.surface as unknown as HTMLElement,
    });
    await controller.ready;
    controller.activate();
    clock = 100;
    setup.fireAnimationFrame();
    await Promise.resolve();
    setup.fireVisibility(true);
    clock = 5000;
    setup.fireVisibility(false);
    // The hidden time must not count toward the action duration.
    expect(controller.getState().actionActive).toBe(true);
    // The action completes at the shifted start (0 + 4900 hidden) + default 720ms.
    clock = 5700;
    setup.fireAnimationFrame();
    await Promise.resolve();
    expect(controller.getState().actionActive).toBe(false);
    controller.dispose();
  });
  it("follows in milliseconds and settles gradually", async () => {
    let clock = 0; vi.stubGlobal("performance", { now: () => clock });
    const controller = attachCardController(element(), rig({tilt: {maxRotateX: 10, maxRotateY: 14, smoothingMs: 120}}), {surface: setup.surface as unknown as HTMLElement});
    await controller.ready;
    sampleCardPointer.mockResolvedValue({tiltX: 10, tiltY: 14});
    setup.surface.dispatchEvent({type: "pointermove", clientX: 400, clientY: 0});
    await Promise.resolve(); setup.fireAnimationFrame(); await Promise.resolve();
    clock = 16; setup.fireAnimationFrame(); await Promise.resolve();
    expect(controller.getState().tiltY).toBeGreaterThan(1);
    expect(controller.getState().tiltY).toBeLessThan(2);
    controller.dispose();
  });
  it("ignores a pointer result that completes after leave", async () => {
    const controller = attachCardController(element(), rig(), {surface: setup.surface as unknown as HTMLElement});
    await controller.ready;
    let resolve!: (value: unknown) => void;
    sampleCardPointer.mockImplementation(() => new Promise(r => {resolve = r;}));
    setup.surface.dispatchEvent({type: "pointermove", clientX: 400, clientY: 0});
    setup.surface.dispatchEvent({type: "pointerleave"});
    resolve({tiltX: 10, tiltY: 14}); await Promise.resolve(); setup.fireAnimationFrame();
    expect(controller.getState().tiltY).toBe(0); controller.dispose();
  });
  it("rejects malformed updates and keeps the current valid effect", async () => {
    const controller = attachCardController(element(), rig(), {surface: setup.surface as unknown as HTMLElement});
    await controller.ready;
    const before = element().style.transform;
    expect(await controller.update(rig({geometry: {perspective: -1}}))).toBe(false);
    expect(element().style.transform).toBe(before);
    expect(() => attachCardController(element(), rig({tilt: {idle: null}}))).toThrow();
    expect(() => attachCardController(element(), rig({action: []}))).toThrow();
    expect(() => attachCardController(element(), rig({rest: []}))).toThrow();
    expect(controller.activate()).toBe(true); controller.dispose();
  });
  it("keeps the observed layout size when a design revision arrives", async () => {
    const controller = attachCardController(element(), rig());
    await controller.ready;
    vi.stubGlobal("getComputedStyle", () => ({writingMode: "horizontal-tb"}));
    const observer = ResizeObserverStub.instances[0]!;
    observer.callbacks[0]!([{target: element(), borderBoxSize: [{inlineSize: 280.5, blockSize: 170.5}]} as unknown as ResizeObserverEntry], observer as unknown as ResizeObserver);
    await Promise.resolve();
    expect(await controller.update(rig({rest: {rotateY: 18}}))).toBe(true);
    expect(projectCardPose.mock.calls.at(-1)![0].rig.elementSize).toEqual({width: 280.5, height: 170.5});
    controller.dispose();
  });

  it("projects an equivalent local angle when live tilt crosses the authored view limit", async () => {
    const controller = attachCardController(element(), rig({rest: {rotateY: 3599}, tilt: {maxRotateX: 10, maxRotateY: 14, smoothingMs: 0}}), {surface: setup.surface as unknown as HTMLElement});
    await controller.ready;
    sampleCardPointer.mockResolvedValue({tiltX: 0, tiltY: 14});
    setup.surface.dispatchEvent({type: "pointermove", clientX: 400, clientY: 100});
    await Promise.resolve(); setup.fireAnimationFrame(); await Promise.resolve();
    const view = projectCardPose.mock.calls.at(-1)![0].view;
    expect(Math.abs(view.rotateY)).toBeLessThanOrEqual(3600);
    expect((view.rotateY % 360 + 360) % 360).toBe(13);
    expect(controller.getState().tiltY).toBe(14);
    controller.dispose();
  });
  it("preserves later component-owned edits when disposing", async () => {
    const controller = attachCardController(element(), rig(), {surface: setup.surface as unknown as HTMLElement});
    await controller.ready;
    element().style.setProperty("transform", "translateX(99px)");
    controller.dispose(); expect(element().style.transform).toBe("translateX(99px)");
  });

  it("presents the accepted core sample and drops a late sample after disposal", async () => {
    const onPose = vi.fn();
    const controller = attachCardController(element(), rig(), {onPose});
    await controller.ready;
    expect(onPose).toHaveBeenCalledWith(await projectCardPose.mock.results.at(-1)!.value);
    const before = onPose.mock.calls.length;
    let finish!: (value: unknown) => void;
    projectCardPose.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
    setup.fireAnimationFrame();
    controller.dispose();
    finish({face:"back", rigidCss:"late", backCss:"late"});
    await Promise.resolve();
    expect(onPose).toHaveBeenCalledTimes(before);
  });

  it("paints its initial pose in a hidden page while keeping animation paused", async () => {
    setup.fireVisibility(true);
    const controller = attachCardController(element(), rig({rest:{rotateY:180}}));
    expect(await controller.ready).toBe(true);
    expect(element().style.transform).toContain("rotateY(180deg)");
    expect(controller.activate()).toBe(false);
    expect(setup.rafCallbacks).toHaveLength(0);
    controller.dispose();
  });

  it("stops on an external style conflict even if the error callback throws", async () => {
    const onError = vi.fn(() => {throw new Error("consumer callback");});
    const controller = attachCardController(element(), rig(), {onError});
    await controller.ready;
    element().style.setProperty("transform", "translateX(7px)");
    setup.fireAnimationFrame(); await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(controller.activate()).toBe(false);
    expect(element().style.transform).toBe("translateX(7px)");
  });

});
