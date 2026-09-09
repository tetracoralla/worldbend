/** Linkage-only boundary for unused live-Web exports of @worldbend/web. */
function unavailable(): never {
  throw JSON.stringify({code:"E_SCHEMA",message:"Live CSS perspective is not included in the Figma carrier"});
}
export { unavailable as css_json, unavailable as pose_json, unavailable as strip_json };
export default async function initialize(): Promise<never> { return unavailable(); }
