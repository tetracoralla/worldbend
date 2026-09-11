# Worldbend product model

## Product direction

Worldbend's owner-confirmed target is an Agent-native two-dimensional graphics
work system with one shared non-destructive operation model and an extremely
restrained human canvas. This is a target, not a claim that the current product
already performs arbitrary graphics work. The exact current capabilities below
remain authoritative; new deterministic capabilities normally enter the core
and Agent/direct route before they are considered for human UI.

Implementation plans and recovery notes are kept locally under `.task-notes/`.

## Human UI admission rule

A new human-visible task may enter a carrier only when all of the following are
current facts:

1. A named designer task and affected graphic object exist; capability breadth
   or parity with another editor is not sufficient.
2. Repeated value is observed in real use or explicitly confirmed by the owner.
3. The task has a task-native direct-manipulation or compact-control model,
   preview, apply/replace behavior, Undo boundary, error recovery, and focus or
   workspace return behavior.
4. Its operation is already closed and validated in the shared core or another
   named source-of-record contract. The UI does not invent adapter-local
   geometry or hidden inference.
5. The complete interaction fits the declared carrier resource and performance
   boundary without degrading Perspective's continuous-edit path.

Until all five are true, the capability remains headless, Agent-only, or
unimplemented. Existing human workspaces may be simplified when current use
shows that they fail this rule; they are not removed merely to satisfy an
abstract minimalism preference.

## Product definition

Worldbend is a reusable deterministic transform and rendering primitive. Its
current geometry maps a normalized planar source onto an explicit destination
quadrilateral and can compose semantic affine adjustments over that mapping.
It preserves the cumulative transform as data rather than resampling after
each adjustment.

Planar correction is a separate deterministic operation: `RectifySpec`
identifies one caller-supplied source quadrilateral and one explicit integer
output size. It does not detect a plane or infer an aspect ratio, and it is not
silently folded into destination-only `TransformSpec` semantics.

Canvas is a third independent deterministic operation family. `CanvasSpec`
and ordered `CanvasSetSpec` values describe exact Crop, Trim threshold, Pad,
Contain, Cover, or Stretch work over a rectangular source raster. Canvas does
not select a subject or invent target ratios. Its resolved plan is reusable on
another same-sized 8-bit raster so IMAGE, MASK, and compatible control maps do
not independently recompute content-dependent Trim geometry. See
`docs/CANVAS_CONTRACT.md`.

The headless source superset also contains explicit multi-plane Place/Mockup
and reverse extraction, caller-authored custom meshes, lens/displacement
remaps, bounded cubic surface deformation, an ordered atomic Timeline, and
rational-time eased Motion. Each family has its own versioned contract and
compile feature. Their presence does not authorize perception or make them
appear in every carrier.

The Agent/full carrier also accepts a bounded single-raster program. It chains
1..8 existing Transform, Rectify, and Canvas stages in memory and publishes
only one final PNG, so a caller does not need to publish and re-decode
intermediate rasters. It is orchestration over existing semantics, not a scene
graph, layer model, public batch operation, or human workspace. See
`docs/RASTER_PROGRAM_CONTRACT.md`.

The headless production-media layer additionally supports explicit PNG/JPEG/
WebP/TIFF precision and encoding, opaque ICC preservation or declared discard,
u16/float displacement controls, bounded SVG/HTML vector-preserving carriers,
and atomic large-destination tile sets. These routes reuse TransformSpec and
RemapSpec; exact loss and resource boundaries are in
`docs/MEDIA_PIPELINE_CONTRACT.md`.

The separate Agent/full assisted-perception layer can ask one explicitly named
local Provider for source-plane candidates. It returns source facts,
uncalibrated confidence, typed uncertainty, and possibly no candidate; a caller
must select and copy a candidate into a separately authored RectifySpec before
deterministic execution. It never runs from the core or automatically applies
the highest score. See `docs/PERCEPTION_PROVIDER_CONTRACT.md`.

The Agent/full interoperability layer can inspect a bounded PSD/PSB and project
caller-selected, eligible Smart Object transforms into the existing Spatial
Template contract. It does not extract embedded assets, write Photoshop files,
or approximate unsupported Photoshop warps. See
`docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md`.

The primary human user is a visual designer expecting a Photoshop-familiar
Free Transform workflow for a screen, label, poster, package face, or other
planar asset, including later source replacement. The primary Agent user needs
to stop deriving affine matrices, homographies, CSS `matrix3d` values, and
raster placement by hand.

```text
TransformSpec -> worldbend-core -> homography + diagnostics
TransformRecipe -> worldbend-core -> tight TransformSpec + placement
RectifySpec -> worldbend-core -> source-to-output plan
Canvas(Set)Spec -> worldbend-core -> resolved source rectangles + placements
MockupSpec -> worldbend-core -> ordered plane/seam/grid plan
Mesh/RemapSpec -> worldbend-core -> explicit deformation/remap plan
TimelineSpec -> worldbend-core -> ordered validated frame plan
SurfaceDeformationSpec -> worldbend-core -> canonical Mesh plan
MotionSpec -> worldbend-core -> rational timing + canonical Timeline plan
PSD/PSB -> worldbend-interop -> selected SpatialTemplate projection
RasterProgramSpec -> ordered existing single-raster stages
                               |-> native raster renderer
                               |-> CSS live-element adapter
                               |-> CLI / MCP
                               |-> portable Capability projection
                               |-> Web / Figma preview and apply
                               `-> ComfyUI IMAGE / MASK apply
```

Figma is one adapter, not the source of truth. A frontend can consume the same
mapping as live CSS, and an Agent can solve, inspect, render, or emit CSS without
a GUI.

## Carrier projections

Explicit frontend plane posing and a shared-plane strip are conveniences over
the same TransformSpec. The strip partitions one mapping into adjacent live
cards, keeping their top edges collinear and their bottom edges collinear.
CLI/MCP can emit CSS once with no browser dependency; the focused Web adapter
also observes resize, coalesces updates, supports bounded pointer tilt and
preserves content, last-valid state and reusable mappings. These operations
do not detect a reference image's layout or model a general 3D scene. See
`docs/PLANE_POSE_CONTRACT.md` and the runnable `packages/web/examples/` example.

The repository is a source superset, not one universal install. The checked
profiles in `config/carrier-profiles.json` project the current semantic core
into task-native distributions:

- Figma ships the stable Perspective workspace plus Sizes and Templates as its
  persistent repeat-use navigation. Composition, Mesh, Split Warp, and Lens &
  maps remain task-labeled advanced transforms under More. Its no-CSS WASM
  build includes only the planners those human routes consume;
- the Agent plugin ships the full stable headless implementation with no human
  UI, exposes a compact progressive catalog by default, and retains the current
  eight direct tools as an explicit compatibility surface;
- ComfyUI ships nine workflow nodes and a reduced native CLI containing only
  transform, rectification, Canvas, and graph-native Remap commands.

Package inventory, Figma byte ceilings, the Agent tool-catalog ceiling, and
reduced carrier compilation are executable checks. See
`docs/CARRIER_BUILD_PROFILES.md`. A feature existing in the core does not grant
it a button, node, or tool in every carrier. The current Figma Perspective
workspace is a compatibility baseline; later tasks enter independent
workspaces rather than extending its operation bar indefinitely.

## Current productized finish line

The current implementation campaign is complete when this repository contains
and freshly verifies:

1. a versioned canonical `TransformSpec` supporting pixel and normalized
   destination spaces, explicit source orientation, and one bounded
   ten-preset Warp value;
2. strict convex-quad validation, stable errors, a numerically stable `f64`
   homography solver, inversion, reprojection diagnostics, bounds, and horizon
   detection in one Rust core;
3. a native reference raster renderer using inverse plane/mesh mapping,
   premultiplied alpha, PNG/JPEG/WebP/TIFF precision and loss disclosure,
   high-precision control samples, vector-preserving SVG/HTML carriers, and
   large-destination tiled publication;
4. structured transform, rectification, Canvas, Place/Mockup, custom Mesh,
   bounded cubic Surface Deformation, Lens/Displacement Remap, Timeline,
   rational-time Motion, single-raster Program, Spatial Template, Variation
   Job, production media, vector, tiling, read-only PSD Smart Object
   projection, and CSS CLI operations;
5. the same eight direct MCP compatibility tools over the core plus one compact
   `search` / `describe` / `run` Agent projection, including one ordered atomic
   Canvas Set renderer plus on-demand Place, Mesh, Surface Deformation, Remap,
   Timeline, Motion, bounded single-raster Program, Template/Variation,
   production media, vector, tiled-media, read-only PSD Smart Object projection,
   and read-only assisted plane-candidate operations, with exact schemas,
   bounded catalogs and results, explicit workspace authority, dry-run, and
   safe output publication;
6. a Rust-to-WASM geometry/mesh bridge, CSS adapter, WebGL2 preview, and minimal web
   playground;
7. a local Figma development plugin that exports one selected node, composes
   scale/rotation/skew with reachable live handles, four-corner Distort with
   bounded edge-following pan, post-release eased recovery, and interrupted-release
   self-healing, a solved correction guide, and bounded Warp; presents that work
   in a canvas-first interface whose full-width top operation bar and
   full-width bottom session bar frame one uninterrupted rectangular editor;
   operation content may reflow and refit that editor without mutating its
   canonical geometry or covering handles;
   applies a density-planned tight raster result; and retains the serialized
   operation data needed for in-place replacement, including a distinct
   normalized-source `RectifySpec` for manual four-point correction;
   explicit editable Frame and high-resolution image output choices preserve
   the source, support independent new versions and contextual replacement;
   editing descendants on the Figma canvas keeps the whole active Frame's
   preview and draft. The editable Frame carrier retains native children under a private,
   explicitly provisioned projective Shader, shares result/source bindings,
   and reopens the same operation for designer or external Agent updates;
   its bounded surface and support limits are described in
   `docs/FIGMA_HANDOFF.md`;
8. an experimental local ComfyUI V3 node pack that validates and applies one
   reusable `TransformSpec` or explicit `RectifySpec` to one IMAGE plus
   optional MASK through a bundled native renderer, and validates/applies an
   ordered Canvas Set plus replays its resolved plan, and validates/applies one
   explicit lens or displacement Remap, without adapter-local geometry;
9. an experimental provider-neutral Capability projection for explicit inspect
   and bounded local render, without a second geometry model;
10. a staged Codex plugin with a thin routing Skill;
11. rerunnable development, built-runtime Agent, browser, Figma-package, and
    Comfy-adapter checks with honest lane reporting;
12. a recoverable private GitHub source repository plus a self-contained,
    separately verified free Figma distribution with complete bundled
    dependency notices.

This productized slice includes semantic affine composition — scale X/Y,
clockwise rotation, skew X/Y, translation, and pivot — plus bounded common
Warp presets across Rust, CLI, MCP, WASM/Web, Figma, and the single-image
ComfyUI adapter, while keeping four-corner Distort as the existing direct
editor. See
`docs/TRANSFORM_ROADMAP.md` for the larger Photoshop-parity order.

Business/experience acceptance remains an owner decision. A passing build,
private GitHub push, or valid free manifest does not imply that Figma has
approved the Community listing.

## Canonical abstraction

The source plane is always normalized UV space:

```text
TL (0,0) ---- TR (1,0)
   |             |
BL (0,1) ---- BR (1,1)
```

The destination corner order is strictly `TL -> TR -> BR -> BL`. Adapters may
offer ergonomic controls, but the core never guesses or silently reorders
points.

The same `TransformSpec` may be reused with different raster dimensions or a
live HTML element. This is the basis of Replace Source / Smart Perspective.

## Dominant flows and routing budget

Human flow:

1. select or load one source;
2. adjust scale, rotation, and skew in Transform; use explicit independent-corner
   Free dragging or captured-axis two-point Perspective dragging in Distort,
   including beyond the source bounds with edge-following pan; use the solved
   grid as a visual guide; choose one
   bounded preset in Warp; or alternate between them, with immediate local
   preview and no intermediate rasterization;
3. apply once;
4. later replace the source while preserving the plane.

Agent flow (the operation IDs below run through the compact installed surface;
the eight `worldbend.<operation>` names remain available in direct
compatibility mode):

- semantic scale/rotate/skew/translate over a saved mapping:
  one `worldbend.run` call with operation `compose`;
- apply, replace, or explicitly clear a bounded Warp on that mapping:
  the same one `worldbend.run` call with operation `compose`;
- explicit quad to matrix and diagnostics: one `worldbend.run` call with
  operation `solve`;
- validate saved mapping: one `worldbend.run` call with operation `inspect`;
- source plus saved spec to PNG: one `worldbend.run` call with operation
  `render`;
- one explicit ordered Transform / Rectify / Canvas chain over a single raster:
  one `worldbend.run` call with operation `program_render`; it publishes only
  the final PNG and is not a batch or scene graph;
- explicit source quad plus explicit output size to a reusable plan: one
  `worldbend.rectify` call;
- the same explicit rectification plus a local raster to PNG: one
  `worldbend.rectify_render` call;
- one local raster plus an explicit ordered Canvas Set to a new output
  directory: one `worldbend.run` call with operation `canvas_render`; the returned resolved plan can
  be replayed on a same-sized 8-bit control raster without re-running Trim;
- one persisted Spatial Template can be inspected and rebound to an ordered
  Variation Job; one `variation_render` call publishes all correlated outputs
  atomically without an Agent relaying each transform;
- `media_inspect` and `media_render` expose explicit input precision, ICC
  policy, output format, loss, and digest facts; `vector_render` preserves SVG
  source semantics where affine SVG or projective HTML can represent them;
  `tiled_media_render` publishes one bounded large-destination tile set and
  manifest without a full destination allocation;
- `plane_candidates` asks exactly one contrast- or alpha-based local Provider
  for zero to three source-plane assessments. It is read-only; scores are
  uncalibrated, uncertainty is explicit, and a separate caller choice is
  required before Rectify execution;
- `surface_plan` and `surface_render` resolve a bounded cubic patch lattice,
  explicit interior anchors, and ordered source-space strokes to the canonical
  Mesh plan before native execution;
- `motion_plan` and `motion_render` resolve explicit linear, hold, or
  cubic-Bezier keyframe easing at one reduced rational frame rate into the
  existing Timeline, preserving exact presentation times and atomic sequence
  publication;
- `psd_smart_objects` inspects one bounded PSD/PSB or projects an explicit
  eligible Smart Object selection into a Spatial Template without extracting
  or mutating the source document;
- saved non-Warp mapping to live CSS: one `worldbend.run` call with operation
  `css`;
- provider-neutral capability/procedure consumers use one `inspect` or `render`
  request through the experimental Capability adapter; the adapter projects
  into the same core rather than re-solving geometry. Its current Profile
  excludes product-only source orientation and Warp and rejects those fields.

ComfyUI flow:

- validate or paste one explicit `TransformSpec` once;
- apply that exact mapping to one generated IMAGE and its optional MASK;
- retain the transform output so a changed source can reuse the same plane
  without asking an Agent to infer four corners again;
- alternatively validate one explicit RectifySpec and flatten that exact
  source quadrilateral to its declared output rectangle;
- alternatively validate one explicit ordered Canvas Set, apply it to one
  IMAGE plus optional MASK as heterogeneous output lists, and replay the
  returned plan on a compatible 8-bit control raster;
- alternatively validate one explicit lens/displacement Remap and reuse it
  with the same displacement map across a primary IMAGE, MASK, and compatible
  8-bit control images;
- an omitted target binds a normalized spec to the incoming IMAGE dimensions,
  while an explicit target makes the render canvas reproducible across sources.

This first Comfy route is a server-side, headless-compatible V3 adapter, not an
Agent planner and not a new editor. It accepts already structured input with
zero model calls.

Known supported tasks must not require a preliminary search or describe call.
Search is for an unfamiliar operation ID; describe returns that operation's
exact closed input and output schemas only when they are not already known.
Invalid input returns one stable structured error without speculative retries.

## Current non-goals

- automatic application of a perceived plane; semantic edge, object, screen,
  or vanishing-point detection beyond the explicit contrast/alpha candidate
  Providers;
- unconstrained Bezier topology, freeform Liquify simulation, inferred brush
  paths, folded custom meshes, or adapter-invented deformation beyond the
  explicit bounded Mesh, Surface Deformation, and Remap contracts;
- camera pose or 3D scene reconstruction;
- rewriting arbitrary Figma vector paths into projective geometry; the
  editable Frame carrier preserves native source children and uses a sampled
  Shader appearance, as specified in `docs/FIGMA_HANDOFF.md`;
- Comfy input IMAGE batches, Comfy video frame sequences, high-precision
  Comfy control maps, and encoded video/audio rendering; the Agent-only Timeline
  publishes an explicit atomic PNG sequence;
- PSD/PSB writing, embedded asset extraction, linked-asset fetching, Photoshop
  effect preservation, or approximation of unsupported Smart Object warps;
- cloud rendering, accounts, collaboration, or operating a marketplace;
- 6K/8K Figma tiling. The headless tiled-media route does not change Figma's
  single-image API cap of 4096 px per axis;
  the current adapter can visibly reduce raster density to fit that boundary
  while preserving document geometry, and the CLI remains the full-density
  high-resolution route.

Perception produces only uncertain proposed points and source facts. It remains
upstream and must never be hidden inside deterministic `solve`, `rectify`, or
`render`.
