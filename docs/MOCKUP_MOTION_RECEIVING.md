# Receive a scene with continued motion

An authored `presentation` carries a whole-scene transform, explicit pixel
viewport, complete named output definitions and selected output. The receiver
uses the core presentation solve/CanvasPlan after composing every raw layer.
Plans and the optional Warp mesh prepare before playback; ticks do not plan
geometry or request an Agent. `setPresentation` uses ordinary guarded authoring,
and source/output revision retains the work and relative playhead. The extra
whole-rendering context joins loss/restoration and disposal: partial restoration
cannot resume the scene. Native video consumes the same program.

The Web `@worldbend/web/mockup-motion` entry receives an ordinary
`worldbend.mockup-motion@0.1` program and decoded source images. The same program
can remain in a temporal Spatial Document or enter native mockup-video delivery.
This binding adds browser playback and seeking; it does not reinterpret the
work as a separate animation format.

```ts
import { attachMockupMotion } from "@worldbend/web/mockup-motion";

const scene = await attachMockupMotion(container, authoredScene, [
  { id: "screen", image: screenBitmap },
  { id: "foreground", image: foregroundBitmap },
], { paused: true, onError: showReceivingError });

scene.seek(750);
scene.play();
scene.pause();
await scene.update(nextScene, nextSources, {
  expectedRevision: scene.getState().revision,
  signal: updateCancellation.signal,
});
// End the receiving instance when its host view retires.
scene.destroy();
```

Supply exactly one image per distinct authored source ID, with no extras. Images
are snapshotted into owned immutable bitmaps during preparation; later changes
to a caller-owned canvas or video do not silently change accepted work. A source
replacement is an explicit guarded update. The caller still owns its input
images, and the binding closes only its own snapshots.

The core expands keyframes, easing, rational times and frame geometry, then
resolves each ordinary Mockup plan, including seams and content fitting. The
receiver prepares those frames once. Playback selects an authored frame by its
presentation interval; it makes no per-frame WASM, MCP or model calls. WebGL
projects the core homographies and warp meshes, and Canvas composites ordered
planes, opacity, explicit background and compound clipping. Web antialiasing
and texture sampling differ from native raster execution; equal canonical
geometry does not establish identical pixels.

Optional plane shadows project the same source alpha into a core-planned
expanded sampling window. Canvas applies Gaussian softness, tint and combined
opacity before each caster. This preserves transparent holes and shadows cast
back into the scene by off-canvas artwork. It also removes the need for a
separate shadow bitmap in a reusable scene. Curved surfaces and their content
Warp remain active in both caster passes. The expanded raster is bounded by
core planning and the receiving WebGL texture limit.
The receiver retains at most two WebGL drawing buffers: one for ordinary planes
and one lazily created for expanded shadow casters. This avoids alternating a
single drawing buffer's dimensions for every plane. Loss of either pauses the
scene; a partial restoration does not report readiness, and both are retired
with the receiver. This also adds one bounded texture/rendering context when
shadows are active; it is not a claim of a particular display frame rate.

Display duration includes the final frame interval, as in encoded video. Seeking
to that duration shows the final frame. Playback stops there by default; replay
starts from the beginning. `loop: true` is an explicit host choice and does not
make an authored first/last pose continuous automatically. The same core frame,
plane and cumulative-pixel budgets apply. Snapshot acquisition additionally caps
the distinct decoded source set at 64 Mi pixels, and the actual WebGL texture
limit is enforced before the visible result is replaced.

Updates prepare privately while the last accepted scene remains visible. The
guard names the accepted design/assets revision, which starts at 1; playback and
seeking do not change it. A successful update advances that revision once and
preserves the latest local relative playhead and pause, including a retiming
that changes display duration. A stale request, missing source, invalid geometry,
snapshot failure or cancellation leaves the accepted work and revision intact.
One pending update is admitted per instance; another receives a busy error.
Cancelled and retired late snapshots are closed, and the next update can retry.

The binding appends one decorative, noninteractive canvas. It preserves host
content, event handlers and focus order. The host owns playback/seek controls,
its accessible scene description and its layout. Hidden pages, offscreen hosts,
`setVisible(false)` and reduced-motion preferences suspend the clock without
losing its position. Reduced motion retains explicit seeking to inspect poses.
Context loss keeps the last visible composite and reports `lost`; actual context
restoration rebuilds renderer resources and repaints the same accepted work and
playhead. Disposal removes only the owned canvas, snapshots, renderer and
subscriptions. Throwing host callbacks cannot corrupt accepted state.

The [book scene example](../packages/web/examples/scene-motion/README.md) carries
first-party artwork through playback, source replacement and retiming. Current
Chromium/WebGL2 receiving and actual MP4 decode/playback support that flow;
other browser/device performance and Figma keyframe authoring remain separate
acceptance work. This receiver does not implement arbitrary 3D.

## Continue authoring in the receiver

`getAuthoring()` returns the accepted core program and fingerprint.
`getAuthoringGuard()` additionally names this receiving instance and its actual
revision. `author(edit, guard)` prepares and atomically publishes a core revision
using the retained source snapshots. It returns the authored result and the guard
for that exact publication, captured before host callbacks run. Guards from
another instance or an older human/Agent edit are refused. No-op edits retain
the runtime revision. Assigning an unavailable source requires an explicit source
update first. Playback and seeking do not invalidate a design guard.

Cancellation exits promptly even when browser bitmap acquisition is blocked;
late bitmaps are closed when they arrive. The last accepted visible scene remains
available for retry. The first-party [Scene Studio](../packages/web/examples/scene-studio/README.md)
combines this API with direct manipulation, timeline, history, durable local
Spatial Documents and native PNG/MP4 delivery. Its local asset registry and
checkpoint journal are carrier persistence, not another geometry authority.

Optional whole-view key poses now execute through prepared canonical
`presentationFrames`. Receiving samples neither poses nor easing independently.
The same view frame matches ordinary static Transform/framing execution; a
retime that would merge whole-view poses is rejected without changing pixels,
time or revision. All view poses and sibling outputs survive artwork revision.

The whole-view book fixture explicitly authors a transparent scene over a fixed
warm ivory stage. Opening and closing holds keep reading time around the eased
view change. This is an authored staging choice, not automatic background
separation or a generic camera inference rule.
