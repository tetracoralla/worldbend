# Foil material and receiving contract

`worldbend.foil@0.1` describes a procedural reflective pattern with editable
RGBA base/highlight tints, light direction, highlight intensity, roughness,
flow speed and visibility. It generates its own surface; it does not sample
the containing scene or simulate physical environment reflections.

The canonical implementation is `crates/worldbend-core/src/foil.wgsl`, identified
as `worldbend.foil.rgba@0.1`. Broad reflective faces meet narrow fold glints.
Roughness bends the folds and broadens their glints. Intensity zero leaves the
base tint, speed zero stops the field, and visibility false emits transparent
black. Light direction accepts 0–360 degrees, intensity/roughness accept 0–1,
speed accepts 0–2, and RGBA channels accept 0–1; all numbers must be finite.

Color interpolation premultiplies encoded-sRGB tints, mixes color and coverage,
then returns the host's required alpha convention. A transparent highlight
changes coverage without contributing its hidden tint. Native Shader fills
receive straight RGBA; the Web canvas receives premultiplied RGBA. Frame time
is milliseconds, converted to seconds once before applying flow speed. Hosts
own shape coverage, color management and compositing; sharing a kernel does
not establish identical exported pixels across hosts.

## Seed, current values and revisions

A `FoilRecipeSpec` carries schema/version, `recipeId`, positive `recipeVersion`
and seed material. Current values are separate. `foil_inspect` reconciles
captured values against the seed and returns tagged, customized, untagged-native,
removed or absent state. It accepts captured values; it does not read a Figma
file or attest that an arbitrary Shader implements this profile. Both inspection
and revision require an explicit `live` value or null. Acquisition failure must
not become null/removal.

Known native float32 storage roundtrips are accepted as seed values, without a
general epsilon that hides small edits. A color is one editable field: changing
any channel preserves the whole local tint during a seed upgrade. A newer seed
requires the same recipe identity and a higher version. Native removal stays
removed until an explicit reapplication.

`foil_delivery` produces the resolved material plus a self-contained shader
resource, immutable profile identity, SHA-256 integrity value and 96-byte uniform
layout. Its fingerprint binds seed identity, material, target and kernel identity
and hash. A receiving project needs no Figma account asset or network fetch.
The generated native source and Web resource identity come from the canonical
kernel through `scripts/generate-foil-kernel.mjs`.

`target:"web"` carries that WGSL source; `target:"swiftui"` carries generated
Metal 2.4 from the same WGSL through pinned Naga30.0.1, with distinct source
hash and target fingerprint. `generate-material-metal` validates and generates
the core/Swift copies plus immutable receiver pins. No separate handwritten
material algorithm enters the native target. The Swift receiver checks the
target, material fields and actual source hash before Metal compilation; live
changes update uniforms. Its session preserves local RGBA fields, explicit
removal and source/local conflict guards, while surface clocks handle pause,
visibility and reduced motion separately. Read
[native receiving](../packages/swiftui/PROCEDURAL_MATERIALS.md) and the
[independent host](../examples/ios-procedural-materials/README.md).

`foil_update` merges a later source delivery against the accepted source and
current destination material. It rejects an outdated expected source fingerprint,
foreign recipe/target, seed rollback or an unversioned seed change. Local fields
survive; unchanged fields advance to the source. Null preserves local removal.
The plan separately carries previous source, previous local delivery and new
source fingerprints, so a receiver also rejects planning that predates a local
edit. Native property edits do not require a seed version increment.

## Independent Web receiving

`@worldbend/web/foil` exports `attachFoil`; `@worldbend/web/foil-receiving` exports
`attachFoilGroup`. Attachments validate before changing the host and verify the
delivered source against the binding's pinned hash before compiling it. Each
surface owns its clock and buffers. Pause, seek, host visibility and reduced
motion do not rewrite material provenance or source receipts. Motion pauses
offscreen and while the document is hidden, without a catch-up jump. Speed zero
does not keep an animation loop running.

The noninteractive, accessibility-hidden canvas sits behind existing content.
The binding retains content nodes, handlers, focus order, layout and host edits.
If a stylesheet prevents the necessary positioning/isolation, attachment fails
and restores its own changes. Disposal cancels observers/listeners/frames, frees
buffers, and destroys only an owned device. Cancellation during acquisition also
destroys a device that arrives after the cancellation. A supplied device remains
host-owned; replacing a lost supplied device requires explicit reattachment.
For an owned lost device, `recover()` reacquires it while retaining material,
elapsed time and pause state. Device loss and recovery failure remain observable.

Backing-store scale defaults to DPR up to 2 with a 16,777,216-pixel budget per
surface; receiving projects may set `pixelRatio` and `maxPixels`. Device limits
still apply, and `getState()` reports actual rendered dimensions. These are
rendering resource defaults, not limits on authored material or artwork size.

The group binding retains transient pause/visibility through revisions, checks
both source and local receipts before mutation, and retains explicit local
removal. Group cancellation disposes every surface. A removed group requires
explicit reattachment to restore its material.

## Native adoption and current evidence boundary

The legacy Figma renderer has the same seven property names,
but its kernel ignored highlight opacity and used a different pattern. Opening,
copying or inspecting it must not silently replace its renderer with this profile.
Adopting the corrected renderer is an explicit material revision with a new
exact build identity. The repository's Shader source is prepared; changing the
account resource is separate from this local implementation. Guarded native
read/edit binding now captures actual assignments by property-definition ID,
including variable aliases resolved in the surface's mode. RGB values use the
API's opaque alpha; invalid or unavailable values fail acquisition. Paint opacity,
visibility and blend mode are separate composition state, retained during edits.
Stacked matching Foil fills require an explicit paint slot.

`figma_foil` prepares these reads and edits. Supply exact `get_shader` id/version,
`mainSource`, and the paint identity observed in the native file. Source bytes
must match the current entry point or supported prototype. This checks supplied
evidence, without contacting or attesting account access. Import/paint aliases
are declared from actual evidence; they are never inferred from names or build
suffixes. The native read itself imports no resource and replaces no renderer.
Read `operation.action="read"`; retain `expectedState` from the exact paged result
for `operation.action="edit"`. Continue large reads with all parts and their token.

`operation.action="resources"` reads retained/available resource state and the
guard for `operation.action="acquire"`. Acquisition imports an existing exact
build when necessary, then uses an owned temporary native paint to observe its
actual paint identity. The probe is removed on success or failure. Availability
is retained on the surface separately from its accepted renderer; acquisition
changes no artwork, seed or current values. Its resource record survives native
copy. A damaged record is reported; explicit reacquisition with `repairRecord`
can replace that record while retaining artwork. An imported build may remain
available in the file if a later acquisition step fails; acquisition does not
build, commit or deploy account Shader source.

`change.action="adopt"` supplies the old captured state, the acquired current
renderer and an explicit new recipe/current material. Adoption remaps property
definition IDs by their declared names/types, preserves aliases for unchanged
resolved values, writes explicit edits as literals and retains paint composition
and other fills/effects. Unknown extra assignments which cannot survive the new
build are refused before mutation. Fills, seed and resource acceptance roll back
together on failure. Merely copying, opening or acquiring never adopts a build.

Selective edits write only declared fields, retaining unselected variable aliases,
extra Shader properties, other fills/effects, composition and existing seed
provenance. Editing a bound field explicitly replaces that assignment with the
chosen literal value. Before any write, guards compare native state and current
resolved variable values, including changes which leave alias assignments intact.
Selection edits preflight every target and roll back the whole selection on a
setter failure; unrecovered target identities remain observable. Removed paints
retain their seed record. Choosing a seed requires the current renderer; the
prototype can be read and edited with its existing visual semantics, but cannot
silently adopt the new profile. A successful mutation returns a receipt and asks
for a fresh read, rather than turning a later read failure into a failed write.

This native profile has resource IDs and fill-array positions, with no persistent
per-paint instance identity. A per-surface seed cannot reliably distinguish
separate stacked recipes after native reordering. Explicit slots remain readable
and selectively editable, but ambiguous stacks do not inherit a guessed seed and
cannot be reseeded/adopted through this binding. Separate surfaces preserve
independent seed identities. This carrier condition does not limit the core's
material instances or other hosts' representations.

The common material chooser includes Foil presets, saved variations, selective
controls, context trials and removal. RGB and opacity controls preserve each
target's untouched color channels independently; saved recipes own complete
RGBA values. Mixed selections do not silently become one default look. Request
local metadata caching retains per-node variable resolution and write-edge
freshness checks. Context copies retain inherited variable modes; cancellation
while acquiring a mode or material cannot revive a retired trial.

The panel distinguishes unavailable or unverified resources, legacy rendering
and the current profile. Legacy looks remain editable; current presets and
saved current-profile recipes require the current renderer. When a source-checked
current resource is acquired, explicit renderer adoption first produces a trial
and remains subject to the same native transaction guards. An untagged look is
presented as Foil rather than inheriting a preset name.

Resource availability is specific to the Figma file and account. This source
contract does not install or publish a Community resource. A receiving target
must use a compatible implementation and disclose its rendering limits.
