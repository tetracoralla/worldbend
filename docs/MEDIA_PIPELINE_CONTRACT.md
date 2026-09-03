# Production media, vector, and tiled-output contract

Worldbend's production media layer preserves the existing deterministic
TransformSpec geometry. It changes decoding, channel precision, encoding, and
publication behavior; it does not create a second transform model.

## Production raster input and output

`media_inspect` and `media_render` accept PNG, JPEG, lossless WebP, and TIFF.
Inspection reports the decoded sample format (`u8`, `u16`, or `f32`), color
model, alpha presence, orientation application, encoded byte count, source
digest, and any embedded ICC profile digest and byte count.

Rendering converts decoded pixels to RGBA float for inverse mapping and
premultiplied-alpha interpolation. Output is explicit:

- PNG supports `u8` and `u16`;
- TIFF supports `u8`, `u16`, and `f32`;
- JPEG requires quality in `1..100` plus an explicit opaque RGB matte;
- WebP is lossless `u8`.

`preserve` precision follows the source only where the selected encoder can
represent it. Unsupported combinations are rejected; they do not silently
change format. Every result reports `precisionReduced`, `alphaFlattened`,
`lossyEncoding`, and/or `iccProfileDiscarded` when applicable.

ICC handling is intentionally narrow. `preserve` validates and embeds the
opaque profile; `discard` removes it and reports that loss. Worldbend does not
perform profile-to-profile conversion in this version. Interpolation uses the
stored channel values, and the result reports
`profilePreservedWithoutConversion`, `profileDiscardedWithoutConversion`, or
`untaggedChannelValues`. Profile preservation is not a colorimetric equivalence
claim.

Production media decoding and one complete output remain limited to 12 MiP so
the float source, mip pyramid, and output fit the bounded worker. Dry-run still
decodes, solves, samples, encodes, and hashes, but does not publish. Successful
single-file publication is atomic and the reported digest is read from the
encoded temporary file.

## High-precision displacement controls

`worldbend.remap@0.1` retains the original `displacement` operation, whose
neutral is an 8-bit integer. The additive `displacementUnit` operation declares
neutral in `[0,1]`. Its map is sampled in the decoded u8, u16, or f32 channel
precision before neutral subtraction; the renderer does not quantize the map
to u8 first. Both operations keep explicit channels, pixel scales, and
transparent/clamp/wrap boundary behavior. This is deterministic control-raster
execution, not inferred depth or optical flow.

## Vector-preserving carriers

`vector_render` accepts one bounded UTF-8 SVG source plus explicit intrinsic
element size and TransformSpec. The source bytes are preserved inside a data
URL:

- the `.svg` carrier emits an affine SVG image wrapper and rejects genuine
  projective terms;
- the `.html` carrier emits a projective CSS `matrix3d` wrapper and supports
  affine or projective TransformSpec values;
- non-zero Warp is rejected by both because it is not one projective matrix.

The source is not sanitized, rewritten, or rasterized. External resources
referenced by the SVG are not fetched or bundled. The vector source limit is
8 MiB, the generated carrier limit is 16 MiB, and the declared canvas axis is
bounded. Dry-run and atomic single-file publication match production raster
behavior.

## Large-output tiling

`tiled_media_render` renders one TransformSpec into sequential independent
tiles while keeping global destination coordinates. The source and one bounded
mip pyramid remain resident; a full destination canvas is never allocated.
This distinction is explicit: the operation supports large destination output,
not unbounded source decoding.

The new output directory contains only row-major files named
`tile-rNNNN-cNNNN.<format>` and `worldbend.tiled-media.json`. The manifest is
`worldbend.tiled-media@0.1` and records source/media facts, placement, exact
tile geometry, bytes, digests, solve diagnostics, and loss disclosures. Tile
filenames are relative so the manifest does not leak controller-private paths.
Every tile samples in the same global coordinate system; tile boundaries do
not restart projection or filtering.

The engine bounds the virtual canvas to 262,144 pixels per axis, 1 billion
output pixels, 4,096 tiles, 12 Mi pixels per independently allocated tile, and
8 GiB encoded output. The Agent projection is narrower: 64 MiP, 512 tiles, and
512 MiB. Its 512-tile ceiling is passed into the worker and checked before tile
rendering rather than imposed only on the returned manifest. A normalized
destination requires an explicit target size in vector and tiled routes, just
as it does in the ordinary raster route. A late failure, cancellation,
encoded-byte overrun, response overrun, dry-run, or staging error publishes no
directory. The final publication step is one no-replace directory commit.

## Carrier projection

CLI and the compact Agent catalog expose media inspection/rendering,
vector-preserving output, and tiled output. These operations do not enlarge the
eight-tool direct MCP compatibility surface. Web and Figma continue to consume
their current bounded interactive projections. In particular, Figma's 4096px
image API does not become a large-output tile consumer merely because the
headless source superset can tile.
