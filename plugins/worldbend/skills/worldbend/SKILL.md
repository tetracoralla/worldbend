---
name: worldbend
description: "Execute caller-authored deterministic 2D geometry: compose, solve, inspect, render, rectify, Canvas variants, bounded single-raster programs, multi-plane mockups/extraction, custom meshes, lens/displacement remaps, ordered transform timelines, or CSS. Use when parameters, corners, grids, maps, sources, stages, or keyframes are explicit. Do not use for plane/subject detection, inferred crops or dimensions, depth/flow/lens estimation, 3D, or creative planning."
---

# Worldbend

Use the installed Worldbend tools as the geometry authority. The installed
Agent projection exposes a compact progressive catalog: call `worldbend.run`
directly for every operation below, putting the listed operation ID in
`operation` and that operation's ordinary arguments in `arguments`. Call
`worldbend.search` only when the request does not map to a known operation and
`worldbend.describe` only when its exact current schema is not already known.
Both are deterministic metadata calls, not planning. The tools consume explicit
planes; they do not guess a screen, package face, vanishing point, or other
target from an image.

## Route the request

1. Run `compose` once when the user supplies semantic scale,
   clockwise rotation, horizontal/vertical skew, translation, pivot, or
   horizontal/vertical source-flip values, or one common Warp preset over an existing mapping. For a
   normalized spec, include its concrete target size. Use the returned tight
   spec and canvas placement instead of deriving a matrix in model reasoning.
   Omit `pivot` unless the user explicitly changes the reference point. Its
   values are relative to current destination bounds: top-left `(0,0)`, default
   center `(0.5,0.5)`, bottom-right `(1,1)`; they are never pixel coordinates.
   Flips XOR into `content.orientation`; never mirror destination corner order.
   Warp uses `transform.warp` with one of `arc`, `arch`, `flag`, `wave`,
   `fish`, `rise`, `fisheye`, `inflate`, `squeeze`, or `twist`, and a finite
   signed `amount` from -1 to 1. Use `transform.clearWarp: true` to remove an
   existing Warp; never send it together with `transform.warp`. Do not
   calculate or supply mesh vertices.
2. Run `solve` once when the user supplies four corners or asks for
   a reusable perspective mapping. Preserve the strict `tl`, `tr`, `br`, `bl`
   meaning and present stable geometry errors instead of silently reordering.
3. Run `rectify` once when the user or an upstream system already
   supplies a source-image quadrilateral and explicit integer output width and
   height. Preserve strict `tl`, `tr`, `br`, `bl` meaning. Do not inspect the
   image, infer aspect ratio, or estimate a camera. Call
   `rectify_render` instead when a local PNG, JPEG, or WebP must be
   flattened into the declared PNG output; its paths use the same explicit
   workspace authority and dry-run semantics as ordinary render.
4. Run `inspect` once for an existing `TransformSpec` whose current
   validity, bounds, reprojection, or horizon safety matters.
5. Run `canvas_render` once when the caller has already supplied
   exact Crop, Trim threshold, Pad insets, Contain, Cover, or Stretch values
   and one or more explicit output variants. Use the returned resolved plan to
   replay content-dependent Trim geometry on another same-sized 8-bit raster.
   The output directory must be a new relative directory; one call publishes
   the complete ordered set or publishes nothing. Do not choose a crop,
   background, anchor, or aspect ratio for the caller.
6. Run `program_inspect` / `program_render` when the caller supplies one
   ordered chain of 1..8 existing Transform, Rectify, and Canvas stages over
   one source raster. Use it instead of publishing and reopening intermediate
   PNGs. It produces one final PNG or nothing, and reports every stage's input
   and output size. Do not invent stages, use it as a batch operation, or add
   multi-source, branching, fan-out, or per-stage publication.
7. Run `mockup_plan` / `mockup_render` for caller-authored ordered planes,
   source IDs, seams, grids, measurements, opacity, and canvas. Run
   `mockup_extract_plan` / `mockup_extract_render` when the caller supplies an
   ordered set of Rectify programs to extract from one original raster. Source
   sets must match exactly; directory output is all-or-none. Do not detect,
   align, or repair planes.
8. Run `mesh_plan` / `mesh_render` for a caller-authored regular custom mesh.
   Preserve vertex order, source grid, boundary, and positive triangles. Do
   not synthesize control points or combine custom Mesh with preset Warp.
9. Run `remap_plan` / `remap_render` for explicit Brown-Conrady lens values or
   a channel displacement map. Displacement requires exactly one map; lens
   rejects one. Do not estimate a lens, depth, flow, channels, neutral value,
   scale, or boundary mode.
10. Run `timeline_plan` / `timeline_render` for explicit per-frame transforms or
   linear four-corner keyframes. The source set, frame order, IDs, fixed output,
   cumulative budget, and atomic PNG directory are part of the program. Do not
   track motion, invent keyframes, or loop independent render calls.
11. Run `render` once to apply or reuse a saved mapping on a local
   PNG, JPEG, or WebP. Paths are relative to the explicitly granted workspace.
   Use `dryRun: true` when overwrite authority or output feasibility is not yet
   established; do not claim a file was written from a dry-run result.
12. Run `css` once for a live image, video, iframe, canvas, or DOM
   element. Supply the element size and, for normalized planes, the concrete
   destination size. CSS cannot represent a Warp whose `amount` is non-zero;
   `amount: 0` is identity and remains CSS-representable. Use render or the Web
   preview for every non-zero Warp.

Do not add a search or describe call before these dominant tasks. The legacy
direct compatibility surface retains the eight `worldbend.<operation>` tool
names for existing clients, but the installed compact surface intentionally
does not load those eight schemas into every Agent context. Do not estimate a
homography in model reasoning when the tool is available.

## Boundaries

- Automatic plane detection, salient-subject crop selection, output-size
  inference, segmentation, lens/depth/flow or camera estimation, split Warp,
  3D, artistic brush distortion, public batch/branch programs, and encoded
  video/audio are separate capabilities.
- A render workspace is available only when the host grants
  `WORLDBEND_WORKSPACE_ROOT`. If it is absent, compose, solve, inspect, and
  CSS and rectification planning remain available; report that file rendering
  needs an explicit workspace grant.
- Keep matrices and numerical diagnostics concise unless the user needs them.
  For ordinary work, present the saved spec, output path, placement, and any
  warning or stable error that changes the next action.
