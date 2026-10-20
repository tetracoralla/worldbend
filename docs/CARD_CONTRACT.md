# Interactive card contract

`worldbend.card@0.1` is the accepted spatial/action state for one two-sided
interactive card: bounded pointer/idle tilt sharing one envelope, and a
deliberate complete turn with its own axis, direction, turn count, duration,
easing and interruption rule. This contract owns the implemented semantics.
The rigid geometry is the pose
operation's own math ([PLANE_POSE_CONTRACT.md](PLANE_POSE_CONTRACT.md)); the
card family reports states that the ordinary front-facing solver rejects
instead of weakening that solver.

## Canonical state

A `CardRig` carries `schema: "worldbend.card"`, `version: "0.1"`, the
`elementSize` of the untransformed artwork, `geometry` (`perspective` ≥ 1 plus
optional unit-box `pivot`/`perspectiveOrigin`, both defaulting to center), an optional authored `rest` view (default zero pose), an
explicit `back` treatment (`{"treatment":"mirror"}` by default), a `tilt`
envelope and one `action`. The envelope declares `maxRotateX`/`maxRotateY` in
[0,90], a unit-box `pointerRegion` (default the whole surface), optional
`idle` (`amplitudeX`/`amplitudeY` in [0,45], `periodMs` in [100,60000]), plus
`smoothingMs` (pointer-follow time constant, default 120) and `settleMs`
(return-to-rest timing, default 400). The action declares `axis` (`y`
default or `x`), `direction` (±1), `turns` (1–8), `durationMs`
(100–10000, default 720), `easing` (the shared
[motion](MOTION_CONTRACT.md) `linear`/`hold`/`cubicBezier` curves; default
`cubicBezier(0.4, 0, 0.2, 1)`) and `interruption`
(`ignore-while-active`: activation during a running turn is dropped, never
queued). Unknown fields are rejected; nothing is clamped silently.

A `CardView` is one explicit sample: `rotateX`/`rotateY`/`rotateZ` in
[-3600,3600], `depth`, `translate`. Angles are cumulative, so a
two-revolution turn (720°) and one revolution (360°) remain distinguishable
in state even when their final stills are identical. Front and back faces
are valid states; an edge-on view (projected area ~0) is a reportable state,
not an error.

## Operations

`card_pose {rig, view?}` projects one absolute view (omitted/null `view` uses
`rig.rest`) through the shared rigid pose
order (subtract pivot, rotate X then Y then Z, restore pivot, translate,
project about the perspective origin). It returns the projected `quad`, the
four corner `depths`, the `face` (`front`, `back` or `edge`), and
`revolutions` (the cumulative turn around the action axis ÷ 360). `rigidCss` and `backCss` carry the shared three-dimensional transform,
including independent pivot and camera-origin translations, on all faces. `spec` and
`css` appear only when the ordinary front-facing `TransformSpec` solver
accepts the quad; edge and back views intentionally omit them. Horizon
crossing and non-finite values fail with the existing pose error codes.

`card_pointer {rig, x, y}` maps a pointer position in the surface's unit box
onto the envelope: positions outside `pointerRegion` clamp to its edge, the
region maps linearly to [-1,1], and the output tilt follows the established
signs (`tiltX = -y·maxRotateX`, `tiltY = +x·maxRotateY`).

`card_idle {rig, timeMs}` samples the idle wobble deterministically: the two
axes run sine and cosine of the same period so the motion traces an ellipse
inside the envelope; each amplitude is bounded by its corresponding tilt maximum.
`timeMs` must be finite and within [0,1e9]. Sampling a rig without `idle` is `E_SCHEMA`.

`card_turn {rig, progress}` evaluates the triggered turn at linear progress
in [0,1] through the rig's own easing curve, reporting the cumulative eased
`angle`, `revolutions` and the `face` after adding that angle to the authored
rest through the shared projection.

The four operations are exposed in the full CLI (`card-pose`,
`card-pointer`, `card-idle`, `card-turn`), the compact MCP catalog
(`card_pose`, `card_pointer`, `card_idle`, `card_turn`; the eight frozen
direct tools are unchanged), the Web/WASM perspective profile and the Figma
carrier's card surface. The generated Web contract carries `cardRig`,
`cardPose*`, `cardPointer*`, `cardIdleInput` and `cardTurn*`.

## Figma preset stills

Preset effects provides four independent choices on one current artwork:
pointer tilt, idle tilt, turning card and folding screen. Its preview is a
representative still, with one amount control and Apply. Selecting choices and
adjusting amount do not write canvas output. Cancel restores the accepted
choice. The initial tool remains Perspective; transformation tools precede this
secondary, directly accessible entry.

The Figma presentation specification is `worldbend.figma.preset-effect@0.1`:
one closed effect identifier and amount in [0,1]. The card choices derive their
representative poses through `card_pose`; the folding choice derives visible
window sampling and projection through the shared core. These versioned defaults
own the still's meaning. They are distinct from an interactive CardRig or
card-delivery envelope.

Apply wraps the original in place inside one native Frame, preserving its node
identity and editable text/vector children. A hidden original holder and one
visible presentation belong to that workpiece. The presentation contains native
vector masks and projected PNG faces; folding also contains a clipped native
copy for stationary content. The varying frost is sampled into the projected
image. A native translucent glass face, outline and shadow make the folding
panel visible even where it extends beyond the artwork; these fade with amount
and are absent at zero. The projected face is raster, while the retained original and masks are
editable native layers. An input image needs no prebuilt mask or companion Frame.

`worldbend.figma.preset-result@0.1` stores the effect and the workpiece's local
root, holder, original and presentation references. Reopening resolves that
local structure; native duplicates carrying old reference bytes continue from
their own original, never the earlier workpiece. Damaged owned structures give
a recoverable error rather than becoming a second effect on flattened pixels.
Edit artwork exposes the retained original. Fresh source export reads its current
fonts, content and rendered bounds, including visible strokes and shadows.
Unapplied preset choices survive refreshing or editing that same original;
Cancel returns to the latest saved choice. Apply after a native edit replaces
the presentation in the same workpiece;
changes in projected bounds keep the artwork's world anchor and hinge fixed.
The presentation follows that anchor even when an auto-layout parent controls
the workpiece's position and sizing. Normal native Undo/Redo covers publication. Font preflight, source/selection
checks and a checked write boundary reject superseded inputs and newer saved
changes. Failed construction removes owned candidates and restores prior state.

## Figma authoring

The detailed Card workspace is a directly accessible tab that reads the live selection like
Appearance. The first selected artwork or Frame is the card front; a second
selection offers an explicit authored back face, with the mirrored front as
the useful default. The window preview renders the exported artwork through
the same core samplers the live web binding uses, so pose edits, derived
rest/tilt-limit/turn views and scrubbed progress all agree with published
stills by construction.

Derived views are rest, four tilt extrema plus one combined corner, and
quarter-angle turn samples. Their labels show degrees, while the scrubber
samples elapsed action progress through the chosen easing. Direct dragging,
arrow keys and numeric controls refine the current artwork's resting pose;
inspecting a limit or turn keeps that view distinct from rest. The optional
pivot controls live in a disclosure, and explanations live behind nearby help.

Save view records the shown pose and its sample provenance. A later save offers Update view and
Save new view; updates retain the existing canvas position, stacking order and
any name the designer changed in Figma. Generated names follow the view label.
Saved outputs retain source, view identity, rig, projection, visible face,
an informational native-property source fingerprint and pointer/action sample
provenance. The fingerprint does not authorize skipping fresh source exports.
Selecting an owned still reopens the Card workspace,
resolves the original artwork and restores that chosen view. Missing originals
produce a recoverable error instead of repeatedly projecting the raster result.
Save behavior stores the rig and optional back-node binding under the
`worldbend` namespace and refreshes the existing linked views from freshly
exported artwork. Rest, pointer positions and turn progress resample the accepted
behavior; explicitly refined and captured live poses retain their shown pose.
An old derived view identifier does not override a later explicit refinement.
Failed updates restore the existing still's pixels, dimensions, name and record.
No board of additional views is required.

Figma raster authoring uses the full rendered artwork bounds, including
visible shadows and strokes, rather than stretching that raster into the smaller
structural node bounds. Stills use those logical dimensions for geometry and
canvas placement,
independently from raster density. The shared core solve and WebGL path render
front or authored-back content, or the mirrored front when no back is assigned.
Projected bounds receive transparent padding; an edge view offers no output.
The bitmap authoring preview reuses the shared mipmapped texture and
multisampled coverage path for the same core sample; this prevents CSS bitmap
minification from introducing avoidable interference patterns. It fits the
whole projected bounds into its viewing area, with matching pointer targets,
and sizes its raster to display density and layout zoom within the axis limit.
Exports target 2× density within a 4096-pixel raster axis limit. A resource limit
that reduces density is disclosed; outputs exceeding the wire limits fail before
sending a request. The editable original is preserved.

Cancel recovers accepted behavior; Reset creates a default draft, recoverable
with Cancel. Selection change and reopen read the stored behavior. Preview
supports bounded pointer input, idle play/pause, one active turn and easing-aware
scrubbing. Generation and request correlation prevent older exports or saves
from completing newer work.

## Web binding

`attachCardController(element, rig, options?)` from `@worldbend/web` (also
`@worldbend/web/perspective` and the `card` entry) samples the core locally.
`await controller.ready` confirms initial validation and painting, including an
initial static pose in a hidden document while its animation remains paused;
`await controller.update(nextRig)` validates before replacing current behavior,
returning false while retaining the prior state on an invalid update. Native CSS
uses the core's `rigidCss`/`backCss`, with origin at zero and explicit pivot and
camera translations. Resize reprojects the untransformed border box.

The element keeps content, layout, focus and business handlers. Descendant
controls keep their own activation; `activateOnClick: false` and imperative
`activate()` allow a component-owned trigger. Keyboard activation avoids double
native clicks; scrolling touch gestures do not start an action. Reduced motion
jumps activation to its completed state, and hidden pages pause the clock.

Completed and running turns remain cumulative in reported state. Rendering
uses an equivalent local angle when composed rest, tilt and action cross the
static view domain; reported turns retain their revolution count. Figma derived
views and scrubbing use the same local-view policy. The resting view can itself
be front, back or edge; a complete turn returns to that authored pose.

Shared element ownership prevents stacked bindings. Disposal restores only
unchanged declarations owned by the binding; later developer edits survive.
An active edit to an owned declaration stops the binding and reports a conflict.
Async sample tickets discard late input, resize, update and disposed work.
The runtime uses the browser's established CSS compositor rather than a new
raster animation engine. Vanilla Tilt (MIT) remains a useful standalone tilt
option; its transform order and local lifecycle are not the shared spatial
contract, and tilt alone does not provide idle/action state or design receipt.
Reuse compatible application timing tools when they preserve those semantics.
Examples and checks: `packages/web/examples/card.html`, `pnpm test:card-runtime`.

## Receiving project and revision

The delivery artifact is a `worldbend.card-delivery@0.1` envelope with a `rig`,
front artwork PNG and optional authored-back PNG: the Card workspace's
"Copy delivery JSON" action copies the current state (sized to the artwork)
for a self-contained handoff, and the stills' `worldbend.card-still@0.1` provenance carries the
same rig inside the Figma file. A receiving project's only Worldbend inputs
are the published runtime module and that artifact — no authoring UI, source
checkout or handwritten geometry.

`packages/web/examples/card-receiving/` is the constructed receiving project:
an existing live pricing-card component with its own content, focus and
business handlers receives `card-rig.v1.json`, owns activation through its
own trigger plus keyboard input, swaps its own campaign content under the
retained behavior, applies a later `card-rig.v2.json` design revision in
place through `update()` without touching handlers, and supports teardown and
reattachment from the artifact alone. Reattachment replaces the previous
binding and its status loop. A pending receipt belongs to its request and
binding; detaching or requesting a newer revision invalidates it. Failed
receipts retain the accepted behavior and visible retry feedback; an initial
failure can recover through Reattach without losing business handlers.
Returning from the browser's back/forward cache rebinds the accepted effect;
an explicit user detachment stays detached until the user reattaches.
`pnpm test:card-receiving` drives this loop at desktop and narrow widths in
Chromium. `pnpm test:card-browser` serves the identical runtime, receiving and
startup-recovery checks for another actual browser; it reports the browser,
viewport, density and motion preference rather than assuming an engine.

## Quality

The shared WebGL transform renderer now requests multisampled geometry
antialiasing by default and reports whether the host granted it
(`antialiasActive`); a driver without MSAA falls back to the previous
aliased raster rather than failing. High-quality texture sampling and raster density are independent from geometry
coverage. Transparent boundaries, small text, fine lines and moving edges must
be inspected at native scale and declared target density. A compressed reference
recording does not establish source quality or superiority; matched artwork,
pose and output density are required for that claim.

## Current limits

The pose operation's own contract is unchanged: ordinary `pose` still
rejects edge-on and back-facing inputs. Card turn stills are raster results;
the current Figma carrier publishes static canvas results and runs interaction
in its plugin preview. Figma Desktop verifies direct dragging, paired back
assignment, behavior save, linked refresh and reopen. The desktop Web runtime
and receiving loop have also been exercised in Safari and Firefox. Matched-source
inspection covers representative rounded transparent artwork at 2× density,
front/back and near-side poses, light/dark backgrounds and fractional layout
zoom. This evidence does not promise identical sampling across engines or
support on every device. Current carrier support is limited to the behavior
described above.
