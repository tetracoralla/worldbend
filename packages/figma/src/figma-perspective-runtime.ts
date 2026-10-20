/** Figma exposes only CSS emission and the interactive-card samplers from the
 * live-perspective bridge. Plane pose and shared strips have no product
 * surface in this carrier; the card workspace is the card family's surface. */
export {
  default,
  card_idle_json,
  card_pointer_json,
  card_pose_json,
  card_turn_json,
  css_json,
} from "./figma-wasm-runtime";

function unavailable(): never {
  throw JSON.stringify({ code: "E_SCHEMA", message: "Live plane projection is not included in the Figma carrier" });
}

export { unavailable as pose_json, unavailable as strip_json };
