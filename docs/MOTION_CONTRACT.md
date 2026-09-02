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

CLI and compact Agent operations expose plan and render. No human carrier,
ComfyUI carrier, or conditional portable Capability operation is implied.

## Non-goals

The contract does not estimate motion, interpolate pixels or optical flow,
choose keyframes, resample audio, promise real-time playback, or define a
general animation scene graph.
