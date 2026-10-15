# Material thumbnails

These JPEGs are first-party swatches rendered with native Figma Glass,
NOISE and TEXTURE presets. Their source artwork uses only colored primitives,
line patterns and editable Inter text. They contain no third-party photographs
or borrowed demonstration assets and are covered by the repository's Apache-2.0
license. Inter is used in the rendered samples; no font files are distributed.

Swatches are discovery cues. The chooser renders the selected artwork separately
through the native host. To regenerate, use each corresponding built-in preset
in `appearance-wire.ts` or `texture-wire.ts` on the same comparable sample,
export at 180×130 and encode JPEG at quality80. Clear lens uses recipe v2.

The three Foil JPEGs render the current `worldbend.foil.rgba@0.1` recipes from
`foil-material-wire.ts` through the canonical source MCP delivery and WebGPU
receiver, at 180×130 and time 1.5 seconds, composited on white and encoded at
quality80. They contain only first-party procedural material and precede Figma
paint composition. Regenerate with
`node scripts/render-foil-thumbnails.mjs` after building the source MCP and Web
receiver. They do not establish native resource acquisition or adoption.

The three mesh-gradient JPEGs render the current `worldbend.mesh-gradient.rgba@0.1`
recipes from `mesh-gradient-material-wire.ts` through `mesh_gradient_delivery`
and the WebGPU receiver, at 180×130, seek 1500 ms, composited on white and
encoded at quality 80. They contain only first-party procedural material and
precede Figma paint composition. Regenerate with
`node scripts/render-mesh-gradient-thumbnails.mjs` after building the source MCP
and Web receiver. They do not publish a Community Shader or embed account ids.
