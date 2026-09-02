# Worldbend review contract

This contract gives later builders and reviewers a durable, defect-first route
through Worldbend's current Agent and human product surfaces. It is not a
feature checklist, benchmark promise, release approval, or completion
certificate. Reopen current source, generated artifacts, installed transports,
and runtime behavior for every review.

The contract fixes product claims, hard boundaries, and reproduced high-risk
sequences; it does not prescribe the reviewer's reasoning order. Commands,
corpora, metrics, and examples are current leads unless a public contract or a
named regression makes them mandatory. A reviewer may use a stronger
rerunnable method suited to current source and runtime, but must disclose the
substitution and preserve every semantic, authority, safety, side-effect, and
verdict boundary below.

## Current authority and carrier seams

`worldbend-core` owns geometry and stable product errors. Every other surface
is an adapter or a deliberately narrower projection.

| Seam | Current authority and review target |
| --- | --- |
| Canonical spec and geometry | `crates/worldbend-core/src/model.rs`, `transform.rs`, `solver.rs`, `rectify.rs`, `canvas.rs`, and their tests |
| CLI and schema output | `crates/worldbend-cli/src/main.rs`; the Capability adapter is separately owned by `crates/worldbend-cli/src/capability.rs` |
| MCP live schemas and tools | schemars-derived inputs/outputs and handlers in `crates/worldbend-mcp/src/main.rs`, worker limits in `worker_limits.rs`, and descriptor authority in `worldbend-agent-fs`; live `tools/list` is the runtime fact |
| WASM and Web | Rust exports under `packages/wasm`, the JSON bridge in `packages/web/src/bridge.ts`, and Rust-schema-generated `packages/web/src/generated/core-contract.ts` with public normalized aliases in `types.ts` |
| Figma | `packages/figma`; gesture ownership, async scheduling, and history are separate modules that consume Web/WASM/core results without creating a second transform model |
| ComfyUI | `packages/comfyui`; V3 schema declarations and tensor/MASK/process adaptation call the bundled native CLI and must contain no transform math. The local package inventory is separate from installed-host registration. |
| Capability projection | central experimental Profile plus local `capabilities/provider.json`, `capabilities/schemas/*.json`, transport digests, and the real JSONL adapter |
| Product Skill | `plugins/worldbend/skills/worldbend/SKILL.md`; it owns routing and boundaries, not schemas or geometry algorithms |
| Packaged runtime | staged plugin binaries, manifest, schemas, Skill, and the host-visible tool registry |
| Carrier profiles | `config/carrier-profiles.json`, compile features, package scripts, and built inventories; a surface declaration controls only its named carrier |

Any canonical field, default, constraint, result artifact, stable error, or
limit change requires tracing the complete affected chain. `pnpm
contract:check` regenerates the Web input/output/error projection from the Rust
schema and rejects drift; local Capability schemas remain an intentionally
narrower Profile and must still be reacquired with the adapter acceptance
surface, Product Skill, installed provider manifest, and live transport.

## Acceptance invariants

| Area | Pass condition | Failure signal |
| --- | --- | --- |
| One semantic core | CLI, MCP, WASM/Web, Figma, ComfyUI, render, CSS, and Capability projections delegate to the same core meaning. | Adapter-local transform/Canvas math, render shortcut, or diagnostics derived from a second solver. |
| TransformSpec carrier parity | The current canonical spec, defaults, camelCase wire names, strict unions, unknown-field rejection, and precision survive every promised carrier. | A core field is accepted, dropped, renamed, rounded, or rejected differently without an explicit narrower contract. |
| Compose semantics | Fixed scale -> simultaneous skew -> clockwise rotation -> translation order, current-bounds-relative pivot, re-anchoring compensation, tight placement, and flip XOR agree across docs and executable paths. Flip changes only source orientation; destination geometry remains identical. | A different operation order, global-pivot interpretation, silent corner relabeling, mirrored destination winding, double solve, or carrier-specific placement. |
| Bounded Warp semantics | Exactly ten preset names and finite amount `[-1,1]` expand into the core-owned fixed 16x16 positive-area mesh. Native render and Web/Figma consume that mesh, composition preserves, replaces, or explicitly clears it, zero is identity, and CSS rejects it. | Adapter-local formulas, custom vertices/resolution, folded triangles, a second rasterization, clipped carrier-only output, or a false matrix3d approximation. |
| Canvas and Canvas Set semantics | The six closed operations, integer source rectangles, alpha-threshold Trim, normalized anchors, explicit backgrounds, placement/scale plans, unique ordered variant IDs, cumulative budgets, and same-size plan replay follow `docs/CANVAS_CONTRACT.md`. Every variant reads the original source. | A carrier recomputes Contain/Cover, reruns Trim on a control map, chains variants, accepts an arbitrary plan, silently changes sampling/fill, or calls heterogeneous outputs a tensor batch. |
| Place / Mockup semantics | Ordered planes, exact source identities, explicit seams/grids/measurements, source-over composition, reverse extraction, cumulative limits, and atomic directory publication follow `docs/MOCKUP_CONTRACT.md`. | A carrier detects a plane, repairs a seam, accepts extra/missing sources, changes z-order, chains extraction outputs, or publishes a partial set. |
| Mesh and Remap semantics | Custom grids and explicit lens/displacement programs follow `docs/DEFORMATION_CONTRACT.md`; mesh topology, map presence, channel/neutral/boundary behavior, shared native sampling, and feature projection remain exact. | Adapter-local deformation, folded mesh acceptance, automatic lens/depth/flow estimation, implicit map choice, or carrier-only math. |
| Timeline semantics | Explicit frames or linear corner keyframes expand and render under `docs/TIMELINE_CONTRACT.md`, including stable order/IDs, exact sources, intermediate validation, cumulative budgets, cancellation, and all-or-none directory publication. | Tracking, invented frames, easing drift, frame chaining, partial publication, generic batch semantics, or a Python per-frame loop presented as Timeline. |
| Single-raster Program semantics | One `worldbend.raster-program@0.1` chains 1..8 uniquely identified Transform, Rectify, and Canvas stages under `docs/RASTER_PROGRAM_CONTRACT.md`. It preflights every next output and cumulative pixels, keeps intermediates in memory, preserves order, and publishes exactly one final PNG after cancellation and response checks. | Intermediate publication/redecode, stage reordering, partial success, allocation before the cumulative check, branching/fan-in/fan-out, adapter-local math, or exposure in Figma/Comfy without a current consumer. |
| Stable errors | Every `docs/CONTRACT.md` product error remains reachable or explicitly reserved; CLI/MCP mappings agree; Capability narrowing is closed and intentional; messages/details and echoed input stay bounded. | Unknown product error falls through as a misleading known error, long input is reflected, or Capability accepts a shape its Profile rejects. |
| Geometry diagnostics | Inspect, solve, compose, CSS, and render use core solving; reprojection, horizon, determinant, bounds, and inversion keep their declared meaning. Orientation-reversing homographies caused by explicit flips remain legal. | Render bypasses `solve_spec`, determinant sign is “repaired,” horizon checks differ, or diagnostics describe geometry not executed. |
| Raster and side effects | Inverse mapping, pixel centers, premultiplied-alpha filtering, transparent outside samples, output limits, return feasibility, staging, and atomic publication follow `docs/CONTRACT.md`; dry-run executes the same preflight without publication. | Mutation precedes final preflight, overwrite occurs without authority, cancellation leaves staging/output, or dry-run and write disagree. |
| Agent resource authority | MCP and Capability render paths stay under one explicit descriptor grant and reject absolute, parent, URI-like, symlink, and non-regular-source escapes. Held handles remain authoritative under pathname replacement. The complete call, including queueing, worker, diagnostics, and response, stays bounded on macOS, Linux, and Windows and recovers after breach. | Ambient cwd becomes authority, a check/use race redirects access, a path escapes, waiters/workers grow without an enforceable lifetime, or timeout/memory failure poisons later requests. |
| Direct routing and catalog economy | The direct compatibility projection retains exactly the current eight task tools. The default installed projection has exactly `search`, `describe`, and `run`; a known operation needs one run call, describe returns its exact schema on demand, and run reuses the direct operation's closed parser and handler. Annotations including `openWorldHint=false` are accurate, and both live catalogs plus result/error bytes stay within their independent budgets. | A new operation grows the default catalog by another full tool schema, compact run bypasses exact operation validation, direct compatibility drifts, known requests require discovery, descriptions misroute, or success uses a generic fallback. |
| Carrier projection and package isolation | Figma compiles without CSS and contains no Agent/Comfy interface; Agent contains no human/Comfy UI; Comfy compiles only its declared native commands and contains no Agent/Figma interface. The Perspective operation order, four sibling task declarations, and declared Figma byte ceilings are checked from built artifacts. | A carrier gains another carrier's UI or adapter, an unused heavy feature is linked by default, a full CLI enters Comfy, Correct disappears from the frozen Perspective order, a task enters `EditorMode`, or a package exceeds a declared ceiling. |
| WASM/JSON boundary | Real WASM tests cover full round trips, camelCase names, stable panic normalization, and large finite `f64` values without an accidental `f32` path. | Mock-only parity, panic leakage, numeric truncation, or accepted fields disappear at JSON/TypeScript boundaries. |
| Product Skill | The installed Skill describes currently supported routes and boundaries and does not duplicate schemas or deny a supported operation. | Stale examples/boundaries, algorithm prose, version mismatch, or Skill visible while tools are absent. |
| Comfy single-image route | V3 node IDs/types stay stable, strict TransformSpec validation crosses the real native CLI, IMAGE/MASK alpha round-trips under the declared 8-bit and premultiplied-alpha rules, omitted normalized targets bind to source IMAGE dimensions, and `B != 1` fails before a render. | Python transform math, silent tensor clamp, mask polarity reversal, hidden batch iteration, PATH-selected binary, leaked child/temp state, or local package inventory presented as installed-host proof. |
| Comfy Canvas route | Strict Canvas Set validation crosses the native CLI once, Apply returns ordered heterogeneous IMAGE/MASK lists plus the resolved plan, replay requires matching dimensions and never resolves Trim again, and the 16 Mi-pixel cumulative limit includes every output. | Different sizes are stacked into one tensor batch, Python plans geometry, one child is launched per variant, list order drifts, Trim is recomputed, high-precision maps are advertised through the 8-bit boundary, or installed-host behavior is inferred from adapter tests. |
| Comfy Remap route | Strict Remap validation and execution cross the reduced native CLI, lens rejects a map, displacement requires one, optional map MASK supplies alpha, and one retained Remap can synchronize compatible IMAGE/MASK/control inputs. | Python lens/displacement math, hidden map defaults, wrong mask polarity, unrequested map acceptance, high-precision claims through the 8-bit PNG boundary, or installed-host behavior inferred from adapter tests. |
| Figma human route | The installed development plugin operates only on the selected authorized document, retains transform/replacement state, preserves undo/recovery and localization, and keeps both live manifest entrypoints present throughout either partial build. Its explicit density policy enforces the 4096 px per-axis image limit without conflating raster pixels and document placement: Fit to Figma proportionally fits only pixels, while Keep original pixels blocks only an over-limit Apply and recovers immediately when geometry returns within the limit. A quiet editor-corner readout shows source -> requested -> applied pixels when fitted. Its 600 x 720 panel uses one full-width top operation bar for identity/mode/active parameters, one full-width bottom session bar for Reset/Undo/Redo/Apply, and one uninterrupted rectangular editor exactly between them. Active Transform/Warp parameters stay visible; operation labels use transparent low-emphasis chrome and one pale-blue selected surface. More is the final peer after Warp and contains only secondary session, output-density, and language actions. Transform keeps Width -> Height -> Link, Skew X -> Skew Y, and Angle -> Placement as three continuous visual groups over one shared pair of parameter columns plus a dedicated 32 CSS-pixel action column, so all five sliders have equal screen-space widths of at least 110 CSS px and a narrower frequent-use domain than their precise numeric fields. Frequent transform commands are authority-rendered icon buttons with localized hover/focus tooltips; one repeatable clockwise 90-degree command covers the 180-degree and counter-clockwise equivalents by repeated presses, while its icon still depicts one object receiving one directional action rather than a continuous cycle. Placement replaces rather than overlays the parameter region and uses a right-facing enter arrow; down arrows remain reserved for dropdown/disclosure semantics. More, Close, Link, Check, surface-entry, Flip, Rotate, and Repeat product icons retain assets from the configured icon authority rather than font glyphs or locally drawn SVG paths. A bar-height change may refit or recenter the preview, but it leaves the canonical spec, recipe, pivot, and Warp value unchanged and keeps every finite handle center inside the editor safe inset. Zoom remains available by direct input and standard shortcuts without persistent zoom chrome. | Stale selection applies, state silently resets, failed work replaces a node, an over-limit raster is published, density fitting silently changes placement or aspect ratio, the size readout hides a fit or covers interaction, returning within budget leaves Apply disabled, technical metadata or a generic operation heading enters the task UI, nested selected chrome competes with the canvas, More interrupts the operation order or hides active-operation commands, semantic parameter siblings are split by an unrelated control, parameter rows use different column tracks or slider widths, duplicate rotation buttons expose outcomes already reachable by repetition, an icon exposes the repetition/cycle mechanism instead of the single action or lacks a localized hover/focus tooltip, the bars float over or leave gaps beside the editor, a slider is too short for deliberate adjustment or silently clamps precise typed values, a down arrow falsely implies a dropdown for a replacing surface, a product icon is a font glyph or locally invented path, layout reflow changes canonical geometry, a control covers a handle, Escape dismisses a transient surface and also cancels the edit, or a UI/main build transiently removes its sibling entrypoint. |
| Figma task workspaces | Sizes, Mockup, Mesh, and Remap are replacing sibling workspaces entered through one compact source-level launcher and returned to Perspective without entering `EditorMode` or changing the frozen operation order. Sizes owns six canonical Canvas operations and 1..8 named outputs; Mockup owns 1..8 explicit selected planes; Mesh owns a fixed-boundary 2..16 grid; Remap owns explicit Lens or source-plus-map Displacement. Every preview consumes a canonical plan, every result retains its canonical spec, and all routes enforce the 4096-axis boundary and recoverable create/replace publication. Hidden workspaces are inert and Perspective state survives the round trip. | A task appends controls to Perspective, recomputes semantic math in TypeScript, silently chooses a map/plane/lens, interrupts direct manipulation by rebuilding an active handle, renders while hidden, accepts stale selection, leaves partial nodes after failure, loses source generation, or returning changes Perspective semantics. |
| Perspective gesture semantics | After a 4 CSS-pixel intent threshold, the dominant physical drag axis locks until release. Horizontal drag changes only the dragged corner's x and gives its same-row corner the opposite x delta; vertical drag changes only the dragged corner's y and gives its same-column corner the opposite y delta. The other two corners and every unrelated coordinate remain fixed. Keyboard chooses the arrow axis directly; explicit Perspective mode and the Shift temporary inverse use the same gesture-start quad. | One gesture moves three corners, the pair switches under diagonal jitter, perpendicular coordinates drift, modifiers make an already-distorted quad jump, or an adapter invents a different mapping. |
| Direct manipulation | Image geometry may zoom, but handles and pivot retain their declared screen-space visual and hit sizes at Fit, manual zoom, and post-release camera recovery. Distort keeps zoom fixed; away from the edge its camera pan stays fixed apart from core-derived scene/workspace offset. An outward pointer in the bounded edge zone causes capped compositor assistance only on active axes, while the editor compensates the frozen gesture mapping so the grabbed control remains coupled. Free may sustain edge pan; Perspective consumes one pair-normalized assist step per fresh active-axis pointer sample and settles while the pointer is still. Return, release, cancellation, capture loss, blur, and page hide stop it promptly. Exact release commits its final sample; interruption or a re-entry move with no pressed buttons closes at the last pressed sample. Post-release recovery and Fit may cross the ordinary 10% zoom floor, must keep every finite corner center inside the 16 px safe inset, and may not change geometry. | A parent compositor scale shrinks hit targets, edge motion starts without outward intent, a still Perspective pointer keeps expanding its pair, motion continues after return/release, a locked perpendicular axis pans, the grabbed control detaches, an older sample commits, Fit strands a corner at the ordinary zoom floor, a positive recovery is labeled 0%, or recovery changes canonical geometry. |

## Error-contract review

For the Canvas phase, the quiet `Sizes…` entry sits beside the selected source
identity. It is outside the Perspective mode choices and More popover; More
contains only secondary session and language actions. Canvas never enters
`EditorMode` or changes the checked Perspective peer order.

Compare three current surfaces:

1. the stable `E_*` table in `docs/CONTRACT.md` and core `ErrorCode`;
2. CLI/MCP envelopes and live failure behavior;
3. the Capability Profile's closed errors and
   `map_transform_error`/`map_error` narrowing.

Every declared product code needs a reachable test path or an explicit reason
it is reserved. Every rich-to-narrow mapping must be intentional, including
unknown internal failures. `MAX_SCHEMA_ERROR_CHARS`, complete MCP response
bounds, worker stdout/stderr bounds, Capability response bounds, and very long
unknown input are part of the contract.

Render admission overload is `E_CAPACITY`: it occurs before a worker or queue
slot is acquired and may succeed after in-flight work completes. An admitted
call that exhausts its whole-call deadline is `E_TIMEOUT`. Exercise and assert
both independently; an overload test cannot stand in for a real timeout test.

The experimental Capability Profile currently excludes product-only source
orientation and Warp. Until the central Profile adopts those semantic fields,
the local adapter must reject any `content.orientation` or `content.warp`
member rather than accepting a shape its copied Profile schema forbids.
Provider conformance proves only the declared current level and does not
establish independent substitution.

## Known high-risk seams

The risks below must be covered when applicable, but the listed sequences are
regression leads rather than a fixed script. A reviewer may replace one with a
stronger current observation or check that establishes the same invariant and
must disclose the substitution or any uncovered seam.

- change or add one canonical field and compare core serde, live MCP schema,
  CLI schema, Web types/real WASM, Capability snapshots/adapter, Product Skill,
  and staged artifacts;
- reach every stable product error through at least one real carrier, compare
  CLI/MCP meaning, and exercise Capability narrowing where the Profile exposes
  the operation;
- compose cumulative Transform -> Distort -> Transform with a changing tight
  canvas, alternate pivots with compensation, XOR flips, quarter rotations,
  very large finite translations, and repeated byte-identical inputs;
- verify flip leaves raw quad, bounds, canvas, and affine matrix unchanged,
  while solving the resulting spec may legitimately produce a negative
  determinant;
- test non-finite, self-intersecting, concave, mirrored-order, degenerate,
  short-edge, singular, horizon-crossing, and reprojection failures;
- compare inspect and actual render geometry from the same spec; prevent a
  render-only shortcut from becoming a second truth source;
- exercise MCP relative success plus absolute, parent, URI, symlink,
  non-regular, missing, existing-output, and unauthorized destination paths;
  replace an acquired source/output ancestor before use and confirm held
  descriptors still read/publish only inside the originally granted object;
- saturate render admission, then submit an escaping source, an existing
  destination, and a valid new destination in that order; the first two must
  return their stable path/destination errors before admission, while only the
  valid request may return `E_CAPACITY`;
- run dry-run and write through the same target preflight; force cancellation,
  timeout/memory/output failures, assert no publication or staging residue,
  then prove service recovery;
- render a Canvas Set whose middle variant fails and require no destination
  directory; exercise duplicate IDs, existing/symlink destinations, dry-run,
  cancellation before commit, strict result order, cumulative limits, and
  resolved-plan replay against both matching and mismatched source shapes;
- introspect both live `tools/list` projections, exact names, annotations,
  schema constraints, independent complete byte sizes, exact describe output,
  direct-versus-run parity, and one-call known routing in a fresh installed host;
- compile the Figma WASM and Comfy CLI profiles without default features,
  inspect the staged Comfy help surface, compare each built package against its
  forbidden paths/suffixes, and apply the current Figma runtime/archive/unpacked
  ceilings; package success does not establish installed-host behavior;
- cross the WASM bridge with current full composition output, an unexpected
  panic, camelCase fields, and approximately `1e15` translation values;
- switch Figma selection or source generation during export/apply, then verify
  the target, visible result, selection, undo state, and residual artifacts;
- enter Canvas with a non-default Perspective draft, create four aspect-ratio
  variants, return, and require exact Perspective state preservation; force a
  later Canvas-result failure and require zero created nodes, then verify one
  host Undo removes a successful set and single-result replace restores fully
  on failure;
- with the installed development manifest still targeting `packages/figma/dist`,
  monitor both `main.js` and `ui.html` while running UI-only, main-only, and the
  composed Figma build; a final directory listing does not detect a transient
  load-breaking deletion;
- at the current `figma.showUI` dimensions and representative Web viewport
  sizes, measure each handle and pivot with its final screen-space bounding box
  at Fit, manual zoom, and post-recovery zoom; a declared CSS width alone does
  not establish the hit target after ancestor transforms;
- at the current Figma panel dimensions, inspect the default Distort surface,
  persistent Transform controls, persistent Warp controls, expanded Placement,
  the full-width bottom session bar, More menu, and the four canvas zoom
  shortcuts. Record the top-bar bottom, editor top/bottom, and bottom-bar top
  before and after every control transition: the editor must exactly fill the
  interval between the two bars without overlap. Presentation x/y/scale may
  change when the available editor height changes, so compare the canonical
  spec, recipe, pivot, and Warp value instead and require exact semantic
  stability absent a real edit. Confirm every Transform slider's final
  screen-space box is at least 110 CSS px wide, its frequent-use range is
  distinct from the paired precise field domain; inspect Width -> Height ->
  Link, Skew X -> Skew Y, and Angle -> Placement as three uninterrupted groups;
  confirm More follows Warp, its menu omits active Transform commands, the
  source-level `Sizes…` entry remains outside both More and the mode bar, and every
  transform icon exposes the same localized name by hover and keyboard focus.
  Press clockwise rotation once, twice, and three times and compare the result
  with +90, 180, and -90 degrees respectively. Placement replaces the
  parameter region, every finite handle center remains inside the editor's
  16 CSS-pixel safe inset after reflow, pointer/trackpad zoom still anchors to
  the canvas, and Escape closes More or Placement without also resetting the
  session;
- load a 4000 px-class source, drag Distort outward across the 4096-axis
  boundary, and read the corner output chain before Apply. Under Fit to Figma,
  require the final raster to stay at or below 4096 on both axes while the
  normalized spec and document placement remain the requested tight geometry;
  reselect the source/result pair and require stored raster dimensions rather
  than Rectangle dimensions to own reload. Under Keep original pixels, require
  Apply to disable while over budget and re-enable on the first accepted
  inward sample, without dismiss/reopen or stale error state;
- in the built Figma panel, require `[hidden]` to win over every workspace and
  mode display rule, focus More or another non-text button and exercise all
  four zoom shortcuts, focus a numeric/text field and require native text
  undo, dismiss a recoverable error, and traverse Canvas variant tabs with
  Left/Right/Home/End in both supported locales;
- load the built Web demo from an empty browser session and require its
  non-identity example, one-time direct-manipulation hint, primary full-width
  canvas, working Fit/manual zoom, synchronized Reset, zero browser-console
  errors, and current TransformSpec/CSS behind one icon-only, low-emphasis
  developer-mode button. Enter and Space toggle it; Escape closes it and
  restores focus to the trigger. A
  successful build with stale disclosed output or a rejected first-frame
  example is a runtime failure;
- exercise all four Perspective corners with pure horizontal, pure vertical,
  and combined deltas on identity and already-distorted quads; assert the
  axis-selective two-point truth table above, a stable axis after the intent
  threshold, two unchanged corners, outward coordinates without clipping, and
  identical pointer/keyboard/Shift behavior;
- drag Distort and Transform handles across the plugin viewport boundary and
  release outside the iframe. Sample pointer, active-control, and camera
  coordinates at start, during movement, and release, separating viewport
  camera state from the core-derived tight-canvas scene offset; enter and hold
  each edge zone, return inward before release, and verify capped continuous
  Free pan. For Perspective verify one pair-normalized step per fresh
  active-axis sample, no continued expansion while held still, and immediate
  resumption on another outward sample. In both modes verify pointer/control
  coupling, the exact/last-visible endpoint, prompt stop, cleared active state,
  capture cleanup, immediate second-drag recovery, and stable live camera
  scale. Force a quad whose required recovery scale is below 10% and verify all
  four 32 px controls remain reachable inside the 16 px inset, Zoom Out does
  not jump inward, Zoom In returns gradually, and the label does not display
  0%;
- after an outside-iframe release, send the owning pointer a re-entry move with
  no pressed buttons and a far coordinate; verify Distort, Transform, and
  space-pan close exactly once at the last pressed sample and do not jump;

## Performance, load, and Agent economics

Worldbend is expected to serve high-frequency Agent use, so this is a separate
review lane rather than a footnote to correctness.

`pnpm performance:probe` and `pnpm runtime:smoke` are current starting points,
not the complete method. Establish the real cost of Worldbend's dominant
installed Agent tasks under ordinary and declared-boundary use: cold/warm and
sustained/tail behavior, bounded admission and cancellation/recovery, resource
stability, complete catalog/result cost, actual tool selection/calls/retries,
and the zero-model direct route for already structured input. Derive exact
payloads, concurrency, duration, and instrumentation from current risk, and
disclose any phase or host behavior not observed.

Current historical measurements in `docs/CAMPAIGN_ANCHOR.md` are observations,
not SLAs. The performance probe has no timing gate until the product declares a
reproducible workload and threshold. It fails only on correctness or benchmark
integrity. A faster core number cannot compensate for unbounded queue/resource
growth, unsafe effects, worse tail latency, or higher Agent context cost.

Worldbend exposes no generic public batch operation. Timeline is a specialized
ordered atomic sequence with its own item, order, source, cumulative budget,
failure, cancellation, and publication contract. Before adding any other
batch, define item/envelope bounds, correlation and order, failure and
atomicity semantics, one cumulative resource budget, fairness, cancellation,
and publication behavior. A transport batch of independent calls does not
automatically change the Capability Profile or become a Procedure.

The single-raster Program is also not a batch: it has one source, one final
output, no item-level success, and no fan-out. Its cumulative limit bounds
private sequential stage outputs rather than a collection of publishable
results.

Measure ComfyUI separately from MCP. Its current path adds tensor-to-8-bit PNG
conversion, one native process startup, native render, PNG decode, and tensor
reconstruction. `pnpm test:comfyui` establishes correctness through a real
native executable on a machine that already provides Comfy's torch/Pillow
runtime; it is not an installed-host latency or memory measurement. Before
promotion, measure cold/warm node execution, large IMAGE/MASK copies, process
cleanup, cancellation, repeated workflow runs, and retained CPU/GPU memory in
a real supported Comfy installation.

## Interactive UI performance

Worldbend's Web and Figma surfaces promise immediate preview during continuous
direct manipulation, so interactive UI performance is a separate review lane.
`pnpm performance:probe` measures Node-to-real-WASM composition and solving; it
does not measure browser or Figma input dispatch, state propagation, WebGL,
layout, paint, composition, or visible control feedback.

Measure Web and Figma independently in their supported runtime using current
representative and declared-boundary content. Cover startup, the primary
continuous interaction, sustained/repeated use, heavy Apply/export work, and a
risky interruption or target/mode/source transition. Let current source and
known defects determine the exact sequence and instrumentation. Report the
whole input-to-correct-visible-feedback path, tail/frame behavior and retained
resources where observable, plus the final visible geometry, committed spec,
target, undo/recovery state, and immediate reuse. Name every host-hidden phase
instead of replacing it with a component benchmark or visual impression.

Paint-frame coalescing may discard obsolete intermediate samples, but it must
render the newest accepted sample and commit the exact final sample on release.
For Distort and Transform, additionally measure or instrument asynchronous core/render
concurrency: one request per paint is insufficient if earlier promises remain
in flight. At most one expensive preview may run at once, only the newest
intermediate may wait, and a final sample must survive later input until it is
rendered.
No optimization may trade away final raster quality, canonical geometry,
typed precision, accessibility feedback, selection/generation isolation,
undo/recovery, or error visibility.

A smooth frame trace cannot compensate for a shrunken hit target, pointer and
grabbed-control divergence, a discontinuous or runaway edge pan, or stale
release geometry. Those are runtime human-flow failures even when frame timing
is stable.

Worldbend declares one **local Web development regression threshold**, not a
cross-device or installed-host SLO. Serve the current Web demo with
`pnpm --filter @worldbend/web exec vite --config vite.demo.config.ts --host
127.0.0.1`, open `/performance.html`, and record the emitted
`worldbend.browser-canvas-observation.v1` JSON. The reference observation uses
Chrome 151 on macOS, a 1280 x 720 CSS-pixel viewport, device pixel ratio 2, the
checked example image/spec, and both of these current-source workloads:

- Perspective: 120 repeated closed corner drags, 121 pointer samples each,
  followed by three idle seconds;
- Warp: 120 ordered `wave` amount samples through the development-only sample
  control, followed by two idle seconds.

On that same reference environment, a canvas-performance-sensitive change is
blocked when either workload has input-to-WebGL-draw p95 above 16.7 ms, any
input-to-draw sample above 34 ms, any frame delta above 34 ms, any Long Task, a
missing final draw, more than one retained preview program/texture/buffer, or
nonzero retained preview resources after Dispose. These thresholds were
derived from the 2026-09-01 current-source baseline: Perspective p95 11.1 ms
and zero frame deltas above 20 ms across 14,521 pointer moves; Warp p95 1.0 ms
and zero frame deltas above 20 ms across 120 samples. They block accepting the
performance-sensitive change in this local lane; they do not claim universal
60 fps behavior.

`performance.memory.usedJSHeapSize` remains an observation, not a gate: current
sequential runs show collection between sessions, while the host exposes no
forced-GC or retained-object attribution through this harness. A monotonic
multi-session trend requires investigation, but one pre-GC delta cannot issue
a leak verdict. A reproducible functional failure, stale result, resource leak,
or regression under the declared workload is still a runtime human-flow FAIL.
Figma phases that the host does not expose remain explicitly unmeasured;
designer judgment of perceived smoothness stays in business/experience
acceptance.

## Whole-system optimization

Judge Worldbend from explicit transform intent or structured input through
validated reusable geometry and the promised visible or published result. The
complete path includes Agent routing or human interaction, adapters, core
geometry, raster or CSS output, installation, interruption and recovery, later
source replacement, and residual state. A faster solver, smaller schema,
smoother preview, higher-quality render, or narrower adapter is not an
improvement when it materially worsens correctness, typed precision, final
quality, complete task latency or cost, resource stability, accessibility,
recoverability, carrier agreement, or maintainability elsewhere in that path.

A reviewer may optionally use a relevant technique, measurement, implementation
report, or user report from model knowledge or current public material to find
a higher engineering frontier. Record its provenance and uncertainty, extract
the underlying Worldbend-relevant mechanism or risk, and verify the current
source or runtime consequence before making a finding. No competitor inventory,
feature-parity exercise, or winner verdict is required, and an external lead
does not authorize a new format, field, compatibility layer, control, or UI
explanation. Report cross-lane tradeoffs inside the affected existing lanes.

## Validation lanes

### Development regression — Agent/Reviewer reports PASS, FAIL, or BLOCKED

Run current equivalents of:

```bash
pnpm check
pnpm test:comfyui
pnpm package:comfyui-local
pnpm performance:probe
```

`pnpm check` covers formatting, clippy, Rust/TypeScript tests, generated-contract
drift, property/generated-input checks, real WASM, Web, Figma, type checking,
builds, staged plugin/provider validation, built MCP runtime smoke, Capability
checks, and built-artifact drift. `.github/workflows/ci.yml` runs that complete
contract from clean macOS, Linux, and Windows checkouts. Reopen the scripts before relying
on that aggregate description; a checker changed with the implementation is
only a narrow veto.

The Comfy checks remain separate because the repository's base Rust/Node CI
does not itself supply Comfy's Python torch/Pillow runtime. The adapter test
must use the real built `worldbend` executable; the packaging result controls
only its own file/version/checksum inventory and not Comfy host loading.

The timing probe is observational until a current SLO is declared. For a
performance-sensitive diff, preserve its JSON output with the before/after
environment and method rather than quoting a prior anchor number.

### Runtime Agent flow — Agent/Reviewer reports PASS, FAIL, or BLOCKED

Use the staged/installed plugin in a fresh supported host. Verify loaded Skill,
plugin version, executable, live three-tool compact registry, the separate
eight-tool direct compatibility registry, exact describe schemas, one-call
known-operation selection, tool-call count, retries/fallback, happy/invalid/large-result
paths, render workspace authority, cancellation/recovery, and complete response
budgets. A repo-root stdio probe alone does not establish installed routing.

### Runtime ComfyUI flow — Agent/Reviewer reports PASS, FAIL, or BLOCKED

Install the self-contained package in a fresh supported ComfyUI host. Reacquire
the live node registry and verify all nine V3 node IDs, inputs, outputs, and the
five custom types. Execute all four packaged examples with IMAGE plus MASK; test omitted
and explicit target dimensions, tight/reference canvas, all three quality
values, invalid geometry, `B > 1`, cancellation, deadline cleanup, repeated
reuse of one transform with a changed source, and immediate subsequent work.
Inspect final image dimensions, mask polarity, transparent-edge RGB behavior,
child processes, temporary state, and retained memory. Source tests or package
inventory alone leave this lane `BLOCKED`.

### Capability conformance — Agent/Reviewer reports PASS, FAIL, or BLOCKED

Run the current local and central Profile checks through the real JSONL adapter,
then reacquire the manifest and execute its binary-relative adapter and compiled
transport probe from the installed distribution.
Report profile/version, copied schema and transport digests, adapter acceptance,
closed errors, conformance level, installed provider boundary, and independent
substitution status separately. Current provider-seeded conformance is not
cross-provider evidence.

### Runtime human flow — Agent/Reviewer reports PASS, FAIL, or BLOCKED

Exercise the real Web/Figma primary flow, cumulative mode changes, source
replacement, Apply/Apply-as-New, Transform Again, undo/redo/reset/cancel,
localization persistence, keyboard/pointer accessibility, invalid-input
recovery, selection changes during async work, and final residual state. Figma
mutation remains limited to the owner-authorized document.

When current authorization does not permit mutation of a live Figma document,
a locally served current packaged panel may cover only its observable panel
interaction. It must use the dimensions read from the current `figma.showUI`
call and real current host-message shapes and assets. Report Apply, host Undo,
selection mutation, hidden host phases, and installed-plugin integration as
BLOCKED or unmeasured; do not infer them from the local harness.

### Interactive UI performance — Agent/Reviewer reports current measurements and conditional verdict

Use the real Web build and installed/current Figma development plugin. Measure
final screen-space control bounds and pointer/control/camera coupling as part
of the interaction, not only frame delivery. Derive a rerunnable workload from
current product risk and record it with the result.
Report threshold status only when a current product threshold exists; otherwise
state `BASELINE ONLY`, any comparable change, and every unmeasured phase.
Functional or resource failures also affect runtime human flow; measured
smoothness does not replace owner acceptance.

### Business and experience acceptance — Owner reports OK, Not OK, or Pending

The owner/designer judges Photoshop familiarity, visual quality, task fit,
smoothness, and whether the next roadmap slice is worthwhile. Technical green
lanes cannot issue this verdict.

## Reviewer result

Lead with actionable findings and tight source locations. Then report
development regression, runtime Agent flow, runtime ComfyUI flow, Capability conformance/substitution,
performance/load/Agent economics, interactive UI performance, runtime human
flow, distribution when asked, and owner business/experience acceptance
independently. State what each current observation proves and what may still be
false.
