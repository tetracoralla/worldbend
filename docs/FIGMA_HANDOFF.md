# Editable Figma results and Agent handoff

## Where the work lives

This document specifies the current implemented handoff for external-Agent
creation, publication and continuation. Composition can publish
an edited task through a guarded request. Depth can publish an edited recipe,
state and source-role order through the same core-rendered route. Optional
staging preserves a draft for human preview before publication.

For a designer already working in Figma, the Figma file remains the working
artifact. Worldbend adds a result node with a source binding and saved
operation; the designer edits supported native content and reviews the result
on that canvas. The external Agent route addresses that same result in the
same file through Figma MCP. It does not require the designer to create a local
project, run a Web editor, copy operation JSON or export images for each
revision. The Agent still needs access to the target file and result. The
Perspective and Depth requests take the granted file, page and node IDs
explicitly. Composition can start from a result-node design link with
`node-id`; its request resolves the page inside the granted Figma file. A link
does not itself grant Agent access or identify a result when `node-id` is absent.

The current same-file Agent route covers editable Perspective geometry and
Composition and Depth publication and staged review. Source-linked raster work
also supports guarded refresh of its saved Transform/Rectify, Canvas, Remap, Mesh, Pin,
Composition and Depth operation. Agent cold creation also supports these raster
families through `figma_work_create`; `figma_work_revise` reads their durable
state and selectively revises controls, source slots and output dimensions.
Wider authoring families and other carriers remain delivery work. The separate headless Composition route in
`docs/SCENE_WORKFLOW.md` still uses copied parameters and exported rasters
when the result is produced outside Figma.

Composition optionally carries `motion: {spec, frame}` with a complete canonical
MockupMotionSpec and selected poster frame. Human seeking, pose edits, capture,
removal, retiming, easing and playback preserve the outer Composition transform,
Warp and named output definitions. Saving/updating the linked image or a reusable
template retains the program for cold reopening. Agent work reads return that
same program in their exact parts, and a guarded static revision updates its
poster pose without discarding other authored times. The saved task is checked
against a 90 KiB UTF-8 envelope before any shared operation slot changes, below
Figma's 100 kB entry limit; rejection preserves the draft and existing result.

The animation inspector edits linked layers and the whole linked result. In a
native scene, **Create complete scene animation** prepares canonical image
frames, copies the complete native scene and its source closure, and applies
held native Motion visibility tracks around those image frames. Native
background, masks, foreground, effects and admitted native Motion remain in
the copied graph. The native MP4 export includes that graph; the UI offers its
returned bytes as a downloadable file. This carrier projection does not turn
projective quads into native affine Motion or a three-dimensional camera.

The generated root reopens the retained Composition task through its primary
poster result. Copied source layers remain editable beside the encoded frame.
A later delivery copies that work again and rebuilds its owned image-frame
gates. Cancellation removes provisional scene/source copies; an already
completed native scene survives an encoder failure or cancellation. Source or
selection changes invalidate pending work. Staging admits at most 64 MiB of
frame images and native MP4 transfer, and the native encoder uses its supported
12/24/30/60 fps and a 1920×1080 envelope without enlarging the scene. Beta Motion
access is required for this action; ordinary static work does not require it.
The canonical core's resource and timebase rules remain independent.

Ordinary document projection still reports the poster-only loss explicitly and
returns the retained program as `authoringMotion`; callers must not label that
static document a full animated delivery. Agent-triggered native complete-scene
encoding and portable native-decoration semantics remain delivery work. Agent rendering of a selected Canvas Set output retains sibling output
definitions and uses the existing canonical Canvas stage for actual pixels.

`projectTemporal` now accepts published Composition as well as Mockup work.
Composition contributes its exact whole transform and complete named output set
to the video's shared presentation; an inconsistent caller presentation is
refused. Temporal return preserves the complete program, chosen poster, whole
transform and named siblings in the Figma Composition task. Source-slot rebinding
also updates every motion plane. Retiming preserves relative poster position.
Unframed temporal work returns through an identity Composition authoring template
while retaining its original program. Encoding remains a native delivery action;
native decorations outside linked layers are not silently included.

The human plugin also publishes native geometry for bounded filled Figma
Vectors with straight or cubic boundaries and one expandable solid stroke.
The same carrier has a cold-create and revision entry through
`figma_vector_work`. Supported whole Frame/Group artwork keeps its paint order
and outlined text alongside primitive paths; publication uses the shared core.

Worldbend keeps a Frame's native children editable. Affine results use
core-planned native transforms and instance scaling without a companion;
projective appearance uses the pinned companion Figma Shader. A designer selects a clipped,
unrotated Frame, moves the existing Transform or Distort controls, and chooses
**New Editable Frame** in the footer, or **New Linked HD Image** for a stable raster.
Frames whose own border, shadow or blur extends beyond that logical rectangle
use the complete-appearance HD route: the Shader's input UV extent cannot retain
those outside pixels. Existing Shader Frames keep their authored logical Content
viewport on reopen and update, including after native edits; full outside paint
is captured by making an HD result from the original artwork. The original is preserved. The
new version 0.3 result owns a hidden source component and its live instance,
inside `Projection > Basis > Live content > Content`. Text, image fills, auto
layout and other native children remain editable. Select the result alone to
reopen its operation. Transform updates preserve the result, source component,
instance and Content identities; the managed Projection can be replaced.
Older direct `Perspective > Content` results remain readable and editable.

Owned native works retain their actual containing rotation, reflection and
shear. Independent copies and retained previous artwork escape clipping and
auto-layout ancestors without resizing or moving the original design. When a
composed basis cannot be stored on one Figma Frame, transparent coordinate
layers preserve its legal matrices; selecting their outer frame opens the
same native work. Intrinsic output size remains distinct from page bounds.

During a pointer drag or Space-drag pan in the preview, the surrounding source
name, output dimensions and corner-mode controls temporarily disappear. Release
or interruption restores them without shifting the preview layout. Space-drag
pans from corners and the pivot too, preserving the plane geometry. Keyboard
nudges keep these controls visible.

Edit text and move elements directly on the Figma canvas. While the plugin is
open, selecting inside a native result's private Content tree keeps that result
in the preview; content changes refresh it automatically and preserve the
transform draft. Ordinary artwork follows the current selection: selecting A
targets A, selecting B targets B, and selecting their Group or Frame targets
the assembled whole. **Edit source** exposes the owned
source on the canvas for adding/removing layers and changing layout or size;
**Return to result** recomputes its projection through core. This state survives
closing Worldbend. Each result owns independent content, so editing the original
does not change it. An explicit source replacement keeps the selected result ID
and retains the prior work, including its actual Content IDs and edits, as
independent previous artwork. Successful replacement selects the result so later
Update actions continue its owned content instead of repeating the source swap.

For a visible solid Rectangle, Ellipse, Polygon, Star or Vector, the
footer offers **New Native Vector**. The main thread maps the freshly read
network onto the shared core input; the UI relays it through the same WASM
bridge every carrier uses, and the core projects it under the canonical
transform semantics. Publication creates one Frame containing one native
Vector child that remains ordinary editable Figma geometry. Select the result
alone to reopen the original source and operation, then use **Update Native
Vector** to replace only the generated child while keeping the result Frame.
Figma's native flattening resolves shape parameters and rounded vertices,
including independent rectangle radii/smoothing and ellipse arcs. Solid
inside/center/outside, dashed and multiple strokes are outlined natively into painted
regions, including native per-side rectangle border weights. Capture uses fresh
temporary shapes in preserved native local ancestry rather than assigning a
compound absolute matrix to a detached shape, retains
the original logical bounds and applies layer opacity once to the combined
result. All temporary nodes are removed after reading; the original remains
bound for fresh recapture on Update. Differently painted regions require
explicit solid fills. The resolved network accepts 3–8192 vertices, 3–16384 segments and 1–2048 filled regions,
with holes, multiple regions and both winding rules. Straight boundaries and
affine curves stay exact; strong perspective subdivides curves inside the
requested pixel budget and reports the proven bound. One visible solid
center-aligned stroke may publish as a fill outline (`strokeOutlined`), with
its caps, joins and miter limits reconstructed exactly where possible. The
apply status states approximation bounds and outlined strokes, including
native stroke conversion. The core's projection bound does not claim a
bound for Figma's own native conversion. Solid paints are captured as their
currently resolved colors and opacity, including the source's inherited
variable mode. Published paths freeze that appearance; the original keeps its
variables and styles, and Update recaptures their current values. Text clones
retain the current content/font mode while Figma resolves their outlines.
Gradients, image paints, effects, masks,
unavailable native stroke outlines, Correct and unreliable
stroke geometry retain the HD image route instead of being silently flattened
or approximated. Records from the exact straight-path era reopen unchanged.

A whole Frame or Group is the second native Vector source. Each supported
paint layer becomes one projected Vector child of the same result Frame, in
paint order: a Frame's fills render first as a synthetic background
rectangle, then Text, shapes, Vectors, lines and boolean results. Components
and instances contribute their background and supported descendant layers.
Each Frame/component border becomes a separate part above its own children,
as in Figma's native paint order, within the same 64-part complete-job budget.
Figma resolves text glyph outlines, native corners and boolean output before the shared core
projects the part under the whole artwork's bounds. Every part keeps its
layer's opacity and blend; per-layer strokes are outlined in native paint
order, and a part's stroke-outline regions are exempt from the
placement-fit check exactly like core-expanded strokes, including a fill
merged with its identically painted stroke. Text layers (and
component text) publish as frozen editable outlines — the status says so and
they are not live TEXT afterward; the original Frame and its text remain
independently editable for Update. Layers with unavailable fonts keep the HD
image route rather than freezing fallback glyph shapes. Selection reads never
create temporary geometry: whole-artwork availability is a read-only
structural walk plus font loading, and the capture itself (page-level temps,
native clones moved synchronously into temporary legal coordinate ancestry,
then outlined/flattened by Figma) runs only for a projection request or apply.
The original absolute bases participate in the source freshness proof, including
equal-bounds ancestor rotations. Any unsupported
layer — gradient or image fills, visible effects, masks, semi-transparent or
blended containers (including isolated groups with blended descendants),
text beyond the bounded native work/outline capacities, unsupported node kinds, or more than 64 captured parts — declines
the whole capture; nothing is silently dropped from a published result, and
the HD image route stays available. Each part stays inside the core's
3–8192 vertex / 3–16384 segment / 1–2048 region input budget. Whole-job input
additionally fits 8192 vertices, 16384 segments, 2048 regions and 131072 loop
references; compute, emitted geometry and carrier transport remain independent
limits. Modern Agent state/capture uses bounded lossless compressed envelopes and
shared staged transport; complete geometry and controls are never truncated. Clipping Frames,
components and instances use native per-region intersections at every needed
ancestor, retaining rounded corners, hole loops and region paints. Empty
intersections contribute no output; their siblings remain intact. At most 64
region/ancestor intersections run per capture; captures beyond that bound keep
the HD route. Native capture retains the original logical bounds. A native
stroke outline can extend outside that window while the HD PNG export crops
to logical bounds; these are not interchangeable source views. Non-identity
canonical mesh projection refuses out-of-domain geometry, and the nonlinear
native carrier must resolve this source-view boundary before claiming parity.
The apply error
names the HD route. Multi-part results record version `0.2` with one
fingerprint per part (`worldbend.figma.native-vector`); single-part results
keep the 0.1 single-content record, and both reopen, update in place, survive
independent copies with rebound part identities, and refuse to overwrite
hand-edited generated paths. If any part's core projection is refused, the
whole apply completes on the HD image route instead of publishing a partial
stack.

An ordinary Figma Duplicate can reopen using its own unchanged Vector children
while retaining the same original source. Reopening is read-only; Update adopts
the copy's result and part identities, preserves its placement, and leaves the
original result untouched. A changed or reordered child prevents adoption.

The current visible paths of a native result or its duplicate can also serve
as independent artwork for a new Vector work. This capture guards the physical
artwork subtree rather than requiring an old Worldbend source binding to remain
available. It does not adopt or overwrite the previous result, or copy its
linked source graph; saved-scene source-graph copying retains its own contract.

Direct edits to the generated Vector remain useful Figma artwork, but they end
Worldbend's right to overwrite that result. Reopen reports the changed result
and asks the designer to select the original source for a new output. Source or
selection changes during publication cancel and roll back the attempted write.
The main thread also verifies that the forward matrix matches the stored
TransformSpec before any durable document mutation.

A selected result exposes its matching update plus the independent output
routes supported by its resolved source. Creation preserves the selected
result, even when the output type is the same. Image results update in place
through **Update Linked HD Image**. Reopening a result alone resolves its saved source
and canonical operation; it never uses the already-transformed raster as its
source. Image results reference the producing source (original or an editable
result's Content). Edits made there with Worldbend closed appear in the preview
when reopened; the previously published snapshot changes only after Update.
Missing or invalid saved state fails explicitly; a missing source can be
replaced by selecting the result and a replacement source together. Return to
the original to start a fresh operation when saved geometry is invalid.

The editable Frame is a bounded native-content carrier. Its rendered appearance is sampled
by Figma's GPU, not a set of geometrically rewritten vector paths. It supports
the canonical affine/projective TransformSpec and explicit source flips.
Warp, Correct, arbitrary source rotation, and output axes beyond 4096 are not
supported as editable output. **New Linked HD Image** and **Update Linked HD Image** re-export
the resolved source as needed and use the core-backed renderer at a minimum of
two pixels per document unit, retaining an already denser raster. When the
core resolves an unchanged full-source mapping and a fresh source PNG matches
the requested output dimensions exactly, HD image publication retains those
PNG bytes without resampling. Flips, fitting/insets, projective changes,
interior deformation and mismatched exported dimensions use the renderer.
Repeated reopening does not double the stored density. Correct uses its explicitly
entered pixel dimensions. Existing output-density policy still
fits or rejects axes above 4096. Editable Frames and Native Vector results use
their logical dimensions for the separate 4096-axis limit; the HD density
preference does not change native availability. The new image preserves logical size and the editable
master; its binding points to that master's native Content. It is a
delivery snapshot and does not update live. Text and layout inside that image
cannot be edited directly. The content view box is retained
at its publication size; changing its dimensions requires reapplying before
claiming the updated geometry. In the tested Figma host, effect texture density
stays at the on-canvas size even for 2x exports; 4096x256 measured 2048x128 input
and output textures. Its downstream resampling softens detail. Increasing
export scale does not recreate vector-quality effect output. Native screenshots
are not byte-identical to the reference raster renderer.

Mesh and Pin Warp publication also re-export the original artwork at the density
required by the core's deformed mapping. They publish at least two pixels per
document unit, retaining denser existing output, with aspect-preserving raster
fitting to the 4096-axis ceiling. Publication pixels are separate from the saved
work's target coordinates; reopening, switching views and linked refresh retain
the same normalized mesh, fitting, source binding and document placement.
Linked refresh renders at the stored pixel dimensions and reacquires a source
raster when the preview lacks the required detail. Failed source export leaves
the previous result intact and keeps the draft available for retry.

The Templates workspace also imports a Photoshop curve: **Use curve from
PSD** reads a local PSD or PSB (≤64 MiB) inside the plugin UI, lists its
Smart Objects with their importability, and adopts one `warpCustom` 4×4
curve onto the selected artwork. The sixteen controls stay live in the Pin
view, the placement perspective carries over, and publication is the ordinary
Apply. Parsing normally runs in a worker; a host that refuses worker startup
falls back to the UI thread after lazy initialization. This fallback cannot
interrupt a synchronous parse. Neither path yet enforces a cumulative
descriptor allocation budget; see the PSD interoperability contract. Cancel
and selection changes invalidate pending adoption. A worker runtime failure
is reported without replaying the same input on the UI thread, and
a pending read is dropped when the selection changes. Unsupported objects
remain disabled; typed rejection reasons are returned by inspection, while
the current picker shows a generic unavailable label. See
[PSD_SMART_OBJECT_INTEROP_CONTRACT.md](PSD_SMART_OBJECT_INTEROP_CONTRACT.md)
for the supported family and its provenance.

Selecting a source exposes **Results**, then **Update all results**. The batch
refreshes linked HD images and single-artwork Native Vector results together,
including saved perspective and complete Mesh/Pin work; a native Vector
publication is never replaced by HD raster. Each result keeps its own
transform, controls, placement and identity. A changed source aspect ratio
refreshes automatic input windows; explicit input-window policies are retained.
Native Vector results whose generated paths were edited directly are preserved
and reported individually, while independent results continue. Stop skips work
that has not reached publication; an item already being published completes its
atomic write. Each update has its own document Undo boundary. Results bound to
a native shape guide refresh in the same run on both carriers: the current
artwork and the current guide's resolved curves re-enter the retained fitting,
and a deleted, hidden or no-longer-eligible guide fails only that item with its
reason while its consumers are blocked and independent branches continue.
Every prepare, per-item apply, bound-source export and completion carries the
preparing run's identity, so a late or retried attempt cannot publish stale
pixels or satisfy another item's request; conflicts are reported distinctly
from failures.

In the tested Figma host, SVG export of a Worldbend editable Frame omits its
projective Shader appearance and exports the untransformed Content. Native
Flatten also does not bake that appearance into projected vector paths. Use
the linked HD image route when delivering the editable Frame's rendered
appearance. **New Native Vector** is the vector delivery route for whole
artwork: a Frame or Group publishes its text, shapes and components as real
projected vector paths whose native SVG export keeps the projected geometry,
under the layer and paint boundaries two paragraphs above.

A separate authored diagnostic also created a double-size GPU texture, then
returned it from `render` and assigned it to `frame.output`. In the tested
desktop and at export scales 1 and 2, Figma still displayed the original host
target. The assignment did not throw; it was ineffective as an output handoff.
Creating a larger intermediate texture therefore does not establish a usable
higher-density display path. This observation covers only the two exercised
paths in the tested host.



### Brand-brief consumer entry (presentation + social sizes)

For the product-screen / brand-style brief, cold-create editable Canvas
Contain/Cover presentation and social sizes with `figma_work_create`, finish
media through linked publication, then project with `figma_work_continuation`
into a Spatial Document whose `canvasSet` names `website-presentation`,
`social-square` and `social-wide`. Weekly screen replacement uses
`figma_work_revise` or document `document_update_plan` with the current
fingerprint; stale source/fingerprint rejects. See
[SPATIAL_DOCUMENT_CONTRACT.md](SPATIAL_DOCUMENT_CONTRACT.md) and
`examples/brand-brief-document.worldbend.json` (installed Skill twin
`skills/worldbend/assets/documents/brand-brief-document.worldbend.json`).
The packaged Skill includes the same document fixtures, and
`pnpm test:brand-brief-installed` verifies staged CLI continuity. This evidence
does not establish Agent Host marketplace import, public marketplace
publication, or authoring behavior beyond the declared programs.

## Renderer acquisition

Perspective exposes three distinct output intents. **New Native Vector**
publishes supported solid artwork as projected paths (text becomes editable
outlines), without a companion effect. **New Editable Frame** preserves live
native text/content and uses the companion's sampled perspective appearance.
**New Linked HD Image** captures complete rendered appearance. A Frame may offer
both native choices; one does not replace the other. The selected saved result's
Update always keeps its own output family, while New creates an independent
result. Frame eligibility survives a missing or pending companion import, with
keyboard-reachable acquisition guidance; it never enables unsupported vectors.
If the vector core refuses freshly captured geometry, publication preserves
the original Vector and creates a separate HD image, explicitly reporting the
fallback rather than a successful Vector update.

New results try the exact renderer build bundled in the plugin. Reopening and
recovery retain a result's recorded build. An explicit Update Frame or Agent
apply replaces the measured defective alpha build with its verified correction;
The verified eleven-label-only successor of the corrected sampler is also used
on explicit publication, keeping its sampling and property keys unchanged.
Other retained builds remain exact. If that correction is unavailable, the
update fails before writing instead of silently retaining the defect. A
development page can override the
new-result default through shared plugin data `worldbend/nativeRenderer`:

```json
{"schema":"worldbend.figma.projective-sampler","version":"0.1","id":"RESOURCE/BUILD"}
```

RESOURCE/BUILD is an exact effect version. The runtime requires eleven numeric properties:
`h00` through `h22`, `sourceRight`, and `sourceBottom`. Their Figma property IDs
are discovered from the imported definition, never guessed from display names.
No capability is advertised without a matching available effect. Availability
in the developer's account does not establish availability in another account
or plan. [Worldbend Perspective](https://www.figma.com/community/shader/1692554770100764677)
must be available to that account before editable output can be used; HD images
work independently. Add the effect from Figma's Tools panel when available.
Bundling its identity does not install the effect. Imports verify
the exact version, including the observed resource-hash/UUID alias. A failed
import is retryable after installation; no name-only fallback is used.
A desktop file can retain a stale shader catalog after an effect is added.
If Tools can apply the effect but the plugin cannot import it, save and reopen
that file. An unavailable effect leaves editable output explicitly
unavailable but keyboard-reachable (`aria-disabled`), with its recovery
instructions visible in the panel beside the output actions, not only in a
hover tooltip. HD images still work. The panel opens the Community listing
through a one-click **Open effect listing** action so a designer can add
the effect without hunting for the resource id or moving a copied URL between
applications.

Renderer imports have a five-second deadline and a failed import can be retried;
source raster export and renderer discovery run concurrently. Source delivery
does not wait for discovery: image preview and HD output remain usable while
editable output is preparing. Late availability applies only to the matching
selection generation and source/result pair, without resetting the draft.

Repeated HD output in the same unchanged selection reuses one decoded source
at the exact requested raster dimensions. Transform and Correct share this
bounded slot; a source/selection refresh invalidates it immediately, and another
resolution replaces it. Failed or obsolete reads are never retained. Final
rendering still uses the canonical operation and full requested resolution;
the cache contains source pixels, never an already-transformed result.

The core owns validation, inversion and orientation. The adapter only converts
output pixels into surface UV units. The outer result clips the output; a
larger inner surface accommodates the unchanged source dimensions. The sampler
rejects UV outside the source plane and clamps valid bilinear taps to its edge,
interpolating Figma's already-premultiplied input directly into its premultiplied
output. `pnpm test:figma-shader` compiles the owned source and checks actual GPU
sampling, including translucent transitions, flips and source extents. This
does not model Figma's later compositing or the core renderer's plane-boundary
coverage. Real host pixels are also required when changing a shader build.

## Shared state

All state is attached to actual nodes, not a designer-authored description:

- `worldbend/transform` retains the canonical TransformSpec.
- `worldbend/binding` identifies the result, ordered source IDs, raster size,
  and publication revision. Its strict reader rejects another result ID.
- `worldbend/native` records the exact Content and Perspective IDs, source and
  output view boxes, applied shader ID/properties and matching operation bytes.
  Version 0.2 also records placement so recovery includes position and size.
  Version 0.3 records the owned component/instance graph, core-planned native
  bases, actual scale, affine or projective renderer, and source-editing state.
- `worldbend/nativePlacement` marks transparent coordinate containers. They
  carry host pose, not a second transform engine or an independent operation.
- `worldbend/nativeShaderTemplate` identifies one hidden, locked page resource
  for preparing sampler/style properties before cloning published projections.
- `worldbend/nativeVector` records the exact result, generated Vector, source,
  projected-geometry fingerprint, output size, placement and matching operation
  bytes. Its strict reader rejects copied identity, extra fields and a source
  aliased to the generated child.

Selecting one source layer now shows the Worldbend results on the same Figma
page that still have a valid binding to that layer. The designer can choose a
result from the plugin and continue editing its saved operation; the plugin
selects and reveals that actual Figma node. The list includes a result's
operation and canvas position when available, so similarly named results can
be distinguished. The list is derived from result records at selection time,
not stored as a second index or a separate project file. A result whose
copied raster binding passes the closed reference checks is included under
the copy's own node identity, without changing the saved bytes on discovery. The
first 32 related results are listed; further results remain selectable from
Figma's layer list. If Figma's page search fails, ordinary source editing
continues and the plugin points back to that layer list. Each published raster
is still an independent snapshot:
changing a shared source makes its new pixels available when a linked result
is reopened, and the designer publishes that result by applying it. This
does not silently replace every dependent image.

Raster publication also records the image fills it wrote. Later reopen,
in-place publication and linked refresh preserve a result whose fills were
edited in Figma (including image replacement, crop, filters, fill opacity or
additional paints), and ask the designer to select the original source to make
a new result. Layer opacity, effects, strokes, corners and canvas placement
remain native customization and are retained on update. A native Duplicate
keeps the paint guard by value and acquires its own binding on publication.
The paint guard rolls back with the image and binding if a write fails. Older
results have no saved paint proof: they remain usable, reject fill drift between
read and write, and gain the durable guard on their next successful publication;
edits made before that first guarded read cannot be identified retrospectively.

An ordinary Figma Duplicate of a linked raster result can reopen its saved
operation, output density and ordered source bindings. The read-only carrier
reader resolves the copy as the current result; the strict stored-record reader
still rejects the old result identity. Update publishes into the copy, adopts
its actual identity and advances the copied publication revision, while leaving
the original result unchanged. Result discovery, dependency-ordered refresh and
Agent inspection/publication use the same reference resolution. Failed writes
restore the copied record and pixels for retry; malformed operations or source
aliases remain invalid. A result-only duplicate stays linked to the original
artwork. Save scene/reuse separately clones and rebinds a scene's source graph,
starting a new scene result's publication revision at one.

Result updates keep their existing native container. Absolute placement is
converted through the containing Frame, Component or other coordinate parent;
Figma Groups and boolean operations do not establish a new coordinate basis.
The raster, native Frame and native Vector publication paths share this rule,
so editing a result inside a Group does not shift the result or expand the Group
by subtracting its derived bounds a second time.

Native Frame duplicates have a separate adoption path: validate the copied record,
resolve only the copy's own two wrapper levels, and never follow the old node
IDs to its original. Inspect returns revision 0 until the first update writes
an independent binding. Native Vector copies retain their own child-order and
geometry-fingerprint checks; raster reference resolution does not bypass them.

Reopening verifies the hierarchy and effect against the Frame record, or the
single-child structure and geometry fingerprint against the Vector record. Editing shader
parameters or structural wrappers outside Worldbend requires explicit repair;
the adapter does not silently overwrite that changed structure. Native text
and image edits within the content view box remain live. Publication revision
counts Worldbend applications, not every Figma content edit. Raster results
also carry bindings so result-only reopening can find the existing sources.
Missing/deleted source recovery is explicit.

Resize and Scale can reopen an intact result with its current output size.
The inner wrapper must retain its recorded size or the proportional subtree
scale; only float-level origin drift is tolerated. Reopening converts the
recorded surface view box to the current output view box: an outer-only Resize
retains the visible crop, while Scale retains the proportional mapping. An
unchanged update must not silently stretch the old normalized operation into
the new bounds. Publishing, recovery and rollback resize only wrapper view
boxes, never recursively applying constraints to native content. A source-size change is
resampled on Update Frame while preserving the Content and text node IDs.
Nested results remain in their parent. Human canvas placement is converted to
parent coordinates; Agent placement is relative to that parent. Durable native
placement remains in page coordinates, so recovery does not reinterpret an old
parent's offsets after reparenting. Legacy direct-Content carriers require their
supported axis-aligned source basis; version 0.3 owned works preserve their
containing pose independently from intrinsic source/output dimensions.
The plugin also attaches an `Edit in Worldbend` relaunch action to its results.

On the tested Figma host, Shader assignment and asynchronous style preparation
can establish earlier Undo boundaries. Publications prepare these properties on the hidden resource and clone
the final Projection after preparation, within the graph publication phase.
In-place updates preserve authored paints, style references, per-side strokes,
corners, opacity, scalar variable aliases and explicit modes when replacing
that Projection. New results reset the resource's prior appearance.

Native publication checkpoints include geometry, ownership records and the
completed selection change. Real native verification covers legacy and version
0.3 updates, transformed independent copies, source replacement, continued
updates, and their editor-focused Undo/Redo. When Undo is invoked from
the open plugin, Worldbend recognizes a one-publication rollback of the same
content/surface IDs and restores the geometry from that saved state. It first
checks whether the host already restored everything; a complete host Undo
needs no extra write. Completion follows host change events, including changes
delivered after the first event-loop turn, with a one-second deadline for absent
notifications. Changing the selected object cancels the pending repair. It
preserves current native text and image content.
The open plugin retains one bounded pre-publication snapshot of actual geometry
to restore a copied or moved result's first update. This snapshot is not a
durable history. For a detected mismatch after the plugin is closed, reopening
can offer **Restore transform**. This action replays the recorded size, position and effect; it
refuses a changed content size or broken hierarchy. Arbitrary structural edits
are never silently repaired. Preview Undo applies to local preview history;
document Redo currently needs Figma editor focus because the native API exposes
`triggerUndo` and no `triggerRedo`. A passing native publication sequence does
not establish an external MCP provider's transaction or mixed-actor history.

## Depth workspace and spatial-recipe handoff

Select two through eight exportable layers to enter the primary **Depth**
workspace. Selection order initializes the Recipe's far-to-near named planes;
three sources keep the familiar Background, Middle, and Foreground preset,
while other counts receive `layer-1` through `layer-N`. Each role can be rebound
to another selected source node. The controls author a canonical version-3
`multiplane-camera` recipe and reference state:
one shared camera, separate convergence and optical focus, per-plane distances,
depth of field, motion exposure, pointer viewpoint, and reduced motion. Dragging
the preview supplies explicit motion samples; the view and final Apply settle
without a temporal trail. Figma publishes a raster still and stores the full
recipe plus ordered source-node binding. Select the result alone to reopen and
continue it. Depth maps are not supported by this Figma carrier.

Reopening retains custom plane sizes/offsets, separate numeric focus distances,
and full saved precision. A control edits only its own field; the untouched
viewpoint axis is retained. Explicit viewport resize scales each plane's layout
and camera travel along that axis, retaining the authored distances and appearance.
Custom focus distances are shown as distances until a layer is explicitly chosen.

The Agent catalog exposes `figma_effect_create`, `figma_effect_inspect`, `figma_effect_sources`, `figma_effect_publish` and
`figma_effect_stage` for the same object. Inspect reads the published recipe,
reference state, complete named source order and source summaries, revision, placement, optional
staged draft, and visual preview from the explicitly granted file and page.
With `includeSourceRasters: true`, it also returns the ordered source rasters.
Source raster metadata reports each returned PNG's actual dimensions, including 1×1 transparent exports for hidden native guides. Logical artwork bounds remain in `sources`; they are not a substitute for exported PNG dimensions. All raster headers and expected source proofs are checked before artifact emission.
Owned native Content also returns `sourceCapture` in both its inspected source
summary and raster metadata. Carry those exact coordinates with the PNG (inline
or workspace-file transport); do not substitute the PNG size for the logical
size or apply the parent's transform again. Publication rejects added, missing
or changed capture coordinates, even when the PNG digest matches. The renderer
validates the encoded dimensions before decoding and materializes the logical
plane at ingress, matching the human raster path. Ordinary artwork retains its
appearance window without `sourceCapture`.
The raster bytes must match the inspected source fingerprints. A source or task
change during export rejects the mixed snapshot before any artifact is emitted;
publication verifies supplied bytes as well as rechecking the live sources.
Publish accepts a supported edited recipe and state, renders the settled
view through the shared core, and prepares guarded in-place publication of
the pixels and exact task. Optional `sourceNodeIds` reorders the same bound
sources into the new far-to-near roles. Supply raster `source-1..source-N` in
the **inspected** order; the renderer maps them through those identities.
Every source is retained exactly once. The write rechecks the result revision,
task, staged draft, placement and current source pixels at the inspected
viewport sampling scale, and detects changed result paints. It clears the pending
draft when publishing an edited
task or role order. An unchanged recipe/state/order is a pixel refresh and
preserves pending edits against the new revision. Reinspection alone never
promotes a draft. Viewport axes are integer pixels within 1..4096; plane sizes
are logical axes within 1..4096 and retain fractional geometry. Raster stages
round the logical size when allocating pixels, as in the native renderer;
Figma retains the result's native placement when the raster size changes.
See [External Figma MCP Agent](#external-figma-mcp-agent) below.
To replace, add or remove sources, call `figma_effect_sources` with the current
snapshot and 2..8 distinct same-page `sourceNodeIds`. Execute its read-only
request to obtain a revision-bound `sourceSet` and optional ordered PNGs. The
published binding remains unchanged until Publish. Supply `sourceSet` alongside
the original snapshot and a matching edited recipe/state; raster `source-1..N`
now follows the **proposal** order. Optional `sourceNodeIds` may permute that set.
Publish rereads the proposed source pixels at the original viewport sampling
scale, rejects stale proposals, and writes pixels, task, bindings and draft
state together with rollback. Native containers and stored linked dependencies
cannot lead back to the result. This dependency scan is bounded to 20,000 nodes
and 64 levels; an unavailable dependency or exceeded bound fails explicitly.
Create takes a granted file/page, 2..8 distinct existing source node IDs, a
supported task and stable `requestId`. Start with `effect_recipe` when a default
camera scene is useful. The task is created beside the artwork with empty fills
and `needs-publication` status; source export plus core-rendered Publish finishes
the image. Original sources stay editable and linked. Inspection returns
`published: false` until an image exists; published-work continuation
rejects that unfinished state. A legacy snapshot without this flag predates
cold creation and keeps its former published interpretation. Retrying the same creation
returns the current result even after it moves into a native Frame or is edited;
different inputs under the same identity are a conflict. Native duplicates do
not acquire the original creation identity. Recovery scans at most 20,000 nodes
and 64 levels of the granted page; exceeding that limit reports failure rather
than silently creating another result. A failed untouched creation is cleaned
up; an object edited during source export is preserved for recovery.
For optional human review, Stage core-validates one
version-3 two-through-eight-camera-plane task, requires the current
snapshot and expected-state fingerprint, and writes a revision-bound draft.
It deliberately leaves the published task, image fill, and revision unchanged.
The designer reopens the result in the plugin, sees the staged values in the
real Depth preview, and chooses Apply to publish them. Apply clears the matching
draft only after the new pixels and task have been written. A stale snapshot or
changed source binding returns `E_FIGMA_CONFLICT`; unsupported roles, depth maps,
tracks, versions, or malformed state fail before a request is produced.

Both routes share stable recipe and source-role intent, with Figma remaining
the visual review and publication carrier. A successful stage is not reported
as a rendered design; publication completes only after its guarded host request
has executed successfully.

After a live inspect of a published result, `figma_effect_continuation` can
project that exact published task into the existing Spatial Document and Web
delivery contracts. It preserves the recipe, reference state, ordered
source-node-to-asset roles, Figma result revision and expected-state evidence.
It does not execute another Figma request: source media is not embedded, Figma
canvas placement is not transferred, and a staged draft is excluded. A Web
host binds decoded media to every returned named asset ID and passes the
complete continuation receipt to
`attachFigmaEffectContinuation`. That helper rejects a document/delivery/role
mismatch before the ordinary document binding takes ownership. This is a
one-way delivery projection, not Web-to-Figma synchronization or a publication
claim.

The continuation now uses the same core interactive-delivery constructor as
other carriers. If an upstream Figma/export provider subsequently supplies
every bound encoded image plus its SHA-256, format, byte count and decoded
dimensions, call `interactive_media_bundle_plan` with the continuation's
Recipe, reference state and bindings. Pass that content-addressed result to
`attachSpatialInteractiveMediaBundle`; the Web adapter validates the complete
relationship before resolving or attaching any image. Worldbend itself does
not export those Figma nodes, choose a destination page, modify site source or
deploy it. Those steps belong to the calling Agent/Procedure and their
respective providers.

## Composition handoff in the same file

For a common placement start, select one artwork layer and one simple straight
four-corner Vector. Composition exposes **Fit artwork to quad**, maps the
artwork to those exact corners and anchors the linked result at the Vector's
bounds. The Vector remains bound and selectable as the geometry source, but
starts at zero opacity so a guide stroke or fill does not enter the result.
Choose **Use as backdrop** instead when the selected surface pixels belong in
the composition. Rotated, flipped and exact-diamond guides are supported; curved,
crossed or concave paths are not silently treated as targets. The designer can
then adjust corners, Reset or publish normally.
The same start recognizes any other closed Vector outline — curved, concave or
with holes — as **Fit artwork to shape**: the outline becomes an explicit
mockup clip under its own fill rule, the artwork covers the outline bounds
with editable corners, and the stored task carries the clip so preview,
publication, reopen and Agent staging all show the same masked result.

After publishing a Composition result, the designer can send its Figma result
link to an Agent. `figma_mockup_inspect` accepts a design/file link containing
`node-id`, verifies the actual file and result, and returns the published
MockupSpec, ordered `source-1` through `source-N` Figma node bindings, source
names and dimensions, revision, placement, any staged draft and a visual
preview. A continued result stores either the readable legacy Mockup task or
the complete Composition task: a standard Spatial Template containing the
ordered Mockup, one whole-result Transform stage, named single/Canvas Set
outputs and the currently previewed output ID. The source snapshot includes a
bounded fingerprint of the PNG exported at the stored render size, so a same-size content replacement invalidates a
stale stage instead of passing on dimensions alone. The Agent edits that typed
task and calls `figma_mockup_stage` with the current snapshot. Worldbend core validates the geometry and the Figma
profile before the Agent executes the prepared Figma request. Only a
revision-bound draft is written on the result node; published pixels, task and
binding stay unchanged.
If a stored draft is damaged or belongs to an older publication, Inspect
reports it as unavailable while preserving it in the state check. The Agent
can stage a fresh proposal against that state, or the designer can reopen the
published Composition and Apply to replace the unusable draft. Neither path
can silently overwrite a newer stage.

The designer selects that result in Figma and opens Worldbend. Composition
loads the Agent's draft over the current linked source nodes, shows its preview
and lets the designer edit, reset or Apply. Apply renders the current Figma
sources, publishes the accepted spec and pixels to the same result, increments
its binding revision and clears only the draft that was reviewed. If an Agent
stages a newer draft while the designer has unsaved local changes, the plugin
keeps those edits and asks whether to review the Agent version or keep the
designer's version; Apply remains unavailable until that choice. Keeping the
designer's version explicitly replaces the staged Agent draft on Apply. A stale Agent snapshot
returns `E_FIGMA_CONFLICT` and must be re-inspected. Missing or moved sources
fail explicitly; the Agent does not silently replace them with local rasters.
This is a linked raster result, so text inside the published image is edited
at its Figma source node and refreshed through Worldbend.

`figma_composition_continuation` takes that inspected snapshot and projects the
published task—not the staged draft—into one standard Spatial Document and
static delivery plan. The source slots remain stable assets, the fixed
`Mockup -> whole-result Transform -> output variants` order remains executable,
and origin/revision plus explicit carrier losses stay in the continuation
receipt. The operation neither exports source media nor edits a webpage or
deploys a site. A caller or orchestration Procedure supplies every asset-keyed source
to the returned Variation Job and handles those separate providers.

## External Figma MCP Agent

The Agent catalog exposes `figma_inspect`, `figma_apply`,
`figma_native_create`, `figma_vector_work`, `figma_work_create`, `figma_work_revise`, `figma_work_continuation`, `figma_effect_create`, `figma_effect_inspect`, `figma_effect_sources`, `figma_effect_stage`, `figma_effect_publish`, `figma_linked_results`,
`figma_effect_continuation`, `figma_mockup_inspect`, `figma_templates_inspect`, `figma_scene_create`,
`figma_mockup_stage`, `figma_mockup_publish`, `figma_publication_step` and
`figma_composition_continuation` through `worldbend.run`.
The inspection, edit and staging operations return bounded `use_figma` requests;
image publication returns an inline request or a bounded transfer plan. Continuation
operations project an already inspected snapshot; the general work entry also
prepares its published-only inspection request. None contacts Figma by itself. The consuming Agent
must have a Figma MCP connection with
access to the file; publishing also requires edit permission. A Worldbend
request is a prepared action until `use_figma` actually runs in that file and
returns the resulting state.

`figma_work_create` creates one source-linked raster work from a closed typed
`operation`, `sourceNodeIds` in binding order, `renderWidth`, `renderHeight`,
the granted `fileKey`/`pageId`, and a stable `requestId`; `name` is optional.
It accepts Transform (including authored Warp), Rectify, Crop/Trim/Pad and
Contain/Cover/Stretch Canvas, lens and displacement Remap, Mesh/Surface, Deformation with its optional native guide, complete
Mockup/Composition, and Depth. The preparer validates canonical geometry and
slot/dimension agreement before returning a request. Creation preserves the
sources and records the same operation/binding that the human plugin reopens.

The `worldbend.figma.work-creation@0.1` receipt initially reports
`needs-publication` with a linked snapshot; the empty raster is not finished
artwork. Inspect its source's linked results, read actual source PNGs and
publish through the three actions below. Execute the final request and inspect
the pixels. An identical creation retry recovers the original result even
after native reparenting and reports its current publication status. A changed
input under the same `requestId` conflicts. A duplicate keeps its independent
artwork and does not acquire the original creation identity. Failure removes
only an unused result the call still owns; a concurrent native edit is retained
for recovery. Native output carriers remain outside this cold raster route.

For Crop, Trim and Pad, both `renderWidth` and `renderHeight` may be omitted.
The empty work uses the source viewport provisionally; provided dimensions are
also provisional for these three operations. Read actual source PNGs at 1×,
independent of a previous crop or padding, then let the canonical renderer
resolve the result dimensions. Crop uses source pixel coordinates, Trim uses
actual alpha and Pad extends the captured source. Source and resolved output
axes are bounded to 4096; an oversized source is rejected rather than silently
resampled. Returned `sourceRasters` describe actual PNG dimensions. The first
publication places an owned empty work clear of adjacent content using its
resolved size; subsequent updates retain its position and display density.

Rectify uses one source, normalized source corners and an explicit output size.
Lens Remap uses one artwork source; displacement uses artwork followed by its
control map. Their saved parameters and output dimensions match the human
authoring entries. Map media receives the same current PNG proof and graph
guards as artwork, including selective replacement and linked dependency
updates. The Figma displacement family uses eight-bit channel/neutral controls;
the separate headless Remap interface also supports unit-domain maps. All
geometry and sampling execute in the existing core/render kernels.

`figma_work_revise` continues a selected linked raster work without requiring
the old artwork to remain available. Its three closed actions separate saved
controls, proposed source media and atomic publication:

1. `state` takes `{action:"state",fileKey,pageId,nodeId,part?,token?}`. It returns
   `worldbend.figma.work-state-page@0.1`, with `json`, `part`, `partCount`,
   `codeUnits` and `token`. Fetch part zero, then every remaining part using that
   token. Join their exact `json` strings in part order and parse once. Do not
   parse individual slices or summarize them. The reconstructed
   `worldbend.figma.work-state@0.1` retains the typed operation, current source
   identities, revision, `targetExpected`, placement, raster dimensions,
   `imageIntact` and any active pending human draft. No source PNG or screenshot
   is required for this read; missing old sources therefore remain replaceable.
2. `read` takes `{action:"read",base,operation?,sourceNodeIds?,renderWidth?,
   renderHeight?,part?,token?,sourceFingerprints?,includeSourceRasters?,sourceRasterTransport?}`.
   `base` is the state's `{fileKey,pageId,nodeId,revision,targetExpected}`.
   Omitted controls, source slots and raster dimensions retain current values.
   Retrieve all JSON parts using the same proposed inputs and token. This yields
   one `worldbend.figma.work-revision@0.1` snapshot. On the first part, request
   source rasters with `sourceRasterTransport:"artifact"`; obtain the named
   actual PNG bytes in slot order. Later parts need no repeated artifacts.
   For an admitted closed native source, the snapshot includes `sourceState`
   and each page returns `sourceFingerprints`. Pass the first page's exact
   `sourceFingerprints` with its token on every later part, without requesting
   media again. This preserves the original captured PNG proofs despite export
   jitter; the token still binds every JSON value and current authoring state.
   The proposal checks current source graphs, cycles and native guide geometry
   without changing the published image. A changed native work or source invalidates
   the proposed read and requires fresh state.
3. `publish` takes `{action:"publish",snapshot,sources:[{slotId,base64}]}`.
   The shared core checks the proposed geometry, source correlation and output
   size and renders actual media. Execute the inline request or all publication
   steps. A successful `worldbend.figma.work-publication@0.1` receipt records the
   new revision and linked completion fields. Pixels, operation, source bindings
   and display size change together; native/source conflicts preserve the prior
   image. Failed native writes roll back the binding, controls, drafts, fills
   and size. Cancel interrupted transfers through `figma_publication_step`.

Work revisions use the same native graph, rich text and variable closure as
linked publication. Capture checks that state before and after exporting, and
publication checks it again at the final synchronous write. The supplied PNG
bytes must still match the original capture exactly. Legacy snapshots and
sources without an admitted closed dependency retain strict PNG freshness.

Changing raster dimensions scales each logical display axis by its new/old
pixel ratio, retaining existing display density, position, rotation and native
appearance. The selected Canvas/Composition/Depth or deformation target must
agree with those dimensions. Ordinary source replacement retains the mapping.
A current Composition/Depth draft survives an unchanged operation refresh on
the new revision. Changing those controls while a draft exists requires
explicitly publishing its exact task; unrelated proposed controls conflict.
Unrelated inactive-family bytes remain preserved. A changed image fill remains
protected, as in the existing linked publication route.

State parts contain at most 2048 UTF-16 code units each; join before parsing to
retain characters split across a boundary. Reads are bounded to 512 Ki code
units while the existing saved-operation and source limits remain unchanged.
The token fingerprints every state value. Equivalent object-key ordering
through core serialization does not change a revision proposal's meaning.
This revision entry currently publishes the same raster families as cold
creation above; metadata also exposes other valid saved raster operations.
Crop/Trim/Pad revision uses the same 1× capture and core-resolved dimensions
as creation. The frozen read snapshot stays unchanged during rendering; the
publisher checks the actual PNG size and updates its raster binding and logical
display size together. Native Perspective Frame and Vector work have their
separate native entries below and through `figma_inspect`/`figma_apply`.

### Published raster work to a Spatial Document

`figma_work_continuation` separates current host inspection from portable
projection. It never publishes proposed controls or writes a file:

1. `inspect` takes `{action:"inspect",fileKey,pageId,nodeId,part?,token?,
   includeSourceRasters?,sourceRasterTransport?}`. Execute the prepared Figma
   request, read every exact state part with its complete token, join `json`
   strings and parse once. The resulting
   `worldbend.figma.work-continuation-snapshot@0.1` contains the published
   operation, ordered current source facts, revision, target and source-graph
   tokens, raster dimensions and placement. It rejects unfinished placeholders
   and hand-edited image fills. A usable pending draft is excluded; an unusable
   draft is reported without preventing published controls from being read or
   changing that draft. On part zero, request source rasters using `artifact`
   transport to obtain actual PNG bytes in slot order. Work and graph changes
   during capture/export invalidate the read. No raster is repeatedly required
   on later parts.
2. `project` takes `{action:"project",snapshot,expressionId?,output?,part?,token?}`.
   The default expression ID is `figma-work`. Projection uses the existing core
   constructors and returns `worldbend.figma.work-continuation@0.1`: ordinary
   `document` and `deliveryPlan`, source-to-asset bindings, origin, explicit
   losses, `renderQuality`, and the initial state for an interactive expression.
   Static output can be replaced by the ordinary single or Canvas Set output;
   Depth keeps its recipe viewport. Acquire and verify the source PNGs, bind
   their returned asset IDs, and execute the returned job with `renderQuality`.

The same entry covers the raster families listed for cold creation, plus readable
Rectify work. A fitting guide remains an explicit authoring dependency with a
formal document asset binding and separate `guideBindings` host-source facts.
Its captured geometry survives in the program; shared guide revisions identify
affected expressions and local overrides detach selected expressions. A version
change requires geometry recapture before redelivery, not guide raster input.
Document authoring accepts explicit guide asset-to-node replacement through the
existing fitter and capture; older baked documents keep their bound host guide.
Current source bytes may have changed since the Figma image
was published. Projection preserves the published controls and recomputes their
output from those current bytes; it does not copy the old published pixels or
transfer native output appearance. Native Frame/Vector projection uses the native
actions below. The owning document
contract defines these carrier losses.

### Native Frame/Vector work to a Spatial Document

The same `figma_work_continuation` entry has four native actions:

1. `inspectNative` takes `{action:"inspectNative",carrier:"frame"|"vector",
   fileKey,pageId,nodeId,part?,token?}`. Join the exact state `json` parts and parse
   once. The `worldbend.figma.native-continuation-snapshot@0.1` retains the existing
   native base, current physical source token, source facts and SVG byte-preview
   token. Published native duplicates retain revision zero; unfinished Vector
   candidates and hand-edited published Vector parts are rejected by the existing
   native state reader. Capture changes no native artwork and makes no clone.
2. `nativeSource` takes `{action:"nativeSource",snapshot,part?,token?}`. Execute
   the prepared request for every media part, retaining its whole-value token.
   Join `base64` strings before decoding to exact UTF-8 SVG bytes. Each
   `worldbend.figma.native-source-page@0.1` has at most 12288 ASCII payload units,
   plus source node, token, part count and byte count. The source remains within
   8 MiB and 1024 parts. An edited target/source or changed SVG bytes invalidates
   the read; restart from current inspection. This raw source stays separate from
   canonical document meaning. `io.write` is not assumed to return SVG resources.
3. `projectNative` takes `{action:"projectNative",snapshot,expressionId?,output?,
   part?,token?}` and returns `worldbend.figma.native-work-continuation@0.1` with
   an ordinary static document and delivery plan. Bind the acquired source SVG
   under its returned asset ID, execute the ready Variation Job with its
   `renderQuality`, and retain the origin/loss receipt. Frame Content SVG retains
   its own unprojected canvas; Vector source uses its existing full-source domain.
   The renderer-only outlined-SVG source decoder does not change core geometry.
4. `reviseNative` takes `{action:"reviseNative",input:{base,document,
   expectedFingerprint,expressionId,source:{assetId,nodeId},part?,token?}}` and
   returns `worldbend.figma.native-document-revision@0.1`. `base` is a complete
   current NativeSnapshot; the supplied document fingerprint and exact selected
   expression asset binding must match. The receipt retains the document's named
   outputs and identifies the execution phase. A Frame request publishes the
   core-solved reference Transform into that editable Frame. An explicit new
   source Frame is copied into independent editable Content; the old Content
   keeps its node identities beside the result on the page. The receipt names
   both the source origin and retained source nodes. A Vector
   request reads a whole-token proposal; concatenate its parts, then use
   `figma_vector_work` publish and its guarded publication transfer. Vector may
   bind an explicit replacement source; its original artwork stays untouched.
   Native Frame copies localize the source's resolved variable modes while
   retaining variable bindings and descendant overrides. Retained old Content
   preserves its mode context too; failed replacement restores its original
   parent, explicit modes and metadata, removing only the new clone. Fractional
   logical axes remain fractional; Figma's numeric storage can round them
   slightly, so the publication snapshot reports the actual retained dimensions.
   Core solving uses the requested axes' ceiling in pixels. Both routes recheck target, physical
   source and exact SVG state before capture/publication. An intervening content
   edit invalidates this document revision even when geometry is unchanged.
   Restart with a fresh native snapshot. Asset content versions remain caller
   owned; named static delivery outputs stay in the document.

Text/layout editing remain native; SVG rasterization, fractional raster rounding,
output appearance and source-effect fidelity limits are explicit. The supplied
native controls and current source are replayed, not the old published pixels.
Native authoring currently accepts one normalized reference Transform stage with
an explicit canvas, without Warp. Other programs remain intact in the document
and are rejected by this authoring adapter rather than flattened. This is current
adapter coverage; broader authoring remains implementation work, not a permanent
product restriction.

A projected value larger than 128 KiB returns
`worldbend.figma.work-continuation-page@0.1` automatically, starting at part zero.
Repeat exactly the same project arguments with each `part` and the returned
whole-value SHA-256 `token`. Join `json` parts in order and parse once; verify
the token, `bytes`, and contiguous `byteStart`/`byteEnd`. Each part contains at
most 32 KiB of UTF-8 JSON at character boundaries, with a complete-read ceiling
of 4 MiB. Explicit part zero can also request paging of smaller values. Changed
inputs, a missing later-part token or an out-of-range part fail. This pure read
can be repeated in another session without server cache state; existing MCP
argument/response limits remain unchanged.

### Document expression to guarded Figma authoring

`figma_work_continuation` also accepts `{action:"revise",input:{base,document,
expectedFingerprint,expressionId,assets:[{assetId,nodeId}],renderWidth,
renderHeight,previewOutputId?,state?,part?,token?,includeSourceRasters?,
sourceRasterTransport?,sourceFingerprints?}}`. `base` is a complete inspected published-work
continuation snapshot. The document fingerprint must match current canonical
inspection. Bind only and all assets of the selected expression; input order
does not alter source slot order. The host subsequently checks same-page nodes,
dependency cycles, hand-edited fills, pending drafts and target identity.

The `worldbend.figma.document-revision@0.1` receipt retains the fingerprint,
expression ID, source roles/asset/node bindings, canonical operation, exact local
output contract, losses and `request`. Execute that current-media request, join
all JSON parts using its token, and obtain the actual source artifacts. Then pass
the reconstructed work-revision snapshot and matching bytes to
`figma_work_revise`'s ordinary `publish` action. Execute the returned request or
publication transfer; preparing a revision does not itself change Figma.

This returns a single supported family to its raw authoring canvas. Its named
Canvas Set outputs remain available through the document delivery entry, and the
receipt reports that separation. Composition keeps its supported whole-result
Transform and named outputs and requires `previewOutputId`; interactive Depth
requires `state`. Current fitting-guide identity/order is retained and the host
recaptures its geometry, with an explicit loss receipt. A Raster Program with one leading authoring stage plus trailing Canvas
stages revises the leading stage only and retains trailing Canvas in the
document. Other multi-stage programs, tight Transform canvases, unit-domain
displacement, unsupported Composition stages and other controls outside the
current authoring carrier reject. No flattened image is mislabelled as an editable operation. Existing
request, paging, source, output and publication bounds remain in force.

### Temporal mockup-video document continuation

`figma_work_continuation` accepts `{action:"projectTemporal",snapshot,video,
expressionId?,part?,token?}`. `snapshot` is a published Mockup composition
continuation snapshot. `video` is an authored `worldbend.mockup-video@0.1` Spec
whose ordered unique plane `sourceId` values exactly match the inspected Mockup
source slots and whose canvas matches both the published Mockup canvas and the
snapshot raster size. Projection uses `prepare_spatial_temporal_delivery` and
returns the ordinary `worldbend.figma.work-continuation@0.1` envelope with a
temporal expression, mockup-video delivery plan, and explicit losses that motion
keyframes and encoded MP4 are not hosted or published by Figma.

The existing `{action:"revise",...}` path also accepts a temporal expression.
It returns Mockup authoring controls built from each plane's motion `base`
transform, captures current media through the ordinary work-revision request,
and reports that the timed motion program and stills+MP4 delivery remain in the
Spatial Document. Updating keyframes or re-encoding is document delivery /
`document-update-plan` work, not a Figma image publish. Depth workspace
motion-blur samples remain the separate spatial-appearance path.

### Native Vector Agent continuation

`figma_vector_work` has five closed actions. It uses the same complete owning
operation and supported native capture as human Native Vector output, including
Warp, Pin, Mesh, Liquify, guide clipping, resolved corners/strokes, paint order
and outlined text. Unsupported appearance retains the complete HD route;
capture never drops a source layer or contour to make a work appear complete.

1. `create` accepts file/page, ordered `sourceNodeIds` (or one `sourceNodeId`),
   `requestId`, optional `name`, exactly one complete `operation` or legacy
   `spec`, logical `width`/`height` (0.01..4096), and optional
   `sourceViewPolicy` (`logical` or `appearance`). It reserves a recoverable
   empty candidate and returns `needs-initialization` plus a light `reference`.
   Requested dimensions stay in the creation digest and owning controls. Exact
   native SDK size readback is saved independently for reservation/pending
   freshness; a decimal dimension's binary32 rounding is not an external edit.
   Original artwork remains unchanged. Retrying the same identity recovers
   that candidate; a candidate is not a finished presentation.
2. `initialize` accepts `{action:"initialize",nodeId,creation}` with the exact
   same creation inputs. Run all returned `figma_publication_step` requests in
   order. Original creation digest, payload SHA and lease bind the complete
   operation, source roles and source window. The final `initialized` receipt
   provides the first exact state page. Repeating initialization never resets
   an already initialized or published work.
   The authoring commit completes before asynchronous receipt reads. A late
   failed lease or undelivered receipt does not undo that recoverable commit
   or a newer writer; reread state before retrying. Before-commit source/target
   changes still refuse without writing.
3. `state` accepts `{action:"state",fileKey,pageId,nodeId,part?,token?}`. Modern
   `worldbend.figma.vector-state@0.3` includes full owning controls, operation
   SHA, sources/view, placement and revision. Join ASCII `json` pages in order,
   parse the exact envelope and decode it losslessly before parsing the state.
   Legacy reads keep their original direct JSON paging. State remains readable
   when an old source is missing; damaged generated paths are protected.
4. `read` accepts a current light `reference` or complete snapshot as `base`,
   optional full `operation` (or `spec`), source replacement/ordered roles,
   dimensions and view policy. The first call prepares a capture transfer;
   Default views retain automatic selection provenance and reselect the current
   input window on refresh/replacement. An explicit `sourceViewPolicy`, and
   legacy untagged views, retain their fixed policy. Both choices preserve the
   original reported bound and any canonical full-appearance enclosure.
   execute its steps to obtain page zero. Later `{action:"read",base,part,token}`
   calls use that exact cached capture, without repeating native outlining.
   Each page checks current work, all source roles/view and the original cache.
   Decode all pages as one exact envelope to obtain the complete
   `worldbend.figma.vector-proposal@0.3`; do not round coordinates, summarize
   controls or parse a JSON slice. Modern ASCII pages contain at most 18432
   characters. Escapes, repeated scoped identities and complete state/capture/
   initialization wrappers are budgeted in UTF-8 against the host's 20 KiB
   return boundary. A smaller page is used when metadata needs more space;
   the page token binds this layout, so an old partial read must restart after
   a layout change rather than silently assembling different slices.
5. `publish` accepts exactly one complete `proposal` or its lossless `encoded`
   envelope. The core resolves the whole operation and projects every captured
   network and original guide mask under one resource meter. Caller-solved
   matrices/output paths are not admitted. Run all returned transfer steps,
   including fresh capture validation and guarded finalization. Only the final
   `published` receipt establishes visible success; receipts carry a light
   reference, not a duplicate large operation. Use `state` to reread controls.

The envelope independently bounds decoded JSON to 16 MiB and encoded ASCII to
2 MiB. Owning Deformation Work storage bounds decoded controls to 8 MiB using
60 KiB immutable ASCII bank entries; small operations retain raw storage. The
standard MCP 1 MiB ingress and complete 256 KiB output remain unchanged. Each
serialized Figma request remains at most 48 KiB; first-party executable source
may travel as a separately bounded exact compressed envelope or trusted runtime
bank. No caller-authored executable route exists. Publication keeps its original
64 data-chunk/2 MiB encoded and ten-minute lease limits; first-party runtime
steps are counted separately, with at most 79 steps in a complete transfer.

Source replacement keeps the complete proposed mapping and stable result ID,
including an independently bound guide role. Native copies keep complete
controls and their own generated-path proof/revision. New paths are prepared
invisibly, then the whole paint/mask stack and metadata swap synchronously.
Fresh source/view/target proof, original payload SHA, staging incarnation,
original expiry and validation guard are checked after every awaited path
write and immediately before that swap. Validation does not renew the lease.
Cancellation, expiry or replacement (even with the same transfer ID) rejects
the old attempt and cleanup owns only its original incarnation. Resolved
variables, text, paints, full local/world basis, native attributes and active
operation-bank bytes participate in freshness. A failed validation requires
cancelling the exact transfer and reading fresh state; missing/incomplete chunks
can instead resume verbatim while their original lease is still valid.

`figma_linked_results` updates existing raster work after native content changes.
It has three closed actions. Execute each returned request through `use_figma`:

1. `inspect` takes `{action:"inspect",fileKey,pageId,sourceNodeId}` and returns
   a `worldbend.figma.linked-update@0.1` plan. Native containment and saved
   bindings establish affected results and dependency order. Each item includes
   its revision, target-state fingerprint, sources, prerequisites and whether
   its current saved operation can be refreshed. Damaged operations remain
   visible dependencies; their consumers cannot publish stale pixels.
2. `read` takes `{action:"read",plan,nodeId,completed?,includeSourceRasters:true,
   sourceRasterTransport:"artifact"}`. Successfully publish every affected
   prerequisite first. Pass only `{nodeId,revision,expected}` from each successful
   publication in `completed`. Read verifies those completions against current
   source pixels, then returns a `worldbend.figma.linked-result@0.1` snapshot
   with the saved typed operation, its exact `operationJson`, binding-order
   source summaries and named PNG artifacts. A native-guide-bound Deformation
   snapshot also includes `shapeGuideClip`, the current resolved native curves,
   fill rules and regions. A clipped opaque native Frame with an admitted
   dependency closure also includes `sourceState`: its native graph, rich text
   ranges, variable definitions, alias chains and collection modes. That token
   proves authoring freshness separately from the exact exported PNG proof.
   Read captures each source PNG once and emits those same bytes with its
   summary. Retrieve the actual PNG bytes;
   exclude `sourceRasters` from the snapshot passed to Publish.
3. `publish` takes `{action:"publish",plan,snapshot,completed?,sources:[{slotId,
   base64}]}`. The canonical renderer consumes that saved operation and the
   correlated PNGs. Execute the inline request or every publication transfer
   step. Only a successful final receipt establishes publication; retain its
   snapshot's completion fields for the next item.

Linked publication rechecks the native state at the final synchronous write
boundary. An unchanged admitted source can therefore refresh even when Figma's
successive PNG exports differ slightly. Supplied PNG fingerprints, dimensions
and bytes still require an exact match to the original capture; there is no
pixel tolerance or permission to substitute a later export. Older snapshots
without `sourceState`, open/backdrop-dependent sources and sources with
unproved external material dependencies retain strict PNG freshness checks.
Dependencies whose state cannot be proved retain strict PNG freshness checks.
Native-guide curves and completed upstream results remain part of the same
guarded publication path.

All four PNG publication entries (`figma_linked_results`,
`figma_work_revise`, `figma_mockup_publish`, `figma_effect_publish`) also accept
`sources:[{slotId,path}]`. The path must be relative to the MCP's explicitly
granted workspace; there is no implicit filesystem or URL authority. Retrieve
the complete exported artifact and save its exact bytes before using this
transport. A result screenshot, re-export or recompressed PNG is not an
interchangeable source. Each entry reads the file once, then uses the same PNG
fingerprint, dimensions, decoding and core renderer as inline transport. Missing
workspace authority, traversal, symlinks and changed-byte proofs are rejected.
Each source remains bounded to 1,200,000 decoded PNG bytes (the existing
1,600,000-character base64 ceiling), with 1–8 ordered slots. The request-size
limit and host publication limits remain intact; this transport keeps large
source bytes outside the request envelope. Preparation reads only the granted
input files, creates no output files and never contacts Figma.

Reads and publication preserve raster dimensions, native placement, the saved
operation and size-output name. For a native-guide-bound Deformation, the core
refreshes only its fitting boundary/mask and carrier domain choice from the
current `shapeGuideClip`; publication saves that updated task alongside its
pixels. Its plane, corner correspondence and interior edits remain exact.
The original `operationJson`, current native geometry and PNG proofs stay guarded
until publication. Object field order across core/host serialization carries no
semantic meaning. A usable pending Composition or Depth draft
survives on the new revision without being applied. An invalid or stale pending
draft requires its ordinary repair route. Final publication rechecks the target,
exact saved operation and source PNG proofs; a changed source, target or
prerequisite rejects that item. Independent successful branches remain usable.
Cancellation between items leaves completed work intact; cancel an interrupted
transfer through `figma_publication_step` and read fresh state for retry.

Discovery resolves explicit node references across the granted page and is
bounded to 20,000 nodes, 64 native levels and 64 affected results. A partial
page read, cycle or limit fails before publication. Refresh currently covers
RECTANGLE results with one-source Transform/Rectify, all six Canvas operations,
Mesh/Surface tasks, one-source or native-guide-bound two-source Deformation
tasks, lens or two-source displacement Remap, and complete Mockup/Composition/Depth sources.
Native Frames remain explicit unavailable items with their existing reopen
routes. Dynamic Canvas refresh reads the source at 1× and recomputes its actual
output size while preserving each logical display axis's saved density. This does not establish
their external creation or editing coverage.

`figma_templates_inspect` takes a plain file
link (no `node-id`) and returns, read-only, reusable geometry templates from
readable client storage plus marked native scene masters in the granted file.
Each entry has its kind, editable slots and current projection appearance
boundary, so an Agent can choose a scene and its sources. Native scene summaries
include their file-native reference and count the replaceable artwork slots,
separately from the canonical operation's hidden guide sources. Their `pageId`
names the actual containing page, while `nativeScene.pageId` remains the saved
location hint. Native slot dimensions describe their current Frame bounds,
rounded up; client-only slot dimensions retain the authored raster size.
Discovery resolves container nodes explicitly, reads the current native task
and binding, and skips missing or invalid masters without advertising another
file's cached scene. `discovery` reports client storage as readable, unavailable
or unreadable, scanned pages, visited nodes, issues and completeness. Scanning
is bounded to 20,000 nodes, 64 native masters and 64 levels; unreadable pages
or a limit make `complete` false. Native masters remain discoverable when the
connector cannot read client storage. An empty list describes the entries
available under that reported coverage. `readyScenes` describes the bundled
native scenes in the same summary model, including slot sizes and first-party
Apache-2.0 provenance. `figma_scene_create` accepts `{url,pageId,scene,
artworkNodeIds,fit?,name?,requestId?}`. Its closed `scene` choice is
`{kind:"ready",id:"studio-poster"|"desktop-screen"|"carton-label"|"studio-can"|"hanging-fabric"}` or
`{kind:"native",snapshot}` from a fresh master inspection. Ordered artwork
nodes replace the native scene's editable slots with uniform Cover (default)
or Contain fitting; originals and master remain intact. The instance includes
its native decoration and copied sources and is placed beside those inputs.

Execution returns `worldbend.figma.scene-creation@0.1`, a native scene reference,
the new linked-result snapshot and `status:"needs-publication"`. Export its
snapshot sources and run the normal guarded renderer/publisher below to finish
the pixels. A stable identity in every prepared request makes re-execution
return its existing instance and current snapshot, including `status:"published"`
after successful publication; optional `requestId` retains that identity across
preparation sessions. Reusing the identity with different inputs is a conflict.
`published` means an image has been committed to that instance; it does not
certify freshness after a later native source edit. Read its current snapshot
and render/publish again when updating edited content.
Failed owned constructions are removed. A damaged surviving instance is reported
for recovery rather than replaced silently. Native copies clear the original
creation identity. Recovery scans at most 20,000 top-level nodes on the granted
page; moving the instance to another page requires using its returned result
link for continuation.

`figma_mockup_inspect` additionally accepts
`includeSourceRasters` to export every bound source at the result's stored
raster size in the same snapshot. Choose `sourceRasterTransport: "artifact"`
to emit named PNG image artifacts instead of large base64 text fields, when
the Figma interface supports `figma.io.write`. Image blocks follow source-slot
order, then the result screenshot. The consuming Agent must retrieve the
artifact bytes; seeing a screenshot alone is not enough. Export verifies each
PNG against the snapshot before returning artifacts. Composition publication
rejects supplied PNGs that differ from those proofs and rechecks the complete
native source state at the final write boundary. Source-state capture is
bounded to 16 MiB, 20,000 nodes and 64 levels. Inline transport
remains available for small images. Native vector/text exports use the result's
requested raster scale, bounded to 4096 px per source axis.
`figma_mockup_publish` completes the loop without the manual designer Apply:
the Agent supplies that snapshot, the validated task and the ordered source
rasters; the operation renders the task through the shared core renderer
(planes, opacity, background and clip; the single whole-result Transform
stage for continued Compositions), encodes the PNG, and prepares one guarded
request that re-verifies the live file, expected state and revision before
replacing the result's image fill in place, advancing the binding revision
and clearing any staged draft. Publishing targets the selected single
whole-result output; Canvas Set variants stay Variation Job work. The
publication uses one inline request only when the complete packet fits 48 KiB.
Otherwise it returns a `worldbend.figma.publication-transfer` plan. Fetch each
step through `figma_publication_step {transferId, step}` and execute its returned
request with Figma, from step zero through `stepCount - 1`. Chunk steps only
stage transport data; the final step reads the complete payload and invokes
the same guarded publisher. If that complete publisher does not fit inline,
additional steps transport its first-party generated code, bounded to 128 KiB.
The final request carries an independent SHA-256 digest of the encoded code
and its fixed entry point; it verifies all code bytes before execution. Editable
document data and publication arguments cannot choose executable code. Every
request retains the 48 KiB limit, and the image/argument transport retains its
2 MiB encoded ceiling. Execute all `stepCount` requests, including code chunks;
staging code has no visible publication effect. Success, guarded failure,
cancellation and expired-transfer replacement clear both transport types.
Its final receipt has `status: "published"` and
the actual `snapshot`, or `status: "failed"` with an error and a requirement
to inspect again. A failed receipt is not successful publication even if the
Figma tool call itself completed. The external interface rolls back writes
when a script throws, so publication failures return receipts after cleanup.
The transfer's final step returns its write receipt before visual inspection;
an optional screenshot cannot delay acknowledgement of the completed write.
Inspect the published result to obtain its native preview. No partial image
or recipe is published.

Incomplete transfers can resume and identical chunk retries are safe. A
mutating finalizer requires the original payload SHA-256 from its trusted
prepared request; an editable checksum or a read-only transport read is not
publication authorization. Vector, linked refresh, selective work revision,
Composition and Depth all propagate the original staging lease to their shared
publisher's pre-write boundary. Cancellation, expiry or a new incarnation
cannot commit an older awaited attempt or let its cleanup erase a replacement.
A transfer staged by an older runtime without that lease must be cancelled and
restaged before publication.

A corrupt transfer requires cancellation before retransmission; a changed live
result requires fresh inspection and rendering. After successful publication
or cancellation, call `figma_publication_step {transferId, release: true}` to
free the session's preparation cache. To cancel before publication, fetch
`{transferId, cancel: true}` and execute that Figma request first, then release.
Retrieving a cancellation request does not itself change the Figma file.

After a preparing server or Agent session ends, use
`figma_publication_step {scope: {fileKey, pageId, nodeId}, inspect: true}`
and execute its read-only Figma request. The bounded result reports the staged
transfer identity, received chunk indices and expiry without the media payload.
Cancel that exact identity with `{scope, transferId, cancel: true}` and execute
the request, then inspect the artwork and prepare a fresh publication. Scoped
cancellation requires no old session cache and rejects a newer transfer's
identity. A lost preparation cache cannot resume its old media bytes.

Transfer payloads are limited to 2 MiB of encoded data, at most 64 chunks of
32 KiB, and expire ten minutes after preparation/first staging. The session
cache retains at most eight transfers and 16 MiB, without evicting active
work. Shared staging is confined to owned keys on the exact result; successful
final publication and publication conflicts clear only their captured staging
incarnation's chunks while preserving a replacement transfer and
unrelated data. Interruption leaves the published artwork intact. Expired
staging is removed when a new transfer starts, or by exact cancellation. A
server restart loses the prepared transfer handle; use scoped transport
inspection and cancellation above before preparing again. This protocol stays within the supported Figma request envelope;
it does not make arbitrary image sizes or every connector's artifact access
available. Source and rendered-byte limits still apply.
Linked-image finalization uses one generated transport/publisher bundle with
shared helpers, rather than concatenating two separately bounded runtimes.
The complete final request remains subject to the same 48 KiB limit, including
the granted identities and their JSON escaping; this also applies when media
arrives through multiple chunks.
`figma_native_create` creates an independent editable Perspective Frame from an
existing clipped, axis-aligned native Frame on the granted page. Supply the
source node, a stable `requestId`, a normalized TransformSpec without Warp, and
logical output width/height (0.01–4096, including fractional values). The core
solves the transform at the ceiling of those dimensions. Creation uses the same
core-planned component/instance carrier as the human Perspective entry. Owned
Content is also a source, preserving its instance overrides and independent
owned graph when copied. Affine plans do not require the sampler; projective
plans do. The original artwork stays intact. Unsupported outside appearance or an
unavailable required sampler fails explicitly. Use the linked HD route when complete
appearance requires it.

Execution returns the published result and its current `figma_inspect` snapshot.
Retry the exact creation inputs to recover that original work after subsequent
content edits, geometry revisions or same-page reparenting, even if its original
source was removed. Copies retain independent Content and do not own the
original creation identity. Changed inputs under the same identity, or multiple
original identity owners, fail with `E_FIGMA_CONFLICT`. Recovery scans the complete
current page within 20,000 nodes and 64 levels; creation reserves room for its
new graph before the first write. A native write failure removes its own partial
creation. If a later read detects structural changes to an already published
result, that edited result remains available for inspection and repair.

`figma_inspect` takes the explicitly granted
`fileKey`, `pageId` and selected `nodeId`; execute its request with Figma to obtain the
actual snapshot and visual preview. `figma_apply` takes that snapshot, a
normalized TransformSpec and optional integer output width/height. Omitted
dimensions preserve the exact current logical frame dimensions, including
fractional sizes; core solving uses their ceiling in pixels. Its native core
solves the geometry before preparing the request. Execute that request with
Figma to publish and obtain the next snapshot. No development checkout, Vite,
Node or local temporary JSON files are needed by the consuming Agent.

The native binary embeds a generated bundle of the same TypeScript publisher.
`scripts/build-figma-handoff-runtime.mjs --check` verifies it against source
before staging an Agent package. Every executable request is capped at 48 KiB, including transfer chunks and
final publication; prepared media has the separate bounds above. Fingerprints
are capped at 8 KiB, identities at 256 bytes, and preview axes at 1024. Unknown
input fields, invalid geometry and unsupported native profiles fail before a request
is produced. A prepared request is not evidence of a Figma read or write.

Ready-scene creation bundles only the selected scene's native assets. The
generator derives each creation variant from the shared first-party scene
catalog; discovery and the human Templates workspace retain the complete
catalog. The same packet bound applies to every scene, including the longest
supported creation arguments.

For repository development, the local packet preparer bundles the same native publisher used by the human
plugin. It computes geometry through the real core WASM, then emits one bounded
`use_figma` request. It does not contact Figma or mutate a document itself.

```sh
node scripts/figma-handoff.mjs inspect \
  --file-key FILE --page-id PAGE --node-id RESULT

node scripts/figma-handoff.mjs apply \
  --snapshot current-result.json --spec transform.json --width 720 --height 400
```

Pass the emitted object to the available Figma `use_figma` tool after loading
its mandatory skill. The result includes the shared operation and a bounded
visual preview. Save the structured text result as the next snapshot. The
designer does not need to copy parameters or write a handoff note.

The snapshot includes an expected-state fingerprint. Apply rechecks it at the
last synchronous publication boundary and rejects stale geometry, placement,
binding, parent identity, surface dimensions or metadata with `E_FIGMA_CONFLICT`. Current native content is retained.
Inspect verifies the actual host file key as well as the granted page; a file
identity mismatch fails with `E_FIGMA_SCOPE` before a handoff can be produced.
The complete code packet is capped at 48 KiB; local JSON inputs are bounded
regular-file reads. The external MCP host owns its call transaction and does
not expose a transaction-level Undo contract to Worldbend. Do not assume the
native plugin's checkpoints or editor Undo/Redo can reverse an external
publication. Native structure checks remain authoritative for plugin
admission; a successful external read is not native Undo/recovery acceptance.

External recovery is therefore explicit. A failed, cancelled or expired
publication retains the previously published artwork; inspect and cancel its
exact transport identity before retrying. After a successful native Transform
publication, restore earlier geometry only by re-inspecting the current result
and applying the retained earlier TransformSpec and dimensions as a new guarded
revision. This preserves current native content and never rewrites the revision
counter. After a successful linked-raster publication, byte-exact restoration
is guaranteed only when the caller retained the complete earlier task, source
bindings and exact source/media inputs needed to render and publish a new
guarded revision. Otherwise inspect the current work and report that the prior
pixels are unavailable; do not substitute a screenshot, edit expected state,
or claim that host Undo restored the publication.

Native Figma Agent content editing and external MCP geometry editing are
distinct runtime checks. Neither an available shader nor an MCP success
establishes that the native Agent discovers Worldbend's shared contract by
itself. A native Agent can operate on the actual selected native children;
canonical geometry changes require the Worldbend core route above or the
visual plugin controls. Composition has a core-rendered publication request;
Depth also has core-rendered publication for edited recipe/state and source-role order.
The Agent must execute the guarded Figma request to change the host pixels.
Staged recipe edits remain pending until explicit Agent publication or human Apply.

## Development regression checks

`pnpm test:figma-refresh` builds an isolated UI and exercises it in Chrome or
Chromium (override the executable with `CHROME_BIN`). It uses the real WASM core
and browser controls with simulated Figma messages to verify content-refresh
history, affine control continuity, external-operation adoption, Depth recipe
planning, source-role swaps, settled publication, draft recovery and viewport
continuity. It does not replace Figma document or installed-plugin
runtime checks. `pnpm test:figma-shader` independently checks the owned sampler
on WebGPU; downstream Figma composition and export are separate host checks.

## Native appearance continuation

Use `figma_appearance_inspect` to retrieve the live effect, shared seed origin,
extras and expected state from an authorized node. `figma_appearance_apply`
requires that expected state and keeps the seed separate from optional effective
material overrides. Execute its prepared request through the supported connector;
then deliver the returned live material with `appearance_delivery`.
`appearance_revision` preserves native overrides on a compatible seed upgrade,
and `appearance_update` redelivers a later native edit to an already-received
frontend material without advancing the preset version, preserving that
frontend's local edits and removal.
The texture family mirrors this route end to end: `figma_texture_inspect`,
`figma_texture_apply`, `texture_revision` and `texture_delivery` over the
native NOISE and TEXTURE effects. Appearance and texture packets embed the
materials runtime variant; publisher packets embed the publishers variant.
Read [NATIVE_APPEARANCE_CONTRACT.md](NATIVE_APPEARANCE_CONTRACT.md) for conflict,
rollback, preview, native-extension and target fidelity semantics. This route
works on native effect-capable artwork without requiring a Perspective binding.

Composition animation follows the existing editing target: Layers controls plane
poses; Whole controls whole-view poses. Seeking updates both the sampled layer
scene and whole Transform inspector. Editing a whole corner at one time retains
other view keys, layer keys, warp/orientation and named outputs. Capture, easing,
remove and retime use the shared guarded motion authoring entry. Saved work and
templates retain complete whole-view keys. Temporal project/return compares and
reconstructs the selected poster view, preserving the authored programme; static
return edits that pose through SetPresentationAtFrame. This does not yet transfer
Figma decorations outside the linked result or supply a three-dimensional camera.

Large native document revisions retain their complete owning value as
`operationEncoded`, using the same lossless exact JSON envelope, instead of
repeating a raw operation beyond the 256 KiB MCP response boundary. This
`worldbend.figma.native-document-revision@0.3` response contains exactly one of
`operation` and `operationEncoded`; decode the latter before inspecting controls.
Small legacy revisions retain their original raw operation shape. Both variants
prepare the same scoped capture/publication requests, source witnesses and
incarnation leases; the envelope is data, never executable code.
