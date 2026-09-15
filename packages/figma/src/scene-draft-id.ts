const TOKEN_PATTERN = /^[a-z0-9-]{12,96}$/;

export type RandomValuesSource = (values: Uint32Array<ArrayBuffer>) => void;

/** Create an unguessable per-invocation id in the browser-backed UI realm. */
export function createSceneDraftToken(fillRandomValues: RandomValuesSource): string {
  const values = new Uint32Array(new ArrayBuffer(4 * Uint32Array.BYTES_PER_ELEMENT));
  fillRandomValues(values);
  return Array.from(values, (value) => value.toString(36).padStart(7, "0")).join("-");
}

export function isSceneDraftToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
