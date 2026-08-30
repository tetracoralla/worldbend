# Worldbend

Worldbend is a deterministic 2D plane-transform utility for people and AI
Agents. Give it four ordered corners or a saved `TransformSpec`; it validates
the geometry once and produces the same homography, placement, CSS, Warp mesh,
or raster result through its Rust, CLI, MCP, Web/WASM, and Figma adapters.

Worldbend is intentionally narrow. It does not detect planes, estimate a
camera, reconstruct 3D scenes, preserve editable Figma vectors after a
perspective transform, or expose a speculative batch API.

> Project status: `0.1.0` is an experimental commercial pre-release. Source is
> maintained in a private repository. The transform and error contracts are
> versioned, but compatibility guarantees may tighten before `1.0.0`.

## What is included

- `worldbend-core`: the canonical `TransformSpec`, affine composition,
  strict `TL -> TR -> BR -> BL` validation, homography solving, diagnostics,
  inversion, bounds, CSS geometry, and ten fixed Warp presets;
- `worldbend-render`: inverse-mapped PNG rendering with premultiplied-alpha
  filtering, bounded resources, cancellation, dry-run preflight, and atomic
  publication;
- `worldbend`: a structured JSON CLI for compose, solve, inspect, render, and
  CSS operations;
- `worldbend-mcp`: the same five operations as direct MCP tools, with an
  explicit granted file root and path-escape rejection;
- Web/WASM and WebGL2 adapters plus a four-corner editor;
- a self-contained local Figma plugin for Transform, Free/Perspective Distort,
  and the fixed Warp presets;
- an experimental provider-neutral Capability projection for the deliberately
  smaller inspect/render profile.

## Requirements

- Rust `1.89` or newer;
- Node.js `22` or newer;
- pnpm `11.19.0`;
- the Rust `wasm32-unknown-unknown` target for Web and Figma builds.

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

The server exposes exactly `worldbend.compose`, `worldbend.solve`,
`worldbend.inspect`, `worldbend.render`, and `worldbend.css`. File operations
reject absolute paths, parent traversal, URIs, symlinks, and non-regular source
files outside the granted root.

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
[`examples/worldbend-demo-source.png`](examples/worldbend-demo-source.png).

For internal Figma validation, build the self-contained development archive,
extract it, then import its root `manifest.json` in Figma Desktop via
**Plugins → Development → Import plugin from manifest…**. The free release is
delivered through Figma Community and uses no runtime network access. See
[`docs/FIGMA_DESIGNER_DISTRIBUTION.md`](docs/FIGMA_DESIGNER_DISTRIBUTION.md).

Figma accepts images up to 4096 pixels on each axis through `createImage`, so
the adapter rejects larger results instead of silently reducing quality. The
native CLI remains the explicit high-resolution route. See Figma's official
[`createImage` reference](https://developers.figma.com/docs/plugins/api/properties/figma-createimage/).

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
- custom meshes, arbitrary deformation, perception, camera estimation, 3D,
  PSD compatibility, video, cloud rendering, and public batch semantics are
  not implemented;
- performance probes are current measurements, not an SLA.

The exact transform, raster, path, UI, and error semantics are in
[`docs/CONTRACT.md`](docs/CONTRACT.md). The product boundary is in
[`docs/PRODUCT_MODEL.md`](docs/PRODUCT_MODEL.md).

## Collaboration and security

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before proposing a private change.
Report security problems only through the private route described in
[`SECURITY.md`](SECURITY.md). Binary distributions retain the notices required
by their bundled third-party dependencies.
