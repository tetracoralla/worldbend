# Live web perspective

For fixed content viewed through a moving frosted window, use the separate
`@worldbend/web/surface-window` entry and the SDK's
`SURFACE_WINDOW_CONTRACT.md`. That texture route supports decoded media/canvas;
the CSS route below preserves actual DOM content and interaction.

The browser displays the returned geometry with native CSS. Worldbend provides
the constraints, validated mapping and reusable data. Do not install a runtime
for a trivial fixed decorative rotation that native CSS already expresses well.

For one fixed design, call `pose`, `css` or `plane_strip` through Worldbend MCP.
Set each element's untransformed width and height to the supplied elementSize,
then apply returned `css.transform` and `css.transformOrigin`. Shared-strip
panels use `position:absolute;left:0;top:0` in the same positioned container.
That container should carry no border or scroll of its own: bindings measure
its border box while absolutely positioned panels start at its padding-box
origin, so a border offsets the whole plane by its width.
Do not add another parent perspective to the already projected mapping.
There is no Worldbend runtime download for this static route.

For responsive or interactive work, use the focused `@worldbend/web/perspective`
entry. This installed Skill contains `assets/web/worldbend-web.tgz` (resolve
from the directory containing SKILL.md). Install that exact local archive
in the authorized frontend with its package manager. It has no runtime npm
dependencies and requires no network to install. Do not copy into plugin caches.
The archive also contains the optional `examples/stage.html` host/Worldbend
comparison, `examples/effects.html` recipe studio, and
`examples/appearance.html` clear/depth/motion fixture. Serve the installed
package directory over local HTTP to run them; none is imported by the SDK.
The archive also includes `examples/document.html`, which loads two
core-compiled Spatial Document deliveries, continues interaction and replaces
decoded media by durable asset ID while advancing document identity without
rebuilding the saved expression.
The local source also ships a reproducible package command, `pnpm package:web`,
which produces a self-contained tarball plus a static example under
`artifacts/web/`. It is a private local distribution, not a published npm package.
Use an explicitly available local package or its bundled ESM files. Do not
invent a CDN URL or assume a registry release exists. The full `@worldbend/web`
entry additionally links the complete WASM module for Canvas/mockup planning;
importing it references both modules even when only bindings are used, so
size-sensitive frontends should import `@worldbend/web/perspective` directly.

For a two-sided interactive card, use `@worldbend/web/card` and the packaged
`CARD_CONTRACT.md`. A Figma card delivery contains `rig`, front artwork PNG
and an optional back PNG. Bind its rig to the existing component after mounting;
the component retains its own content, layout and business handlers. Use the
PNG faces when the artwork itself is the intended content. Core samplers provide
the authored rest, bounded pointer/idle tilt and complete turns locally.

```js
import { attachCardController, isCardRig } from '@worldbend/web/card';

if (!isCardRig(delivery.rig)) throw new Error('Invalid card delivery');
const effect = attachCardController(card, delivery.rig, {
  surface: stableWrapper, back: backFace, activateOnClick: false,
  onError: error => showError(error.message)
});
if (!await effect.ready) throw new Error('Card binding unavailable');
const activate = () => effect.activate();
trigger.addEventListener('click', activate);
// A later design revision updates behavior in place.
await effect.update(nextDelivery.rig);
// On unmount:
trigger.removeEventListener('click', activate);
effect.dispose();
```

```js
import { attachPerspectiveStrip, normalizedSpec } from '@worldbend/web/perspective';

const plane = normalizedSpec({
  tl: {x:0,y:.02}, tr: {x:1,y:.10},
  br: {x:1,y:.90}, bl: {x:0,y:.98}
});
const row = attachPerspectiveStrip(container, [
  {id:'outer',element:outer,start:0,end:.47},
  {id:'inner',element:inner,start:.53,end:1}
], plane, {onError: error => showError(error.message)});
// CSS gives container a size/position and panels their untransformed size.
// Panels start at left:0;top:0 in that container. No parent perspective.
await row.update(nextCompletePlane);
const saved = row.getSpecs();
row.dispose();
```

Both top edges lie on one line, and both bottom edges lie on another. Equal
source intervals need not have equal projected screen size. Gaps are fractions
of the source plane. Use one group per side if the left and right planes differ.
Never replace that relationship with independently sized depth tiers.

For a fixed-slot carousel, replace the content inside the existing panel nodes;
the mapping and live controls survive. CSS size changes are observed. Membership,
IDs, order and intervals are fixed per binding: `update` takes a complete plane,
not `{panels}`. When the list or intervals change, dispose and bind again after
mounting the new nodes, including when none of them overlap the old list:

```js
row.dispose();
const nextRow = attachPerspectiveStrip(container, nextPanels, nextCompletePlane,
  {onError: error => showError(error.message)});
// Keep nextRow as the current binding; dispose it on unmount.
```

This preserves the DOM nodes but waits for new measurements before applying the
new mapping. It is not an atomic membership transition or a carousel animation.

`attachPlanePose(element, {perspective:1400,rotateX:3,rotateY:-8})` observes the
element's border box and returns `update`, `getSpec` and `dispose`.
`attachPointerTilt(element, stableWrapper, pose, {rangeX:3,rangeY:5})` adds bounded
local pointer input with reduced-motion and touch handling. Changes stay in the
page; do not call MCP for animation frames. For React/Vue, bind after mounting,
update complete inputs, dispose on unmount. Bindings retain invalid-input errors
and the last valid visual state; handle `onError` or `worldbenderror` visibly.

Images, videos, canvas, iframes and DOM can stay live. Source replacement should
retain the bound node or rebind the replacement. Resize is automatic; content
selection, media playback, layout, accessibility and overall design remain the
frontend's responsibility. A reference image supplies visual intent; these
operations do not automatically discover or measure its planes. Verify actual
rendered corners and the user's requested relationships.

## Spatial exploration and saved effects

Use the optional `@worldbend/web/effects` entry for versioned effect discovery,
recipe expansion and absolute-state playback. The packaged
`SPATIAL_EFFECTS_CONTRACT.md` documents composition and replay;
`SPATIAL_APPEARANCE_CONTRACT.md` documents version-3 optical, temporal,
depth-map and WebGL limits. `examples/effects.html` compares expressions with
shared content/input and saves replayable studies; `examples/appearance.html`
compares clear geometry, depth of field and explicit motion exposure. The
ordinary perspective import stays independent.

For a compiled interactive Spatial Document delivery, call
`attachDocumentEffect(plan, expressionId, {elements, assets}, initialState)`.
Keep the returned binding. When decoded media changes, call
`binding.replaceAsset(assetId, source)` rather than reconstructing recipe slot
IDs. The adapter updates all compiled texture roles for that asset, validates
the proposed dimensions and resource limits first, serializes replacements and
attempts to restore prior sources if a renderer rejects partway through. A
`false` result leaves the last accepted work usable. Live DOM is not captured;
change it through the host framework while retaining its bound element.
`replaceAsset` changes carrier media only. Plan and retain a durable asset
revision through `document_update_plan` and the matching new delivery plan
after the replacement succeeds.

## Native Glass material delivery

Import `attachAppearance` and its `AppearanceDeliveryPlan` type from
`@worldbend/web/appearance`. Obtain the current plan through Worldbend
`appearance_delivery`, then attach it to the project's own transparent surface.
Use `update(plan)` for later design values, `setVisible(false)` for transient
host hiding, `setVisible(undefined)` to restore authored visibility, and
`destroy()` when removing the surface. Host visibility cannot enable a material
authored hidden. Keep semantic buttons, handlers, focus and layout in the host.

The package includes `examples/native-glass.html`, its plan and attributed photo,
and `NATIVE_APPEARANCE_CONTRACT.md`. Serve the package root to run that example;
no workspace or author credentials are needed. Edge optics are approximate and
require supported SVG backdrop filters; the explicit frost fallback loses them.
Splay is preserved in Figma but has no current Web mapping.

For a shared material on existing components, use `attachAppearanceGroup` from
`@worldbend/web/appearance-receiving`. The package contains the runnable
`examples/appearance-receiving/index.html` and its canonical JSON receipts.
Retain the accepted source input separately from the destination material.
Plan a later native edit through `appearance_update {previous,next,live,
expectedFingerprint}`; `live` must be explicit and may be `null` after local
removal. Apply it with `group.update(plan)`, which checks both source and
destination fingerprints. `group.updateLocal(delivery)` keeps the current
recipe and does not advance source identity; `remove()` preserves local removal
across source updates. `getState()` supplies detached planning state.
Bind after mounting, destroy on unmount, and explicitly reattach to accept a
source after removal. Later inline application declarations are retained and
disclosed by `preservedProperties`; component content and handlers remain owned
by the project. See `NATIVE_APPEARANCE_CONTRACT.md` for fidelity and ownership.
