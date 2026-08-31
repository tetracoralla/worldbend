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
| Figma | The mature `perspective` workspace plus the independent `canvas` workspace for explicit Contain/Cover variants | One self-contained UI, main adapter, and a no-CSS WASM build | Core-only Crop/Trim/Pad/Stretch controls, Agent binaries, MCP schemas, Comfy Python, CSS emission |
| Agent | Eight direct headless MCP tools, including one ordered `canvas_render` set operation, plus CLI and the unchanged conditional Capability projection | Full stable native core and file renderer, with no human UI | Figma HTML/CSS and Comfy Python |
| ComfyUI | Seven V3 nodes: the existing transform/rectification pairs plus Canvas Set validation, application, and resolved-plan replay | A `comfy` CLI feature build containing only inspect/render, rectification, and Canvas commands | Compose/Solve/CSS/Schema commands, MCP/Skill/Capability files, Figma UI |

The Figma distribution remains one HTML file because Figma needs a local,
self-contained plugin. That packaging rule does not require one permanent
product workspace. The existing Perspective workspace is an executable
compatibility baseline: its operation order is stored in the profile and
checked against the built UI. Canvas is recorded as its first sibling
workspace and owns its controls and initialization in separate source modules.
A future Place/Mockup or Mesh workspace must retain that separation even if
the release build finally inlines them into one offline HTML artifact.

The Web build retains CSS emission. The Figma alias consumes
`packages/wasm/pkg-figma`, built without the `worldbend-core/css` feature. The
shared bridge keeps a closed CSS entry only to preserve its import ABI; calling
that unsupported route returns `E_SCHEMA` and no Figma product control exposes
it. A real generated-WASM smoke executes both the retained solve path and that
closed CSS path. The Comfy package builds the same CLI source with the `comfy` feature and
checks the staged help surface so a full CLI cannot silently enter that
package.
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
portable ceiling. The Agent catalog has a separate enforced 81,920-byte limit
because every tool-list byte affects the host boundary regardless of disk size.

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

## Next structural boundary

Canvas/multi-output is the first feature family built on this foundation and is
owned by `docs/CANVAS_CONTRACT.md`. The next structural boundary is
multi-plane Place/Mockup. It must likewise begin from one agreed deterministic
contract and may not grow the Perspective or Canvas interfaces into a generic
Photoshop panel, add speculative registry schema, or multiply Agent tools per
primitive.
