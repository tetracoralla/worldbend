# PSD Smart Object interoperability contract

Worldbend's PSD boundary is a narrow, read-only import of source-replacement
and four-corner placement meaning. It does not claim to be a PSD editor or to
round-trip Photoshop documents.

The implementation reads bounded PSD/PSB bytes with the independently versioned
`ag-psd` parser, while retaining Worldbend-owned validation, output types,
resource limits, worker isolation, and error mapping. Adobe's public format
specification defines the surrounding PSD/PSB and `SoLd`/`PlLd`/`SoLE` block
framing but does not define a complete semantic interpretation of every
descriptor. Parser output is therefore treated as untrusted input to this
adapter, not as authority.

## Inspection

`worldbend.psd-smart-object-request@0.1` selects either inspection or template
planning. A PSD/PSB source is limited to 64 MiB before parsing. Bitmap, composite,
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

Any non-neutral preset, non-identity envelope, quilt split, alternate
transform, missing size, malformed descriptor, Smart Filter descriptor, or
unsupported parser condition fails closed as an unsupported document or an
explicit unsupported record. Non-finite raw transform values are never emitted
as JSON `null`; the bounded raw list is omitted when it cannot be represented.
Worldbend never guesses which Photoshop transform, filter, or warp should win.

The parser's missing-feature failures are deliberately enabled. In the current
`ag-psd` boundary, non-slice URL-list entries and unsupported pattern/color-mode
combinations can therefore reject the complete document even when a useful
Smart Object may also be present. This is a fail-closed parser limitation, not
a claim that such Photoshop documents contain no eligible object; calibration
requires real Photoshop-produced PSD/PSB fixtures.

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

The full CLI and compact Agent catalog expose read-only inspect and template
plan operations. They require an explicit workspace root for Agent file access.
The dependency is absent from Web, Figma, ComfyUI, the deterministic core, and
the conditional portable Capability profile.

Agent parsing is crash-contained by its isolated worker. The full CLI invokes
the third-party parser in-process. The 32-level limit above bounds Worldbend's
post-parse layer traversal; it is not a preflight limit on nested descriptor
parsing inside `ag-psd`, which currently exposes no descriptor-depth setting.
Until that dependency boundary is closed, the CLI must not be described as
hardened for adversarial untrusted PSD/PSB input.

PSD/PSB writing, in-place replacement, linked-file resolution, Smart Filter,
Puppet Warp, non-neutral custom Warp, cached-composite regeneration, and claims
of Photoshop acceptance are out of scope until each has an independently
closed and real-host-verified contract.
