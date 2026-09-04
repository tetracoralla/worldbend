# Carrier build profiles

Worldbend has one deterministic source model and three product carriers. The
source tree may grow, but no carrier inherits another carrier's interface or
every stable feature merely because it exists in the repository.

`config/carrier-profiles.json` is the checked build input for the current
carrier surfaces, inventories, and budgets. `scripts/carrier-profiles.mjs`
rejects unknown configuration keys, duplicate or unknown feature names,
forbidden package entries, and exceeded byte ceilings. Packaging and runtime
checks consume this file; it is not a future marketplace or plugin registry.

## Current projections

| Carrier | Current product surface | Compiled or packaged runtime | Deliberately absent |
| --- | --- | --- | --- |
| Figma | A primary Perspective -> Sizes -> Templates loop, with Composition, Mesh, and Lens & maps as task-labeled advanced transforms under More | One self-contained UI, main adapter, and a no-CSS WASM build with Canvas/Place/Deform/Remap planners; Templates persists the bounded task-native values those planners consume | Timeline/Motion rendering, Agent binaries, MCP schemas, Comfy Python, CSS emission, automatic perception/calibration |
| Agent | Compact `search` / `describe` / `run` MCP projection by default, the eight direct headless tools as an explicit compatibility surface, plus CLI and the unchanged conditional Capability projection | Full stable native source superset: Place/Mockup, custom Mesh and Surface Deformation, Lens/Displacement Remap, Timeline/Motion, Program, Spatial Template/Variation, production media/vector/tiling, assisted perception, and PSD projection, with no human UI | Figma HTML/CSS and Comfy Python |
| ComfyUI | Nine V3 nodes: transform/rectification pairs, Canvas Set validation/application/plan replay, and Remap validation/application | A `comfy` CLI build containing only transform, rectification, Canvas, and Remap commands | Place, custom Mesh/Surface, Timeline/Motion, Program, Template/Variation, production media/vector/tiling, perception, PSD, Compose/Solve/CSS/Schema, MCP/Skill/Capability files, Figma UI |

The Figma distribution remains one HTML file because Figma needs a local,
self-contained plugin. That packaging rule does not require one permanent
product workspace. The existing Perspective workspace is an executable
compatibility baseline: its operation order is stored in the profile and
checked against the built UI. Sizes (`canvas`) and Templates complete the
primary repeat-use loop. Composition (`mockup`), Mesh, and Lens & maps
(`remap`) use the same replacing-workspace boundary but enter from More as
advanced transforms. These labels do not rename their canonical operation or
stored-data identities. The release build still inlines every workspace into
one offline HTML artifact, and only the active workspace renders.

The Web build retains CSS emission. The Figma alias consumes
`packages/wasm/pkg-figma`, built without the `worldbend-core/css` feature. The
shared bridge keeps a closed CSS entry only to preserve its import ABI; calling
that unsupported route returns `E_SCHEMA` and no Figma product control exposes
it. A real generated-WASM smoke executes both the retained solve path and that
closed CSS path. The Comfy package builds the same CLI source with the `comfy`
feature and checks the staged help surface so a full CLI cannot silently enter
that package. Surface Deformation, Timeline, and the single-raster Program are
Agent-full-only features. Place, custom Mesh, and Remap have task-native Figma
routes; Remap is also shared by Agent full and Comfy because it has a real
graph-native consumer. Reduced compilation and staged command inventories
check these boundaries. Timeline remains absent from Figma because
there is no current task-native sequence object, preview, output, and single-
Undo document contract.
Canvas exists in the common semantic core, but each projection is deliberately
narrow: Figma exposes the repeat-use designer controls, Agent exposes one
atomic directory-set operation, and Comfy exposes graph-native heterogeneous
lists plus plan replay.

## Enforced budgets

The Figma package is sufficiently platform-stable for deterministic byte
ceilings:

- runtime entries: at most 655,360 bytes;
- complete archive: at most 524,288 bytes;
- complete unpacked package: at most 2,097,152 bytes.

These are growth tripwires, not performance or UX acceptance. An intentional
feature may revise a limit only with a current package measurement and review
of the user-visible change. Agent and Comfy native binary sizes vary by target,
so their current checks record bytes but do not pretend one macOS value is a
portable ceiling. The default Agent catalog has a 16,384-byte limit; its direct
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
top-level Agent tools per primitive.
