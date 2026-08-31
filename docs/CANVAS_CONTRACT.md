# Worldbend Canvas contract

Status: implementation contract for the owner-authorized Canvas and
multi-output phase.

## Boundary

Worldbend Canvas is an exact raster program. A human, Agent, or upstream node
chooses the operation, dimensions, anchor, background, and output variants.
Worldbend validates those values, resolves one reusable plan, and executes it.
It does not choose a crop, infer a salient subject, invent an aspect ratio, or
decide which variants a creative task needs.

Canvas is independent from `TransformSpec`. The existing transform contract
maps a normalized plane into a quadrilateral; Canvas maps an oriented raster
into one or more rectangular raster outputs. Adapters must not extend
`TransformSpec.content.fit` or reproduce Canvas geometry locally.

The canonical single-output schema is `worldbend.canvas@0.1`. The ordered
multi-output schema is `worldbend.canvas-set@0.1`. A Canvas Set is not a
general batch: every variant reads the same original raster independently,
variants cannot depend on one another, and the set has one success or one
failure.

## Closed operations

`CanvasOperation` is a closed tagged union with exactly six v0.1 kinds.

### Crop

`crop` takes an integer `PixelRect { x, y, width, height }` over the
orientation-corrected source. The rectangle is the half-open pixel-edge region
`[x,x+width) x [y,y+height)`, must be non-empty, and must be wholly inside the
source. Its output is exactly `width x height` and copies pixels without
resampling or fill.

### Trim

`trim` takes integer `alphaThreshold` in `0..254`. A primary-image pixel is
occupied only when its alpha is strictly greater than the threshold. The
resolved source rectangle is the smallest integer rectangle containing every
occupied pixel. An input with no occupied pixel fails with `E_TRIM_EMPTY`;
Worldbend never creates a zero-sized raster. Trim observes primary IMAGE alpha
only. A carrier that represents transparency as a separate mask must combine
that mask at its raster boundary before asking Worldbend to resolve Trim.

### Pad

`pad` takes non-negative integer `{ top, right, bottom, left }` and an explicit
background. It creates
`(source.width + left + right) x (source.height + top + bottom)`, places the
source at `(left, top)`, and does not resample it.

### Contain

`contain` takes an integer output size, normalized anchor, and explicit
background. For source size `sw x sh` and output `W x H`:

```text
s  = min(W / sw, H / sh)
rw = sw * s
rh = sh * s
dx = (W - rw) * anchor.x
dy = (H - rh) * anchor.y
```

It preserves aspect ratio and fills uncovered output pixels with the declared
background.

### Cover

`cover` uses the same fields and equations as Contain except
`s = max(W / sw, H / sh)`. Negative remaining space is clipped by the fixed
output rectangle; the anchor determines which side is discarded. It never
expands the declared output.

### Stretch

`stretch` takes only an integer output size and scales independently by
`W / sw` and `H / sh`. It has no anchor or background fields; a wire object
containing them is rejected by the closed schema.

## Shared values and resolved plans

`PixelSize` dimensions are positive integers. `NormalizedAnchor.x` and `.y`
are finite numbers in the closed range `[0,1]`. A background is exactly one of:

```json
{ "kind": "transparent" }
{ "kind": "color", "space": "srgb8", "rgba": [0, 0, 0, 255] }
```

Every color component is an integer in `0..255`. Source-over composition uses
the renderer's premultiplied-alpha path and emits straight-alpha 8-bit PNG.

Planning produces `CanvasPlan` or `CanvasSetPlan`. A plan records the oriented
source size, every resolved integer source rectangle, output size, floating
point placement rectangle, scale, operation kind, background, and stable
variant identity. Plan replay requires an input with exactly the recorded
source dimensions and never re-runs Trim. This is the synchronization
primitive for IMAGE, MASK, and compatible control maps.

Plan application must declare its raster behavior:

- primary color rendering uses the operation's declared background and the
  selected quality;
- replay may choose `linear` or `nearest` sampling and must declare an outside
  fill instead of inheriting a color-image background accidentally;
- Comfy MASK polarity remains an adapter concern; the core does not adopt
  Comfy's `1 = transparent` convention.

The v0.1 raster boundary is 8-bit RGBA. Ordinary 8-bit Canny, pose, and
segmentation maps can replay a plan. 16-bit depth, float normal/flow maps,
normal-vector renormalization, color profiles, and video are not implied by
this contract.

## Canvas Set

`CanvasSetSpec.variants` is ordered and contains `1..16` items. Each item has a
unique ID matching `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and one closed
`CanvasOperation`. Returned plans and results preserve this exact order.
Derived filenames are `${id}.png`; callers do not supply per-item paths.
Duplicate IDs or derived-name collisions fail with `E_OUTPUT_COLLISION`.

Every variant reads the original source. Worldbend never resizes a prior
variant to make the next one.

Core product ceilings are:

- at most 16 variants;
- at most 8192 pixels on either output axis;
- at most 32 Mi pixels in one output;
- at most 128 Mi output pixels cumulatively.

Carriers may narrow these ceilings without changing semantics. The first Agent
projection uses a 32 Mi-pixel cumulative set ceiling, Figma uses at most eight
variants, 4096 pixels per axis, and 32 Mi pixels cumulatively, and Comfy uses a
16 Mi-pixel cumulative ceiling because heterogeneous output lists remain live
as float tensors in the host.

All dimensions and cumulative products use checked arithmetic. Overflow fails
with `E_OUTPUT_LIMIT`.

## Agent execution and publication

The Agent surface adds one direct side-effect tool,
`worldbend.canvas_render`. It accepts one relative source path, either a
`CanvasSetSpec` or a previously returned `CanvasSetPlan`, one relative
`outputDirectory`, bounded render options, and `dryRun`. Plan replay also
requires explicit sampling and outside fill. It does not expose six operation
tools, a second planner tool, arbitrary per-item paths, or partial-success
controls.

The destination directory must not exist. Agent execution:

1. opens the source and destination parent through the granted descriptor root;
2. validates the complete request, IDs, dimensions, paths, and cumulative
   budgets;
3. decodes the source once;
4. resolves or validates the complete plan;
5. renders variants sequentially into a hidden directory beside the final
   destination;
6. checks cancellation, encoded-byte and complete-response budgets;
7. commits with one same-filesystem directory rename.

Any error, timeout, memory breach, or cancellation before the commit point
leaves no final directory. After the single rename the set is committed and
the response describes that committed state. v0.1 does not overwrite, merge,
or best-effort publish an existing directory. `dryRun` performs the same
decode, render, encode, hash, and response preflight but omits the final rename.

The current Agent ceilings remain one 20-second whole-call deadline, a
768-MiB worker, two execution slots, four admitted calls, a 1-MiB worker
request/response ceiling, a 128-MiB complete encoded-set ceiling, a 256-KiB
complete MCP response ceiling, and the 81,920-byte complete tool-catalog
ceiling. One Canvas Set occupies one slot.

## Carrier projections

Figma exposes Canvas as a sibling `ProductWorkspace`, not an `EditorMode`.
Perspective keeps its frozen Transform, Free, Perspective, Warp, Correct, More
sequence. A compact icon beside the selected source identity opens a short task
menu; Sizes enters the sibling workspace without entering the mode bar or More
menu. The human workspace exposes 1..8 named ordered outputs and all six
canonical operations: Crop, Trim, Pad, Contain, Cover, and Stretch. Only
operation-relevant controls remain visible. Trim obtains decoded RGBA from the
current source but delegates the strict alpha predicate and rectangle to the
core. One selected preview is live at a time; Apply creates all requested
images in one recoverable document mutation, while a selected saved result can
be replaced only as one output. Entering and returning preserves the complete
Perspective draft.

Comfy adds three V3 nodes: a Canvas Set spec node, an Apply Canvas Set node
that returns heterogeneous IMAGE/MASK output lists plus the resolved plan, and
an Apply Canvas Plan node for deterministic replay on a compatible 8-bit
control raster. Input batches and video remain rejected; list outputs are
ordered variants, not a tensor batch.

The conditional projective Capability projection remains unchanged. Canvas is
a different semantic operation and does not silently enter that profile.

## Stable failures

Canvas reuses the existing schema, media, output-limit, path, destination,
render, capacity, cancellation, timeout, memory, and internal error codes. It
adds only:

- `E_CROP_BOUNDS` for an empty, overflowing, or out-of-source Crop rectangle;
- `E_TRIM_EMPTY` when Trim finds no occupied alpha pixel;
- `E_RASTER_SHAPE_MISMATCH` when plan replay dimensions differ;
- `E_OUTPUT_COLLISION` for duplicate variant IDs or derived output names.

Error details may contain bounded variant ID, index, phase, dimensions, and
limit values. They never echo raster bytes or an unbounded request.

## Explicit exclusions

This phase does not add subject detection, saliency, content-aware extension,
arbitrary batch inputs, video/frame order, partial success, output-directory
overwrite, 16-bit/float maps, PSD semantics, an Agent planner, or a generalized
graphics registry. Those require separate explicit contracts.
