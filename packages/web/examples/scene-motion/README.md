# Field notes scene

This receiving study presents the existing “Across the ordinary.” artwork as
a jacket, spine and soft contact shadow. A slow change of viewpoint reveals the
spine and gives the cover a quiet pause before returning. The ink/teal artwork
and ochre revision keep the same composition; these are first-party original
assets under this repository's Apache-2.0 license.

Build the Web package and serve the repository locally:

```sh
pnpm build:web:package
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `/packages/web/examples/scene-motion/`. Play/pause or use Position to inspect
the scene. Next artwork replaces the design without resetting its pose; Slower
rhythm retimes the same work from three to four seconds. Both controls preserve
the current relative position and pause. Native keyboard range input and
reduced-motion static inspection remain available on narrow layouts.

`scene.json` is an ordinary core MockupMotionSpec. `artwork.js` supplies decoded
source canvases; a separate consumer can provide its own images under the same
source IDs. The receiver snapshots the images rather than taking ownership of
the application canvases. No Figma account is required for this entry.

For native output, save each original source canvas as PNG, then put the same
scene into `worldbend.mockup-video@0.1` with an explicit opaque `backgroundRgb`
and `{ format: "mp4H264", crf: 18 }` encoding. Use the ordinary CLI
`mockup-video-inspect` / `mockup-video-render` routes with the exact three source
IDs. The receiving check saves those source files and the authored scene to its
explicit evidence directory. Actual native/WASM plans agree over all 96 frames;
the video is 960×720, contains 96 decoded frames and displays for four seconds
after the rhythm revision. Web sampling and lossy video pixels differ.

```sh
node scripts/mockup-motion-receiving-check.mjs \
  --evidence .worldbend-work/scene-motion-receiving
```

This runs the built package with actual scene pixels, trusted pointer/keyboard
controls, guarded revision, invalid-input preservation, cancellation/retry,
immutable image snapshots, actual WebGL context loss/restoration, late retirement,
reduced motion and mobile reflow. It creates and retires its own browser process.
See [receiving semantics](../../../../docs/MOCKUP_MOTION_RECEIVING.md).
