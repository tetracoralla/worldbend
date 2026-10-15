# Explore an expression and deliver a stable result

Use this path for depth, a spatial reveal, coordinated cards or
an interactive surface but has not already chosen how it should look. A saved
recipe or a precise requested edit can go directly to execution.

Run `effect_catalog` with `version: "3"` and optionally `intent` (`depth`,
`inspect`, `reveal`), `content` (`dom`, `texture`), `carrier` or literal `query`.
This is a versioned software catalog, not model-generated recommendations. Read
the returned purposes, comparison cues, slots and limits; order is not quality.
An empty match means the filter found nothing, not that all creative alternatives
are impossible. Simple host transforms may be sufficient.

Versions `1` and `2` remain available for saved recipes; version `2` is also the
live-DOM shared-camera route. Version `3` retains the catalog while making
`multiplane-camera` a decoded-texture spatial-appearance route. Use it when
foreground, middle and background must respond to one coherent viewpoint rather
than independent offsets. It requires explicit far-to-near planes and source
overscan. Read every planned frame's `coverage`: a false value and its required
source padding are a delivery issue, not permission to stretch, invent or
inpaint content. Even full geometric coverage does not make flat cut-outs 3D.

In version `3`, `camera.focusDistance` stays the convergence/look-at plane;
`appearance.depthOfField.focusDistance` is independent optical focus. Depth of
field and motion exposure are explicit bounded settings. Motion planning also
requires the previous complete state and elapsed seconds, retains no history,
and becomes sharp when the host supplies identical states after stopping. A
declared grayscale depth map is caller-selected media with an explicit near/far
mapping and must match its content texture dimensions. Worldbend never
generates or chooses depth, flow, segmentation, relighting or hidden surfaces.

For a SwiftUI stage, filter with `carrier: "swiftui"`. The current native route
returns only `layered-depth`. Its recipe contains three exact, linear
`translate-x` / `translate-y` tracks in logical viewport units. Use those tracks
to implement native `offset` behavior with the App's own gesture, cancellation,
return animation and reduced-motion presentation. Save the recipe and
fingerprint with the consumer work. Do not install the Web SDK or call the tool
on every frame. The `dom` label means live host-managed layers on this
route, not an HTML requirement.

For a material design choice, compare distinct spatial relationships against
the actual content and intended interaction. Use the same content and input
path; inspect intermediate motion, reversal, text, focus and interruption, not
only an attractive endpoint. Bring a recommendation with observable reasons.
Do not give yourself an aesthetic score or require the user to invent effects,
select low-level parameters or review every minor detail. There is no fixed
alternative count or requirement to explore before a routine edit.

Run `effect_recipe` with `effect`, explicit `version: "3"`, `viewport` and
`intensity` in [0,1]. Built-in intensity scales tracked responses or shared-camera
travel and version-3 maximum blur radii from the rest state; zero preserves
structural layout but removes input-driven motion and blur. It expands into
editable recipe data. Use that document with
`effect_plan`, plus a complete state (`progress`, `pointerX`,
`pointerY`, `reducedMotion`). For temporal appearance, also pass `motion` with
`previousState` and `elapsedSeconds`. Save the recipe and the returned fingerprint; use
`expectedFingerprint` to detect unintended changes. Intentional changes produce
a new fingerprint. Never claim the fingerprint includes source assets or proves
design quality.

Recipes can compose plane, shared-plane strip and fixed-content window layers;
versions `2` and `3` support a bounded shared camera over camera-plane layers,
and version `3` adds appearance only to an all-camera recipe.
Inspect the exact schema on demand when authoring a composition. Do not rewrite
the core's interpolation or geometry in generated JavaScript. If the idea cannot
be expressed, identify the specific missing relation rather than claiming an
unsupported effect. Extensions must state and verify their semantics.

Embed through `@worldbend/web/effects`: create or load a recipe, bind the exact
named slots with `attachEffect`, then send absolute input states to `update`.
Frames run locally. DOM slots keep native controls; windows accept decoded media,
not arbitrary DOM capture. Version-3 camera planes also accept decoded sources,
plus a depth map only when the recipe declares one. The host owns gestures,
business actions, timing and media playback. Importing the ordinary perspective
entry remains independent.

The SDK's `examples/effects.html` is the runnable discovery/comparison surface.
It accepts image replacement and exports/imports a self-contained study with
both recipes, state, content and fingerprints. The SDK includes
`SPATIAL_EFFECTS_CONTRACT.md` for composition, lifecycle and exact limits. The
SDK also includes `SPATIAL_APPEARANCE_CONTRACT.md` and
`examples/appearance.html`, the side-by-side clear/depth/motion fixture. The
bundled interactive runtime is Web. SwiftUI support is deliberately narrower:
only the `layered-depth` recipe is a supported native-host projection, and
Worldbend does not ship the App's gesture or animation runtime. Figma has no
interactive effect carrier. Do not infer broader native support from the
mathematical model alone or change the user's consumer project without its
existing task authority.

Both studies ship in the installed Skill's `assets/web/worldbend-web.tgz`.
Install that archive in the authorized output directory (see `live-web.md`),
then serve the installed package over local HTTP and open `examples/stage.html`
for a toy-stage comparison, `examples/effects.html` for the full catalog, or
`examples/appearance.html` for spatial-appearance acceptance.
No development checkout, registry download or model call is needed for playback.

The stage study is a developer fixture, not the human product surface or the
Agent's delivery target. It compares a small independent host translation
implementation, the equivalent Worldbend recipe and a rigid-plane expression.
The full effects study initially compares translation-only `layered-depth` with
`multiplane-camera` using identical artwork and input. Choose what serves the
task: a host implementation can be the useful result. Keep foreground contact
shadows with their subject. Use `stage-native.js` alone when simple offsets
suffice; it imports no SDK.

For spatial appearance, inspect the same input at rest, during a fast explicit
transition, and after settling. Change optical focus without changing camera
convergence, test reduced motion and context recovery, and preserve the selected
recipe, source textures and depth map as separate artifacts. Let a consumer pin
a verified package version on its own schedule instead of coupling its feature
work to Worldbend's source iteration.

Save the comparison after inspection. Its versioned local JSON records content,
state, recipes/fingerprints and the selected approach; the observation text is
the caller's judgment, not a software score. Reopen it before making another
change. With task authority, retain the file alongside the consumer deliverable
so a later Agent can reproduce the decision or a defect. Nothing is uploaded;
tool-call counts do not capture host-only choices or prove adoption. During an
authorized maintenance task, use those concrete reproductions to fix the owned
recipe, example, routing or missing primitive. Do not ask the owner to invent
more scenarios or file an issue just to make this process continue.
