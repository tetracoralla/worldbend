/** Human labels never become renderer identities, filenames or selectors. */
export function normalizeCanvasOutputName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name)) return undefined;
  for (const character of name) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) return undefined;
  }
  return name;
}

export type CanvasOutputNames = Record<string, string>;

export function isCanvasOutputNames(value: unknown, ids: readonly string[]): value is CanvasOutputNames {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return entries.length <= ids.length && entries.every(([id, name]) =>
    ids.includes(id) && typeof name === "string" && normalizeCanvasOutputName(name) === name);
}
