// Language settings popover: open/close, outside-pointer dismissal, menu
// keyboard semantics, and preference selection. Text localization stays with
// the caller's applyLocale pass.

import { isLocalePreference, type LocalePreference } from "./i18n";

export interface OptionsMenuView {
  applyCheckedState(preference: LocalePreference): void;
}

export function createLocaleView(refs: {
  moreOptionsButton: HTMLButtonElement;
  settingsPopover: HTMLDivElement;
  menuButtons: HTMLButtonElement[];
  localeButtons: HTMLButtonElement[];
  onSelectPreference(preference: LocalePreference): void;
}): OptionsMenuView {
  const { moreOptionsButton, settingsPopover, menuButtons, localeButtons } = refs;
  moreOptionsButton.addEventListener("click", () => {
    if (settingsPopover.hidden) open();
    else close(true);
  });
  for (const button of localeButtons) {
    button.addEventListener("click", () => {
      const preference = button.dataset.locale;
      if (!isLocalePreference(preference)) return;
      refs.onSelectPreference(preference);
      close(true);
    });
  }
  settingsPopover.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[role^='menuitem']");
    if (button && !button.dataset.locale) close(true);
  });
  document.addEventListener("pointerdown", (event) => {
    if (
      !settingsPopover.hidden &&
      event.target instanceof Node &&
      !settingsPopover.contains(event.target) &&
      !moreOptionsButton.contains(event.target)
    ) {
      close(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (settingsPopover.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const enabled = menuButtons.filter((button) => !button.disabled && !button.hidden);
    const currentIndex = enabled.findIndex((button) => button === document.activeElement);
    const nextIndex = nextMenuIndex(currentIndex, event.key, enabled.length);
    if (nextIndex !== undefined) enabled[nextIndex]?.focus();
  });

  function open(): void {
    settingsPopover.hidden = false;
    moreOptionsButton.setAttribute("aria-expanded", "true");
    menuButtons.find((button) => !button.disabled && !button.hidden)?.focus();
  }

  function close(restoreFocus: boolean): void {
    if (settingsPopover.hidden) return;
    settingsPopover.hidden = true;
    moreOptionsButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) moreOptionsButton.focus();
  }

  return {
    applyCheckedState(preference) {
      for (const button of localeButtons) {
        button.setAttribute("aria-checked", String(button.dataset.locale === preference));
      }
    },
  };
}

/** Standard wrapping menu navigation over the currently enabled items. */
export function nextMenuIndex(
  current: number,
  key: string,
  count: number,
): number | undefined {
  if (count <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return undefined;
}
