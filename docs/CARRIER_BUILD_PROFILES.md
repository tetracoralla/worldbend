# Carrier build profiles

Worldbend has one deterministic source model and three product carriers. The
source tree may grow, but no carrier inherits another carrier's interface or
every stable feature merely because it exists in the repository.

`config/carrier-profiles.json` is the checked build input for the current
carrier surfaces, inventories, and budgets. `scripts/carrier-profiles.mjs`
rejects unknown configuration keys, duplicate or unknown feature names,
forbidden package entries, and exceeded byte ceilings. Packaging and runtime
checks consume this file; it does not define a marketplace or plugin registry.

## Current projections

| Carrier | Current product surface | Compiled or packaged runtime | Deliberately absent |
| --- | --- | --- | --- |
| Figma | Perspective, Sizes, Depth, Templates, Composition, Mesh, Pin Warp, Lens & maps and Appearance as first-class workspace tabs; More keeps genuine options | One self-contained UI, main adapter, and a WASM build with Canvas/Place/Deform/Surface/Remap and version-3 spatial-effect planners plus CSS emission for Copy CSS; canonical linked/whole-view Motion authoring and native complete-scene MP4 use the host Motion API; Templates persists the bounded task-native values those planners consume; complete supported solid artwork and outlined text/strokes can publish canonical native Warp/Pin/Mesh/Liquify/guide paths with full durable controls and explicit fidelity | Timeline rendering, native animated-effect publication, depth-map rendering, Agent binaries, MCP schemas, Comfy Python, automatic perception/calibration |
| Agent | Compact `search` / `describe` / `run` MCP projection by default, the eight direct headless tools as an explicit compatibility surface, plus CLI and the unchanged conditional Capability projection | Full stable native source superset: Place/Mockup, custom Mesh and Surface Deformation, Lens/Displacement Remap, Timeline/Motion, Program, Spatial Template/Variation, Spatial Document inspection/update/delivery planning, production media/vector/tiling, assisted perception, and PSD projection, with no human UI | Figma HTML/CSS and Comfy Python |
| ComfyUI | Nine V3 nodes: transform/rectification pairs, Canvas Set validation/application/plan replay, and Remap validation/application | A `comfy` CLI build containing only transform, rectification, Canvas, and Remap commands | Place, custom Mesh/Surface, Timeline/Motion, Program, Template/Variation, Spatial Document operations, production media/vector/tiling, perception, PSD, Compose/Solve/CSS/Schema, MCP/Skill/Capability files, Figma UI |

The full Web WASM now also projects Spatial Document delivery through the
ordinary core planner. The separate Figma profile excludes that document
planner; its existing Motion and host encoder do not import the full document
or a native encoding executable.

The Figma distribution remains one HTML file because Figma needs a local,
self-contained plugin. That packaging rule does not require one permanent
product workspace. The existing Perspective workspace is an executable
compatibility baseline: its operation order is stored in the profile and
checked against the built UI. Every sibling workspace — Sizes (`canvas`),
Depth (`spatial`), Templates, Composition (`mockup`), Mesh, Pin Warp
(`surface`), Lens & maps (`remap`) and Appearance — is a first-class tab in
the same navigation strip; none hides inside More, which keeps genuine
options (repeat, Copy CSS, output pixels, language). Depth owns the bounded
two-through-eight-plane Figma authoring subset of version-3
`multiplane-camera`; it retains the
canonical recipe while Figma publishes a raster still. The familiar three
roles are a preset, not a build boundary. These labels do not rename their canonical operation or
stored-data identities. The release build still inlines every workspace into
one offline HTML artifact, and only the active workspace renders.

The Web build retains CSS emission. The Figma alias consumes
`packages/wasm/pkg-figma`, whose bounded designer profile includes the same core
CSS emitter used by the visible Copy CSS action. A real generated-WASM smoke
executes both the solve and CSS paths and proves non-matrix Warp still fails
closed. The Comfy package builds the same CLI source with the `comfy`
feature and checks the staged help surface so a full CLI cannot silently enter
that package. Timeline and the single-raster Program remain Agent-full-only.
Place, custom Mesh, Pin Warp's Bezier envelope, and Remap have task-native
Figma routes; Remap is also shared by Agent full and Comfy because it has a
real graph-native consumer. Surface-deformation anchors and strokes stay
Agent/full-only even though Figma can author the envelope. Reduced compilation and staged command inventories
check these boundaries. Timeline remains absent from Figma because
there is no current task-native sequence object, preview, output, and single-
Undo document contract.
Canvas exists in the common semantic core, but each projection is deliberately
narrow: Figma exposes the repeat-use designer controls, Agent exposes one
atomic directory-set operation, and Comfy exposes graph-native heterogeneous
lists plus plan replay.

## Enforced budgets

The Figma package has bounded growth checks across supported compilers:

- runtime entries: at most 2,228,224 bytes (2.125 MiB);
- complete archive: at most 1,310,720 bytes (1.25 MiB);
- complete unpacked package: at most 2,752,512 bytes (2.625 MiB).

These ceilings bound distribution growth. They are engineering budgets; actual
import, rendering, interaction and continued use require runtime checks too.
The runtime allowance covers output variation across supported build toolchains;
archive and unpacked limits remain independently enforced. A byte-for-byte build
comparison requires matching toolchains. Changes to the ceilings require current
measurements and inspection of their effect on the distributed package.

The build reuses native material functions and the shared transform/Warp
renderer. Byte-identical license files share storage while each dependency
retains its full-text notice mapping.

A single compiler's size must not become an accidental requirement for source
users. Native Agent and Comfy sizes vary by target; their checks record bytes
without treating a macOS measurement as a portable ceiling. The default Agent catalog has a 16,384-byte limit; its direct
compatibility catalog has a separate 81,920-byte limit. Every tool-list byte
affects the host boundary regardless of disk size, while the larger direct
catalog is paid only by clients that explicitly select it.

## Adding one deterministic function

1. Define the explicit input, output, errors, limits, and core ownership before
   adding a carrier control or node.
2. Add only current consumers to `surfaceFeatureIds`. A carrier without a real
   route must not receive placeholder UI, schema, or code.
3. Put heavy optional core code behind an owning Rust feature and build the
   narrowest carrier feature set that satisfies the current route.
4. Add the carrier's task-native surface separately. Figma workspaces, Agent
   tools, and Comfy nodes do not need one-to-one UI symmetry.
5. Re-run current compile-profile, package-isolation, byte-budget, contract,
   carrier runtime, and complete regression checks. Installed Figma, Agent, and
   Comfy host flows remain separate observations.

## Current structural boundary

Canvas/multi-output is owned by `docs/CANVAS_CONTRACT.md`; multi-plane Place /
Mockup by `docs/MOCKUP_CONTRACT.md`; custom Mesh and Remap by
`docs/DEFORMATION_CONTRACT.md`; and the ordered frame program by
`docs/TIMELINE_CONTRACT.md`. In-memory composition of existing single-raster
operations is owned by `docs/RASTER_PROGRAM_CONTRACT.md`. Every new Agent family reuses the compact
operation catalog and may not grow the Perspective or Canvas interfaces into a
generic Photoshop panel, add speculative registry schema, or multiply
top-level Agent tools per primitive. Shared durable work above those operations
is owned by `docs/SPATIAL_DOCUMENT_CONTRACT.md`; this carrier-level isolation
does not narrow that product model.

## Build-path privacy

Use the repository packaging commands for distribution. Rust and WASM builds
remap the checkout and dependency-cache roots to stable relative labels,
preserving useful source locations without disclosing the builder's home
directory. Native staging and package validation reject embedded private build
paths; Figma validation also checks the decompressed WASM inside the HTML.
A raw `cargo build` is a development output and is not a distribution check.
