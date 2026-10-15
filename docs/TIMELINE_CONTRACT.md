# Deterministic timeline contract

Worldbend Timeline is one ordered, atomic frame program. It consumes explicit
source identities and geometry; it does not track motion, estimate optical
flow, recognize a subject, invent keyframes, interpolate masks from pixels, or
edit audio.

## Document and expansion

`worldbend.timeline@0.1` declares one fixed integer output size and exactly one
program:

- `frames` supplies 1 through 240 ordered frames. Every frame has a unique safe
  ID, an exact `sourceId`, and a complete `TransformSpec`.
- `keyframes` supplies one `sourceId`, a frame count, a base TransformSpec, and
  strictly increasing corner keyframes that explicitly cover frame zero and
  the final frame. Version 0.1 supports only linear interpolation of the four
  destination corners. Content, source orientation, coordinate space, and
  every other TransformSpec field come from the unchanged base document.

Planning expands either form into `worldbend.timeline-plan@0.1`. Every planned
frame contains a zero-based index, stable ID, source identity, and complete
validated TransformSpec. Keyframe IDs are `frame-000000` and onward. Every
intermediate quadrilateral passes the same convexity, winding, horizon, and
numerical validation as a standalone transform; an invalid intermediate frame
rejects the complete program.

## Rendering and publication

A render request supplies exactly one source raster for every distinct planned
`sourceId` and no extras. Sources are decoded once and reused. Every frame
renders independently from its named original source into the declared fixed
reference size; frames do not consume prior frame output.

The core caps one program at 240 frames and 64 Mi output pixels cumulatively.
Carriers may narrow that ceiling. The renderer encodes ordered `<id>.png`
files in private staging, verifies item/plan correlation and hashes, and then
publishes one new directory with a no-replace atomic rename. Dry-run performs
the same planning, decoding, rendering, encoding, hashing, and destination
preflight without publication. A failure, cancellation, timeout, capacity
rejection, or byte-limit failure publishes no partial directory.

## Product boundary and carrier projection

Timeline is a specialized sequence contract, not a generic batch endpoint:
ordering, correlation, source reuse, all-or-none failure, cumulative budgets,
and publication are fixed by this document. The Agent `full` build exposes
`timeline_plan` and `timeline_render` through the compact catalog. Figma and
ComfyUI do not currently claim sequence execution, so their builds omit the
timeline feature. Comfy IMAGE batches remain rejected; a later graph-native
video projection must first define host tensor ordering, cancellation, memory,
and output semantics rather than looping this API in Python.
