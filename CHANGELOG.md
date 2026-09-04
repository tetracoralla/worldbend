# Changelog

All notable changes to Worldbend are documented here. Versioning begins with
the first Figma Community release.

## 0.2.0 - Unreleased

### Figma product loop

- Promoted Perspective, Sizes, and Templates to the persistent release
  navigation. Sizes creates one to eight named Canvas variants, while Templates
  saves and reopens bounded Size or Composition tasks.
- Moved Composition, Mesh, and Lens & maps into the task-labeled Advanced
  transforms section under More, without changing their stored `mockup`,
  `mesh`, or `remap` contract identities.
- Reframed low-level Remap coefficients as Lens distortion or Displacement map
  tasks while retaining the explicit advanced coefficients disclosure.
- Reserved a proportional 10% interaction halo on initial load and explicit
  Fit so corner handles remain clear of the source and output HUD labels.
- Preserved create, replace, Apply as New Image, per-workspace Undo/Redo,
  selection-generation recovery, bilingual UI, and the 4096 px Figma boundary.

### Convergence and release hardening

- Kept transform, Canvas, Composition, Mesh, and Remap semantics in the existing
  `worldbend-core` / `worldbend-render` ownership boundary instead of creating a
  second graphics engine.
- Added a real Chrome WebGL versus native Remap pixel differential for Lens and
  Displacement at standard and high quality.
- Kept descriptor-scoped directory publication durable on Linux by reopening
  traversal-only directory handles for `fsync` without weakening path confinement.
- Versioned the self-contained Figma archive and its SPDX root package as
  `0.2.0`, with deterministic ZIP contents and checksums.

### Known limits

- Figma output remains raster and is limited to 4096 pixels per axis.
- Composition and Mesh require explicit selected layers and planes; Lens & maps
  requires explicit coefficients or a selected displacement map. Worldbend does
  not infer planes, depth, camera motion, or deformation intent.
- The Figma update is not published until its current package, media, listing,
  and owner acceptance have completed the release checklist.

## 0.1.0 - 2026-08-30

### Added

- Canonical versioned 2D plane mapping, semantic affine composition, strict
  validation, homography diagnostics, inversion, bounds, CSS geometry, and ten
  fixed Warp presets.
- Native PNG renderer, structured CLI, direct MCP tools, Web/WASM and WebGL2
  adapters, a Figma development plugin, and a narrow Capability projection.
- Explicit file-root authority, dry-run preflight, resource bounds,
  cancellation cleanup, atomic publication, and dependency-license inventory.
- Private-source build, collaboration, security, Figma distribution, and
  product contract documentation.

### Contract identity

- Worldbend-owned carriers use the `worldbend.transform` `TransformSpec`
  identity, `worldbend` Figma storage keys, and Worldbend-named Web events.
- The provider-neutral `org.openadam.projective.transform` Capability remains a
  separate mathematical contract and crosses into Worldbend only through an
  explicit, tested adapter conversion.

### Review hardening

- Preserved fractional tight-canvas bounds at large translated coordinates.
- Corrected the conservative minification bound used for perspective sampling.
- Kept Reference-canvas scanline culling aligned with translated destination
  columns and bounded when the destination is fully outside the canvas.
- Enforced absolute native resource ceilings and the canonical fixed Warp mesh
  before allocations in native and Web paths.
- Preserved absolute placement when replacing Figma results inside transformed
  parents.
- Removed ambiguous timeout/retry behavior that could race a render or Figma
  document write after reporting failure.
- Added a reproducible Figma ZIP with its exact WASM Cargo closure, copied
  dependency licenses, third-party notices, SPDX inventory, and full checksums.
- Removed the trial, checkout, and Payments API permission so the full Figma
  Community plugin remains free to use.

### Known limits

- Figma output is raster and is limited to 4096 pixels per axis.
- No automatic perception, camera/3D reconstruction, custom mesh, arbitrary
  deformation, cloud renderer, or public batch contract is included.
- The Capability projection is experimental and intentionally narrower than
  the Worldbend product contract.
