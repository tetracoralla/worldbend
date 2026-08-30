# Figma Community listing assets

These files are private Community-release working assets. They do not declare
or grant a Worldbend product license.

## Upload-ready files

- `worldbend-icon-128.png` — 128 x 128 plugin icon.
- `free-distort-runtime-1920x1080.jpg` — real Figma Desktop preview while
  editing a four-corner transform.
- `applied-result-runtime-1920x1080.jpg` — real Figma Desktop state after the
  free Apply path created a `· Worldbend` result.

The two runtime images were captured from the current plugin using
`examples/worldbend-demo-source.png`. The tracked source images remove the top
64 pixels of Figma window chrome and use a centered 1248 x 702 crop, so app
tabs and unrelated file names are absent. The upload-ready copies are
mechanically scaled from that sanitized 16:9 crop to Figma Community's
1920 x 1080 requirement.

`worldbend-icon-source.png` is the project source for the upload icon. It was
generated with the built-in image generator from a no-text brief: a deep-navy
square with a coral-and-ivory warped grid, four equal corner handles, crisp
vector-like edges, and no third-party product logos. The 128 px file is a
mechanical downscale of that source.
