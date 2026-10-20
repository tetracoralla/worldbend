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

## Status

Figma's supported Shader-authoring tools expose resources that the Plugin API
can import using the exact versioned id from `listAvailableShaders`. Apply it as a `ShaderPaint` in
the surface's fills. Native property assignments use property-definition ids,
not source names. This package does not claim Figma Community publication.
See [the supported authoring tools](https://developers.figma.com/docs/figma-mcp-server/generative-plugins-and-shaders/).

The canonical `worldbend.foil.rgba@0.1` kernel is owned by
`crates/worldbend-core/src/foil.wgsl`; this source and the Web receiving binding's
resource hash are mechanically projected by `scripts/generate-foil-kernel.mjs`.
The [Foil contract](../../../../docs/FOIL_CONTRACT.md) describes typed inspection,
revision and self-contained target delivery. The current source adds reflective
folds and mixes both color opacities. Shipping consumers need an explicit,
source-verified resource-acquisition mechanism. This package does not claim
Figma Community publication or mesh-gradient delivery through the Foil path.

`scripts/figma-shader-runtime-check.mjs` compiles this kernel on WebGPU and
checks its property surface, millisecond animation timing, stopped motion,
straight-alpha fills, both color opacities, flat-base and hidden-output behavior
before Figma compositing.
