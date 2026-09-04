# Worldbend for Figma distribution

Worldbend's Figma runtime is self-contained. It needs Figma Desktop, but it
does not need a source checkout, Node, pnpm, Rust, a local server, or network
access at runtime.

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
  Composition, Mesh, and Lens & maps remain available under More as advanced
  transforms; their human labels do not change stored contract identities.
- Select one locally exportable source layer. Image-filled Rectangles and
  Frames are covered by the current runtime flow.
- Applying creates a raster Rectangle with an Image fill. The original source,
  including editable Frame children, stays unchanged.
- Select the original source together with a prior Worldbend result to
  continue editing or replace that result in place.
- Four-corner manipulation lives in the plugin panel; the plugin does not
  pretend to provide native document-canvas transform handles.
- Free Distort moves one corner. Perspective Distort locks to the first
  dominant axis and moves only the documented same-row or same-column pair.
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

If a workflow requires perspective-deformed text, components, constraints, or
Frame children to remain editable, it is outside this raster product contract.

## Free Community distribution

Designers receive the approved plugin through Figma Community, not through the
private GitHub repository or the internal ZIP. The Community listing is free:
the plugin does not request Figma's Payments API, open checkout, require a
trial, or collect payment details. See
[`FIGMA_COMMUNITY_RELEASE.md`](FIGMA_COMMUNITY_RELEASE.md) for listing copy,
privacy disclosure, required media, and the account-owned submission boundary.
