# Photoshop Smart Object fixtures

`photoshop-cc-placed-layer.psd` and `photoshop-cc-placed-layer.psb` are exact
copies of `tests/psd_files/placedLayer.psd` and `placedLayer.psb` from
`psd-tools/psd-tools` commit
`6fb7bd5215069ed63cbe009e921c3f33aa97a3ec` (2026-09-02).

- upstream: <https://github.com/psd-tools/psd-tools>
- PSD SHA-256:
  `69ea01bf88cb85c48d3a78c3bb9e06ae141c9c9fc6a88267eae95c315e16180e`
- PSB SHA-256:
  `066eeb1bce9c123ffcb57f380d9a51e0687024fdd264904ed3a44c3d5666490c`
- license: MIT; see `LICENSE.psd-tools.txt` in this directory

The upstream suite opens `placedLayer.psd` as its Smart Object fixture. The
embedded XMP identifies Adobe Photoshop CC 2014 (Macintosh) as the creator;
the PSB history also records Adobe Photoshop CC 2017 (Macintosh). Worldbend
keeps both formats to calibrate read-only inspection and Spatial Template
projection against traced Photoshop-produced bytes. These fixtures do not
establish compatibility with every Photoshop version, warp variant, Smart
Filter, color mode, or malformed input.
