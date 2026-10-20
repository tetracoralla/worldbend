# Mesh-gradient / soft fluid light material and receiving contract

`worldbend.mesh-gradient@0.1` describes a soft four-corner mesh gradient with
editable loop timing (`durationMs`, `phaseMs`), fluid domain warp, softness,
flow speed and visibility. It generates its own surface; it does not sample the
containing scene. Soft fluid light is the visual character of this family, not a
second kernel.

The canonical implementation is `crates/worldbend-core/src/mesh_gradient.wgsl`,
identified as `worldbend.mesh-gradient.rgba@0.2`. A closed orbit joins both the
field and its velocity at each duration boundary, including non-integer flow
energy and independent phase. Warp zero keeps a static
bilinear mesh. Flow speed zero freezes the fluid field inside the loop.
Visibility false emits transparent black. Duration accepts 100–60000 ms, phase
0–60000 ms, warp/softness 0–1, flow speed 0–2, and RGBA channels 0–1; all numbers
must be finite.

Color interpolation premultiplies encoded-sRGB tints, mixes color and coverage,
then returns the host's required alpha convention. Native Shader fills receive
straight RGBA; the Web canvas receives premultiplied RGBA. Frame time is
milliseconds. Hosts own shape coverage, color management and compositing;
sharing a kernel does not establish identical exported pixels across hosts.

## Seed, current values and revisions

`MeshGradientDeliveryInput.kernelProfile` selects the immutable renderer:
`worldbend.mesh-gradient.rgba@0.2` is the default for new direct deliveries;
`worldbend.mesh-gradient.rgba@0.1` retains earlier linear-noise motion and its
loop reset. Frozen WGSL, Metal and native Shader source preserve exact v1 hashes.
Delivery fingerprints bind the selected profile and source hash. Typed document
serialization retains the selected profile explicitly, so a change requires
fresh document inspection.

An explicit core source update can move v1 to v2 while preserving local RGBA,
phase, removal and source/local conflict checks. Web receivers prepare the two
known pipeline/layout pairs on one device and switch the complete pair without
resetting time, pause or content. Local tuning cannot change the renderer. Swift
receivers validate each pinned source and rebuild its rendering surface on an
explicit profile change, retaining the material session and clock.

Native reads still admit exact v1 account-source evidence and do not adopt v2.
Projecting actual v1 state retains v1 unless the caller explicitly chooses a
different profile. Revising controls back into Figma requires the document and
native renderer to agree; use explicit resource adoption before a profile change.
The v2 source is prepared locally; its account build/adoption and rendered Figma
acceptance remain unverified.

A `MeshGradientRecipeSpec` carries schema/version, `recipeId`, positive
`recipeVersion` and seed material. Current values are separate.
`mesh_gradient_inspect` reconciles captured values against the seed and returns
tagged, customized, untagged-native, removed or absent state. Inspection and
revision require an explicit `live` value or null. Acquisition failure must not
become null/removal.

Known native float32 storage roundtrips are accepted as seed values. A newer
seed requires the same recipe identity and a higher version. Native removal stays
removed until an explicit reapplication.

`mesh_gradient_delivery` produces the resolved material plus a self-contained
shader resource, immutable profile identity, SHA-256 integrity value and 128-byte
uniform layout. Its fingerprint binds seed identity, material, target and kernel
identity and hash. A receiving project needs no Figma account asset or network
fetch. The generated native source and Web resource identity come from the
canonical kernel through `scripts/generate-mesh-gradient-kernel.mjs`.

`target:"web"` carries WGSL; `target:"swiftui"` carries generated Metal 2.4
from the same WGSL through pinned Naga30.0.1. Target/source hashes stay distinct.
The Swift receiver verifies source bytes against package pins before compiling,
and supplies the same timing, RGBA, warp and softness uniforms. Its independent
surface clocks pause for visibility and reduced motion without changing authored
values. Shared source updates preserve local color/phase fields and removal,
with source and current-local receipt guards. See
[native receiving](../packages/swiftui/PROCEDURAL_MATERIALS.md) and the
[independent host](../examples/ios-procedural-materials/README.md).

`mesh_gradient_update` merges a later source delivery against the accepted source
and current destination material. It rejects an outdated expected source
fingerprint, foreign recipe/target, seed rollback or an unversioned seed change.
Local fields survive; unchanged fields advance to the source. Null preserves
local removal.

## Independent Web receiving

`@worldbend/web/mesh-gradient` exports `attachMeshGradient`;
`@worldbend/web/mesh-gradient-receiving` exports `attachMeshGradientGroup`.
Attachments validate before changing the host and verify the delivered source
against the binding's pinned hash before compiling it. Each surface owns its
clock and buffers. Pause, seek, host visibility and reduced motion do not rewrite
material provenance or source receipts. Motion pauses offscreen and while the
document is hidden, without a catch-up jump. Flow speed zero does not keep an
animation loop running. Distinct surfaces may carry different `phaseMs` or
independent elapsed time so instances stay independent.

The noninteractive, accessibility-hidden canvas sits behind existing content.
Disposal cancels observers/listeners/frames, frees buffers, and destroys only an
owned device. A supplied device remains host-owned.

## Native Agent preparation

`figma_mesh_gradient` prepares resource-state/acquisition, exact paged native
reads, selective edits, recipe choice, explicit adoption and removal. Its
caller supplies the exact `get_shader` id, build version and `main.ts` source;
the shared Shader evidence guard verifies supported source bytes and retains
only compact integrity/identity evidence in the executable request. Native
paint identity comes from actual capture or acquisition, not the import id.
Material and field validation remain owned by this typed family.

Preparation does not contact Figma or change a file. The permitted Figma
executor runs the returned request; read parts carry a whole-state token and
edits use the current native `expectedState`. Edits preserve unselected values,
other fills/effects and the accepted renderer. Acquiring an available renderer
does not adopt it. A removed material stays removed until an explicit choice.
Reads and writes use the same native implementation as the designer surface.

## Honest non-claims

Product acquire, explicit adopt and the common chooser are wired Foil-parallel:
a hidden probe imports a caller-supplied `{importId, sourceSha256}`,
the node record `worldbend.mesh-gradient-resources@0.1` stays separate from the
accepted renderer, stale `expectedState` refuses the write, selective RGBA
edits keep other fills and effects, and the chooser offers three builtin
recipes with trial, apply and saved variations. `worldbend.mesh-gradient.legacy@0.1`
is a reserved non-current
source class (the hash of the literal
`worldbend.mesh-gradient.legacy-source@0.1`), not an account or import id, so
adopt/remap can be tested; unknown hashes are refused. Product source does not
embed caller resource ids. This contract does not establish Figma
Community publication, installed Rust MCP availability, physical-iPhone visual
or performance acceptance, Paper MeshGradient parameter parity, or Foil/Glass family equivalence.
Live host behavior requires its own receiving verification. This contract does
not claim parameter or rendering equivalence with another mesh-gradient family;
Worldbend owns the kernel defined here.
