---
name: worldbend
description: Compose scale, clockwise rotation, skew, translation, source flips, or one bounded common Warp preset over an explicit transform plane; solve, inspect, rasterize, rectify one explicitly supplied source quadrilateral, create explicit Canvas variants, or emit CSS for projective planes without a non-zero Warp. For compose, omit pivot unless the user changes it; pivot is bounds-relative and defaults to center (0.5,0.5), never pixels. Use for TL/TR/BR/BL geometry, reusable TransformSpec, RectifySpec, or CanvasSetSpec data, source replacement, bounded preset deformation, and deterministic multi-size raster output. Do not use for plane detection, salient-subject crop selection, inferred output proportions, custom meshes, 3D, or camera estimation.
---

# Worldbend

Use the installed Worldbend tools as the geometry authority. The tools consume
explicit planes; they do not guess a screen, package face, vanishing point, or
other target from an image.

## Route the request

1. Call `worldbend.compose` once when the user supplies semantic scale,
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
2. Call `worldbend.solve` once when the user supplies four corners or asks for
   a reusable perspective mapping. Preserve the strict `tl`, `tr`, `br`, `bl`
   meaning and present stable geometry errors instead of silently reordering.
3. Call `worldbend.rectify` once when the user or an upstream system already
   supplies a source-image quadrilateral and explicit integer output width and
   height. Preserve strict `tl`, `tr`, `br`, `bl` meaning. Do not inspect the
   image, infer aspect ratio, or estimate a camera. Call
   `worldbend.rectify_render` instead when a local PNG, JPEG, or WebP must be
   flattened into the declared PNG output; its paths use the same explicit
   workspace authority and dry-run semantics as ordinary render.
4. Call `worldbend.inspect` once for an existing `TransformSpec` whose current
   validity, bounds, reprojection, or horizon safety matters.
5. Call `worldbend.canvas_render` once when the caller has already supplied
   exact Crop, Trim threshold, Pad insets, Contain, Cover, or Stretch values
   and one or more explicit output variants. Use the returned resolved plan to
   replay content-dependent Trim geometry on another same-sized 8-bit raster.
   The output directory must be a new relative directory; one call publishes
   the complete ordered set or publishes nothing. Do not choose a crop,
   background, anchor, or aspect ratio for the caller.
6. Call `worldbend.render` once to apply or reuse a saved mapping on a local
   PNG, JPEG, or WebP. Paths are relative to the explicitly granted workspace.
   Use `dryRun: true` when overwrite authority or output feasibility is not yet
   established; do not claim a file was written from a dry-run result.
7. Call `worldbend.css` once for a live image, video, iframe, canvas, or DOM
   element. Supply the element size and, for normalized planes, the concrete
   destination size. CSS cannot represent a Warp whose `amount` is non-zero;
   `amount: 0` is identity and remains CSS-representable. Use render or the Web
   preview for every non-zero Warp.

Do not add a discovery call before these dominant tasks. Do not estimate a
homography in model reasoning when the tool is available.

## Boundaries

- Automatic plane detection, salient-subject crop selection, output-size inference, segmentation, camera estimation, custom mesh
  Warp, split Warp, 3D, and artistic brush distortion are separate capabilities.
- A render workspace is available only when the host grants
  `WORLDBEND_WORKSPACE_ROOT`. If it is absent, compose, solve, inspect, and
  CSS and rectification planning remain available; report that file rendering
  needs an explicit workspace grant.
- Keep matrices and numerical diagnostics concise unless the user needs them.
  For ordinary work, present the saved spec, output path, placement, and any
  warning or stable error that changes the next action.
