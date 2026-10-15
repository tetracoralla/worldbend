# Field Notes editions

An original artwork study with two authored compositions: one suspended cover
and a layered edition series. The source-alpha shadow follows each cover's
placement and source replacement. No separate shadow image is needed.

Build `pnpm build:web:package`, serve the repository locally, and open
`/packages/web/examples/scene-shadow/`. Play or seek the four-second movement,
switch Presentation, adjust Shadow and Softness, replace the artwork, or save
the current image. Keyboard controls and a narrow layout remain available.
Rapid revisions are coalesced; cancellation retains the last accepted scene.
Retirement closes the active receiver; a page return recreates it with the
accepted artwork, composition, playhead and pause intent.

`scene.js` supplies ordinary core MockupMotionSpecs. The artwork comes from
the first-party [Field Notes source](../scene-motion/artwork.js), under this
repository's Apache-2.0 license. The cover source ID stays stable across both
compositions. A consumer can supply its own decoded image under that ID.

```sh
node scripts/mockup-shadow-receiving-check.mjs --evidence .task-notes/scene-shadow
```

The built-package check verifies actual transparent-hole and off-canvas shadow
pixels, softness, tint/opacity, rapid revision, source replacement, rejected
candidate recovery, real WebGL loss/restoration and mobile layout. It saves
the two motion programs, WASM plans, stills and original source PNG for native
inspection/rendering. Use the same source in ordinary `mockup-video-render`
with a MockupVideoSpec wrapper for playable output. Carrier sampling and blur
approximations differ; shared plans do not promise identical raster pixels.

To verify the saved programs through source CLI/MCP, native PNG/MP4 and actual
browser movie playback, build the native binaries and provide local FFmpeg paths:

```sh
node scripts/mockup-shadow-native-check.mjs --evidence .task-notes/scene-shadow \
  --cli target/release/worldbend --ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe
```

The two native movies are 960×720 at 24 fps, 96 decoded frames and four seconds.
The check also exercises source MCP image publication with the full-resolution
600×800 artwork in a smaller authored scene and compares its bytes with CLI.
Native/WASM motion frames match; sampled caster geometry and matrix values match
numerically (JSON signed-zero serialization is normalized). Floating diagnostic
lengths allow a bounded rounding difference, without changing projection values.
