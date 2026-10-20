# Changelog

Figma package versions and Community publication are tracked separately. An
unreleased package entry describes source and packaged behavior, not marketplace
availability.

## Figma 0.6.0 — Unreleased

- The workspace strip keeps Perspective, Sizes, Depth, Templates,
  Composition, Mesh, Pin Warp, Lens & maps and Appearance directly available,
  with compact scrolling in narrow plugin windows.
- Appearance can apply and reopen editable native Glass and Paper recipes while
  preserving unrelated effects and native values that Worldbend does not own.
- Native Vector results support guarded in-place refresh, copy adoption and
  multi-result updates without overwriting vectors edited in Figma.
- Compatible Perspective Frame updates and source replacement preserve Figma
  Motion tracks; incompatible size changes are refused.
- PSD Smart Object import supports bounded curved-envelope projection while
  retaining explicit source and fidelity limits.
- Installed Agent workflows can inspect and continue native or linked work in
  the same file. Publications are revision-guarded; failed, cancelled and
  expired transfers preserve the previous artwork. Successful external changes
  are recovered by publishing a new guarded revision from retained prior inputs,
  not by claiming editor Undo.
- Processing remains local, without a Worldbend account or network permissions.

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
