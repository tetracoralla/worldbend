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
| Reusable and advanced core programs | `crates/worldbend-core/src/template.rs`, `surface_deformation.rs`, and `motion.rs` own Spatial Template/Variation binding, Surface-to-Mesh projection, and Motion-to-Timeline projection respectively; their nested existing contracts remain authoritative |
| Production media carriers | `crates/worldbend-render/src/media.rs`, `vector.rs`, and `tiled.rs` own decode/encode disclosures, vector wrappers, global tile rendering, and their resource/publication checks while reusing core geometry and native sampling |
| Assisted perception | `crates/worldbend-perception` owns the explicitly selected proposal Provider, bounded analysis, uncalibrated scores, and uncertainty; it may not execute or enter the deterministic core |
| PSD interoperability | `crates/worldbend-interop` owns bounded fail-closed PSD/PSB parsing and selected Smart Object projection into the existing Spatial Template contract; parser output is untrusted adapter input |
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
| Mesh and Remap semantics | Custom grids and explicit lens/displacement programs follow `docs/DEFORMATION_CONTRACT.md`; mesh topology, map presence, channel/neutral/boundary behavior, shared native sampling, and feature projection remain exact. The release check differentially compares actual native and Chrome WebGL Lens/Displacement pixels at standard and high quality. | Adapter-local deformation, folded mesh acceptance, automatic lens/depth/flow estimation, implicit map choice, carrier-only math, or relying on duplicated shader formulas without a current cross-implementation measurement. |
| Surface Deformation semantics | The bounded cubic lattice, fixed regular boundary, explicit interior anchors, ordered source-space stroke samples, positive resolved topology, and canonical Mesh projection follow `docs/SURFACE_DEFORMATION_CONTRACT.md`. | Pointer-event replay, inferred controls/strokes, free boundary movement, folded output, a second sampler, or a claim of unconstrained Liquify. |
| Timeline semantics | Explicit frames or linear corner keyframes expand and render under `docs/TIMELINE_CONTRACT.md`, including stable order/IDs, exact sources, intermediate validation, cumulative budgets, cancellation, and all-or-none directory publication. | Tracking, invented frames, easing drift, frame chaining, partial publication, generic batch semantics, or a Python per-frame loop presented as Timeline. |
| Motion semantics | A reduced rational 1..240 fps timebase, first/last-covered keyframes, fixed linear/hold/cubic-Bezier easing, exact presentation times, canonical Timeline projection, and atomic PNG directory follow `docs/MOTION_CONTRACT.md`. | Floating wall-clock timing, unreduced rates, invented/interpolated source identity, tracking/flow, easing chosen by an adapter, partial sequence publication, or encoded-video claims. |
| Spatial Template and Variation semantics | One bounded Raster Program or Mockup root plus an optional Canvas Set remains canonical across reusable template inspection and ordered Variation Job rendering. Every item binds every source slot exactly once; IDs, output correlation, cumulative budgets, cancellation, and either all-or-none or explicit per-item continue publication follow `docs/SPATIAL_TEMPLATE_CONTRACT.md`. | Missing/extra bindings, adapter loops presented as one job, source paths stored in a template, item/output reordering, undeclared partial publication, publication after cancellation, or a new scene/layer graph. |
| Production media, vector, and tiled output | Explicit precision/ICC/format loss reporting, matching output extensions, bounded source inspection, affine SVG versus projective HTML, normalized-target binding, global tile coordinates, per-tile memory, Agent tile-count narrowing, digest rechecks, and atomic publication follow `docs/MEDIA_PIPELINE_CONTRACT.md`. | Silent precision/profile loss, mismatched filename bytes, normalized geometry resolved against a 1x1 reference, non-PNG tiles rejected after rendering, an oversized tile allocation, mock-only vector parity, or late controller-only resource rejection. |
| Assisted perception Provider | One explicitly selected bounded Provider may return no candidate or up to three validated plane candidates with source facts, uncalibrated scores, and typed uncertainty. A caller must explicitly author the accepted RectifySpec before deterministic execution. | Highest-score auto-application, a probability claim, implicit crop/aspect choice, Provider math entering the core, missing uncertainty, or provider fallback hidden from the caller. |
| PSD Smart Object interoperability | Bounded read-only PSD/PSB inspection, source facts, stable record IDs, explicit importability reasons, caller-selected eligible objects, and Spatial Template projection follow `docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md`; source access remains descriptor-confined. | Embedded payload extraction, linked-file fetching, PSD writing, silent layer selection, ignored Warp/alternate transform, parser panic escape, or Photoshop semantics entering the core. |
| Single-raster Program semantics | One `worldbend.raster-program@0.1` chains 1..8 uniquely identified Transform, Rectify, and Canvas stages under `docs/RASTER_PROGRAM_CONTRACT.md`. It preflights every next output and cumulative pixels, keeps intermediates in memory, preserves order, and publishes exactly one final PNG after cancellation and response checks. | Intermediate publication/redecode, stage reordering, partial success, allocation before the cumulative check, branching/fan-in/fan-out, adapter-local math, or exposure in Figma/Comfy without a current consumer. |
| Live plane pose and shared strips | Pose and plane_strip resolve through the one core solver into a reusable TransformSpec plus CSS per `docs/PLANE_POSE_CONTRACT.md`; strip panels share one parent homography with collinear top and bottom edges, ordered correlated IDs, and all-or-nothing publication on any invalid panel; live web bindings keep single-writer element ownership, latest-update coalescing, last-valid recovery after invalid input, and full listener and inline-style restoration on disposal or member rebinding. | Adapter-local transform math, per-panel size tiers or independent tilts replacing the shared mapping, partial style publication after a rejected plan, a stale async result overwriting newer input, silent clamping or corner reordering, a disposed or replaced binding still writing styles, or rebinding leaking the previous group's observers and declarations. |
| Stable errors | Every `docs/CONTRACT.md` product error remains reachable or explicitly reserved; CLI/MCP mappings agree; Capability narrowing is closed and intentional; messages/details and echoed input stay bounded. | Unknown product error falls through as a misleading known error, long input is reflected, or Capability accepts a shape its Profile rejects. |
| Geometry diagnostics | Inspect, solve, compose, CSS, and render use core solving; reprojection, horizon, determinant, bounds, and inversion keep their declared meaning. Orientation-reversing homographies caused by explicit flips remain legal. | Render bypasses `solve_spec`, determinant sign is “repaired,” horizon checks differ, or diagnostics describe geometry not executed. |
| Raster and side effects | Inverse mapping, pixel centers, premultiplied-alpha filtering, transparent outside samples, output limits, return feasibility, staging, and atomic publication follow `docs/CONTRACT.md`; dry-run executes the same preflight without publication. | Mutation precedes final preflight, overwrite occurs without authority, cancellation leaves staging/output, or dry-run and write disagree. |
| Agent resource authority | MCP and Capability render paths stay under one explicit descriptor grant and reject absolute, parent, URI-like, symlink, and non-regular-source escapes. Held handles remain authoritative under pathname replacement. The private staging parent is an absolute, existing, writable controller setting outside that grant, read once and fixed at server startup. The complete call, including queueing, worker, diagnostics, and response, stays bounded on macOS, Linux, and Windows and recovers after breach. | Ambient cwd becomes authority, a check/use race redirects access, a path escapes, staging is placed in or beneath the granted root, a request-time environment change redirects staging, waiters/workers grow without an enforceable lifetime, or timeout/memory failure poisons later requests. |
| Direct routing and catalog economy | The direct compatibility projection retains exactly the current eight task tools. The default installed projection has exactly `search`, `describe`, and `run`; a known operation needs one run call, describe returns its exact schema on demand, and run reuses the direct operation's closed parser and handler. Annotations including `openWorldHint=false` are accurate, and both live catalogs plus result/error bytes stay within their independent budgets. | A new operation grows the default catalog by another full tool schema, compact run bypasses exact operation validation, direct compatibility drifts, known requests require discovery, descriptions misroute, or success uses a generic fallback. |
| Carrier projection and package isolation | Figma compiles without CSS and contains no Agent/Comfy interface; Agent contains no human/Comfy UI; Comfy compiles only its declared native commands and contains no Agent/Figma interface. The Perspective operation order, five sibling task declarations, and declared Figma byte ceilings are checked from built artifacts. | A carrier gains another carrier's UI or adapter, an unused heavy feature is linked by default, a full CLI enters Comfy, Correct disappears from the frozen Perspective order, a task enters `EditorMode`, or a package exceeds a declared ceiling. |
| WASM/JSON boundary | Real WASM tests cover full round trips, camelCase names, stable panic normalization, and large finite `f64` values without an accidental `f32` path. | Mock-only parity, panic leakage, numeric truncation, or accepted fields disappear at JSON/TypeScript boundaries. |
| Product Skill | The installed Skill describes currently supported routes and boundaries and does not duplicate schemas or deny a supported operation. | Stale examples/boundaries, algorithm prose, version mismatch, or Skill visible while tools are absent. |
| Comfy single-image route | V3 node IDs/types stay stable, strict TransformSpec validation crosses the real native CLI, IMAGE/MASK alpha round-trips under the declared 8-bit and premultiplied-alpha rules, the exact all-zero `[1,64,64]` no-alpha `LoadImage` sentinel expands to the IMAGE dimensions while every non-empty mismatch fails, omitted normalized targets bind to source IMAGE dimensions, and `B != 1` fails before a render. | Python transform math, silent tensor clamp, mask polarity reversal, acceptance of a non-empty or differently shaped mismatched MASK, hidden batch iteration, PATH-selected binary, leaked child/temp state, or local package inventory presented as installed-host proof. |
| Comfy Canvas route | Strict Canvas Set validation crosses the native CLI once, Apply returns ordered heterogeneous IMAGE/MASK lists plus the resolved plan, replay requires matching dimensions and never resolves Trim again, and the 16 Mi-pixel cumulative limit includes every output. | Different sizes are stacked into one tensor batch, Python plans geometry, one child is launched per variant, list order drifts, Trim is recomputed, high-precision maps are advertised through the 8-bit boundary, or installed-host behavior is inferred from adapter tests. |
| Comfy Remap route | Strict Remap validation and execution cross the reduced native CLI, lens rejects a map, displacement requires one, optional map MASK supplies alpha, and one retained Remap can synchronize compatible IMAGE/MASK/control inputs. | Python lens/displacement math, hidden map defaults, wrong mask polarity, unrequested map acceptance, high-precision claims through the 8-bit PNG boundary, or installed-host behavior inferred from adapter tests. |
| Figma human route | The installed development plugin operates only on the selected authorized document, retains transform/replacement state, preserves undo/recovery and localization, and keeps both live manifest entrypoints present throughout either partial build. Its explicit density policy enforces the 4096 px per-axis image limit without conflating raster pixels and document placement: Fit to Figma proportionally fits only pixels, while Keep original pixels blocks only an over-limit Apply and recovers immediately when geometry returns within the limit. A quiet editor-corner readout shows source -> requested -> applied pixels when fitted. New results publish beside every producing input on the inputs' top edge, one fixed gap right of the inputs' combined right edge, stepping right across nearby same-band page content only while the cumulative detour stays within one output plus its surrounding gaps, then dropping below wider obstacles or longer rows; replacements keep their position, and publication keeps the producing inputs in view beside the result. Its 820 x 760 panel uses one persistent icon workspace navigation (Perspective, Sizes, Templates, and More) above one full-width top operation bar for mode/active parameters, one full-width bottom session bar for Reset and publication actions, and one uninterrupted rectangular editor exactly between them; session undo and redo ride the standard shortcuts routed per workspace rather than persistent footer buttons. Active Transform/Warp parameters stay visible; operation labels use transparent low-emphasis chrome and one pale-blue selected surface. More is the final control and contains Composition, Mesh, Split Warp, and Lens & maps as task-labeled advanced transforms plus secondary session, output-density, and language actions; its Perspective-only entries hide inside task workspaces, and More carries selected emphasis while an advanced workspace is active. Transform keeps Width -> Height -> Link, Skew X -> Skew Y, and Angle -> Placement as three continuous visual groups over one shared pair of parameter columns plus a dedicated 32 CSS-pixel action column, so all five sliders have equal screen-space widths of at least 110 CSS px and a narrower frequent-use domain than their precise numeric fields. Frequent transform commands are authority-rendered icon buttons with localized hover/focus tooltips; one repeatable clockwise 90-degree command covers the 180-degree and counter-clockwise equivalents by repeated presses, while its icon still depicts one object receiving one directional action rather than a continuous cycle. Placement replaces rather than overlays the parameter region and uses a right-facing enter arrow; down arrows remain reserved for dropdown/disclosure semantics. More, Close, Link, Check, workspace-tab, workspace-task, surface-entry, Flip, and Rotate product icons retain assets from the configured icon authority rather than font glyphs or locally drawn SVG paths. Repeat Last Transform is an explicit text command in More rather than an ambiguous repeat glyph. Every primary workspace navigation icon exposes the same localized name on pointer hover and keyboard focus without persistent visible labels; advanced entries expose names and task descriptions in More, and entering one returns focus to More. A bar-height change may refit or recenter the preview, but it leaves the canonical spec, recipe, pivot, and Warp value unchanged and keeps every finite handle center inside the editor safe inset. Zoom remains available by direct input and standard shortcuts without persistent zoom chrome. | Stale selection applies, state silently resets, failed work replaces a node, an over-limit raster is published, density fitting silently changes placement or aspect ratio, the size readout hides a fit or covers interaction, returning within budget leaves Apply disabled, technical metadata or a generic operation heading enters the task UI, nested selected chrome competes with the canvas, More leaves the workspace navigation, hides active-operation commands, or makes advanced work undiscoverable, semantic parameter siblings are split by an unrelated control, parameter rows use different column tracks or slider widths, duplicate rotation buttons expose outcomes already reachable by repetition, an icon exposes the repetition/cycle mechanism instead of the single action or lacks a localized hover/focus tooltip, Repeat Last Transform returns to an ambiguous glyph-only action, the bars float over or leave gaps beside the editor, a slider is too short for deliberate adjustment or silently clamps precise typed values, a down arrow falsely implies a dropdown for a replacing surface, a product icon is a font glyph or locally invented path, a primary workspace icon retains a visible text label or loses its localized hover/focus name, an advanced entry lacks its task description, keyboard focus is dropped after entering a workspace, layout reflow changes canonical geometry, a control covers a handle, Escape dismisses a transient surface and also cancels the edit, or a UI/main build transiently removes its sibling entrypoint, a new result covers an input or same-band page content, teleports past a wide frame or long row, a replacement moves, or publication frames the result alone without the producing inputs. |
| Figma task workspaces | Sizes and Templates are primary replacing workspaces; Composition (`mockup`), Mesh, Split Warp (`surface`), and Lens & maps (`remap`) enter from More as advanced replacing workspaces. All return to Perspective without entering `EditorMode` or changing the current operation order. Perspective remains the enabled keyboard and pointer recovery destination while a task source is refreshing or invalid; a final selection failure returns there with one error surface. Templates stores bounded canonical Composition/Canvas/Mesh/Surface task values and correlates every save/delete response; storage read failure initializes a usable read-only fallback, rejects every mutation without calling storage, and leaving invalidates in-flight Use work. Sizes owns six canonical Canvas operations and 1..8 named outputs; Composition owns 1..8 explicit selected planes; Mesh owns a fixed-boundary 2..16 grid; Split Warp owns a bounded cubic envelope, pins and source-space strokes; Lens & maps owns explicit Lens or source-plus-map Displacement. Every preview consumes a canonical plan, every result retains its canonical spec, and all routes enforce the 4096-axis boundary and recoverable create/replace publication. Hidden workspaces are inert and Perspective state survives the round trip. | A task appends controls to Perspective, recomputes semantic math in TypeScript, silently chooses a map/plane/lens, an unrelated mutation completes a save/delete, a failed storage read permits an empty in-memory library to overwrite stored data, rejected storage blocks the rest of initialization, an async Use navigates after leaving, source loss leaves a disabled task selected or duplicates its error, direct manipulation is interrupted by rebuilding an active handle or leaves its last visible point outside history, a hidden workspace renders, stale selection applies, a duplicate template name saves an indistinguishable entry, failure leaves partial nodes, source generation is lost, or returning changes Perspective semantics. |
| Perspective gesture semantics | After a 4 CSS-pixel intent threshold, the dominant physical drag axis locks until release. Horizontal drag changes only the dragged corner's x and gives its same-row corner the opposite x delta; vertical drag changes only the dragged corner's y and gives its same-column corner the opposite y delta. The other two corners and every unrelated coordinate remain fixed. Keyboard chooses the arrow axis directly; explicit Perspective mode and the Shift temporary inverse use the same gesture-start quad. | One gesture moves three corners, the pair switches under diagonal jitter, perpendicular coordinates drift, modifiers make an already-distorted quad jump, or an adapter invents a different mapping. |
| Direct manipulation | Image geometry may zoom, but handles and pivot retain their declared screen-space visual and hit sizes at Fit, manual zoom, and post-release camera recovery. Distort keeps zoom fixed; away from the edge its camera pan stays fixed apart from core-derived scene/workspace offset. An outward pointer in the bounded edge zone causes capped compositor assistance only on active axes, while the editor compensates the frozen gesture mapping so the grabbed control remains coupled. Free may sustain edge pan; Perspective consumes one pair-normalized assist step per fresh active-axis pointer sample and settles while the pointer is still. Return, release, cancellation, capture loss, blur, and page hide stop it promptly. Exact release commits its final sample; interruption or a re-entry move with no pressed buttons closes at the last pressed sample. Post-release recovery and Fit may cross the ordinary 10% zoom floor, must keep every finite corner center inside the 16 px safe inset, and may not change geometry. | A parent compositor scale shrinks hit targets, edge motion starts without outward intent, a still Perspective pointer keeps expanding its pair, motion continues after return/release, a locked perpendicular axis pans, the grabbed control detaches, an older sample commits, Fit strands a corner at the ordinary zoom floor, a positive recovery is labeled 0%, or recovery changes canonical geometry. |

## Error-contract review

The persistent icon workspace navigation exposes Perspective, Sizes, and
Templates through localized tooltips, with Composition, Mesh, Split Warp, and Lens & maps
as task-labeled advanced entries under More, and sits above the
Perspective mode strip, whose checked order is Transform, Distort, Warp,
Correct with Free and Perspective as Distort-local peers. More is the final
control of that navigation and also contains secondary session, output-density,
and language actions. Canvas never enters
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
- reject relative, missing, non-directory, unwritable, or granted-root-contained
  private staging settings at startup, and prove the setting is not reread per
  request;
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
- run media/vector/tiled preflight with matching and mismatching output
  extensions; require an explicit target for normalized vector/tiled specs;
  exercise PNG, TIFF, JPEG, and WebP tiles, the per-tile memory ceiling, the
  narrower Agent tile-count ceiling before rendering, cancellation, and exact
  manifest/file digest correlation;
- reject malformed PSD descriptors, Smart Filter and non-neutral Warp records,
  non-finite transforms, inconsistent eligible records, parser failure, and
  over-limit source/layer/depth counts without panic or JSON non-finite values;
- crash-contain adversarial PSD descriptor nesting on Agent paths, and keep the
  in-process full CLI parser boundary explicitly open until the dependency
  supplies a depth limit or the CLI gains process isolation;
- reject missing/extra Spatial Template bindings, duplicate item/output IDs,
  and cumulative overrun; require no final Variation directory after cancellation
  under either policy or after any failure under allOrNone. Explicit continue
  jobs must preserve ordered success/failure correlation, account for work before
  a later stage fails, and skip failed output directories;
- make Figma template storage reads and writes reject, interleave save and
  delete responses, and leave Templates while Use is awaiting its plan; the UI
  must remain usable and only the matching active request may change status or
  navigation;
- drag Mesh and Split Warp handles through preview and identical release samples;
  require Undo/Redo, core-projected handle alignment, and draft/history retention
  across same-source pixel refreshes and workspace round trips. Hold PNG encoding,
  leave or change selection, and require no late publication from any workspace;
- split then merge an unchanged curved envelope without changing rendered pixels;
  reject lossy merges and incompatible pin-density changes. Exercise keyboard pin
  activation, brush final release, foreign pointers, Escape rollback and local
  Undo after publication;
- enter each Figma task, begin a source refresh, then reject that selection;
  require Perspective to remain keyboard/pointer reachable during the refresh
  and to become the selected workspace with one visible error after failure;
- introspect both live `tools/list` projections, exact names, annotations,
  schema constraints, independent complete byte sizes, exact describe output,
  direct-versus-run parity, and one-call known routing in a fresh installed host;
- compile the Figma WASM and Comfy CLI profiles without default features,
  inspect the staged Comfy help surface, compare each built package against its
  forbidden paths/suffixes, and apply the current Figma runtime/archive/unpacked
  ceilings; every packaged Comfy API example must contain at least one real
  Preview or Save output node so the host can schedule it; package success does
  not establish installed-host behavior;
- run a current Comfy `LoadImage` RGB source whose host MASK is the exact
  all-zero `[1,64,64]` sentinel and require expansion to the IMAGE dimensions;
  make the same mismatch non-empty and require `E_SCHEMA`, then prove a normal
  workflow succeeds immediately afterward;
- cross the WASM bridge with current full composition output, an unexpected
  panic, camelCase fields, and approximately `1e15` translation values;
- switch Figma selection or source generation during export/apply, then verify
  the target, visible result, selection, undo state, and residual artifacts;
  hold native lookup/import preflight pending and change the source; all
  producing workspaces must reject without writing, then accept a fresh retry;
- hold a selection export pending across several settled selection changes;
  require only the newest queued source to export, with no stale source/error
  delivered. Edit a linked source descendant during the initial export and
  require invalidation even before the first prepared snapshot exists;
- move the text caret and change the selected text range without changing
  selected nodes; require no preview reload or draft invalidation, including
  while an export is pending. A real content edit must still refresh even if
  caret events continue; changing page or selecting away and back must reload;
- complete Apply in Perspective and every producing task workspace, require
  the source or source/result selection and draft controls to remain live,
  make one local parameter edit, and publish a second result without reopening
  or reselecting; before that edit, require one standard Undo to remove only
  the fresh host result, and after it require Undo to resume local draft
  history;
- after replacing a selected result, deliver the host's own node-change
  refresh and require the preview size/placement to match the saved output,
  without compounding the just-applied transform. Result-only selection must
  remain the same selection even when rendering resolves internal content;
  verify that its pending host Undo survives the refresh;
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
- in the current built Figma panel, press each corner without moving the
  pointer and sample its screen-space rectangle and transform during
  `pointerdown`; require no coordinate jump, equal width and height, and the
  same result after release. Repeat for a shared task direct point and the
  Transform pivot so generic button feedback cannot replace geometry-owned
  transforms;
- render the current panel with Figma's `figma-light` and `figma-dark` host
  classes and semantic variables. Require chrome and canvas tokens to update
  without reload, keep the source/output HUDs and reference line legible, and
  preserve geometry, selection, enabled state, and focus. A standalone preview
  may exercise the system-color-scheme fallback but does not establish the
  installed Figma host integration;
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
  confirm More remains the final control of the workspace navigation, exposes
  Composition, Mesh, Split Warp, and Lens & maps with task descriptions, hides its
  Perspective-only entries inside task workspaces, omits active Transform
  commands, and carries selected emphasis for an active advanced workspace.
  The mode strip keeps the checked Transform, Distort, Warp, Correct order with
  Free and Perspective as Distort-local peers, and every primary workspace
  navigation icon exposes the same localized name by hover and keyboard focus.
  Press clockwise rotation once, twice, and three times and compare the result
  with +90, 180, and -90 degrees respectively. Placement replaces the
  parameter region, every finite handle center remains inside the editor's
  16 CSS-pixel safe inset after reflow, initial load and explicit Fit leave the
  source/output HUD rectangles clear of all four corner hit targets,
  pointer/trackpad zoom still anchors to
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
- when changing the Figma sampler, run `pnpm test:figma-shader` with Chrome or
  Chromium and inspect actual host pixels. The GPU check covers the shader's
  premultiplied texture contract, interpolation, orientation and source bounds;
  it does not establish parity after Figma's compositing or shape coverage;
- run `pnpm test:remap-parity` on a release host with Chrome or Chromium and
  require actual native and WebGL Lens/Displacement pixels to remain within the
  script's declared standard/high-quality tolerances; a TypeScript-only formula
  test or successful shader compilation is not a substitute;
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
- drag a Mockup corner and a Mesh interior point, then trigger capture loss,
  pointer cancellation, workspace exit, and window interruption independently;
  require the last visible point to enter task history exactly once and the
  next Undo plus immediate second drag to work;

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

Historical performance measurements are observations, not SLAs. The performance probe has no timing gate until the product declares a
reproducible workload and threshold. It fails only on correctness or benchmark
integrity. A faster core number cannot compensate for unbounded queue/resource
growth, unsafe effects, worse tail latency, or higher Agent context cost.

Worldbend exposes no generic public batch operation. Variation Job is the
ordered multi-item production contract: item identity, correlation, cumulative
budgets, cancellation, and either all-or-none or continue-on-item-failure
publication. Timeline is a specialized
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
pnpm package:macos-dmg
pnpm verify:macos-dmg -- /absolute/path/to/worldbend-<version>-macos-arm64.dmg
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

The DMG checks are a separate distribution lane. Require a clean source record
for a public candidate, the exact mounted four-file inventory, complete
component file and legal digests, macOS arm64 binaries, the declared ad-hoc and
unnotarized trust boundary, packaged MCP smoke, and an Agent Host standalone
component preview. A passing DMG mount does not establish an installed Agent
Host environment, and a staged plugin does not establish the downloadable
disk image.

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

For the Figma output workflow, select a native source, then select and edit
its text and move child elements on the Figma canvas. Require the whole-source
preview, current transform draft and local history to survive. Publish both
an independent editable Frame and a high-resolution image. Select either
result alone after reopening; test update, new same-type and new other-type
output. Verify stable update IDs, distinct new IDs and unchanged original
content. Repeated image reopen/update must retain density without repeated
multiplication or transformation. Editing its source with Worldbend closed
must refresh the reopened preview, leaving the image unchanged until Update.
Unsupported native output must leave HD output usable. Inspect all visible
output labels, keyboard activation and footer layout in both locales.
Check the built selection entry in both languages, light/dark host colors,
and compact windows down to the 300 px host minimum: the empty illustration
must identify the canvas selection workflow without fake controls; loading
must replace it; invalid selections
must retain the actual recovery text and a reachable, non-overlapping Restore
action. Selecting valid content again must recover the normal editor.

Delay optional renderer discovery beyond source export; require usable image
preview/output immediately and correct Frame availability when discovery
finishes before or after image decoding. Late replies must not reset a draft
or enable another selection's output. Repeat HD output at unchanged source
and resolution and compare actual PNG pixels while checking that only one
full-resolution source read occurs. Refresh content, increase resolution,
fail a read and deliver an obsolete reply; require fresh pixels, recovery and
no stale publication or retained failed source.
Use an opaque pale border around a contrasting interior and inspect actual
GPU-rendered plane-edge pixels, including explicit flips and Warp. A dynamic
sampling branch must not pull distant interior colors into that border.
Check native logical bounds separately from the HD fit/reject preference.
After publication from a descendant selection, the first document Undo must
restore the result even if Desktop first replays a blurred field's text history.
With a descendant still selected, change the native effect, invoke Restore
transform, and require the repaired result preview and selection to survive.
Leaving that result or changing its saved record during repair must prevent
the write.
Zoom dark and light artwork beneath source/size overlays and require fixed,
crisp text with stable contrast; hover primary actions without losing contrast.

For the native Figma carrier, follow `docs/FIGMA_HANDOFF.md`: provision
and inspect an exact Shader build using real pixels, generate from a native
Frame through visual controls, edit text/image fills with the plugin closed,
reopen only the result, and compare the full source preview with the actual
output. Include output smaller than the source so ancestor clipping cannot
hide content during export. Verify stable IDs, parameter drift rejection,
stale external handoff rejection, publication rollback, and host Undo/Redo of
geometry plus shared records. Inspect native Figma Agent content edits and
external MCP geometry edits separately; source tests cannot stand in for them.
Include duplicate adoption without touching its original, native Resize/Scale
and content reflow, nested parent placement and stale reparenting. Verify the
actual visible mapping before and after an unchanged update of a resized
Frame, including fractional dimensions. Use CENTER and SCALE constraints on
native Content: creation, replacement and rollback must not move or resize it.
Refresh an open plugin after an external Agent changes its shared operation;
the next Apply must not revive the old mapping, a local draft must remain
recoverable, and manual viewport navigation must survive the refresh. Verify the
installed native MCP request preparer, the actual Figma request execution and
the visual readback separately. A bundled renderer identity or an owned-account
import does not prove that a designer can acquire the public effect. One Undo
does not establish a usable multi-step host history.

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
