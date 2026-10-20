import { perspectiveOwners } from "./binding-ownership";
import { observedBorderBox } from "./attach";
import { projectCardPose, sampleCardIdle, sampleCardPointer, sampleCardTurn } from "./perspective-bridge";
import { isCardRig, localCardView } from "./card-state";
import type { CardFace, CardRig, CardView, CardPoseOutput } from "./types";

export interface CardControllerState {
  tiltX: number;
  tiltY: number;
  /** Completed plus running action angle; independent from wrapped rendering. */
  turnAngle: number;
  face: CardFace;
  revolutions: number;
  actionActive: boolean;
  actionProgress: number;
  idleTimeMs: number;
  pointer?: {x: number; y: number};
}
export interface CardControllerOptions {
  surface?: HTMLElement;
  /** Authored back layer, overlaid by the caller in the same border box. */
  back?: HTMLElement;
  activateOnClick?: boolean;
  activateOnKeys?: boolean;
  onError?: (error: unknown) => void;
  /** Optional presentation of the exact core sample, for bitmap authoring. */
  onPose?: (pose: CardPoseOutput) => void;
}
export interface CardController {
  /** Resolves after the core validates and paints the initial resting pose. */
  ready: Promise<boolean>;
  update(rig: CardRig): Promise<boolean>;
  activate(): boolean;
  getState(): CardControllerState;
  dispose(): void;
}

/** Local input and clocks; geometry, envelope and easing belong to the core.
 * Async samples carry generation tickets. A later input, update, pause or
 * disposal cannot be overwritten by an earlier completion. */
export function attachCardController(element: HTMLElement, rig: CardRig, options: CardControllerOptions = {}): CardController {
  if (!isCardRig(rig)) throw new TypeError("Invalid worldbend.card rig");
  if (options.back === element) throw new TypeError("Card front and back must be different elements");
  const surface = options.surface ?? element.parentElement ?? element;
  const back = options.back;
  const previousOwner = perspectiveOwners.get(element);
  const previousBackOwner = back ? perspectiveOwners.get(back) : undefined;
  let acquired = false;
  const captureStyles = () => [element, ...(back ? [back] : [])].map(node => ({ node, properties:
    ["transform", "transform-origin", "backface-visibility"].map(name => ({
      name, value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name),
      owned: undefined as string | undefined,
    })),
  }));
  let styles: ReturnType<typeof captureStyles> = [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  let state = structuredClone(rig);
  let layoutSize: CardRig["elementSize"] | undefined;
  let disposed = false, initialized = false, pointerInside = false;
  let tiltX = 0, tiltY = 0, targetX = 0, targetY = 0;
  let completedAngle = 0, runningAngle = 0;
  let actionProgress = 0;
  let pointerPosition: {x: number; y: number} | undefined;
  let face: CardFace = "front";
  let actionStart: number | undefined;
  let idleTimeMs = 0, lastFrameMs: number | undefined, raf = 0;
  let paused = document.hidden, pauseAtMs: number | undefined;
  let epoch = 0, pointerTicket = 0, idleTicket = 0, turnTicket = 0, paintTicket = 0, updateTicket = 0;
  const report = (error: unknown): void => {
    if (disposed) return;
    if (options.onError) options.onError(error);
    else element.dispatchEvent(new CustomEvent("worldbenderror", { detail: error }));
  };
  const total = (): number => (state.action.direction ?? 1) * (state.action.turns ?? 1) * 360;
  const view = (): CardView => localCardView({ ...state.rest,
    rotateX: (state.rest?.rotateX ?? 0) + tiltX + (state.action.axis === "x" ? runningAngle % 360 : 0),
    rotateY: (state.rest?.rotateY ?? 0) + tiltY + (state.action.axis !== "x" ? runningAngle % 360 : 0),
  });
  const styleConflict = (): boolean => styles.some(({node, properties}) => properties.some(p =>
    node.style.getPropertyValue(p.name) !== (p.owned ?? p.value) ||
    node.style.getPropertyPriority(p.name) !== (p.owned === undefined ? p.priority : "")));
  const paint = async (initial = false): Promise<boolean> => {
    if (!initialized || disposed) return false;
    const ticket = ++paintTicket, generation = epoch;
    try {
      const pose = await projectCardPose({ rig: { ...state, elementSize: layoutSize ?? state.elementSize }, view: view() });
      if (disposed || (paused && !initial) || ticket !== paintTicket || generation !== epoch) return false;
      if (styleConflict()) {
        try { report(new Error("Card effect styles were edited by the component owner; binding stopped")); }
        finally { controller.dispose(); }
        return false;
      }
      face = pose.face;
      for (const record of styles) for (const property of record.properties) {
        const value = property.name === "transform" ? (record.node === back ? pose.backCss : pose.rigidCss)
          : property.name === "transform-origin" ? "0px 0px" : back ? "hidden" : "visible";
        record.node.style.setProperty(property.name, value, "");
        property.owned = record.node.style.getPropertyValue(property.name);
      }
      options.onPose?.(pose);
      return true;
    } catch (error) { if (generation === epoch && ticket === paintTicket) report(error); return false; }
  };
  const schedule = (): void => { if (!raf && !disposed && !paused && initialized) raf = requestAnimationFrame(frame); };
  const sampleTurn = (now: number): void => {
    if (actionStart === undefined) return;
    const ticket = ++turnTicket, generation = epoch;
    const progress = Math.min(1, (now - actionStart) / (state.action.durationMs ?? 720));
    void sampleCardTurn({ rig: state, progress }).then(sample => {
      if (disposed || paused || generation !== epoch || ticket !== turnTicket || actionStart === undefined) return;
      runningAngle = sample.angle; actionProgress = progress;
    }, report);
  };
  const idleTarget = (): void => {
    if (disposed || paused || reduced.matches || pointerInside || !state.tilt.idle) return;
    const ticket = ++idleTicket, generation = epoch;
    void sampleCardIdle({rig: state, timeMs: idleTimeMs % 1e9}).then(sample => {
      if (disposed || paused || pointerInside || generation !== epoch || ticket !== idleTicket) return;
      targetX = sample.tiltX; targetY = sample.tiltY; schedule();
    }, report);
  };
  const finish = (): void => { actionProgress = 1; completedAngle += total(); runningAngle = 0; actionStart = undefined; ++turnTicket; };
  const frame = (): void => {
    raf = 0;
    if (disposed || paused || !initialized) return;
    const now = performance.now();
    const dt = lastFrameMs === undefined ? 0 : Math.max(0, now - lastFrameMs);
    lastFrameMs = now; idleTimeMs += dt;
    if (actionStart !== undefined) {
      if (now - actionStart >= (state.action.durationMs ?? 720)) finish();
      else sampleTurn(now);
    }
    const tau = pointerInside ? state.tilt.smoothingMs ?? 120 : state.tilt.settleMs ?? 400;
    const blend = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
    tiltX += (targetX - tiltX) * blend; tiltY += (targetY - tiltY) * blend;
    void paint(); idleTarget();
    if (actionStart !== undefined || (!pointerInside && state.tilt.idle && !reduced.matches) ||
        Math.abs(targetX - tiltX) > 1e-3 || Math.abs(targetY - tiltY) > 1e-3) schedule();
  };
  const pointer = (event: PointerEvent): void => {
    if (disposed || paused || reduced.matches || !finePointer.matches || event.pointerType === "touch") return;
    const box = surface.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    pointerInside = true; ++idleTicket;
    const ticket = ++pointerTicket, generation = epoch;
    const position = {x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))};
    void sampleCardPointer({ rig: state, ...position }).then(sample => {
      if (disposed || paused || !pointerInside || ticket !== pointerTicket || generation !== epoch) return;
      pointerPosition = position; targetX = sample.tiltX; targetY = sample.tiltY; schedule();
    }, report);
  };
  const release = (): void => { ++pointerTicket; pointerInside = false; pointerPosition = undefined; targetX = targetY = 0; schedule(); };
  const activate = (): boolean => {
    if (disposed || paused || !initialized || actionStart !== undefined) return false;
    if (reduced.matches) { finish(); void paint(); return true; }
    actionStart = performance.now(); runningAngle = 0; actionProgress = 0; sampleTurn(actionStart); schedule(); return true;
  };
  const nestedControl = (event: Event): boolean => {
    const target = event.target as Element | null;
    return Boolean(target && target !== surface && target !== element && target.closest?.("button,a,input,select,textarea,[contenteditable]:not([contenteditable=false])"));
  };
  const click = (event: MouseEvent): void => { if (event.button === 0 && !nestedControl(event)) activate(); };
  const key = (event: KeyboardEvent): void => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ") || nestedControl(event)) return;
    // Native buttons and links already emit click from keyboard activation.
    const target = event.target as Element | null;
    if (target?.matches?.("button,a,input,select,textarea,[contenteditable]")) return;
    if (activate()) event.preventDefault();
  };
  const reducedChange = (): void => {
    ++epoch; release(); ++idleTicket;
    if (reduced.matches) {
      if (actionStart !== undefined) finish();
      tiltX = tiltY = 0; void paint();
    } else { lastFrameMs = undefined; idleTarget(); schedule(); }
  };
  const visibility = (): void => {
    ++epoch;
    if (document.hidden) {
      paused = true; pauseAtMs = performance.now();
      if (raf) cancelAnimationFrame(raf); raf = 0;
    } else {
      if (actionStart !== undefined && pauseAtMs !== undefined) actionStart += performance.now() - pauseAtMs;
      paused = false; pauseAtMs = undefined; lastFrameMs = undefined;
      void paint(); idleTarget(); schedule();
    }
  };
  surface.addEventListener("pointermove", pointer);
  surface.addEventListener("pointerleave", release);
  surface.addEventListener("pointercancel", release);
  if (options.activateOnClick !== false) surface.addEventListener("click", click);
  if (options.activateOnKeys !== false) surface.addEventListener("keydown", key);
  reduced.addEventListener("change", reducedChange); finePointer.addEventListener("change", release);
  window.addEventListener("blur", release); document.addEventListener("visibilitychange", visibility);
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) if (entry.target === element) {
      const size = observedBorderBox(entry);
      if (size.width > 0 && size.height > 0) layoutSize = size;
    }
    ++epoch; void paint();
  });
  observer.observe(element, {box: "border-box"});
  const controller: CardController = {
    ready: Promise.resolve(false),
    async update(value) {
      const ticket = ++updateTicket;
      if (disposed || !isCardRig(value)) return false;
      const next = structuredClone(value);
      try { await projectCardPose({rig: { ...next, elementSize: layoutSize ?? next.elementSize }, view: next.rest ?? {}}); }
      catch (error) { if (ticket === updateTicket) report(error); return false; }
      if (disposed || ticket !== updateTicket) return false;
      if (!acquired) {
        if (perspectiveOwners.get(element) !== previousOwner || (back && perspectiveOwners.get(back) !== previousBackOwner)) { controller.dispose(); return false; }
        previousOwner?.dispose(); if (previousBackOwner !== previousOwner) previousBackOwner?.dispose();
        styles = captureStyles(); acquired = true;
        perspectiveOwners.set(element, controller); if (back) perspectiveOwners.set(back, controller);
      }
      ++epoch; ++pointerTicket; ++idleTicket; ++turnTicket;
      state = next; initialized = true; actionStart = undefined; runningAngle = 0; actionProgress = 0; pointerPosition = undefined;
      pointerInside = false; targetX = targetY = tiltX = tiltY = 0;
      const generation = epoch;
      const painted = await paint(true); idleTarget(); schedule();
      return !disposed && ticket === updateTicket && (painted || paused || generation !== epoch);
    },
    activate,
    getState: () => ({ tiltX, tiltY, turnAngle: completedAngle + runningAngle, face,
      revolutions: (completedAngle + runningAngle) / 360, actionActive: actionStart !== undefined, actionProgress, idleTimeMs, ...(pointerPosition ? {pointer: {...pointerPosition}} : {}) }),
    dispose() {
      if (disposed) return;
      disposed = true; ++epoch;
      if (raf) cancelAnimationFrame(raf); observer.disconnect();
      surface.removeEventListener("pointermove", pointer); surface.removeEventListener("pointerleave", release);
      surface.removeEventListener("pointercancel", release); surface.removeEventListener("click", click);
      surface.removeEventListener("keydown", key); reduced.removeEventListener("change", reducedChange);
      finePointer.removeEventListener("change", release); window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", visibility);
      for (const {node, properties} of styles) for (const p of properties) {
        if (p.owned === undefined || node.style.getPropertyValue(p.name) !== p.owned || node.style.getPropertyPriority(p.name)) continue;
        if (p.value) node.style.setProperty(p.name, p.value, p.priority); else node.style.removeProperty(p.name);
      }
      if (perspectiveOwners.get(element) === controller) perspectiveOwners.delete(element);
      if (back && perspectiveOwners.get(back) === controller) perspectiveOwners.delete(back);
    },
  };
  controller.ready = controller.update(rig);
  return controller;
}
