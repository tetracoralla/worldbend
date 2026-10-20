# Spatial Document contract

## Status and purpose

This is the contract for a durable Worldbend work once that work is supplied
as a Spatial Document. Version `0.1` gives 1..32 ordered static Spatial
Template, interactive Effect Recipe, temporal mockup-video, typed material or adopted three-dimensional scene expressions a
shared asset and document identity, plus stale-safe multi-document assembly,
source revision and delivery planning across them. It is an implemented inspection, assembly,
update-planning and execution-projection contract. The broader authoring model
is still ahead.

The direction is that one work stays intact when one result is a static image
and another is an interactive Web expression. Version `0.1` provides shared
identity for expressions already written into one document and can assemble
two or more current projected documents when the caller explicitly declares
asset equivalence and resulting expression identity. It does not require both
expression kinds. A caller who holds that document can bind the same named
asset into every expression that needs it, revise that asset later, have the
core identify every bound expression that needs
redelivery, and compile the selected expressions into their existing execution
contracts before a carrier executes them. Version `0.1` also has bounded
projections from inspected, published Figma raster and native Frame/Vector work into
those existing document and delivery contracts.

This version establishes the document's asset and expression rules. Static
templates and interactive recipes keep their own execution semantics. Their
existing contracts remain authoritative.
Static raster expressions now retain the existing Mesh, Surface/Pin, complete
Deformation Work (including Liquify and fitting), Lens and displacement Remap
families through the ordered Raster Program contract. Displacement control
maps are derived template input slots bound to durable assets, so their revisions
participate in the same stale guards and affected-expression planning as artwork.
Fitted Deformation Work stages may also bind a durable `fittingGuide` asset.
Its slot ID is the fitted stage ID. This optional authoring dependency requires
that stage to retain a captured fitting clip; other stages and interactive
recipes do not admit it. Inspection, assembly, local overrides and revision
impact retain the guide binding. The static delivery's bindings disclose it,
while its executable Variation Job binds only content media.

The program carries captured geometry. Changing a guide content version marks
bound expressions for authoring refresh; it does not derive a new contour from
that version. Recapture the guide and supply the updated expression to retain
new geometry before ordinary redelivery. A document with baked fitting geometry
and no live guide asset remains supported. Native carrier authoring is described
below. Temporal mockup-video and typed material expressions are implemented.

## Three-dimensional scene expressions

`kind: "scene3d"` retains an adopted scene asset, exact camera/animation, shared
artwork bindings, rational timing and receiving presentation. The ordinary
document revision, assembly and delivery rules apply. The optional Three carrier
executes standard glTF rather than a second Worldbend geometry kernel. Read
[SCENE3D_CONTRACT.md](SCENE3D_CONTRACT.md) for current execution, recovery,
resource limits, frame delivery and declared native/Web differences.

## Material expressions

`kind: "material"` keeps an authored recipe, actual material and intended target
through `material: { family, input }`. The four admitted families are `glass`,
`texture`, `foil` and `mesh-gradient`; `input` is the existing closed family
delivery input. Family validation, target support, kernel identity and loss
receipts remain owned by those contracts. Document delivery returns
`material: { family, delivery }` containing the ordinary family delivery receipt,
not a baked screenshot or a new rendering implementation.

Each expression binds 1..64 distinct named receiving surfaces through `content`
bindings. The `slotId` names the surface role and `assetId` names the content
displayed there. A receiver resolves that binding to its existing component;
the material binding retains its content, actions and layout. These assets are
content identities, not implicitly sampled backdrops or externally fetched
textures. Depth-map/fitting-guide roles are rejected for material expressions.
Bindings are canonicalized by surface slot for inspection, identity and delivery.

Materials can share a content asset with any other expression. Content revision
marks every bound expression for redelivery while preserving authored material.
An explicit material-expression revision retains the current actual values
separately from the seed and leaves omitted expressions intact. Assembly remaps
content assets and expression identities without changing surface roles or
family parameters. Existing document fingerprint guards apply throughout.

The `packages/web/examples/material-document` example consumes source-MCP
artifacts through the four existing Web bindings: one Field Notes work changes
edition, preserves controls, rejects replay of the previous document update,
and reopens the accepted edition. The source is authored without Figma.

### Receiving a material document on Web

`@worldbend/web/material-document` supplies `attachMaterialDocument(plan, options)`
over the ordinary material delivery plan. `resolveSurface` maps each expression,
surface slot, content asset and family to an existing HTMLElement. It never
replaces host content or actions. The current entry executes material expressions;
static, interactive and temporal expressions retain their owning execution
carriers. Canonical family validation, resources and rendering stay in the
existing Glass/Texture/Foil/mesh implementations.

The receiver validates and snapshots the whole candidate before changing a
surface. Compatible family/surface bindings keep their renderer and clock.
New families/surfaces prepare resources without DOM/style changes, then present
in one synchronous publication phase. Removed bindings retire only after the
candidate succeeds. Invalid input, unavailable acquisition, stale state, changed
receiving elements, cancellation and disposal keep the accepted document.
If a renderer fails during publication, other touched materials roll back and
the affected renderer reports its actual recovery state. Content changes remain
host-owned and follow successful material publication.

`revise` requires the current receiver guard: instance, document fingerprint,
local generation and actual runtime availability/reduced motion. Human pause and
intervening runtime changes invalidate older proposals. Concurrent revisions
reject. Binding aliases that resolve the same family twice onto one element
reject because the owning family admits one attachment there. Surface mapping
is rechecked at publication; a component recreated during preparation cannot
receive the old request. Calls retain independent family clocks rather than
inventing shared motion semantics.

`recover` retries unavailable renderers while retaining healthy surfaces.
`destroy` cancels pending acquisition, releases owned resources/listeners and
preserves host edits. Shared positioning/isolation leases prevent family
replacement from undoing another binding's environment. A delivery snapshot
accepts at most 8 MiB; this is a receiver record budget, not a core work limit.
The product owns storage, accounts, content and DOM placement. This receiver
does not create personal overrides or redefine core fingerprints.

The independent receiving check covers canonical source-MCP plans, actual
revised GPU pixels, all-family preflight, family replacement, failed acquisition
and retry, topology changes, target replacement, cancellation/late retirement,
actual device loss/recovery, retained content/actions/styles, trusted human
revision and reduced-motion/mobile use. This evidence is limited to the
documented receiving paths and expression families.

Current native material state continues through `figma_work_continuation` as follows.

`projectMaterial` accepts a complete actual `figma_appearance_inspect`,
`figma_texture_inspect`, `figma_foil` read or `figma_mesh_gradient` read result.
Join Shader read parts before projecting. Its input declares a matching family
and typed target, one content asset/version, an expression ID and receiving
surface slot. It constructs and validates the ordinary material document and
returns its inspection and delivery. Actual values remain separate from the
native recipe seed. The complete bounded host snapshot remains `origin`, outside
canonical document meaning: file/page/node, expected native state, placement,
variable bindings, paint composition and exact supported renderer resource.
Glass/Texture native extras enter their existing family input/loss receipts.
Source artwork is not embedded; Shader variables are resolved, non-default
paint composition and legacy renderer differences are explicit carrier losses.
This projection does not claim visual parity or prove the read is still current.

A live untagged native instance requires an explicit typed `documentSeed`.
`seedOrigin: "document"` distinguishes that newly authored document seed from
native provenance; `origin` remains untagged with no native recipe. A native
seed cannot be replaced through this option. Absent/removed material is rejected
rather than reconstructed from a retained recipe. Explicit native seed choices
and renderer adoption remain the owning family's operations.

`reviseMaterial` guards the exact inspected document fingerprint, selects a
material expression and an explicit content binding belonging to it, and accepts
a fresh complete native snapshot plus distinct owned fields from the same
family. The native or explicitly document-authored seed must remain exactly the
same. Shader families require exact `get_shader` source evidence matching the
snapshot resource, build and paint identity. Preparation delegates to the
existing family publisher; executing the returned request rechecks native state
at the write boundary. Only selected fields change. Native extras, unselected
values/Shader aliases, other fills/effects and seed provenance remain intact.
Glass/Texture selective writes retain split native effect visibility and sizes
unless those fields are selected; an untagged edit does not write provenance.
Reread the actual host result after executing. This action does not replace
content artwork, adopt a renderer, update a receiving app, publish or install.

Raster/native-transform authoring revision entries still reject material
expressions. Wider per-user tuning and unavailable target renderers are outside
this contract; these actions provide a native material continuation bridge.

## Product role

The Spatial Document is where shared work meaning accumulates:

- stable content identities and revisions;
- composition and relationship data;
- static, interactive, temporal and adaptive expressions;
- variants and output intentions;
- human and Agent edits, provenance and migration state;
- explicit carrier support and any loss at delivery.

Version `0.1` contains stable asset identities and exact bindings for each
static Spatial Template, interactive Effect Recipe or temporal mockup-video
expression supplied in the document. An Agent can turn live-inspected, published Figma raster controls
into a standalone version-`0.1` Spatial Document and ready static Variation Job
or interactive delivery. These projections reuse the ordinary document format.
The native artwork, Figma
canvas placement, staged drafts and bidirectional editing remain outside those
projections. Extend this document when more shared state must survive across
capabilities or deliveries.

Examples may exercise only part of this model. The supported work model is
defined by the current schema and carrier contracts.

## Work location and carrier ownership

The schema defines the meaning of a shared work; it does not prescribe a
`.worldbend` directory or require designers to leave their current editor. In
a Figma workflow, the Figma file owns native artwork, selected node identities,
placement and accepted visual output. Worldbend's canonical operations and
recipe checks remain portable, and the plugin stores the supported source
bindings and operation state on its Figma results. The Depth result's node
record is not itself a `SpatialDocumentSpec`. `figma_effect_inspect` must first
read the current published result through the authorized Figma tool. The pure
`figma_effect_continuation` operation then:

1. revalidates the bounded version-`3` two-through-eight-camera-plane snapshot;
2. maps every ordered named source node to the same stable document asset ID;
3. preserves the published Effect Recipe as the interactive expression
   `figma-depth` and returns the published reference state separately for Web;
4. validates and fingerprints the resulting document through the existing core
   and returns its ordinary `SpatialDocumentDeliveryPlan`;
5. retains file, page, result-node, revision and expected-state provenance in
   the continuation receipt, outside canonical document meaning; and
6. reports `sourceMediaNotEmbedded`, `figmaPlacementNotTransferred`, and, when
   applicable, `stagedDraftExcluded` instead of implying those facts survived.

Only the published Depth task is projected. A staged Agent draft remains reviewable
in Figma but cannot become Web work until the designer publishes it. The
operation does not contact Figma, prove a previously captured snapshot is still
current, export media, write a document file, touch a webpage or publish a
result. Callers resolve or export decoded media for all returned asset
bindings and pass the complete receipt plus those asset-keyed resources to
`attachFigmaEffectContinuation`. The helper
checks that the projected document, delivery and ordered roles still agree,
then uses the ordinary document binding. Subsequent Web content changes use its
asset-ID replacement and the durable document update rules below.

`figma_composition_continuation` is the corresponding static projection. It:

1. revalidates the published two-through-eight-source Composition snapshot,
   including its stable `source-N` order, complete `compositionProgram`, one
   bounded whole-result Transform stage and selected single/Canvas Set preview;
   a readable legacy Mockup task is wrapped into the same standard template
   with one Mockup root and single output;
2. maps every source slot to the same stable document asset ID and keeps the
   source node, name, dimensions and bounded preview fingerprint as provenance;
3. constructs the one-expression `figma-composition` Spatial Document and
   ordinary static delivery plan through the shared core constructor, so the
   resulting Variation Job preserves `Mockup -> whole-result Transform ->
   named outputs` exactly;
4. retains file, page, result-node, revision and expected-state provenance
   outside canonical document meaning; and
5. reports source-media, Figma-placement and preview-fingerprint limitations,
   plus staged-draft exclusion or damage when applicable.

The preview fingerprint is a stale/change token for the inspected Figma source,
not a media content digest. A caller still exports or resolves the source bytes
for every returned asset ID before executing the Variation Job. Replacing one
asset under the same ID preserves the composition, whole-result transform and
output variants while producing a new document identity when its declared
`contentVersion` changes.

`figma_work_continuation` extends this projection to the raster authoring
families: Perspective/Rectify, Canvas, Mesh/Surface, complete Deformation Work,
Lens/displacement Remap, Mockup/Composition and Depth. Its host inspection reads
published controls and current bound media in exact tokened parts, independently
of a pending draft. Projection reuses the static or interactive constructor.

An animated Composition retains its complete `authoringMotion` in the
continuation receipt. The ordinary static projection uses its selected poster
and reports `animatedCompositionProjectsItsPoster`; it does not transfer the
whole temporal outer Composition presentation into that static expression.
Guarded return to the same Composition carries its animation through a core
SetScenePose edit, preserving other authored times, outer processing and named
outputs. Temporal projection/return now carries the whole Transform and named
framing through MockupMotion presentation. Native scene decorations and wider
ordered temporal presentation remain delivery work.

Projection reports its sampling quality as `renderQuality`; a static caller supplies that
quality to the ordinary Variation renderer. Displacement media has an explicit
asset binding. A native fitting guide has a formal document `fittingGuide`
binding plus `guideBindings` identifying its current host source; raster
`sourceBindings` stay separate. Its captured fit remains in the program, with
`fittingGuideRetainedAsBakedGeometry` and `guideGeometryChangesRequireRecapture`
disclosing that version changes require geometry recapture. Guide assets now
participate in shared revision impact and expression-local overrides.

Current media can differ from the media used for the last Figma image. Continuing
the published controls therefore means recomputing them with the acquired current
source bytes, rather than copying or asserting freshness of published pixels.
The receipt reports `publishedPixelsNotCarried` and
`nativeResultAppearanceNotTransferred`: native output opacity, effects, strokes,
rotation and layout are not encoded into this projection. Source media remains
separate, and preview fingerprints remain change tokens rather than content
digests. A caller verifies the acquired bytes and can declare their content
versions during explicit document assembly.
Retain the exporting host with acquired raster evidence. Figma Desktop and the
MCP export engine can produce different text antialiasing from the same native
source. Exact replay compares identical captured artifacts; cross-host images
use the affected carrier's visual and alpha tolerances.

Their resulting documents can be combined through the carrier-neutral assembly
contract below; Figma is not special-cased by that contract. The general entry's
`revise` action also prepares a guarded authoring revision from one selected
document expression. It requires the current document fingerprint, an inspected
published Figma base, exact asset-to-node bindings and authoring raster dimensions.
The receipt retains the document fingerprint, source roles, canonical operation,
local output contract and prepared current-media read. The ordinary work publisher
then validates actual captured media and the live target before changing pixels,
controls and source identity together. Asset content versions remain caller-owned
metadata; mapping an asset to a node does not prove equality of their bytes.

Single-family carriers retain one stage, normalized supported controls and their
raw authoring canvas. Named delivery outputs stay in the original document, with
`namedDeliveryOutputsRemainInDocument` reported. Composition retains its supported
whole-result Transform and named outputs, requiring a selected preview ID. Depth
requires explicit receiving state and preserves ordered recipe layers. A live
fitting guide retains its source order and authored fitting domain. An explicit
guide asset-to-node binding can replace its host source; the existing host capture
and canonical fitter recapture current geometry. Without a guide asset, older
baked documents retain their inspected host guide. This recapture is reported as
`fittingGuideRecapturedFromCurrentFigma`; callers reproject the resulting work to
obtain the updated geometry for ordinary delivery.

Unrepresentable multi-stage programs, tight Transform canvases and unsupported
carrier controls reject rather than flatten or silently drop meaning. This is
the current adapter coverage, not a permanent product restriction. The operation
does not modify the supplied document or synchronize it in the background.
Native Perspective Frame/Vector projection now uses the same ordinary static
Transform expression. `inspectNative` reads the current carrier base and its
unprojected source facts; `nativeSource` acquires exact UTF-8 SVG bytes through
tokened base64 parts. Each part rechecks the entire target, physical source and
SVG preview token. `projectNative` compiles the inspected normalized Transform
and reference canvas through the existing static document constructor, preserving
explicit named delivery outputs when supplied. The origin keeps the native base,
source state, media size and visible source-effect names outside document meaning.

`reviseNative` maps a fingerprint-guarded static expression back into the native
authoring carrier. It requires one normalized reference Transform stage with an
explicit canvas, and exactly the selected content asset-to-node binding. The
receipt keeps the supplied named outputs, selected controls and fractional canvas.
Frame executes the existing native publisher on its editable Content, or copies
an explicit new source Frame into independent Content and retains the old
Content's identities on the page. Resolved variable modes are localized on
copied and retained roots; variable bindings and descendant overrides survive.
The native publication names the source origin and retained source nodes. Vector
reads a guarded complete proposal and uses its existing core path projection and
publisher, including explicit replacement sources. Wider programs remain
unfinished adapter coverage. Target,
physical source and exact SVG guards reject intervening edits; the caller rereads
before retrying. Asset content versions remain caller owned. Preparing the receipt
does not publish: execute its Frame request, or read all Vector proposal parts
then complete Vector publication. Native fractional dimensions are subject to
host numeric storage; the actual retained dimensions belong to the publication
snapshot. Ordinary static delivery remains separate.

An editable Frame's Content SVG avoids capturing its ancestor projection a second
time. Vector source capture uses its existing raster-view-box rules so strokes
and complete appearance share the geometry's source domain. The current static
receiver rasterizes the self-contained outlined SVG before canonical execution;
layout, text editing and native output appearance remain in Figma. Fractional
source/canvas sizes are disclosed as raster rounding, and source effects require
carrier fidelity review rather than an inferred exact visual match. Current source
media is recomputed; old published pixels are not carried. Preview tokens are
change tokens, not cryptographic content versions. Source resolution and native
publication stay explicit; this projection does not edit Figma or synchronize it.

Native Frame independent source replacement, broader document authoring and
interchangeable downstream/Figma layout coordinates remain unfinished. Saving another file beside Figma without
a validated binding and loss receipt does not make it the same work.

## Version `0.1`

`SpatialDocumentSpec` has the literal header:

```json
{
  "schema": "worldbend.spatial-document",
  "version": "0.1"
}
```

It contains:

- `assets`: 1..64 stable asset records. Each has an identifier and may have a
  caller-owned `contentVersion`. Paths, URLs, DOM nodes and bytes remain carrier
  bindings and do not enter canonical meaning;
- `expressions`: 1..32 ordered expressions with unique identifiers;
- a `static` expression, which embeds one existing `SpatialTemplateSpec`;
- an `interactive` expression, which embeds one existing `EffectRecipe`;
- a `temporal` expression, which embeds one existing `MockupVideoSpec`
  (`worldbend.mockup-video@0.1`). Required content slots are the ordered unique
  plane `sourceId` values from its nested `MockupMotionSpec`;
- exact bindings from every required `(role, slotId)` pair to one declared
  `assetId`. `content` binds ordinary source media. `depthMap` binds a map
  explicitly required by a version-3 camera-plane recipe. Static control maps
  use the template's derived input slots under `content`; their map role remains
  explicit in the corresponding Raster Program stage's `mapSlot` and inspection.
  Optional `fittingGuide` bindings name fitted Deformation Work stage IDs and
  participate in asset revision impact; their captured geometry remains in the
  stage and requires recapture when the guide changes;

Inspection returns one canonical SHA-256 document fingerprint. Asset registry
order, binding presentation order, JSON object-key order and signed zero do not
create different identities; ordered expressions and their actual nested
semantics still do.

The same asset may be bound into any number of expressions. This is the first
reusable-work guarantee: replacement can preserve cross-delivery identity
instead of relying on filenames or conversational context.

## Inspection and failure behavior

`inspect_spatial_document` validates the document without reading or writing
media. It:

1. validates the document header, bounded counts and unique identifiers;
2. delegates each static expression to `inspect_spatial_template`;
3. delegates each interactive expression to `inspect_effect_recipe`;
4. delegates each temporal expression to `plan_mockup_video` and fingerprints
   the resulting plan;
5. requires every derived content, depth-map and temporal plane slot exactly once;
6. rejects undeclared asset references, unknown roles or slots and duplicates;
7. returns bindings in the expression contract's canonical slot order;
8. reports declared assets that are currently unused instead of deleting them;
9. returns the canonical document fingerprint used by update guards.

Errors use the existing structured Worldbend error contract. One invalid
expression invalidates the document inspection; no partial document is
reported as ready.

The full CLI exposes `worldbend document-inspect --spec <path> --json`. The
compact Agent catalog exposes `document_inspect` through `worldbend.run` and
describes its closed input and output schemas through `worldbend.describe`.

## Multi-document assembly

`plan_spatial_document_assembly` accepts two to 32 current source documents,
one to 64 target assets and one to 32 target expressions. Every source document
has a caller-chosen ID and a required `expectedFingerprint`. Every target asset
has its own stable ID, optional caller-owned `contentVersion`, and an explicit
list of `(documentId, assetId)` source members. Every target expression names
one `(documentId, expressionId)` source and its target expression ID. The
complete request may contain at most 2048 source asset members, matching the
maximum 32 source documents by 64 assets rather than multiplying that bound by
the number of target groups again.

Assembly is deliberately an assertion validator, not an inference engine:

1. every source fingerprint must still match its inspected document;
2. every source asset and expression must appear exactly once—no silent drop,
   duplicate use or ambiguous assignment is accepted;
3. multiple source assets may map to one target asset only when the caller says
   so explicitly; Worldbend does not infer equivalence from names, Figma nodes,
   geometry or media bytes;
4. source templates and recipes are preserved, expression bindings are
   rewritten to the declared target asset IDs, and caller-declared expression
   order becomes document order;
5. source-document results, target assets and each asset's source members are
   normalized for stable output while expression order remains semantic;
6. the complete assembled document is inspected and compiled through the
   ordinary delivery planner before the plan is returned.

The result schema is `worldbend.spatial-document-assembly-plan`. The full CLI
exposes `worldbend document-assemble --spec <path> --json`; the compact Agent
catalog exposes `document_assemble`. The operation reads no carrier, media or
filesystem resource and performs no export, page edit, rendering, publication
or Procedure orchestration. A Procedure or consumer Agent remains responsible
for obtaining current projections and for asserting which assets are the same
real content.

Brand-brief consumer entry: one Spatial Document binds a product-screen asset to
a Spatial Template whose `canvasSet` publishes website-presentation and social
sizes; brand style is the reusable canvas background. Agents discover
`document_*` / `variation_*` / `figma_work_*` through search (no developer
operation files). Fresh sessions call `document_update_plan` with the current
fingerprint to replace one screen and regenerate; stale fingerprints reject.
Figma-origin creation uses `figma_work_create` and projects through
`figma_work_continuation`. Multi-stage brand briefs may add a leading projective
or fit stage plus trailing Canvas plate stages in one Raster Program
(`examples/brand-brief-multistage-document.worldbend.json`); revise maps only the
leading stage to Figma and keeps trailing Canvas + named canvasSet delivery in
the document. Installed Skill packaging ships the same documents at
`skills/worldbend/assets/documents/` for consumer Agents without a checkout;
`pnpm test:brand-brief-installed` verifies staged CLI continuity on those
assets. This evidence does not establish programs outside the declared operation
set, Agent Host marketplace import or public marketplace publication.


## Asset and expression update planning

`plan_spatial_document_update` accepts the current document and an optional
`expectedFingerprint`, with at least one edit in these optional collections:

- `revisions`: up to 64 unique revisions of existing assets;
- `expressions`: up to 32 complete replacement expressions under their existing
  IDs, for changing controls, output sizes or source bindings;
- `newAssets`: up to 64 distinct new asset declarations, within the document's
  total asset capacity, bound by the resulting work.

Each asset revision names a
declared asset and supplies its new caller-owned `contentVersion`; `null` or an
omitted value explicitly clears that version without deleting the asset.

The planner:

1. validates and fingerprints the current document;
2. rejects a well-formed but stale `expectedFingerprint` before applying a
   revision;
3. rejects duplicate or undeclared revisions, unknown expression IDs, existing
   IDs in `newAssets`, and new assets also named in `revisions`;
4. validates the combined proposed work before returning edits, retaining
   omitted expressions and all historical assets;
5. returns the updated document and its new fingerprint without writing a file;
6. records previous and new content versions, per-expression fingerprints and
   added assets, with whether each revision changed
   canonical document state;
7. reports every affected expression in document order. A changed expression
   carries all its new canonical bindings; an otherwise unchanged expression
   carries only bindings whose asset version changed;
8. treats a repeated identical revision as an idempotent no-op with no affected
   expressions.

For an expression-local source override, declare a new asset and rebind that
expression's intended slot to it in the same update. Other expressions retain
their shared source. A later shared-asset version update affects only expressions
still bound to that asset and preserves the local controls, sizes and binding.
The core does not infer equivalent assets or turn a local override into a shared
change. An invalid candidate returns no updated document. Reordered equivalent
bindings remain a no-op, and expression revision receipts follow document order.

Existing asset-only requests and their result fields retain their meaning.
Empty `addedAssets` and `expressionRevisions` fields are omitted. Input/output
types are generated for Web consumers; execution planning remains in the shared
core through the current CLI/MCP entry points.

The result schema is `worldbend.spatial-document-update-plan`. The full CLI
exposes `worldbend document-update-plan --spec <path> --json`; the compact Agent
catalog exposes `document_update_plan`. Planning does not assert that content
bytes exist, are compatible with a bound slot, or have already been delivered.

## Delivery planning

`plan_spatial_document_delivery` accepts the current document, an optional
`expectedFingerprint`, and an optional ordered-set request named
`expressionIds`. Omitting the selection compiles every expression. A supplied
selection must contain one to 32 unique declared expression identifiers.

The planner validates and fingerprints the document, rejects stale state, and
returns selected results in canonical document order rather than caller order:

- each `static` expression becomes a one-item, all-or-none `VariationJobSpec`
  whose item carries the expression identifier and canonical content bindings.
  Its delivery also retains optional guide dependencies, which are not raster
  inputs to that job;
- each `interactive` expression retains its validated `EffectRecipe`, canonical
  content/depth-map bindings, and canonical recipe fingerprint;
- each `temporal` expression retains its validated `MockupVideoSpec`, canonical
  content bindings for every plane `sourceId`, and the mockup-video plan
  fingerprint; carriers resolve assets and encode through existing
  mockup-video render operations;
- the result carries the document fingerprint that those execution inputs came
  from, so a carrier can retain provenance across the handoff.

The result schema is `worldbend.spatial-document-delivery-plan`. The full CLI
exposes `worldbend document-delivery-plan --spec <path> --json`; the compact
Agent catalog exposes `document_delivery_plan`. The Web effects entry exports
`attachDocumentEffect`, which consumes one interactive delivery and caller-bound
DOM/media resources without rebuilding the document's slot-to-asset mapping.
Its `DocumentEffectBinding.replaceAsset(assetId, source)` replaces every decoded
content or depth-map role bound to that durable asset ID. The carrier validates
the complete proposed media relationship before changing a slot, serializes
explicit replacements, and attempts to restore every already changed slot if a
renderer rejects the update. A failed replacement returns `false`, reports the
typed error, and leaves the last accepted document identity and recipe usable.
When the same asset fills both content and depth-map roles for one plane, those
roles may change dimensions together. The document binding exposes asset-level
replacement, not slot-level texture mutators that could bypass its accepted
asset relationship.
Decoded-media replacement does not itself revise `contentVersion` or the
document fingerprint. To keep a saved work current, plan the asset revision and
its new delivery through the core, then retain the revised document and delivery
identity when the carrier accepts the decoded source. A failed media replacement
must leave the prior document version accepted.

Decoded-media replacement does not capture or overwrite live DOM. When an
asset is bound to a version-1/2 live-DOM expression, the host changes that DOM
content through its own framework and retains the same element binding. A
depth-map replacement must continue to match its content source dimensions.
Media playback, decoding, URLs and bytes remain carrier-owned resources rather
than canonical document fields.

## Receiving a temporal document on Web

`@worldbend/web/spatial-document` exposes `planSpatialDocumentDelivery` through
full Web WASM and the ordinary Rust planner. It validates and fingerprints the
whole document before returning the selected expression's existing delivery.
The separate Figma profile does not include this full document planner.

`@worldbend/web/document-motion` supplies `attachDocumentMotion(host, document,
expressionId, assets, options)` for one temporal expression. The caller resolves
exactly its distinct content asset IDs to decoded media. Multiple source slots
can share an asset. The receiver delegates geometry, immutable snapshots,
clipping, framing, playback and device recovery to `attachMockupMotion`; it
retains the canonical video delivery and applies its explicit opaque final
matte after clipping and framing. It does not encode MP4 in the browser.

`revise(document, assets, guard, signal)` compiles a complete candidate through
the core and checks the instance, accepted document fingerprint and publication
revision. Invalid documents, missing media, stale proposals, cancellation and
failed preparation preserve the accepted work. Media and document identity
publish together before user callbacks observe the completed revision. The
latest local playhead and pause survive source changes and relative retiming.
Local seeking during preparation remains useful. Resource retirement, visibility,
reduced motion and context recovery stay owned by the motion receiver.

`getDocument` and `getDelivery` return independent saved snapshots; asset
content versions remain caller provenance, not an assertion that supplied
bytes have a verified digest. Host content, storage and media acquisition remain
host-owned. The Field Notes document example preserves its edition and timing
through page interruption and reopening. Independent built-package browser
checks compare the complete WASM plan with the native CLI, exercise actual
pixels and human input, stale/invalid/failed candidates, cancellation and late
retirement, reconstruction, final-matte removal and reduced-motion/mobile use.
After `pnpm build:web`, run `pnpm test:document-motion` for the ordinary
example, or pass `--web-root` and `--evidence` to its script for an independent
receiving directory. `--movie` verifies an already delivered four-second Field
Notes video through actual playback and seeking. This entry advances shared
temporal receiving; coordinated static/interactive/
material/temporal publication and portable native decoration remain open.

## Interactive media delivery bundle

`prepare_spatial_interactive_delivery` is the shared core constructor for one
accepted interactive Recipe, reference state, asset registry and exact role
bindings. It produces the same one-expression Spatial Document and ordinary
delivery plan for every adapter. `figma_effect_continuation` uses this
constructor rather than maintaining a Figma-specific document builder.
`prepare_spatial_temporal_delivery` is the corresponding constructor for one
accepted `MockupVideoSpec`, asset registry and exact plane-source bindings.

When another provider has already established encoded raster facts,
`prepare_spatial_interactive_media_bundle` adds a bounded delivery envelope:

- schema `worldbend.spatial-interactive-media-bundle`, version `0.1`;
- one version-3 interactive expression and its explicit initial state;
- 1..64 canonical media records with stable asset ID, PNG/JPEG/WebP format,
  lowercase SHA-256, encoded byte count and decoded width/height;
- the content-addressed Spatial Document, where each asset
  `contentVersion` is `sha256:<media hash>`; and
- the ordinary fingerprinted Spatial Document delivery plan.

The planner rejects missing, duplicate, extra or unbound media; invalid hashes;
non-canonical IDs; encoded media above 64 MiB; dimensions above 8192 per axis or
16,777,216 pixels; invalid initial state; and a non-version-3 Recipe. Input
order does not change the bundle or document identity. It reads no path, URL or
bytes, decodes nothing and writes nothing. The upstream provider remains
responsible for truthfully establishing the supplied media facts.

The full CLI exposes
`worldbend interactive-media-bundle-plan --spec <path> --json`; the compact
Agent catalog exposes `interactive_media_bundle_plan`. On Web,
`attachSpatialInteractiveMediaBundle` verifies the bundle's cross-links and
complete host-element set before calling `resolveAsset` exactly once per
canonical media record. It then requires each decoded source to match the
declared dimensions before delegating to `attachDocumentEffect`. A malformed
bundle, resolver failure or dimension mismatch occurs before element ownership
changes, so a previously accepted binding remains usable.

This bundle is the deterministic provider result that an orchestration Procedure can
consume. Procedure selection, upstream design inspection/export, destination
page editing and deployment are orchestration responsibilities outside
Worldbend. A Procedure may run without a human approval stage; this contract
neither introduces nor requires one.

Delivery planning reads no resource path, URL, bytes or DOM node and writes no
output. A static job is executed by the existing Variation renderer. An
interactive delivery is executed by a carrier that supports its recipe. A
temporal delivery is executed by the existing mockup-video renderer after the
carrier resolves each bound asset to a raster path. The ready-scene temporal brief
proves that loop with durable ready-scene rasters: document inspect,
asset `contentVersion` revision, delivery projection, and regenerated stills+MP4
under the same mockup-video Spec fingerprint. Figma `projectTemporal` / temporal
`revise` continue this write target: complete motion returns to the
Composition inspector, including whole Transform/named framing when present.
The document keeps encoded delivery; the host task keeps editable motion.

## Execution and carrier boundary

Version `0.1` does not add `document-render`. Static delivery continues through
Spatial Template / Variation Job operations. Interactive delivery continues
through Effect Recipe / Effect Plan and the carrier that declares support.
Temporal delivery continues through mockup-video inspect/render. The document
delivery planner now performs the exact projection into those contracts; a
document-aware carrier resolves local resources and dispatches each compiled
expression.

This separation preserves one canonical contract per execution boundary:

- the document owns durable work identity and relationships;
- update planning owns stale detection and cross-expression impact discovery;
- delivery planning owns deterministic selection and execution projection;
- the existing core operations own their precise geometry and rendering
  semantics;
- carriers own local resource resolution and publication authority;
- carrier profiles remain honest about which expression kinds they can deliver.

The repository is still a source superset, not one universal binary.

## Intelligent authoring and deterministic acceptance

The deterministic core is an execution boundary, not the authoring ceiling.
Visual selection, direct manipulation, perception providers and generative
assistance may propose assets, bindings, composition or parameters. A person or
authorized Agent accepts those proposals into explicit versioned document data
before deterministic inspection and execution. Provenance and uncertainty must
remain visible where they affect later edits.

## Evolution rule

Extend the document when a real workflow needs state to survive across multiple
capabilities or deliveries. Prefer a typed addition whose meaning can be
inspected, migrated and projected over an opaque generic node graph. This is an
engineering rule for coherent growth. Layers, scenes, animation, richer
deformation, generation and 2D/3D relationships require their own typed semantics.

Versioned additions must preserve the distinction between:

- product territory — the complete spatial-visual work users are trying to
  create and keep useful;
- canonical document meaning — shared durable state;
- execution primitives — exact deterministic operations;
- carrier projections — current supported subsets and disclosed loss;
- reference cases — evidence that the system is useful, never the product
  identity by themselves.
