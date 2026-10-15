# Personal intent over typed materials

`material_preference` evaluates Texture, Foil and mesh-gradient consumer intent
over their existing delivery inputs. Their materials, validation, resources and
target implementations remain the owning family contracts. Glass continues
through its existing appearance preference contract; this addition does not put
unrelated families into Glass fields.

An input names `family`, `source`, `policy`, `preference` and `runtime`. Each
family branch has its own typed source and field enum. Values explicitly declare
`toggle`, `number`, `rgba` or `hex-color`; wrong field/value combinations reject.
RGBA is encoded sRGB plus coverage in `[0,1]`, while Texture grain tint remains
its existing `#rrggbb` field. Unknown properties, invalid saved values, mismatched
recipe identities and product scopes reject, including values currently hidden
by policy. The progressive MCP operation plans only; it does not store or apply
a user's preference.

A `worldbend.material-policy@0.1` policy names a receiver-owned policy ID,
revision, distinct scopes and typed exposed controls. A scalar control can narrow
its allowed min/max within the family's authored range. Toggles and colors do
not accept scalar bounds. The policy may expose no controls. Revisions are
positive safe integers; scopes and IDs are bounded nonempty strings and scopes
are unique. Policy, source and preference identities remain separate.

A `worldbend.material-preference@0.1` record names a scope, recipe ID, revision
and typed field map. Every override retains its actor (`user` or `agent`), value
and explicit intent even when equal to the current design default. Revision 0
represents an empty initial record; a nonempty record requires revision ≥1.
Empty records after reset retain a later ordering token. Revisions are bounded
to the exact JavaScript integer range for cross-target receiving. The product
owns user/account storage and associates records with the appropriate account;
the Worldbend scope is a role/instance boundary, not account authentication.

Evaluation validates all saved intent, then applies policy-allowed overrides to
the current source material and calls the existing canonical family delivery.
Hidden overrides receive `not-exposed`; overrides outside a newly narrowed
policy receive `out-of-range`. Both stay in the record and can resume when policy
permits them again. Neither is silently erased or clamped into a new preference.
The result contains the canonical delivery, source/policy/preference identities,
ordering tokens and per-field receipts.

Each control reports authored range, product-permitted `effectiveRange`, target
logical `targetRange`/`targetValue`, default/current authored value, unit,
direction and live change cost. These are different facts: Texture etch accepts
authored values through 1000 logical pixels, while its existing Web mapping
saturates above 100. The control retains that distinction alongside the family's
existing delivery fidelity/range receipts. Foil and mesh uniforms retain their
own authored ranges. Supported but policy-hidden controls report `not-exposed`;
an unavailable renderer or paused/reduced motion reports `adapted`. Runtime
adaptation does not rewrite saved timing or color. Target combinations outside
the family's typed delivery contract reject instead of advertising a fake setter.

## Web receiving

`@worldbend/web/material-preference` supplies `attachMaterialPreference` over one
existing surface. The binding initializes the built WASM core and evaluates
proposals locally; it has no handwritten preference or delivery formula and no
per-frame model/MCP/WASM calls. Existing Texture/Foil/mesh bindings still own
their actual rendering, clock, content retention and resource disposal.

`getState()` separates accepted `input`/`output` from a pending `preview` and
reports actual renderer status. Its guard includes source, policy and preference
identities/revisions, scope, runtime and a draft revision. Human preview activity
invalidates an earlier Agent guard even before commit. Multiple control previews
compose into one draft; applying commits that draft once. Cancelling restores
the latest accepted output. An immediate `commit` owns its specified changes,
rather than silently committing someone else's draft. Invalid or stale proposals
leave accepted state unchanged.

`revise` accepts the same recipe, target and policy identity, requiring a newer
policy revision for changed policy content. It re-evaluates saved intent over
the new design, clears obsolete previews and retains the current renderer clock.
Mesh resource upgrades remain explicit source revisions; personal fields cannot
silently select another renderer. `setRuntime` updates actual product-reported
availability and motion without changing personal intent. `reset` removes saved
overrides and follows the current design, including hidden overrides.

`exportPreference` serializes a small versioned family/record envelope, not shader
resources. `restorePreference` checks its original version, family, scope, recipe,
types and revision before rebasing the active receiver's monotonic ordering token.
It accepts at most 16 KiB. The product persists that record after successful
actions and reports storage failure honestly. A successful local material commit
alone does not prove durable storage or account migration. Abort/disposal retires
owned attachments and late acquisition without replacing host content/actions.

The [personal materials example](../packages/web/examples/material-preferences/README.md)
demonstrates direct no-Figma receiving. A native-derived family delivery input
uses the same entry and evaluator. Current independent Chromium/WebGPU checks
cover all three families, exact source-MCP/WASM plan parity, actual GPU changes,
explicit-default retention, stale Agent rejection, composed preview, policy
hide/restore, scope rejection, cancel/reset, cold restoration, ordinary controls,
storage failure/retry and rapid family cancellation.

## Native Swift receiving

`WorldbendFoilPreferenceSession` / `WorldbendMeshGradientPreferenceSession`
implement the same explicit intent, exposed/narrowed policy, composed drafts,
guarded continuation and bounded portable record over pinned `swiftui` source
deliveries. The native field mapping, value types, authored ranges, units,
direction and motion flags are generated from the core. Canonical parity
fixtures cover both families and frozen v1 mesh. The native receiver validates
the existing material type and uses its pinned Metal renderer; it preserves the
trusted source identity rather than fabricating a new canonical delivery hash.
The native guard is a receiver-local instance/generation token, not a substitute
for the source core fingerprint.

The surface applies product motion, actual system reduced motion, visibility
and renderer availability to its existing clock. Failures suspend rendering
without erasing preferences; explicit retry rebuilds the surface. Saved intent
can be restored independently of shader resources. The independent native host
demonstrates title/content, source-default revision, explicit-default retention,
preview/cancel/apply, removal/restore and host-owned asynchronous file storage.
Storage success and material success have separate feedback. A late file read
does not overwrite intervening edits; invalid records retain the working state.

Current evidence includes canonical parity and actual macOS Metal/state tests,
macOS human save/reopen and failure recovery, plus an iOS 17 Simulator build.
Account storage and product integration are responsibilities of the receiving host.
