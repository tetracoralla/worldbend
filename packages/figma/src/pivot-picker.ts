import type { Point } from "@worldbend/web";

const GRID_COLUMNS = 3;
const PIVOT_PRESET_EPSILON = 1.0e-9;

export interface PivotPicker {
  buttons: HTMLButtonElement[];
  setValue(pivot: Point): void;
  setDisabled(disabled: boolean): void;
  setLabelFormatter(formatter: (button: HTMLButtonElement) => string): void;
}

/** Nine spatial presets with one keyboard tab stop and grid arrow movement. */
export function createPivotPicker(input: {
  container: HTMLElement;
  onSelect(pivot: Point): void;
}): PivotPicker {
  const buttons = Array.from(
    input.container.querySelectorAll<HTMLButtonElement>("[data-pivot]"),
  );
  let value: Point = { x: 0.5, y: 0.5 };
  let labelFormatter: ((button: HTMLButtonElement) => string) | undefined;
  let disabledState: boolean | undefined;

  for (const [index, button] of buttons.entries()) {
    button.addEventListener("click", () => selectIndex(index));
    button.addEventListener("keydown", (event) => {
      const next = nextPivotIndex(index, event.key, buttons.length);
      if (next === undefined) return;
      event.preventDefault();
      buttons[next]?.focus();
      selectIndex(next);
    });
  }
  render();

  function selectIndex(index: number): void {
    const pivot = pivotFromButton(buttons[index]);
    if (!pivot) return;
    value = pivot;
    render();
    input.onSelect({ ...pivot });
  }

  function render(): void {
    const focusIndex = closestPivotIndex(buttons, value);
    for (const [index, button] of buttons.entries()) {
      const pivot = pivotFromButton(button);
      const selected = Boolean(pivot && pivotMatchesPreset(pivot, value));
      const pressed = String(selected);
      if (button.getAttribute("aria-pressed") !== pressed) {
        button.setAttribute("aria-pressed", pressed);
      }
      const tabIndex = index === focusIndex ? 0 : -1;
      if (button.tabIndex !== tabIndex) button.tabIndex = tabIndex;
      if (labelFormatter) {
        const label = labelFormatter(button);
        if (button.getAttribute("aria-label") !== label) button.setAttribute("aria-label", label);
      }
    }
  }

  return {
    buttons,
    setValue(pivot) {
      if (pivot.x === value.x && pivot.y === value.y) return;
      value = { ...pivot };
      render();
    },
    setDisabled(disabled) {
      if (disabledState === disabled) return;
      disabledState = disabled;
      for (const button of buttons) button.disabled = disabled;
    },
    setLabelFormatter(formatter) {
      labelFormatter = formatter;
      render();
    },
  };
}

export function pivotMatchesPreset(candidate: Point, value: Point): boolean {
  return (
    Math.abs(candidate.x - value.x) <= PIVOT_PRESET_EPSILON &&
    Math.abs(candidate.y - value.y) <= PIVOT_PRESET_EPSILON
  );
}

export function nextPivotIndex(
  current: number,
  key: string,
  count = 9,
): number | undefined {
  if (count <= 0 || current < 0 || current >= count) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const row = Math.floor(current / GRID_COLUMNS);
  const column = current % GRID_COLUMNS;
  const rowCount = Math.ceil(count / GRID_COLUMNS);
  if (key === "ArrowLeft") return row * GRID_COLUMNS + (column + GRID_COLUMNS - 1) % GRID_COLUMNS;
  if (key === "ArrowRight") return row * GRID_COLUMNS + (column + 1) % GRID_COLUMNS;
  if (key === "ArrowUp") return ((row + rowCount - 1) % rowCount) * GRID_COLUMNS + column;
  if (key === "ArrowDown") return ((row + 1) % rowCount) * GRID_COLUMNS + column;
  return undefined;
}

function pivotFromButton(button: HTMLButtonElement | undefined): Point | undefined {
  const [x, y] = button?.dataset.pivot?.split(",") ?? [];
  const pivot = { x: Number(x), y: Number(y) };
  return Number.isFinite(pivot.x) && Number.isFinite(pivot.y) ? pivot : undefined;
}

function closestPivotIndex(buttons: HTMLButtonElement[], pivot: Point): number {
  let closest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, button] of buttons.entries()) {
    const candidate = pivotFromButton(button);
    if (!candidate) continue;
    const nextDistance = Math.hypot(candidate.x - pivot.x, candidate.y - pivot.y);
    if (nextDistance < distance) {
      closest = index;
      distance = nextDistance;
    }
  }
  return closest;
}
