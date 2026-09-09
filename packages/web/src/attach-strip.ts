import { projectPlaneStrip } from "./perspective-bridge";
import { latestFrame } from "./latest-frame";
import { observedBorderBox } from "./attach";
import { perspectiveOwners as owners } from "./binding-ownership";
import type { AttachPerspectiveOptions, Disposable } from "./attach";
import type { PlaneStripInput, PlaneStripOutput, Size, TransformSpecInput } from "./types";

export interface PerspectivePanel { id: string; element: HTMLElement; start: number; end: number }
export interface PerspectiveStripBinding extends Disposable {
  update(spec: TransformSpecInput): Promise<boolean>;
  getSpecs(): PlaneStripOutput["items"] | undefined;
}

/** Panels share a positioned container and start at its (0,0); CSS owns their source sizes. */
export function attachPerspectiveStrip(
  container: HTMLElement,
  panels: readonly PerspectivePanel[],
  initial: TransformSpecInput,
  options: AttachPerspectiveOptions = {},
): PerspectiveStripBinding {
  if (panels.length < 1 || panels.length > 32 || new Set(panels.map(panel => panel.element)).size !== panels.length || panels.some(panel => panel.element === container)) {
    throw new RangeError("A strip needs 1..32 distinct panel elements, separate from its container");
  }
  const members = panels.map(({ id, element, start, end }) => ({ id, element, start, end }));
  let spec = structuredClone(initial);
  for (const panel of members) owners.get(panel.element)?.dispose();
  const previous = members.map(({ element }) => ({ element, declarations: ["transform", "transform-origin"].map(name => ({
    name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
  })) }));
  const sizes = new Map<Element, Size>();
  let disposed = false;
  let last: PlaneStripOutput["items"] | undefined;
  const report = (error: unknown) => {
    if (options.onError) options.onError(error);
    else container.dispatchEvent(new CustomEvent("worldbenderror", { detail: error }));
  };
  const queue = latestFrame(async () => {
    const destinationSize = sizes.get(container);
    if (!destinationSize || destinationSize.width <= 0 || destinationSize.height <= 0) return undefined;
    if (members.some(({ element }) => !sizes.has(element) || sizes.get(element)!.width <= 0 || sizes.get(element)!.height <= 0)) return undefined;
    return projectPlaneStrip({ spec, destinationSize, panels: members.map(({ id, element, start, end }) => ({
      id, start, end, elementSize: sizes.get(element)!,
    })) as PlaneStripInput["panels"] });
  }, (result) => {
    // The complete core plan has succeeded. Apply all styles in one frame.
    for (let i = 0; i < members.length; i++) {
      const css = result.items[i]!.css;
      const element = members[i]!.element;
      element.style.setProperty("transform", css.transform);
      element.style.setProperty("transform-origin", css.transformOrigin);
    }
    last = structuredClone(result.items);
  }, report);
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) sizes.set(entry.target, observedBorderBox(entry));
    void queue.request();
  });
  observer.observe(container, { box: "border-box" });
  for (const { element } of members) observer.observe(element, { box: "border-box" });
  const binding: PerspectiveStripBinding = {
    update(value) {
      if (disposed) return Promise.resolve(false);
      try { spec = structuredClone(value); }
      catch (error) { return queue.reject(error); }
      return queue.request();
    },
    getSpecs() { return last ? structuredClone(last) : undefined; },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue.dispose();
      observer.disconnect();
      for (const { element, declarations } of previous) {
        for (const { name, value, priority } of declarations) {
          if (value) element.style.setProperty(name, value, priority);
          else element.style.removeProperty(name);
        }
        if (owners.get(element) === binding) owners.delete(element);
      }
    },
  };
  for (const { element } of members) owners.set(element, binding);
  return binding;
}
