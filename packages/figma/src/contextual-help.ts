import { visibleViewportSize } from "./host-visible-viewport";

let nextHelpId = 0;

/** Local help that stays out of the working layout, with pointer and keyboard access. */
export function createContextualHelp(input: { content?: HTMLElement; interactive?: boolean } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "contextual-help";
  button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .2c0 1.6-2.5 1.8-2.5 3.8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="16.5" r=".8" fill="currentColor"/></svg>';
  const panel = document.createElement("div");
  panel.id = `contextual-help-${++nextHelpId}`;
  panel.className = "contextual-help-panel";
  panel.setAttribute("role", input.interactive ? "dialog" : "tooltip");
  panel.hidden = true;
  if (input.content) panel.append(input.content);
  document.body.append(panel);
  button.setAttribute("aria-describedby", panel.id);
  if (input.interactive) button.setAttribute("aria-haspopup", "dialog");
  let pinned = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  function cancelClose(): void { clearTimeout(closeTimer); }
  function position(): void {
    if (panel.hidden) return;
    const anchor = button.getBoundingClientRect();
    const { width: innerWidth, height: innerHeight } = visibleViewportSize();
    panel.style.maxHeight = `${Math.max(0, innerHeight - 16)}px`;
    panel.style.maxWidth = `${Math.min(320, Math.max(0, innerWidth - 16))}px`;
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(anchor.right - box.width, innerWidth - box.width - 8))}px`;
    const above = anchor.top - box.height - 8;
    panel.style.top = `${Math.max(8, above >= 8 ? above : Math.min(anchor.bottom + 8, innerHeight - box.height - 8))}px`;
  }
  function open(): void {
    if (button.hidden || button.disabled || !button.isConnected) return;
    cancelClose();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    position();
  }
  function close(): void {
    cancelClose();
    pinned = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
  function scheduleClose(): void {
    cancelClose();
    closeTimer = setTimeout(() => {
      if (!pinned && !panel.matches(":hover") && !button.matches(":hover") &&
          !panel.contains(document.activeElement) && document.activeElement !== button) close();
    }, 120);
  }
  button.addEventListener("pointerenter", open);
  button.addEventListener("pointerleave", scheduleClose);
  button.addEventListener("focus", open);
  button.addEventListener("blur", scheduleClose);
  button.addEventListener("click", () => {
    if (pinned) close();
    else { pinned = true; open(); }
  });
  panel.addEventListener("pointerenter", cancelClose);
  panel.addEventListener("pointerleave", scheduleClose);
  panel.addEventListener("focusin", open);
  panel.addEventListener("focusout", scheduleClose);
  function dismiss(event: PointerEvent): void {
    if (!button.contains(event.target as Node) && !panel.contains(event.target as Node)) close();
  }
  function keydown(event: KeyboardEvent): void {
    if (panel.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      const focusInside = panel.contains(document.activeElement);
      close();
      if (focusInside) { button.focus(); close(); }
    } else if (event.key === "Tab" && input.interactive && document.activeElement === button && !event.shiftKey) {
      const first = panel.querySelector<HTMLElement>('button:not([hidden]):not(:disabled), a[href], [tabindex="0"]');
      if (first) { event.preventDefault(); first.focus(); }
    } else if (event.key === "Tab" && panel.contains(document.activeElement)) {
      event.preventDefault();
      const candidates = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')]
        .filter(element => !panel.contains(element) && element.getClientRects().length > 0);
      const index = candidates.indexOf(button);
      const next = event.shiftKey ? button : candidates[index + 1] ?? candidates[0];
      close(); next?.focus();
    }
  }
  function reposition(): void { if (!button.getClientRects().length) close(); else position(); }
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", keydown, true);
  window.addEventListener("resize", reposition);
  document.addEventListener("host-visible-resize", reposition);
  document.addEventListener("scroll", reposition, true);
  return {
    button, panel, open, close,
    setCopy(label: string, text?: string) {
      button.setAttribute("aria-label", label);
      panel.setAttribute("aria-label", label);
      if (text !== undefined) panel.textContent = text;
      position();
    },
    dispose() {
      close(); panel.remove(); button.remove();
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("host-visible-resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    },
  };
}
