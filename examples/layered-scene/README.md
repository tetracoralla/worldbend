# Layered scene placement example

One portrait scene canvas (1024 × 1536) composed from an ordered back-to-front
stack: `background`, `prop-railing`, `figure`, `prop-plant`. Each layer is one
`worldbend.mockup` plane carrying its own `worldbend.transform` placement.
This is the same document shape a downstream consumer — for example a mobile
app that composites a character, props, and a background at runtime, or a
visual Agent preparing those parameters — plans once and then applies per
layer. The scene canvas here is deliberately the size of a phone background,
and the foreground plant extends past the canvas edge, which is legal:
destination coordinates only need to be finite.

## Files

| File | What it is |
| --- | --- |
| `layered-scene.worldbend.json` | The authored mockup document (input). |
| `expected-plan.json` | Real output of `worldbend mockup-inspect`, kept as numeric ground truth. |
| `assert-homography.mjs` | Convention check: replays every plane's matrix against its quad. |

## Plan it (no source images required)

```sh
worldbend mockup-inspect --spec examples/layered-scene/layered-scene.worldbend.json --json
```

Through the Agent catalog the same call is `worldbend.run` with operation
`mockup_plan`. Planning is side-effect free: it validates every quad, resolves
normalized destinations against the canvas, and returns — per plane — the
complete solve output: canonical spec, resolved destination, homography matrix
and inverse, plus geometry and reprojection diagnostics. Regenerate
`expected-plan.json` with the CLI command above when the input changes.

## Render a preview composite

`mockup-render` needs one image per distinct `sourceId`:

```sh
worldbend mockup-render \
  --source background-image=background.png \
  --source railing-image=railing.png \
  --source figure-image=figure.png \
  --source plant-image=plant.png \
  --spec examples/layered-scene/layered-scene.worldbend.json \
  --output scene-preview.png
```

## Consumer conventions

These are the rules any frontend applying the plan's matrices must follow.
`node assert-homography.mjs` verifies them against the checked-in numbers and
prints, per plane, the entries a row-vector framework needs.

1. **Matrix layout.** `homography.matrix` is a row-major 3×3 `H` applied to
   column vectors: `[x', y', w']ᵀ = H · [u, v, 1]ᵀ`, then divide by `w'`. The
   source is the unit square; `H[8]` is normalized to `1`.
2. **Perspective division is not optional.** The `figure` plane has
   `w' ≈ 0.727` at its bottom-right corner — an affine-only renderer will
   visibly miss the quad.
3. **Row-vector frameworks transpose.** Frameworks that multiply
   `[x y 1] · M` (CoreGraphics-style `CGAffineTransform`, SwiftUI
   `ProjectionTransform`) must pass the transpose; the script prints it. CSS
   consumers should not hand-arrange values at all: the `css` operation emits
   the ready `matrix3d(...)` with `transform-origin: 0 0`.
4. **Resolve normalized destinations against the reference.** A normalized
   quad maps to pixels by multiplying with the resolved reference size
   (`canvas` here). Coordinates may fall outside `[0, 1]`; preserve them.
5. **Corner order and flips.** Corners are strictly `tl, tr, br, bl`. A
   mirrored appearance must come from `content.orientation`, never from
   reordering destination corners.

A consumer port that cannot reproduce `expected-plan.json` corner-for-corner
has a convention bug — transposition, a missing divide, or reordered corners —
not a numeric tolerance problem.

## Multiple elements on one perspective line

Planes that share one visual ground plane (several props on the same receding
surface) simply author their quads consistently; nothing enforces the shared
vanishing behavior because one quad per plane already pins each element. When
two planes must keep an **identical shared edge** — tiled panels of one
surface — declare a `seams` entry: planning compares the two named edges'
endpoints (in authored or reversed direction) within a pixel tolerance and
fails with `E_SHARED_EDGE_MISMATCH` instead of moving either plane. Depth
ordering is the plane array order, back to front.

Interaction semantics that go beyond placement — per-layer depth factors,
drag parallax, transitions — belong to the consuming app, not to this
document. Worldbend's boundary is the validated placements, matrices, and
preview renders.

## Handing this to a downstream app team

The workflow an implementing Agent or designer repeats per scene:

1. Author or edit one mockup document per scene background (the Figma
   Composition workspace edits the same document interactively; its
   **Copy placement parameters** action copies it as JSON).
2. `mockup-inspect` / `mockup_plan` to validate and obtain every layer's
   solved matrix in one call; `mockup-render` for a reviewable preview.
3. Hand the document plus the plan's placements to the app, which stores them
   as scene data and applies the matrices at runtime (conventions above).

To serve Agents on one machine, run the MCP binary with an explicit granted
root containing the scene assets:

```sh
cargo build --release -p worldbend-mcp
./target/release/worldbend-mcp --root /absolute/granted/workspace
```

The default `catalog` surface exposes `worldbend.search`, `worldbend.describe`,
and `worldbend.run`. Paths resolve only under the granted root; absolute,
parent-escaping, URI, and symlinked sources are rejected, renders run under
bounded workers with real cancellation, and results are byte-capped. Agents
therefore need no development checkout of this repository.
