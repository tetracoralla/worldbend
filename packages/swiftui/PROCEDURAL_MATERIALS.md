# Foil and soft fluid-light surfaces

`WorldbendFoilSession` and `WorldbendMeshGradientSession` receive canonical
`foil_delivery` / `mesh_gradient_delivery` values with `target: "swiftui"`.
The target carries self-contained Metal source, a SHA-256 integrity value and
the existing 96/128-byte uniform layout. The package verifies that source
against its pinned implementation before compilation. No Figma resource,
account access or network fetch is required.

```swift
let initial = try AppearanceReceipt.decode(WorldbendFoilDelivery.self, from: data)
let session = try WorldbendFoilSession(initial) // retain at the owning view
let clock = WorldbendMaterialClock()          // one per visible surface

Button("Save", action: save)
    .padding(24)
    .background {
        WorldbendMaterialSurface(session, clock: clock, onError: reportError)
            .clipShape(RoundedRectangle(cornerRadius: 24))
    }

clock.setPaused(true)
try session.updateLocal(localDelivery)       // same accepted seed
try session.update(updatePlan, source: nextSourceDelivery)
```

Each surface's default clock is independent. A product may explicitly supply
a shared clock when synchronization is intended. Pausing, hidden/inactive
scenes, disappearance and OS reduced motion freeze elapsed time without a
catch-up interval. Static materials stop the animation schedule. Changing
material or source receipts does not reset the clock. The host owns persisted
time, navigation visibility, clipping and any control policy.

`preview(material)` renders validated local values without altering committed
receipts; `cancelPreview()` returns to the committed material. A source update
while a preview is active refuses the write, so a host can explicitly resolve
that draft. Committing uses a fresh canonical local delivery. Local color
overrides preserve the whole RGBA field. A source update checks both accepted
source and current local fingerprints. Removal stays removed across updates;
`reattach(source)` is explicit and separate.

Mesh-gradient v2 joins the loop continuously. Exact v1 receipts still validate
and render their original algorithm; a package upgrade does not replace them.
Choose `kernelProfile:"worldbend.mesh-gradient.rgba@0.2"` in an explicit core
source revision to upgrade. Local tuning keeps the accepted renderer, while a
source profile revision retains the surface clock and rebuilds its pinned Metal
pipeline. The recipe/control schema remains `worldbend.mesh-gradient@0.1`.

The background is accessibility-hidden and ignores pointer input. Existing
content, focus order and actions remain host-owned. A render failure invokes
`onError` once and stops scheduling; the host can present recovery, then remount
that surface with the same session and clock. Removal/reattachment remounts its
rendering view. A supplied Metal device remains caller-owned. Buffers, library,
pipeline and queue are released with the surface/renderer.

`WorldbendMaterialRenderer.draw` also supports offscreen textures and FrameHub
integration. Register its `completion` callback before submission through that
method; the returned command is already committed. Publish a texture to another
consumer only after actual GPU completion. Output is premultiplied encoded sRGB
in RGBA8/BGRA8 unorm. The SwiftUI host sets its Metal layer to sRGB; this is not
an environmental reflection or a reconstruction of Apple's private optics.
The default surface backing budget is 16,777,216 pixels and scale follows DPR
up to 2; these are receiver resource defaults, not authored-material limits.

The canonical algorithms remain the core WGSL files. Naga 30.0.1 (MIT/Apache-2.0)
validates and translates them to Metal 2.4 through
`cargo run --locked -p worldbend-core --example generate-material-metal`.
Generated core/Swift copies and source pins are checked by `pnpm contract:check`.
`pnpm material:native:check` verifies canonical update fixtures and real Metal
rendering. The independent receiving example is under
`examples/ios-procedural-materials`.

## Personal material intent

`WorldbendFoilPreferenceSession` and `WorldbendMeshGradientPreferenceSession`
receive a pinned `swiftui` delivery, `WorldbendMaterialExposurePolicy` and a
product scope. Pass that session to the same `WorldbendMaterialSurface`.
The host exposes controls from `controls`, and calls guarded `preview`,
`applyPreview`, `cancelPreview`, `commit`, `reset` and `updateSource`.

```swift
let session = try WorldbendFoilPreferenceSession(delivery,
    policy: .init(policyId: "cover", scopes: ["book-cover"],
                  exposed: [.init("roughness", min: 0, max: 1), .init("base-color")]),
    scope: "book-cover")
try session.commit(["roughness": .number(0.55)], guard: session.guardToken)
let saved = try session.exportPreference() // product owns durable storage
```

An explicit choice stays explicit even if it equals today's design default.
Later source revisions reapply permitted intent; hidden and narrowed values
remain saved with `not-exposed` / `out-of-range` receipts. Human drafts invalidate
older Agent guards. Preview changes compose without changing the accepted
record; cancel returns to the current committed material. Removal stays removed
through updates until explicit `reattach`. Product motion and OS reduced motion
freeze the existing clock without altering saved intent. A failed renderer
reports unavailable; `retryRenderer` rebuilds its surface with the same clock.

Native field mappings, types, ranges and motion classifications are generated
from the core. Canonical fixtures compare both native families, including the
frozen v1 mesh, against core evaluation. The native session applies these fields
to the pinned renderer's validated material; it does not mint a new core delivery
or shader fingerprint. Its guard is receiver-local, separate from core identity.
`exportPreference` / `restorePreference` use the same 16 KiB versioned family,
scope and recipe-bound record as Web. Account association and file writes remain
product-owned. `pnpm material:preference:native:check` checks generated rules,
canonical fixtures and native state/Metal tests.

Current evidence includes native macOS GPU rendering, source revision/removal,
pause/visibility clocks, the macOS human example and an iOS 17 deployment-target
build for arm64/x86_64 Simulator. This does not establish physical-iPhone visual
or performance acceptance, cross-host pixel identity, native Splay, Community
publication or an installed Agent client.
