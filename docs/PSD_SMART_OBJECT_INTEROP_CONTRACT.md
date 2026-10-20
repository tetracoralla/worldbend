# PSD Smart Object interoperability contract

Worldbend's PSD boundary is a narrow, read-only import of source-replacement
and placement meaning, including the supported custom curve family below.
It does not claim to be a PSD editor or to
round-trip Photoshop documents.

The implementation reads bounded PSD/PSB bytes with a vendored, resource-
budgeted copy of the independently versioned `ag-psd` parser (see Inspection
for the budget list), while retaining Worldbend-owned validation, output
types, resource limits, worker isolation, and error mapping. Adobe's public
format specification defines the surrounding PSD/PSB and `SoLd`/`PlLd`/`SoLE`
block framing but does not define a complete semantic interpretation of every
descriptor. Parser output is therefore treated as untrusted input to this
adapter, not as authority.

## Inspection

`worldbend.psd-smart-object-request@0.1` selects inspection, template planning,
or curve-work adoption. A PSD/PSB source is limited to 64 MiB before parsing. Bitmap, composite,
thumbnail, and linked-file payload decoding are disabled. Parsing runs in the
same bounded isolated Agent worker class as other file operations.

Inspection returns current source bytes and SHA-256, PSD versus PSB, document
dimensions, bit depth and color mode, plus at most 64 Smart Object records from
at most 256 recursively visited layers and 32 nesting levels. Every record has
a deterministic adapter ID, bounded layer path/name, optional Photoshop layer
ID, linked-asset ID, declared source dimensions, the raw `Trnf` corner list,
and an explicit importability result with typed rejection reasons.

An object is template-eligible only when the parser has not reported a
recognized unsupported descriptor condition and:

- `Trnf` contains exactly eight finite numbers in TL, TR, BR, BL order;
- source dimensions are finite and positive;
- the resulting pixel-space quad passes Worldbend's canonical validation;
- `nonAffineTransform`, when present, is byte-numerically identical to `Trnf`;
- the Photoshop warp is absent, `none`, or a verified identity custom 4 by 4
  envelope with zero warp/perspective values.

A non-identity custom 4×4 envelope is not template-eligible — template
planning would silently discard the warp. When that warp is the measured
`warpCustom` family — neutral `warpValue`/`warpPerspective` scalars, no quilt
slices, `uOrder`/`vOrder` 4, sixteen finite controls, and pixel-unit envelope
bounds — the record reports `curveEligible` instead and carries the curve
facts (orders, envelope bounds, sixteen controls in source pixels). Curve
adoption is selected object by object; it never falls back to another object
or to the four-corner template.

Any non-neutral preset, non-adoptable custom warp (non-4×4 orders, non-pixel
or missing envelope bounds, non-finite controls), quilt split, dual-block or
quilt-shadowed warp divergence (`conflictingWarpBlocks`), alternate
transform, missing size, malformed descriptor, Smart Filter descriptor,
budget exhaustion, or unsupported parser condition fails closed as an
unsupported document or an explicit unsupported record. Non-finite raw
transform values are never emitted as JSON `null`; the bounded raw list is
omitted when it cannot be represented. Worldbend never guesses which
Photoshop transform, filter, or warp should win.

The parser dependency is a vendored, narrowly patched copy of `ag-psd` 0.2.0
under `third_party/ag-psd` (see that directory's README for provenance,
license, the patch list, and the upgrade path). The patches enforce resource
budgets before the parser reserves storage or recurses:

- every declared string/data length is checked against the bytes remaining in
  the source before any reservation, with checked arithmetic, in both byte
  orders and for ASCII/class-id forms;
- descriptor nesting (nested `Objc`/`GlbO`/`VlLs`/`obj ` values) is capped at
  a fixed depth of 64 levels;
- descriptor, list, reference, and object-array items share a cumulative
  parse-item budget (262,144 items), bounding total collection retention;
- the compatibility zero-fill branch for byte reads past the end of the file
  is retained but charges a cumulative recovery budget (4 MiB), because those
  buffers stay alive in the parsed document;
- layer/channel reservations are clamped to what the remaining bytes can
  describe, and engine-data decoding carries its own depth cap and
  bounds-checked byte access.

Budget exhaustion and malformed lengths fail closed as typed parser errors
mapped to `E_MEMORY` or `E_UNSUPPORTED_MEDIA`; they never trap or abort the
WASM build. A rejected parse leaves the worker usable, and the next request
retries normally. The former pre-parse count of descriptor type signatures
was removed: it over-rejected legitimate documents with many flat lists and
was never a stack-safety proof. The bitmap memory limit, the 64 MiB source
cap, and the post-parse layer/smart-object limits continue to apply
independently.

The vendored parser also keeps the losing warp of each merge precedence
visible instead of discarding it: the legacy `PlLd` warp (whether or not
`SoLd`/`SoLE` replaced the merged record, in either block order) and a plain
`warp` descriptor shadowed by `quiltWarp` inside a `SoLd`. Worldbend compares
the losing warp with the merged one and reports a `conflictingWarpBlocks`
rejection when the losing source still describes a deformation the merged
record does not reproduce — a hidden curve can no longer import as a neutral
warp. Agreeing dual blocks and neutral losing warps import exactly as before,
so ordinary Photoshop documents that keep both blocks in sync are unaffected.

The parser's missing-feature failures are deliberately enabled. In the current
`ag-psd` boundary, non-slice URL-list entries and unsupported pattern/color-mode
combinations can therefore reject the complete document even when a useful
Smart Object may also be present. This is a fail-closed parser limitation, not
a claim that such Photoshop documents contain no eligible object; calibration
requires real Photoshop-produced PSD/PSB fixtures.

## Traced Photoshop calibration

The regression corpus includes exact `placedLayer.psd` and `placedLayer.psb`
bytes from `psd-tools/psd-tools` commit
`6fb7bd5215069ed63cbe009e921c3f33aa97a3ec`. The upstream suite uses the PSD
as a Smart Object fixture; embedded XMP names Adobe Photoshop CC 2014
(Macintosh) as creator, and the PSB history also records Photoshop CC 2017.
Their origin, MIT license, and SHA-256 values are retained beside the fixtures.

Both containers must inspect as 256 by 256 RGB/8 documents with four visited
layers and three eligible Smart Objects named `linked-png`, `linked-psd`, and
`embedded-png`. Selecting all three in order must produce three correlated
source slots and planes plus one validated `composite` Spatial Template output.
This is real-byte calibration for those named Photoshop versions and ordinary
placed layers; it is not broad acceptance of every Photoshop release, custom
or quilt Warp, Smart Filter, color mode, or adversarial descriptor combination.

## Spatial Template projection

Template planning accepts 1..16 unique eligible adapter IDs in caller-declared
order. It emits one validated `SpatialTemplateSpec` whose root is a transparent
Mockup at the PSD document dimensions. Each selected Smart Object becomes one
source slot and one plane using its `Trnf` quad; the single output is named
`composite`. The plan correlates every slot with its PSD layer path and linked
asset ID.

The template contains selected Smart Objects only. It does not reproduce
ordinary PSD layers, masks, blend modes, effects, color management, cached
Smart Object pixels, or the PSD background. A caller supplies replacement
assets through a normal Variation Job. Worldbend neither extracts embedded
payloads nor writes a modified PSD in this version.

## Carriers and non-goals

Curve planning emits an ordinary editable `worldbend.deformation-work` with
sixteen Bézier controls. Controls are normalized by their control bounding
box and placed by `Trnf`; the original envelope, bounding box, placement,
document dimensions, boundary decision and snap count remain in the returned
provenance. Moved outer controls use the free boundary. The Figma editor
rebinds the work to the selected artwork and target size before ordinary Apply:
the interop's Photoshop-pixel placement is divided by the PSD document size
into the normalized destination quad Figma-authored works use, and the pixel
reference dimensions are dropped (normalized destinations carry none). Without
that rebind, the main thread's publication validation rejects every later
Apply of the adopted curve.

Adoption provenance is retained across sessions. When a curve is adopted, the
Figma carrier derives a bounded adapter record (`worldbend.psd-adoption@0.1`
shape: source format/bytes/SHA-256/document, smart-object identity, layer
path, curve facts, control-bbox adoption decisions, structural losses — never
PSD bytes or local paths) and attaches it to the deformation task as the
optional `psdAdoption` field. It persists with the stored task on the
published result, is restored when the result reopens into the Pin or Mesh
editor, and rides every re-publication, so later edits keep the origin
without putting adapter data into the canonical work. A malformed record
fails stored-task validation instead of being persisted.

The full CLI and compact Agent catalog expose read-only inspect, template
plan, and curve work operations. They require an explicit workspace root for
Agent file access. The Figma designer carrier ships the same bounded reader
only in a dedicated `psd-import` WASM profile that the Templates workspace
loads lazily for local-file curve adoption; no other carrier profile carries
the parser. The dependency is absent from Web, ComfyUI, the deterministic
core, and the conditional portable Capability profile.

Agent parsing is crash-contained by its isolated worker. The full CLI invokes
the vendored parser in-process. The 32-level limit above bounds Worldbend's
post-parse layer traversal; descriptor recursion is bounded before it starts
by the vendored parser's own depth cap, parse-item budget, recovery budget,
and pre-reservation length checks (see Inspection). A worker still contains
any residual fault, and only a worker startup refusal may rerun an import on
the UI thread: a parser or runtime fault inside a running worker is reported,
never retried on the UI thread with the same bytes. UI-thread fallback parses
are bounded by the same budgets but cannot be cancelled mid-parse; cancel
takes effect between requests and terminates the worker.

PSD/PSB writing, in-place replacement, linked-file resolution, Smart Filter,
Puppet Warp, custom Warp outside the supported family, cached-composite regeneration, and claims
of Photoshop acceptance are out of scope until each has an independently
closed and real-host-verified contract.
