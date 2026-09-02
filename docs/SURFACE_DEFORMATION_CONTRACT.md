# Surface Deformation contract

`worldbend.surface-deformation@0.1` is an Agent/full-only, deterministic
authoring operation that resolves bounded Split/Bezier controls, anchors, and
ordered stroke samples into the existing canonical `worldbend.mesh-warp@0.1`
execution model. It does not introduce a second rasterizer or an inferred
Liquify model.

## Input

A `SurfaceDeformationSpec` contains one ordinary `TransformSpec`, its optional
normalized `targetSize`, a `meshSubdivisions` value from 4 through 16, one
Bezier envelope, zero or more anchors, and zero or more ordered strokes. The
base transform must not also contain a preset Warp.

The envelope declares 1..4 horizontal and 1..4 vertical cubic patches. Its
row-major control lattice has exactly `(columns * 3 + 1) * (rows * 3 + 1)`
normalized points. `meshSubdivisions` must be divisible by both patch counts.
Every boundary control must equal the corresponding regular unit-square point;
the base TransformSpec therefore remains the sole owner of the outer
quadrilateral. Interior controls are finite and bounded to `[-2,3]` per axis.

An anchor has a unique bounded ID plus a concrete `column,row` vertex in the
resolved mesh. Boundary vertices are already fixed and cannot be repeated as
anchors. An anchor locks the Bezier-resolved position of that vertex while all
later strokes are replayed.

A stroke has a unique bounded ID and 1..256 ordered samples. The complete spec
may contain at most 64 anchors, 64 strokes, and 1,024 samples. Each sample has:

- a normalized source-space `position` in `[0,1]`;
- a normalized `delta` with each component in `[-1,1]`;
- `radius` in `[0.001,2]` and `strength` in `[0,1]`.

For every sample, each unlocked interior mesh vertex receives
`delta * strength * smoothstep(1 - distance/radius)` when it is inside the
radius. Samples and strokes apply in their declared order. Distance is always
measured in the undeformed normalized source grid, so replay does not depend on
pointer sampling rate, host events, or prior raster output.

## Plan and execution

The planner evaluates each cubic patch with the tensor-product Bernstein basis,
applies the ordered strokes, restores anchored vertices, and validates the
resolved `WarpMesh`. Folded, degenerate, non-finite, over-limit, malformed, or
boundary-moving results fail with the existing stable error classes. A valid
plan contains the original spec, the resolved canonical MeshWarp plan, the
resolved anchor indices, and the total stroke-sample count.

Native rendering delegates to the current mesh renderer, including inverse
mapping, premultiplied-alpha filtering, configured limits, cancellation, dry
run, and atomic PNG publication. CLI and compact Agent operations expose plan
and render. Web, Figma, ComfyUI, and the conditional portable Capability do not
gain this operation merely because it exists in the source superset.

## Non-goals

The contract does not infer strokes from pointer history, solve a cage from an
image, simulate cloth or physics, move the outer quad, accept arbitrary
triangulation, or claim Photoshop Liquify/Puppet Warp compatibility.
