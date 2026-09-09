# Photoshop-style transform roadmap

## Product direction

The human product should grow from a focused perspective adapter into a
Photoshop-familiar transform workspace without turning the default surface into
an always-open expert inspector. The Agent product should gain the same
operations through deterministic typed composition rather than asking a model
to derive matrices or meshes.

Photoshop's current Free Transform documentation defines one continuous
operation spanning scale, rotate, skew, distort, perspective, and an optional
switch into Warp:

- https://helpx.adobe.com/photoshop/using/free-transformations-images-shapes-paths.html
- https://helpx.adobe.com/photoshop/desktop/crop-resize-transform/transform-manipulate-reshape/transformation-options-in-adobe-photoshop.html
- https://helpx.adobe.com/photoshop/desktop/effects-filters/artistic-stylize-filters/reshape-and-distort-images-with-transform-warp.html

Adobe does not publish per-command usage telemetry. The priorities below are
therefore product judgments based on operation breadth, shortcut prominence,
repetition cost, recoverability, and the team's stated Photoshop mental model;
they must later be corrected with designer dogfood.

## Priority order

### P0 — the Free Transform backbone

1. Live preview, commit, cancel/reset, host Undo, and source preservation.
2. Proportional and non-proportional scale.
3. Arbitrary rotation, including exact numeric entry and common 90-degree use.
4. Free four-corner distort/corner pin and constrained perspective.
5. Horizontal and vertical skew.
6. Tight output bounds so rotation, scale, and skew are not clipped by the
   source rectangle.
7. Clear raster-output disclosure in Figma.

These operations form one cumulative transform. Adapters must not resample the
source after each intermediate adjustment.

### P1 — frequent production accelerators

1. Flip horizontal and vertical with explicit source-orientation semantics.
2. Quick rotate left/right by 90 degrees.
3. Transform Again / apply the last transform to another selected source.
4. Duplicate and transform while preserving the original.
5. Movable reference point and numeric X/Y placement.
6. Common Warp presets for graphic text and logos: Arc, Arch, Flag, Wave,
   Fish, Rise, Fisheye, Inflate, Squeeze, and Twist.

Preview zoom/pan/fit and plugin-local preview undo/redo were originally listed
as P1 accelerators; they are now part of the delivered backbone because direct
manipulation was not reliably usable without them.

Correction guides, stable live-camera outward dragging with eased post-release
recovery, and density-aware final source reacquisition are also delivered
backbone behavior. They change editing reachability and raster quality, not the
canonical transform model. Architecture-style straight-edge correction remains
part of the separate Perspective Warp/camera-correction capability.

### P2 — expert deformation

1. Custom 3x3, 4x4, 5x5, and bounded custom warp meshes.
2. Split Warp, multi-point selection, and Bezier handle modes.
3. Batch and preset libraries with explicit ordering and partial-failure
   semantics.
4. Editable-vector output where the transformation can be represented without
   fabricating fidelity.

### Separate capabilities, not hidden Free Transform modes

- Perspective Warp / camera or architecture correction;
- Puppet Warp;
- Liquify and brush deformation;
- lens correction and adaptive wide-angle correction;
- automatic subject, plane, edge, or vanishing-point detection.

These require different operation objects, validation, rendering, and recovery.
They may later share the product shell, but they must not silently overload the
homography or affine contract.

Ecosystem reach is an adapter strategy, not a reason to multiply product
models. Figma is the human plane-authoring and source-replacement surface;
Agent hosts compose, validate, and execute explicit intent at low context cost;
ComfyUI applies the same saved plane inside image-generation workflows. A
capability enters all compatible carriers only after its operation object and
core semantics exist. No carrier is allowed to reconstruct another carrier's
UI gestures or maintain a private transform implementation.

## Current implementation

See [PRODUCT_MODEL.md](PRODUCT_MODEL.md) for implemented capabilities and the
operation-family contracts for exact semantics. Past task records and local
validation evidence are retained in the ignored `.task-notes/` directory.

## Promotion gates

- P0 affine composition must match Rust, WASM/Web, Figma, ComfyUI, CLI, and MCP.
- A transform followed by Distort, and Distort followed by a transform, must be
  exercised as one sequence without an intermediate rasterization.
- Figma Apply and Replace must resize and reposition tight results atomically
  and remain one host Undo step.
- P1 flip cannot ship by silently reversing destination corner order; it needs
  explicit source-orientation data shared by human and Agent renderers.
- Warp cannot ship as adapter-only math. A bounded mesh model and renderer must
  be owned below Web/Figma/ComfyUI/CLI/MCP.
- Rectification cannot ship as Agent-inferred corners or adapter-local reverse
  perspective. Source corners and output dimensions are explicit contract
  inputs, and every carrier consumes the core plan.
- Comfy batch or video cannot ship as an implicit loop over the single-image
  node; its sequence contract and cumulative limits must exist first.
- Designer dogfood must test at least: screen placement, rotated poster, skewed
  label, repeated package face, arced logo, and source replacement.
