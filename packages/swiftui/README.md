# Worldbend native material receiving

Add this local Swift package to an iOS 17+/macOS 14+ project. It applies canonical
core receipts to existing SwiftUI controls. `swiftui-optical` is the parameterized
Metal renderer. `swiftui` is the separate Apple system-material route, requiring
iOS/macOS 26. It has no registry dependencies. Export a pinned standalone source
package with `node scripts/export-swiftui-package.mjs --output <empty-folder>`;
its receipt hashes every source/resource and discloses the base revision and
uncommitted source state. This does not publish or install anything.

Build the rendering host with Xcode so the package's Metal resource becomes
`default.metallib`. `OpticalGlassRuntime.hasCompiledShader` exposes that concrete
prerequisite. Plain command-line `swift test` copies the source and validates
Swift contracts but does not establish shader availability; a CLI-only macOS
host must compile/bundle the Metal library or explicitly retain its system route.

## Fixed dynamic work receiving

`WorldbendRasterWorkSession` executes a fixed frame projection of an ordinary
Scene3D document through the same `WorldbendFrameHub`. The host supplies a local
package directory, a manifest SHA256 from its fixed delivery receipt and layout
in logical points. It never recalculates scene geometry or authored sampling.

```swift
let hub = WorldbendFrameHub()
let work = WorldbendRasterWorkSession(hub: hub,
    logicalSize: CGSize(width: 390, height: 292.5),
    contentRect: CGRect(x: 0, y: 0, width: 390, height: 292.5))
try await work.receive(root: fixedWorkDirectory,
    expectedManifestSHA256: fixedReceipt.manifestSHA256,
    expectedGuard: work.guardValue)
try work.play()
try await work.seek(milliseconds: 1200)
work.setActive(false) // freeze elapsed time during background/hidden state
work.setActive(true)
work.stop() // clear only this producer's publication; retain work for reset
try await work.reset()
work.destroy() // release the work and retire pending publication
```

Package preparation and PNG decoding run off the main actor, with one decoder
at a time per receiver and a two-frame cache. Accepted pixels survive preparation
and failed replacement. A later source retains normalized viewing time and play
intent; play at the end replays. Cancellation returns promptly even when ImageIO
is finishing synchronous decoding; a retired result cannot publish. Another
producer's FrameHub revision blocks later seek/play publication until the host
explicitly receives again with the latest guard. Valid layout changes during
receiving/seek use the latest geometry without restarting the source operation.

The version0.1 package includes core-produced timestamps/receipt, hashed PNGs,
the ordinary document/plan and source assets. Generate it with
`scripts/package-raster-work.mjs` from actual `renderSceneFrames` output.
Every later frame read rechecks bytes. Native receiving bounds individual files
to64MiB, the whole package to512MiB, frames to240 and decoded dimensions to8192
per axis/16 megapixels; these are current carrier bounds, not product ceilings.
It refuses traversal, symlink entries and non-regular files. Pinning detects
changes to trusted delivery bytes; it does not authenticate an arbitrary author.

Pixels publish only after PNG decode, sRGB conversion and premultiplied-BGRA8
CVPixelBuffer writing finish. The existing Metal binding can wrap that completed
buffer; the preceding CPU decode/upload is not zero-copy. The SwiftUI host still
materializes one shared CGImage per revision. iOS target rendering and App
composition need their own validation. See [scene contract](../../docs/SCENE3D_CONTRACT.md#native-fixed-frame-projection)
and [receiving example](../../examples/native-raster-work/README.md). Camera,
material and print edits require rebaking the retained source; this route is
not realtime3D, seeded particles or event-history simulation. App owns eligibility,
audio, preferences, lifecycle/visibility and business actions.

```swift
import WorldbendAppearance

let initial = try AppearanceReceipt.decode(AppearanceDelivery.self, from: data)
let material = AppearanceSession(initial) // retain in @State at the owning view

// For a swiftui-optical receipt, separate presentation from real controls:
WorldbendOpticalScene(backdrop: { artwork }) { backdrop in
    Button("Save", action: save)
        .padding(16)
        .background {
            WorldbendOpticalPane(backdrop: backdrop,
                optics: material.opticalConfiguration, cornerRadius: 28,
                tint: .black.opacity(0.05), opaqueFill: .gray)
        }
        .contentShape(RoundedRectangle(cornerRadius: 28))
}

try material.update(updatePlan, source: newSourceDelivery)
```

Use one session for surfaces sharing one material. The modifier keeps the
content's view identity when visibility changes or material is removed.
The host retains layout, shape, input, business handlers and accessibility
policy. The optical route genuinely changes backdrop blur, rim refraction,
thickness, color separation and directional highlights; coefficient compilation
belongs to core, not the App. Per-field fidelity says `approximated`: this is not
Figma pixel equivalence or Apple's private optics. Native Splay, arbitrary
outlines and environmental reflection are not supported by this profile.
## Real-time GPU completed-frame producer

`WorldbendMetalFrameProducer` connects host-authored GPU pixels to the same
FrameHub. It allocates fresh immutable target textures, registers completion
before committing, and publishes only successfully completed GPU work. Host
encoding, absolute-time sampling, physical-pixel layout and business eligibility
stay in the receiving product.

```swift
let producer = try WorldbendMetalFrameProducer(hub: hub, device: device)
let source = WorldbendFrameResourceIdentity(workID: "my-work",
    contentVersion: fixedSourceSHA256)
try producer.configure(source: source, expectedGuard: producer.guardValue)
let descriptor = WorldbendFrameDescriptor(frameID: hub.makeFrameID(),
    logicalSize: hostSize, contentRect: artworkRect,
    pixelWidth: nativePixelWidth, pixelHeight: nativePixelHeight,
    colorSpace: .sRGB, pixelFormat: .bgra8Unorm,
    presentationTime: .seconds(absoluteWorkTime),
    resourceIdentity: source, alphaMode: .premultiplied)
try producer.submit(descriptor: descriptor) { command, freshTarget in
    // Encode the host's source into freshTarget. Do not commit or later rewrite it.
}
// Display with the existing WorldbendOpticalMetalFrameScene / Metal panes.
producer.stop()
producer.destroy()
```

Stop/dispose/source replacement fences old completions, including reentrant
changes during CPU encoding. External hub takeover prevents later publication
or withdrawal; a latest-guard configure is an explicit host handoff. Failed
encoding retains accepted pixels and can be retried. One command is in flight.
Actual weak texture lifetime includes bindings and outstanding GPU consumers;
ended access objects or retained textures may therefore still consume capacity.
Default bounds are6 live textures/128MiB allocation bytes,8192 axes/16 megapixels.
Backpressure returns a dropped submission; absolute time avoids replaying a
queue of obsolete frames. The host never frees/rewrites a borrowed output.

This producer's current profile accepts encoded sRGB, opaque/premultiplied alpha
and BGRA8 or extended encoded-rangeRGBA16Float. Float carrier values above1 are
retained. Existing optical surfaces remain8-bitSDR and clip extended range;
there is no hidden tone map, linear-light conversion or EDR claim. Existing
P3 carriers remain separate; a P3/linear producer needs its own supported profile.

The Metal path has no per-frameUIImage/PNG readback. Optional renderer telemetry
separates source CPU encode/whole submission, GPU completion, and actual
drawable presentation. Current Apple Simulator headers omit presentation
callbacks; `presentationTelemetryAvailable` is false there, so zero samples mean
unmeasured presentation. Native callbacks/device performance require their own
run. Requested refresh rate and offline60fps exports do not prove true-device60fps.

`WorldbendMetalOpticalRenderer.makeCommandBuffer`, `encodeBackdrop` and
`encodeOptical` permit GPU offscreen composition using the same real optical
passes as MTKView. Use its own queue for shared frost intermediates; foreign
queues and source/target aliasing reject. A standalone host can supply a compiled
owned `libraryURL`; the default remains the package metallib. The
[Chromatic Tide example](../../examples/native-gpu-work/README.md) retains editable
Metal/parameters, actual source+optics pixels, native controls and measurement
methods. Its disclosed proof/export readback is separate from production.

## Shared completed frame (`FRAMESOURCE-01`)

APP producers publish into `WorldbendFrameHub` after GPU work completes:

```swift
let hub = WorldbendFrameHub()
try hub.publish(
    descriptor: .init(
        frameID: hub.makeFrameID(),
        logicalSize: CGSize(width: 390, height: 844),
        contentRect: CGRect(x: 0, y: 0, width: 390, height: 844),
        pixelWidth: texture.width, pixelHeight: texture.height,
        colorSpace: .displayP3, pixelFormat: .bgra8Unorm,
        presentationTime: .milliseconds(16)
    ),
    pixelBuffer: cvPixelBuffer,   // preferred for SwiftUI layerEffect sampling
    metalTexture: metalTexture    // zero-copy for APP MTKView / wet-glass
)
```

Use **`WorldbendOpticalFrameScene`** so backdrop + every pane share **one**
`beginFrameAccess` and **one** `presentationArtwork()` CGImage for that
`frameRevision` (no per-pane CVPixelBuffer re-lock / re-materialization):

```swift
WorldbendOpticalFrameScene(frameHub: hub) { backdrop in
    // same WorldbendOpticalPane usage as the View backdrop path
}
```

The classic `WorldbendOpticalScene(backdrop:)` View initializer is unchanged.
`WorldbendFramePresentedView` remains for single-view hosts; it also reads the
hub artwork cache, but multi-pane hosts must use `WorldbendOpticalFrameScene`.

Lifetime: Worldbend retains `CVPixelBuffer` / `MTLTexture` while any
`WorldbendFrameAccess` for that generation is open and until the hub replaces
or clears the slot. APP must not free those GPU resources earlier. Metal
accessors do not require a per-frame GPU→CPU→GPU copy.

**Honesty — two optical hosts, do not conflate them.**

| Host | API | Pixel path |
| --- | --- | --- |
| SwiftUI `layerEffect` | `WorldbendOpticalFrameScene` + `WorldbendOpticalPane` | Shared CGImage once/revision from BGRA8 CVPB/CPU (`swiftui-layer-effect-from-pixel-buffer`). **Not** Metal-direct. |
| Metal-direct | `WorldbendOpticalMetalFrameScene` + `WorldbendMetalOpticalPane` | Shared `MTLTexture` or CVPB→`CVMetalTextureCache` (`metal-direct-from-texture` / `metal-direct-from-pixel-buffer`). **Does not** call `WorldbendFrameImaging` / CGImage. |

SwiftUI `layerEffect` cannot bind `MTLTexture`; the Metal host is an explicit
MTKView/CAMetalLayer path, not a claim that `layerEffect` became Metal-direct.
`rgba16-float` works on the Metal host when a compatible texture/buffer is
published; the CGImage host still refuses it. CPU-only publications stay on the
CGImage host (`unavailable-cpu-only` for Metal-direct). Build with Xcode so
`default.metallib` includes `worldbendMetalOpticalVertex/Fragment`
(`OpticalGlassRuntime.hasCompiledShader` / `WorldbendMetalOpticalRenderer.status`).
When the metallib/pipeline is missing, Metal panes use the supplied opaque fill
instead of an empty drawable.

Size the Metal scene to the published `logicalSize`; its named coordinate space
is that logical canvas (top-leading letterbox inside a larger proposal) so pane
frames share the backdrop uniform space. Frost on Metal-direct is an in-shader
low-pass in logical points (same unit as SwiftUI `.blur(radius:)` on the
layerEffect host), not an APP capturer. **≤2pt** (includes 1.2pt clear buttons)
keeps the historical 3×3 kernel unchanged; **~12–18pt** menus sample a
shared-frame mip pyramid at a LOD matched to the blur, plus a compact 3×3
residual (≤9 taps/call, ≤27 with chromatic split; one pyramid build ≈1.33×
source texels per frame revision). See `WorldbendFrostSamplingBudget` /
`WorldbendFrostPyramid`.

```swift
WorldbendOpticalMetalFrameScene(frameHub: hub) { context in
    if let renderer = context.renderer {
        WorldbendMetalOpticalPane(
            binding: context.binding,
            renderer: renderer,
            optics: material.opticalConfiguration,
            cornerRadius: 12,
            coordinateSpace: context.coordinateSpace
        )
    }
}
```

Prefer publishing both `CVPixelBuffer` (BGRA8) and `MTLTexture` when you need
either host. Export a fixed Vendor pin with
`node scripts/export-swiftui-package.mjs --output <empty-dir>` and sync via APP
`sync-worldbend-material.mjs`. Parallax continues to use existing
`layered-depth`; this batch does not add a second parallax recipe.

Keep animation/media state outside the supplied backdrop, which SwiftUI may
evaluate at each pane. It must be sampleable SwiftUI artwork, not a UIKit/AppKit
video/web/Metal view. The host can supply an explicit decoded image frame for
such content; silently omitting its moving layer is not a faithful fallback.
Reduced transparency/increased contrast use the supplied opaque fill; the pane
does not own timers, input or accessible content. Foreground glyphs stay sharp.

For a `swiftui` receipt, use `.worldbendSystemGlass(material, in: Capsule(),
variant: .clear, interactive: true)` (iOS/macOS 26). The legacy `.worldbendGlass`
keeps its `.regular` default for compatibility. This route reports all six
numeric fields unavailable; choosing clear/regular is not parameter mapping.
Both modifiers reject an optical receipt. Snippets are never executed.

`sourceFingerprint` identifies the accepted source. `delivery` identifies the
current locally merged material, or `nil` after removal. Obtain an
`appearance_update` from the shared core using the complete previous/new source
inputs and `delivery?.material`; pass both the update and new source delivery.
The session rejects stale source/destination fingerprints before mutation.
Retain the complete source input separately for the next core request. Use
`updateLocal` with a canonical delivery of the same accepted recipe, `remove`
to preserve local removal across revisions, and `reattach` to explicitly restore
the latest accepted source. The host owns persistence across receiver lifetimes.

For personal tuning, restore an `AppearancePreference` through the session
initializer. `displayMaterial` evaluates the current source with committed or
previewed overrides; rendering visibility uses that same effective material.
`setVisible(false)` transiently hides it; `true` or `nil` never overrides an
effectively hidden material, and no preference resurrects a removed delivery.
Use `propose` to preview typed changes, `commitCandidate` to return the record
to persist, `cancelPreview` to return to committed values, and `resetOverrides`
to reveal current source defaults. `updateLocal` is the separate designer path
and rejects a preference-tuned session. Consumer source updates must carry the
matching preference revision and the pure new source; stale plans or an active
preview are rejected before mutation.

Receipts come from a trusted core or verified artifact transport. Fingerprints
are ordering tokens, not signatures. Decoding is capped at 64 KiB and rejects
missing nullable keys, foreign targets and invalid material/fidelity fields.

The [iOS receiving example](../../examples/ios-material-receiving/README.md)
exercises source updates, local edits/removal, stale receipts and recovery.
Run `pnpm test:swiftui-receiving` on an Apple SDK host for canonical receipt
regeneration and Swift package tests. The example's Xcode UI tests exercise
actual controls, focus and application state; package tests alone do not prove
rendered behavior.

Bound the receiving field or button with a matching `contentShape` after attaching the pane. The larger sampled layer must not expand accessibility or touch bounds; clipping only its pixels is insufficient. The native example checks an input and its adjacent action retain their own frames.

For exact artwork color, supply explicit colors or decoded image pixels. Adaptive system colors can resolve differently inside an offscreen layer even when the source environment is retained. The calibration fixture uses authored sRGB and Display P3 values; do not promise pixel identity for arbitrary semantic-color content.

## Outline / SetupArc glass (`worldbend.outline-glass-metal@0.1`)

Irregular-contour optical glass for ceiling / SetupArc-class shapes. **APP
owns the contour** (`SetupArc.path` samples → polyline). Worldbend bakes a
signed-distance + outward-normal field and runs Metal-direct optical response.

### Field space (OUTLINE-GLASS-01-r2)

Default **`fieldSpace: .paneLocal`**: polyline stays in `Shape.path` pane-local
points. The shader subtracts `paneFrame.xy` before sampling, so **moving** the
control does **not** rebake; size / shape / dynamics changes do. Keep
`.scene` only when you intentionally author scene-global polylines.

Bake coverage expands to the contour AABB ∪ viewport (SetupArc closes past
`height+200`) so chamfer does not invent a false bottom edge at the viewport rim.

### Subpixel edge refine (OUTLINE-GLASS-01-r5)

Default cell pitch stays ~2pt (no full-viewport density raise). After scanline +
chamfer DT, texels inside a narrow boundary band get **exact segment** distance
and outward normals. This removes curved-highlight staircasing on
FloatingTaskShape-class corners while keeping drag rebake cost bounded
(`BakeDiagnostics.segmentDistanceQueries`).

### Refine budget preflight (OUTLINE-GLASS-01-r6)

`maxRefineQueries` is enforced **before** exact-segment work (bandTexels×segments
preflight via `checkedRefineQueryCount`) and again **inside** the refine loop.
Over-budget contours throw `WorldbendOutlineError.refineBudgetExceeded` without
completing a full exact-segment pass. Optional `maxRefineQueries:` on
`bake` / `bakeWithDiagnostics` is for tests and hostile caps; production default
remains `5_000_000`.

### Continuous frost / menu soften (GLASS-PRESS-01-r5)

Large `frostRadius` (>2pt, including ~12–40pt menus) samples a shared-frame mip
pyramid at a conservative LOD (`log2(σ_texels) - 1.5`) plus a 7×7 Gaussian in
UV (`gStep = frost/content`). OutlineGlass.metal and MetalOpticalGlass.metal
share that kernel. Mip encode is recorded on the draw command buffer (no
MainActor `waitUntilCompleted`). Small frost (≤2pt) stays on the legacy 3×3 so
1.2pt buttons are unchanged. Budget: `WorldbendFrostSamplingBudget` /
`WorldbendFrostPyramid`.

### Spatial refine index (GLASS-PRESS-01-r2 / bake-perf)

Exact-segment refine still restores subpixel distance/normals in the boundary
band, but each band texel only tests nearby segments via a uniform grid over
expanded segment AABBs (Chebyshev margin = band + 4×cell). Closed menu morphs
(~334×302pt, 128 samples) cut segment×band queries to ~6% of brute force while
keeping distance within <0.5pt of exact closest-segment. Default cell size and
the 250ms SetupArc timing gates are unchanged.

### Debug field kernel (GLASS-PRESS-01-r6)

The same scanline, 3-4 chamfer, outward-normal, and exact-segment steps run as
unchecked pointer loops. On Swift 6.3, `@_optimize(speed)` does not execute the
`-O` pipeline under `-Onone`, so the pointer kernel is what makes default Debug
continuous. Menu-class bake on the r6 machine: Debug about 29 ms before this
kernel and about 5 ms after; Release stayed under 1 ms. Distance and normal
bits match the previous CPU field. Ship animation continuity is still judged on
Release / `-O`.

### Optional GPU field (GLASS-PRESS-01-r7)

`.cpu` (the default) remains that pointer kernel. `.gpu` keeps the scanline on
the CPU and runs chamfer, outward normals, and exact-segment refine as Metal
compute (`OutlineFieldCompute.metal`, fast-math off). `.automatic` stays on the
CPU. On the r7 machine Release GPU bake was about 1.8 ms against about
0.4–0.5 ms for the pointer kernel; Debug medians tied near 4.8 ms, and a cold
GPU repeat was about 18 ms. Distance and normal bits matched, so GPU stays
opt-in. Synchronous
`waitUntilCompleted` runs on `worldbend.outline-field-gpu`, not the main
thread. `encodeGPUField` does not wait. A grid wider than 1024 texels fails
closed on `.gpu`. `applyResolvedGPUField` uploads the resolved field so an
on-segment even-odd repair is what the texture publishes. Subpixel `< 0.5 pt`
and the 250 ms gates are unchanged.


```swift
let dynamics = WorldbendOutlineDynamics(
    top: top, depth: depth, contactX: contactX, bend: bend,
    viewportWidth: Double(paneSize.width),
    viewportHeight: Double(paneSize.height),
    contourRevision: revision
)
// Sample SetupArc.path(in: paneLocalBounds) — pane-local points, not scene.
let contour = WorldbendOutlineContour(
    logicalSize: paneSize,
    polyline: paneLocalPolyline,
    dynamics: dynamics,
    fieldSpace: .paneLocal   // default
)
if WorldbendOutlineFieldBaker.needsRebake(previous: cachedField, contour: contour) {
    cachedField = try WorldbendOutlineFieldBaker.bake(contour: contour)
    try fieldTexture.update(cachedField)
}
let optics = OutlineOpticalGlassConfiguration(
    edgeWidth: 10, refractionScale: 12, chromaticOffset: 1.2,
    frostRadius: 0, lightDirection: [0, -1], highlightStrength: 0.28
)
WorldbendOutlineMetalPane(
    binding: metalBinding,
    renderer: outlineRenderer,
    field: fieldTexture,
    optics: optics,
    coordinateSpace: sceneSpaceId
)
```

`WorldbendOutlineSetupArcSamplingStandIn` is **tests/reference only** — do not
replace APP `SetupArc` / `CeilingArcGeometry`. Rim orbit paint stays APP-owned.
Plain `swift test` may report `missing-metallib`; Xcode proves the metallib via
`WorldbendOutlineGlassRuntime.hasCompiledShader` /
`WorldbendOutlineMetalRenderer.status`.


## Glass press / bulge / stretch / bubble-menu morph (`GLASS-PRESS-01`)

Shared recipe `worldbend.glass-press-deform@0.1` — **generic deformation**, not
APP menu business. Worldbend owns elastic / deform / morph / lighting-response
parameters, ranges, interruptible springs, and a receiving receipt. APP owns
Button activation, hit-testing, focus, menu layout/IA, and brand chrome.

**No second optics kernel.** Tick returns a deformed `WorldbendOutlineContour`
(+ `WorldbendGlassPressOpticsModulators`); feed that contour into
`WorldbendOutlineFieldBaker` / `WorldbendOutlineMetalPane` exactly as SetupArc
glass. Normals and refraction stay on the Outline / optical field.

```swift
let recipe = WorldbendGlassPressRecipe.referenceDefaults
let sim = try WorldbendGlassPressSimulation(recipe: recipe)
let rest = WorldbendGlassPressRestShape.contour(
    polyline: WorldbendGlassPressRestShape.capsule(in: paneBounds, samples: 64),
    logicalSize: paneSize, revision: 1)
let menu = WorldbendGlassPressRestShape.contour(
    polyline: /* APP menu outline samples */, logicalSize: paneSize, revision: 1,
    contourKind: "menu")
let frame = try sim.tick(
    dt: 1.0 / 60.0,
    input: WorldbendGlassPressInput(
        phase: .morphingToMenu, // or .pressing / .dragging / .cancelling
        contact: finger,
        pressAmount: 0...1,
        dragOffset: drag,
        pressed: true,
        disabled: false,
        reduceMotion: accessibilityReduceMotion,
        restContour: rest,
        menuContour: menu,
        morphTarget: openFraction // optional
    ))
// Rebake Outline from deformed contour; apply modulators to outline optics.
if WorldbendOutlineFieldBaker.needsRebake(previous: cached, contour: frame.deformedContour) {
    cached = try WorldbendOutlineFieldBaker.bake(contour: frame.deformedContour)
}
let optics = try frame.opticsModulators.applying(to: baseOutlineOptics)
// frame.receipt → authored vs effective + losses (disabled / reduceMotion / clamps)
```

**Inputs / flags:** continuous round/capsule→menu morph (resample + lerp, not a
hard cut); press / drag-out / cancel with reverse interrupt + spring-back;
`pressed` / `disabled` / `reduceMotion` degrade with receipt disclosure
(`disabled` → snap rest; `reduceMotion` → snap targets, no spring flight).

**Bounds:** `recipe.validate()` + `WorldbendGlassPressResourceLimits` (morph
samples, steps/tick, deform vertices, maxStretch / maxBulge). Hostile polylines
throw `budgetExceeded` before deform work.

**Non-claims:** not `.regular`/`.clear`; not a canned Lottie-style clip as
gesture; not APP menu hit/focus/Button semantics.

## Wet glass (`WET-GLASS-01` / `WET-GLASS-01-r2`)

Shared recipe `worldbend.wet-glass-surface@0.1` extracts the Arrival wet-glass
simulation and Metal water-field composition so APP supplies **mask, scale,
intensity band, seed, population, backdrop frame** and keeps weather UX.

```swift
let recipe = WorldbendWetGlassRecipe.referenceDefaults // or decode JSON
let panes: [[CGPoint]] = /* glazing in source pixels */
let field = WorldbendWetGlassField.build(
    panes: panes, holes: opaque, sourceSize: sourceSize, band: .heavy, recipe: recipe)
let binding = WorldbendWetGlassSurfaceBinding(
    sourceSize: sourceSize, waterScale: 0.26, band: .heavy,
    population: 1, seed: 0, panes: panes, field: field, composeMode: .window)
let simulation = try WorldbendWetGlassSimulation(recipe: recipe, binding: binding)
simulation.advance(to: clockTime)
let particles = simulation.particles(in: logicalCanvas)

// Metal compose against a FrameHub-published backdrop:
let composer = WorldbendWetGlassComposer(device: device)
try composer.encodeFromFrameHub(
    hub: frameHub, command: command, pass: pass, mask: glazingMask,
    particles: particles, logicalSize: logicalSize, pixelSize: drawableSize,
    recipe: recipe, mode: .window, paintBackground: true)
```

`unit = sourceWidth/1024 * waterScale`. Reference scene hints:
`referenceRoomWaterScale` 0.26, `referenceCardWaterScale` 0.45,
`referenceCardPopulation` 0.3 (APP still chooses the binding). MIT provenance
for Raindrop FX `bae4081…` travels with the recipe and
`Licenses/RaindropFX-LICENSE.txt`.

**Water-height blend (r2):** the `.r16Float` water pass uses **additive
one+one** blending so overlapping / merging drops accumulate height (APP
`ArrivalRainWindow` / RainGlass parity). Photo and composite passes stay
premultiplied `one` / `oneMinusSourceAlpha`. `WorldbendWetGlassComposer.waterFieldBlend`
documents the contract; `waterFieldPeakHeight` proves GPU overlap accumulation
when a metallib is present.

**Resource / parameter domains (r2):** `recipe.validate()` rejects non-finite
band tables (`initialDrops` / `spawnPerSecond` / `gravityInUnits`), inverted
`Range`s, `initialDrops` above `capacity`, zero-length light vectors (illegal
normals), and out-of-range field bands. `WorldbendWetGlassResourceLimits`
publishes authored vs effective ceilings (`referenceCapacity` 1200 accepted —
do not reduce to mask CPU; `capacityMax` / `initialSpawnLoopMax` 4096). Binding
population effective range is `[0.1, 1]`; non-finite population is rejected at
simulation init.

`encode` / `encodeFromFrameHub` treat the backdrop as the **content-pixel**
texture (UV 0…1); `logicalSize` must match `frame.contentRect.size` (Arrival
`produceFrame` contract). Letterboxed placement into a larger viewport stays
APP-side or optical blit. Drop uploads are triple-buffered with an in-flight
gate (capacity 3) — caller must `commit` the command buffer. Frame color-space
tags are not converted in Metal (raw sample). Sky precipitation, Arrival
weather enums, scene assets and brand chrome stay in the APP. Plain
`swift test` validates simulation contracts;
`WorldbendWetGlassRuntime.hasCompiledShader` / `composer.status` disclose
Xcode metallib readiness. Card-rim mode does **not** sample UIKit controls.

Documented deltas vs APP `ArrivalWaterSimulation` / `ArrivalRainGlass`: recipe
drives optics uniforms (APP metal previously hard-coded constants); rim height
smoothstep 0.16…0.38 remains hard-coded like APP; `fieldBands` come from
`ArrivalRainIntensity.profile` (not the JSON `simulation` block);
APP `ArrivalRainGlass.metal.txt` may drift after the reference snapshot (photo
blit fragment); this package does not re-measure Simulator fps.

### Runtime background adaptation and neighboring bubbles

`WorldbendBackdropGrid` measures an explicit completed BGRA frame once for all
panes. It reports linear luminance, upper luminance, local variation, chroma,
coverage and optional `meanLinearRGB` in the frame's top-left content coordinates.
RGB is transformed from the declared source color space to extended linear sRGB
before measurement; tagged Display P3 input is not interpreted as sRGB bytes.
Adaptation exposes smoothed `environmentLinearRGB` independently of shade and
frost. Missing samples clear this value instead of retaining another scene's
color; existing statistics initializers remain compatible through a nil default. The bounded CPU read is
explicit; Metal-only, floating-point or transparent carriers return unavailable.
Hosts supply their already-composited frost and exclude foreground controls to
avoid visual feedback loops. This is not a contrast certification.

`WorldbendGlassAdaptationRecipe` exposes brightness thresholds, maximum shade,
frost/highlight additions, response seconds and deadband. The caller owns the
state lifetime and elapsed clock. `WorldbendGlassAdaptationState` produces bounded,
cadence-independent adjustments; applying them preserves authored thickness,
refraction, dispersion and light direction. The host retains semantic colors and
accessibility fallbacks. This runtime profile is not executed by Figma's static
native glass effect; no native-auto-adaptation parity is claimed.

`WorldbendOpticalMetalFrameScene(presentsBackdrop: false)` binds a shared source
without covering the real window with a captured copy. A floating overlay can use
that context while its host supplies explicit, disclosed capture frames.

`WorldbendBubbleUnion` combines 1–4 rounded bodies using a smooth distance union
and bounded marching squares. Blend radius and cell size are authored in points;
sub-grid bodies and excessive work are rejected. It returns separate closed
contours after separation, never an invented polygon joining them. Feed each
contour to the existing outline field/optics. This is an optical 2D meniscus, not a
3D fluid simulation or a new hit-test rule. A receiving host owns gesture and
accessibility behavior, and may use a simpler transition for reduced motion.

## Native glazed surfaces and contact light

`WorldbendGlazedSurface(shape:pigment:reflection:recipe:contact:)` renders a pigment body with bounded authored coverage, mask-derived bevels, edge pooling and an art-directed fixed studio clear-coat reflection. The foreground stays outside the shader. `coverage` defaults to 1 for existing recipes; a lower value lets the native compositor faintly reveal the underlying layer while retaining the clear-coat highlight. This is not volumetric transmission or subsurface scattering. It is a native procedural receiving primitive, not a canonical glass material, environment reflection or Figma projection. The host owns theme identity, role colors, preferences and contact semantics; `WorldbendGlazeRecipe.effective` falls back as a whole for invalid input. Plain SwiftPM and increased contrast use an explicit opaque fallback; only a native compiled shader run can establish the painted result.

`WorldbendContactMeniscus` adds bounded specular edge width and a contact light pool over a host's existing lens. It owns neither backdrop sampling nor hit testing and does not claim fluid simulation. `WorldbendHoldLight.engaged` completes one counterclockwise revolution in 0.8 seconds, then joins the host-selected slow period with continuous angular velocity. `releasing` freezes the current phase and drains energy; the host supplies monotonic elapsed time, actual gesture/activity, cancellation, visibility and reduced-motion behavior. The primitive does not infer recording, progress, completion or other business facts.
