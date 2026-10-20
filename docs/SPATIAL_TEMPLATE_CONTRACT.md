# Spatial Template and Variation Job contract

Status: implementation contract for the reusable-production
foundation.

## Purpose and current consumers

`worldbend.spatial-template@0.1` preserves one already-closed Worldbend
production path so it can be reused with different sources. The first version
is deliberately narrower than a graphics scene or layer graph. It accepts
exactly one root operation:

- one existing `worldbend.raster-program@0.1`, with one evolving artwork source
  and any explicitly required immutable control maps; or
- one existing multi-source `worldbend.mockup@0.1`; or
- one `compositionProgram` that executes a complete `MockupSpec` first and then
  applies one complete ordered `RasterProgramSpec` to the composed canvas.

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
  `RasterProgramSpec`; its required source slots are that artwork slot followed
  by distinct `mapSlots` in stage first-use order;
- `mockup` contains one complete `MockupSpec`. Its distinct `sourceId` values,
  in first plane-use order, are the template source slots.
- `compositionProgram` contains one complete `composition` Mockup and one
  complete `postprocess` Raster Program. Its source slots are the composition's
  distinct plane sources followed by any additional postprocess map slots.
  A map can share a slot with a plane source; both read the original bound media.
  The raster stages consume the single in-memory composed result,
  so a whole-work perspective or signed Warp is observably different from
  applying that operation independently to every plane.

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
Mockup planes keep their explicit z-order and source identities; a Composition
Program preserves the fixed `Mockup -> Raster Program` order; Canvas Set
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
publishing. It decodes each distinct bound asset at most once per job in v0.1,
executes the root through the existing native implementation, then renders any
Canvas Set from the in-memory root result. It never asks an Agent to relay
already-structured stages.

The complete job renders into one private directory beside the requested final
directory. Publication is one same-filesystem, no-replace directory rename.
`failurePolicy` defaults to `allOrNone`: an invalid item, render failure,
cancellation, timeout, memory breach, capacity rejection, response-budget
failure, or destination collision publishes no final directory. `continue`
keeps item order and publishes successful item directories; failed items stay
in the result as `status: failed` with the original error and do not appear
on disk. Job-level schema errors, unknown extra assets, and destination
collisions still abort the whole job; a missing asset is a per-item decode
failure under `continue` and a schema abort under `allOrNone`. A `continue`
job where every item failed still publishes an empty final directory on a
non-dry run, so a published destination always means the job ran. Cancellation,
worker timeout, memory/capacity failure, filesystem publication failure, and
internal/evidence failures abort without a final directory under both policies.
`continue` applies to item-local media, geometry and raster-limit failures; it
does not turn a cancelled job into successful publication. Agent path validation
and private source staging remain job-level preflight; omitting an asset is
supported, but an explicitly supplied invalid or unauthorized path aborts.
Exhausting the cumulative rendered-output-pixel budget also stops remaining
items with the budget error; an asset that would exceed the cumulative
decoded-pixel budget is recorded as a failed decode for its items while later
smaller assets may still decode. Retained source pixels narrow the decoder's
allowance before its next allocation. Processed pixels are charged before each
root stage and output set starts; `cumulativeProcessedPixels` includes admitted
work in items that later fail. Per-source or per-output dimension failures do
not exhaust the job's shared budget. An actual non-fitting cumulative charge
latches exhaustion so later items fail without repeating work. `dryRun` executes the same validation,
decoding, rendering, encoding, hashing, result shaping, and destination
preflight but omits the final rename.

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
dimensions, encoded bytes, and digest. Rendered items retain `rootWidth`,
`rootHeight` and `operationPixels` in camelCase, with `status: rendered`; failed
items carry `status: failed` and their typed error. Timings are observations,
not an SLA.

The Agent controller treats the native worker result as a carrier boundary: it
requires the returned plan to equal the requested plan, recomputes source pixel
evidence and encoded-file digests, and enforces the request's narrower budgets
before staging any publication.

## Carrier projections

The first implementation enters the full CLI and compact Agent catalog as
template inspect/render and job inspect/render operations. Known requests use
one `worldbend.run` call; the default three-tool catalog remains unchanged.
The historical eight direct MCP tools remain frozen.

Figma authors and reuses templates through the dedicated quiet Templates
workspace and the existing Mockup and Sizes task objects. Templates is a
primary sibling workspace; it does not enter Perspective `EditorMode` or add
controls to the Perspective operation bar. The contract does not
authorize a layers panel, job dashboard, source-path storage, or Agent/runtime
metadata in the human surface. Selecting two through eight ordinary sources
enters Composition directly. Its layer scope edits the Mockup planes; its
whole-result scope authors the one bounded Perspective/Warp stage, target size,
and up to eight named Crop/Contain/Cover/Stretch outputs in the same standard
`compositionProgram`. Preview chooses one output while Apply stores the full
task and bindings for reopen, Agent staging and downstream continuation. A
legacy Mockup library entry remains readable and upgrades to that standard task
when whole-result editing begins. A Sizes-only library entry uses the
adapter-local `worldbend.figma-task-template@0.1` envelope around one canonical
Canvas Set instead of fabricating a hidden Raster Program root; it is not an
Agent or CLI Spatial Template and does not widen the core union. Mesh and
Pin Warp presets use the same adapter-local envelope. New saves retain the
complete canonical Deformation Work with its reopening view (`mesh` or `pin`),
including the plane, fitted contour and corner landmarks, compound mask, Pin
controls, Liquify strokes and explicit Mesh placements. A generated mesh or a
partial editing view cannot replace that authored recipe. Old Mesh and Surface
entries remain readable. Reusing the work on another artwork changes only its
output size; all normalized controls and the complete mask stay unchanged.
Use validates the whole work through the core before switching views, and a
source or workspace change invalidates a pending use. Its artwork-free thumbnail
shows the core-projected compound fill, including holes and separate regions.

Every saved Figma library record may carry slot descriptors — one
per bound source, in binding order, each naming the source layer and the
raster dimensions the template was authored against (1 through 8 slots,
bounded names and 1..4096 axes). Slots are captured from the live selection
at save time, surface in the Templates list beside each entry, and stay
optional so older libraries remain readable; they describe provenance and
supported input scale, and never alter execution. Each record also stores a
derived appearance boundary — the appearance behaviors its recompute
actually supports (perspective placement, per-plane opacity, and an explicit
Mockup or Deformation Work clip when present, authored light on a nonzero Cylinder/Fabric surface)
and the ones it does not (native scene masking and occlusion). The boundary is exhaustive, disjoint and computed from
the template's own operation. Unknown, incomplete or overstated records
fail the library check; an older cached boundary that understates current
support is admitted and refreshed without discarding its saved work. The Templates list states the
unsupported scene-look boundary beside geometry-only entries. External Agents
discover these facts through the read-only file-level `figma_templates_inspect`
prepared request. It reads geometry entries from available client storage and
current marked native masters from the file, including their replaceable slots,
actual page and current projection appearance boundary. Unavailable client
storage does not hide those masters; unreadable or limited coverage remains
explicit under [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md). If the persisted template
library cannot be
read or validated, the workspace may remain usable with an empty read-only
fallback, but save and delete must fail without writing client storage so the
unread library cannot be silently replaced. Saving under a name that already
exists in the library fails without writing storage, so entries stay
distinguishable by name. ComfyUI does not receive the job contract until
a graph-native use defines tensor/list ownership, cancellation, and
retained-memory behavior.

Figma's ready-scene catalog is separate from the persisted library's 32-entry
limit. Its original native constructions bind one editable artwork slot
and a hidden geometry guide to an existing Mockup. A user-saved native scene
record additionally carries a closed `worldbend.figma.scene@0.1` reference:
scene identity, Page hint, root/preview/result node IDs, ordered source IDs and
the replaceable subset. These are Figma carrier references, not fields of the
core Spatial Template. A copied scene receives a fresh identity and local
bindings; copied native shader/vector continuation records migrate together
with those bindings. The Page ID is a recovery hint; moving an intact master
within its file does not itself destroy its identity.

Native masters preserve Figma backgrounds, masks, occlusion, effects, type and
layout. The derived appearance partition describes only what core projection
recompute owns, not which native layers the scene retains. Save scene captures
the current task and rendered artwork into an independent native master;
subsequent reuse reads the master's current task and clones it before replacing
its editable slots with uniform Cover/Contain fitting. It preserves source
editability and the native preview hierarchy. The library entry is client-local;
its native master is file-native. Removing an entry clears only its matching
library marker and preserves that document graph. Failed storage writes restore
the marker and retain the previous library.

The complete native preview uses Figma export. Apply and size complete scene
publishes the current adjustment, then passes its containing preview Frame to
the existing Canvas Set authoring and publisher. Native source/decorative layers
remain in Figma; each size result binds that Frame and stores its canonical
Canvas operation. Linked-result updates refresh affected projection prerequisites
before exporting that complete Frame and regenerating fixed Contain/Cover/Stretch
sizes. Composition's core Canvas Set outputs still consume its projection.
External-Agent cold creation/reuse remains delivery work. The core Spatial
Template is not widened into a Figma scene graph.

## Deliberate exclusions

Version 0.1 of this Template contract is not an arbitrary scene graph, nested
layer stack, effect DAG, branch,
condition, loop, multi-template job, text/layout engine, asset registry,
collaboration model, or cloud queue. It does not detect a plane, choose a crop,
generate artwork, infer a source binding, or accept natural-language stages.
Assisted perception remains a separate typed proposal provider; accepted
proposals must become explicit Worldbend operation values before execution.
Its one two-phase Composition Program exists because "deform each source" and
"compose sources, then deform the whole" are materially different user jobs;
it is not permission for an adapter to invent arbitrary nodes. Richer shared
work belongs in the Spatial Document when a workflow needs it.
