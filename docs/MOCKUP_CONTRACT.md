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
and physical-size metadata.

The transform is the sole placement authority. A normalized destination is
resolved against the declared mockup canvas. A pixel destination must name a
reference exactly equal to that canvas. Source fit, orientation, and bounded
Warp retain the existing transform semantics. Grid and physical measurement
describe the projective plane itself; they do not follow an optional content
Warp.

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
contract. Samples outside the source remain transparent.

## Shared edges, grids, and measurement

A seam names two explicit plane edges. Worldbend compares the two endpoint
pairs both in authored direction and reversed direction, records which match
is closer, and accepts only a maximum endpoint error at or below the supplied
non-negative pixel tolerance. It never moves either plane to manufacture a
match. A failed claim returns `E_SHARED_EDGE_MISMATCH`.

A grid contains 1 through 64 columns and rows. Its returned line endpoints are
obtained from the exact solved homography. Physical size is caller-authored;
Worldbend returns edge lengths and pixels-per-unit values without inferring
real-world scale.

## Planning, rendering, and side effects

Planning returns `worldbend.mockup-plan@0.1`, including every solved transform,
grid, measurement, and seam diagnostic. Rendering returns the same plan,
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
size, and direct four-corner placement. Every preview first passes through the
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
