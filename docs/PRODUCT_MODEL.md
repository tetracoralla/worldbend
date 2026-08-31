# Worldbend product model

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

The repository is a source superset, not one universal install. The checked
profiles in `config/carrier-profiles.json` project the current semantic core
into task-native distributions:

- Figma ships the stable Perspective workspace, an independent task-native
  Canvas workspace, and a no-CSS WASM build;
- the Agent plugin ships the full stable headless surface with no human UI;
- ComfyUI ships seven workflow nodes and a reduced native CLI containing only
  their inspect/render, rectification, and Canvas commands.

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
3. a native reference PNG renderer using inverse plane/mesh mapping and correct alpha;
4. structured `compose`, `solve`, `inspect`, `render`, `rectify`,
   `rectify-render`, and `css` CLI operations;
5. the same eight direct MCP tools over the core, including one ordered atomic
   Canvas Set renderer, with schemas, bounded results,
   explicit workspace authority, dry-run, and safe output publication;
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
8. an experimental local ComfyUI V3 node pack that validates and applies one
   reusable `TransformSpec` or explicit `RectifySpec` to one IMAGE plus
   optional MASK through a bundled native renderer, and validates/applies an
   ordered Canvas Set plus replays its resolved plan, without adapter-local
   transform or Canvas math;
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

Agent flow:

- semantic scale/rotate/skew/translate over a saved mapping:
  one `worldbend.compose` call;
- apply, replace, or explicitly clear a bounded Warp on that mapping:
  the same one `worldbend.compose` call;
- explicit quad to matrix and diagnostics: one `worldbend.solve` call;
- validate saved mapping: one `worldbend.inspect` call;
- source plus saved spec to PNG: one `worldbend.render` call;
- explicit source quad plus explicit output size to a reusable plan: one
  `worldbend.rectify` call;
- the same explicit rectification plus a local raster to PNG: one
  `worldbend.rectify_render` call;
- one local raster plus an explicit ordered Canvas Set to a new output
  directory: one `worldbend.canvas_render` call; the returned resolved plan can
  be replayed on a same-sized 8-bit control raster without re-running Trim;
- saved non-Warp mapping to live CSS: one `worldbend.css` call;
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
- an omitted target binds a normalized spec to the incoming IMAGE dimensions,
  while an explicit target makes the render canvas reproducible across sources.

This first Comfy route is a server-side, headless-compatible V3 adapter, not an
Agent planner and not a new editor. It accepts already structured input with
zero model calls.

Ordinary supported tasks must not require a preliminary list or describe call.
Invalid input returns one stable structured error without speculative retries.

## Current non-goals

- automatic plane, edge, object, screen, or vanishing-point detection;
- custom warp meshes, split Warp, arbitrary Bezier deformation, Liquify, and
  brush deformation beyond the fixed ten-preset Warp contract;
- camera pose or 3D scene reconstruction;
- vector-preserving Figma transforms in the current raster slice;
- Comfy input IMAGE batches, video frame sequences, high-precision control
  maps, and video raster rendering;
- PSD compatibility;
- cloud rendering, accounts, collaboration, or operating a marketplace;
- 6K/8K Figma tiling. Figma's single-image API is capped at 4096 px per axis;
  the current adapter rejects larger results while the CLI remains the
  high-resolution route.

Perception may later produce four proposed points, but it must remain an
uncertain upstream capability. It must never be hidden inside deterministic
`solve` or `render`.
