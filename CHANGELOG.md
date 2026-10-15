# Changelog

## Figma 0.5.0 — 2026-10-15

Published as Community version 7.

- Perspective, free or symmetric corner distortion, Warp, Pin Warp, Mesh and
  Liquify retain saved controls for later edits.
- Free outlines retain the complete canvas across editing views and updates.
- Native Vector output preserves supported projected paths; text is outlined.
- Linked HD updates retain the chosen pixel dimensions and artwork size.
- Editable Frames use a pinned companion renderer and retain native content.
  Its sampled appearance requires effect availability and does not become
  projected SVG paths on native export.
- Result-only reopening supports updating the same result or creating another.
- Canvas working previews follow edits and are removed on Apply, Reset or close.
  Figma Undo can briefly restore a removed preview; delete it or continue editing.
- Sizes, Depth, Templates and Composition retain source relationships.
- Processing stays local, without a Worldbend account or network permissions.

The shared Rust, CLI, MCP, Web/WASM and receiving APIs remain experimental
0.1.0. Their implemented formats and support limits are documented in `docs/`.
