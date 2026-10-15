---
name: worldbend
description: "Create and continue reusable spatial-visual work across static and interactive delivery. Inspect shared Spatial Documents, edit Figma perspective frames, create live CSS, and drive perspective, composition, depth, source replacement, sizing, deformation, motion, folding and frosted windows."
---

# Worldbend

Use the installed Worldbend tools as the geometry authority. The installed
Agent projection exposes a compact progressive catalog: call `worldbend.run`
directly for every operation below, putting the listed operation ID in
`operation` and that operation's ordinary arguments in `arguments`. Call
`worldbend.search` only when the request does not map to a known operation and
`worldbend.describe` only when its exact current schema is not already known.
Both are deterministic metadata calls, not planning. Deterministic operations
consume explicit planes. The separate `plane_candidates` assessment can suggest
zero to three contrast- or alpha-supported quadrilaterals, but it does not
identify a semantic screen/package face, choose one, infer output size, or
apply it.

## Continue one spatial work

When static outputs and interactive expressions reuse the same content, keep
them in one `worldbend.spatial-document` instead of treating each operation as
a new project. If separate Provider projections already exist, call
`document_assemble` with every current source fingerprint plus exhaustive,
explicit source-asset equivalence and expression mappings. Do not infer shared
identity from names, node IDs or pixels; the consumer Agent or selected
Procedure supplies that task fact and Worldbend validates it. Use the returned
document and all-expression delivery plan as the continuation point.

Call `document_inspect` with `{spec}` before delivery. It checks
declared assets, validates each embedded Spatial Template or Effect Recipe, and
canonicalizes every content and depth-map binding. Retain its `fingerprint`.
When a declared asset changes, call `document_update_plan` with the document,
that fingerprint and the new caller-owned `contentVersion`. It returns the
updated document plus every affected expression and binding. Pass that updated
document, its new fingerprint and the affected expression IDs to
`document_delivery_plan`. The result preserves document order and compiles each
static expression into a one-item Variation Job while returning each
interactive expression as a validated Recipe with canonical bindings and its
fingerprint.

The current source Document also accepts `kind: "material"` with
`material: {family, input}` for `glass`, `texture`, `foil` and `mesh-gradient`.
Use the family's ordinary typed delivery input, retaining the authored recipe
and actual material separately. Bind 1..64 receiving surface roles to declared
content assets using `content` bindings; those assets are not implicit backdrop
textures. Delivery returns `material: {family, delivery}` with the existing
family receipt. Resolve each surface binding to its existing component and use
the ordinary family receiving binding. Shared content revision marks every
bound expression; explicit material revisions preserve omitted work. Native
mesh values come from a fresh `figma_mesh_gradient` read. Private Shader aliases
and Figma placement stay outside the portable document. Check the installed
descriptor before assuming this source addition is available in that runtime.

For color-critical Glass work, discover `appearance_profiles` with
`requiredMechanisms: ["color-preserving-refraction"]` and choose the returned
`web-color-preserving` target for `appearance_delivery`. It retains optical
fields without global saturation/brightness compensation. Explicit dispersion,
frost and rim lighting still affect the image. Use the ordinary Web receiving
session with an exposure report pinned to that exact target. Revisions preserve
the selected profile; changing it requires deliberate reattachment.

Resolve paths or source bytes only when executing a returned static job through
`variation_render`. In Web code, pass an interactive delivery and asset-keyed
DOM/media resources to `attachDocumentEffect`; do not reconstruct slot mappings
from conversation. Retain the returned document binding and call
`replaceAsset(assetId, decodedMedia)` when caller-owned media changes; it updates
every compiled texture role for that asset and preserves the accepted sources
on a rejected proposal. Plan a durable asset revision through
`document_update_plan` and retain its new delivery fingerprint after the media
change is accepted. Change live DOM through the host framework instead.
Other interactive carriers continue through their declared
Effect Recipe/Plan support. Do not claim that inspection, update planning or
delivery planning changed media, rendered, or published a result. Paths, URLs,
bytes and DOM nodes remain carrier bindings and do not belong in the canonical
document.

When an upstream provider has already established the encoded raster facts for
one version-3 interactive delivery, call `interactive_media_bundle_plan` with
the accepted Recipe, initial state, exact bindings and media records. Use its
content-addressed result directly with Web
`attachSpatialInteractiveMediaBundle`, providing the named host elements and a
resolver for each declared media record. Do not rebuild the role map, put URLs
or credentials into the bundle, or claim that Worldbend exported or decoded
the media. Invalid cross-links fail before the resolver runs; decoded dimension
drift fails before the Web binding takes ownership.

Worldbend is the deterministic provider for this part of a larger workflow.
If a selected Procedure also inspects Figma, exports media, edits a webpage or
deploys it, keep those steps in that Procedure and their respective providers.
Do not add Procedure selection, orchestration or approval semantics to a
Worldbend call.

For a designer continuing one Figma result, the Figma file remains the editable
working artifact. Use the same-file handoff below for further Figma editing.
Create a Spatial Document projection only when the actual task is to continue a
published Depth relationship into interactive Web delivery or a published
Composition relationship into static downstream delivery. Those projections
are not replacement Figma editors or a reason to move unrelated work out of
the file.


## Continue native material as a shared work

Read actual state with `figma_appearance_inspect`, `figma_texture_inspect`,
`figma_foil` read or `figma_mesh_gradient` read, executing the returned request
through the authorized Figma tool. Join exact tokened Shader read parts first.
Use `figma_work_continuation` `projectMaterial` with that complete snapshot,
matching typed target, an explicit content asset/version and named receiving
surface. It returns the ordinary material Spatial Document and delivery; host
origin, variable references, paint modifiers and placement stay beside it.
Material values are actual native values; the recipe remains the authored seed.
Review native extras and carrier losses before claiming appearance parity.
Live untagged material requires an explicit typed `documentSeed`; it is a seed
authored for this document, and the native origin remains untagged. Pass the
same document seed on later revisions. Removed/absent material cannot be
projected or revived. An explicit family choice/adoption remains a separate
operation; projection never fabricates native provenance.

For a later native revision, update the document through `document_update_plan`,
reread the native surface, then call `reviseMaterial` with the current document
fingerprint, selected expression, its exact content binding and distinct owned
fields. Foil/Mesh-gradient also need exact `get_shader` evidence matching that
read. Execute the returned family request and reread the actual outcome. Only
selected parameters change; unselected native values/extras, Shader aliases,
other effects/fills and seed remain native-owned. This action does not change
seed or adopt a new renderer; use explicit family operations for those choices.
A document change or intervening native edit requires refreshing the respective
guard. Preparation alone neither reads nor modifies Figma or the receiving app.

## Brand brief: product screens to presentation and social sizes

When the brief is: use available product screens and the existing brand style to
make editable website presentation images and social sizes, keep next week's
screens replaceable — do **not** ask for a developer-written operation file.
Discover and execute through installed MCP/CLI:

1. `worldbend.search` with terms such as `brand brief presentation social` or
   `weekly product-screen`. Prefer `document_*`, `variation_*`, `figma_work_create`,
   `figma_work_continuation` and `figma_work_revise` from the hits. Call
   `worldbend.describe` only when a schema is unknown.
2. **Local / Spatial Document branch.** Build one `worldbend.spatial-document`
   whose artwork asset is the product screen and whose static expression is a
   Spatial Template: raster program + `canvasSet` variants for
   `website-presentation`, `social-square` and `social-wide`. Encode brand style
   as the reusable canvas background (and any stable brand plates the brief
   supplies). Start from the installed Skill asset
   `assets/documents/brand-brief-document.worldbend.json` (repo
   `examples/brand-brief-document.worldbend.json` stays the development twin).
   Call `document_inspect`, then `document_delivery_plan`, then
   `variation_render` with granted workspace media for the product-screen asset.
3. **Figma-origin branch.** Cold-create editable linked results with
   `figma_work_create` (Canvas Contain/Cover sizes for presentation and social)
   from current same-page product-screen nodes, publish through
   `figma_linked_results` / `figma_publication_step`, then project with
   `figma_work_continuation` into the same Spatial Document shape. Person and
   Agent continue on that document and the guarded publication path
   (`figma_work_revise` / continuation `revise`).
4. **Fresh session.** Re-read the saved document or Figma linked snapshot.
   Replace one product-screen through `document_update_plan` (or Figma revise
   source slot) with the current fingerprint; redeliver only affected
   expressions. A stale fingerprint or changed source must reject — recover
   from a fresh inspect/read, never by forging `expected`.
5. When the brief needs projective placement then a brand plate, use a Raster
   Program with one leading Transform/Rectify/Canvas/Mesh/Surface/Deformation/
   Remap stage plus trailing Canvas stages (installed
   `assets/documents/brand-brief-multistage-document.worldbend.json`; repo twin
   `examples/brand-brief-multistage-document.worldbend.json`).
   `figma_work_continuation` revise maps only the leading stage to Figma;
   trailing Canvas and canvasSet stay document delivery. Other multi-stage
   shapes still reject — keep them in the document.

## Discover a spatial expression

For an open visual task such as making a stage feel deeper or revealing content
through a moving surface, use `effect_catalog` to discover the versioned choices
and read [spatial effects](references/spatial-effects.md). `effect_recipe` expands
one selected/versioned effect into reusable data; `effect_plan` evaluates that
data at explicit input state and returns a recipe fingerprint. These are fixed
software operations, not an instruction for the model to invent effect code.
Compare meaningful expressions in the runnable preview when the design choice
matters. Known recipes and routine edits go straight to execution.

Use spatial-effects version `3` for current discovery and new spatial-appearance
work. Keep version `1` or `2` when replaying an existing recipe; version `2`
also remains the live-DOM shared-camera carrier. When the intent is a
viewpoint-consistent layered scene rather than decorative motion, compare
`layered-depth` with `multiplane-camera`. The latter requires explicit ordered
layers and uses one shared camera; inspect each planned frame's `coverage`
before delivery. Coverage reports geometry and missing overscan, not opaque
pixels, hidden object surfaces or 3D reconstruction.

Version `3` binds decoded textures and can derive bounded depth of field and
motion exposure from explicit recipe and call inputs. Optical focus is separate
from camera convergence. A depth map is an optional caller-selected grayscale
binding, never an inferred core result. For motion, pass the previous complete
state plus elapsed seconds, then pass identical previous/current state when the
interaction stops. Use `examples/appearance.html` to compare clear, depth and
motion results before delivery. A downstream App can pin a verified build.

Use `examples/document.html` to verify two core-compiled document versions,
continued input, asset-ID source replacement, failed replacement recovery,
reduced motion and responsive layout. The example exercises continued work across revisions. Check each carrier's
supported expression kinds before delivery.

For a SwiftUI App stage, call the current `effect_catalog` with `carrier: "swiftui"` even
though the final animation runs natively. The current supported result is
`layered-depth`: expand it with `effect_recipe`, retain the exact recipe and
fingerprint, and map its linear translation tracks to local SwiftUI offsets.
The App owns gestures, interruption, return animation, reduced motion and
product actions; there is no Web dependency or per-frame MCP call. Compare the
result with a small host-only implementation when that is a material product
choice. Choosing host-only after consulting the capability is useful evidence;
silently bypassing the capability is not a Worldbend evaluation. The example
pages are developer fixtures, not the Agent or designer product surface.

## Continue a designer's editable Figma work

Use the actual selected frame, its native content and its visual preview as
context. A designer does not need to write a handoff note or copy coordinates.
Keep the owner's file/page grant; do not inspect or alter unrelated designs.

1. Call `worldbend.run` with operation `figma_inspect` and arguments
   `{fileKey, pageId, nodeId}` for the selected Worldbend editable result or
   its duplicate. This prepares a request; it has not read Figma yet.
2. Load the Figma tool's required skill and pass the returned request object
   to the available `use_figma` tool. It returns the current operation, native
   source IDs, placement, revision, expected state and a bounded visual preview.
3. Edit native text/fills directly through Figma when only content must change.
   For geometry, call operation `figma_apply` with
   `{snapshot, spec, width?, height?}`. `snapshot` is the complete structured
   state from the actual Figma result; `spec` is the intended normalized
   affine/projective TransformSpec. Dimensions default to the current frame.
   The native core validates/solves it and prepares the next request.
4. Run that request through `use_figma` within the same grant and inspect its
   visual preview. Retain the new snapshot for subsequent edits.

`E_FIGMA_CONFLICT` means the document changed: inspect again, account for the
designer's intervening edit and prepare a fresh request. Do not replace the
expected state by hand. Native text and fills remain live. A duplicated result
gets its own binding on first update; neither its original nor a missing linked
source is silently replaced. Native geometry excludes Warp/Correct and axes
over 4096. An unavailable effect is an explicit error.

When native source content changes, refresh existing linked raster results with
`figma_linked_results`. Execute each prepared request through `use_figma`:
Inspect `{action:"inspect",fileKey,pageId,sourceNodeId}` returns the bounded
affected plan. Read `{action:"read",plan,nodeId,completed,includeSourceRasters:true,
sourceRasterTransport:"artifact"}` only after every affected prerequisite
successfully publishes. Retrieve the actual named PNG bytes. Publish
`{action:"publish",plan,snapshot,completed,sources:[{slotId,base64}]}`, excluding
`sourceRasters` from `snapshot`, then execute the inline request or every transfer
step. Add only `{nodeId,revision,expected}` from its successful receipt snapshot
to `completed`. Preserve the exact saved `operationJson`; refresh keeps that
operation and retains valid pending drafts without applying them. Report
unavailable or damaged items and blocked consumers; independent branches can
continue. Cancel staged media before fresh retry after interruption, and
reinspect after any changed target or prerequisite.

For a designer's two-through-eight-layer Depth result, keep the same file/page grant but use
the spatial handoff instead of `figma_apply`:

For new work, call `effect_recipe` for a supported starting recipe, then
`figma_effect_create` with `{fileKey,pageId,sourceNodeIds,task,requestId,name?}`.
Use 2..8 existing same-page source nodes matching the ordered recipe layers.
Execute the prepared request; its empty linked result needs source export and
publication below. Keep the same `requestId` and inputs to retry across sessions;
retry returns the current object, including a designer's later edits. An inspect
snapshot with `published:false` is unfinished and cannot be continued as
published work. Never create another copy merely because the first response
was interrupted.

1. Call `worldbend.run` with `figma_effect_inspect` and `{fileKey, pageId,
   nodeId, includeSourceRasters:true, sourceRasterTransport:"artifact"}`. Execute the returned request with `use_figma`; the snapshot contains
   the published version-3 recipe, reference state, exact named source order,
   revision, expected state, and any
   already staged draft.
2. Keep every bound source exactly once. Optional `sourceNodeIds` changes their
   far-to-near role order; raster slots stay in the inspected order.
   For replacement, addition or removal, call `figma_effect_sources` with
   `{snapshot,sourceNodeIds,includeSourceRasters:true,sourceRasterTransport:"artifact"}`
   and execute its read-only request. Keep its `sourceSet`; use the returned
   original snapshot fields without `sourceSet`/`sourceRasters` as `snapshot`.
   Raster slots then follow the proposal order, and the edited recipe must have
   one layer for every proposed source. Cycles through containers or linked
   dependencies are rejected. The original result remains bound until Publish.
   Change only explicit recipe/state values supported by the Figma carrier:
   two through eight ordered camera planes, one shared camera, plane-level
   depth of field, motion settings, and no depth maps or layer tracks.
3. Retrieve the actual named PNG artifacts. Call `figma_effect_publish` with
   `{snapshot,recipe,state,sources:[{slotId,base64}],sourceNodeIds?,sourceSet?}`; exclude
   `sourceRasters` from `snapshot`. Execute the returned request or every
   `figma_publication_step` of its bounded transfer. The final receipt publishes
   the exact rendered task and role order. Inspect and view the result again.
4. For optional human review instead, `figma_effect_stage` with `{snapshot,task}`
   stores a revision-bound semantic draft. The designer can preview and Apply;
   the Agent can also explicitly publish its values through step 3. A stage or
   prepared packet alone is not finished artwork. An unchanged recipe/state/order
   refresh retains the draft; publishing edited values clears it.

On `E_FIGMA_CONFLICT`, inspect again and reconcile with the designer's newer
published result. Never replace `expected`, write draft plugin data directly,
or describe a staged task as finished artwork.

To continue that published Depth relationship on Web without re-placing its
layers:

1. Start from the snapshot returned by the actual `figma_effect_inspect`
   request, not a reconstructed or older conversation value. Call
   `worldbend.run` with operation `figma_effect_continuation` and arguments
   `{snapshot}`. This operation is pure and must not be passed to `use_figma`.
2. Use the returned `document`, `deliveryPlan`, `expressionId`, `initialState`
   and `sourceBindings` as one receipt. Do not rebuild its role-to-asset map.
   Resolve or export decoded media for every returned named asset ID; the
   projection intentionally embeds no Figma pixels.
3. In Web code, pass the complete continuation receipt and asset-keyed media to
   `attachFigmaEffectContinuation`. It verifies that the document, delivery and
   ordered source roles still agree before delegating to the ordinary document
   binding. Retain that binding for interaction and call
   `replaceAsset(assetId, decodedMedia)` for later content changes. Plan and
   retain a new durable document fingerprint when the saved content revision
   changes.
4. Preserve every returned loss. `figmaPlacementNotTransferred` means the Web
   host owns its layout. `sourceMediaNotEmbedded` means media still needs a
   carrier binding. `stagedDraftExcluded` means Web received the published task,
   not an unpublished Agent proposal. Do not claim visible Web publication
   until the binding has rendered with real media.

This route is one-way for one bounded Depth result. Combine its returned
document with another current projection only through `document_assemble` and
an explicit complete mapping. Do not present the route itself as Perspective
projection, Web-to-Figma sync, or conversion of arbitrary Figma content into
HTML.

For a published Composition result, ask for its Figma result link with
`node-id`. Call `worldbend.run` with `figma_mockup_inspect` and `{url}`; execute
the returned request with `use_figma`. The snapshot contains the published
legacy Mockup or complete Composition task, ordered Figma source-node bindings,
bounded source preview fingerprints, placement, revision, expected state and
any staged draft. Keep its `source-1` through `source-N` slots bound to those
nodes while editing the task. A current Composition task contains one standard
Spatial Template with `compositionProgram`, one whole-result Transform stage,
named single/Canvas Set outputs and the selected preview output. Call
`figma_mockup_stage` with `{snapshot, task}` and execute its request with
`use_figma`. This writes only a guarded draft on the result. The designer
selects that result, opens Composition, previews the current Figma sources and
presses Apply to publish pixels and the accepted task. When the brief asks you
to complete publication yourself, re-inspect with
`figma_mockup_inspect {url, includeSourceRasters: true, sourceRasterTransport: "artifact"}`, then call
`figma_mockup_publish` with `{snapshot, task, sources}` — it renders the task
through the shared core and returns an inline guarded request or a bounded
publication-transfer plan. Use the actual source image artifact bytes in slot
order, not the result screenshot or copied truncated base64. For a transfer,
fetch `figma_publication_step {transferId, step}` and execute every request in
order, including the final step. Chunk staging keeps the existing artwork; only
final publication replaces its pixels and advances the revision. Execute the
complete `stepCount`: a large first-party publisher may also have bounded code
chunks. Its final request verifies those bytes against a trusted SHA-256 digest
before invoking the full guarded publisher. Do not omit code chunks, substitute
runtime code or derive executable code from document fields. Cancellation and
final publication cleanup cover image and runtime chunks together. Check the
final receipt: `status: "published"` contains the actual `snapshot`;
`status: "failed"` requires reinspection, even when the Figma tool call itself
succeeds. Inspect the published result for its native visual preview; the final
transfer step returns the write receipt without waiting for a screenshot. Then call
`figma_publication_step {transferId, release: true}` to free the local cache.
After server/session loss, fetch `{scope: {fileKey, pageId, nodeId}, inspect: true}`
and execute the read-only request. Cancel the returned identity using
`{scope, transferId, cancel: true}` before inspecting the artwork and preparing
a fresh publication. This cancellation does not require the old cache and
cannot clear a different active transfer.
Identical chunks can retry; to cancel, fetch `{transferId, cancel: true}`, run
that Figma request, then release. A stale result requires reinspection; a
corrupt transfer requires cancellation and retransmission. Transfers expire in
ten minutes. For large exact PNGs, `figma_mockup_publish`,
`figma_effect_publish`, `figma_linked_results publish` and
`figma_work_revise publish` accept `{slotId,path}` instead of `{slotId,base64}`.
Save the complete source artifact without re-exporting or recompressing it;
use a relative path under the MCP's explicitly granted workspace. File inputs
retain exact PNG proofs and the existing 1,200,000-byte per-source limit.
For linked and work-revision reads, preserve an optional `sourceState` unchanged. It guards the
admitted native graph, rich text and variable closure independently of the
exact PNG proof, so repeat-export jitter does not imply an authoring change.
Sources without that proof retain strict PNG freshness checks. Never rewrite
either expected state or the captured PNG fingerprint to force publication.
For paged work-revision reads (including document `revise`), pass the first
page's `sourceFingerprints` unchanged alongside its token on every later part.
Request source artifacts only on the initial capture. Join the exact JSON parts
before parsing; a changed native source still invalidates the complete token.
Missing grants, traversal, symlinks or mismatched bytes refuse publication;
never substitute a result screenshot. Inline source transport is available for small images when the
connector cannot emit artifacts; verify the complete bytes before rendering. Publish only
the selected single whole-result output; render Canvas Set variants through
Variation Jobs instead. On `E_FIGMA_CONFLICT`, re-inspect and republish from
the fresh snapshot; never claim publication from a render alone. On a conflict, inspect
the result again; do not hand-edit the expected state or claim publication from
a successful stage. The link supplies the file and target node; it does not
grant Figma access by itself.

For a native SwiftUI/iOS receiving product, `foil_delivery` and
`mesh_gradient_delivery` accept `target:"swiftui"`. Keep the complete kernel
source/hash and recipe/source fingerprints. This is generated Metal from the
same canonical WGSL, not a new account Shader build. Use the standalone
WorldbendAppearance package's typed Foil/mesh sessions and material surface;
send design revisions through the ordinary core update operation, carrying
accepted source plus current local material. Pause/visibility clocks remain
host state. Preserve explicit local removal and use a fresh local receipt for
committed tuning; preview changes do not rewrite committed receipts. Web
receivers continue to require `target:"web"`. The native receiving example
and `packages/swiftui/PROCEDURAL_MATERIALS.md` describe lifecycle and concrete
target evidence; do not turn an iOS build into a physical-iPhone acceptance claim.

Mesh-gradient delivery has two immutable profiles. New direct deliveries default
to `worldbend.mesh-gradient.rgba@0.2`, whose motion joins at each loop boundary.
Retain `kernelProfile:"worldbend.mesh-gradient.rgba@0.1"` when reconstructing
an accepted v1 source/update fingerprint; pass v2 explicitly in the next source
to upgrade. Source revisions preserve local color/phase and paused clocks; local
tuning keeps the accepted renderer. Native v1 reads/edits remain supported, and
projection retains that profile unless an explicit target choice requests v2.
Revising controls back to Figma never performs renderer adoption; adopt the
matching available build explicitly first. Local v2 source preparation does not
establish an account build or permission to publish it.
To choose a reusable scene before any result exists, call `figma_templates_inspect`
with the same file link (no `node-id` needed) and execute its read-only request.
It lists the client's saved templates with each one's kind, editable slots
(bound-source names and authored raster sizes), and discovers current marked
native masters in that file even without client storage. Native masters retain
their Figma decoration; the appearance partition describes core recompute. Use
each native entry's actual `pageId` and result reference for inspection. Check
`discovery` for unavailable storage, invalid masters or incomplete coverage
before interpreting an empty list. `readyScenes` lists bundled native first-party
scenes and their artwork slots. Run `figma_scene_create` with the file link,
`pageId`, ordered `artworkNodeIds`, optional Cover/Contain `fit` and name. Choose
`scene:{kind:"ready",id}` from that list or `scene:{kind:"native",snapshot}`
from a fresh master result inspection. Execute its prepared request. It creates
independent copied artwork and native decoration, then returns a new snapshot
with `status:"needs-publication"`. Export that result's sources and run
`figma_mockup_publish` to finish it; an empty initial projection is pending work.
Retry the same prepared request to recover the instance. Use a stable optional
`requestId` to re-prepare across sessions; keep its inputs identical. Recovery
returns the instance's current snapshot and publication status. Continue a moved
instance from its returned result link. Do not create duplicates to recover a
publication failure.

To continue the published Composition through downstream providers, call
`worldbend.run` with `figma_composition_continuation` and `{snapshot}`. This is
a pure projection; do not pass it to `use_figma`. Use the returned `document`,
`deliveryPlan`, `expressionId` and `sourceBindings` as one receipt. Resolve or
export one source resource for every returned asset ID and execute the static
delivery's Variation Job; do not rebuild the plane order, whole-result stage or
output variants. Preserve every loss: source bytes and Figma placement are not
embedded, preview fingerprints are change tokens rather than content digests,
and an unpublished draft is excluded. Replacing media under a stable asset ID
preserves the relationship. Page editing and deployment remain separate
providers. Unless a real Procedure selected and coordinated those providers,
describe such a test as Provider-chain validation rather than a Procedure run.

These preparation operations require no Node/Vite installation, development
checkout or local input files. They never contact Figma or publish by
themselves. For a live web delivery, reuse the returned TransformSpec with
`css` and the actual DOM element/destination sizes; this transfers geometry,
not an automatic conversion of arbitrary Figma content into HTML.

## Shared-plane cards and reference images

When adjacent cards must share collinear top and bottom edges, use `plane_strip`
with one parent TransformSpec and ordered source intervals. Independent tilts or
per-depth size tiers do not encode that constraint. Author the plane from the
design intent and verify the rendered result against the reference; do not claim
an image's coordinates were automatically measured. `worldbend.describe` for
`plane_strip` provides its bounded input schema. The result gives a separate
reusable spec and CSS for each live card. This works with HTML/images/video;
there is no need to bake the content into an image.

## Native appearance material delivery

For native glass, first use `figma_appearance_inspect` on the permitted file,
page and node, and execute the prepared connector request. It reads actual
native values, shared preset provenance, extra native fields and expected state.
Use `figma_appearance_apply` with that fresh expected state, the seed recipe and
optional separate effective material. Preserve native edits: use
`appearance_revision` for an upgrade of the same preset, and do not restore a
removed effect merely because its seed remains. Re-read after writing.

Deliver current live values through `appearance_delivery` for one explicit
target. Use `@worldbend/web/appearance` to attach, update and dispose the reusable
Web implementation on existing controls; `swiftui` gives an Apple system iOS 26+
modifier, while `swiftui-optical` gives a parameterized iOS 17+/macOS 14+ Metal
renderer over an explicit presentation-only SwiftUI backdrop. Choose the latter
when numerical optical tuning must reach actual pixels; do not select a system
preset and describe that as six-field reproduction. A received material can take later native edits without a preset
upgrade: plan `appearance_update` against the accepted source and apply it with
`@worldbend/web/appearance-receiving`, which preserves local edits and removal
(`references/live-web.md` owns the receiving details). Inspect per-field
fidelity and `nativeExtras`: Splay is preserved in
Figma but has no portable mapping yet. Numeric optics remain unavailable on the
system target; the optical target approximates all six. Native video/web/Metal
layers need an explicit sampleable texture provider and must not silently vanish
from the supplied backdrop. Neither target claims pixel identity. The human plugin preview
is the applied containing native scene, not a CSS imitation. See the owning
native appearance contract and the runnable native-glass examples in source.

Check the selected adapter's supported operations before delivery.
When repair is authorized, improve the responsible shared renderer/contract and
verify the consumer rather than accumulating app-local optical forks. Installed
catalog availability is separate from source support; inspect the current tool
surface and do not claim an uninstalled source improvement is already available.

The paper/texture family follows the same route with its own operations:
`figma_texture_inspect`/`figma_texture_apply` over the native NOISE and
TEXTURE effects (duotone kinds, secondary colors and blend modes survive
applies as disclosed extras), `texture_revision` for seed upgrades, and
`texture_delivery` with `@worldbend/web/texture` for the grain-tile and
SVG etch Web route. A texture instance and a glass instance coexist on one
layer; each keeps its own provenance.

For a native Foil or moving mesh-gradient fill, use `figma_foil` or
`figma_mesh_gradient`. Supply exact source evidence from `get_shader` and the
actual paint identity from a live capture or acquisition. Execute the prepared
resource/read/edit request with the authorized Figma tool. Join tokened read
parts before editing; retain the current `expectedState`, select only intended
fields, and reread after publication or a conflict. Acquisition makes a renderer
available; explicit adoption changes the accepted renderer. Use each family's
delivery/update operations for its verified receiving target. A native Shader
id alone is not a portable implementation or proof of installed availability.

## Route the request

For folded screens or moving frosted windows whose sampled content must remain
on a stationary plane, use `window_plan` and the optional local Web binding.
Read [spatial windows](references/surface-window.md) only for that task. This
does not replace ordinary DOM perspective or simple host-layer parallax.

1. Run `pose` for a card, video, iframe or DOM plane expressed by tilt angles
   and perspective distance. For example, `operation: "pose"` with arguments
   `{elementSize: {width: 640, height: 360}, pose: {perspective: 1300,
   rotateX: 3, rotateY: -8, rotateZ: 1}}` returns live CSS and a reusable spec.
   Angles use CSS signs in degrees; other units and optional origins are in
   the exact operation schema. This is single-plane projection, not a scene.
2. Run `css` for an existing four-corner mapping on a live image, video,
   iframe, canvas or DOM element. Supply its border-box size and, for a
   normalized mapping, the destination size. Playback, text and controls stay
   live. Nonzero Warp needs raster or WebGL output, not CSS matrix3d.

3. Run `compose` once when the caller supplies semantic scale,
   clockwise rotation, horizontal/vertical skew, translation, pivot, or
   horizontal/vertical source-flip values, or one common Warp preset over an existing mapping. For a
   normalized spec, include its concrete target size. Use the returned tight
   spec and canvas placement instead of deriving a matrix in model reasoning.
   Omit `pivot` unless the user explicitly changes the reference point. Its
   values are relative to current destination bounds: top-left `(0,0)`, default
   center `(0.5,0.5)`, bottom-right `(1,1)`; they are never pixel coordinates.
   Flips XOR into `content.orientation`; never mirror destination corner order.
   Warp uses `transform.warp` with one of `arc`, `arch`, `flag`, `wave`,
   `fish`, `rise`, `fisheye`, `inflate`, `squeeze`, or `twist`, and a finite
   signed `amount` from -1 to 1. Use `transform.clearWarp: true` to remove an
   existing Warp; never send it together with `transform.warp`. Do not
   calculate or supply mesh vertices.
4. Run `solve` once when the caller supplies four corners or asks for
   a reusable perspective mapping. Preserve the strict `tl`, `tr`, `br`, `bl`
   meaning and present stable geometry errors instead of silently reordering.
5. Run `plane_candidates` only when the caller explicitly wants uncertain
   source-plane suggestions from one supplied PNG, JPEG, WebP, or TIFF. Select
   exactly one Provider: `contrastQuadV1` for a region visually distinct from
   its image border, or `alphaQuadV1` for transparent-background support. Treat
   every confidence value as an uncalibrated ranking score, preserve all source
   facts and uncertainty reasons, accept `noCandidate`, and never auto-apply
   the first candidate. A separate caller selection and explicit output size
   are required before Rectify.
6. Run `psd_smart_objects` only to inspect one bounded PSD/PSB or to project
   caller-selected eligible Smart Objects into a Worldbend Spatial Template.
   It is read-only: it never extracts embedded assets, writes Photoshop files,
   rasterizes unsupported warps, or silently selects layers. Preserve the
   returned importability reasons and bind replacement assets separately.
7. Run `rectify` once when the user or an upstream system already
   supplies a source-image quadrilateral and explicit integer output width and
   height. Preserve strict `tl`, `tr`, `br`, `bl` meaning. Visual inspection
   may guide an explicitly authored quadrilateral; do not present a chosen
   aspect ratio as a measured physical ratio or estimate a camera. Call
   `rectify_render` instead when a local PNG, JPEG, or WebP must be
   flattened into the declared PNG output; its paths use the same explicit
   workspace authority and dry-run semantics as ordinary render.
8. Run `inspect` once for an existing `TransformSpec` whose current
   validity, bounds, reprojection, or horizon safety matters.
9. Run `canvas_render` once when the caller has already supplied
   exact Crop, Trim threshold, Pad insets, Contain, Cover, or Stretch values
   and one or more explicit output variants. Use the returned resolved plan to
   replay content-dependent Trim geometry on another same-sized 8-bit raster.
   The output directory must be a new relative directory; one call publishes
   the complete ordered set or publishes nothing. An Agent may choose a crop,
   background, anchor or aspect ratio when the user delegates that design
   decision; pass the choice explicitly rather than implying core inference.
10. Run `program_inspect` / `program_render` when the caller supplies one
   ordered chain of 1..8 existing Transform, Rectify, and Canvas stages over
   one source raster. Use it instead of publishing and reopening intermediate
   PNGs. It produces one final PNG or nothing, and reports every stage's input
   and output size. Do not invent stages, use it as a batch operation, or add
   multi-source, branching, fan-out, or per-stage publication.
11. Run `template_inspect` when the caller supplies one reusable Spatial
   Template rooted in an existing Raster Program or Mockup, and run
   `variation_plan` / `variation_render` when it also supplies the complete
   ordered item bindings and exact asset paths. Every item binds each template
   slot exactly once. One render publishes the complete nested item/output PNG
   directory or nothing; do not replace it with independent render calls or
   invent a workflow graph.
12. Use `media_inspect` / `media_render` when sample precision, TIFF, ICC
   preservation/discard, JPEG matte/quality, or explicit loss reporting
   matters. Use `vector_render` only for a supplied SVG and explicit intrinsic
   size: affine SVG stays SVG, projective placement requires the HTML carrier,
   and non-zero Warp is rejected. Use `tiled_media_render` for a supplied large
   destination and explicit tile/output budgets; it publishes one atomic
   directory plus a relative-filename manifest and does not make source decode
   unbounded.
13. Run `mockup_plan` / `mockup_render` for caller-authored ordered planes,
   source IDs, seams, grids, measurements, opacity, and canvas. An optional
   `clip` masks the composed canvas to closed contours (line or cubic
   segments, `nonZero`/`evenOdd` fill rule); it clips and never reshapes the
   planes. Run
   `mockup_extract_plan` / `mockup_extract_render` when the caller supplies an
   ordered set of Rectify programs to extract from one original raster. Source
   sets must match exactly; directory output is all-or-none. You may author
   explicit placement from visual context and the user’s intent; the core
   validates those coordinates rather than inferring or repairing them.
   Paint order is independent of source identity: a backdrop can be the first
   plane while still referencing `source-2`. Preserve the source-ID bindings
   when replacing artwork or reusing a saved scene.
14. Run `mesh_plan` / `mesh_render` for a caller-authored regular or indexed
   custom mesh. Preserve vertex order, declared source topology, boundary,
   and positive triangles.
   Author intentional control points within the brief and validate the plan;
   never combine custom Mesh with preset Warp.
   Use `deformation_plan` / `deformation_render` for one saved work combining
   plane, Pin, Liquify and Mesh edits. Its optional `shapeFit` retains one
   authored closed Line/Cubic outline and optional ordered corner landmarks.
   `shapeFit.clip` retains a complete compound fill in that fitted domain:
   keep its original curves, holes, region references and winding rules.
   For a compact Agent receipt, pass `planView: "state"`: it preserves the
   complete recipe and resolved metadata while rendering the full geometry.
   The default `full` view also returns generated editing meshes and may exceed
   the response bound for detailed outlines. Save the work spec for later
   source replacement and revision; generated meshes do not replace that recipe.
15. Run `surface_plan` / `surface_render` for a caller-authored bounded cubic
   Bezier patch lattice plus ordered source-space deformation strokes and
   explicit interior anchors. Boundary controls remain fixed and the operation
   resolves to the canonical validated Mesh contract. Author explicit handles
   or strokes; do not replay pointer events, simulate Liquify, or combine the surface
   with a preset Warp.
16. Run `remap_plan` / `remap_render` for explicit Brown-Conrady lens values or
   a channel displacement map. Displacement requires exactly one map; lens
   rejects one. Do not estimate a lens, depth, flow, channels, neutral value,
   scale, or boundary mode.
17. Run `timeline_plan` / `timeline_render` for explicit per-frame transforms or
   linear four-corner keyframes. The source set, frame order, IDs, fixed output,
   cumulative budget, and atomic PNG directory are part of the program. Do not
   claim inferred motion tracking or loop independent render calls. Deliberate
   animation keyframes may be authored within the user’s brief.
18. Run `motion_plan` / `motion_render` when the caller supplies the exact
   rational frame rate, first/last-covered keyframes, and linear, hold, or
   cubic-Bezier easing. Use the returned rational presentation times and atomic
   PNG sequence; do not estimate tracking, optical flow, cadence, or encoded
   video/audio.
19. Run `render` once to apply or reuse a saved mapping on a local
   PNG, JPEG, or WebP. Paths are relative to the explicitly granted workspace.
   Use `dryRun: true` when overwrite authority or output feasibility is not yet
   established; do not claim a file was written from a dry-run result.


Do not add a search or describe call before these dominant tasks. The legacy
direct compatibility surface retains the eight `worldbend.<operation>` tool
names for existing clients, but the installed compact surface intentionally
does not load those eight schemas into every Agent context. Do not estimate a
homography in model reasoning when the tool is available.

## Web integration and task choice

Use `material_preference` for Texture/Foil/mesh product-selected consumer
controls and explicit personal intent. It evaluates a typed family source,
versioned policy/scope, preference record and actual runtime; it does not store
or apply preferences. Read authored, product-permitted and target-effective
ranges separately. Hidden or newly out-of-range intent remains recoverable;
equal-to-default choices remain explicit. The built
`@worldbend/web/material-preference` session supplies local preview/apply/cancel,
source/policy revision, reset and bounded record export/restore. Human and Agent
actions use the same current guards, including draft/runtime changes. The product
owns account storage and permission; a planned delivery is not a saved preference
or installed consumer result. Glass keeps its existing appearance preference path.

For native Foil/mesh personal receiving, use the Swift package's
`WorldbendFoilPreferenceSession` / `WorldbendMeshGradientPreferenceSession` with
the pinned `swiftui` source, receiver policy and scope. Human preview, committed
intent and actual runtime remain distinct. Its guard is local to that session;
it does not fabricate a canonical source/delivery fingerprint. Portable records
are family/scope/recipe-bound and at most 16 KiB. The host owns storage and
account association. See `packages/swiftui/PROCEDURAL_MATERIALS.md` in source.

For a complete material document on Web, obtain its ordinary
`document_delivery_plan` and use `@worldbend/web/material-document`.
The product resolves expression/surface/content bindings to existing elements.
Its guarded `revise` prepares new families/surfaces before presenting them,
keeps compatible renderers/clocks and retains accepted work on failure or
cancellation. Use `recover` for an unavailable renderer and `destroy` when
retiring that receiver. Static/interactive/temporal expressions use their own
execution carriers. Host content, personal overrides, accounts and storage stay
distinct; this action alone does not establish the whole workflow or installed
consumer acceptance.

The caller can be an Agent: choose intentional design values within the task,
then ask Worldbend to execute them. Do not invent measurements, detected planes
or user approvals. Use native CSS directly for trivial decorative rotation
when there is no geometry, source-reuse or export task to simplify.

For repeated web use, the Web perspective entry exposes `attachPlanePose` and
`attachPerspective`. `attachPerspectiveStrip` keeps adjacent cards on a shared plane. Bindings follow layout size, accept complete input updates,
retain the last valid mapping, expose `getSpec()` for reuse and restore styles
on disposal. `attachPointerTilt` adds explicit bounded pointer response with
reduced-motion support. Pointer frames run locally, never through repeated MCP
calls. See `references/live-web.md` for the short integration route.

For a built Web scene integration, `@worldbend/web/mockup-motion` exposes
`attachMockupMotion` over the ordinary `worldbend.mockup-motion@0.1` Spec. Supply
exact source IDs and decoded images; it snapshots their pixels and uses the same
core frame plan as native mockup-video. The controller plays/pauses/seeks and
accepts guarded design/source updates with relative playhead and pause retained.
Treat stale, busy, cancelled and context-lost states honestly; destroy the binding
when its host retires. Keep host content/actions and accessible scene description
outside the decorative canvas. The built-package book scene verifies this
continued path; it does not establish installed-plugin availability or arbitrary
3D/camera/lighting support. No per-frame tool/model calls are needed.

An ordinary Mockup or MockupMotion plane can retain `surface` and `shadow`.
The projected-alpha shadow takes an explicit pixel offset, Gaussian
`blurSigmaPx` (0..64), RGB8 color and opacity; core plans its expanded caster.
It follows source alpha, orientation and deformation and paints before its
plane. Keep those fields when returning temporal work to static authoring.
Web/Figma Gaussian filtering and native approximation may produce different
pixels. See `docs/MOCKUP_CONTRACT.md` and the first-party scene-shadow example.

## Boundaries

- The currently installed operations do not automatically apply a suggested
  plane, infer semantic objects or output sizes, generate segmentation/depth/
  flow, estimate a camera, synthesize lighting or shadows, reconstruct 3D,
  provide an arbitrary scene graph, publish generic batch/branch programs, or
  encode video/audio. Use another explicit provider or tool when the user's
  task needs an available adjacent capability, then preserve its accepted
  result and provenance in Worldbend where the current contract supports it.
  These are the current route limits.
- A render workspace is available only when the host grants
  `WORLDBEND_WORKSPACE_ROOT`. If it is absent, compose, solve, inspect, and
  CSS and rectification planning remain available; report that file rendering
  needs an explicit workspace grant.
- Keep matrices and numerical diagnostics concise unless the user needs them.
  For ordinary work, present the saved spec, output path, placement, and any
  warning or stable error that changes the next action.

For continued multi-plane motion authoring, use the shared
`mockup_motion_authoring` run operation (or CLI `mockup-motion-authoring`) rather
than interpolating poses in the adapter. Inspect the current program to obtain
its canonical fingerprint; revise with that fingerprint and one closed edit.
Use atomic `setPose` when connected plane edges must move together. Large MCP
results require exact tokened reassembly. Web receivers expose `author` with an
instance/revision/fingerprint guard; preserve the returned publication guard
instead of rereading a later host state as if it belonged to your edit. The local
Scene Studio example combines these operations with durable work and native
exports. SetScenePose atomically revises one static scene pose/style while keeping
other authored times. The Figma Composition animation inspector uses this same
core for pose/timeline edits, capture/removal, retiming/easing and shared-receiver
playback. Saved results/templates retain `{spec, frame}` as `motion`; exact work
reads preserve it. Ordinary document projection returns `authoringMotion` and
the explicit poster-only loss. Use `projectTemporal` for complete animation,
whole Transform and named framing; temporal return retains all poses and output
siblings. Keep native decorations/camera/material/lighting and Figma video delivery distinct
from this linked-layer authoring result.

For whole-view motion, retain presentation keyframes rather than repeatedly
replacing its static transform. `setPresentationAtFrame` edits a sampled view
and fixed framing while keeping other times; `setPresentationKeyframe` and
`removePresentationKeyframe` author explicit view poses. Retime covers both
plane and whole-view poses. Figma uses the existing Whole editing target.
