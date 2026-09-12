# Spatial Template and Variation Job contract

Status: implementation contract for the owner-authorized reusable-production
foundation.

## Purpose and current consumers

`worldbend.spatial-template@0.1` preserves one already-closed Worldbend
production path so it can be reused with different sources. The first version
is deliberately narrower than a graphics scene or layer graph. It accepts
exactly one root operation:

- one existing single-source `worldbend.raster-program@0.1`; or
- one existing multi-source `worldbend.mockup@0.1`.

The root result is either published once or passed to one existing
`worldbend.canvas-set@0.1` to produce named size/crop variants. This directly
serves three current consumers: the Agent/CLI path that otherwise repeats and
revalidates a complete operation document for every source; Figma Mockup and
Sizes workspaces that already persist canonical operation values; and the
source-replacement workflow that must retain geometry while artwork changes.

`worldbend.variation-job@0.1` binds many explicit source sets to one template.
It is the first public multi-item production contract, so item identity,
correlation, failure, cumulative budgets, cancellation, and publication are
part of the contract rather than an adapter-local loop.

## Spatial Template document

A template contains `schema`, `version`, one `operation`, and one `output`.
The operation is a closed tagged union:

- `rasterProgram` contains one safe `sourceSlot` and one complete
  `RasterProgramSpec`;
- `mockup` contains one complete `MockupSpec`. Its distinct `sourceId` values,
  in first plane-use order, are the template source slots.

The output is a second closed tagged union:

- `single` contains one safe output `id` and publishes `<id>.png`;
- `canvasSet` contains one complete `CanvasSetSpec` and publishes each existing
  variant as `<variant-id>.png`.

Slot, output, item, and asset identities match
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`. Paths, credentials, Figma node IDs, and
host-specific resource coordinates are not stored in the template. Planning
validates the complete nested contracts and returns the required source slots,
ordered output IDs and derived filenames, root kind, and output kind.

The template does not rename, weaken, or reinterpret any nested operation.
Raster Program stages keep their current sequential single-raster meaning;
Mockup planes keep their explicit z-order and source identities; Canvas Set
variants all read the one root result independently.

## Variation Job document

A job contains `schema`, `version`, one complete Spatial Template, and 1 through
64 ordered items. Each item has one safe unique `id` and an ordered set of
bindings. A binding contains exactly one template `slotId` and one safe
`assetId`.

Every item must bind every required slot exactly once and must not bind an
unknown slot. Asset IDs may be reused across bindings and items. A render
request separately supplies exactly one carrier resource for every distinct
asset ID and no extras. Agent adapters resolve those resources under their
explicit granted root; human and workflow carriers resolve them through their
own authority boundary.

An item publishes one directory named `<item-id>`. Its outputs are the
template-derived `<output-id>.png` files. The complete job therefore produces
at most 1,024 correlated files. Item order and output order are preserved in
planning and results.

## Execution, budgets, and publication

The renderer validates the job, resource bindings, destination, response
budget, configured raster limits, and cumulative item/output limits before
publishing. It decodes a distinct bound asset at most once per item in v0.1,
executes the root through the existing native implementation, then renders any
Canvas Set from the in-memory root result. It never asks an Agent to relay
already-structured stages.

The complete job renders into one private directory beside the requested final
directory. Publication is one same-filesystem, no-replace directory rename.
Version 0.1 is all-or-none: an invalid item, render failure, cancellation,
timeout, memory breach, capacity rejection, response-budget failure, or
destination collision publishes no final directory. `dryRun` executes the same
validation, decoding, rendering, encoding, hashing, result shaping, and
destination preflight but omits the final rename.

The product ceilings are:

- 64 items;
- 16 source slots in one template;
- 16 outputs per item;
- 1,024 published files;
- existing per-source, per-output-axis, per-output-pixel, and operation-family
  ceilings;
- a configurable cumulative decoded-pixel and rendered-output-pixel budget no
  greater than the product ceilings declared by the native renderer.

Carriers may narrow these ceilings. Cancellation is checked between items,
between root and output rendering, and inside the existing render loops.
Results correlate every item and output with its IDs, relative path,
dimensions, encoded bytes, and digest. Timings are observations, not an SLA.

## Carrier projections

The first implementation enters the full CLI and compact Agent catalog as
template inspect/render and job inspect/render operations. Known requests use
one `worldbend.run` call; the default three-tool catalog remains unchanged.
The historical eight direct MCP tools remain frozen.

Figma authors and reuses templates through the dedicated quiet Templates
workspace and the existing Mockup and Sizes task objects. Templates is a fifth
replacing sibling workspace; it does not enter Perspective `EditorMode` or add
controls to the frozen Perspective operation bar. The contract does not
authorize a layers panel, job dashboard, source-path storage, or Agent/runtime
metadata in the human surface. A Mockup library entry remains the canonical
single-output Spatial Template above. A Sizes-only library entry uses the
adapter-local `worldbend.figma-task-template@0.1` envelope around one canonical
Canvas Set instead of fabricating a hidden Raster Program root; it is not an
Agent or CLI Spatial Template and does not widen the core union. Mesh and
Split Warp presets use the same adapter-local envelope around their canonical
specs. If the persisted template library cannot be
read or validated, the workspace may remain usable with an empty read-only
fallback, but save and delete must fail without writing client storage so the
unread library cannot be silently replaced. Saving under a name that already
exists in the library fails without writing storage, so entries stay
distinguishable by name. ComfyUI does not receive the job contract until
a graph-native use defines tensor/list ownership, cancellation, and
retained-memory behavior.

## Deliberate exclusions

Version 0.1 is not an arbitrary scene graph, layer stack, effect DAG, branch,
condition, loop, multi-template job, text/layout engine, asset registry,
collaboration model, or cloud queue. It does not detect a plane, choose a crop,
generate artwork, infer a source binding, or accept natural-language stages.
Assisted perception remains a separate typed proposal provider; accepted
proposals must become explicit Worldbend operation values before execution.
