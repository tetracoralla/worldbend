const profiles = Object.freeze({
  full: { crate: "worldbend-wasm", features: [] },
  figma: { crate: "worldbend-wasm", features: ["--no-default-features", "--features", "designer,spatial-effects,deformation-work-plan,motion"] },
  "psd-import": { crate: "worldbend-wasm", features: ["--no-default-features", "--features", "psd-import"] },
  perspective: { crate: "worldbend-perspective-wasm", features: [] },
  "surface-window": { crate: "worldbend-perspective-wasm", features: ["--features", "surface-window"] },
  effects: { crate: "worldbend-perspective-wasm", features: ["--features", "spatial-effects"] },
});

/** Shared by compilation and legal inventory; callers receive independent arrays. */
export function wasmProfile(name) {
  if (!Object.hasOwn(profiles, name)) throw new Error(`Unknown WASM carrier profile: ${name}`);
  const { crate, features } = profiles[name];
  return { crate, featureArguments: [...features], outputDirectory: `packages/wasm/${name === "full" ? "pkg" : `pkg-${name}`}` };
}

/** Every compressed module embedded by the Figma UI must enter its inventory. */
export const figmaWasmModules = Object.freeze([
  Object.freeze({ profile: "figma", virtualId: "virtual:worldbend-figma-wasm-gzip", bindingsAlias: "@worldbend/wasm-bindings", label: "Figma carrier" }),
  Object.freeze({ profile: "psd-import", virtualId: "virtual:worldbend-psd-import-wasm-gzip", bindingsAlias: "@worldbend/psd-import-bindings", label: "PSD import carrier" }),
]);
