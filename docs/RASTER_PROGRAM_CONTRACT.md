# Ordered single-raster program contract

## Purpose

`worldbend.raster-program@0.1` removes one concrete Agent/runtime seam: before
this contract, a caller chaining Perspective, rectification, and Canvas work
had to publish, reopen, hash, and decode an intermediate PNG after every
operation. A raster program executes the same existing operations over one
decoded raster and publishes one final PNG.

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
  canvas mode, and a stage-local `targetSize` when normalized destination
  coordinates need resolution;
- `rectify`: one canonical `RectifySpec` with caller-declared output size;
- `canvas`: one canonical `CanvasSpec`, including pixel-dependent Trim.

Stages reuse the named operation-family contract. The program adapter may not
change corner order, infer geometry, select a subject, invent dimensions, or
substitute an adapter-local implementation.

## Execution and publication

The source is decoded and oriented once. Stages execute strictly in array
order, and each stage consumes the previous stage's complete RGBA output.
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
Timing fields are observations, not an SLA or business acceptance.

## Deliberate exclusions

The initial program excludes Mockup/Place, custom Mesh, Remap, Timeline, source
fan-in, output fan-out, multiple sources, multiple final outputs, per-stage
files, branching, conditional execution, loops, perception, generation,
camera estimation, and adapter-local effects. Those families have different
source, fan-out, publication, or resource semantics and cannot enter this
union by merely adding another enum value.

The program is available only in full Agent/CLI builds. Figma and ComfyUI do
not compile or expose it. A future human workflow requires current designer
demand and the admission rule in `docs/PRODUCT_MODEL.md`; core
availability alone is not sufficient.
