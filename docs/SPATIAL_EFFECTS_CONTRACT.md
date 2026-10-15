# Spatial effects: discover, compose, compare and replay

Worldbend helps a person or Agent turn existing content into an editable spatial
expression. The exploration path makes alternatives observable; the execution
path remains a fixed program. No operation invokes a model, evaluates supplied
code, consults a network service, reads a clock or uses random values.

## Stable execution

The frozen version `1` catalog contains `layered-depth`, `rigid-tilt`,
`shared-plane`, `hinged-reveal` and `frosted-lens`. Version `2` retains those
expressions and adds the DOM `multiplane-camera`. Version `3` retains the same
catalog identities and turns that shared-camera expression into the texture
`multiplane-camera` with explicit spatial appearance. These are starting points, not the
boundaries of the recipe language. The catalog reports purpose, comparison
guidance, content requirements, input axes and actual supported carriers.
Filters are explicit enums and case-insensitive literal terms, combined with
AND. Empty matches stay empty. Ordering is fixed catalog order, not an aesthetic
ranking. All current interactive recipes execute through the bundled Web carrier.

`layered-depth` remains the deliberately simple three-layer translation effect.
It also has a SwiftUI delivery route: the Agent consumes its exact linear tracks
and implements gesture, offset and return animation in the native host. This
route installs no Web runtime and makes no per-frame tool calls. Filtering for
SwiftUI therefore returns only `layered-depth`. Figma returns only version-3
`multiplane-camera`, its task-native bounded multi-plane raster authoring route. The
serialized `dom` content label means live host-managed layers on the SwiftUI
route; it does not require HTML there. Version-2 `multiplane-camera` remains
Web-only. Version-3 optical and temporal semantics are owned by
[SPATIAL_APPEARANCE_CONTRACT.md](SPATIAL_APPEARANCE_CONTRACT.md). This does not
remove existing transform routes.

`effect_recipe` expands a named effect and explicit version, logical viewport and
intensity into a complete `worldbend.effect-recipe` document. For track-based
built-ins, intensity scales every tracked response away from its rest state;
for `multiplane-camera` it scales camera travel and, in version `3`, maximum
appearance radii. Zero therefore keeps the recipe's structural layout but
removes input-driven motion and blur. Store that document.
`origin` records how a built-in was expanded; the stored layers
and tracks, not the preset name, are authoritative when replaying or editing.
Changes to built-in semantics require a new catalog version; versions `1` and
`2` must not be silently reinterpreted. Version `1` rejects camera rigs and
camera-plane surfaces. Unknown schema versions and fields are errors.

Recipes contain 1..8 ordered layers and at most 16 total content slots. Each
layer is an existing core plane pose, spatial window, shared-plane strip, or a
version-2-or-3 camera plane.
A strip has 1..8 explicit panels. IDs are unique ASCII letters, digits, `-` or
`_`, 1..48 bytes. Layer offsets are logical pixels in the viewport and paint
order is array order. Hosts clip or frame that viewport explicitly; there is no
implicit scene camera, asset generation or depth extraction.

## Version-2 shared camera

`multiplane-camera` is a bounded 2.5D scene: one explicit pinhole camera and
2..8 fronto-parallel planes ordered from farthest to nearest. This recipe is not
itself a 3D scene graph. Every camera-plane layer declares its source size, fixed layout
offset and positive world distance. Camera-plane layers cannot have independent
tracks; pointer motion belongs to the shared rig so layers cannot silently
describe incompatible cameras.

The rig declares `focalLength`, `focusDistance`, and non-negative `travel.x/y`.
Travel is measured in logical screen pixels at the focus plane. Pointer state
moves the camera laterally, and the camera keeps looking at the viewport center
on the focus plane. At pointer zero, every plane maps identically to its authored
offset and source size. At other states, all four corners are projected through
the same camera basis. A plane on the focus distance keeps its center fixed;
near and far centers move to opposite sides while their quadrilaterals acquire
the perspective appropriate to their distances. The result remains an ordinary
core `TransformSpec` and CSS matrix per layer.

The built-in uses distances 1500, 1000 and 650, focus distance 1000, focal length
`2.2 * max(viewport width, viewport height)`, and maximum travel of 10% of each
viewport axis multiplied by intensity. Its source layers add 10% overscan on
every edge, so a built-in viewport plus overscan must remain within 8192 per
axis. This data is stored in the recipe and is authoritative after expansion.

Each planned camera frame reports `coverage`: whether the projected source quad
covers all four viewport corners, the exact source-pixel bounds sampled by the
viewport, and source padding still required on each edge. Coverage is geometric
only. It does not inspect alpha, synthesize missing pixels, reveal an object's
hidden side or prove that a cut-out person is three-dimensional. Insufficient
coverage remains observable data rather than an invented fill or silent clamp.

Each layer has up to eight tracks; each property occurs at most once. Tracks
replace one pose or frost property using `from`, `to`, an input axis and either
linear or smoothstep interpolation. `progress` spans [0,1]; `pointer-x` and
`pointer-y` span [-1,1] and are normalized to [0,1] before interpolation. There
is no integration of pointer deltas or hidden animation history. Angular tracks
use degrees and values in [-360,360]; translation/depth use logical pixels
bounded by 1,000,000. Frost tracks are window-only and keep the existing frost
limits. Current core geometry, strip and window validations still apply at
each evaluated state. A custom recipe can have invalid intermediate states;
an accepted endpoint is not a proof that its entire motion range is drawable.
Camera focal length, focus distance and plane distance are in `[1,1000000]`;
travel is in `[0,1000000]`. Camera planes are strictly far-to-near and share the
ordinary 1..8192 layer-size limit.

## Version-3 spatial appearance

Version `3` preserves the shared camera's geometry and separates its historical
`camera.focusDistance` (the convergence/look-at plane) from optical focus. A
version-3 recipe may add depth of field, explicit motion exposure, and declared
per-plane depth-map bindings. Planning receives previous state and elapsed time
as input and retains no temporal history. Rendering uses caller-bound decoded
textures; no depth, flow, segmentation, relighting, or hidden-side content is
inferred. Exact values, formulas, WebGL lifecycle and limits are defined in the
[spatial-appearance contract](SPATIAL_APPEARANCE_CONTRACT.md).

Built-in viewport dimensions are in [16,8192]; authored layer sizes are in [1,8192]. Browser requests are bounded to
256 KiB of UTF-8 JSON; native adapters retain their existing request/response
limits. No global queue, filesystem write, generic batch publication or new
effect-authoring language is introduced by an evaluation.

## Identity and reproducibility

`effect_plan` consumes the recipe, complete current state, and optional explicit
motion sample and returns all layer plans or one error. It computes the
`sha256:` fingerprint from compact JSON
of the typed recipe, with recursively sorted object keys, expanded serde
defaults and signed zero normalized to positive zero. Array order is preserved. Floating-point JSON parsing uses exact
round trips. This is Worldbend's canonical serialization, not RFC 8785; callers
should use the returned fingerprint rather than reproduce serialization rules.

An optional `expectedFingerprint` rejects an unintended recipe change before
any evaluation is published. The fingerprint covers the recipe and provenance,
not media bytes or the current input state. It detects changes, not authorship
or trust: a caller who intentionally changes a recipe may compute a new value.

For the same version, recipe, complete state and optional explicit motion
sample, the core has no model- or session-dependent choices. Repeated calls
within a runtime are byte-stable;
native/WASM plans are tested with relative/absolute numeric tolerance 1e-8.
Transcendental math and GPU filtering do not promise cross-platform pixel or
binary identity. Source media, fonts, device density and renderer versions
must also be retained when comparing appearance. Different authored inputs can
legitimately produce different results; selection itself is not deterministic
software inference.

`reducedMotion: true` evaluates the explicit rest state: progress 1, pointer
0/0. The returned state records that effective state. The Web binding also
honors the operating-system preference by default and reports the combination;
pure planning depends only on supplied state. The host owns gestures, elapsed
time, animation scheduling and product actions. Frames execute locally. A
SwiftUI host maps the `layered-depth` recipe's `translate-x` and `translate-y`
tracks to native offsets using the declared linear interpolation and logical
viewport; other recipe surfaces remain Web-only.

## Agent and CLI routes

Use version `3` for current discovery and new shared-camera appearance recipes;
retain version `1` or `2` when replaying an existing document or when live DOM
camera planes are specifically required. Use the existing `worldbend.run` with
`effect_catalog`, `effect_recipe`, or
`effect_plan`. Exact input/output schemas are available through
`worldbend.describe`. Known operations do not need search first; broad requests
can discover these operations through the existing compact catalog.

```json
{"operation":"effect_catalog","arguments":{"version":"3","intent":"depth","carrier":"web","query":""}}
```

For a native SwiftUI stage, use `"carrier":"swiftui"`. All versions return
only `layered-depth`; its saved recipe is the delivery artifact. The App keeps
gesture recognition, interruption, reduced-motion presentation and return
animation locally and may choose a smaller host-only implementation after a
real comparison. That choice is valid feedback only after the Agent actually
consults the capability; lack of discovery is not evidence that the tool had no
value.

For Figma authoring, use `"carrier":"figma"` with version `3`. The plugin's
Depth workspace is the human surface: select two through eight exportable
layers, preserve the Recipe's named far-to-near plane order, tune the shared camera and
appearance, inspect motion by dragging the preview, and Apply a still image.
The stored task retains the complete recipe and reference state, so changing
source bindings or reopening the result does not require recreating the
effect. The settled published image has no temporal trail; motion settings stay
in the recipe for subsequent preview and delivery.

```json
{"operation":"effect_recipe","arguments":{"effect":"multiplane-camera","version":"3","viewport":{"width":600,"height":400},"intensity":0.8}}
```

Pass the returned recipe unchanged to `effect_plan`, with
`state: {progress: 0.35, pointerX: 0.7, pointerY: -0.4, reducedMotion: false}`.
For motion exposure, also pass `{previousState, elapsedSeconds}`; omit it or use
identical states for a sharp settled frame.
Save the recipe and returned fingerprint for subsequent calls. Editing is
explicit: change the data, inspect its new plan, then accept the new fingerprint.

The equivalent CLI commands are `worldbend effect-catalog --input query.json
--json`, `worldbend effect-recipe --input request.json --json`, and `worldbend
effect-plan --input saved-request.json --json`. All are read-only computations.

## Embed an actual result

The optional `@worldbend/web/effects` entry exports `discoverEffects`,
`createEffectRecipe`, `planEffect`, `attachEffect` and
`attachDocumentEffect`. The latter consumes one interactive result from a
Spatial Document delivery plan, preserves its canonical asset bindings and
checks its recipe fingerprint. The ordinary perspective entry does not load
the effect catalog, recipe engine or window renderer.

```ts
import { createEffectRecipe, attachEffect } from '@worldbend/web/effects';

const recipe = await createEffectRecipe({
  effect: 'multiplane-camera', version: '3',
  viewport: { width: 600, height: 400 }, intensity: 0.8,
});
const state = { progress: 1, pointerX: 0, pointerY: 0, reducedMotion: false };
const binding = await attachEffect(recipe, {
  background: { element: backgroundCanvas, source: backgroundImage },
  middle: { element: middleCanvas, source: middleImage },
  foreground: { element: foregroundCanvas, source: foregroundImage },
}, state);
const next = { ...state, pointerX: 0.5 };
await binding.update(next, { previousState: state, elapsedSeconds: 1 / 60 });
await binding.update(next, { previousState: next, elapsedSeconds: 1 / 60 });
const savedRecipe = binding.getRecipe();
const plan = binding.getPlan();
const fingerprint = plan.fingerprint;
const exposed = plan.frames.filter(frame => frame.coverage?.viewportCovered === false);
// Later: attachEffect(savedRecipe, slots, state, { expectedFingerprint: fingerprint })
binding.dispose();
```

Put the named elements in a positioned container sized to the recipe's logical
viewport. A host may scale that whole viewport to fit a responsive frame. To
change the geometry's logical dimensions, author a new explicit recipe and
inspect it; no resize silently rewrites a saved design. Supply exactly one
distinct element per slot. Plane, version-2 camera-plane and strip slots retain
live DOM content and controls. Window slots require `{element: canvas, source:
decodedMedia}`; version-3 appearance planes use the same shape and add
`depthMap` only when their recipe declares one. Arbitrary DOM is not captured
as a texture. Per-window and spatial-appearance pixel/source budgets are owned
by their respective contracts.

`update` snapshots complete state, coalesces to the latest request and returns
false on rejection, supersession or disposal. Invalid state preserves the last
accepted plan. `getRecipe`/`getPlan` return copies. Rebinding ownership disposes
the previous binding; disposal restores only owned style properties. `pause`,
`resume`, `refresh` and `setSource` reuse the local media lifecycle. The binding
does not own media playback or replace DOM content. Core planning is atomic;
there is no cross-canvas GPU transaction. Graphics failures are reported and
context restoration redraws the retained plan.

`attachDocumentEffect` retains the update, refresh, pause, resume and dispose
lifecycle plus `replaceAsset`; it does not expose slot-level texture mutators. Call it
with a durable document asset ID rather than a recipe slot ID. It finds every
decoded content/depth-map role from the compiled delivery, validates the whole
proposed relationship before changing a slot, and serializes replacements. If
a renderer fails partway through, the adapter attempts to restore the previous
sources and reports any incomplete restoration; this is recovery across local
renderers, not a cross-canvas GPU transaction. Live DOM remains host-owned and
cannot be replaced by decoded media through this method.

## Compare and continue working

Serve the SDK package directory and open `examples/effects.html`. Choose the
active candidate and an expression, then use either viewport, keyboard arrows
or controls to drive both candidates with the same state and content. Compare
the relationship that matters: shared alignment, depth separation, perspective,
source exposure, fixed content, readability or responsiveness. The initial
comparison puts translation-only `layered-depth` beside `multiplane-camera`.
Keep the simpler alternative when it serves the intent better. The application
does not generate a score or pick a winner.

Open `examples/appearance.html` for the independent three-way rendering
fixture: clear shared-camera geometry, depth of field with an explicit depth
map, and explicit motion exposure. It is the visual acceptance surface for
version `3`; a downstream App is not required to unblock Worldbend validation.

Open `examples/document.html` for one complete continued-work fixture. It loads
two core-compiled Spatial Document delivery plans, attaches its three asset-bound
planes, preserves a long host-owned product message across responsive layouts,
and replaces one release by durable asset ID while advancing the document
fingerprint without rebuilding the recipe.
The acceptance path also rejects undecoded replacement media, retries with a
valid source, and verifies that source replacement remains available while the
system requests reduced motion. This reference task exercises general document
continuation; it is not the product's market or capability ceiling.

The study file is `worldbend.effect-study`, version `1`, with exactly two
`{recipe, fingerprint}` candidates, a complete state, and explicit preview
content. Built-in artwork records its version and theme; an uploaded image is
normalized to PNG and stored with a separate SHA-256 digest of its data URL.
Files are bounded to 8 MB, embedded PNG URLs to 6 million characters, imported
images to 2048 per axis. Source upload accepts PNG/JPEG/WebP up to 12 MB and
32 MP, then normalizes its longest axis to at most 1600. This is a portable
preview, not an archive of the original high-resolution source.

Opening validates both candidates and media before replacing either current
candidate. An invalid or obsolete file leaves current work usable. Save/open
retains the explicit recipes; a modified recipe is not silently rebuilt from
its original preset. Native DOM bindings in production are supplied by the
host, not serialized into a study file.

For an important visual decision, the Agent should inspect real motion and
compare meaningful alternatives using the actual content. For a known small
edit, run the saved recipe directly. The catalog and preview support selection. Inspect the rendered result with
the actual content and interaction before using it.

From a source checkout, `pnpm test:spatial-effects` builds the native/Web
carriers and exercises the real CLI, MCP and WASM paths without changing an
installed plugin. Core tests freeze versioned recipe identities. Web tests
cover bindings, cancellation and recovery. For rendered checks, serve the Web
package: `examples/surface-window-check.html` exercises WebGL pixels and media;
`scripts/effects-browser-check.js` exports a check accepting a Playwright page
on `examples/effects.html`, covering comparison, actual file save/open, portable
images, authored compositions, keyboard and reduced-motion behavior. The
appearance fixture additionally covers optical focus independent of camera
convergence, explicit motion settling, depth-map rendering, responsive layout,
and WebGL context recovery. The same runtime command recompiles both document
versions through the native core, compares them with the packaged Web fixtures,
then exercises source replacement, revision identity, recovery and responsive
rendering.
