# Spatial window 0.1

A developer can place a moving, frosted window over a stationary content plane.
The optional Web carrier renders locally as input changes. Folded screens and
movable frosted panes use this same operation; the host owns gestures, animation
timing and business actions. No Agent call, network service or inference runs
per frame.

## Geometry and visibility

`SurfaceWindowSpec` is independent of `TransformSpec` and `MotionSpec`:

```json
{
  "schema": "worldbend.surface-window",
  "version": "0.1",
  "contentSize": { "width": 620, "height": 400 },
  "contentOrigin": { "x": -310, "y": 0 },
  "windowSize": { "width": 310, "height": 400 },
  "pose": {
    "perspective": 1500,
    "rotateY": -50,
    "pivot": { "x": 0, "y": 0.5 },
    "perspectiveOrigin": { "x": 0, "y": 0.5 }
  },
  "frost": { "baseRadius": 0, "spread": 0.13, "maxRadius": 30 }
}
```

Coordinates and sizes use logical CSS pixels. Texture dimensions are independent.
The complete decoded source stretches over `contentSize` at `contentOrigin`,
relative to the unposed window's top-left. This content plane stays at z=0.
`pose` uses the existing [plane pose contract](PLANE_POSE_CONTRACT.md): rotations
X, Y, Z in that order, then translation/depth and perspective. The eye is at
`(perspectiveOrigin.x * windowWidth, perspectiveOrigin.y * windowHeight,
perspective)` in that coordinate system. Layout position outside the window's
CSS transform moves both its window and its content reference; update
`contentOrigin` when independently relocating a window relative to content.

`plan_surface_window` returns `SurfaceWindowPlan` (schema
`worldbend.surface-window-plan`, version `0.1`) with the validated spec and:

- `visibility`: `visible`, `edge-on` or `back-facing`.
- `mapping`, present only for visible faces: the existing `CssTransform`, a
  row-major 3×3 `sampleHomography`, and `[a,b,c]` `depthPlane`.

For local window point `(x,y)`, divide the first two components of
`sampleHomography * (x,y,1)` by its third component to obtain content UV.
The core derives this mapping from the same projection that produces the CSS
transform. Applying both places sampled features at their stationary projected
positions. The Web renderer does not estimate a camera or solve another pose.

`z(x,y) = a*x + b*y + c`. Frost radius, measured in logical content pixels, is
`min(maxRadius, baseRadius + spread * abs(z))`. This is an explicit artistic
separation rule, not a calibrated optical depth-of-field model. At zero
separation and zero base radius the source is sharp, subject to resampling.

The core tests projected signed area after translation and scale normalization.
Absolute area <= 1e-8 is `edge-on`; negative area is `back-facing`. These faces
produce no mapping. The renderer hides them and never reuses the preceding
visible face. Other invalid geometry remains an error. Existing `pose` and
`TransformSpec` validation, winding and error behavior are unchanged.

A two-sided fold uses **two explicitly oriented windows**, not mirrored corner
order. With panel width w, height h and opening angle t in [0,180]:

| Face | CSS left | contentOrigin.x | rotateY | pivot.x / perspectiveOrigin.x |
| --- | --- | --- | --- | --- |
| Outer | 0 | 0 | t | 1 |
| Inner | w | -w | t - 180 | 0 |

Both use contentSize `(2w,h)`, windowSize `(w,h)`, origin.y=0, pivot.y and
perspectiveOrigin.y=.5, and the same perspective distance. Their hinge and eye
coincide in the host layout. Each controls its own visible face. The host owns
layer ordering and background coverage; this operation does not resolve
intersections between arbitrary surfaces.

## Figma folding-screen still

Preset effects applies one representative folding-screen workpiece to the
selected artwork. It uses the same two-sided window relation above, with a
useful mid-fold default and a bounded amount control. A fixed left half remains
native clipped content; the visible folding face uses canonical window sampling,
including distance-varying frost, followed by canonical projection. The plugin
constructs its vector mask, projected image and native glass finish with an
outline and shadow. The finish shows the folding silhouette outside the sampled
content, where window sampling is transparent. It retains the native original
for later editing. It requires no prepared overlay or multi-Frame storyboard.
Preview is static; one Apply produces or updates one workpiece. Local ownership
and recovery follow [CARD_CONTRACT.md](CARD_CONTRACT.md#figma-preset-stills).

## Web carrier

Import only `@worldbend/web/surface-window`. It exports:

- `planSurfaceWindow(spec): Promise<SurfaceWindowPlan>` for a standalone plan.
- `attachSurfaceWindow(canvas, source, spec, options?)` for local drawing.
- The spec, plan, source, binding/options types and `TransformError`.

```ts
import { attachSurfaceWindow } from '@worldbend/web/surface-window';
await image.decode();
const binding = attachSurfaceWindow(outputCanvas, image, spec, {
  pixelRatio: Math.min(devicePixelRatio, 2),
  maxPixels: 4_194_304,
  onError: error => showFallback(error)
});
const applied = await binding.update(nextCompleteSpec);
// Following a source-canvas edit:
await binding.refresh();
// Decoded content replacement does not restart the geometry or own playback:
await binding.setSource(nextImage);
// Stop drawing while the host effect is suspended:
binding.pause();
await binding.resume();
// On removal:
binding.dispose();
```

`update` accepts a complete spec, takes an isolated copy and coalesces to at most
one running calculation and one latest pending request. Superseded, failed and
disposed requests settle false. While paused or document-hidden, a valid update
can settle true by recording the accepted plan without drawing it. `getPlan`
returns an isolated snapshot. The first attachment also schedules an update;
use the returned boolean from an explicit `update` when readiness matters.

`refresh` marks source pixels dirty and schedules at most one refresh; only the
latest waiting refresh settles true. It does not supersede pending geometry.
Canvas sources require explicit refresh after drawing. Video sources refresh on
video-frame callbacks (or currentTime polling while playing), plus play, pause,
seek and loaded-data events. Playback ownership remains with the host. No idle
frame loop runs for unchanged images or canvases. `pause` and hidden documents
suspend drawing; resume and document visibility restore the latest accepted
plan and content. The host should also stop its own animation timers.

`setSource` rejects undecoded, oversized or unsupported replacements. Failed
uploads keep the preceding accepted source. Geometry failure keeps the last
accepted plan. Drawing/context errors are reported through `onError` or a
`worldbenderror` CustomEvent on the output canvas; the host decides its visible
fallback. An error callback must not throw. Context loss hides the canvas,
reports `E_RENDER`, retains the latest plan and reinitializes GPU resources on
restoration. If the browser never restores the context, provide a host retry or
static fallback; restoration is not guaranteed by Worldbend.

Bindings share single ownership of an output element with the perspective
bindings. A new binding disposes its predecessor. `dispose` cancels pending
work, releases owned GPU resources/listeners and restores original inline
styles (including priority) and canvas dimensions. It does not restore pixels
that predated the binding. The canvas context is exclusively owned while bound;
use a dedicated output canvas. Caller images, video, canvas and ImageBitmap are
not destroyed. Close caller-owned ImageBitmaps when no longer needed.

`getStatus` reports disposal, pause, context loss, draw/upload counters, actual
pixel ratio and backing dimensions. Counters describe submitted work, not GPU
completion times. `windowBackingSize` provides the same bounded sizing decision
for diagnostics; call it with already validated positive dimensions/budgets.

## Sampling, sources and limits

This carrier requires WebGL2. It accepts decoded `HTMLImageElement`,
`HTMLVideoElement`, `HTMLCanvasElement`, `OffscreenCanvas`, and `ImageBitmap`.
The source must be origin-clean and sampleable by WebGL. Set cross-origin media
CORS before assigning its URL and wait for decoding. For video, wait for a
presented frame (`requestVideoFrameCallback` where available), not just metadata
or a load event: a browser may report readyState before sampleable pixels exist; a cross-origin iframe or
arbitrary DOM subtree is not a texture source. The output cannot sample itself.

The renderer uses premultiplied alpha, transparent samples outside [0,1] UV,
linear/mipmap filtering and a bounded 5×5 weighted blur. Large blur radii use
coarser mip levels to avoid separated repeated images. Blur is an approximation
in the browser's ordinary RGBA color space, not linear-light photographic
filtering. ImageBitmap inputs are normalized through one reusable 2D canvas because
WebGL ignores unpack premultiplication flags for ImageBitmap. Video uses direct
sub-image uploads. Texture storage and its mip chain are reused while source
dimensions remain the same; hidden faces stop automatic video uploads. GPU mip filtering at the very edge uses clamping;
no ray wrapping or mirrored sampling is implied.

Limits are explicit:

| Quantity | Bound |
| --- | --- |
| Content/window dimensions | 1..8192 logical pixels per axis |
| Content origin, translation, depth, perspective magnitude | <= 1,000,000; perspective also >=1 |
| Projected coordinates | finite, magnitude <=1,000,000 |
| Frost | 0 <= baseRadius <= maxRadius <=64; 0 <= spread <=1 |
| Decoded source | <= min(device texture limit,8192) per axis and <=16,777,216 pixels |
| Requested backing density | .25..4; default min(devicePixelRatio,2) |
| Backing budget | 1..16,777,216 pixels; default 4,194,304 |
| Backing axis | <= min(device texture/renderbuffer/viewport limits,4096) |

When output exceeds its budget, backing resolution is reduced; logical geometry
stays the same. `getStatus` exposes the actual dimensions/density, including the
minimum one-pixel axis. Input texture limits reject with `E_OUTPUT_LIMIT` instead
of silently resizing. Pixel budgets bound texture sizes, not all browser memory:
mipmaps, staging copies, compositing and source decode also consume memory.

Arbitrary live DOM controls keep their real interaction through the existing
`@worldbend/web/perspective` CSS route. The spatial-window texture itself has no
DOM hit-testing, accessibility tree or hidden form controls. For a frosted
transition over UI, author an explicit visual source, leave controls outside
the window, or hand off back to the real DOM when the transition finishes.
Respect reduced-motion preferences in the host; the sample demonstrates it.

## Agent and CLI integration

The Agent catalog has one new on-demand operation, `window_plan`, with the
ordinary spec fields directly in `arguments`. It does not add a top-level tool.
Search for fold, frost or spatial window; describe `window_plan` for its exact
schema. The CLI equivalent is `worldbend window-plan --input spec.json --json`.
Both return geometry/visibility, not a screenshot or a running browser.

Install the independent local SDK archive (`assets/web/worldbend-web.tgz`
relative to the installed Skill directory) and import the optional entry.
Source development builds a new candidate with `pnpm package:web` under
`artifacts/web/`; an older installed archive does not gain source changes. The archive includes all modules, but static imports
of `@worldbend/web/perspective` do not load the window renderer or its WASM.
`@worldbend/web` also does not import the new entry. The window build is a
separate WASM feature profile, so loading it does not fetch the full raster core.
Agent runtime archives omit demo pages; the full local SDK package contains them.

The new family is available in Rust/full CLI/MCP and the optional Web carrier.
It is not exposed in the current Figma or ComfyUI carriers, portable Capability
projection or a native SwiftUI/Metal adapter. No existing Figma UI route changes.

## Choosing the smallest useful route

For simple layer parallax, translate each DOM/native layer directly. For a
parallel pane with uniform blur, native CSS `backdrop-filter` plus clipping may
already satisfy the task. Both avoid source-texture preparation. A plain CSS
transform rotates its content together with the surface; a single uniform blur
cannot represent a hinge's continuously changing separation. This module is
useful when explicit pose, stationary content and distance-dependent sampling
must remain coupled. It is not required for every animation.

The two examples in `examples/surface-window.html` reuse this one binding. The
runtime checks in `examples/surface-window-check.html` exercise real WASM/WebGL,
pixel placement, transparency, frost, media refresh and lifecycle. Browser
measurements are observations on that browser/device, not phone frame-rate SLAs.
See the repository tests for independent core ray/projection checks.
