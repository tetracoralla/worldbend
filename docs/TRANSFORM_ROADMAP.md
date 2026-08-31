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

## Current productized slice

The current slice adds a deterministic affine-composition operation over an
existing `TransformSpec`: scale X/Y, clockwise rotation, skew X/Y, translation,
and a normalized pivot. The core returns one tight, normalized TransformSpec,
the unclipped raw quad, output canvas origin and size, and diagnostics.

The Figma UI exposes scale, rotation, and skew as a compact Transform mode with
live coarse sliders paired with 0.1-unit numeric entry. Slider ranges cover the
frequent working domain while typed values retain the wider safe domain. The
existing four-corner editor remains Distort mode. Switching modes bakes the
current preview into the next operation without rasterizing. Apply remains the
only rasterization boundary and is labeled accordingly.

### Production accelerators segment (2026-08-23)

The P1 production accelerators are implemented, in the owner's stated order:

- explicit horizontal/vertical flip through a real source-orientation
  contract: `content.orientation` on the TransformSpec (optional, `native`
  omitted on the wire) and `flip: {x, y}` on `TransformRecipe`. The core
  solves the homography from orientation-mirrored source corners, so native
  render, WebGL, CSS, CLI (`--flip-x`/`--flip-y`), and MCP compose all
  produce mirrored results without touching renderer code, and the
  destination quad/canvas/affine matrix stay byte-identical with and without
  a flip. Figma exposes flips as checkable menu actions and the stored plane
  round-trips orientation;
- 90-degree clockwise/counter-clockwise and 180-degree menu rotations that
  wrap the angle field into the signed half turn;
- Transform Again: the complete initial/final frame of the last successfully
  applied result is remembered per session and rebased to the current source.
  Failed, cancelled, or stale Apply attempts never replace that memory, and a
  cumulative Transform/Distort result replays as one operation rather than
  reconstructing only the last visible fields;
- Apply as New Image: an apply variant that always publishes a fresh
  rectangle and never replaces an existing pair result;
- a canvas-draggable reference point plus a nine-position keyboard-navigable
  preset picker (the recipe pivot), and folded X/Y result-placement fields
  whose typed deltas convert into recipe translation through the base frame's
  placement scale. Changing the reference point compensates translation so
  the existing output does not jump.

All low-frequency actions live in the keyboard-navigable `...` menu or behind
the compact Placement disclosure. Flip checks follow the effective composed
orientation, including after mode baking. The default surface therefore stays
focused on sliders and the preview instead of becoming a permanent inspector.

### Free Transform backbone segment (2026-08-23)

The first canvas-manipulation milestone is implemented and green across the
repository checks:

- direct canvas manipulation in Transform mode: drag inside the plane to move,
  drag corner handles to scale both axes, drag edge handles to scale one axis,
  and drag beyond the plane outline to rotate around the recipe pivot. Shift
  toggles uniform corner scaling against the scale-link state and snaps
  rotation to the 15-degree grid; free rotation gently snaps within 3 degrees
  of quarter turns. Pointer-to-recipe math lives in the Figma adapter
  (`recipe-gestures.ts`) over the core's composed affine matrix, so no second
  transform model exists;
- explicit Free and Perspective sub-modes inside Distort. Free moves only the
  dragged corner; Perspective captures the first dominant physical axis after
  a small dead zone. Horizontal drag moves only the dragged corner and its
  same-row partner symmetrically; vertical drag moves only the dragged corner
  and its same-column partner symmetrically. The other two corners stay fixed.
  Shift
  temporarily selects the other sub-mode, so either workflow remains a
  one-gesture operation. Destination coordinates are not clipped to the source
  unit square: dragging outward expands a presentation-only workspace around
  the unchanged source reference rectangle, while the viewport compensates the
  workspace origin to keep that reference rectangle registered. Tight output
  reframing happens only when applying or leaving Distort, never on pointer-up,
  so a completed gesture does not renormalize and visibly move untouched
  corners. The core continues to own convexity, degeneracy, output-size, and
  horizon validity;
- plugin-local undo/redo (`edit-history.ts`) with Cmd/Ctrl+Z and
  Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y during a live session; Enter applies and Escape
  cancels back to the loaded state. History entries are full editor states and
  restore by recomposition, never by rasterization. After Apply the existing
  single host-Undo routing is unchanged;
- preview zoom, pan, and fit (`preview-viewport.ts` in the web package): wheel
  zoom anchored at the pointer, space-drag pan, Fit / 100% / step zoom controls
  in the footer, and a fit lock that re-fits on panel resize until the user
  zooms manually. Transform content changes preserve the camera and stable
  logical scene instead of disguising scale/translation with automatic fit;
- the shared `PerspectiveEditor` gained the eight-handle Free Transform
  overlay, gesture routing (move/rotate/dead-band classification), a frozen
  gesture-start pointer rectangle, and keyboard movement/resize semantics in
  Transform mode. Keyboard increments use output-image units even when Figma
  caps the preview raster; Distort-mode corner nudging uses the same target-size
  rule and can cross the source bounds. Dynamic Distort workspace rebasing is a
  preview concern only; captured specs retain their original coordinates.

Numeric sliders and fields remain the precision path and stay live-synced with
canvas gestures. The six-flow technical dogfood promoted the bounded Warp
slice below; owner business/experience acceptance remains separate.

### Bounded common Warp segment (2026-08-24)

The ten P1 common presets are now implemented as one core-owned deformation
contract: Arc, Arch, Flag, Wave, Fish, Rise, Fisheye, Inflate, Squeeze, and
Twist. Each preset takes one finite signed amount in `[-1,1]`, where zero is
identity, and expands to a fixed 16x16 positive-area mesh with a fixed unit
boundary. Native render and Web/Figma consume those vertices; CLI and MCP
compose the same `content.warp`; CSS rejects Warp instead of approximating it
with `matrix3d`.

Figma exposes only preset and Bend controls in a third Warp mode. Switching
between Transform, Distort, and Warp preserves the cumulative spec without an
intermediate rasterization. Real current-build dogfood verified Arc at 100%,
mode round-trip preservation, Apply, and one-step host Undo with no residual
result. Custom grids, split/Bezier Warp, arbitrary deformation, Perspective
Warp, camera estimation, Puppet Warp, Liquify, and batch remain frozen.

The source-plus-result replacement sequence has current automated coverage for
atomic replacement, stale selection, rollback, and undo-boundary ordering. The
desktop automation carrier used for this pass cannot synthesize the modifier
click needed to form that exact two-layer selection, so final designer pointer
acceptance of that pair flow remains an experience check rather than a claimed
runtime observation.

### Direct-manipulation and raster-quality closure (2026-08-24)

Outward Distort freezes the base pointer mapping in gesture-start coordinates
and keeps zoom stable. An outward pointer in the outer 48 px viewport zone
drives bounded compositor pan, with the latest pointer re-sampled against the
camera translation so the active handle remains coupled. Returning inward or
ending the pointer session stops the pan. After release, an eased recovery uses
a 16 px safe inset, pans minimally, and zooms out only when needed. It never
automatically zooms in or changes canonical coordinates.

Distort now overlays a correction grid generated from the same homography and
Warp mesh used for pixels. It is a visual guide only; the current Free
Transform slice does not add straight-edge constraints or a second geometry
input.

Apply no longer assumes the startup preview export is the best available
source. It estimates final local sampling density by composing the solved
homography with the exact core Warp mesh derivatives, generation-safely
re-exports the original Figma node up to the platform's 4096 px per-axis
ceiling, and uses high-quality final-only sampling. This addresses the
avoidable blur from using a display-sized preview as the final source, but
cannot recover detail Figma already removed when it imported an asset above
4096 px. Figma documents that same limit for [`createImage`](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/)
and [uploaded image assets](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs).

The current Figma result therefore remains one replaceable raster Rectangle
and rejects a larger axis. Multi-tile 6K/8K document output would require a new
multi-node replacement/selection/undo contract; it is not hidden behind this
quality repair. The native CLI remains the explicit high-resolution path.

The Agent route adds one direct `worldbend.compose` call. Ordinary semantic
transform requests must not require an Agent to calculate a matrix or call a
discovery tool first. If the operation catalog later grows beyond a compact set
of stable tasks, revisit a `search / describe / run / batch` catalog instead of
adding one MCP tool per preset.

### ComfyUI execution segment (2026-08-30)

The first ComfyUI V3 adapter is implemented as a local, headless-compatible
node pack. `Worldbend Transform Spec` validates reusable JSON through the
native core. `Apply Worldbend Transform` applies the same spec to one IMAGE and
optional MASK, returns the unchanged transform for source replacement, and
keeps mask polarity, alpha, quality, canvas, and resource limits explicit. The
adapter includes no matrix, Warp, or rasterization algorithm.

This segment is intentionally narrower than a video product. Comfy batch size
greater than one fails explicitly. Frame sequences move to P2 only after the
batch/sequence contract defines order and correlation, partial failure,
cumulative resource budgets, fairness, cancellation, and publication. The
current local macOS/arm64 package validates the binary boundary and package
inventory; Registry publication and multi-platform binaries are release work,
not inferred from source compatibility.

### Explicit planar rectification segment (2026-08-30)

The next deterministic Photoshop-familiar slice is implemented as a separate
`worldbend.rectify@0.1` operation. The caller supplies the source quad and
integer output dimensions; the Rust core validates and solves source-to-output
geometry, and the existing native sampler renders it. CLI and MCP expose
`rectify` plus `rectify-render`; Web/WASM exposes the same plan; Figma supplies
manual source handles and bounded output fields; ComfyUI supplies a reusable
spec node and an apply node. None of those adapters detect edges, infer aspect
ratio, estimate a camera, or duplicate homography math.

Rectification remains distinct from TransformSpec because selecting a source
sub-plane is not destination-only geometry and the projective continuation
outside that selected plane may be invalid. Figma persists the RectifySpec
under its own shared-data key so reopening a source/result pair does not
pretend the operation was ordinary Distort. This segment does not add batch,
video, lens correction, content-aware fill, or an Agent planner.

The carrier foundation now permits broad deterministic graphics coverage
without giving every install the whole source tree. The next implementation
waves are ordered by shared production value and dependency, not by a promise
to clone every Photoshop panel:

1. Canvas and multi-output: Crop, Trim, Pad, Contain, Cover, anchors, declared
   backgrounds, and synchronized IMAGE/MASK/control-map variants.
2. Place and multi-plane mockup: forward placement, reverse extraction,
   connected planes, shared edges, explicit grids, and planar measurement.
3. Mesh and displacement: caller-authored grids/control points, displacement
   maps/vector fields, and deterministic boundary/filter rules.
4. Frame sequences: explicit keyframes and externally supplied per-frame
   matrices only after order, correlation, partial failure, cumulative budget,
   fairness, cancellation, and publication are versioned.
5. Lens/projection, compositing, vector preservation, tiling/atlases, and
   replayable liquify strokes as independent later contracts.

Worldbend still does not decide what to crop, detect planes, infer depth,
estimate optical flow, recognize joints, or choose creative edits. Those may
arrive as explicit masks, lines, points, maps, tracks, or parameters from a
human, Agent, model, or another workflow node. Each Worldbend operation remains
an exact program over that input. A stable core feature is exposed only through
compatible carriers; carrier symmetry is not a release requirement.

The first wave begins only after the current carrier-profile foundation is
green. It creates the first independent Figma workspace instead of adding more
controls to Perspective, a compact headless contract instead of a proliferation
of Agent tools, and Comfy nodes only for graph-native data flows. This is the
next parallel implementation boundary recorded in `docs/CAMPAIGN_ANCHOR.md`.

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
