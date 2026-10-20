# Motion contract

`worldbend.motion@0.1` adds explicit timebase and easing semantics above the
existing ordered Timeline renderer. It is independently versioned so the
legacy `worldbend.timeline@0.1` wire contract remains unchanged.

## Timebase and frames

A `MotionSpec` contains a fixed positive output size, a reduced rational frame
rate `{numerator, denominator}`, and one keyframe program. Numerator is at most
240,000, denominator is at most 1,001, and the resulting rate must be between 1
and 240 frames per second. Equivalent unreduced rates are rejected so one
timeline has one wire identity.

The program names one source, declares 1..240 frames, carries a base
`TransformSpec`, and supplies strictly increasing keyframes that explicitly
cover frame zero and the last frame. Each planned frame records the exact
rational presentation time `frameIndex * denominator / numerator`, reduced to
lowest terms. Duration is the final frame's presentation time; no encoded
audio or video duration is implied.

## Easing

Each keyframe except the last may declare `easingToNext`; omission means
`linear`. The last keyframe must omit easing. Supported easing is:

- `linear`;
- `hold`, which retains the left keyframe until the right endpoint;
- `cubicBezier {x1,y1,x2,y2}`, with x controls in `[0,1]` and y controls in
  `[-4,4]`.

Cubic-bezier progress solves the monotonic x curve by a fixed 32-step bisection
and then evaluates y. The eased progress and every interpolated quad are finite;
each frame must still pass the ordinary TransformSpec solve. Overshoot is
therefore allowed only when the resulting plane remains mechanically valid.

## Plan and publication

Planning returns the timebase, exact duration, per-frame segment/progress/time
facts, and a resolved `worldbend.timeline@0.1` plan. Native rendering converts
that plan into explicit Timeline frames and reuses the current exact-source
binding, cumulative limits, cancellation cleanup, and single atomic PNG
directory publication. The result correlates every image with its motion frame
and exact presentation time; it does not encode GIF, APNG, or video.

The separate [Video contract](VIDEO_CONTRACT.md) reuses canonical Motion timing
and geometry for opaque MP4 delivery, an explicit background and actual decoded
frame validation. Its complete display duration includes the last frame interval;
it does not alter this PNG route or Motion's last-presentation-time duration.

CLI and compact Agent operations expose plan and render. No human carrier,
ComfyUI carrier, or conditional portable Capability operation is implied.

## Non-goals

The contract does not estimate motion, interpolate pixels or optical flow,
choose keyframes, resample audio, promise real-time playback, or define a
general animation scene graph.


## Multi-plane mockup motion

Timed multi-plane device/scene geometry is owned by
`worldbend.mockup-motion@0.1` (see [VIDEO_CONTRACT.md](VIDEO_CONTRACT.md#mockup-video-multi-plane-delivery)).
It reuses this contract's keyframe, easing and rational presentation-time rules
per plane, expands each frame into an ordinary MockupSpec, and does not replace
single-source Motion or Timeline PNG sequences.

The [Web scene receiver](MOCKUP_MOTION_RECEIVING.md) executes those authored
frames with playback/seek and guarded continued source/design use. It shares
the core expansion and has no independent interpolation model.

An optional `presentation` retains a whole-scene TransformSpec, explicit pixel
viewport `size`, complete Spatial Template `output` and selected `outputId`.
Optional `keyframes` animate the whole destination quad in its declared
coordinate space, using the same endpoint, easing and interpolation semantics
as plane motion. The core expands and validates every whole-view frame before
execution; named framing and its output dimensions remain fixed. Frame expansion still
returns the raw authored scene; the presentation plan identifies the final
output dimensions and selected CanvasPlan. The Web receiver and native video
apply it after layer composition, through their existing Transform/Canvas
executors. All named output definitions remain in the authored program.
`presentationFrames`, when present, supplies the canonical whole-view plan for
each time. Missing/empty keys retain the previous static presentation wire shape.
This is authored 2D/2.5D view motion, not a three-dimensional camera reconstruction.
Version `0.1` supports one ordered whole-view presentation stage. Static Raster
Programs retain their independent composition semantics.

Raw, whole-viewport and selected output passes each retain the existing timed
pixel envelope. `cumulativeOutputPixels` describes final pixels;
`cumulativeProcessingPixels`, when present, reports the composed/whole/framing
work separately. MP4 axes are checked against the final selected output, so an
odd raw scene can explicitly produce a valid even-sized framed movie. Frame
dimensions never change implicitly.

Each MockupMotion plane may retain an authored `surface` and projected-alpha
`shadow` with the same static Mockup semantics. These parameters remain constant
for that plane; frame expansion changes its authored placement. Both controls
survive native video planning, temporal Spatial Documents and return to a static
Figma authoring task. See [Mockup shadows](MOCKUP_CONTRACT.md#projected-source-alpha-shadows).

## Shared mockup motion authoring

`author_mockup_motion` owns edits to an ordinary MockupMotionSpec. The CLI
`mockup-motion-authoring`, MCP `run` operation `mockup_motion_authoring`, WASM
`mockup_motion_authoring_json` and Web `authorMockupMotion` expose the same
closed Create/Inspect/Revise input. Create retains the complete admitted static
Mockup, including clipping, seams, grid, measurement, surface and shadow. Inspect
returns a canonical SHA-256 fingerprint, exact display duration and pose frames.
Revise requires that fingerprint and returns a new complete program. Failure
publishes no candidate. SetPose revises multiple connected planes before whole
scene validation; a seam is never relaxed to admit a half-edited pose.

SetScenePose accepts the complete static scene at one selected frame. It updates
that frame's plane placement atomically while retaining every other authored
time, and carries scene style, source slots, plane order and supported metadata.
Changing coordinate space converts retained quads through the requested canvas;
a style-only change does not invent a new pose. The existing plane ID set must
remain exact. Whole-program validation precedes publication.

Edits set, capture, move or remove keyframes, retime, replace one complete plane,
or reorder the existing plane set. Capture samples core frame expansion. Retime
maps frame indices with integer nearest rounding and refuses collisions between
existing authored poses. Removing required endpoint poses, duplicate plane IDs,
invalid geometry or broken declared seams is rejected. Grid and measurement
survive frame expansion and temporal return alongside surface and shadow.
SetPresentationKeyframe and RemovePresentationKeyframe author the whole view.
The first whole-view key edit establishes the existing first/last view; required
endpoints cannot be removed. Whole and plane poses retime together and participate
in the authoring keyframe summary. SetPresentationAtFrame accepts a sampled
whole presentation, retains its other key poses and changes only the selected
view when its quad differs; style/framing changes preserve all view poses.
It converts retained quads when the destination coordinate space changes.
SetPresentation replaces or removes whole-scene framing under the same
fingerprint guard, retaining all plane poses and sources. Invalid framing
publishes no candidate. Figma whole edits synchronize this accepted presentation
before saving or playback; the shared receiver performs it once.

MCP returns a direct complete result up to 16 KiB; larger admitted programs use
exact UTF-8 pages with a whole-result SHA-256 token. Later parts require the same
token. The complete result is bounded at 4 MiB; paging is never truncation.
Figma's Composition inspector now uses this authoring export for frame seeking,
direct pose edits, whole-scene pose capture, selected-layer pose removal,
duration/easing and playback. Its saved result and template retain the complete
program plus a poster frame. Playback uses the shared Web receiver and core
expansion, preserving Composition postprocessing and the selected named output.
It animates linked layers; native scene decorations outside those layers remain
host objects. This version does not provide whole-native-scene temporal delivery
or encoding inside the Figma host.
