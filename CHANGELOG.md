# Changelog

All notable changes to Worldbend are documented here. Versioning begins with
the first Figma Community release.

## 0.4.0 - 2026-09-14

### Live canvas working preview

- While editing in Transform, Distort, Warp or Composition, the working result
  now appears in place on the Figma canvas as a locked image plainly named
  `Worldbend Working Preview`. It starts only after the first real edit,
  follows every further change, and is removed by Apply, returning exactly to
  the loaded result, cancel, selection loss, workspace or mode change, and
  plugin close. It is editing feedback, never a saved result, and cleaning it
  up never touches artwork.
- A rejected publication no longer loses canvas feedback. After a final
  encoding or host write failure the same editable draft returns with its
  preview restored automatically and the publication error still visible.
- Known host limitation: removing the preview can leave one empty Undo step,
  and a later host Undo can briefly bring the removed preview back. Keep
  editing or delete it; the next plugin run sweeps any residue from every
  page of the document.

### Figma interface and release media

- Refined the 300-pixel-wide plugin layout so source and output labels stay
  clear of the artwork, guidance remains readable, and the output actions keep
  a deliberate full-width hierarchy instead of collapsing into a narrow
  secondary column.
- Updated the Community cover for 0.4 with a readable version mark and a clean
  original-to-HD comparison at both full and marketplace-card sizes.

## 0.3.1 - 2026-09-11

### Transform reliability

- On native-capable files a Warp operation could no longer be applied to a
  fresh selection: the primary Apply took the editable gate and disabled
  itself while the alternate HD button only appears once a result exists.
  The primary Apply now falls back to the HD image route for Warp.
- Repeat Last Transform required switching to Transform mode first although
  fresh selections open in Distort; it is now reachable there and stages the
  repeat for the primary Apply to publish.
- Valid sources could rarely report "The selected layer could not be
  previewed" when rapid render coalescing settled a superseded load as a
  failure, or when a preview resource was released while an upload was still
  in flight. Superseded renders now settle with the replacing render's
  outcome, and preview resources close only after in-flight renders drain.
- Image elements are staged through a canvas before WebGL upload, working
  around embedded and headless host builds that reject blob-backed image
  sources with WebGL 1281.

## 0.3.0 - 2026-09-09

### Figma continued editing

- Added independent editable Frame output for supported sources with the
  Worldbend Perspective companion effect, alongside stable HD images.
- Reopen a saved result alone to continue its transform. Update that result or
  create another Frame or image without overwriting the original.
- Edit Frame children directly in Figma while preserving the plugin's active
  preview and transform draft. HD images update only on explicit publication.
- Improved HD source sampling and fixed colored fringes at projective edges.
  Repeated unchanged HD output reuses its exact-resolution source.
- Keep image previews usable while the optional editable effect is loading.
- Added visual selection guidance, distinct loading/recovery states, host
  theme support and compact layouts down to 300 px.

### Support limits

- Editable output preserves native content with a sampled appearance; it can
  look softer than HD output and requires access to the companion effect.
- Warp and Correct remain HD image workflows. Figma output is bounded to
  4096 pixels per axis. Arbitrary document Undo sequences are not guaranteed.

## 0.2.0 - 2026-09-04

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
- Made clean-checkout UI regression build the Figma-specific WASM bindings
  before importing Figma test modules, so local generated files cannot mask drift.
- Kept Figma artifact inspection on the Figma package version instead of the
  independently versioned workspace root.
- Versioned the self-contained Figma archive and its SPDX root package as
  `0.2.0`, with deterministic ZIP contents and checksums.

### Known limits

- Figma output remains raster and is limited to 4096 pixels per axis.
- Composition and Mesh require explicit selected layers and planes; Lens & maps
  requires explicit coefficients or a selected displacement map. Worldbend does
  not infer planes, depth, camera motion, or deformation intent.

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
