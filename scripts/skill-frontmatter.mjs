import { normalizeLineEndings } from "./text-normalization.mjs";

export function skillFrontmatter(markdown) {
  return normalizeLineEndings(markdown).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? null;
}
