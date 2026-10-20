# Field Notes receiving work

One durable work contains the paper scene and a static cover proof sharing the
same print identity. The example opens an authored GLB, changes edition, adopts
a later Blender camera/scene, retimes to six seconds, switches to a strict front
view, undoes, saves a document and reopens it. Previous source versions remain
content-addressed so saved work does not resolve to newer bytes accidentally.
If startup cannot open a saved work, its exact original record is retained and
can be downloaded; the healthy initial edition remains usable. Failed manual
opening preserves the currently accepted work.
Blender sources embed their original print; receiving overrides live in the
saved document and are not silently written into the source.

The receiving work now continues through three immutable author versions. The
third changes the actual paper-ribbon geometry, renames the exported camera to
`Reveal Camera.003` and supplies a seven-second/30-fps receiving rhythm. “查看
作者更新” previews changed fields and retained local choices before applying.
Conflicting camera, cover or rhythm changes can retain the local choice or adopt
the author's choice. Timing is one choice containing both frame count and rate;
mixing a local count with a new author rate would change the accepted duration.

Saved `worldbend.paper-theatre-file@0.2` files retain the ordinary document, exact
author baseline, local-choice ownership, viewing time and up to20 undo snapshots.
An explicitly chosen cover stays locally owned even if an intermediate author
uses the same print. Source adoption, undo and reopen move document and baseline
together, after the carrier accepts the complete candidate. A stale preview asks
for another preview; failed acquisition keeps the accepted work available.
During acquisition, conflict choices are locked and cancellation remains available;
cancellation retains accepted pixels, document, baseline and undo.
Known0.1 files and old browser records establish a receiving baseline using the
packaged source identity, retaining existing cover/camera/rhythm as local choices.
Missing historical intentions cannot be reconstructed. Unknown versions, invalid
history, unknown local fields and
baselines outside this package are rejected without replacing the accepted work.

This is a host authoring policy using the existing core update plan, not another
document or geometry API. The UI accepts updates to the same asset/expression
structure; structural authoring remains part of the wider Spatial Document job.

From the repository root:

```sh
pnpm build:scene-three
pnpm example:scene:generate
pnpm example:scene:dev
```

`pnpm package:scene-example` creates a local static receiving package and ZIP in
ignored task storage. Serve its extracted directory over local HTTP. It bundles
runtime dependencies, exact versioned assets and packed `.blend` sources, and
works without the repository checkout. A saved `.worldbend.json` belongs with
those assets. This command does not publish or install the project.

`pnpm test:scene-three:from-build` checks canonical source-MCP receipts, admission
and actual receiving behavior, then delivers/encodes the planned frames. The
check's artifact receipt records the exact document and scene fingerprints.
Native mesh angles, the actual renderer-projected front rectangle and alternate
output aspect are separate evidence from artistic judgment.
`node scripts/scene-example-package-check.mjs` additionally runs the moved
desktop/mobile package through the third source, saved lineage, conflict retention,
invalid handoff recovery and undo to the earlier author baseline.

This example stores its own saved file and browser state to demonstrate portable
host receiving. It does not implement Figma-to-IDE team collaboration or require
designers and engineers to use one computer/client. Normal design collaboration
stays in the shared Figma work, while engineering continues through the supported
handoff interfaces. Scene and mixed-expression support is limited to the profiles
documented here.
