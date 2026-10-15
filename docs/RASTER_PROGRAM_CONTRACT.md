# Ordered raster program contract

## Purpose

`worldbend.raster-program@0.1` removes one concrete Agent/runtime seam: before
this contract, a caller chaining Perspective, rectification, and Canvas work
had to publish, reopen, hash, and decode an intermediate PNG after every
operation. A raster program executes the existing operations over one evolving
decoded raster, with explicitly bound immutable control maps when required,
and publishes one final PNG. Spatial Templates and Documents reuse this
execution contract rather than duplicating family geometry or filters.

This is a closed orchestration contract over existing deterministic semantics.
It is not a general graphics document, scene graph, layer stack, history model,
creative planner, public batch operation, or authorization to add a human UI.

## Document

A program contains:

- `schema: "worldbend.raster-program"`;
- `version: "0.1"`;
- `stages`: 1..8 ordered stages;
- one safe unique `id` per stage, matching
  `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`.

The current closed stage union is:

- `transform`: one canonical `TransformSpec`, explicit `tight` or `reference`
  canvas mode, and the existing stage-local `target_size` field when normalized destination
  coordinates need resolution;
- `rectify`: one canonical `RectifySpec` with caller-declared output size;
- `canvas`: one canonical `CanvasSpec`, including pixel-dependent Trim;
- `meshWarp`: one canonical `MeshWarpSpec`;
- `surfaceDeformation`: one canonical `SurfaceDeformationSpec`, retaining its
  envelope, ordered strokes and anchors;
- `deformationWork`: one canonical `DeformationWorkSpec`, retaining plane,
  Pin/Liquify, shape fitting and explicit Mesh edits in their core replay order;
- `remap`: one canonical `RemapSpec`. Lens operations omit `mapSlot`;
  displacement operations require a safe named `mapSlot`.

The inspection derives distinct `mapSlots` in stage first-use order. Every
required control map must be bound exactly once; extra maps are rejected.
Two stages may reuse the same immutable map. A map is neither the preceding
stage's output nor an embedded path, URL or image. The program's canonical
meaning remains independent of resource storage. The added stage variants
require a carrier built with their current program support; existing three-kind
programs retain their serialized meaning and execution.

Stages reuse the named operation-family contract. The program adapter may not
change corner order, infer geometry, select a subject, invent dimensions, or
substitute an adapter-local implementation.

## Execution and publication

The source is decoded and oriented once. Stages execute strictly in array
order, and each stage consumes the previous stage's complete RGBA output.
Control maps retain their decoded precision, including 16-bit and float unit
displacement. They are resolved once and remain unchanged across all stages.
The source and distinct bound maps together stay within 64 MiP of decoded
input, with configured per-resource axis, pixel and encoded-byte limits.
Before allocating the next output, execution resolves its exact dimensions and
checks per-stage limits plus the cumulative output-pixel limit. The product
ceiling is 128 MiP; the current MCP Agent ceiling is 64 MiP. Each ordinary
stage also remains within the renderer's configured axis, pixel, and source
byte limits.

Intermediate rasters remain private in memory. The implementation creates no
stage output files, exposes no partial result, and has no partial-success mode.
After all stages succeed, it PNG-encodes one final image into private staging,
hashes and syncs it, checks the complete response budget, and only then
atomically publishes the requested output. `dryRun` executes the same decode,
stage work, final encode, hashing, destination preflight, and response shaping,
but does not publish.

Cancellation is checked before and after the stage sequence and within the
existing render loops. The MCP adapter additionally owns worker timeout,
memory, admission, process cancellation, private source copying, workspace
paths, and final publication. Any error, cancellation, timeout, capacity
rejection, worker failure, response-budget failure, or dry-run leaves the final
destination unpublished and leaves no caller-visible intermediate file.

## Result

Inspection returns the supported program schema/version, ordered stage IDs,
kinds, and count. Rendering returns the existing final PNG status, byte count,
source/output hashes, output size, timing observations, and warnings, plus the
ordered stage input/output dimensions and cumulative stage-output pixels.
File results also report a sorted `maps` array of `{slotId, sha256}` when maps
are present. The Agent controller checks exact map hashes, stage identities,
continuous input/output dimensions and cumulative charges before publication.
Timing fields are observations, not an SLA or business acceptance.

The full CLI accepts repeated `--map MAP_SLOT=PATH` bindings on `program-render`.
`program_render` in the compact Agent catalog accepts
`maps:[{slotId,source}]`, where each source is under the granted workspace root.
Omitting maps keeps the existing unary entry. Path checks, retained file handles,
private copying and content hashes apply to maps as to the primary source.

## Deliberate exclusions

Mockup/Place source fan-in remains owned by Spatial Template's Mockup or
Composition Program root; its postprocess may use these stages and bound maps.
Timeline, output fan-out, multiple final outputs, per-stage files, branching,
conditional execution, loops, perception, generation, camera estimation and
adapter-local effects remain outside this sequential raster contract. Canvas
Sets and temporal contracts retain their own execution and publication rules.

The program is available only in full Agent/CLI builds. Figma and ComfyUI do
not compile or expose it. 
