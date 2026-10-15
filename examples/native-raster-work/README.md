# Native completed-frame work receiving

This iOS17+/macOS14+ SwiftUI source example receives the same fixed Blender/Three
work twice: original print/4 seconds, revised print/6 seconds. It keeps the
normalized viewing position, supplies play/pause/seek/reset/stop and resizes the
host-owned layout. The accepted work remains visible during replacement and
after a failed candidate. It does not mutate the source work or App repository.

Prepare each work using `scripts/package-raster-work.mjs` over the ordinary
Spatial Document and actual `renderSceneFrames` receipt/PNGs. Keep
`work-initial` and `work-revised` in a fixed candidate directory; both include
editable source assets, core document/plan, manifest and candidate receipt.
The receipt pins are read once at sample startup. They detect later byte changes;
this example does not authenticate the origin of a user-selected directory.

```sh
swift run --package-path examples/native-raster-work \
  --scratch-path .task-notes/native-raster-example-build \
  WorldbendRasterReceiving --candidate-root <fixed-candidate-directory>
```

Set `WORLDBEND_APPEARANCE_PACKAGE` to a standalone exported WorldbendAppearance
source package to build against the fixed consumer candidate instead of the
checkout. This sample is not an installation. iOS needs an application target
and resources in its bundle; no iOS build or consumer acceptance is implied by
a macOS SwiftPM build.

The work receiver publishes completed sRGB premultiplied-BGRA8 CVPixelBuffers
into the existing FrameHub. This example shows `WorldbendOpticalFrameScene`'s
shared CGImage path; a product may use the existing Metal-direct scene/panes.
The complete path includes CPU PNG decode and buffer upload. A missing compiled
Metal library still requires the existing explicit fallback. Host controls and
optical overlays never enter their own sampled completed frame.

Background suspension freezes time and retains the last frame. Disappearance
stops and clears only this producer's frame. Reduced motion starts paused and
remains explicitly playable/scrubbable; this example does not autoplay. App owns
event eligibility, visibility, audio, durable preferences and business history.
Camera/material/print edits require rebaking the retained canonical source.
This is not realtime3D, seeded particle simulation or history-dependent replay.
