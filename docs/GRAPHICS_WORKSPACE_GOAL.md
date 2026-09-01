# Worldbend graphics workspace goal

Last updated: 2026-09-01

This is the active recovery anchor for the owner-confirmed product direction.
It distinguishes the long-term target from the current executable product and
from the next bounded implementation stage. `docs/PRODUCT_MODEL.md` remains the
authority for current implemented semantics; operation-family contracts remain
the authority for their exact inputs, outputs, limits, and errors.

## Owner-confirmed target

Worldbend is growing into an Agent-native two-dimensional graphics work system.
Its long-term value is not a dense replacement for the Photoshop or Illustrator
interface. It is one shared, non-destructive graphics model whose deterministic
operations can be composed and executed directly by Agents, while a designer
gets a fast, quiet canvas for the few tasks they currently need.

The target has two deliberately asymmetric surfaces:

- the Agent and direct-execution surface may grow whenever a closed operation
  has implementable semantics, bounded resources, stable errors, cancellation,
  and a real current use case;
- the human surface stays extremely restrained. Perspective remains the quiet
  base task. An adjacent task enters the UI only after it passes the admission
  rule below. Core or Agent availability does not grant a visible control.

“Handle any graphics-related change” is a direction for the operation system,
not a claim that arbitrary perception, generation, editing, or file formats are
already supported. Current capabilities and exclusions remain explicit.

## Current executable product

The source superset currently implements explicit affine/projective transform,
rectification, Canvas, Place/Mockup, bounded custom Mesh, Lens/Displacement
Remap, and ordered Timeline contracts. Carrier profiles intentionally expose
different subsets.

The Figma carrier currently has a quiet Perspective workspace and a compact
launcher for Sizes, Mockup, Mesh, and Remap. Those completed workspaces are a
compatibility baseline, not a precedent for adding more persistent controls.
No further human task is authorized by this goal alone.

The current Web canvas already coalesces pointer work to animation frames,
retains one WebGL renderer and source texture, uses generation checks to discard
stale async results, buckets backing-store expansion, and releases image and
graphics resources on replacement or disposal. The existing Node-to-WASM probe
does not measure the complete pointer-to-visible browser path or a long editing
session.

## Human UI admission rule

A new human-visible task may enter a carrier only when all of the following are
current facts:

1. A named designer task and affected graphic object exist; capability breadth
   or parity with another editor is not sufficient.
2. Repeated value is observed in real use or explicitly confirmed by the owner.
3. The task has a task-native direct-manipulation or compact-control model,
   preview, apply/replace behavior, Undo boundary, error recovery, and focus or
   workspace return behavior.
4. Its operation is already closed and validated in the shared core or another
   named source-of-record contract. The UI does not invent adapter-local
   geometry or hidden inference.
5. The complete interaction fits the declared carrier resource and performance
   boundary without degrading Perspective's continuous-edit path.

Until all five are true, the capability remains headless, Agent-only, or
unimplemented. Existing human workspaces may be simplified when current use
shows that they fail this rule; they are not removed merely to satisfy an
abstract minimalism preference.

## Current productizable stage

The active stage is **continuous canvas and operation foundation**. It does not
add another Figma workspace. It closes the smallest shared foundations required
by current Perspective and adjacent-operation consumers:

1. Define one closed operation envelope for the operations already persisted by
   the Figma adapter, while preserving the existing wire keys and canonical
   operation specs. This is an adapter/document boundary, not a speculative
   layer graph or general editor ontology.
2. Add a reproducible browser workload that measures the current
   pointer-to-visible Perspective path under a warm continuous interaction and
   a longer repeated-edit session. Record frame delay, stale-work suppression,
   retained graphics resources, and post-disposal behavior where the browser
   exposes them.
3. Remove measured avoidable allocation or resource churn from that path while
   preserving geometry, interaction, accessibility, and cancellation behavior.
4. Keep the compact Agent catalog and direct deterministic execution aligned
   with the current operation contracts. New deterministic operations continue
   to enter the core and Agent route before any human UI proposal.

This stage is complete only after the workload, environment, and baseline are
recorded; a regression threshold is derived from that reproducible measurement
and names the action it blocks; the identified bottleneck is repaired; focused
and complete development checks pass; the built browser path is rerun; and this
anchor records the current results and next stage. A component microbenchmark
or visually smooth impression cannot close the stage.

## Current stage result — 2026-09-01

The continuous-canvas and operation-foundation implementation is locally
complete:

- `packages/figma/src/stored-operation.ts` is now the one closed adapter-level
  envelope for existing Transform, Rectify, Canvas, and designer-task results.
  It preserves the existing shared-plugin-data keys, rejects ambiguous slots,
  clears non-owning slots on write, and restores the exact prior slots during a
  failed in-place replacement. It is not a speculative scene graph.
- `/performance.html` is a development-only page over the real
  `PerspectiveEditor` and `TransformWebGLRenderer`. It records real pointer or
  control input, input-to-WebGL-draw delay, frame deltas, Long Tasks, heap
  observations, WebGL resource creation/deletion, and post-Dispose retention.
  It does not enter the default designer UI or a carrier package.
- The reference Perspective workload processed 14,521 pointer moves as 246
  current draws before the renderer change and 243–245 draws after it. Before
  change, input-to-draw p95 was 11.1 ms with a 14.4 ms maximum; after change,
  repeated runs were 11.0–11.4 ms p95 with 17.6–18.4 ms maxima. Every run had
  zero frame deltas above 20 ms and zero Long Tasks.
- The renderer now lazily retains one bounded 16x16 CPU geometry staging buffer
  for continuous Warp/custom-Mesh changes instead of allocating a new roughly
  24 KiB `Float32Array` per rendered mesh. The 120-sample Warp comparison kept
  p95 at 1.0 ms and reduced the observed maximum from 5.3 ms to 2.8 ms, with no
  delayed frames or extra graphics resources.
- Each live editor retained exactly one WebGL program, texture, and buffer.
  Dispose deleted all three and left zero tracked graphics resources. JS heap
  deltas varied with browser GC and are explicitly not promoted into a leak
  verdict or threshold.

The same-environment local Web regression thresholds and the exact action they
block are declared in `docs/REVIEW_CONTRACT.md`. Installed Figma smoothness and
designer-perceived quality remain separate observations.

The final current-source `pnpm check` passed. It included Rust formatting and
clippy, the complete Rust workspace, 164 Web tests, 153 Figma tests, Web/Figma
typechecks, real normal and Figma WASM builds, contract/carrier checks, package
and staged-plugin validation, current Agent runtime smoke, Capability
conformance, and built-artifact checks. The staged Figma package measured
500,904 runtime bytes, 476,231 archive bytes, and 1,076,415 unpacked bytes. The
Agent runtime smoke retained a 7,542-byte progressive catalog, two render
workers, fail-fast overload rejection, 6 ms transform cancellation cleanup,
and 7 ms Canvas cancellation cleanup. These are current local observations,
not installed-host or owner experience acceptance.

## Second stage result — 2026-09-01

The next dependency-backed Agent/core segment is also locally complete. The
current registry had eighteen independent operations but no way to execute a
single-raster `Transform -> Rectify -> Canvas` sequence without publishing and
re-decoding an intermediate PNG. That concrete seam now owns the bounded
`worldbend.raster-program@0.1` contract in
`docs/RASTER_PROGRAM_CONTRACT.md`.

- A program contains 1..8 ordered, uniquely identified Transform, Rectify, or
  Canvas stages. It reuses the existing canonical specs and does not add a
  scene graph, layers, branches, fan-in, fan-out, multiple outputs, or
  adapter-local effects.
- The native renderer decodes and orients the source once, preflights each
  next output plus cumulative pixels before allocation, retains intermediate
  RGBA images only in memory, and PNG-encodes one final result. The product
  cumulative ceiling is 128 MiP; the current MCP ceiling is 64 MiP.
- Failure or cancellation at any stage publishes nothing. Dry-run performs
  destination preflight, every stage, final encode, hashing, and response
  shaping without publication. MCP runs the program in the existing bounded
  isolated worker and checks the complete response before final atomic publish.
- Full CLI builds now expose `program-inspect` and `program-render`. The compact
  Agent catalog now has `program_inspect` and `program_render` operation IDs,
  for twenty operations behind the same three default tools. The frozen eight
  direct compatibility tools remain unchanged.
- The Program is an Agent/full-only compile feature and is explicitly absent
  from Figma and Comfy builds, packages, and command surfaces. No designer
  control or workspace was added.
- Focused regressions cover schema/version, ordered kinds and IDs, duplicate
  IDs, stage-local normalized target requirements, exact stage dimensions,
  cumulative preflight, and cancellation with no publication. The built
  stdio MCP/CLI smoke additionally covers inspect, dry-run, real write and
  digest, late-stage Crop failure with no output, exact schemas, and real
  worker cancellation/recovery.

The current built runtime observation kept the default catalog at 7,682 bytes
and the direct compatibility catalog at 80,716 bytes. The successful Program
response was 1,018 bytes. Two-worker concurrency and fail-fast overload
behavior remained unchanged; ordinary render cleanup was 6 ms, Canvas cleanup
8 ms, and Program cleanup 10 ms in the final full check. These are local
observations, not cross-host SLAs.

No current consumer was found that can honestly define a general layer tree,
vector scene graph, arbitrary effect graph, multi-source program, or new human
workspace. Those remain outside this productizable stage rather than being
invented as optional schema.

## Standing autonomy and boundaries

The owner authorized goal-runway execution: continue through the next safe,
dependency-ordered action without pausing for step-by-step review. Stop only for
an owner-only product choice, external authorization, credentials, spending,
release/deploy intent, irreversible direction, or a conflict with preserved
work.

Preserve the complete worktree. Do not commit, push, publish, upload, deploy, or
discard changes unless the owner separately authorizes it. Keep development
regression, runtime Agent flow, runtime human flow, installed-host observations,
and owner business/experience acceptance separate.

## Recovery state

- Current segment: the continuous-canvas foundation and the first
  dependency-backed Agent composition segment are locally closed. Preserve
  both contracts and thresholds.
- Current source state at entry: `main` at
  `df9e879b7d739f3753c84c23dd33560c29531e8d`, three commits ahead of
  `origin/main`, with no task-created source changes.
- Current observations: the real-browser workload and local threshold exist;
  Perspective stays inside the reference threshold; continuous mesh updates
  reuse one bounded CPU buffer; the Figma adapter has one persisted-operation
  envelope; the full Agent route has one bounded, in-memory, single-raster
  Program with one final publication boundary.
- Next action: require another named current consumer before defining a layer,
  scene, multi-source, or effect-graph contract. Continue measuring the real
  canvas and Agent paths; do not optimize an unmeasured bottleneck or add a
  human workspace without satisfying the UI admission rule.
- Completed validation: focused and complete Web/Figma tests and typechecks;
  browser short, repeated, Warp, and Dispose workloads before and after;
  single-raster Program core/render/CLI/MCP regressions and built runtime
  flows; complete `pnpm check`; current Agent runtime smoke; Capability,
  carrier, package, and built-artifact checks.
- External lanes currently not established by local work: installed Figma
  document mutation, Figma Community behavior, installed Codex plugin routing,
  and a real ComfyUI host.
