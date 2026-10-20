# Worldbend Mesh Gradient shader

Soft fluid four-corner mesh-gradient kernel for `worldbend.mesh-gradient@0.1`.
Corner colors blend across an editable loop with soft domain warp. The surface
is fully generated: no input texture is sampled. Output is straight RGBA under
Figma's Shader-fill contract. Frame time is milliseconds; duration and phase
are editable timing parameters so independent instances can run out of phase.

Designer parameters (native Shader properties):

| Property | Meaning | Range |
| --- | --- | --- |
| `visible` | Hides the effect entirely | boolean |
| `colorTl` / `colorTr` / `colorBl` / `colorBr` | Corner tints and alpha | color |
| `warp` | Soft fluid domain warp | 0–1 |
| `softness` | Corner falloff softness | 0–1 |
| `durationMs` | Loop duration | 100–60000 ms |
| `phaseMs` | Instance phase offset | 0–60000 ms |
| `flowSpeed` | Motion energy inside the loop | 0–2 |

## Status

Figma's supported Shader-authoring tools expose resources that the Plugin API
can import using the exact versioned id from `listAvailableShaders` /
`importShaderById`. Apply it as
a `ShaderPaint` in the surface's fills. Native property assignments use
property-definition ids, not source names. Product acquire, explicit adopt and
the common chooser do not embed caller import ids. This package does not claim
Figma Community publication or availability through the Rust MCP. See [the supported authoring tools](https://developers.figma.com/docs/figma-mcp-server/generative-plugins-and-shaders/).

The canonical `worldbend.mesh-gradient.rgba@0.1` kernel is owned by
`crates/worldbend-core/src/mesh_gradient.wgsl`; this source and the Web receiving
binding's resource hash are mechanically projected by
`scripts/generate-mesh-gradient-kernel.mjs`. See
[MESH_GRADIENT_CONTRACT.md](../../../../docs/MESH_GRADIENT_CONTRACT.md).
