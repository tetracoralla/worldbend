# Worldbend Foil shader

Procedural liquid-metal/foil kernel for the `worldbend.foil` material
family. Bands of light flow along the light direction across an fbm-distorted
field, shading broad reflective faces and narrow fold glints between the base
and highlight tint. The surface is fully generated: no input texture is sampled,
and output is straight RGBA under Figma's Shader-fill contract. Frame time is
milliseconds, converted to seconds for the flow speed. This is a procedural
metallic pattern; it does not sample an environment or simulate physical
reflections from the containing scene.

Designer parameters (native Shader properties, editable in Figma's own panel):

| Property | Meaning | Range |
| --- | --- | --- |
| `visible` | Hides the effect entirely | boolean |
| `baseColor` | Base metal tint and alpha | color |
| `highlightColor` | Fold highlight tint and opacity | color |
| `lightAngle` | Direction the bands flow along | 0–360° |
| `intensity` | Highlight strength | 0–1 |
| `roughness` | Noise warp of the bands | 0–1 |
| `flowSpeed` | Animation speed of the flow | 0–2 |

## Integration

The canonical `worldbend.foil.rgba@0.1` kernel lives in
`crates/worldbend-core/src/foil.wgsl`. `scripts/generate-foil-kernel.mjs`
projects the Figma source and Web kernel. See the
[Foil contract](../../../../docs/FOIL_CONTRACT.md) for typed inspection,
revision and self-contained receiving delivery.

This source directory does not install a Figma account-library resource.
Consumers must acquire an exact compatible resource through a supported host
route before assigning a ShaderPaint. Community publication is separate.

`scripts/figma-shader-runtime-check.mjs` verifies the kernel and its property
surface, timing, stopped motion, straight alpha and both color opacities.
