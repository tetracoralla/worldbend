# Assisted perception Provider contract

Status: productized source-superset contract, version 0.1

## Boundary

Assisted perception is an upstream assessment layer. It may propose a source
quadrilateral, but it never changes, extends, or bypasses the deterministic
Transform, Rectify, Canvas, Mockup, Mesh, Remap, or Timeline contracts. A
candidate has no side effect and no execution authority. A caller must select
one candidate explicitly and copy its exact `sourcePlane` into a separately
authored deterministic operation.

The current request is `worldbend.perception-plane-request@0.1`; the current
response is `worldbend.perception-plane-candidates@0.1`. This contract does not
reserve generic detection tasks, opaque provider options, segmentation masks,
semantic object classes, inferred output dimensions, vanishing points, camera
pose, depth, flow, lens parameters, or automatic crop/transform choices.

## Explicit Provider selection

One request names exactly one Provider:

- `contrastQuadV1` estimates the median premultiplied RGBA value on the decoded
  image border, searches a fixed set of contrast thresholds, extracts bounded
  connected components, and proposes their four directional extrema;
- `alphaQuadV1` performs the same bounded component/quad assessment over alpha
  support and returns `noCandidate` for a fully opaque source.

Worldbend does not silently fall back from one Provider to the other. Both are
local deterministic heuristics over the same orientation-aware decoded pixels.
Their scores are uncalibrated ranking scores, not probabilities or correctness
claims. Determinism for identical decoded pixels does not make the resulting
assessment authoritative.

## Request and resource limits

A request contains the exact schema/version headers, Provider ID, an optional
1..3 candidate ceiling, a 64..1024 analysis-axis ceiling, and source limits
that may only narrow the engine bounds. The source is one regular PNG, JPEG,
WebP, or TIFF under the Agent workspace grant. Production media decoding owns
format recognition, EXIF orientation, source bytes, dimensions, and pixel
limits. Analysis converts the decoded image to RGBA8 and proportionally downsizes
only when the requested analysis axis requires it; the original sample format
remains disclosed in source facts.

The Agent controller copies the granted source into private staging while
hashing it, executes analysis in the existing bounded worker pool, verifies the
returned source digest against the staged bytes, preflights the complete
response, and publishes no file. Capacity, timeout, cancellation, memory, path,
media, schema, and output-limit errors remain stable structured errors.

## Response semantics

Every success returns Provider facts, source format/sample/dimensions/
orientation/bytes/digest, analysis dimensions and sample format, one outcome,
zero to three ordered candidates, and an overall uncertainty assessment.

Each candidate contains:

- a stable per-response ID and a strict `TL -> TR -> BR -> BL` pixel
  `sourcePlane` with its non-null source reference;
- the same quadrilateral normalized to the oriented source dimensions;
- an uncalibrated confidence score in `[0,1]` used only for ordering;
- threshold, component fraction, quadrilateral fill, border contact, and mean
  signal facts;
- medium or high uncertainty plus typed reasons such as low contrast, small or
  dominant support, border contact, weak quadrilateral fill, or threshold
  sensitivity.

Candidates are filtered through the canonical convex-quad validator before
return. A valid quad only establishes mechanical geometry; it does not establish
that the pixels depict the user's intended plane. `noCandidate` is a successful,
high-uncertainty assessment with an empty candidate list, not an error and not
permission to invent coordinates.

Every floating-point value crossing this Provider boundary is rounded to
twelve decimal places. This is a wire-stability rule so independently built
CLI and MCP carriers return byte-equivalent JSON for the same decoded pixels;
it is not an accuracy or calibration claim.

## Carriers and consumer flow

The full CLI exposes `plane-candidates`. The compact Agent catalog exposes
`plane_candidates`; the eight direct compatibility tools remain unchanged.
This operation is Agent/full-only and read-only. It does not enter Figma, Web,
ComfyUI, the portable Capability profile, or the deterministic core.

The supported flow is deliberately two-step:

1. call one Provider and inspect its candidate/source/uncertainty facts;
2. after an explicit caller selection, create a `RectifySpec` with that exact
   pixel source plane and a separately supplied integer output size, then call
   `rectify` or `rectify_render`.

No Provider result is automatically applied, and Worldbend does not infer the
output aspect ratio or treat the highest score as approval.
