# Native appearance contract

`worldbend.appearance@0.1` names an editable material seed, currently the native
Figma `GLASS` effect. The live native properties own the actual values; the seed
records origin. This contract owns implemented semantics and target limits. The second
implemented family, `worldbend.texture@0.1`, follows the same reconciliation
machinery over the native NOISE and TEXTURE effects; see
[the texture family](#the-texture-family).

## Seed and live state

`AppearanceRecipeSpec` has a schema/version, a trimmed nonblank `recipeId` of
at most 64 Unicode characters with no control characters, a `recipeVersion`
from 1 through `u32::MAX`, and a `GlassMaterial`. Its seven fields are `visible`,
`lightIntensity` in `[0,1]`, `lightAngle` in `[0,360)` degrees, `refraction` in
`[0,1]`, `depth` in `[1,1000]`, `dispersion` in `[0,1]`, and frost `radius` in
`[0,1000]` logical pixels. Values are validated, never clamped. The seed
fingerprint is canonical SHA-256; it is independent of later native edits.

`appearance_inspect` reconciles a seed and live material as `absent`, `tagged`,
`customized`, `untagged-native` or `removed`. Live values win. A seed may be
returned as an explicit fallback when Glass was removed; this is not authority
to restore it or deliver it as the current appearance. Compare exactly, except
that the host's precise `Math.fround(seed)` storage representation counts as
unchanged. This absorbs known float32 storage, not arbitrary small edits.

`appearance_revision {previous,next,live}` plans an upgrade of the same recipe
identity to a strictly newer version. Fields changed from the old seed stay at
live values; other fields take the new defaults. It returns the new seed,
effective material and preserved fields. `live:null` remains removed. Planning
is read-only; the caller inspects current state before applying or updating code.

## Figma native editing and Agent access

The human workspace and Agent adapter share
[appearance.ts](../packages/figma/src/appearance.ts). Apply replaces the single
Glass effect in place or appends one, preserving unrelated effects/order,
fills, children, layout and extra native Glass properties. Seed provenance is
shared plugin data: namespace `worldbend`, key `appearance`. The human plugin
can still read its legacy private key, but another plugin cannot see that
private history. Applying once migrates it to shared provenance. Seed and
customized effective material are separate inputs: adjusting controls never
rewrites the preset's defaults. Reopening a custom preset restores its identity,
version, defaults and actual native values.

Unsupported nodes, multiple Glass effects and invalid native Glass are reported
per node. Opaque fills and Background Blur conflicts are disclosed; Apply does
not remove unrelated artwork to make a preset look stronger. Figma permits only
one Glass effect and may render only the first of Glass/Background Blur; a
fully opaque fill hides the backdrop. These are conditions to resolve in the
design, not a promise that every selected layer will show glass immediately.
See [Figma effects](https://help.figma.com/hc/en-us/articles/360041488473-Apply-effects-to-layers).

`figma_appearance_inspect {fileKey,pageId,nodeId}` prepares a supported Figma
request for native state, provenance, native extras, placement, contextual
preview and opaque `expected` state. `figma_appearance_apply` requires that
fresh expected state plus `recipe` and optional customized `material`. Execute
the prepared request through the permitted Figma connector, then use the returned
live snapshot. The human plugin also rejects a changed state before writing.
Prepared requests remain bounded by 48 KiB, including the shared runtime;
appearance and texture packets embed the materials runtime variant, publisher
packets the publishers variant, so family growth does not grow every packet.

On batch write failure, restore owned effects and shared provenance separately,
in reverse order. Report `unrestoredNodeIds` if the host rejects a restoration;
do not claim unconditional rollback. The human UI names those layers and reloads
current state. Native host Undo remains available.

The human chooser uses small named native-rendered swatches and a large preview
of the selected artwork. The material window starts at 820×720; spatial editors
start at 820×660. A bottom-right grip supports pointer resizing and arrow keys
(Shift increases the step); each layout retains its size during this invocation.
Parameters open in an optional drawer, grouped into optics/lighting for Glass
and grain/etching for texture, with display switches together. Customized
native values remain recognizable, rather than falsely marking the preset as
an exact match.

Choosing a card replaces the one pending candidate. Glass and texture occupy
separate effect slots and can coexist. Native Apply uses the shared mutation
functions, with an expected-state check and rollback across the selected targets.
A field-only edit changes that field on each target's own live material and keeps
its seed and other values. A whole preset sets its declared fields. A container
is one target; effects are not recursively assigned to its children. Ineligible
nodes and partial scope are visible before Apply. Disable and remove affect only
the chosen family's effects; recoverable provenance survives removal.

Saved looks store a name and complete material seed in this plugin's local
client storage, up to 48 entries. A native artwork thumbnail is included when
available. They survive plugin reopen, can be selected and deleted, and do not
constitute a shared library or exported team-delivery package. Built-in Clear
lens v2 uses frost radius1 for a clearer thumbnail and starting result. Existing
v1 seeds and edited native values remain intact until an explicit preset choice.

### Native fields outside the current portable model

Current Figma runtime exposes `splay` even though installed plugin typings omit
it. Native-panel Splay edits are readable through `nativeExtras` and survive
subsequent Worldbend applies. The seven-field portable material does not yet
map Splay to Web or SwiftUI. Preserve/disclose that extra state at handoff;
do not imply pixel equivalence or silently translate it into another field.
The [typed Glass API](https://developers.figma.com/docs/plugins/api/Effect/)
does not expose Glass variable bindings. Unmodeled native fields must be read and preserved; they have no portable
semantics in this contract.

## Frontend delivery

`appearance_delivery {recipe,material,target}` resolves one explicit target.
Always pass the current live material. Its fingerprint binds seed identity,
actual parameters and target. Each of the seven fields has a fidelity result.
No target promises Figma pixel identity.

### Later native edits and destination ownership

`appearance_revision` upgrades preset defaults. `appearance_update` delivers a
later native edit, including changes made without a preset version bump. Pass
`previous` (the accepted source delivery input), `next` (the freshly read source
delivery input), `live` (the destination's current material, explicitly `null`
after local removal), and the accepted source `expectedFingerprint`. Missing
`live` is rejected rather than interpreted as removal. Both inputs must use the
same recipe ID and target; changed preset defaults require a newer recipe
version. A native material edit may keep the existing version.

The core compares each destination field with the previous source. Fields edited
locally survive; unchanged fields follow the new source. Local removal survives
until explicit reattachment. The plan contains the previous source fingerprint,
the previous destination delivery fingerprint, the new source fingerprint,
the merged delivery (or `null`) and preserved fields. Source identity and the
locally merged delivery identity stay separate. A receiver checks both previous
fingerprints before applying, so a plan prepared before a local edit or removal
cannot overwrite that newer state. Retain the new source input for the next
update; do not use the merged local delivery as the source comparison base.

### Web

The `web` profile produces frost/saturation/brightness, light-derived inset reflection,
and SVG edge displacement with separate normal R/G channels and RGB splitting.
Refraction scale is `64 * refraction * depthFactor`, where `depthFactor` is
linear on authored depth `[1,10]` then a soft tail through effective max `100`
(factor up to `1.5`); chromatic offset is `24 * dispersion`. Delivery receipts
publish authored vs effective ranges, intentional couplings (refraction and
dispersion both raise `backdrop-filter` saturate), calibrated light-axis
cardinals (`native-cardinal@1`: 0 down, 90 left, 180 up, 270 right; Web inset
highlight uses the same screen-space vector as Metal and supersedes the prior
Web-only `[-cos,-sin]` inset mapping), `rimDepth` for the receiver, and
`losses` for native extras such as Splay that stay outside the seven portable
fields. Soft-effective depth preserves the historical `[1,10]` displacement
band so accepted recipes in that band keep their prior response.
`parameterRanges[].effective` is always the clamped authored input for that
field (`depth.rim` included); the mapped rim contribution lives only on
`rimDepth` (soft-tail max 40). These are Web approximations, not Figma's
optical equations.
The static SVG is a rectangular reference; the reusable runtime generates a
rounded-rectangle signed-distance map for the actual control size.

The `web-color-preserving` target uses the same frost, displacement, dispersion
and edge-lighting mechanisms without global saturation or brightness
compensation. Discovery exposes it as
`worldbend.glass-web-color-preserving@0.1` with the
`color-preserving-refraction` mechanism. Its fingerprint binds the distinct
target, its `backdropFilter` contains only the authored blur, and its global
color-coupling receipt is empty. The seven portable material fields are unchanged.
Refraction resamples positions; explicit dispersion separates RGB samples,
frost blends nearby colors and edge lighting adds highlights. Color preservation
means no additional global color treatment, not identical pixels after those
authored effects. Existing `web` receipts keep their compensated color behavior.

The live receiver places its displacement image at the surface's explicit
logical width/height. Percentage extents in the zero-size hidden SVG resolve
against that viewport and previously displaced the whole backdrop; the actual
surface extent now retains the neutral interior and the intended edge response.
The extent comes from the local CSS border box, including padding/borders for
content-box surfaces; a scaled/rotated screen-space bounding rectangle cannot
define those logical filter units. Repainting after an existing card transform
retains the same local basis instead of applying its visual scale twice.
Map resize and the static-reference SVG remain separate receiving mechanics.
The [Filter Effects draft](https://www.w3.org/TR/filter-effects-1/#feDisplacementMapElement)
owns filter sampling/color-space semantics; rendered verification establishes
what the tested browser actually executes.

Import `attachAppearance` from `@worldbend/web/appearance`, attach it to the
project's existing surface, and use `update(plan)` for a later delivery.
`setVisible(boolean|undefined)` changes transient host visibility without
changing the design fingerprint; it cannot enable a material hidden in the
authored delivery. `destroy()` disconnects observers/listeners,
removes its SVG and restores owned inline styles unless the host replaced them.
Each instance has unique filter IDs; duplicate attachment is rejected. Displacement
maps are capped at 256 pixels per axis and regenerated on resize, not each scroll.
Pointer, keyboard, cancellation and focus loss release press feedback.

For one shared material on several existing components, import
`attachAppearanceGroup` from `@worldbend/web/appearance-receiving`. Pass the
surface nodes and canonical initial delivery. `getState()` returns detached
source/destination state for planning; `update(appearanceUpdatePlan)` applies a
guarded source change, `updateLocal(deliveryPlan)` adjusts the current recipe
locally, and `remove()` retains local removal across later source changes.
`setVisible` is transient; `destroy()` ends the binding. Reattach explicitly to
accept the latest source after local removal. The group never replaces component
nodes, content, focus or application handlers and does not derive optical math.
Both Web profiles use this receiving session, including explicit preferences,
local preview/commit/reset, source revision and offline restoration. A pinned
exposure report must match the exact source profile. Source updates cannot
silently switch a session's profile; deliberate reattachment selects another.

If application code replaces an owned inline declaration, including its priority,
the runtime relinquishes that property for the remainder of the binding. Resize,
press feedback, delivery updates and disposal preserve it. The handle's
`preservedProperties` and the group's state disclose these overrides; canonical
material state remains separate from such application CSS. Reattach to transfer
ownership back deliberately. Framework/class styling still needs the ordinary
CSS cascade; this mechanism tracks inline declarations, not computed-style intent.

The browser samples live DOM through `backdrop-filter`; no DOM screenshot,
image duplication or Agent round trip drives scrolling/interaction. The caller
owns layout, transparency, clipping/stacking, semantic controls and accessibility
policy. This runtime supplies approximate edge reflection/refraction/dispersion,
not captured environmental reflections, physically accurate optics or authored
motion. Chromium optics and explicit frost fallback are exercised. CSS support
probing cannot prove visual support on every engine: Safari/Firefox optics and
production GPU/accessibility performance remain unverified. Select the explicit
`frost-only` option when target optics are unavailable, and disclose the loss.

`appearance_profiles` discovers implemented glass/texture backends with
required fields and mechanisms. Requesting an unsupported mechanism such as
portable Splay fails with a precise missing-mechanism error rather than a
silent seven-field success.

Working example: [native-glass.html](../packages/web/examples/native-glass.html),
its generated delivery, [source input](../examples/native-glass-delivery.worldbend.json)
and licensed photo. Serve `packages/web` after its build; no author credentials
or plugin UI are needed. The Web runtime is a separate small entry point.

[Color study](../packages/web/examples/appearance-color-study/index.html) compares
the unchanged artwork, compensated glass, color-preserving glass and explicit
frost fallback through the ordinary receiving sessions. It uses source-MCP
receipts generated by `scripts/generate-appearance-color-study.mjs`, local
exposed controls and existing foreground actions. Actual lossless browser pixels
retain all six sampled interior colors in the preserving profile; changing
refraction changes the edge grid while leaving the sampled interior grid intact.
This is tested-browser evidence, not a color-management or all-engine guarantee.

[The receiving project](../packages/web/examples/appearance-receiving/index.html)
uses two existing controls, business actions and shared canonical deliveries,
without a component library. Its [initial input](../examples/appearance-receiving.v1.worldbend.json)
and [later native input](../examples/appearance-receiving.v2.worldbend.json) retain
the same preset version. `pnpm example:appearance:generate` produces its receipts
through the source MCP; `pnpm test:appearance-receiving` checks regeneration and
real Chromium continuation at desktop/narrow widths, local edits/removal, stale
plans, failed receipt/retry and replacement. Native extras travel beside the
portable plan in `native-extras.json`; Splay is disclosed without claiming a Web
mapping. `source.v1.json`/`source.v2.json` retain the complete accepted inputs,
including preset defaults, for further `appearance_update` planning without the
author's checkout. Each revision includes its new `sourceInput`. The example
and runtime also ship in the local Web package. This proves
the representative Web receipt route, not independent-team permissions or iOS
visual acceptance.

### SwiftUI: choose an implementation explicitly

The `swiftui` target uses system Liquid Glass on iOS 26+, selecting
`.regular.interactive()` or `.identity` in one stable `glassEffect` modifier.
Availability guards and exported visibility stay explicit. Keeping the same
view structure preserves nested input state when visibility changes. The system
owns adaptive optics. All six numeric Figma fields, including refraction
magnitude, are `unavailable` setters. Native behavior does not reproduce
arbitrary Figma tuning.

`swiftui-optical` uses the reusable `WorldbendAppearance` package on iOS 17+
and macOS 14+. It compiles all six numbers into
`worldbend.rounded-glass-metal@0.1`, a rounded-surface Metal sampling profile:

| Source field | Rendered meaning in this profile |
| --- | --- |
| `radius` | Gaussian softness of the supplied backdrop, in logical points |
| `refraction` | Rim sample displacement, 0–32 points |
| `depth` | Width of the refracting rim, bounded by the pane's half-size |
| `dispersion` | Opposing red/blue sample offsets, 0–8 points |
| `lightAngle` | Primary edge illumination; native calibration: 0 down, 90 left, 180 up, 270 right |
| `lightIntensity` | Strength of the directional edge highlight, 0–0.6 |

All six are `approximated`, not `native` or pixel-equivalent to Figma. The core
owns coefficient compilation and the package owns GPU evaluation. `visible`
maps directly; removal emits no pane. The system route rejects optical receipts
instead of quietly showing `.regular` while ignoring the numbers. Updates cannot
silently switch rendering targets.

`WorldbendOpticalScene` binds a presentation-only SwiftUI backdrop;
`WorldbendOpticalPane` samples it after the host sizes its real control. Layout,
text, input, shape, role tint and accessible opaque fill remain host-owned.
Rounded rectangles, circles and capsules are supported; arbitrary outlines,
environmental reflections and native Splay are not represented by this profile.
The layer is cropped with a sampling gutter before filtering. No whole-screen
capture or per-frame Agent call occurs. SwiftUI may evaluate that visual subtree
per pane: share animation/media state outside it and measure busy scenes.
UIKit/AppKit-backed video, web and Metal views cannot be sampled by this route.
Those hosts need an explicit image/texture provider or the honestly identified
system route; an omitted moving layer is not an equivalent backdrop. Reduced
transparency and increased contrast use the host's opaque fill. The renderer
owns no animation clock and never samples foreground controls.

Keep authored artwork colors explicit or resolve them at the scene owner.
System semantic colors can be reinterpreted inside an offscreen graphics layer;
retaining the source environment alone does not guarantee their exact RGB values.
Calibrate spatial/neutral sampling on explicit sRGB/Display P3 colors and images,
and inspect adaptive-color sources separately. This is a current sampling fidelity
limit, not permission to silently change a product's accepted artwork.

The reusable [Swift package](../packages/swiftui/README.md) accepts typed canonical
delivery/update receipts. `AppearanceSession` keeps source and destination
fingerprints separate, rejects stale plans before mutation, retains local
removal and exposes explicit restoration of the latest accepted source.
Decoding caps receipts at 64 KiB and distinguishes omitted keys from explicit
null. Application code retains complete source inputs for subsequent core
planning and owns persistence across receiver lifetimes. Receipt fingerprints
are ordering tokens, not transport authentication; snippets are never executed.

The [iOS receiving project](../examples/ios-material-receiving/README.md) binds
an existing Save control and editable trip panel to one session. Canonical
source-MCP receipts include a native Figma visibility edit at the same recipe
version. iOS 26.5 Simulator checks cover input/focus and nested state through
design update/restoration, local removal, stale receipt rejection, failed
delivery/retry, cancellation and saved business state on relaunch. This is the
representative native receiving route, not independent-team permissions or
physical-device performance. The optical route
adds a photo/grid scene, six single-parameter pixel comparisons, neutral-backdrop
alignment during scrolling, and input/action survival across update and removal.
Neither the example nor source tests establish installed-plugin parity.

## The texture family

`worldbend.texture@0.1` is the second implemented material family: tinted
paper grain plus surface etch over the native NOISE and TEXTURE effects. Its
seven portable fields are `visible`, `grain` density in `[0,1]` (NOISE
density), `grainSize` in `[0.5,1000]` px, `grainColor` as `#rrggbb`,
`etch` radius in `[0,1000]` px (TEXTURE), `etchSize` in `[0.5,1000]` px, and
`clipToShape`. Live native values stay authoritative; `texture_inspect`,
`texture_revision` and `texture_delivery` share the Glass reconciliation
semantics, including the float32 storage roundtrip and the five states.

Apply replaces the single owned NOISE and TEXTURE effects in place (or appends)
while preserving unrelated effects, their order and native extras: duotone
kinds and secondary colors, blend modes and per-axis sizes survive a Worldbend
write and are disclosed through `nativeExtras` rather than guessed into the
portable model. A fresh append declares MONOTONE grain; a replacement omits the
kind so a native duotone keeps its own. A grain-zero or etch-zero portion is a
deliberate grain-only or etch-only seed and does not stack an inert native
effect. Stacked noise or texture piles are per-node skips, never guesses.
When changing size, the native scalar and `noiseSizeVector.x` remain equal;
uniform axes resize together, while a native anisotropic Y remains owned by
Figma. Writes retain the noise color's alpha and disclose it as native-only
state. Independent NOISE/TEXTURE visibility is likewise disclosed when the
two differ. These extras are preserved in Figma; the seven-field Web model
does not reproduce duotone, color alpha, anisotropic Y or independent effect
visibility and must not be presented as a pixel-equivalent export of them.
Provenance is shared plugin data: namespace `worldbend`, key `texture`, so a
Glass instance and a texture instance coexist on one layer independently.
`figma_texture_inspect`/`figma_texture_apply` prepare the same guarded
requests; family packets embed the materials runtime variant below.

### Web delivery

`texture_delivery` projects one resolved material onto the self-contained Web
route: a deterministic turbulence grain tile (percent-encoded SVG data URI
whose tint, density and cell size come from the material), overlay
declarations, and an etch filter built from `feTurbulence` + `feDiffuseLighting`
with `baseFrequency = 1/etchSize` and `surfaceScale` linear on etch `[0,12]`
then a soft tail through effective max `100` (up to `4.5`). Delivery receipts
publish authored vs effective etch ranges and `losses` for native extras
(duotone, anisotropic Y, color alpha).
The runtime renders them as two layers above the surface: the grain tile
overlay, then the achromatic etch relief in an overlay blend clipped to the
surface outline, so the relief never replaces the grain tint or spills past
the shape.
Grain color and global visibility map directly. Grain coverage/cell size and
etch/etch size are disclosed approximations: the tile generator is not Figma's
noise engine. The 64px tile's CSS size is calibrated to its 0.16 frequency
(`grainTileSize = 64 × 0.16 × grainSize`), rather than shrinking all its cells
into one `grainSize` square. Grain uses normal compositing at every density;
adjusting density never switches the blend equation at a threshold.
Import `attachTexture` from `@worldbend/web/texture`, bind it to the project's
own surface, and use `update`/`setVisible`/`destroy` for revision, transient
host visibility and disposal. The overlay is `aria-hidden`,
`pointer-events: none`. Grain always follows the CSS corner outline;
`clipToShape` controls only etch, as in native TEXTURE. Rounded CSS outlines
are supported; other Figma silhouettes need a host clip/mask and are not
silently represented as matching geometry. Disposal preserves later host
layout changes. Working example: [texture-paper.html](../packages/web/examples/texture-paper.html)
with its generated delivery and [source input](../examples/texture-paper-delivery.worldbend.json);
serve `packages/web` after its build. A SwiftUI texture profile is not
advertised until a real adapter exists.

## Draft preview

The large applied preview is a native scene capture. A candidate edits temporary
copies through the same mutation functions as Apply. The capture includes
intersecting page roots, the page background, native hierarchy, text, foreground
ordering, masks, transforms and effects. Sections use plain native Frames for
capture because a Section cannot be nested in the capture Frame; their paints,
corners, strokes and child order are preserved without clipping the contents.
Overlapping target contexts merge; separate contexts all appear in the preview.

On an opaque solid page background, the same capture also drives locked in-place
feedback. On transparent or other page backgrounds without a verified opaque
solid base, the chooser explicitly labels a window-only preview to avoid double
alpha compositing over the original. Native Apply remains available. Original
nodes, layout, selection and document notifications are never temporarily
stripped, hidden or disabled. Preview cleanup removes only owned copies and
feedback, without replaying global Undo. After preview cleanup, host Undo may briefly restore a preview node; delete it or continue editing.

Exports run serially with only the latest edit queued. Generation, request and
expected-state checks reject stale renders and writes. Captures are bounded to
4M pixels total and 4096 pixels per axis, with a 10-second timeout per region.
Context-only changes retire old feedback and re-render the retained choice;
selection or native-appearance changes restore freshly read native state.
Cancellation, selection changes, leaving the surface and plugin close remove
pending feedback. The applied image stays visible while a candidate is
rendering or has failed; Retry requests a fresh trial. This native preview does
not claim Web pixel parity for disclosed target approximations.
