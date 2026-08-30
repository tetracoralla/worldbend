# Changelog

All notable changes to Worldbend are documented here. Versioning begins with
the first commercial Figma release.

## 0.1.0 - Unreleased

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
- Added a seven-day complete-product trial followed by a one-time Figma
  Community purchase check before Apply.

### Known limits

- Figma output is raster and is limited to 4096 pixels per axis.
- No automatic perception, camera/3D reconstruction, custom mesh, arbitrary
  deformation, cloud renderer, or public batch contract is included.
- The Capability projection is experimental and intentionally narrower than
  the Worldbend product contract.
