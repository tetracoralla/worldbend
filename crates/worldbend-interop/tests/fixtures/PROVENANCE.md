# Photoshop Smart Object fixtures

`photoshop-cc-placed-layer.psd` and `photoshop-cc-placed-layer.psb` are metadata-sanitized
copies of `tests/psd_files/placedLayer.psd` and `placedLayer.psb` from
`psd-tools/psd-tools` commit
`6fb7bd5215069ed63cbe009e921c3f33aa97a3ec` (2026-09-02).

- upstream: <https://github.com/psd-tools/psd-tools>
- Upstream PSD SHA-256:
  `69ea01bf88cb85c48d3a78c3bb9e06ae141c9c9fc6a88267eae95c315e16180e`
- Upstream PSB SHA-256:
  `066eeb1bce9c123ffcb57f380d9a51e0687024fdd264904ed3a44c3d5666490c`
- license: MIT; see `LICENSE.psd-tools.txt` in this directory

The upstream suite opens `placedLayer.psd` as its Smart Object fixture. The
embedded XMP identifies Adobe Photoshop CC 2014 (Macintosh) as the creator;
the PSB history also records Adobe Photoshop CC 2017 (Macintosh). Worldbend
keeps both formats to calibrate read-only inspection and Spatial Template
projection against traced Photoshop-produced bytes. These fixtures do not
establish compatibility with every Photoshop version, warp variant, Smart
Filter, color mode, or malformed input.

## Local metadata sanitization

Each fixture contains two XMP `stRef:filePath` values and two UTF-16LE linked
file descriptor paths with upstream developer home directories. These eight
values are replaced with relative `fixtures/`
paths: preserve the original basename, insert underscores between `fixtures/`
and that basename until the byte length matches the original value. UTF-16LE values preserve their code-unit count and encoding. No image,
layer, Smart Object transform, embedded payload or binary block length changes.
The parser never resolves these metadata paths. Upstream originals remain
available at the pinned commit above; local regression tests check the sanitized
hashes and the same layer/importability/placement behavior.

- Sanitized PSD SHA-256: `c5cf4d58ec42500adecca9f91c8b77fe5d6f464b8edf3609f00f042e56d3c450`
- Sanitized PSB SHA-256: `09f67cf916b40fddcfdfa79f08fb7ea065ea8c6e262b96cfd171cdb9d6632abf`
