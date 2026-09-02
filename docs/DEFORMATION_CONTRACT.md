# Deterministic deformation and remap contract

Worldbend deformation accepts caller-authored geometry or raster fields and
executes them without perception. It never detects a subject, estimates depth
or optical flow, infers a lens, chooses control points, or repairs an invalid
mesh.

## Custom mesh

`worldbend.mesh-warp@0.1` combines one ordinary `TransformSpec` with a regular
source grid containing 2 through 16 subdivisions per axis (3 x 3 through
17 x 17 vertices). Source vertices must remain the exact row-major regular
grid. Boundary vertices remain fixed. Every generated triangle must retain
positive, non-collapsed orientation; folded, missing, reordered, or excessive
meshes are rejected before rendering.

The existing projective transform is resolved first, then the caller-authored
mesh deforms its normalized source plane. A TransformSpec preset Warp and a
custom mesh are mutually exclusive. Rendering reuses the native inverse mesh
sampler and spatial index rather than introducing adapter-side geometry.

## Lens and displacement remap

`worldbend.remap@0.1` declares an integer output and exactly one operation:

- `lens` applies explicit Brown-Conrady radial `k1`/`k2`/`k3` and tangential
  `p1`/`p2` coefficients around an explicit normalized center and scale. The
  formula maps each output sample to a source coordinate; it is not an
  automatic lens-calibration or correction claim.
- `displacement` reads explicit X and Y channels from one required map raster,
  subtracts the declared 8-bit neutral value, applies pixel scales, and uses
  one explicit `transparent`, `clamp`, or `wrap` source-boundary rule. Red,
  green, blue, alpha, and luminance channels are supported.
- `displacementUnit` uses the same explicit geometry but declares neutral in
  `[0,1]` and samples u8, u16, or f32 map channels before subtraction. It is
  the high-precision control-raster route; no u8 conversion precedes the
  mapping.

Map presence is exact: displacement requires one map and lens rejects one.
The map is sampled over normalized output coordinates in its decoded channel
precision. `preview` uses nearest
source sampling, `standard` uses premultiplied-alpha linear sampling, and
`high` uses premultiplied-alpha Catmull-Rom cubic reconstruction. Every path
applies the declared transparent, clamp, or wrap source-boundary rule.

## Limits and carriers

All inputs are finite and bounded before allocation. Agent file paths retain
the granted-root, private-worker, dry-run, hash, cancellation, and atomic-file
publication rules. The Agent `full` build exposes plan/render operations for
both custom mesh and remap through the compact catalog. ComfyUI includes only
the graph-native remap family: one reusable Remap value can drive a primary
IMAGE, MASK, and compatible control images with the same map. The current
Comfy tensor adapter remains 8-bit; high-precision control-raster execution is
presently a CLI and Agent source-superset capability.

Figma includes bounded task-native projections for both families. Mesh accepts
one selected source, keeps the boundary fixed, exposes a 2 through 16 grid and
direct interior control points, and renders only after the canonical Mesh plan.
Remap accepts one source for Lens or a source plus one explicit map for
Displacement, exposes the declared coefficients/channels/scales/neutral/boundary,
and renders the exact core-validated program in WebGL. Advanced Lens values are
transient disclosure, not permanent instructional chrome. Both outputs retain
their canonical spec for source-plus-result replacement. Figma retains its
4096-pixel per-axis boundary; it does not infer a lens, map, mesh, subject,
depth, or optical flow. The reduced Comfy build continues to omit custom Mesh.
