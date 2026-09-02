# Worldbend

Worldbend is a deterministic 2D spatial-transform and raster-canvas utility for
people and AI Agents. Give it four ordered corners, a saved `TransformSpec`, an
explicit source-plane `RectifySpec`, an ordered `CanvasSetSpec`, or an explicit
Place, Mesh, cubic Surface Deformation, Remap, Timeline, or eased Motion
program; it validates the program once and produces the same plan or raster
result through the carriers that explicitly declare that feature.

Worldbend is intentionally deterministic. It does not detect planes, estimate
a camera, choose a crop or output ratio, reconstruct 3D scenes, preserve
editable Figma vectors after a perspective transform, or expose a speculative
generic batch API. Timeline and Motion are separate ordered, atomic frame
contracts. PSD interoperability is bounded, read-only Smart Object inspection
and Spatial Template projection rather than a Photoshop document editor.

> Project status: `0.1.0` is an experimental commercial pre-release. Source is
> maintained in a private repository. The transform and error contracts are
> versioned, but compatibility guarantees may tighten before `1.0.0`.

## What is included

- `worldbend-core`: the canonical `TransformSpec`, explicit planar
  `RectifySpec`, ordered `CanvasSetSpec`, affine composition,
  strict `TL -> TR -> BR -> BL` validation, homography solving, diagnostics,
  inversion, bounds, six closed Canvas operations, Place/Mockup and extraction,
  bounded custom Mesh and cubic Surface Deformation, Lens/Displacement Remap,
  Timeline and rational-time eased Motion, CSS geometry, and ten fixed Warp
  presets;
- `worldbend-render`: inverse-mapped PNG rendering with premultiplied-alpha
  filtering, ordered multi-output Canvas, Timeline, Motion, and Surface
  rendering, bounded resources, cancellation, dry-run preflight, and atomic
  publication;
- `worldbend`: a structured JSON CLI for transform, rectification, Canvas,
  Place/Mockup, custom Mesh, cubic Surface, Remap, Timeline, eased Motion,
  read-only PSD Smart Object, and CSS operations;
- `worldbend-mcp`: a compact `search` / `describe` / `run` Agent projection by
  default in the plugin, plus the same eight direct tools as an explicit
  compatibility surface, with one granted file root and path-escape rejection;
- Web/WASM and WebGL2 adapters plus a four-corner editor;
- a self-contained local Figma plugin with the mature Perspective workspace
  for Transform, Free/Perspective Distort, fixed Warp presets, and manual
  four-point correction, plus a sibling Canvas workspace for explicit
  Contain/Cover output variants;
- an experimental local ComfyUI V3 node pack that applies the same reusable
  TransformSpec, explicit RectifySpec, ordered Canvas Set, or explicit Remap
  to one IMAGE and optional MASK through the bundled native core;
- an experimental provider-neutral Capability projection for the deliberately
  smaller inspect/render profile.

## Requirements

- Rust `1.89` or newer;
- Node.js `22` or newer;
- pnpm `11.19.0`;
- the Rust `wasm32-unknown-unknown` target for Web and Figma builds.
- a Comfy-compatible Python environment with torch and Pillow only for
  `pnpm test:comfyui`; the packaged nodes use the host's copies.

## Build and verify

```bash
git clone git@github.com:tetracoralla/worldbend.git
cd worldbend
pnpm bootstrap:wasm
pnpm install --frozen-lockfile
pnpm check
```

Repository access is limited to explicitly authorized collaborators.

`pnpm bootstrap:wasm` installs the matching `wasm-bindgen` CLI under the
ignored `.tools/` directory. `pnpm check` covers formatting, linting, Rust and
TypeScript tests, real WASM, Web and Figma builds, staged-plugin validation,
built CLI/MCP stdio behavior, and Capability-provider conformance.
When the current Python environment already provides torch and Pillow, run
`pnpm test:comfyui` as the separate real-native adapter regression.

Carrier-specific compilation, package isolation, and growth budgets are
defined in
[`docs/CARRIER_BUILD_PROFILES.md`](docs/CARRIER_BUILD_PROFILES.md). The source
tree is shared; Figma, Agent, and ComfyUI distributions do not carry one
another's interface code.

## CLI

Build the native CLI:

```bash
cargo build --release -p worldbend-cli
```

Solve a plane and inspect the structured result:

```bash
./target/release/worldbend solve \
  --quad "221.5,103 1066,171.5 991,704 287,659.5" \
  --reference 1440x900 \
  --json
```

Preflight a render without writing:

```bash
./target/release/worldbend render \
  --source screen.png \
  --spec examples/plane.worldbend.json \
  --output result.png \
  --dry-run \
  --json
```

Operation data is emitted as JSON on stdout. Exit codes and stable error codes
separate schema, geometry, media, rendering, filesystem, and internal failures.

## MCP and Codex plugin

Build and run the MCP server with an explicit file root:

```bash
cargo build --release -p worldbend-mcp
./target/release/worldbend-mcp --root /absolute/granted/workspace
```

The default server surface exposes exactly `worldbend.search`,
`worldbend.describe`, and `worldbend.run`; advanced operations are loaded by ID
through that compact catalog. `--surface direct` retains exactly
`worldbend.compose`, `worldbend.solve`, `worldbend.inspect`, `worldbend.render`,
`worldbend.rectify`, `worldbend.rectify_render`, `worldbend.canvas_render`, and
`worldbend.css` for compatibility.
File operations reject absolute paths, parent traversal, URIs, symlinks, and
non-regular source files outside the granted root.

To stage and validate the local Codex plugin from source:

```bash
pnpm plugin:stage
pnpm plugin:validate
```

The staged plugin includes native CLI, MCP, Capability, and transport-schema
probe binaries plus their exact dependency-license inventory. Platform binary
archives are release assets only when their embedded inventory passes the
repository's archive verifier.

## Web and Figma

`packages/web` exports the WASM-backed bridge, live CSS adapter, WebGL2
renderer, `attachPerspective`, and the reusable editor. Its demo uses the
repository-owned artwork at
[`examples/worldbend-demo-source.png`](examples/worldbend-demo-source.png),
opens a non-identity example immediately, and keeps the current TransformSpec,
CSS matrix, viewport scale, Reset, and PNG export in one workspace. The canvas
is the default surface: drag its four corners, use the compact zoom/Reset
controls, then download the PNG. Raw TransformSpec and CSS stay outside the
designer workflow behind one low-emphasis developer-mode icon.

For internal Figma validation, build the self-contained development archive,
extract it, then import its root `manifest.json` in Figma Desktop via
**Plugins → Development → Import plugin from manifest…**. The free release is
delivered through Figma Community and uses no runtime network access. See
[`docs/FIGMA_DESIGNER_DISTRIBUTION.md`](docs/FIGMA_DESIGNER_DISTRIBUTION.md).

Figma accepts images up to 4096 pixels on each axis through `createImage`, so
the adapter rejects larger results instead of silently reducing quality. The
native CLI remains the explicit high-resolution route. See Figma's official
[`createImage` reference](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/).

## ComfyUI

Build a self-contained package for the current platform:

```bash
pnpm package:comfyui-local
```

Copy the resulting folder under `artifacts/comfyui/` into
`ComfyUI/custom_nodes/` and restart ComfyUI. Nine V3 nodes validate and apply
one explicit TransformSpec, one explicit source-plane RectifySpec, or one
ordered Canvas Set to one IMAGE plus optional MASK. Canvas Plan replay keeps
compatible 8-bit masks and control maps on the same resolved geometry. Remap
reuses explicit lens or displacement programs across the same kinds of data. The node
pack has no frontend JavaScript or transform math; it invokes the bundled
native Worldbend renderer through private temporary files. See
[`packages/comfyui/README.md`](packages/comfyui/README.md).

The current package is an experimental local artifact, not a Comfy Registry
release. It rejects `B > 1`, has not been loaded in a real Comfy host on every
platform, and does not imply video or batch support.

## Portable Capability provider

`capabilities/provider.json` binds
`org.openadam.projective.transform@0.2.0` to Worldbend's real inspect and
render behavior. The provider-neutral Capability accepts its mathematical
`projective.transform` envelope; the compiled adapter validates that narrower
shape and converts it into Worldbend's `worldbend.transform` `TransformSpec`
before invoking the product core. This projection intentionally excludes the
product-only source-orientation and Warp fields and rejects them instead of
widening the portable contract. See
[`capabilities/README.md`](capabilities/README.md).

## Limits and support boundary

- raster render limits are enforced before allocation and publication;
- Figma output is a raster Rectangle with an Image fill; the original editable
  source stays intact;
- arbitrary semantic plane detection or automatic candidate application,
  unconstrained Liquify or inferred brush paths, camera estimation, 3D,
  content-aware crop or expansion, PSD writing/asset extraction/effect
  preservation, Comfy IMAGE batches, encoded video/audio, cloud rendering, and
  generic batch semantics are not implemented;
- performance probes are current measurements, not an SLA.

The exact transform, raster, path, UI, and error semantics are in
[`docs/CONTRACT.md`](docs/CONTRACT.md). Place / Mockup is specified in
[`docs/MOCKUP_CONTRACT.md`](docs/MOCKUP_CONTRACT.md), deformation/remap in
[`docs/DEFORMATION_CONTRACT.md`](docs/DEFORMATION_CONTRACT.md), and Timeline in
[`docs/TIMELINE_CONTRACT.md`](docs/TIMELINE_CONTRACT.md). Production media and
assisted plane candidates are specified in
[`docs/MEDIA_PIPELINE_CONTRACT.md`](docs/MEDIA_PIPELINE_CONTRACT.md) and
[`docs/PERCEPTION_PROVIDER_CONTRACT.md`](docs/PERCEPTION_PROVIDER_CONTRACT.md).
Bounded cubic deformation, eased motion, and read-only Smart Object projection
are specified in
[`docs/SURFACE_DEFORMATION_CONTRACT.md`](docs/SURFACE_DEFORMATION_CONTRACT.md),
[`docs/MOTION_CONTRACT.md`](docs/MOTION_CONTRACT.md), and
[`docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md`](docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md).
The product boundary is in
[`docs/PRODUCT_MODEL.md`](docs/PRODUCT_MODEL.md).

## Collaboration and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before proposing a private change.
Report security problems only through the private route described in
[`SECURITY.md`](SECURITY.md). Binary distributions retain the notices required
by their bundled third-party dependencies.
