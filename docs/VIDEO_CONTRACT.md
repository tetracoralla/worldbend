# Encoded video contract

Mockup-motion can retain an explicit whole-scene presentation. Video applies
the authored whole Transform and selected fixed named framing after ordinary
layer composition. MP4 validation and decode checks use that final output size;
the raw scene canvas remains available for pose authoring. The unchanged native
Transform/Canvas executors own pixels and cancellation. Named sibling definitions
and all keyframes stay in the program for later revision and Figma return.
See [Motion presentation](MOTION_CONTRACT.md#multi-plane-mockup-motion).

`worldbend.video@0.1` carries an authored Motion program, explicit opaque
background and encoding policy through native video delivery. Geometry, easing,
source identity and presentation times use the existing canonical Motion and
Timeline expansion; the encoder does not introduce another transform model.

## Portable authored state and duration

A VideoSpec has `schema: "worldbend.video"`, `version: "0.1"`, `motion`,
`backgroundRgb: [r,g,b]` in sRGB8 and
`encoding: {format: "mp4H264", crf: 0..51}`. All objects are closed; the explicit
background is required. Existing Motion semantics supply reduced rational rates,
first/last-covered keyframes, easing and 1..240 frames.

Each frame retains Motion's exact rational presentation time. Video duration
includes the final frame's display interval: `frameCount * denominator / numerator`.
Motion's `duration` remains the last frame's presentation time. One-frame video
therefore has a positive display duration, while its Motion duration is zero.

The current MP4/H.264 profile uses even output axes of at least two pixels,
opaque 8-bit limited-range yuv420p, BT.709 primaries/matrix and sRGB transfer
metadata. There is no automatic resize, guessed alpha flattening or audio.
The native executor composites straight-alpha raster pixels onto the explicit
sRGB8 background before encoding. H.264 and chroma subsampling are lossy; a
decoded frame is not an exact PNG. Other alpha/HDR/audio profiles remain
separate work, rather than silently changing this profile.

Video allows up to 256 Mi cumulative output pixels within the unchanged 240-frame
bound. Ordinary Motion/Timeline PNG routes retain their 64 Mi pixel ceiling.
Both profiles expand and solve frames with the same core functions; Video's
bounded execution holds one decoded source and one rendered frame at a time.

## Host encoder and execution

A portable VideoSpec contains no executable path or arbitrary encoder arguments.
The host selects existing absolute FFmpeg and FFprobe paths through
`FfmpegEncoder`; CLI `video-render` exposes those explicit host options.
MCP startup accepts the same `--ffmpeg` / `--ffprobe` pair or the host settings
`WORLDBEND_FFMPEG` / `WORLDBEND_FFPROBE`. Both paths are required together.
Other MCP operations work without this optional configuration; `video_render`
then returns a typed unavailable-encoder result. Paths and arbitrary arguments
are excluded from Agent input schemas.
Worldbend does not download or bundle them. This profile needs FFmpeg's
`libx264` encoder. Unavailable tools, invalid tool identity, a missing codec or
failed encoding return a typed failure. Native library callers can supply an
expected source SHA-256 and a cancellation callback.

The full native profile accepts its existing PNG/JPEG/WebP/TIFF and supported
outlined SVG sources. The actual encoded source read remains byte-bounded if the
file grows after metadata acquisition; malformed digest claims reject without
echoing them. Lossy video output uses a destination separate from its source,
including when overwrite is requested.

Native execution:

1. validates the authored plan, exact source set, raster limits and destination;
2. verifies the selected tool identities and decodes/hashes the actual source;
3. renders canonical frames in a private directory under the destination parent,
   composites the background and records each pre-encode PNG digest;
4. encodes a silent MP4 with exact rational rate and track/movie timescales;
5. actually decodes it with FFprobe, requiring one H.264 yuv420p video stream,
   the authored dimensions and color metadata, every frame in order at its exact
   integer track timestamp, and the complete final-frame interval;
6. hashes and syncs the finished file, then publishes atomically.

The default deadline is 90 seconds (configurable through 120 seconds), with bounded
128 MiB video, 512 MiB private PNG staging and 128 KiB tool response/16 KiB
diagnostics. Lower per-request limits are supported; zero or larger profile
limits reject before work. Staging stops at its byte ceiling. Cancellation,
timeouts, malformed decoded evidence and encoder failure publish no file and
remove owned temporary output. A collision preserves the existing destination;
replacement requires explicit overwrite. Dry-run still renders, encodes, decodes
and hashes, then removes staging without publishing.

Unix execution owns an isolated encoder process group; cancellation retires it
and its descendants. The video CLI catches SIGINT/SIGTERM so ordinary cleanup
returns `E_CANCELLED`. Windows uses the console Ctrl+C/Ctrl+Break handler and
terminates its direct configured encoder process. Windows runtime and descendant
wrapper behavior require their own evidence. Abrupt host termination or SIGKILL
cannot run language-level cleanup and is distinct from supported cancellation.

## Workspace-granted Agent execution

The progressive MCP catalog supplies `video_plan` and `video_render`; the eight
direct tools retain their existing projection. Planning needs no filesystem or
encoder. Rendering requires one explicit workspace root, exactly the authored
source ID and a separate relative `.mp4` destination. An optional `sourceSha256`
assertion is checked against the bytes actually copied from the held source.
Existing source/destination aliases reject even with overwrite. File acquisition
and final publication remain descriptor-confined across pathname replacement.

Video shares the existing two-worker/four-admission gate. Its whole-call deadline
includes queueing, source staging, encoding, decoding, response preflight and
same-parent output staging; the default is 90 seconds and the ceiling 120.
Ordinary render operations retain their 20-second profile. Unix workers own
isolated groups and their encoders inherit that group. Retirement precedes
reaping the worker, retaining its PID until all group signalling is finished.
macOS measures the aggregate footprint of living group members against 768 MiB;
Linux inherits the existing per-process address-space limit, and Windows uses
the worker's inherited resource job. Windows and Linux runtime behavior require
platform-specific evidence. An unexplained signal is not proof of memory breach.
Supervised tool failures return their typed reason without waiting for a
descendant that retained a diagnostic pipe; controller retirement then ends
that entire worker scope. Normal pipe draining shares the encoding deadline.

The controller checks the complete canonical plan, source correlation, frame
times/digests, decode count, encoder profile, output identity and byte ceilings.
It sizes the final MCP response before publication. A cancellable bounded copier
verifies the actual MP4 bytes while staging through the held workspace parent.
One final cancellation/deadline check precedes synchronous atomic publication;
there is no asynchronous copy or encoding after that check. Dry-run drops the
verified staging file. This same final barrier protects the existing MCP
single-file raster, media, vector, rectification, program, mockup, mesh, surface,
deformation and remap output paths, with a 512 MiB encoded-file staging ceiling.

## Mockup-video multi-plane delivery

`worldbend.mockup-video@0.1` authors one `MockupMotionSpec`: shared canvas,
timebase, frame count, and 1..16 planes. Each plane reuses Motion keyframes
(first/last coverage, easing) over a base `TransformSpec`. Planning expands
every frame into an ordinary `MockupSpec` so seams/clip/opacity, optional curved
surfaces and projected-alpha shadows stay mockup
semantics. Display duration matches Video (includes the final frame interval).
Native render composites each frame, applies the explicit opaque sRGB8 matte,
and encodes with the same bounded FFmpeg profile as single-source Video.
Sources must exactly match the authored plane `sourceId` set.

Development check:

```sh
cargo build --release -p worldbend-cli
node scripts/mockup-video-runtime-check.mjs \
  --ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe \
  --evidence local-output/video-check
```

## Result and continuation

VideoRenderResult correlates the original VideoPlan, exact source digest and
dimensions, frame presentation times and pre-encode raster digests, actual tool
versions, decoded frame count, encoded byte count/hash, output identity and
publication status. A dry-run is `ready`; a published file is `written`.
Pre-encode raster digests are never labeled decoded-video pixel proof.

Reusing the saved specification with new source bytes retains the program.
Retiming changes exact frame times and encoded duration without changing the
canonical transforms. Library source-digest assertions detect stale preparation;
CLI reads the currently supplied source and reports those actual bytes.

`video-inspect` plans without acquiring tools or touching media.
`video-render` executes the native CLI loop; `video_render` supplies its
workspace-granted MCP route. Single-source Motion video remains the opaque MP4 foundation (`worldbend.video@0.1`).
Multi-plane device/scene geometry now has a sibling delivery
`worldbend.mockup-video@0.1`: timed `worldbend.mockup-motion@0.1` planes expand
into ordinary mockup composites per frame, then reuse the same host-selected
FFmpeg/FFprobe encode, matte, decode-check and atomic publication profile.
CLI `mockup-video-inspect` / `mockup-video-render` and the example
`examples/device-scene-video.worldbend.json` exercise parallax plane motion with
inspectable stills. Spatial Document temporal expressions bind
`worldbend.mockup-video@0.1` into document inspect/update/delivery.
The ready-scene temporal example (`examples/ready-scene-document-video.worldbend.json`
and `scripts/ready-scene-document-video-runtime-check.mjs`) binds ready-scene
rasters through that document, then revises one asset identity and regenerates
stills+MP4 without recreating geometry. Figma motion/video authoring
projects published Mockup work plus an authored mockup-video Spec into that
temporal document through `figma_work_continuation` `projectTemporal`, and
`revise` returns Mockup authoring poses while keyframes/encode stay
document-side. Figma does not host MP4 publication or a keyframe timeline UI;
Depth workspace motion-blur export remains separate.

Development verification:
build the current optimized CLI with `cargo build --release -p worldbend-cli`, then
`node scripts/video-runtime-check.mjs --ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe --source /absolute/current.png --replacement /absolute/next.png --evidence .task-notes/video-runtime`
uses distinct actual source bytes, native publication/dry-run/collision/retiming,
external Unix cancellation/recovery and a real Chrome decoder with keyboard
play/pause and seeking. The host tool paths must be supplied. `--cli` can select
another explicitly built current executable. Unoptimized debug rendering does
not establish the bounded profile's runtime performance.

After building the current optimized MCP, `node scripts/video-mcp-runtime-check.mjs
--ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe --source /absolute/current.png
--replacement /absolute/next.png --evidence .task-notes/video-mcp-runtime` checks
the actual source-server entry, configured tools, source/time revisions,
confinement, render/encoder cancellation, worker interruption, destination
preservation, cleanup/recovery and browser decoding. These are development
runtime observations, separate from installed-host and Figma authoring acceptance.

The encoder options follow [FFmpeg's command documentation](https://ffmpeg.org/ffmpeg.html)
and [MP4/image-sequence format documentation](https://ffmpeg.org/ffmpeg-formats.html).
Windows cancellation uses [SetConsoleCtrlHandler](https://learn.microsoft.com/en-us/windows/console/setconsolectrlhandler).

Whole-view motion uses each canonical `presentationFrames` plan before named
framing and encoding. Source replacement, final dimensions, cancellation and
encoder/probe checks follow the same mockup-video path. The whole-view keys
remain in its authored Spec; encoded frames do not replace that work.
