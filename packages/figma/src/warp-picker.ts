import { buildWarpMesh, type WarpPreset } from "@worldbend/web";
import { meshPreview } from "./shape-preview";

/** A visual view of the existing select: one value, event and history path. */
export function createWarpPicker(select: HTMLSelectElement, label: HTMLLabelElement) {
  const root = document.createElement("div");
  root.className = "warp-picker";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.id = "warp-picker-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", "warp-picker-options");
  const panel = document.createElement("div");
  panel.id = "warp-picker-options";
  panel.className = "warp-picker-options";
  panel.setAttribute("role", "dialog");
  panel.hidden = true;
  const options = Array.from(select.options);
  const buttons = options.map(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.warpPreset = option.value;
    const name = document.createElement("span");
    name.textContent = option.textContent;
    button.append(name);
    button.addEventListener("click", () => {
      if (select.disabled) return;
      select.value = option.value;
      close(true);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      sync();
    });
    panel.append(button);
    return button;
  });
  root.append(trigger, panel);
  select.after(root);
  select.hidden = true;
  label.htmlFor = trigger.id;
  let loaded = false;
  async function load() {
    if (loaded) return;
    loaded = true;
    // Fixed representative amount, bounded to the eleven existing presets.
    // Compute only on first opening; no source pixels or extra GL contexts.
    for (const [index, option] of options.entries()) {
      try {
        const mesh = await buildWarpMesh({ preset: (option.value || "arc") as WarpPreset, amount: option.value ? 0.5 : 0 });
        buttons[index]!.querySelector("svg")?.remove();
        buttons[index]!.prepend(meshPreview(mesh));
      } catch { loaded = false; break; } // Names remain usable if previews fail.
    }
  }
  function close(focus = false) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus();
  }
  function sync() {
    trigger.disabled = select.disabled;
    trigger.textContent = select.selectedOptions[0]?.textContent ?? "";
    trigger.setAttribute("aria-label", `${label.textContent}: ${trigger.textContent}`);
    panel.setAttribute("aria-label", label.textContent ?? "");
    for (const [index, button] of buttons.entries()) {
      button.querySelector("span")!.textContent = options[index]!.textContent;
      button.setAttribute("aria-pressed", String(select.value === options[index]!.value));
      button.tabIndex = select.value === options[index]!.value ? 0 : -1;
    }
    if (select.disabled) close();
  }
  trigger.addEventListener("click", () => {
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const rect = trigger.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - Math.min(360, innerWidth - 16) - 8))}px`;
    panel.style.top = `${rect.bottom + 4}px`;
    panel.style.maxHeight = `${Math.max(80, innerHeight - rect.bottom - 12)}px`;
    buttons[select.selectedIndex]?.focus();
    void load();
  });
  panel.addEventListener("keydown", event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : delta === undefined ? undefined : (index + delta + buttons.length) % buttons.length;
    if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
  });
  document.addEventListener("pointerdown", event => { if (!root.contains(event.target as Node)) close(); });
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget as Node | null)) close(); });
  window.addEventListener("resize", () => close());
  sync();
  return { sync, close };
}
