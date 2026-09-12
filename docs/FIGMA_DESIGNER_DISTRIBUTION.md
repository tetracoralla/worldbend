# Worldbend for Figma distribution

Worldbend's Figma runtime is self-contained. It needs Figma Desktop, but it
does not need a source checkout, Node, pnpm, Rust, a local server, or network
access at runtime.

Designers should use the free [Community plugin](https://www.figma.com/community/plugin/1675767923532475446/worldbend).
Figma delivers approved updates through that listing. The development archive
below is for contributors and isolated verification, not the normal update path.

## Install an internal development build

1. Obtain `worldbend-figma-<version>.zip` from an authorized private build.
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

Compare that value with the checksum recorded by the private build. The
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
- `THIRD_PARTY_NOTICES.md`
- `licenses/` for the locked non-development Rust dependency closure
- `sbom/worldbend-figma-wasm.spdx.json`
- `SHA256SUMS.txt`

The packager rejects missing or unexpected entries, checksums every file,
normalizes archive timestamps for reproducible bytes, and reopens the final ZIP
before reporting its path, byte size, and SHA-256.

## Product behavior

- Perspective, Sizes, and Templates form the persistent repeat-use navigation.
  Composition, Mesh, Split Warp, and Lens & maps remain available under More as
  advanced transforms; their human labels do not change stored contract identities.
  Warp's **Continue in Mesh** carries the current plane and any active preset
  into Mesh as an editable grid; Mesh opened from More does the same. Split Warp
  seeds the live plane as a 1×1 Bezier envelope and does not convert a Warp
  preset into cubic handles. Mesh and Split Warp can save named presets into
  Templates. Copy CSS emits a core `matrix3d` for Transform/Distort without
  Warp; Warp, Mesh, and Split Warp stay raster.
- Select one locally exportable source layer. Image-filled Rectangles and
  Frames are covered by the current runtime flow.
- New HD Image creates a raster Rectangle with an Image fill. The original
  source stays unchanged. New Editable Frame is available
  for supported clipped Frames when the companion effect is available; see
  [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md) for acquisition, rendering and Undo limits.
- Select a saved result alone to reopen its source and transform. Update HD
  Image or Update Frame replaces that result in place; either New action
  creates an independent result. Legacy results without a source binding, or
  results whose source was deleted, need a source selected together with them.
  Invalid saved geometry requires starting again from the source.
- Edit native Frame children directly on the Figma canvas. An HD image is a
  stable snapshot: edits to its source appear in the reopened preview and
  reach the image only when Update HD Image is chosen.
- Four-corner manipulation lives in the plugin panel; the plugin does not
  pretend to provide native document-canvas transform handles.
- The Perspective toolbar and the Composition inspector both offer
  **Copy placement parameters**: the current placement document as JSON on the
  clipboard, for handoff to another tool. Correct mode is excluded because its
  quad is not a destination placement.
- Free Distort moves one corner. Perspective Distort locks to the first
  dominant axis and moves only the documented same-row or same-column pair.
- Repeat Last Transform stages the previous result onto the current source
  and stays reachable from the Distort mode a fresh selection opens in; the
  primary Apply then publishes it. A Warp operation cannot publish editable
  output, so on native-capable files the primary Apply falls back to the HD
  image route instead of disabling itself.
- Fast outward drags use bounded camera assistance. Perspective assistance
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
native content with a sampled perspective appearance; they do not turn text
or vector paths into projectively deformed vector geometry. The companion effect
is not bundled as an installable resource in this ZIP, so installing the plugin
alone does not establish editable-output availability in another account.

## Free Community distribution

Designers receive the approved plugin through Figma Community, not through the
private GitHub repository or the internal ZIP. The Community listing is free:
the plugin does not request Figma's Payments API, open checkout, require a
trial, or collect payment details. See
[`FIGMA_COMMUNITY_RELEASE.md`](FIGMA_COMMUNITY_RELEASE.md) for listing copy,
privacy disclosure, media, and submission checks.
