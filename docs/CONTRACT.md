# Worldbend executable contract v0.1

See [PRODUCT_MODEL.md](PRODUCT_MODEL.md) for product capabilities. This contract owns the
TransformSpec, a semantic affine composer, and one bounded common-preset Warp
slice without weakening existing plane validation.

## Canonical data

```json
{
  "schema": "worldbend.transform",
  "version": "0.1",
  "destination": {
    "space": "pixel",
    "reference": { "width": 1440, "height": 900 },
    "quad": {
      "tl": { "x": 221.5, "y": 103.0 },
      "tr": { "x": 1066.0, "y": 171.5 },
      "br": { "x": 991.0, "y": 704.0 },
      "bl": { "x": 287.0, "y": 659.5 }
    }
  },
  "content": { "fit": "stretch" }
}
```

`pixel` space requires a present, positive, finite reference size.
`normalized` space omits `reference` and uses destination coordinates relative
to a later concrete container size. It names the coordinate scale, not a clip
window: finite destination coordinates may be below zero or above one when a
corner extends beyond the source reference rectangle. Adapters must preserve
those values and leave geometry validity to the core. Missing and explicit
`null` are not treated as interchangeable at this union boundary. Version 0.1
supports only `stretch`; cropping and object-fit policies are not implicit.

`content.orientation` records explicit source orientation: `native` (default,
omitted on the wire), `flipHorizontal`, `flipVertical`, or `flipBoth`. A flip
mirrors the source plane inside the unchanged destination quad; the quad keeps
its validated TL, TR, BR, BL winding and corner identity, and the solved
homography becomes orientation-reversing by mapping the mirrored source
corners. Flips must never be expressed by reordering destination corners.

`content.warp`, when present, is exactly `{ "preset": <name>, "amount":
<number> }`. The only preset names are `arc`, `arch`, `flag`, `wave`, `fish`,
`rise`, `fisheye`, `inflate`, `squeeze`, and `twist`; `amount` is finite and in
the closed interval `[-1,1]`, with zero defined as identity and negative values
reversing direction. The core expands this value into one fixed 16x16
piecewise-linear mesh whose unit-square boundary stays fixed and whose
triangles must retain positive area. Custom mesh vertices, resolution, split
controls, handles, and curves are not part of v0.1.

Unknown fields are rejected at every Agent-authored boundary.

The opt-in editable Figma carrier and shared result/source handoff are owned
by `docs/FIGMA_HANDOFF.md`. They consume this same TransformSpec and core
inverse, preserving source orientation and corner identity. Visual controls,
native content editing and multimodal Agent inspection are authoring surfaces;
the serialized operation does not require a text-based human workflow.

## Explicit planar rectification data

Rectification is a separate operation contract, not an optional
`TransformSpec` field:

```json
{
  "schema": "worldbend.rectify",
  "version": "0.1",
  "source": {
    "space": "normalized",
    "quad": {
      "tl": { "x": 0.12, "y": 0.16 },
      "tr": { "x": 0.88, "y": 0.08 },
      "br": { "x": 0.82, "y": 0.92 },
      "bl": { "x": 0.18, "y": 0.84 }
    }
  },
  "output": { "width": 1200, "height": 800 }
}
```

The source quad is strict `TL -> TR -> BR -> BL`. Normalized source data omits
`reference`; pixel source data requires the positive reference size in which
the points were authored. Output width and height are positive integers and
are never inferred from edge lengths, pixels, vanishing points, EXIF, or a
camera model. The plan maps that explicit source quad to the complete output
rectangle, reports the resolved source quad, homography and diagnostics, and
returns an identity output TransformSpec. Rasterization uses the same native
inverse sampler, premultiplied-alpha filtering, limits, and atomic publication
as ordinary render. Extending the mapping outside the selected source quad is
not part of the rectification promise.

## Explicit plane pose and shared strips

Explicit tilt/perspective posing of one live plane and ordered shared-plane
strips are authoring conveniences over the same `TransformSpec` and CSS
adapter, not camera estimation or a second transform model. Pose values are
caller-authored; the core rejects non-finite, out-of-range, and
horizon-crossing poses with existing codes and never silently clamps,
reorders, or flips corners. One strip partitions one solved plane into 1..32
ordered panels whose top edges stay collinear and whose bottom edges stay
collinear; any invalid panel rejects the complete plan with no partial
results. Exact input order, units, carrier availability, live web binding
ownership, and disposal semantics are owned by
`docs/PLANE_POSE_CONTRACT.md`.

## Explicit Canvas and multi-output data

`worldbend.canvas@0.1` and `worldbend.canvas-set@0.1` are independent from
`TransformSpec` and `RectifySpec`. They encode exact Crop, alpha-threshold
Trim, Pad, Contain, Cover, or Stretch work over one oriented raster. An ordered
Canvas Set contains 1..16 safe unique variant IDs; every variant reads the same
original input and the set has one success or one failure. The core returns a
resolved plan whose source rectangles and placements can be replayed on a
same-sized 8-bit raster without re-running content-dependent Trim. Exact
operation equations, backgrounds, carrier ceilings, directory commit, and
exclusions are owned by `docs/CANVAS_CONTRACT.md`.

## Explicit Place, deformation, remap, and Timeline data

Multi-plane placement and reverse extraction are owned by
`docs/MOCKUP_CONTRACT.md`. Caller-authored custom grids and explicit
Brown-Conrady or channel-displacement remaps are owned by
`docs/DEFORMATION_CONTRACT.md`. Ordered explicit frames and linear corner
keyframes are owned by `docs/TIMELINE_CONTRACT.md`. These are independent
versioned programs, not optional TransformSpec fields, perception features, or
adapter-local loops.

Bounded cubic patch lattices, fixed boundaries, explicit interior anchors, and
ordered source-space deformation strokes are owned by
`docs/SURFACE_DEFORMATION_CONTRACT.md`. The resolved result is the existing
canonical Mesh plan; the surface contract is not pointer replay or a second
rasterizer. Rational frame rates, exact presentation times, and linear, hold,
or cubic-Bezier keyframe easing are owned by `docs/MOTION_CONTRACT.md`. Motion
resolves to the existing Timeline and keeps its cumulative resource,
cancellation, and atomic directory semantics.

Production raster precision/format behavior, opaque ICC preservation,
high-precision displacement controls, vector-preserving carriers, and
large-destination tiling are owned by `docs/MEDIA_PIPELINE_CONTRACT.md`. Those
routes consume the same TransformSpec or RemapSpec semantics and do not weaken
the stable geometry or publication boundaries above.

Read-only PSD/PSB Smart Object inspection and caller-selected Spatial Template
projection are owned by `docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md`. That
adapter has its own bounded parser and source facts; it does not extract
embedded assets, fetch linked files, write PSD/PSB, approximate unsupported
warps, or move Photoshop document semantics into `worldbend-core`.

## Ordered single-raster program

`worldbend.raster-program@0.1` composes 1..8 already-defined Transform,
Rectify, and Canvas stages over one raster in strict order. Every stage has one
safe unique ID. Execution preflights the next output and cumulative processed
pixels before allocating it, keeps intermediate rasters in memory, and has one
final PNG publication boundary. A failure, cancellation, timeout, response
budget failure, or dry-run publishes no file. The program is not a public
batch operation: it has one source, one final output, no fan-out, no partial
success, and no per-stage publication. Exact semantics and exclusions are
owned by `docs/RASTER_PROGRAM_CONTRACT.md`.

## Stable errors

| Code | Meaning |
| --- | --- |
| `E_SCHEMA` | malformed or unsupported spec |
| `E_NON_FINITE_COORDINATE` | point or size is NaN/infinite |
| `E_QUAD_SELF_INTERSECT` | non-simple corner order |
| `E_QUAD_CONCAVE` | a simple but non-convex quad |
| `E_QUAD_ORIENTATION` | mirrored corner order rather than TL, TR, BR, BL |
| `E_QUAD_DEGENERATE` | area below the centralized tolerance |
| `E_EDGE_TOO_SHORT` | adjacent points collapse under tolerance |
| `E_HOMOGRAPHY_SINGULAR` | matrix cannot be solved or inverted |
| `E_HOMOGRAPHY_HORIZON_CROSSING` | projective denominator reaches/crosses zero in the source |
| `E_REPROJECTION` | solved matrix cannot reproduce the controls |
| `E_UNSUPPORTED_MEDIA` | unsupported or undecodable raster input |
| `E_OUTPUT_LIMIT` | requested raster exceeds configured bounds |
| `E_CROP_BOUNDS` | explicit Canvas Crop is empty, overflowing, or outside the source |
| `E_TRIM_EMPTY` | Canvas Trim found no alpha above its explicit threshold |
| `E_RASTER_SHAPE_MISMATCH` | a raster does not match the dimensions recorded by a resolved Canvas Plan |
| `E_OUTPUT_COLLISION` | Canvas variant IDs or derived output names collide |
| `E_SHARED_EDGE_MISMATCH` | declared Place / Mockup plane edges differ beyond their explicit tolerance |
| `E_PATH_OUTSIDE_ROOT` | MCP path is outside its granted workspace |
| `E_PATH_SYMLINK` | MCP path traversal encountered a symlink |
| `E_DESTINATION_EXISTS` | output exists without overwrite authority |
| `E_RENDER` | bounded render or encode failure |
| `E_CAPACITY` | render admission is full; no worker or queue slot was acquired |
| `E_CANCELLED` | the MCP client cancelled the call; admission, worker, and staging were released before publication |
| `E_TIMEOUT` | bounded worker exceeded its whole-call deadline |
| `E_MEMORY` | bounded worker exceeded memory or terminated under its resource ceiling |
| `E_INTERNAL` | unexpected internal failure |

Failures expose `code`, `message`, and optional bounded `details`. Human text is
not required for machine classification. Both the text summary and the
structured `message` stay within the MCP schema-error character bound; echoed
Agent input (for example a rejected `schema` header) is truncated at the point
of construction in the core, so the 256 KiB response backstop never becomes
the only bound and a large echo cannot flip a stable code into `E_OUTPUT_LIMIT`.
`E_CAPACITY` and `E_CANCELLED` are MCP-transport-only: the CLI has no caller
to cancel or crowd it out, and the Capability projection narrows both into its
closed provider failure. `E_HOMOGRAPHY_HORIZON_CROSSING` is defensive at the
solve boundary: a validated convex destination quad keeps the projective
denominator one-signed across the source plane, so solve/inspect/compose inputs
cannot reach it. Its reachable behavior lives in render sampling and warp
footprint probes, where a sample near a horizon degrades to fallback filtering
instead of failing the render; renderer regressions pin that degradation.

## Geometry and diagnostics

The core solves a row-major 3x3 matrix `H` such that:

```text
[x', y', w']^T = H [u, v, 1]^T
x = x' / w'
y = y' / w'
```

The normalized result uses `H[8] = 1` when numerically valid. Every successful
solve returns `H`, its inverse, axis-aligned bounds, geometry diagnostics,
matrix determinant and minimum absolute corner denominator, and per-corner plus
maximum/mean reprojection error. Maximum reprojection error must be below
`1e-6 * referenceDiagonal` (or the destination-unit diagonal in unresolved
normalized space).

## Semantic affine composition

`TransformRecipe` composes over a resolved TransformSpec in this fixed order:
scale, horizontal/vertical skew, clockwise screen-space rotation, then
translation, all around a pivot expressed relative to the current destination
bounds. Scale must stay greater than 1e-6. `flip` carries explicit
source-orientation booleans that XOR into the composed spec's
`content.orientation`; they never enter the destination-space affine matrix,
so the composed quad, bounds, canvas, and matrix are identical with and
without a flip. Skew follows CSS `skew(x, y)`
semantics: both shears apply simultaneously, with x shifted by `y * tan(x)`
and y shifted by `x * tan(y)`, each angle strictly between -89 and 89 degrees.
The pivot accepts any finite pair normalized against the destination bounds;
values outside `[0,1]` simply anchor outside the bounds, and the default is
`(0.5, 0.5)`. The pivot only anchors subsequent operations; changing it never
moves the composed plane. An Agent re-anchoring an already composed result
compensates the translation directly: with the composition's linear part `K`
and pivots `p -> p'`, add `(I-K)(p-p')` to the translation instead of
recomputing matrices.

Composition returns the raw transformed quad, its bounds, an integer tight
canvas using floor(left/top) and ceil(right/bottom), a normalized TransformSpec
for that canvas, the affine matrix, and current solve diagnostics. It does not
rasterize. Adapters may preview or continue composing from the returned spec;
only their explicit Apply/render action may encode pixels. The returned spec's
corner labels keep source-corner identity: after a quarter rotation the `tl`
label names the source's top-left corner even where it lands on the canvas,
because renumbering would introduce a mirror. A composition whose tight canvas
is not representable reuses `E_OUTPUT_LIMIT` even though no configured raster
limit was consulted.

If `TransformRecipe.warp` is present it replaces the composed spec's bounded
warp; omission preserves the base spec's warp. Explicit `clearWarp: true`
removes the base warp and is mutually exclusive with `warp`. Warp is content
deformation, not destination-plane geometry: it does not alter the affine
matrix, corner labels, tight canvas, or homography diagnostics. This keeps
Transform, Distort, Warp, source orientation, and source replacement
cumulative without an intermediate rasterization.

## Raster convention

- inverse map destination pixel centers through `H^-1`, then through the
  core-owned piecewise-linear warp mesh when `content.warp` is present;
- image extent is `[0,width] x [0,height]`;
- pixel center is `(x+0.5,y+0.5)`;
- filter premultiplied RGBA, then encode straight-alpha PNG;
- out-of-source samples are transparent `(0,0,0,0)`;
- the native `preview` path uses one bilinear sample; `standard` uses a
  Jacobian-selected premultiplied-alpha mip pyramid with trilinear filtering
  and at most 2x2 bounded supersampling; `high` uses the same minification
  protection with bicubic reconstruction and at most 4x4 bounded
  supersampling. The pyramid is selected by sampled footprints plus a
  conservative rule: any real perspective denominator enables it, because a
  finite probe set can miss an interior minification maximum;
- valid edge samples clamp filter taps to the source edge, while coordinates
  outside the source plane remain transparent;
- WebGL preview uploads a source only when it changes and uses mipmapped linear
  filtering; for Warp it draws the same core-generated mesh with
  perspective-correct texture interpolation rather than reimplementing preset
  formulas. Geometry remains the cross-adapter invariant, while exact pixels
  are checked with adapter-appropriate visual tolerances;
- geometry must match across native, WASM, CSS, WebGL, and Figma; exact raster
  pixels need only satisfy adapter-specific visual regression tolerances.

## CSS embedding

The CSS adapter composes normalized source pixels into the destination
homography and emits a column-major CSS `matrix3d(...)`, `transform-origin: 0 0`,
and concrete source width/height. Normalized destinations require a concrete
container size before emission. A non-projective Warp cannot be represented by
one CSS matrix3d and therefore fails explicitly with `E_SCHEMA`; a warp whose
`amount` is exactly zero is identity and stays CSS-representable like an absent
warp. Otherwise callers must render pixels or use the WebGL mesh path.

## Side effects

Native rendering preflights input decoding, geometry, output bounds, destination
containment, overwrite authority, and response feasibility before creating or
replacing a file. Publication uses a temporary file in the destination
directory followed by an atomic rename; the response-feasibility preflight
measures the complete result envelope the client will receive, published files
keep ordinary readable permissions, and the destination directory entry is
fsynced best-effort after the rename. `dryRun` performs the same decode, solve,
rasterization, PNG encoding, artifact hashing, and response preflight as a real
render, but never publishes. It is a full-cost no-side-effect check, not a
geometry-only preview.

Every successful file render returns bounded evidence: source and output
SHA-256, encoded format and dimensions, decode, solve, raster, encode, and total
timings, and warnings.
Evidence identifies the artifact and execution; it is not a substitute for
visual acceptance.

## Agent transport

The MCP binary has two explicit projections over one implementation. `direct`
is the compatibility surface and remains exactly `worldbend.compose`,
`worldbend.solve`, `worldbend.inspect`, `worldbend.render`,
`worldbend.rectify`, `worldbend.rectify_render`,
`worldbend.canvas_render`, and `worldbend.css`. `catalog` is the default
installable Agent projection and exposes exactly `worldbend.search`,
`worldbend.describe`, and `worldbend.run`. A known operation routes directly to
one `run` call. Search returns compact operation metadata; describe returns the
exact current closed input and output schemas for one selected operation; run
dispatches through the same operation-specific parser and handler as the
direct tool. Search and describe are not planners and are not required when an
operation and its arguments are already known.

Published JSON Schemas and runtime parsing enforce the same canonical unions,
constants, positive sizes, unknown-field rejection, and server resource
ceilings. The compact run envelope deliberately keeps its nested arguments
generic in `tools/list`; accepting it does not weaken validation because the
selected operation is parsed against the exact schema returned by describe and
passed to its operation-specific handler. The eight compatibility operations
also expose their existing direct tools; catalog-only families do not grow
that frozen surface. Every tool output schema declares a
top-level JSON object while retaining the closed success/failure envelope
beneath it, so strict MCP clients can accept `tools/list` without weakening
result validation. The complete direct and compact catalogs have independent
checked byte ceilings.

Tool arguments are capped at 1 MiB and complete MCP results at 256 KiB. Render
uses an isolated worker, a 20-second whole-call deadline, a 768 MiB per-worker
ceiling on every supported desktop platform, a server-wide maximum of two concurrent workers, and a
maximum of four admitted render calls (two executing plus at most two waiting).
Additional concurrent renders fail fast with `E_CAPACITY` before acquiring a
worker or queue slot instead of growing an unbounded queue. Callers may retry
after in-flight work completes; `E_TIMEOUT` is reserved for an admitted call
that exhausts its whole-call deadline. Client cancellation aborts an admitted
render for real: the request's cancellation token is observed, the worker is
killed, and the admission slot plus staging directory are released immediately
with `E_CANCELLED` (the built-runtime smoke asserts cleanup completes far
faster than natural completion). Publication is never partial — cancellation
either lands before the atomic publish or leaves the fully written output. A
render request also carries a default 32-megapixel budget (axis limit stays
8192) chosen so the worst-case decode, mip pyramid, and output buffers fit
under the 768 MiB worker ceiling; larger requests fail fast with
`E_OUTPUT_LIMIT` instead of dying later under `E_MEMORY`. A tool-handler panic
returns a bounded structured `E_INTERNAL` rather than dropping the request.
MCP and Capability path confinement share `worldbend-agent-fs`. The explicit
workspace root is opened once; every descendant directory and source is opened
without following symlinks, and the held source/output-parent descriptors stay
authoritative through private staging and atomic publication. Replacing an
authorized pathname after acquisition cannot redirect either read or write.
The optional controller setting `WORLDBEND_PRIVATE_STAGING_ROOT` selects the
parent of those private per-call staging directories. It defaults to the
canonical operating-system temporary directory and is read exactly once when
the MCP server starts. The resolved directory must already exist, be absolute,
be writable, and be outside the granted workspace root; otherwise server
startup fails. Requests and Agents cannot change this fixed process setting or
address files beneath it through workspace-relative paths.
Linux uses process resource limits, macOS combines the worker CPU limit with
supervisor RSS enforcement, and Windows assigns each worker to a kill-on-close
Job Object with process-memory and process-CPU limits.

`worldbend.canvas_render` admits one ordered Canvas Set as one render call. Its
source and output-directory parent use the same descriptor authority. The
destination directory must not exist. Every `${variantId}.png` is rendered and
preflighted in a hidden sibling directory; after the last cancellation and
response-budget check, one same-filesystem directory rename is the commit
point. Failure before that point leaves no destination directory. v0.1 has no
overwrite, merge, arbitrary per-item path, or partial-success mode. The Agent
projection narrows the set to 32 Mi output pixels cumulatively and rejects a
complete encoded set above 128 MiB before publication.

The seven integer fields in a successful `worldbend.render` result use only
portable JSON Schema integer bounds, not implementation-specific `uint32` or
`uint64` formats. Source, output, and placement dimensions are positive and at
most `4294967295`; `bytes` is non-negative and at most
`9007199254740991`, the largest integer JavaScript can represent exactly. The
last bound protects JSON-number portability and does not replace the existing
raster axis, pixel, source-byte, memory, response, or deadline limits.

### Portable Capability projection

The experimental `org.openadam.projective.transform@0.2.0` provider exposes
only `inspect` and `render`. Its local schema snapshots are a narrower semantic
projection: they do not own editor state, CSS behavior, Figma selection, or a
second set of geometry rules. The adapter validates the profile envelope, then
maps the provider-neutral `projective.transform` header to the product-owned
`worldbend.transform` header, delegates actual inspection and rendering to
Worldbend, and maps the richer stable product errors into the profile's closed
error set. Direct Worldbend MCP tools never accept the Capability header, and
the Capability adapter never accepts the product header, so neither identity
silently impersonates the other.

That current Profile does not declare `content.orientation` or `content.warp`.
The local adapter therefore rejects either product-only field structurally;
it must not accept them until a central Profile revision owns their semantics.
The installable provider directory contains the manifest, copied Profile
schemas, and binary-relative adapter/probe commands. The compiled transport
probe reacquires live MCP schemas without Node, Cargo, or a source checkout.

Capability render paths are bounded relative paths under one explicit
`OPENADAM_CAPABILITY_WORKSPACE_ROOT` or `OPENADAM_PROVIDER_ROOT` grant. Absolute,
parent, URI-like, symlink, non-regular-source, and non-PNG output requests are
rejected before execution. A successful profile result uses `status: "ok"`;
`dry_run` carries the write/no-write distinction. The provider profile remains
experimental and does not establish cross-provider substitutability by itself.

## ComfyUI V3 adapter

The experimental local node pack exposes exactly nine server-side V3 nodes.
`Worldbend_TransformSpec` and `Worldbend_ApplyTransform` form the transform
pair. The first accepts
strict JSON, rejects duplicate keys and non-finite JSON constants, calls native
`worldbend inspect`, and emits the custom `WORLDBEND_TRANSFORM` runtime value.
The second accepts that value, one Comfy `IMAGE`, and an optional `MASK`; calls
native `worldbend render`; and returns `IMAGE`, `MASK`, and the unchanged
transform. Python owns tensor validation, private temporary PNG/spec staging,
process lifetime, and conversion only. It must not solve a matrix, expand a
Warp preset, sample a transformed pixel, or derive diagnostics.

The v0 tensor boundary is `IMAGE [1,H,W,3]` and optional `MASK [1,H,W]`, with
finite values in `[0,1]`. It rejects every other batch size before rendering.
The MASK convention follows Comfy `LoadImage`: mask `1` means fully
transparent, so native source alpha is `1-mask`; returned alpha is converted
back to `1-alpha`. Current `LoadImage` may supply an all-zero `[1,64,64]` MASK
sentinel when the IMAGE has no alpha channel; only that exact empty sentinel may
expand to an all-visible MASK at the actual IMAGE dimensions. Every non-empty
or differently shaped mismatch remains `E_SCHEMA`. Fully transparent output
pixels do not promise preservation of hidden RGB because core filtering is
premultiplied-alpha. Tensor exchange uses an 8-bit RGBA PNG boundary, so 8-bit
quantization is part of this adapter's current output contract rather than
hidden precision.

If both target dimensions are zero, a normalized spec validates at a temporary
unit scale and binds to the incoming IMAGE dimensions at Apply. A pixel spec
keeps its own reference. Two positive target dimensions override either route;
one zero and one positive is `E_SCHEMA`. Source, target, and output are capped
at 8192 pixels per axis and 32 Mi pixels. The native encoded-source ceiling is
64 MiB. The adapter forwards `preview`, `standard`, or `high` and `tight` or
`reference` directly to the core renderer.

The executable is either the regular bundled `bin/worldbend` or an absolute
development path supplied by `WORLDBEND_CLI`; PATH lookup, shell execution, and
runtime package installation are not used. One native call has a 120-second
adapter deadline. While the child runs, Comfy cancellation is polled; timeout,
cancellation, or another exception kills and drains the process before private
temporary state is released. Native structured errors retain their stable
codes. Adapter preflight uses the existing `E_SCHEMA`,
`E_NON_FINITE_COORDINATE`, `E_OUTPUT_LIMIT`, `E_TIMEOUT`, `E_RENDER`, and
`E_INTERNAL` meanings; Comfy currently surfaces them as bounded node
exceptions rather than a separate result envelope.

`Worldbend_RectificationSpec` and `Worldbend_ApplyRectification` form the
rectification pair. The first validates strict `worldbend.rectify@0.1` JSON
through native `worldbend rectify`; the second calls native
`worldbend rectify-render` with one IMAGE and optional MASK. The custom
`WORLDBEND_RECTIFICATION` value is returned unchanged for reuse. Python does
not detect the plane, infer output dimensions, solve the homography, or sample
pixels.

`Worldbend_CanvasSetSpec`, `Worldbend_ApplyCanvasSet`, and
`Worldbend_ApplyCanvasPlan` form the Canvas route. The first validates one
strict ordered set. The second resolves and applies it to one IMAGE and
optional MASK, returning heterogeneous IMAGE/MASK lists plus the resolved
plan. The third replays that plan on a same-sized 8-bit control raster and
never re-runs Trim. Different output sizes are Comfy list values, not an IMAGE
tensor batch. The Canvas route narrows cumulative output to 16 Mi pixels and
retains the existing `B = 1` input rule.

`Worldbend_RemapSpec` and `Worldbend_ApplyRemap` form the Remap route. Strict
JSON validation and planning cross native `remap-inspect`. Apply calls native
`remap-render`, accepts one optional source MASK, and requires exactly one
displacement IMAGE only when the selected operation is displacement. An
optional displacement-map MASK supplies native alpha-channel data. Python does
not evaluate lens equations or sample the displacement field. The returned
`WORLDBEND_REMAP` value is unchanged so primary and compatible 8-bit control
images can reuse the same program and map.

These Comfy routes do not yet have the MCP worker's independent 768 MiB process
ceiling or admitted queue. The existing transform/rectification route uses a
32 Mi-pixel ceiling and Canvas uses a 16 Mi-pixel cumulative ceiling; their
one-image boundary, deadline, and child cleanup bound the current experimental
slice but are not a claim of equivalent isolation. Public input IMAGE batch and video support remain
closed until item correlation/order, partial failure and atomicity, cumulative
resource budget, fairness, cancellation, and publication semantics are
explicitly versioned. The generated local package is not a Comfy Registry
release and does not establish a Registry publisher identity or
multi-platform binary claim.

## Carrier build and package isolation

`config/carrier-profiles.json` owns the current carrier surface inventory and
package limits. The configuration is closed and consumed by build, package,
runtime-smoke, and built-artifact checks. It is not descriptive metadata that
may drift independently from those paths.

The Figma carrier uses the shared bridge with a `worldbend-wasm` build that
disables the CSS core feature. The ABI keeps a closed `css_json` function so
the shared TypeScript import remains stable, but that function returns
`E_SCHEMA` and no Figma route may call it. The full Web and Agent builds retain
CSS. Figma packages must contain only their declared manifest/main/UI runtime
plus release documentation and dependency inventory; Agent or Comfy files are
package failures.

The Agent carrier packages the declared native executables, Capability
projection, Product Skill, and legal inventory. HTML, CSS, Python, Figma, or
Comfy interface material is a package failure. The live compact catalog must
remain at or below 16,384 bytes. The eight-tool direct compatibility catalog
must remain at or below 81,920 bytes and is not loaded by the default plugin
projection.

The macOS DMG is a download carrier around that Agent distribution, not a
second plugin model or a standalone GUI application. Its root contains exactly
one sealed Agent Host component archive, `README.txt`, `SHA256SUMS.txt`, and
`PACKAGE-MANIFEST.json`. The manifest records platform, architecture, component
and descriptor digests, source revision and dirty state, and the explicit
absence of Developer ID signing and notarization. The separately published
release record binds the exact DMG bytes to the same component identity.
Verification also binds the separately distributed component archive to the
copy mounted from the DMG, rejects unsafe or undeclared tar members before
extraction, and checks every packaged native executable against the declared
macOS arm64 and ad-hoc-signature boundary.
Unchanged component inputs must reproduce the same tar.gz bytes; DMG container
metadata is verified by exact digest and mounted-content comparison rather than
claimed byte reproducibility. Agent Host alone owns installation, activation,
Codex projection, update, rollback, and removal of this component.

The Comfy carrier builds `worldbend` with the `comfy` feature and no default
CLI features. Its executable command surface is exactly `inspect`, `render`,
`rectify`, `rectify-render`, `canvas-inspect`, and `canvas-render`; presence of
`compose`, `solve`, `css`, or `schema` in the staged help surface is a package
failure. The package contains
only its declared Python sources, examples, reduced native executable, package
manifest, and dependency inventory. Figma, Agent, MCP, Skill, or Capability
material is a package failure.

The current Figma runtime-entry, archive, and unpacked ceilings are 655,360,
524,288, and 2,097,152 bytes respectively. They are deterministic package
growth boundaries, not claims about interaction latency or visual quality.
An intentional budget change requires a current measurement and cannot be
smuggled into the same checker merely to make an unrelated build green.

The Figma `perspective` workspace keeps the checked operation order Transform,
Distort, Warp, Correct. Free and Perspective are Distort-local peer choices:
the subgroup is visible only while Distort is active, and the top-level
Distort mode button is the control that re-enters it from any other mode. One
persistent labeled workspace navigation with localized visible names and
keyboard focus holds the repeat-use `perspective`, `canvas`, and
`templates` workspaces plus overflow scroll affordances and the More control.
More exposes the replacing `mockup`, `mesh`, `surface`, and `remap` workspaces as
task-labeled advanced transforms. Their canonical IDs and stored semantics do
not change with the Composition, Split Warp, and Lens & maps human labels.
Perspective remains the enabled pointer and keyboard recovery destination while
a task source is refreshing or becomes invalid. A final selection failure
returns to that base workspace and presents one error surface rather than
leaving a disabled task selected.
Each workspace owns its draft, controls, messages, and runtime resources; only
the active workspace renders. Pixel-only refreshes of the same sources, coordinate
frame and saved task retain local drafts and history. A refresh or workspace
exit invalidates pending publication, including asynchronous image encoding.
Entering and returning cannot mutate Perspective semantic state.

A live scene working preview is editing feedback, not publication. Merely
opening the plugin or a workspace does not create one. Once a
perspective-family edit (Transform, Distort, Warp) differs from the loaded
result, the plugin maintains at most one canvas preview node: a locked, plainly
named image
rectangle at the current output placement, marked with private plugin data
and carrying no stored operation, binding or reusable-result identity. It is
never accepted as a source or result. Returning exactly to the loaded frame,
Apply, cancel, selection loss, leaving the workspace or entering a non-preview
mode, and an error surface replacing the edit all remove it. Plugin close clears
the preview synchronously through Figma's main-thread close event; UI pagehide requests an earlier clear,
and a stale-preview sweep on the next plugin run remains the abnormal-exit and
host-Undo-resurrection backstop. A swept preview is never reused. Updates are
coalesced and bounded to a 1024 px raster axis. Perspective uses the same export
renderer and operation as publication; Composition uses the same composited
preview canvas and scene placement.

A rejected publication is not a completed edit. Synchronous preflight failures
leave the working preview in place. If final encoding or the Figma main-thread
write fails after the preview was cleared for publication, the UI returns to
the same editable draft, restores its canvas preview automatically, and keeps
the publication error visible so the next retry is informed.

Figma exposes no transient plugin canvas overlay or selective history erasure.
The implementation therefore commits pending artwork before creating the
marked document node; later frame updates create no per-frame commits, and
cleanup directly removes only marked preview nodes. `triggerUndo` is forbidden
for cleanup because a user artwork edit may be newer than the preview boundary
and would be undone first. Real Figma Desktop verification on 2026-09-14 found
that safe cleanup can leave one empty host Undo item and that a later host Undo
can temporarily resurrect the removed preview. This is an accepted host
limitation rather than a reason to remove essential scene feedback: the node's
plain `Worldbend Working Preview` name and private marker make it recoverable,
and the next plugin run removes it without touching artwork.

The self-contained Figma release may still inline those
modules into one HTML file; package inlining does not authorize a single
ever-growing control surface or persistent capability copy.

## Figma reuse

Figma exposes manual correction as a fourth operation. The displayed source
stays unwarped while the four handles author the normalized source quad, and
two bounded integer fields author the output size. Apply calls the WASM
`rectify` core, gives its matrix to the existing WebGL renderer, and stores the
exact RectifySpec under a distinct shared-data key. A rectification result is
therefore never mislabeled as a destination-only TransformSpec when the user
later selects the original source and result together. Figma still owns only
selection, presentation, image export, replacement, and undo state; it does
not own rectification mathematics.

The 820 x 760 human panel is canvas-first. The selected source name is a
quiet editor-corner readout, and the full-width bottom session bar keeps Reset
at its left end and publication actions at its right end because they act on the whole
session rather than tune the active operation; session undo and redo are the
standard shortcuts, not persistent footer buttons. The persistent workspace
navigation sits above the operation bar, and object identity, operation
choice, and the active
operation's continuous parameters share one persistent full-width top operation
bar. The bars frame one uninterrupted
rectangular editor and never overlay it. Free and Perspective Distort are
direct peer choices inside Distort.
The panel opts into Figma host theme colors. Figma's live semantic variables
own ordinary chrome, while `figma-light` and `figma-dark` select the local
canvas, checker, HUD, reference-line, and handle contrast tokens. Theme changes
are presentation-only and require no plugin restart, persisted preference, or
manual theme switch. A system-color-scheme media query is only the standalone
preview fallback when the Figma host classes are absent.
An empty selection shows a compact before/after design illustration and a
localized instruction to select content on the Figma canvas, with a quiet
hint that existing results can be reopened. The illustration is decorative,
not an interactive sample. Loading and invalid selections have separate
states; errors retain their specific recovery instructions and any Restore
transform action in normal flow. Clearing a selection is not an error alert.
Successful Apply is non-terminal. Publication keeps the producing source or
source/result selection stable, returns the active workspace to its ready
draft, and leaves Reset, Apply, and every valid editing control available so
the designer can adjust parameters and publish another result immediately.
The main-thread source snapshot remains observed and reusable after successful
publication. A replacement updates the known output dimensions; the UI rebases
subsequent host refreshes from the just-published frame so saved geometry is
not applied twice. A refresh of the same selection preserves the pending host
Undo route until a local edit or explicit undo consumes it.
An external change to the saved mapping loads that new mapping rather than
rebasing a stale one over it. A displaced unapplied Perspective draft remains
recoverable through local Undo, with visible feedback. Same-selection refreshes
preserve the designer's manual zoom/pan instead of forcing a new fit.
Content-only refreshes also retain local edit history and affine control values;
new source pixels do not establish a new geometry baseline.
Before the next local edit, one standard Undo may still route to Figma's host
history to remove the fresh result; the first local edit disarms that host
route and resumes draft history. Completion text is assistive-only: the
visible footer contains Reset and the output actions. Perspective exposes
New Editable Frame and New HD Image from a source; a selected result also
exposes Update Frame or Update HD Image. New output always preserves the
selected result, including when keeping its type. Native output retains an
independent Content clone; raster output is a stable snapshot linked to its
producing source. Selecting descendants of the active Frame keeps that whole
Frame as the session source while node edits refresh the preview. Closing the
plugin stops preview refresh, not Figma's native content editing. Reopening
resolves the latest source and saved geometry without publishing automatically.
HD Transform output requests at least two pixels per document unit and keeps
an already denser saved output; it never doubles the saved density per reopen.
Correct retains its explicitly entered raster dimensions. Native availability
or unsupported Warp/Correct disables only editable output. When the optional
native effect is missing entirely, the editable-output control stays
keyboard-reachable as an explicitly unavailable action whose recovery
guidance is visible in the panel; unsupported modes, pending discovery, and
size limits keep the quiet disabled form with hover help. Other workspaces
retain their existing task-specific Apply action.
Editable output checks its logical Frame dimensions against 4096 per axis;
HD raster density and its fit/reject preference cannot enable an oversized
Frame or block an otherwise supported Frame. Host Undo uses the same active
Frame context while its descendants are selected, including delayed host
restoration, and stops repairing if selection leaves that context.
Explicit Restore transform also resolves the containing result when its
descendants remain selected; successful repair returns to that result's
preview without changing the selection. Selection, generation and saved
record are checked again before the write.
Desktop text-history replay into a blurred field must not precede and consume
the publication Undo; a focused field retains its native text-edit history.
Source names and output dimensions are fixed interface overlays outside the
zoomed scene. They retain their screen size and readable opaque backgrounds
over both light and dark artwork, without blurred text shadows.
The rendered canvas uses a neutral transparency checker in either host theme
so both dark and light artwork remain inspectable. It is presentation-only;
the surrounding editor chrome follows the host and exports retain source alpha.
Operation labels use quiet, transparent chrome with one selected emphasis;
nested background containers must not compete with the canvas. Transform and
Warp parameters remain visible while their operation is active so a designer
can tune continuous values without reopening a popover.
More is the final control of the workspace navigation and uses the same quiet
control language. Its popover contains task-labeled advanced transforms,
secondary session actions, the explicit output-density policy, and language.
Its Perspective-only entries hide inside task workspaces while the advanced
transform entries and language remain available. Perspective, Sizes, and
Templates remain labeled primary peers; when an advanced workspace is active,
More carries its selected emphasis without hiding the current workspace.
Navigation into a replacing parameter surface uses a right-facing enter arrow;
down arrows are reserved for dropdown or disclosure behavior. Product icons
come from the configured project icon authority and retain its returned SVG
geometry; text glyphs are not substitutes for More, Close, Link, Check,
workspace-tab, workspace-task, or surface-entry icons. Direct-manipulation
handles, pivot dots, and slider thumbs
remain task geometry rather than generic product icons.
Transform parameters preserve semantic groups and reading order: Width then
Height then their link toggle; Skew X then Skew Y; Angle then Placement. The
first two groups use paired columns at the declared Figma panel size, and each
slider keeps a materially usable physical drag span instead of being compressed
into an arbitrary mixed grid. All three rows share one dedicated 32 CSS-pixel
action column: Link occupies it on the size row while the other rows preserve
the same track, keeping all five slider spans equal. Frequent transform commands follow Angle and
Placement as authority-rendered icon buttons with localized hover and keyboard-
focus tooltips. Horizontal Flip and Vertical Flip expose their toggled state;
Rotate 90 degrees clockwise is one repeatable command, so two and three presses
cover 180 degrees and 90 degrees counter-clockwise without duplicate buttons.
Its icon depicts one selected object receiving one directional rotation; the
repeat equivalence reduces controls but must not be drawn as a loop/cycle or
replace the exact 90-degree tooltip.
Scale sliders cover the frequent 25%-200% range,
rotation covers -90 to 90 degrees, and skew covers -60 to 60 degrees. Their
paired numeric fields retain the wider safe core domain and 0.1-unit precision;
typing outside a slider's working range must not be silently clamped.
Placement temporarily replaces the Transform parameter region and closes by
its close action, outside pointer, or Escape; it does not overlay a draggable
handle. The editor flexes only in the space between the two bars. Switching
Distort, Transform, Warp, or Placement may change the top bar's height and may
therefore refit or recenter the presentation inside the remaining editor, but
it must not mutate the canonical spec, transform recipe, pivot, or Warp value.
After every such reflow all finite handle centers remain inside the editor's
16 CSS-pixel safe inset, and no control surface overlays a handle. The panel has
no fixed inner padding tax: initial load and explicit Fit center the complete
interactive scene at no more than 90% of the available editor extent, leaving
a proportional halo for the four corner targets and the non-interactive source
and output HUDs. The halo is presentation-only; 100%, manual zoom, and canonical
geometry remain unchanged. The panel has
no persistent zoom button cluster: wheel/trackpad zoom remains pointer-anchored,
Cmd/Ctrl +/- zooms, Cmd/Ctrl+0 fits, and Cmd/Ctrl+1 restores 100%. The current
zoom remains exposed to assistive technology. Closing More or Placement with
Escape must not also cancel the edit session.

The Figma adapter writes the canonical spec verbatim as
`setSharedPluginData("worldbend", "transform", JSON.stringify(spec))`.
Its stored-data and UI-message guards accept finite normalized destination
coordinates outside `[0,1]`; they do not silently clamp a valid outward plane.
Private plugin data is limited to adapter-local raster dimensions. One
generation-tagged selection snapshot supplies source
bytes, spec, target identity, and output dimensions for an apply. Text caret or
range changes with the same page and ordered node selection preserve that
snapshot and any pending content-refresh deadline. Actual selection or
relevant node changes advance the generation on their leading edge and
invalidate in-flight export/apply work before the debounced reload. Selection
and source edits during asynchronous publication preflight still invalidate
the request; only the actual host-write section suppresses self-generated
node changes. Selection reloads share one asynchronous export queue: after the active load settles or
times out, only the latest settled generation may start. Observe the source
being exported, including linked sources during the first load, so edits in
that window cannot install obsolete pixels. Logical
transform geometry and Figma document placement remain distinct from raster
density. The default `Fit to Figma` policy proportionally reduces only the
published image pixels when either requested axis exceeds 4096 px; it preserves
the normalized spec, tight document placement, aspect ratio, and replacement
geometry. The editor's quiet lower-corner output readout always shows source ->
requested pixels and, when fitted, requested -> applied pixels plus an explicit
fit label. `Keep original pixels` is an explicit session alternative: an
over-limit request disables Apply, and returning to a safe size re-enables it on
the next accepted geometry sample. This is the owning Figma single-raster
boundary, not a Web/core limit: `figma.createImage` rejects images above 4096 px
per axis. Stored private raster dimensions remain the reload/replacement source
of truth even when the result Rectangle's document dimensions are larger.
Tiling would change the stored result from one replaceable Rectangle into a
multi-node document object and is not fabricated inside the current contract.
The CLI/native renderer remains the explicit larger-file route.

Assisted plane perception is a separate upstream assessment contract in
`docs/PERCEPTION_PROVIDER_CONTRACT.md`. Its full CLI and compact Agent routes
return zero to three explicit pixel source-plane candidates, uncalibrated
confidence, typed uncertainty, and orientation-aware source facts. They do not
mutate files or automatically construct or execute a Transform/Rectify program.
The deterministic core never calls a perception Provider.

Advanced Surface and Motion are explicit deterministic programs, not
perception. `worldbend.surface-deformation@0.1` validates a regular 1..4 by
1..4 cubic patch lattice, fixed boundary controls, bounded interior controls,
explicit anchors, and ordered strokes before resolving one canonical Mesh.
`worldbend.motion@0.1` validates one reduced rational rate from 1 through 240
fps plus first/last-covered keyframes and resolves every frame through a fixed
easing procedure into one canonical Timeline. Their file routes inherit the
same worker, dry-run, digest, cancellation, result-budget, and atomic
publication boundaries as Mesh and Timeline.

PSD Smart Object interoperability is a separate read-only adapter. It preflights
the PSD/PSB header and 64 MiB source ceiling before parsing, disables bitmap,
thumbnail, and linked payload loading, bounds layer count/depth and Smart Object
count, and reports explicit importability reasons. Only a caller-selected
eligible object can become a Spatial Template plane. Source access remains
descriptor-confined in MCP and no source or output document is mutated.

The first preview export is allowed to optimize for startup. Before Apply, the
UI solves the final cumulative spec, estimates source texel density from the
homography composed with every triangle derivative in the exact core-owned
Warp mesh, and asks the generation-owned main thread snapshot to re-export the
original selected node when the loaded source raster is insufficient. The
planner uses a conservative per-triangle projective derivative bound; it never
reconstructs a preset formula or substitutes an amount-based guess. That
request is bounded to 4096 px per axis, timed out, and rejected if source
identity, target identity, selection, or generation changes before completion.
The Perspective UI may retain one decoded source at the exact requested
dimensions for repeated Transform or Correct outputs in that same snapshot.
Any selection/source reload invalidates it immediately; a failed or obsolete read
cannot populate the slot. Reusing a denser or smaller raster across differing
requests is not an equivalent sampling path. Optional native-renderer
discovery runs independently of source delivery and cannot hold image preview
or HD output readiness; its completion is tied to the current generation and
source/result identities.
The final renderer consumes that decoded source, uses mipmapped anisotropic
filtering for minification and a high-quality cubic reconstruction fallback
for magnified regions, and rasterizes only once.
The WebGL transform renderer evaluates source gradients and mipmapped sampling
before per-fragment UV/quality branches.
Plane edges must not acquire colors from unrelated interior mip levels.

This improves plugin-induced blur when a large or vector-backed Figma node was
initially previewed near 1x. It cannot recreate pixels Figma discarded while
importing an image above its own 4096 px asset limit.

Distort camera motion is presentation-only. Pointer mapping starts in the
gesture-start scene and viewport zoom remains fixed for the pointer-owned
gesture. Away from the viewport edge, pan stays fixed apart from the
core-derived workspace-origin compensation that keeps the original target
frame registered. When an outward-moving captured pointer enters the outer
48 CSS-pixel viewport zone, the compositor camera pans continuously on the
active Free axes. Perspective consumes at most one camera-assist step for each
fresh, meaningful pointer sample on its captured axis; holding the pointer
still cannot keep expanding the mirrored pair. Its assist uses half the Free
camera velocity because the linked endpoint moves oppositely, normalizing the
pair's screen-space expansion. Both ramps rise quadratically with edge
penetration; Free is capped at 720 CSS pixels per second and Perspective at
360 CSS pixels per second.
The editor consumes the viewport's total camera translation and re-samples the
latest pointer in the frozen gesture frame, so the grabbed control stays under
the pointer and release commits the exact geometry shown. A low-emphasis
directional edge wash is visible only while assistance is active; it is
presentation feedback and never changes geometry. Edge pan stops when
the pointer moves inward, returns to the center, releases, is cancelled, loses
capture, or the host window is interrupted. It never auto-fits or auto-zooms
during the drag. After release, the viewport may use an eased presentation-only
pan/zoom to restore all 32 px corner hit targets inside the 16 px safe center
inset. Recovery and explicit Fit may cross the ordinary 10% manual zoom floor
when the finite quad requires it; the zoom label must not report a positive
sub-percent scale as 0%. Manual Zoom Out cannot push farther below that
recovery scale, while Zoom In returns gradually. Recovery never auto-zooms in
and never changes the canonical quad.

Direct-manipulation release is owned by the active pointer session, not only by
the handle element. Element capture, window-capture pointer release, compatible
mouse release, capture loss, window blur, and page hide all close the session
exactly once. A real release consumes its final finite viewport coordinate;
interruption retains the last sample already shown. Distort, Transform, and
space-pan must release capture and accept a new pointer immediately instead of
remaining wedged when an embedded host drops the release outside its iframe.
The shared Mockup and Mesh direct-point overlay follows the same interruption
rule and commits that last visible point to its task history exactly once.
If the iframe later receives a move for the owning pointer with `buttons == 0`,
that is a release-recovery signal: close at the last pressed sample and do not
apply the re-entry coordinate.
Every corner, edge, pivot, and task direct-point control keeps an exact square
screen-space hit box. Generic button hover and press motion never applies to
these coordinate-bearing controls because replacing their transform would move
the apparent geometry before the pointer itself moved.

Preview zoom is a compositor transform rather than a per-frame canvas resize.
It scales image geometry and control coordinates, while the declared handle and
pivot visual/hit targets remain screen-space sizes. During Transform direct
manipulation, raw pointer samples and numeric echoes are collapsed to the
latest sample per paint. Core composition/render work is additionally bounded
to one asynchronous preview in flight, with only the newest superseding sample
retained; a queued final sample is a preserved boundary and cannot be replaced
by the following gesture. The editor does not disable its own active gesture
while composition is in flight. Camera zoom and pan remain
stable while the active pointer owns the Transform gesture; the core-derived
scene offset may still move to conserve tight-canvas geometry. After the exact
final sample is rendered on release, camera recovery may zoom out as needed to
keep all handles reachable, but it does not silently alter the canonical
transform recipe.

Distort keeps immediate overlay/control feedback separate from asynchronous
solve/render work. Pointer samples are collapsed per paint, at most one WASM
preview solve may be in flight, and only the newest waiting intermediate state
is retained. A superseded result cannot publish. Pointer release still commits
the exact final quad before history and recovery run, and the newest committed
state is rendered when the single in-flight solve clears.

The development plugin manifest resolves `dist/main.js` and `dist/ui.html`
from one live directory. UI-only and main-only builds must preserve the sibling
entrypoint throughout the build, not merely recreate it by the end; otherwise
an installed Figma development plugin can fail with a transient `ENOENT` while
reloading.

The correction grid is generated from the same solved homography and optional
core-owned Warp mesh that drive WebGL. It is a visual guide and never becomes a
second geometry input. Worldbend does not expose horizontal or vertical
straight-edge locks in the current Free Transform slice; architecture-style
edge correction belongs to the separately excluded Perspective Warp/camera
correction capability.
