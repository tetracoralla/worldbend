# Live web perspective

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
The local source also ships a reproducible package command, `pnpm package:web`,
which produces a self-contained tarball plus a static example under
`artifacts/web/`. It is a private local distribution, not a published npm package.
Use an explicitly available local package or its bundled ESM files. Do not
invent a CDN URL or assume a registry release exists. The full `@worldbend/web`
entry additionally links the complete WASM module for Canvas/mockup planning;
importing it references both modules even when only bindings are used, so
size-sensitive frontends should import `@worldbend/web/perspective` directly.

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
