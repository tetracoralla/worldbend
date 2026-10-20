export function sliderValueForNumber(
  valueText: string,
  minimum: number,
  maximum: number,
  current: number,
): number {
  const value = Number(valueText);
  if (valueText.trim().length === 0 || !Number.isFinite(value)) return current;
  return Math.min(maximum, Math.max(minimum, value));
}

export function sliderProgress(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return 0;
  }
  if (maximum <= minimum) return 0;
  return Math.min(100, Math.max(0, ((value - minimum) / (maximum - minimum)) * 100));
}
