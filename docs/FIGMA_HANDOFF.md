# Editable Figma results and Agent handoff

Worldbend can keep a Frame's native children editable while a companion Figma
Shader renders its projective appearance. A designer selects a clipped,
unrotated Frame, moves the existing Transform or Distort controls, and chooses
**New Editable Frame** in the footer, or **New HD Image** for a stable raster.
The original is preserved. The
new result contains `Perspective > Content`; text, image fills, auto layout
and other native children remain in Content. Editing those children updates
the effect without running Worldbend again. Select the result alone to reopen
its operation; **Update Frame** preserves result and content node IDs.

Edit text and move elements directly on the Figma canvas. While the plugin is
open, selecting descendants of the active Frame keeps the whole Frame in the
preview and content changes refresh it automatically, preserving the transform
draft. Selecting outside that Frame starts another selection. There is no
separate content editor or Enter/Finish mode. Each new editable result owns an
independent Content clone; editing the original does not change that clone.

A selected result exposes three actions: update that result, create another
editable Frame, or create another HD image. Creation preserves the selected
result, even when the output type is the same. Image results update in place
through **Update HD Image**. Reopening a result alone resolves its saved source
and canonical operation; it never uses the already-transformed raster as its
source. Image results reference the producing source (original or an editable
result's Content). Edits made there with Worldbend closed appear in the preview
when reopened; the previously published snapshot changes only after Update.
Missing or invalid saved state fails explicitly; a missing source can be
replaced by selecting the result and a replacement source together. Return to
the original to start a fresh operation when saved geometry is invalid.

This is a bounded native-content carrier. Its rendered appearance is sampled
by Figma's GPU, not a set of geometrically rewritten vector paths. It supports
the canonical affine/projective TransformSpec and explicit source flips.
Warp, Correct, arbitrary source rotation, and output axes beyond 4096 are not
supported as editable output. **New HD Image** and **Update HD Image** re-export
the resolved source as needed and use the core-backed renderer at a minimum of
two pixels per document unit, retaining an already denser raster. Repeated
reopening does not double the stored density. Correct uses its explicitly
entered pixel dimensions. Existing output-density policy still
fits or rejects axes above 4096. Editable Frames use their logical dimensions
for the separate 4096-axis limit; the HD density preference does not change
Frame availability. The new image preserves logical size and the editable
master; its binding points to that master's native Content. It is a
delivery snapshot and does not update live. Text and layout inside that image
cannot be edited directly. The content view box is retained
at its publication size; changing its dimensions requires reapplying before
claiming the updated geometry. In the tested Figma host, effect texture density
stays at the on-canvas size even for 2x exports; 4096x256 measured 2048x128 input
and output textures. Its downstream resampling softens detail. Increasing
export scale does not recreate vector-quality effect output. Native screenshots
are not byte-identical to the reference raster renderer.

A separate authored diagnostic also created a double-size GPU texture, then
returned it from `render` and assigned it to `frame.output`. In the tested
desktop and at export scales 1 and 2, Figma still displayed the original host
target. The assignment did not throw; it was ineffective as an output handoff.
Creating a larger intermediate texture therefore does not establish a usable
higher-density display path. This observation covers those two attempted paths
in the tested host, not every possible future shader API.

## Renderer acquisition

New results try the exact renderer build bundled in the plugin. Reopening and
recovery retain a result's recorded build. An explicit Update Frame or Agent
apply replaces the measured defective alpha build with its verified correction;
other retained builds remain exact. If that correction is unavailable, the
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
or plan. [Worldbend Perspective](https://www.figma.com/community/shader/1679431734495527701)
has been submitted to Community and is under review. Once available, add it
from Figma's Tools panel. Until approval, editable output is available only to
accounts that already have the exact effect; HD images work independently.
Bundling its identity does not install the effect. Imports verify
the exact version, including the observed resource-hash/UUID alias. A failed
import is retryable after installation; no name-only fallback is used.
A desktop file can retain a stale shader catalog after an effect is added.
If Tools can apply the effect but the plugin cannot import it, save and reopen
that file. An unavailable effect leaves editable output disabled, with recovery
instructions in its help text.

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

Native duplicates have a separate adoption path: validate the copied record,
resolve only the copy's own two wrapper levels, and never follow the old node
IDs to its original. Inspect returns revision 0 until the first update writes
an independent binding. Raster copies do not gain this native adoption path.

Reopening verifies the hierarchy and effect against the record. Editing shader
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
parent's offsets after reparenting. Ancestors must preserve the supported axis-aligned source basis.
The plugin also attaches an `Edit in Worldbend` relaunch action to its results.

The tested Figma host can undo shared plugin records without undoing the
matching Frame dimensions and Shader properties. When Undo is invoked from
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
are never silently repaired. Native host Undo/Redo with the plugin closed is
not guaranteed to keep the record and rendering together on this Figma build.
Minimal host experiments also fail to preserve earlier visible Undo history
across consecutive shader-style updates. A style/detach workaround that passes
one Undo is therefore insufficient. This remains a material production release
issue. One successful publication Undo does not establish consecutive history.

## External Figma MCP Agent

The Agent catalog exposes `figma_inspect` and `figma_apply` through
`worldbend.run`. They return bounded `use_figma` requests and never contact
Figma themselves. `figma_inspect` takes the explicitly granted `fileKey`,
`pageId` and selected `nodeId`; execute its request with Figma to obtain the
actual snapshot and visual preview. `figma_apply` takes that snapshot, a
normalized TransformSpec and optional integer output width/height. Omitted
dimensions preserve the exact current logical frame dimensions, including
fractional sizes; core solving uses their ceiling in pixels. Its native core
solves the geometry before preparing the request. Execute that request with
Figma to publish and obtain the next snapshot. No development checkout, Vite,
Node or local temporary JSON files are needed by the consuming Agent.

The native binary embeds a generated bundle of the same TypeScript publisher.
`scripts/build-figma-handoff-runtime.mjs --check` verifies it against source
before staging an Agent package. Requests are capped at 48 KiB, fingerprints
at 8 KiB, identities at 256 bytes, and preview axes at 1024. Unknown input
fields, invalid geometry and unsupported native profiles fail before a request
is produced. A prepared request is not evidence of a Figma read or write.

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
regular-file reads. The external MCP host owns its call transaction; its API
does not expose the development plugin's `commitUndo` method.

Native Figma Agent content editing and external MCP geometry editing are
distinct runtime checks. Neither an available shader nor an MCP success
establishes that the native Agent discovers Worldbend's shared contract by
itself. A native Agent can operate on the actual selected native children;
canonical geometry changes require the Worldbend core route above or the
visual plugin controls.

## Development regression checks

`pnpm test:figma-refresh` builds an isolated UI and exercises it in Chrome or
Chromium (override the executable with `CHROME_BIN`). It uses the real WASM core
and browser controls with simulated Figma messages to verify content-refresh
history, affine control continuity, external-operation adoption, draft recovery
and viewport continuity. It does not replace Figma document or installed-plugin
runtime checks. `pnpm test:figma-shader` independently checks the owned sampler
on WebGPU; downstream Figma composition and export are separate host checks.
