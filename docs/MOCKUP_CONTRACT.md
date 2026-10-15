# Place / Mockup contract

Worldbend Place / Mockup is a deterministic ordered multi-plane compositor. It
executes caller-authored canvases, source identities, transforms, shared-edge
claims, grids, measurements, opacity, and backgrounds. It does not detect a
plane, infer a box, choose artwork, estimate camera geometry, recognize a
screen, or repair seams.

## Document and ordering

`worldbend.mockup@0.1` contains one integer-pixel canvas, one explicit
background, 1 through 16 planes, and at most 32 declared seams. Plane array
order is back-to-front z-order. Every plane has a stable ID, a `sourceId`, one
ordinary `worldbend.transform@0.1`, an opacity in `[0,1]`, and optional grid
and physical-size metadata. An optional `surface` maps its content onto an
authored cylinder or fabric surface.

The transform is the sole placement authority. A normalized destination is
resolved against the declared mockup canvas. A pixel destination must name a
reference exactly equal to that canvas. Source fit, orientation, and bounded
Warp retain the existing transform semantics. Grid and physical measurement
describe the physical surface; they follow an authored curved surface and
remain independent of optional content Warp.

## Projected source-alpha shadows

An optional plane `shadow` contains a pixel `offset: {x,y}` (each finite and
within ±8192), `blurSigmaPx` (Gaussian standard deviation, 0..64 pixels), RGB8
`color`, and `opacity` (0..1). Omission preserves the previous wire format and
appearance. Zero strength retains authored settings without rendering a shadow.

Core plans `worldbend.projected-alpha-shadow@0.1`: the ordinary resolved caster
is translated into an expanded sample canvas, then its blurred alpha is cropped
back to the scene. The inset is `ceil(3 * blurSigmaPx)` on each side; an invisible
shadow uses zero inset. Expanded sampling remains within the 64 Mi pixel budget.
The caster may lie outside the scene and still cast a visible shadow into it.
Content orientation, Warp and curved surface mapping apply to both the source
and its shadow; transparent holes remain part of the caster alpha.

The shadow composites immediately before its plane, in back-to-front order.
Its coverage multiplies source alpha, plane opacity and shadow opacity. Later
planes can cover earlier shadows; whole-scene clipping applies to both. This is
an authored image-plane shadow, with no inferred light or scene-depth occlusion.

Native rendering uses transparent-edge separable Gaussian filtering for narrow
kernels and a three-box Gaussian approximation for larger kernels, with line
cancellation checks. Web and the Figma UI use the Canvas Gaussian filter backend;
`blurSigmaPx` follows the [Filter Effects standard](https://www.w3.org/TR/filter-effects-1/#funcdef-filter-blur).
Sampling, edge rounding and backend approximation can differ between carriers;
canonical caster plans agree, while pixel identity is not promised.

## Curved surfaces and lighting

`surface.kind` is `cylinder` or `fabric`. Cylinder controls are `curvature`
in `[0,1]` and optional `tilt` in `[-1,1]` (default 0). Fabric controls are
integer `folds` from 1 through 4, `depth` in `[0,1]`, and optional `phase` in
`[0,1]` (default 0). All controls must be finite; unknown fields are rejected.
The curved outline stays inside the ordinary four-corner placement bounds.
Cylinder mapping compresses artwork as the sides turn away; fabric mapping
changes the silhouette and follows the authored fold positions.

Optional `light` contains `strength` in `[0,1]` and `direction` in `[-1,1]`;
negative direction lights from the left and positive from the right. Omitted
light defaults to strength 0.65 and direction -0.45. Zero strength removes
shading without changing geometry. Lighting multiplies encoded, premultiplied
RGB and clamps it to the sample's alpha; it does not change alpha or source
opacity. It is a controlled directional surface treatment, rather than a
photographic illumination or material reconstruction.

The core composes existing content Warp first, then creates the shared 32×32
piecewise-linear surface mesh and per-vertex light multipliers. Native and
WebGL carriers consume the same vertices, triangle topology and interpolated
light. Free outlines must be simple, finite, inside the unit placement bounds
and contain no folded or collapsed triangles. Ordinary Warp and custom Mesh
retain their existing fixed-boundary, at-most-16×16 contract. Zero curvature
or depth delegates the existing plane path exactly, including any content
Warp. Old specs and preset-mesh JSON retain their omitted defaults.

For example, a plane can add:

```json
"surface": {
  "kind": "cylinder",
  "curvature": 0.8,
  "tilt": 0.2,
  "light": { "strength": 0.65, "direction": -0.45 }
}
```

Plans echo compact surface controls. `build_mockup_surface_mesh` and the Web
`buildMockupSurfaceMesh` bridge derive the renderer mesh; adapters do not own
their own cylinder, fold or light formula.

An optional `clip` masks the composed canvas — background and planes — to one
explicit closed region in normalized canvas coordinates. Clipping is the only
meaning: planes are never reshaped to the outline. The clip holds 1 through 8
contours; each contour is 2 through 128 `line` or `cubic` segments closing
implicitly back to its start, with at most 512 segments in total. Coordinates
are finite and may extend past the canvas. Their pixel coordinates, flattened geometry,
bounds and area must also remain finite; numerical overflow is rejected with
`E_NON_FINITE_COORDINATE` before returning a plan. A `nonZero` (default) or `evenOdd`
fill rule governs winding and holes exactly as authored. An optional `regions`
array preserves up to eight independent filled regions: each region declares
its own `fillRule` and distinct `contourIndices` into the clip's contours. Every
contour must belong to at least one region; references must exist. Regions are
combined by geometric union, so overlaps neither cancel nor multiply coverage.
When regions are omitted, the existing compound-path fill rule applies.
Contour and segment limits apply to the entire clip, rather than restarting
for each region. Self-intersecting
outlines are not guessed into anything simpler. A flattened contour covering
no canvas area is rejected with `E_CLIP_DEGENERATE`. The plan echoes the clip
with the flattened canvas-pixel bounds and the per-contour area sum, which for
compound or overlapping contours is an upper bound rather than the exact
covered region.

## Sources and composition

A render request supplies exactly one local source raster for every distinct
`sourceId` and no extras. Multiple planes may deliberately reuse one source.
Sources are decoded with the existing orientation, media, byte, and pixel
limits. The cumulative decoded-source limit is 64 Mi pixels. The output canvas
uses the core 8,192-pixel per-axis and 64-Mi-pixel limits, further narrowed by
the invoking carrier.

Each plane is rendered into the declared reference canvas through the shared
inverse-mapping rasterizer. Planes are then composited in array order using
source-over alpha after multiplying source alpha by the explicit plane
opacity. Transparent and explicit sRGB8 backgrounds reuse the Canvas color
contract. Samples outside the source remain transparent. When a clip is
present, the composed canvas — including any background color — is masked to
its covered region: pixel alpha is multiplied by the clip coverage, computed
by a deterministic scanline fill of the flattened contours under the declared
fill rules. Each sample line unions the regions' covered intervals before
computing coverage, so overlapping edges are counted once.

## Shared edges, grids, and measurement

A seam names two explicit plane edges. Worldbend compares the two endpoint
pairs for flat planes, and the complete sampled edge curves when a curved
surface is present, both in authored direction and reversed direction. It
records which match is closer and accepts only a maximum error at or below the supplied
non-negative pixel tolerance. It never moves either plane to manufacture a
match. A failed claim returns `E_SHARED_EDGE_MISMATCH`.

A grid contains 1 through 64 columns and rows. Its returned line endpoints are
obtained from the exact solved homography. Curved grids additionally carry
33-point `points` polylines along the shared surface. Physical size is caller-authored;
Worldbend returns edge lengths and pixels-per-unit values without inferring
real-world scale. Curved edge lengths measure the projected polylines, rather
than only their endpoint chords.

## Planning, rendering, and side effects

Planning returns `worldbend.mockup-plan@0.1`, including every solved transform,
grid, measurement, and seam diagnostic, plus the resolved clip geometry when a
clip is authored. Rendering returns the same plan,
source and output digests, encoded bytes, dimensions, timings, and bounded
diagnostics.

CLI paths are deliberate operator paths. Agent paths remain relative to an
explicit granted root and use descriptor-scoped source reads. Destination and
overwrite authority are preflighted before admission. Worker inputs are copied
into a private staging directory, the full PNG is encoded and synchronized,
and publication is one atomic file replacement. Dry-run executes the same
plan, decode, render, encode, and destination preflight without publishing.
Cancellation, timeout, capacity, worker memory, and cleanup retain the common
MCP meanings.

## Carrier projection

The Agent `full` native feature exposes `mockup_plan`, `mockup_render`,
`mockup_extract_plan`, and `mockup_extract_render` through the compact catalog.
The eight historical direct tools remain unchanged.

Figma owns a narrower human composition route for 1 through 8 currently
selected source layers. Their selection order is the explicit source order;
their current document bounds seed an editable canvas and one ordered plane per
source. The workspace exposes plane selection, opacity, optional grid, output
size, direct four-corner placement, Cylinder/Fabric controls and lighting,
and the shared bounded Warp for each selected
plane. Layer Warp deforms that plane's content while retaining its outer
placement; an independent Composition postprocess can transform the assembled
result. Reopen, Undo and linked-result refresh retain both. The human strength
field accepts fractional percentages; a preset-only edit preserves the exact
saved core strength, including Agent-authored values. Every preview first passes through the
canonical Mockup planner, then the WebGL transform renderer composites the
declared planes. It stores only the canonical spec on the result. Seam and
physical-measurement authoring, source reuse beyond current selection, and
reverse extraction remain Agent routes until a comparably task-native Figma
interaction exists. ComfyUI still does not claim Place / Mockup.

Reverse extraction uses `worldbend.mockup-extract@0.1`: 1 through 16 ordered,
uniquely identified Rectify programs all read the original source and produce
`<id>.png`. Planning preflights the 64-Mi-pixel cumulative core ceiling.
Rendering stages the complete ordered set, verifies filenames, dimensions,
hashes, and encoded-byte limits, then publishes one new directory atomically.
Dry-run performs the same work without publication; any failure or
cancellation publishes no partial set.

A complete authored scene — its checked-in plan as numeric ground truth and a
consumer convention check for downstream matrix application — lives at
`examples/layered-scene/`.
