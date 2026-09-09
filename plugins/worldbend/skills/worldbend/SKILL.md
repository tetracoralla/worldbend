---
name: worldbend
description: "Edit shared Figma perspective frames, align adjacent cards on one plane, create live CSS for cards, videos and DOM, and reuse precise mappings across webpages and image exports. Use for explicit tilt angles, four-corner placement, source replacement, rectification, Canvas sizing, mockups, bounded deformation, templates and motion. Agents may author design parameters; deterministic execution preserves explicit intent."
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

## Continue a designer's editable Figma work

Use the actual selected frame, its native content and its visual preview as
context. A designer does not need to write a handoff note or copy coordinates.
Keep the owner's file/page grant; do not inspect or alter unrelated designs.

1. Call `worldbend.run` with operation `figma_inspect` and arguments
   `{fileKey, pageId, nodeId}` for the selected Worldbend editable result or
   its duplicate. This prepares a request; it has not read Figma yet.
2. Load the Figma tool's required skill and pass the returned request object
   to the available `use_figma` tool. It returns the current operation, native
   source IDs, placement, revision, expected state and a bounded visual preview.
3. Edit native text/fills directly through Figma when only content must change.
   For geometry, call operation `figma_apply` with
   `{snapshot, spec, width?, height?}`. `snapshot` is the complete structured
   state from the actual Figma result; `spec` is the intended normalized
   affine/projective TransformSpec. Dimensions default to the current frame.
   The native core validates/solves it and prepares the next request.
4. Run that request through `use_figma` within the same grant and inspect its
   visual preview. Retain the new snapshot for subsequent edits.

`E_FIGMA_CONFLICT` means the document changed: inspect again, account for the
designer's intervening edit and prepare a fresh request. Do not replace the
expected state by hand. Native text and fills remain live. A duplicated result
gets its own binding on first update; neither its original nor a missing linked
source is silently replaced. Native geometry excludes Warp/Correct and axes
over 4096. An unavailable effect is an explicit error.

These preparation operations require no Node/Vite installation, development
checkout or local input files. They never contact Figma or publish by
themselves. For a live web delivery, reuse the returned TransformSpec with
`css` and the actual DOM element/destination sizes; this transfers geometry,
not an automatic conversion of arbitrary Figma content into HTML.

## Shared-plane cards and reference images

When adjacent cards must share collinear top and bottom edges, use `plane_strip`
with one parent TransformSpec and ordered source intervals. Independent tilts or
per-depth size tiers do not encode that constraint. Author the plane from the
design intent and verify the rendered result against the reference; do not claim
an image's coordinates were automatically measured. `worldbend.describe` for
`plane_strip` provides its bounded input schema. The result gives a separate
reusable spec and CSS for each live card. This works with HTML/images/video;
there is no need to bake the content into an image.

## Route the request

1. Run `pose` for a card, video, iframe or DOM plane expressed by tilt angles
   and perspective distance. For example, `operation: "pose"` with arguments
   `{elementSize: {width: 640, height: 360}, pose: {perspective: 1300,
   rotateX: 3, rotateY: -8, rotateZ: 1}}` returns live CSS and a reusable spec.
   Angles use CSS signs in degrees; other units and optional origins are in
   the exact operation schema. This is single-plane projection, not a scene.
2. Run `css` for an existing four-corner mapping on a live image, video,
   iframe, canvas or DOM element. Supply its border-box size and, for a
   normalized mapping, the destination size. Playback, text and controls stay
   live. Nonzero Warp needs raster or WebGL output, not CSS matrix3d.

3. Run `compose` once when the caller supplies semantic scale,
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
4. Run `solve` once when the caller supplies four corners or asks for
   a reusable perspective mapping. Preserve the strict `tl`, `tr`, `br`, `bl`
   meaning and present stable geometry errors instead of silently reordering.
5. Run `plane_candidates` only when the caller explicitly wants uncertain
   source-plane suggestions from one supplied PNG, JPEG, WebP, or TIFF. Select
   exactly one Provider: `contrastQuadV1` for a region visually distinct from
   its image border, or `alphaQuadV1` for transparent-background support. Treat
   every confidence value as an uncalibrated ranking score, preserve all source
   facts and uncertainty reasons, accept `noCandidate`, and never auto-apply
   the first candidate. A separate caller selection and explicit output size
   are required before Rectify.
6. Run `psd_smart_objects` only to inspect one bounded PSD/PSB or to project
   caller-selected eligible Smart Objects into a Worldbend Spatial Template.
   It is read-only: it never extracts embedded assets, writes Photoshop files,
   rasterizes unsupported warps, or silently selects layers. Preserve the
   returned importability reasons and bind replacement assets separately.
7. Run `rectify` once when the user or an upstream system already
   supplies a source-image quadrilateral and explicit integer output width and
   height. Preserve strict `tl`, `tr`, `br`, `bl` meaning. Do not inspect the
   image, infer aspect ratio, or estimate a camera. Call
   `rectify_render` instead when a local PNG, JPEG, or WebP must be
   flattened into the declared PNG output; its paths use the same explicit
   workspace authority and dry-run semantics as ordinary render.
8. Run `inspect` once for an existing `TransformSpec` whose current
   validity, bounds, reprojection, or horizon safety matters.
9. Run `canvas_render` once when the caller has already supplied
   exact Crop, Trim threshold, Pad insets, Contain, Cover, or Stretch values
   and one or more explicit output variants. Use the returned resolved plan to
   replay content-dependent Trim geometry on another same-sized 8-bit raster.
   The output directory must be a new relative directory; one call publishes
   the complete ordered set or publishes nothing. Do not choose a crop,
   background, anchor, or aspect ratio for the caller.
10. Run `program_inspect` / `program_render` when the caller supplies one
   ordered chain of 1..8 existing Transform, Rectify, and Canvas stages over
   one source raster. Use it instead of publishing and reopening intermediate
   PNGs. It produces one final PNG or nothing, and reports every stage's input
   and output size. Do not invent stages, use it as a batch operation, or add
   multi-source, branching, fan-out, or per-stage publication.
11. Run `template_inspect` when the caller supplies one reusable Spatial
   Template rooted in an existing Raster Program or Mockup, and run
   `variation_plan` / `variation_render` when it also supplies the complete
   ordered item bindings and exact asset paths. Every item binds each template
   slot exactly once. One render publishes the complete nested item/output PNG
   directory or nothing; do not replace it with independent render calls or
   invent a workflow graph.
12. Use `media_inspect` / `media_render` when sample precision, TIFF, ICC
   preservation/discard, JPEG matte/quality, or explicit loss reporting
   matters. Use `vector_render` only for a supplied SVG and explicit intrinsic
   size: affine SVG stays SVG, projective placement requires the HTML carrier,
   and non-zero Warp is rejected. Use `tiled_media_render` for a supplied large
   destination and explicit tile/output budgets; it publishes one atomic
   directory plus a relative-filename manifest and does not make source decode
   unbounded.
13. Run `mockup_plan` / `mockup_render` for caller-authored ordered planes,
   source IDs, seams, grids, measurements, opacity, and canvas. Run
   `mockup_extract_plan` / `mockup_extract_render` when the caller supplies an
   ordered set of Rectify programs to extract from one original raster. Source
   sets must match exactly; directory output is all-or-none. Do not detect,
   align, or repair planes.
14. Run `mesh_plan` / `mesh_render` for a caller-authored regular custom mesh.
   Preserve vertex order, source grid, boundary, and positive triangles. Do
   not synthesize control points or combine custom Mesh with preset Warp.
15. Run `surface_plan` / `surface_render` for a caller-authored bounded cubic
   Bezier patch lattice plus ordered source-space deformation strokes and
   explicit interior anchors. Boundary controls remain fixed and the operation
   resolves to the canonical validated Mesh contract. Do not infer handles,
   replay pointer events, perform Liquify simulation, or combine the surface
   with a preset Warp.
16. Run `remap_plan` / `remap_render` for explicit Brown-Conrady lens values or
   a channel displacement map. Displacement requires exactly one map; lens
   rejects one. Do not estimate a lens, depth, flow, channels, neutral value,
   scale, or boundary mode.
17. Run `timeline_plan` / `timeline_render` for explicit per-frame transforms or
   linear four-corner keyframes. The source set, frame order, IDs, fixed output,
   cumulative budget, and atomic PNG directory are part of the program. Do not
   track motion, invent keyframes, or loop independent render calls.
18. Run `motion_plan` / `motion_render` when the caller supplies the exact
   rational frame rate, first/last-covered keyframes, and linear, hold, or
   cubic-Bezier easing. Use the returned rational presentation times and atomic
   PNG sequence; do not estimate tracking, optical flow, cadence, or encoded
   video/audio.
19. Run `render` once to apply or reuse a saved mapping on a local
   PNG, JPEG, or WebP. Paths are relative to the explicitly granted workspace.
   Use `dryRun: true` when overwrite authority or output feasibility is not yet
   established; do not claim a file was written from a dry-run result.


Do not add a search or describe call before these dominant tasks. The legacy
direct compatibility surface retains the eight `worldbend.<operation>` tool
names for existing clients, but the installed compact surface intentionally
does not load those eight schemas into every Agent context. Do not estimate a
homography in model reasoning when the tool is available.

## Web integration and task choice

The caller can be an Agent: choose intentional design values within the task,
then ask Worldbend to execute them. Do not invent measurements, detected planes
or user approvals. Use native CSS directly for trivial decorative rotation
when there is no geometry, source-reuse or export task to simplify.

For repeated web use, the Web perspective entry exposes `attachPlanePose` and
`attachPerspective`. `attachPerspectiveStrip` keeps adjacent cards on a shared plane. Bindings follow layout size, accept complete input updates,
retain the last valid mapping, expose `getSpec()` for reuse and restore styles
on disposal. `attachPointerTilt` adds explicit bounded pointer response with
reduced-motion support. Pointer frames run locally, never through repeated MCP
calls. See `references/live-web.md` for the short integration route.

## Boundaries

- Automatic application of a suggested plane, semantic screen/object detection,
  salient-subject crop selection, output-size inference, segmentation,
  lens/depth/flow or camera estimation, split Warp, unconstrained Liquify,
  embedded PSD asset extraction or PSD writing, 3D reconstruction or scene graphs, public batch/branch
  programs, and encoded video/audio are separate capabilities.
- A render workspace is available only when the host grants
  `WORLDBEND_WORKSPACE_ROOT`. If it is absent, compose, solve, inspect, and
  CSS and rectification planning remain available; report that file rendering
  needs an explicit workspace grant.
- Keep matrices and numerical diagnostics concise unless the user needs them.
  For ordinary work, present the saved spec, output path, placement, and any
  warning or stable error that changes the next action.
