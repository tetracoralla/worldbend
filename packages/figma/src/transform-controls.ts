// Transform-mode input surface: slider/numeric wiring, the scale link, and
// the recipe parsing that turns typed values into a core TransformRecipe.
// Geometry stays in the Rust core via the WASM bridge; this module only
// parses, clamps the visual slider domain, and decides when to re-compose.

import { identityTransformRecipe, type TransformRecipe } from "@worldbend/web";
import { userMessage } from "./i18n";
import { sliderProgress, sliderValueForNumber } from "./slider-domain";

const MIN_SCALE_RATIO = 0.001;
const MAX_SCALE_RATIO = 10;
const MAX_ABS_SKEW_DEGREES = 89;

export interface TransformInputValues {
  scaleX: string;
  scaleY: string;
  rotation: string;
  skewX: string;
  skewY: string;
}

/** Parse typed values into a recipe; throws the invalidTransform user message. */
export function recipeFromValues(values: TransformInputValues): TransformRecipe {
  const scaleX = parseTransformValue(values.scaleX) / 100;
  const scaleY = parseTransformValue(values.scaleY) / 100;
  const rotationDegrees = parseTransformValue(values.rotation);
  const skewXDegrees = parseTransformValue(values.skewX);
  const skewYDegrees = parseTransformValue(values.skewY);
  if (
    scaleX < MIN_SCALE_RATIO ||
    scaleX > MAX_SCALE_RATIO ||
    scaleY < MIN_SCALE_RATIO ||
    scaleY > MAX_SCALE_RATIO ||
    Math.abs(skewXDegrees) >= MAX_ABS_SKEW_DEGREES ||
    Math.abs(skewYDegrees) >= MAX_ABS_SKEW_DEGREES
  ) {
    throw userMessage("invalidTransform");
  }
  return {
    ...identityTransformRecipe(),
    scale: { x: scaleX, y: scaleY },
    rotationDegrees,
    skew: { xDegrees: skewXDegrees, yDegrees: skewYDegrees },
  };
}

/** Whether the current typed values form a composable recipe. */
export function valuesComposeCleanly(values: TransformInputValues): boolean {
  try {
    recipeFromValues(values);
    return true;
  } catch {
    return false;
  }
}

function parseTransformValue(text: string): number {
  const value = Number(text);
  if (text.trim().length === 0 || !Number.isFinite(value)) {
    throw userMessage("invalidTransform");
  }
  return value;
}

interface ControlPair {
  numberInput: HTMLInputElement;
  slider: HTMLInputElement;
}

export interface TransformControls {
  recipeFromInputs(): TransformRecipe;
  inputsComposeCleanly(): boolean;
  currentValues(): TransformInputValues;
  /** Set field values programmatically (canvas gestures) without re-composing. */
  setValues(values: TransformInputValues): void;
  reset(): void;
  setDisabled(disabled: boolean): void;
  isScaleLinked(): boolean;
  toggleScaleLink(): void;
}

export function createTransformControls(refs: {
  scaleX: ControlPair;
  scaleY: ControlPair;
  rotation: ControlPair;
  skewX: ControlPair;
  skewY: ControlPair;
  scaleLinkButton: HTMLButtonElement;
  onRecipeChange(): void;
  onScaleLinkChange(): void;
  /** Fired when a slider release or field commit finishes an adjustment. */
  onRecipeCommit?(): void;
}): TransformControls {
  const pairs = [refs.scaleX, refs.scaleY, refs.rotation, refs.skewX, refs.skewY];
  const canonicalValues = new Map(
    pairs.map((pair) => [pair.numberInput, pair.numberInput.value] as const),
  );
  let scaleLinked = true;
  let lastSignature = signature();
  let lastCommitSignature = lastSignature;

  for (const pair of pairs) {
    pair.numberInput.addEventListener("input", () => handleNumberInput(pair, false));
    pair.numberInput.addEventListener("change", () => {
      handleNumberInput(pair, true);
      commitIfChanged();
    });
    pair.slider.addEventListener("input", () => handleSliderInput(pair));
    pair.slider.addEventListener("change", () => {
      handleSliderInput(pair);
      commitIfChanged();
    });
    pair.numberInput.addEventListener("focus", () => {
      pair.numberInput.value = canonicalValue(pair);
    });
    pair.numberInput.addEventListener("blur", () => {
      pair.numberInput.value = displayValue(canonicalValue(pair));
    });
    syncSliderToNumber(pair);
  }
  refs.scaleLinkButton.addEventListener("click", toggleScaleLink);

  function commitIfChanged(): void {
    const next = signature();
    if (next === lastCommitSignature) return;
    lastCommitSignature = next;
    refs.onRecipeCommit?.();
  }

  function currentValues(): TransformInputValues {
    return {
      scaleX: canonicalValue(refs.scaleX),
      scaleY: canonicalValue(refs.scaleY),
      rotation: canonicalValue(refs.rotation),
      skewX: canonicalValue(refs.skewX),
      skewY: canonicalValue(refs.skewY),
    };
  }

  function handleSliderInput(pair: ControlPair): void {
    setControlValue(pair, pair.slider.value);
    updateRangeVisual(pair.slider);
    valueChanged(pair.numberInput);
  }

  function handleNumberInput(pair: ControlPair, committed: boolean): void {
    canonicalValues.set(pair.numberInput, pair.numberInput.value);
    syncSliderToNumber(pair);
    // Intermediate typing states (an emptied field, a lone "0" mid-entry)
    // stay quiet; parse and range failures surface once the field commits
    // on change/blur.
    if (!committed && !valuesComposeCleanly(currentValues())) return;
    valueChanged(pair.numberInput);
  }

  function valueChanged(input: HTMLInputElement): void {
    if (scaleLinked && input === refs.scaleX.numberInput) {
      setControlValue(refs.scaleY, canonicalValue(refs.scaleX));
    }
    if (scaleLinked && input === refs.scaleY.numberInput) {
      setControlValue(refs.scaleX, canonicalValue(refs.scaleY));
    }
    const next = signature();
    if (next === lastSignature) return;
    lastSignature = next;
    refs.onRecipeChange();
  }

  function toggleScaleLink(): void {
    scaleLinked = !scaleLinked;
    if (scaleLinked) {
      const before = signature();
      setControlValue(refs.scaleY, canonicalValue(refs.scaleX));
      const next = signature();
      lastSignature = next;
      lastCommitSignature = next;
      if (next !== before) {
        refs.onRecipeChange();
        refs.onRecipeCommit?.();
      }
    }
    refs.onScaleLinkChange();
  }

  function signature(): string {
    return [
      canonicalValue(refs.scaleX),
      canonicalValue(refs.scaleY),
      canonicalValue(refs.rotation),
      canonicalValue(refs.skewX),
      canonicalValue(refs.skewY),
    ].join("\u0000");
  }

  function setControlValue(pair: ControlPair, value: string): void {
    canonicalValues.set(pair.numberInput, value);
    pair.numberInput.value = document.activeElement === pair.numberInput ? value : displayValue(value);
    syncSliderToNumber(pair);
  }

  function canonicalValue(pair: ControlPair): string {
    return canonicalValues.get(pair.numberInput) ?? pair.numberInput.value;
  }

  function syncSliderToNumber(pair: ControlPair): void {
    const minimum = Number(pair.slider.min);
    const maximum = Number(pair.slider.max);
    pair.slider.value = String(
      sliderValueForNumber(canonicalValue(pair), minimum, maximum, Number(pair.slider.value)),
    );
    updateRangeVisual(pair.slider);
  }

  function updateRangeVisual(slider: HTMLInputElement): void {
    const minimum = Number(slider.min);
    const maximum = Number(slider.max);
    const value = Number(slider.value);
    slider.style.setProperty("--range-progress", `${sliderProgress(value, minimum, maximum)}%`);
  }

  return {
    recipeFromInputs: () => recipeFromValues(currentValues()),
    inputsComposeCleanly: () => valuesComposeCleanly(currentValues()),
    currentValues,
    setValues(values: TransformInputValues) {
      setControlValue(refs.scaleX, values.scaleX);
      setControlValue(refs.scaleY, values.scaleY);
      setControlValue(refs.rotation, values.rotation);
      setControlValue(refs.skewX, values.skewX);
      setControlValue(refs.skewY, values.skewY);
      // Programmatic updates (canvas gestures) commit history through their
      // own gesture-end path; a later no-op change event must not re-commit.
      lastSignature = signature();
      lastCommitSignature = lastSignature;
    },
    reset() {
      setControlValue(refs.scaleX, "100");
      setControlValue(refs.scaleY, "100");
      setControlValue(refs.rotation, "0");
      setControlValue(refs.skewX, "0");
      setControlValue(refs.skewY, "0");
      lastSignature = signature();
      lastCommitSignature = lastSignature;
    },
    setDisabled(disabled: boolean) {
      for (const pair of pairs) {
        pair.numberInput.disabled = disabled;
        pair.slider.disabled = disabled;
      }
      refs.scaleLinkButton.disabled = disabled;
    },
    isScaleLinked: () => scaleLinked,
    toggleScaleLink,
  };
}

function displayValue(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return String(Math.round(number * 10) / 10);
}
