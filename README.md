# Worldbend

Worldbend is a free Figma plugin and an Apache-2.0 spatial graphics toolkit.
Create perspective and deformation results, retain their source relationships,
and reopen them for later edits. The Rust core supplies shared geometry and
rendering for CLI, MCP, Web/WASM and Figma adapters.

## Figma

Install [Worldbend from Figma Community](https://www.figma.com/community/plugin/1675767923532475446/worldbend).
The current Community release is package **0.5.0**, published as version **7**.
This source tree contains the **0.6.0** package candidate; it is not a claim of
Community publication. Worldbend processes artwork locally, requires no account
and declares no network access.

Select a source, use Transform, Distort, Warp or Correct, then choose an output:

- **Native Vector:** projected paths for supported solid artwork. Text becomes
  editable outlines; native SVG export retains the transformed paths.
- **Linked HD Image:** a rendered snapshot with saved controls and source links.
  Edit the source, reopen the result and Update. Maximum 4096 pixels per axis.
- **Editable Frame:** independent live native content for supported clipped,
  unrotated Frames. Perspective appearance is sampled through the optional
  [Worldbend Perspective effect](https://www.figma.com/community/shader/1692554770100764677),
  whose availability depends on Figma approval and access. Native SVG export does
  not bake this sampled appearance into paths. HD and Native Vector work
  independently of the effect.

Mesh, Pin Warp and Liquify share saved deformation work. Sizes creates named
variants; Composition and Templates support repeatable artwork placement;
Depth handles two through eight ordered layers with a shared camera.
The 0.6 source package also adds editable Glass and Paper appearance recipes,
guarded Native Vector refresh and copy continuation, compatible Figma Motion
preservation, and bounded curved PSD Smart Object import.
See [Figma usage and handoff](docs/FIGMA_HANDOFF.md) and
[scene reuse](docs/SCENE_WORKFLOW.md) for supported workflows and limits.

The canvas working preview appears after the first real edit and is removed on
Apply, Reset or close. Collaborators can see it while it exists. After removal,
Figma Undo can briefly restore the preview node; delete it or keep editing—it
does not affect artwork.

## Source packages

The shared toolkit remains an experimental **0.1.0** API. Figma package versions
are independent. Compatibility contracts may change before 1.0.

| Package | Role |
| --- | --- |
| `worldbend-core` | Validated transforms, homographies, mesh/remap plans and shared contracts |
| `worldbend-render` | Raster/media execution and bounded output publication |
| `worldbend-cli` | Local command line operations |
| `worldbend-mcp` | Structured Agent operations under an explicit workspace grant |
| `worldbend-wasm` | Carrier-specific WebAssembly projections |
| `@worldbend/web` | Web geometry, effects and receiving bindings |
| `@worldbend/figma` | Figma authoring, saved results and Agent handoff |
| `@worldbend/scene-three` | Optional adopted 3D scene receiver |
| `packages/swiftui` | Native material and completed-frame receiving |
| `packages/comfyui` | Experimental local ComfyUI adapter |

The core includes explicit plane rectification, affine composition, Canvas
crop/trim/pad/fit operations, ordered Mockup placement, Mesh and Surface
Deformation, Lens/Displacement Remap, Timeline, eased Motion and bounded video
planning. Spatial Documents retain asset identities and static, interactive,
temporal, material and adopted scene expressions for guarded updates.

## Build and verify

Requirements: Node 22+, pnpm 11.19.0, Rust 1.89+, the
`wasm32-unknown-unknown` target and wasm-bindgen-cli 0.2.127. Versions are pinned
in the manifests and build configuration. Native video execution additionally
uses caller-supplied FFmpeg and FFprobe; they are not bundled or downloaded.

```sh
pnpm install --frozen-lockfile
pnpm bootstrap:wasm
pnpm build:figma
pnpm check
```

The complete browser checks require Chrome or Chromium. On a display-less
Debian/Ubuntu host, install the Vulkan loader, Mesa driver and virtual display:

```sh
sudo apt-get install -y libvulkan1 mesa-vulkan-drivers xvfb xauth
WORLDBEND_WEBGPU_HEADED=1 xvfb-run -a pnpm check
```

The [clean-checkout workflow](.github/workflows/ci.yml) configures this environment.
macOS browser checks use the native graphics backend.

Useful focused checks:

```sh
cargo test --workspace
pnpm test:scripts
pnpm test:figma
pnpm typecheck
pnpm contract:check
pnpm test:figma-refresh
```

Build a self-contained Figma development archive with
`pnpm package:figma-designer`. See
[development installation](docs/FIGMA_DESIGNER_DISTRIBUTION.md).

## Command line and Agent tools

```sh
cargo run --locked -p worldbend-cli --bin worldbend -- --help
cargo run --locked -p worldbend-mcp --bin worldbend-mcp -- --help
```

CLI help and the MCP `search`/`describe` operations expose the current input
schemas. The [Worldbend skill](plugins/worldbend/skills/worldbend/SKILL.md)
documents operation discovery and continued work. Filesystem rendering requires
an explicit `WORLDBEND_WORKSPACE_ROOT` grant. Geometry inspection and planning do
not imply a file was rendered or published.

The [Capability provider](capabilities/README.md) is an experimental typed
binding over the same operations. The [ComfyUI adapter](packages/comfyui/README.md)
uses the native renderer and retains the core validation and geometry.

## Web and native receiving

Build the Web package with `pnpm build:web`. Its receiving bindings attach
supported effects to host-owned content and expose update/dispose behavior.
Examples in `packages/web/examples` include scene motion, material documents,
material preferences, shadows and scene authoring.

- [Spatial effects](docs/SPATIAL_EFFECTS_CONTRACT.md)
- [Spatial Documents](docs/SPATIAL_DOCUMENT_CONTRACT.md)
- [Native appearance and receiving](docs/NATIVE_APPEARANCE_CONTRACT.md)
- [SwiftUI package](packages/swiftui/README.md)
- [Three.js scene receiving](docs/SCENE3D_CONTRACT.md)
- [Field Notes example](packages/scene-three/examples/paper-stage/README.md)

These receivers operate on declared state and resources. They do not export
private Figma media, deploy a website or provide automatic bidirectional sync.
The host owns application actions, accessible content and resource access.

## Contracts and support

[The shared executable contract](docs/CONTRACT.md) defines transform ordering,
stable errors, geometry, raster conventions and adapter behavior. Feature
contracts in `docs/` specify implemented formats, resource limits and supported
carrier projections. Inputs use explicit geometry; suggested planes are an
optional upstream assessment and are never silently applied.

Supported formats and execution vary by carrier. Read the affected contract
before relying on a source-only operation in an installed runtime. Figma
capabilities also depend on the host APIs and access available to the file.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. Report
vulnerabilities through the private route in [SECURITY.md](SECURITY.md).

Licensed under [Apache-2.0](LICENSE). Retain [NOTICE](NOTICE) and
[third-party notices](THIRD_PARTY_NOTICES.md). Input artwork retains its own
ownership and license. Apache-2.0 grants no trademark rights.
