/**
 * Material runtime entry: the native appearance families (Glass and texture)
 * without the document publishers. Prepared requests embed only the variant
 * they call. Never import this from plugin UI code.
 */
export {
  applyAppearance,
  applyTexture,
  inspectAppearance,
  inspectTexture,
} from "./agent-handoff";
