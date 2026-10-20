# Spatial appearance: depth of field and explicit motion exposure

Spatial appearance is Worldbend's deterministic rendering layer over the
versioned shared-camera effect. It makes authored depth visible through bounded
optical and temporal sampling; it does not infer a scene, relight artwork, or
turn flat assets into 3D objects. Version `3` is the first version that carries
these semantics. Versions `1` and `2`, including their recipe fingerprints,
remain unchanged.

## Version-3 recipe

A version-3 camera recipe may add `appearance` with `depthOfField`,
`motionBlur`, or both. At least one must be present. Appearance is valid only
when every layer is a `camera-plane` under one shared camera.

`camera.focusDistance` retains its version-2 meaning: the look-at/convergence
plane used by the shared pinhole projection. It is not optical focus. Optical
focus is `appearance.depthOfField.focusDistance`, so a host can keep the same
viewpoint geometry while focusing the rear, middle, or front plane.

Depth of field contains:

- `focusDistance` in `[1,1000000]` world-distance units;
- `focusRange` in `[1,1000000]`, the full sharp interval centered on optical
  focus;
- `maxBlurRadius` in `[0,64]` logical source pixels.

For a plane distance `d`, the planned blur radius is:

```text
outside = abs(d - focusDistance) - focusRange / 2
radius  = maxBlurRadius * clamp(outside / focusRange, 0, 1)
```

The plan repeats the optical settings, plane distance, and resolved plane-level
radius for every frame. When a depth map is declared, the renderer applies the
same formula per pixel and the reported plane-level radius remains the fallback
for the authored plane distance. A zero radius is an explicit clear result, not
an omitted effect.

Motion blur contains:

- `exposureFraction` in `[0,1]`, the fraction of the supplied frame interval
  for which the virtual shutter is open;
- `maxBlurRadius` in `[0,64]`, the screen-space trail clamp in logical pixels.

There is no clock, accumulated velocity, retained prior frame, or hidden
animation history. `effect_plan` accepts an optional `motion` value containing
the complete `previousState` and `elapsedSeconds` in `[0.001,10]`. The core
projects both states, reports screen velocity in logical pixels per second,
multiplies it by `elapsedSeconds * exposureFraction`, clamps that trail, and
maps it through the current inverse transform to a source-space sampling
vector. Omitting `motion`, supplying identical states, setting zero exposure,
or evaluating reduced motion produces zero vectors. Supplying `motion` to a
recipe without motion blur is an error rather than ignored input.

## Explicit per-pixel depth

A version-3 camera plane may declare `surface.depthMap` as
`{nearDistance, farDistance}` with positive values and `nearDistance <
farDistance`. It is allowed only when the recipe has depth of field. The Web
host then binds one decoded grayscale map with exactly the content source's
pixel dimensions. Red `0` maps to `nearDistance`; red `1` maps to
`farDistance`; intermediate values interpolate linearly. The map affects only
that plane's depth-of-field sampling.

The declaration and its distance mapping are recipe data and therefore part
of the fingerprint. The map pixels remain caller-owned media, like the content
texture, and are not part of recipe identity. Worldbend never generates,
selects, segments, aligns, or repairs a depth map. A model may propose one in
an upstream workflow, but a caller must inspect and explicitly bind the chosen
map before deterministic execution.

## Web texture carrier

Version-3 `multiplane-camera` is a Web texture effect. Every named plane binds
`{element: canvas, source: decodedMedia}`; a plane that declares a depth map
also binds `depthMap`. Arbitrary DOM capture is not performed. Versions `1`
and `2` keep their existing DOM and texture behavior.

`@worldbend/web/effects` renders each appearance plane with WebGL2. It samples
premultiplied content, treats coordinates outside the source as transparent,
and combines a bounded 16-tap depth disk with a directional motion trail. GPU
filtering is a carrier rendering detail; the core plan remains the authority
for focus, radius, timing, and vectors. Sources are limited to 8192 pixels per
axis and 16 megapixels. Drawing buffers honor the binding's `pixelRatio`,
`maxPixels` (default 4 megapixels), and the current GPU limit. Depth-map and
content dimensions must match.

The binding retains accepted decoded sources for context restoration, hides a
plane while its context is lost, reports the error, rebuilds resources after
restoration, and redraws the last accepted plan. `refresh`, `setSource`,
`setDepthMap`, `pause`, `resume`, ownership replacement, and disposal preserve
the existing effects lifecycle. Planning is atomic; multiple canvases cannot
offer a cross-context GPU transaction.

```ts
const recipe = await createEffectRecipe({
  effect: 'multiplane-camera', version: '3',
  viewport: { width: 600, height: 400 }, intensity: 0.8,
});
recipe.origin = null;
const backgroundPlane = recipe.layers.find(layer => layer.id === 'background');
if (backgroundPlane?.surface.kind === 'camera-plane') {
  backgroundPlane.surface.depthMap = { nearDistance: 900, farDistance: 1800 };
}
const current = { progress: 1, pointerX: 0.7, pointerY: -0.3, reducedMotion: false };
const previous = { ...current, pointerX: 0.2 };
const binding = await attachEffect(recipe, {
  background: { element: backgroundCanvas, source: background, depthMap },
  middle: { element: middleCanvas, source: middle },
  foreground: { element: foregroundCanvas, source: foreground },
}, previous);
await binding.update(current, { previousState: previous, elapsedSeconds: 1 / 60 });
await binding.update(current, { previousState: current, elapsedSeconds: 1 / 60 });
```

The second update explicitly settles motion blur to zero. Hosts own event
timing and must do this when a drag, scrub, or animation stops.

## Figma bounded multi-plane authoring carrier

Figma exposes version-3 `multiplane-camera` as the primary **Depth** workspace
when two through eight exportable layers are selected. Selection order
initializes the Recipe's named planes from far to near. Exactly three sources
retain the familiar background, middle, and foreground preset; other counts
receive stable `layer-1` through `layer-N` identities. The designer can swap
source bindings without altering their node contents. The workspace authors
one shared camera, separate convergence and optical focus, plane
distances, depth-of-field limits, motion exposure, current pointer state, and
reduced motion. It consumes the same core recipe and plan as Web.

The Figma renderer is deliberately narrower than the Web texture carrier. It
supports the plan's plane-level blur radius and source-space motion vector, but
not per-pixel depth maps. It samples the selected layer exports locally, clips
the composite to the recipe viewport, and publishes one raster still. A drag
passes explicit previous/current state and elapsed time; 120 ms without a new
sample settles motion to zero. Apply also renders the settled state, so motion
settings survive in the recipe while the saved still does not freeze a
transient trail. Figma's 4096-pixel image-axis limit applies to every published
result and the built-in 10% source overscan is included in preview texture
limits.

Each result stores the full effect task and the ordered source-node binding.
Selecting it alone reopens the same recipe and resolves the current source
pixels. An Agent can inspect that exact published state and stage a
core-validated replacement behind its revision fingerprint; the stage is only
a semantic draft. The plugin must load it, render the actual Figma sources, and
Apply before published pixels or revision change. This preserves one recipe
across designer and Agent work without pretending that a headless staging call
has visually approved or rendered the result.

## Visual fixture and product boundary

Serve the Web package and open `examples/appearance.html`. It puts clear
geometry, depth of field with an explicit depth map, and motion blur beside one
another under the same artwork, camera, and input. Pointer, keyboard, sliders,
focus changes, reduced motion, interruption, responsive layout, and WebGL
context recovery are part of the fixture's acceptance path.

`pnpm test:appearance` builds that carrier and runs the same acceptance helper
in a supervised real Chrome session. It also attempts a focus change during
initial construction: controls and direct-manipulation surfaces must remain
unavailable until all three candidates are accepted, then become available
together. The check uses temporary screenshots and removes them on completion.

This capability is a reusable Worldbend primitive. An independent receiving app
may pin and integrate a verified package version on its own schedule; that App
is neither the development loop nor a blocking acceptance environment for this
contract. Relighting, shadow synthesis, automatic depth/flow, per-object
segmentation, bokeh simulation, rolling shutter, per-pixel velocity, occlusion
reconstruction, and 3D scene recovery remain separate capabilities.
