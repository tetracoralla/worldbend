# Worldbend boundary ledger

This ledger is the provenance record for the product's scope boundaries.
`AGENTS.md`, `docs/PRODUCT_MODEL.md` and `docs/CONTRACT.md` remain the
executable statements; this file records where each boundary came from, what
would reopen it, and when it was last re-derived. A boundary here is a dated
hypothesis, not a law.

Every boundary carries one class:

- **hard** — an external platform or security fact. It changes only when the
  external fact changes.
- **identity** — a product bet about what Worldbend is. Changing it is an
  owner strategy decision, presented as an outcome trade-off.
- **deferral** — a dated decision not to build yet, with the evidence that
  would reopen it now recorded next to it.

Standing rules:

1. When work or a user need collides with a boundary, re-derive the boundary
   from current user, workflow and competitor evidence before enforcing it.
2. At every release milestone or competitor event, re-read the deferral-class
   entries and record what the new evidence says.
3. A deferral-class entry not re-examined for two consecutive milestones is
   flagged stale in review, not silently kept.
4. New standing boundaries are added here with class, evidence and a trigger
   at the same time they enter the contracts.

## Current boundaries

| Boundary | Class | Origin evidence | Last reviewed | Re-open trigger |
| --- | --- | --- | --- | --- |
| Deterministic explicit geometry only; no implicit perception application, camera/motion estimation, adapter-local simulation, scene graph | identity | Positioning decision 2026-09-10: the differentiation is reproducible explicit operations for humans and Agents; Photoshop imitation rejected as identity, not as capability | 2026-09-14 competitor analysis (Free Transformer competes on deterministic presets; assisted perception not required) | Users repeatedly ask "match this photo automatically" and an explicit, inspectable perception-Provider design can serve it within the deterministic envelope |
| Bounded deformation only (Mesh, Surface, Split Warp); no unbounded arbitrary deformation | identity | Contract integrity plus Photoshop-familiar bounded tools | Living boundary: expanded 2026-09-11 (mesh), 2026-09-12 (Split Warp) as needs demanded | Repeated free-form/puppet-warp demand with a bounded-envelope design |
| No public batch operation for Agents | deferral | No usage evidence yet; order, input correlation, partial-failure, cumulative-budget, fairness, cancellation and publication semantics must be defined before implementation | Never re-derived since writing — flag at first post-release milestone | A real agent workflow observed batching through repeated calls (≥3 assets across ≥2 sessions), or an explicit user request; then define the semantics first, then build |
| Scene-context live preview (composite the bend in the document while adjusting) | deferral — **trigger fired 2026-09-14** | Figma surface kept local and task-native; no scene model. Publication semantics are unaffected by a non-persisting draft | 2026-09-14: owner identified in-context preview as a core need for themselves and nearby designers, on top of the earlier Free Transformer gap analysis | Fired: see Open re-derivations below |
| Figma raster outputs capped at 4096 px per axis | hard | Figma image API limit | — | Figma raises the limit |
| MCP relative-path authority under an explicit granted root; preflight, overwrite authority, output limits, dry-run parity; CLI paths stay deliberate human arguments | hard | Agent safety boundary; escapes rejected with stable codes | — | — |
| One transform model in `worldbend-core`; adapters add no second model | identity | Architecture contract; prevents divergent semantics across carriers | Healthy | — |
| Human Figma UI free of Agent metadata, tool names and schemas | identity | Task-native human surface | Healthy | — |
| Editable results require the companion Worldbend Perspective effect | external process | Figma Community review; first submission rejected, labeled resubmission prepared 2026-09-10 | Track the submission outcome | Approval or a redesigned distribution route for the effect |
| ComfyUI adapter ships as source only; no registry release | deferral | Distribution effort versus unknown demand | 2026-09-14 public release kept it source-only | Real user demand after the public release |
| Capability projection remains narrower than the product contract | identity (while experimental) | Conditional experimental status; must not imply independent substitutability | Healthy while marked experimental | Graduating the projection from experimental, with its own compatibility work |

## Open re-derivations

### Scene-context live preview — fired 2026-09-14, decision recommended

The deferral rested on an unspoken extension of the explicit-publication
principle: "nothing renders on the document until Apply." That conflated
feedback with publication. The unified principle: **publication is explicit;
feedback during editing is not publication** — it must be WYSIWYG, perfectly
reversible, and must not disturb document history. Under that principle an
in-context draft is not a boundary violation but an obligation of the
"Photoshop-familiar" identity: the core job is placing a design onto a
surface in the user's document, and the adjusting loop must show the target
scene, not only the isolated source.

Constraint that made this feel like a boundary: Figma has no non-document
overlay API, so a canvas preview means real nodes written during editing.
That is an engineering obligation (single managed undo transaction, throttled
draft updates, guaranteed cleanup on cancel, selection loss, mode switch and
error), not a fundamental limit — the repository already operates this class
of machinery for native restore and publication rollback.

Smallest honest version: one draft image node (or the existing target when
updating), updated while dragging, wrapped in one managed undo step, removed
cleanly on exit; the panel preview remains for precise numeric work.
Promoting it to product behavior adds a draft-lifecycle section to the
Figma contract before release. One open verification: whether Free
Transformer's advertised "Live Preview while dragging" is on-canvas or
in-panel — their wording is ambiguous and was never run.
