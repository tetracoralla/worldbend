# Batch Results contract

`worldbend.results-batch@0.1` is one carrier-level operation that updates
every linked result of one source after the source changed. It adds no new
geometry: each result is recomputed through its own stored operation by the
canonical planners and renderers that produced it. The batch owns only the
relationship walk — order, correlation, partial failure, cancellation, and
reporting.

## Relationship

The batch runs from exactly one selected source. Its items follow valid saved
bindings from that source and its native containing Groups/Frames. A changed
result also changes the pixels of its native containers, so outputs bound to
those containers participate in the same update. Native grouping and original
content editing remain Figma operations; the plugin owns continuity of its
generated results. Names, proximity and unadopted copies do not create links.

Update prerequisites before their consumers, retaining document order among
ready items. An output sampling an assembled container waits for all affected
local results in that container. Every item retains its own binding-order
sources; downstream sources are exported freshly after their prerequisites
publish. Unrelated local results are not recomputed. A binding cycle or more
than 64 affected results is reported before publication. Ordinary discovery
lists at most 32 results; update preparation independently reads the full
affected set rather than silently limiting execution to the visible rows.
During and after a batch, the menu includes every prepared result and its
outcome, including failures beyond row 32, with the ordinary reopen action for
continued editing and recovery.

A valid binding remains a dependency even when its saved operation is damaged
or ambiguous. Discovery lists that result as needing repair. Preparation keeps
it as an invalid item and blocks its consumers; independent branches continue.
Filtering damaged operations out of the relationship walk would incorrectly
admit downstream pixels that still depend on unfinished work.

Slice one recomputes the single-source continuation families:

- `transform` results (a plane spec),
- `task` results of kind `mesh`, `surface`, and `deformation` (lifted into the
  shared deformation work through the loss-free lifts).

Native-guide-bound Deformation tasks retain two sources in binding order.
`shapeGuideSourceIndex` identifies the guide; the other source is the artwork.
Refresh exports current artwork and resolves the current native guide's complete
curves and regions, then uses the core to update the retained fitting-domain
choice. The saved plane, output size, corner correspondence and interior edits
survive. An unavailable or no-longer-eligible guide fails that item and blocks
its consumers while independent branches continue.

Slice two adds the multi-source family:

- `task` results of kind `mockup` with two through eight bound sources. The
  selected source supplies its live raster; each remaining bound source is
  re-exported from the document at the result's stored raster size through a
  dedicated main-thread export that re-verifies the binding, the page, and
  the selection generation before and after the read. The item then
  recomputes through the canonical Mockup planner — planes, background,
  opacity, and an optional clip — and republishes in place with its full
  binding-order source ids. A stored task without its binding-order ids
  fails that item as invalid rather than guessing sources.

The Composition slice also recomputes `task` results of kind `composition`:
all bound sources feed the Mockup planner, followed by the same whole-result
postprocess and selected named output used by normal Composition authoring.
The complete stored task and binding-order source ids survive publication.

The size slice recomputes single-source `canvas` results with fixed Contain,
Cover or Stretch dimensions through Canvas Set. A native scene's preview Frame
is an ordinary bound source; background, decoration, shadow and occlusion are
exported after affected projection prerequisites publish. The saved size
operation and requested pixels stay unchanged. Crop, Trim and Pad results keep
their ordinary reopen route; their source pixel-coordinate and dynamic-output
refresh behavior remains outside this slice.

Every other family — `rectify`, `effect`, `remap` —
is reported as `unsupported` with its kind, never silently skipped or
approximated. A multi-source result is never approximated by one of its planes.

## Execution

- Items run sequentially in dependency order, one render at a
  time, under the existing per-render capacity and image limits; a batch
  cannot exceed 64 items.
- Every item recomputes from the CURRENT source content through the stored
  operation's canonical plan — never from cached pixels — and publishes
  through the ordinary linked-result update path with all its guards
  (selection match and the host's prepared result snapshot). The host compares
  the live binding, operation, staged Composition draft, placement, appearance
  and raster metadata again immediately before publication. A newer edit,
  including an edit within the same operation family, fails that item with
  `conflict`; nothing is overwritten. Raster dimensions and logical canvas
  dimensions remain distinct so HD results can be updated in place.
  Recomputation preserves the result's native frame and transform, including
  rotation and parent-relative placement; its axis-aligned bounds are not a
  replacement size.
- Each item is one host undo boundary. Completed items survive later failures
  and cancellation (`continue` semantics for item-level failures). Discovery,
  decode, or publication-infrastructure failures abort the remaining batch
  and are reported as the batch-level error.
- The selected original, canvas viewport and saved local/whole operations stay
  in place; the result list reports progress without revealing every output or
  producing a separate toast for every item.
- Cancellation stops before the next item; it never interrupts an in-flight
  publication. The stop is reported as `cancelled` for the remaining items.
- Preparing owns one generation-bound request. Repeated clicks cannot replace
  it; changing the selection cancels the remaining chain and prevents late
  preparation replies or completion reports from taking over the new artwork.
- While a run is in flight it owns this carrier's publication flow: a
  publication started elsewhere in the UI (for example the Plane editor's
  Apply) is refused with its reason rather than racing the per-item completion
  routing.
- Partial success is the normal outcome: the report lists every item with its
  outcome — `updated` (with old and new revision), `unsupported` (with kind),
  `conflict`, `failed` (with the stable error), or `cancelled` — so one source
  change updates the intended related results while preserving successful work
  and identifying every failed item.
- A failed or unsupported prerequisite blocks its consumers without publishing
  stale intermediate pixels; independent branches continue. Cancellation skips
  remaining items. Retrying discovers fresh state and recomputes the chain.
  Main also enforces prerequisite completion, source binding order and target
  snapshots before exports and writes; UI ordering alone is not authority.

## External-Agent continuation

`figma_linked_results` uses the same relationship meaning with explicit
Inspect/Read/Publish actions over a granted file/page. Its plan guards every
target's original revision and appearance independently of upstream pixels.
Reading an item verifies successful prerequisite completions and then exports
fresh binding-order PNGs. Canonical rendering and the final guarded publication
preserve the stored operation, raster dimensions and native placement. Usable
pending Composition/Depth drafts are rebased without applying them; malformed
or stale drafts require repair. Later source edits invalidate a completion
instead of being mistaken for pixels already rendered at publication.

This route additionally refreshes saved Depth tasks. Its currently supported
and unavailable families, closed inputs, media transport and recovery are
specified in [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md). The Agent owns item reporting
and continuation; preparing a packet is not an executed Figma update.

## Operation scope

The batch does not create new results, duplicate outputs, or mutate stored
operations; it does not parallelize renders or share undo boundaries; it does
not infer relationships from names, pixels, or proximity; and it does not
update results whose family this carrier cannot recompute — those are
reported, not approximated.

Applying one chosen operation to multiple new artworks is a separate Figma
creation workflow. This relationship-update operation does not establish
coverage of that product capability.
