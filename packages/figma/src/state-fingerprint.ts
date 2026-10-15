/** Compact fingerprint over every UTF-16 code unit, including state length. */
export function fingerprintState(state: string) {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < state.length; index += 1) {
    const code = state.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193) >>> 0;
    right = Math.imul(right ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `hash32x2:${state.length}:${left.toString(16).padStart(8, "0")}${right.toString(16).padStart(8, "0")}`;
}

export function figmaError(code: string, message: string) {
  return Error(`E_FIGMA_${code}: ${message}`);
}
