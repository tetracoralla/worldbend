/** Native selective writes are adapters over the typed family's wire fields. */
export function validMaterialFields<T extends string>(fields: unknown, owned: readonly T[]): fields is T[] {
  return Array.isArray(fields) && fields.length > 0 && fields.length <= owned.length &&
    new Set(fields).size === fields.length && fields.every(field => owned.includes(field));
}

/** Compare validated flat material seeds without relying on JSON key order. */
export function sameMaterialSeed(
  left: { schema: string; version: string; recipeId: string; recipeVersion: number; material: object } | undefined,
  right: { schema: string; version: string; recipeId: string; recipeVersion: number; material: object },
): boolean {
  if (!left || left.schema !== right.schema || left.version !== right.version ||
      left.recipeId !== right.recipeId || left.recipeVersion !== right.recipeVersion) return false;
  const entries = (value: object) => Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries(left.material)) === JSON.stringify(entries(right.material));
}

export function materialProperty(field: string): string {
  return field.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
