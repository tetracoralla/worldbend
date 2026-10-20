# Liquify contract

`worldbend.liquify@0.1` is the brush-only deformation family of the shared
deformation work: typed Liquify controls nested in a `DeformationWorkSpec` as
its optional `liquify` block, exactly as the Pin view's `surface` controls
are. It is not a second container, a second mesh model, or a second
rasterizer: Liquify strokes displace interior vertices of the work's regular
mesh, and the resolved result stays the canonical `worldbend.mesh-warp@0.1`
plan, so every carrier, render, migration, and continuation rule of
`docs/DEFORMATION_WORK_CONTRACT.md` applies unchanged.

## Controls

A `LiquifyControls` value holds an ordered list of at most 64 strokes. Each
stroke has one stable id (the deformation stroke id rules), one mode, and 1
through 256 samples; the whole block carries at most 1,024 samples. Every
sample carries a normalized `position` in `[0,1]²`, a `radius` in
`[0.001, 2.0]`, a `strength` in `[0.0, 1.0]`, and — in push mode only — a
`delta` in `[-1, 1]²`. A sample outside its bounds, a delta outside push mode,
or a duplicated stroke id is `E_SCHEMA`; nothing is clamped or reordered.

The four modes are the bounded brush family:

- `push` displaces along the sample's `delta`;
- `bloat` displaces away from the sample position along each vertex's radial
  direction;
- `pucker` displaces toward the sample position (the negated radial);
- `twirl` displaces along the perpendicular of the radial direction.

## Replay

Liquify resolves inside the work's fixed order: the complete surface replay
(envelope, its strokes, anchors) first, then Liquify strokes in listed order,
then explicit mesh edits, then fold validation of the final mesh. A later
stroke compounds an earlier one; an explicit mesh edit still sets its vertex
exactly and wins; anchored vertices stay protected from Liquify strokes just
as they are protected from surface strokes. The sample kernel is the shared
smoothstep falloff of the surface brush; radial and twirl magnitudes scale
with the vertex's distance from the sample position, so the sample center
itself never moves and no direction is invented.

Planning is a pure function of the spec. The plan reports the replayed
Liquify sample count beside the Pin-view sample count; the Pin view itself
still projects only the surface controls, so a Mesh-view switch measures its
baseline after Liquify exactly as it does today. A Liquify block with no
strokes is valid and changes nothing. `meshSubdivisions` keeps the work's own
2-through-16 rule; Liquify adds no patch-divisibility requirement.

## Persistence, resources, and recovery

Liquify state lives and migrates with its owning work; there is no separate
Liquify document, no reverse migration, and no inference from pointer
history. Render inherits the mesh worker boundaries unchanged — cancellation,
capacity, dry-run, digest, and atomic publication are exactly the deformation
renderer's. Re-planning the same spec reproduces the same plan byte for byte,
and replaying a persisted work after reopen, source replacement, or a plane
edit yields the same interior. Nothing here animates: Liquify is state, not a
timeline.
