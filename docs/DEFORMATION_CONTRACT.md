# Deterministic deformation and remap contract

Worldbend deformation accepts caller-authored geometry or raster fields and
executes them without perception. It never detects a subject, estimates depth
or optical flow, infers a lens, or repairs an invalid
mesh.

## Custom mesh

`worldbend.mesh-warp@0.1` combines one ordinary `TransformSpec` with one
canonical mesh topology. Its wire object has `vertices` and exactly one of:

- `subdivisions`: a row-major regular source grid with 2 through 16
  subdivisions per axis. With `boundary: "free"`, authored surfaces may
  contain up to 32 subdivisions. Every source vertex is its exact grid UV;
  each cell uses TL/TR/BR and TL/BR/BL triangles.
- `triangles`: 2 through 4,096 explicit triples of vertex indices over 4
  through 2,048 vertices. Source UVs cover the unit square once. Faces form
  one conforming triangulated disk with a single square source boundary;
  duplicate faces, missing or unused vertices, non-manifold edges or vertex
  fans, incomplete coverage and mixed topology fields are errors.

`boundary` defaults to `fixed`: boundary target positions equal their source
positions. `free` allows a simple, non-self-touching target outline within the
unit placement bounds, including concavity. Both source and target triangles
retain positive, non-collapsed orientation. Indexed faces use a normalized area
floor of `1e-12`, allowing legitimate subpixel intersection faces; regular-grid
faces retain their existing `1e-8` floor. Both reject zero or reversed area.
Optional `shading` supplies one
finite encoded premultiplied RGB multiplier in 0..2 per vertex, leaving alpha
unchanged. Indexed triangles preserve the declared mapping; carriers do not
resample them into a regular grid. Malformed or excessive meshes are rejected
before sampling or geometry-buffer allocation.

The existing projective transform is resolved first, then the caller-authored
mesh deforms its normalized source plane. A TransformSpec preset Warp and a
custom mesh are mutually exclusive. Rendering reuses the native inverse mesh
sampler and spatial index rather than introducing adapter-side geometry.
Source raster planning includes custom meshes even when the transform has no
preset Warp, so their magnified regions receive appropriate input resolution.

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
The WebGL carrier applies that rule to individual linear or cubic filter taps,
including partially outside transparent footprints and wrapped edge taps. Source
colors are premultiplied during filtering; displacement-map channels retain their
straight decoded values. Its output pixel centers follow the actual canvas size,
including a smaller presentation preview. Browser/host raster comparisons use
visible compositing and alpha tolerances, with the same captured source bytes.
Separate Figma Desktop and MCP source exports can differ in text antialiasing;
replaying an operation does not make those independently captured rasters identical.

## Limits and carriers

All inputs are finite and bounded before allocation. Agent file paths retain
the granted-root, private-worker, dry-run, hash, cancellation, and atomic-file
publication rules. The Agent `full` build exposes plan/render operations for
both custom mesh and remap through the compact catalog. One replayable
deformation work that unifies Plane, Pin, and Mesh editing views — including
persistence migration from both families below — is owned separately by
[docs/DEFORMATION_WORK_CONTRACT.md](DEFORMATION_WORK_CONTRACT.md). ComfyUI includes only
the graph-native remap family: one reusable Remap value can drive a primary
IMAGE, MASK, and compatible control images with the same map. The current
Comfy tensor adapter remains 8-bit; high-precision control-raster execution is
presently a CLI and Agent source-superset capability.

Figma includes bounded task-native projections for both families. Mesh accepts
one selected source, exposes a 2 through 16 grid and direct control points, and
renders only after the canonical Mesh plan. The shared Deformation Work defaults
to a fixed boundary; its Free outline mode also exposes edge and corner vertices
and retains them across view changes, publication and continued editing.
Remap accepts one source for Lens or a source plus one explicit map for
Displacement, exposes the declared coefficients/channels/scales/neutral/boundary,
and renders the exact core-validated program in WebGL. Advanced Lens values are
transient disclosure, not permanent instructional chrome. Both outputs retain
their canonical spec for source-plus-result replacement. Figma retains its
4096-pixel per-axis boundary; it does not infer a lens, map, mesh, subject,
depth, or optical flow. The reduced Comfy build continues to omit custom Mesh.
