# Field Notes material work

One authored work uses a fluid mesh-gradient poster, a paper-texture note,
a moving Foil seal and glass controls. The receiving page uses the existing
four material bindings through `@worldbend/web/material-document` and preserves
its original content nodes and actions. The reusable receiver maps document
surface roles to this host's existing elements.

Build the Web package and source MCP, then run
`node scripts/generate-material-document.mjs`. Serve `packages/web` locally
and open `examples/material-document/`. `--check` verifies the committed
receipts against the current source planner. The receiver needs WebGPU for
Foil/mesh; it reports attachment failures instead of substituting a fake effect.

**Next edition** accepts a fingerprint-guarded content/material revision.
**Retry previous edit** then demonstrates rejection of the old document plan.
**Pause** controls the independent receiving clocks, respecting reduced motion.
**Reopen** retains healthy bindings and clocks while retrying an unavailable
renderer. Local session restoration stores only the example's
edition/pause state; it is not account storage or a four-family consumer
preference protocol. Reloading or returning after page retirement reattaches
the accepted edition and starts new transient clocks. In-session Reopen does
not reset them. Page retirement cancels pending work; a restored browser page
reopens the same edition.

`attachMaterialDocument` validates all delivered families before changing any
surface. It prepares added surfaces/families away from the DOM, publishes the
candidate together, preserves compatible instances and retires removed ones.
Guarded `revise` rejects earlier Agent state and changed receiving elements;
failed acquisition and cancellation keep the accepted work. Content updates
belong to the host and follow successful material publication. See
[the receiving contract](../../../../docs/SPATIAL_DOCUMENT_CONTRACT.md).
`pnpm test:material-document` verifies canonical source-MCP plans in the built
receiver, including real GPU changes, family/topology revisions, cancellation,
resource loss/recovery, host edits and ordinary controls.

Native material values can be supplied as typed Document input after a fresh
native read.

Artwork and construction are first-party and covered by the repository license.
