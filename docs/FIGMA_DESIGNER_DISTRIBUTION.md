# Worldbend for Figma distribution

Worldbend's Figma runtime is self-contained. It needs Figma Desktop, but it
does not need a source checkout, Node, pnpm, Rust, a local server, or network
access at runtime.

Designers should use the free [Community plugin](https://www.figma.com/community/plugin/1675767923532475446/worldbend).
Figma delivers approved updates through that listing. The development archive
below is for contributors and isolated verification, not the normal update path.

## Install a development build

1. Obtain `worldbend-figma-<version>.zip` from a trusted release build.
2. Extract the entire ZIP. Figma cannot run the manifest from inside the ZIP.
3. In Figma Desktop, choose **Plugins → Development → Import plugin from
   manifest…** and select the extracted `manifest.json`.
4. Run **Worldbend** from **Plugins → Development**.

This is a local development-plugin installation. It does not auto-update. To
upgrade, download the newer release asset, replace the extracted folder, and
reload or re-import its manifest.

Verify the download before importing it:

```bash
shasum -a 256 worldbend-figma-<version>.zip
```

Compare that value with the checksum recorded by the release build. The
archive's own `SHA256SUMS.txt` covers every runtime and accompanying file.

## Build the archive from source

From a reviewed checkout:

```bash
pnpm package:figma-designer
```

The command rebuilds the plugin and creates an extracted folder and ZIP under
the ignored `artifacts/figma/` directory. It verifies this exact inventory:

- `manifest.json`
- `dist/main.js`
- `dist/ui.html`
- `README.md`
- `LICENSE` and `NOTICE`
- `THIRD_PARTY_NOTICES.md`
- `licenses/` for the locked non-development Rust dependency closure
- `sbom/worldbend-figma-wasm.spdx.json`
- `SHA256SUMS.txt`

The packager rejects missing or unexpected entries, checksums every file,
normalizes archive timestamps for reproducible bytes, and reopens the final ZIP
before reporting its path, byte size, and SHA-256.

## Product behavior

- Perspective, Sizes, Depth, and Templates form the persistent repeat-use navigation.
  With two through eight selected layers, Depth preserves the Recipe's named
  far-to-near planes, previews one shared camera plus depth and motion
  appearance, and publishes a linked raster result whose complete recipe can
  be reopened. Three selected layers retain the familiar Background, Middle,
  and Foreground preset.
  Composition, Mesh, Pin Warp, Lens & maps and Appearance are first-class
  tabs in the navigation strip; their human labels do not change stored contract identities.
  Warp's **Continue in Mesh** carries the current plane and any active preset
  into Mesh as an editable grid; Mesh opened from its tab does the same. Pin Warp
  seeds the live plane as a 1×1 Bezier envelope and does not convert a Warp
  preset into cubic handles. Mesh and Pin Warp can save named presets into
  Templates. Copy CSS emits a core `matrix3d` for Transform/Distort without
  Warp; Warp, Mesh, and Pin Warp use Native Vector or raster output, not CSS.
- Select one locally exportable source layer. Image-filled Rectangles and
  Frames are covered by the current runtime flow.
- New Linked HD Image creates a raster Rectangle with an Image fill. The original
  source stays unchanged. New Editable Frame retains live native content for
  supported clipped Frames. Affine results use native component/instance
  transforms; projective appearance needs the companion effect. See
  [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md) for acquisition, rendering and Undo limits.
- New Native Vector is available for solid native rectangles, ellipses, polygons,
  stars and bounded straight or cubic paths, including rounded corners,
  compound regions, supported solid strokes and bounded whole Frames/Groups.
  Warp, Pin, Mesh, Liquify and fitted guide work retain their complete controls
  for later update; the Native Vector/HD output selector is in the owning editor.
  It publishes exact affine geometry, bounded nonlinear/projective approximations or
  outlined text/strokes with a visible fidelity report and no companion effect.
  Native outlining supports solid dashed, outside, multiple and per-side
  strokes; text becomes editable outlines rather than live text. Gradients,
  image paints, brush/variable-width strokes, effects, masks and unsupported or
  overly complex artwork keep the linked HD image route. The exact capture
  boundaries live in [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md).
- Select a saved result alone to reopen its source and transform. Update HD
  Image, Update Frame or Update Native Vector replaces the matching result in
  place; New creates an independent result. A supported Frame may offer both
  native choices. If the vector core refuses freshly captured geometry, the
  original Vector stays unchanged and a separate HD image is created with an
  explicit fallback notice. Legacy results without a source binding, or
  results whose source was deleted, need a source selected together with them.
  Invalid saved geometry requires starting again from the source.
- Edit native Frame children directly on the Figma canvas. An HD image is a
  stable snapshot: edits to its source appear in the reopened preview and
  reach the image only when Update Linked HD Image is chosen.
- Figma Motion owns timing and easing for a saved projective Frame. Compatible
  Perspective updates and source replacement preserve its native tracks. While
  Motion is open, Worldbend keeps the result readable but requires returning to
  Design before Edit source or in-place Update Frame. Incompatible size changes
  are refused rather than silently reinterpreting existing keyframes; Worldbend
  does not provide a second timeline.
- Four-corner manipulation lives in the plugin panel; the plugin does not
  pretend to provide native document-canvas transform handles.
- The Perspective toolbar and the Composition inspector both offer
  **Copy placement parameters**: the current placement document as JSON on the
  clipboard, for handoff to another tool. Correct mode is excluded because its
  quad is not a destination placement.
- Free Distort moves one corner. Symmetric dragging locks to the first
  dominant axis and moves only the documented same-row or same-column pair.
- Repeat Last Transform stages the previous result onto the current source
  and stays reachable from the Distort mode a fresh selection opens in; the
  primary Apply then publishes it. Warp is not an Editable Frame operation;
  Native Vector or linked HD remain available independently of the companion.
- Fast outward drags use bounded camera assistance. Symmetric assistance
  advances only on fresh pointer movement and settles while the pointer is
  held still.
- Apply may export the selected source at a higher density than the interactive
  preview before rendering once. It never upscales the preview bitmap.
- Output is capped at 4096 pixels per axis because Figma's `createImage` API
  rejects larger images. Larger PNGs must use the native CLI.

Before a Community update, run `pnpm test:remap-parity` on a host with Chrome
or Chromium. It compares native and actual WebGL Lens/Displacement output at
standard preview and high final-output quality; this supplements rather than
replaces the exact Figma Desktop flows.

HD images do not retain editable children. Editable Frames retain independent
native content with a sampled perspective appearance. The separate Native
Vector route projectively rewrites only its declared bounded path-and-stroke
subset and refuses unsupported appearance instead of flattening it. The companion effect
is not bundled as an installable resource in this ZIP, so installing the plugin
alone does not establish editable-output availability in another account.

## Free Community distribution

Designers receive the approved plugin through Figma Community, not through the
source repository or a development ZIP. The Community listing is free:
the plugin does not request Figma's Payments API, open checkout, require a
trial, or collect payment details. See
[`FIGMA_COMMUNITY_RELEASE.md`](FIGMA_COMMUNITY_RELEASE.md) for listing copy,
privacy disclosure, media, and submission checks.
