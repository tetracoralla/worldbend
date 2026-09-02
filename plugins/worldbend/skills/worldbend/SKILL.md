---
name: worldbend
description: "Execute caller-authored deterministic 2D geometry or request explicit assisted source-plane candidates: compose, solve, inspect, render, rectify, Canvas variants, bounded single-raster programs, multi-plane mockups/extraction, custom meshes and cubic surfaces, lens/displacement remaps, eased motion/timelines, read-only PSD Smart Object template projection, or CSS. Use when parameters are explicit, or when a user explicitly asks for uncertain contrast/alpha plane suggestions. Do not use for automatic application, semantic object/screen detection, inferred crops or dimensions, depth/flow/lens estimation, 3D, or creative planning."
---

# Worldbend

Use the installed Worldbend tools as the geometry authority. The installed
Agent projection exposes a compact progressive catalog: call `worldbend.run`
directly for every operation below, putting the listed operation ID in
`operation` and that operation's ordinary arguments in `arguments`. Call
`worldbend.search` only when the request does not map to a known operation and
`worldbend.describe` only when its exact current schema is not already known.
Both are deterministic metadata calls, not planning. Deterministic operations
consume explicit planes. The separate `plane_candidates` assessment can suggest
zero to three contrast- or alpha-supported quadrilaterals, but it does not
identify a semantic screen/package face, choose one, infer output size, or
apply it.

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
3. Run `plane_candidates` only when the caller explicitly wants uncertain
   source-plane suggestions from one supplied PNG, JPEG, WebP, or TIFF. Select
   exactly one Provider: `contrastQuadV1` for a region visually distinct from
   its image border, or `alphaQuadV1` for transparent-background support. Treat
   every confidence value as an uncalibrated ranking score, preserve all source
   facts and uncertainty reasons, accept `noCandidate`, and never auto-apply
   the first candidate. A separate caller selection and explicit output size
   are required before Rectify.
4. Run `psd_smart_objects` only to inspect one bounded PSD/PSB or to project
   caller-selected eligible Smart Objects into a Worldbend Spatial Template.
   It is read-only: it never extracts embedded assets, writes Photoshop files,
   rasterizes unsupported warps, or silently selects layers. Preserve the
   returned importability reasons and bind replacement assets separately.
5. Run `rectify` once when the user or an upstream system already
   supplies a source-image quadrilateral and explicit integer output width and
   height. Preserve strict `tl`, `tr`, `br`, `bl` meaning. Do not inspect the
   image, infer aspect ratio, or estimate a camera. Call
   `rectify_render` instead when a local PNG, JPEG, or WebP must be
   flattened into the declared PNG output; its paths use the same explicit
   workspace authority and dry-run semantics as ordinary render.
6. Run `inspect` once for an existing `TransformSpec` whose current
   validity, bounds, reprojection, or horizon safety matters.
7. Run `canvas_render` once when the caller has already supplied
   exact Crop, Trim threshold, Pad insets, Contain, Cover, or Stretch values
   and one or more explicit output variants. Use the returned resolved plan to
   replay content-dependent Trim geometry on another same-sized 8-bit raster.
   The output directory must be a new relative directory; one call publishes
   the complete ordered set or publishes nothing. Do not choose a crop,
   background, anchor, or aspect ratio for the caller.
8. Run `program_inspect` / `program_render` when the caller supplies one
   ordered chain of 1..8 existing Transform, Rectify, and Canvas stages over
   one source raster. Use it instead of publishing and reopening intermediate
   PNGs. It produces one final PNG or nothing, and reports every stage's input
   and output size. Do not invent stages, use it as a batch operation, or add
   multi-source, branching, fan-out, or per-stage publication.
9. Run `template_inspect` when the caller supplies one reusable Spatial
   Template rooted in an existing Raster Program or Mockup, and run
   `variation_plan` / `variation_render` when it also supplies the complete
   ordered item bindings and exact asset paths. Every item binds each template
   slot exactly once. One render publishes the complete nested item/output PNG
   directory or nothing; do not replace it with independent render calls or
   invent a workflow graph.
10. Use `media_inspect` / `media_render` when sample precision, TIFF, ICC
   preservation/discard, JPEG matte/quality, or explicit loss reporting
   matters. Use `vector_render` only for a supplied SVG and explicit intrinsic
   size: affine SVG stays SVG, projective placement requires the HTML carrier,
   and non-zero Warp is rejected. Use `tiled_media_render` for a supplied large
   destination and explicit tile/output budgets; it publishes one atomic
   directory plus a relative-filename manifest and does not make source decode
   unbounded.
11. Run `mockup_plan` / `mockup_render` for caller-authored ordered planes,
   source IDs, seams, grids, measurements, opacity, and canvas. Run
   `mockup_extract_plan` / `mockup_extract_render` when the caller supplies an
   ordered set of Rectify programs to extract from one original raster. Source
   sets must match exactly; directory output is all-or-none. Do not detect,
   align, or repair planes.
12. Run `mesh_plan` / `mesh_render` for a caller-authored regular custom mesh.
   Preserve vertex order, source grid, boundary, and positive triangles. Do
   not synthesize control points or combine custom Mesh with preset Warp.
13. Run `surface_plan` / `surface_render` for a caller-authored bounded cubic
   Bezier patch lattice plus ordered source-space deformation strokes and
   explicit interior anchors. Boundary controls remain fixed and the operation
   resolves to the canonical validated Mesh contract. Do not infer handles,
   replay pointer events, perform Liquify simulation, or combine the surface
   with a preset Warp.
14. Run `remap_plan` / `remap_render` for explicit Brown-Conrady lens values or
   a channel displacement map. Displacement requires exactly one map; lens
   rejects one. Do not estimate a lens, depth, flow, channels, neutral value,
   scale, or boundary mode.
15. Run `timeline_plan` / `timeline_render` for explicit per-frame transforms or
   linear four-corner keyframes. The source set, frame order, IDs, fixed output,
   cumulative budget, and atomic PNG directory are part of the program. Do not
   track motion, invent keyframes, or loop independent render calls.
16. Run `motion_plan` / `motion_render` when the caller supplies the exact
   rational frame rate, first/last-covered keyframes, and linear, hold, or
   cubic-Bezier easing. Use the returned rational presentation times and atomic
   PNG sequence; do not estimate tracking, optical flow, cadence, or encoded
   video/audio.
17. Run `render` once to apply or reuse a saved mapping on a local
   PNG, JPEG, or WebP. Paths are relative to the explicitly granted workspace.
   Use `dryRun: true` when overwrite authority or output feasibility is not yet
   established; do not claim a file was written from a dry-run result.
18. Run `css` once for a live image, video, iframe, canvas, or DOM
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

- Automatic application of a suggested plane, semantic screen/object detection,
  salient-subject crop selection, output-size inference, segmentation,
  lens/depth/flow or camera estimation, split Warp, unconstrained Liquify,
  embedded PSD asset extraction or PSD writing, 3D, public batch/branch
  programs, and encoded video/audio are separate capabilities.
- A render workspace is available only when the host grants
  `WORLDBEND_WORKSPACE_ROOT`. If it is absent, compose, solve, inspect, and
  CSS and rectification planning remain available; report that file rendering
  needs an explicit workspace grant.
- Keep matrices and numerical diagnostics concise unless the user needs them.
  For ordinary work, present the saved spec, output path, placement, and any
  warning or stable error that changes the next action.
