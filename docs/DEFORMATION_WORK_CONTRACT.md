# Deformation Work contract

`worldbend.deformation-work@0.1` is one replayable deformation work whose
Plane, Pin, and Mesh are editing views over the same explicit state. It does
not add a second rasterizer, a second mesh model, or an inference step: the
work resolves to the existing canonical `worldbend.mesh-warp@0.1` execution
model, and every view is a projection of one plan.

## State

A `DeformationWorkSpec` contains one ordinary `TransformSpec` (the Plane view;
it must not also contain a preset Warp), its optional normalized `targetSize`,
a `meshSubdivisions` value, optional Pin-view surface controls, and an ordered
list of Mesh-view edits. Optional `boundary: "fixed" | "free"` defaults to
`fixed`; explicit `free` enables an authored outer silhouette in the same work.
Optional `shapeFit` retains a closed boundary recipe:

- `meshSubdivisions` is 2 through 16 with no surface controls, and 4 through 16
  plus the patch-divisibility rule when surface controls are present.
- `surface`, when present, is exactly the `worldbend.surface-deformation@0.1`
  controls: one 1..4 by 1..4 cubic Bezier envelope, up to 64 anchors, and
  up to 64 ordered strokes with at most 1,024
  total samples. The owning work supplies the envelope boundary policy;
  anchors and brush strokes continue to target interior vertices.
- `liquify`, when present, is exactly the `worldbend.liquify@0.1` brush-only
  interior: up to 64 ordered mode strokes (push, bloat, pucker, twirl) with
  at most 1,024 total samples. Every rule, bound, and phase of
  `docs/LIQUIFY_CONTRACT.md` applies unchanged.
- `meshEdits` holds explicit unique `column,row` vertex placements. Fixed
  works accept at most 225 interior edits within `[-2,3]` per axis, preserving
  the previous contract. Free works accept all vertices including edges and
  corners (at most 289 at density 16), within `[-2,3]` per axis. Outward
  placements retain their original authored coordinates. The core normalizes
  their resolved bounds into a unit-bounded execution mesh and reframes the
  homography without changing any authored point's position. The outline must
  remain simple and every face positive. Cubic controls use the same finite
  authoring extent. Expansion that crosses the projective horizon is refused.
- `shapeFit` contains an authored `contour` with the same closed Line/Cubic
  segment representation as a Mockup clip contour. It retains the original
  curves rather than saving a generated mesh in their place. Optional
  `cornerPositions` contains four distinct positive-winding perimeter fractions
  in `[0,1)`, corresponding to source TL, TR, BR and BL, in boundary order with
  one wrap. Omission selects ordered bounding-box landmarks deterministically.
  An optional `refinement` selects one or two conforming passes. Omission uses
  two when that fit stays within 512 vertices and 768 faces, otherwise one,
  reserving topology for exact composition with later interior edits. Both
  choices retain the same flattened boundary and its curve precision. Explicit
  requests still use the complete shared mesh limits.
  Optional `clip` retains a complete Mockup compound fill in the same normalized
  destination-plane coordinates: all original Line/Cubic contours, winding
  rules and independent region references. A connected fitting domain can
  contain multiple filled parts and holes; the mask intersects that domain.

A work with no surface controls and no mesh edits is valid: it is one plane
over the identity interior mesh.

## Resolution and views

Planning is a pure function of the spec. The interior resolves in one fixed
order:

1. the regular row-major grid at `meshSubdivisions`;
2. when surface controls are present, the complete surface contract replay:
   cubic envelope evaluation, ordered strokes, anchor restoration, and
   fold validation of that intermediate mesh;
3. when Liquify controls are present, the complete Liquify contract replay:
   its ordered mode strokes compound the pin-resolved interior, anchored
   vertices stay protected, and the block reports its replayed sample count;
4. every mesh edit sets its vertex's warped position, overriding whatever the
   pin and Liquify phases placed there — including an anchored vertex. A later
   explicit edit wins; anchors still protect their vertices from strokes;
5. the authored interior mesh is validated fold-free with a work-attributed error;
6. when `shapeFit` is present, the boundary fitting described below is composed
   after that interior, then the complete execution mesh is validated.

The plan carries the canonical `MeshWarpPlan` (the render target and the
Mesh view), the pin-view projection (resolved anchors, stroke-sample count,
and the pre-edit mesh the pin phases resolved), and the mesh-edit count.
Editors read pin positions from the pin-view mesh and hand-placed positions
from the final mesh; adapters never re-derive deformation geometry. Changing
the plane transform does not disturb the normalized interior deformation, so
Plane-view edits, source replacement, and later re-plans compose without
semantic drift.

An outward result also carries `authoredView`: the unnormalized resolved mesh,
its authoring-plane solve in the complete output canvas, and `canvasOrigin` in
original reference pixels. Rendering uses `meshWarp`; editors use the authored
mesh and solve. The complete raster canvas grows only where the expanded plane
would otherwise be clipped. The spec retains its original transform and
`targetSize`; these are never overwritten by an execution frame. Saved updates
use the origin and size difference to preserve the authored plane's document
position, including after independently scaling the result.

## Boundary fitting

The authored contour has 2 through 128 segments. Coordinates are finite and
within `[-2,3]`; the flattened boundary must lie in the normalized unit square.
Curves are flattened by bounded de Casteljau subdivision to a normalized
deviation of `1/1024`, with at most 512 boundary points. Crossing, touching,
backtracking, empty-area or excessive contours fail with `E_SCHEMA`. Reversing
the native winding retains the start point and the same positive-winding meaning.
A triangular outline receives an exact midpoint on its longest edge to retain
the four source-square landmarks.

The core triangulates the target boundary, improves interior edges with bounded
deterministic Delaunay flips, refines conformingly, maps its boundary by side
arc length onto the four source-square edges, and solves
positive local mean-value weights for interior UVs. The bounded solve checks
its residual and the final shared topology; nonconvergence does not fall back
to an identity or clipped plane. Concavity retains its original indexed faces.
Edge improvement preserves every boundary edge and prevents new triangles
whose three fixed UV vertices lie on the same source-square edge. This keeps
ordinary rounded contours from degenerating into thin parameterization fans.
Resampling the fit into a regular grid would change this mapping and can fold.

Composition accepts either fixed or free authored boundaries inside the fit's
unit source domain. It overlays the authored grid's target triangles with the fit's
source triangles. Each intersection retains both piecewise-affine maps and
interpolated interior shading. It does not bake fitting into Pin, Liquify or Mesh
controls. The plan's optional `shapeFitView` carries the resolved fit, selected
corner positions, refinement and solve iteration count, plus the complete
pre-fit `interiorMesh` for the regular Mesh editor. `meshEditBaseline` retains
its existing pre-edit meaning. Execution continues through `meshWarp` and the
existing native/Web renderers. Shared limits are 2,048 vertices and 4,096 faces;
an excessive composition fails without discarding edits or changing density.

Mesh points, Pin targets and brush footprints project through the resolved fit
and then the core-solved plane. Pointer painting inverts the plane, the fit and
the complete visible authored interior, including Liquify and Mesh placements;
Pin targets separately retain their pre-edit Pin meaning. Concave notches have
no inverse image coordinate and cannot create a brush sample or snap a dragged
Mesh point to another face. An exterior release commits the last valid sample.
The core's immutable `MeshCoordinateMap` validates the declared faces once and
serves synchronous forward/inverse queries without rerunning fitting.

Cubic envelope controls use a fixed local affine frame at each control's
nominal lattice coordinate, selected by declared face order. The displayed net
is an authoring frame: composition of the fit with a cubic is not itself a cubic.
This frame retains the full `[-2,3]` authoring bounds, supports inverse pointer
and keyboard movement, and reproduces the same control positions after reopen.
It neither extends the rendered fit domain nor bakes projected coordinates
into saved controls. Pin activation targets and brush samples use exact fit
lookup instead of these cubic frames.

The fitting map describes one connected outer domain. Its optional compound
mask retains holes and unions independently filled regions rather than choosing
one region or treating each contour as another fitting map. Regions outside the
authored domain remain outside the rendered surface. Choosing that domain from
a native multi-region guide uses the core's `shape_fit_domains` query. It offers
eligible original contours only when they enclose every complete contour edge,
then a convex envelope of the authored Bezier controls and the unit rectangle.
Each choice retains the complete original mask. `refresh_shape_fit` updates the
chosen domain and mask from current guide curves while preserving corner
positions and refinement; a disappeared or invalid choice fails before saving.
An older recipe can recover its choice by exact comparison with its old clip's
core-generated domains. A custom boundary needs an explicit new choice.

The Figma Composition entry exposes clipping and bending as distinct actions.
Bending enters Mesh with an editable four-corner correspondence and core-projected
preview markers. The fitted task retains both original source identities in
binding order, with carrier-only `shapeGuideSourceIndex` and `shapeGuideDomain`;
only the artwork source enters the rasterizer. A prepared draft preserves the
actual stored target family until Apply. Reopen, linked refresh and external-Agent
refresh read the current native guide, including resolved corner curves, and
replan through the same core. Output dimensions, plane and interior edits survive;
a same-selection guide refresh also retains unpublished interior edits. Invalid
guide geometry needs its ordinary closed-shape/domain selection repair route.

New library saves retain the full work and its
reopening view, including fitting, compound masks, Liquify and Mesh placements.
Library reuse applies that authored recipe to one new artwork; native guide
identity belongs to the live Figma task rather than the reusable core recipe.
When returning to a view, history is retained only if the complete work is
unchanged. An unchanged control projection alone cannot retain a stale Reset
baseline over new density, fitting or cross-view edits.

Planning projects the original mask through the core-solved homography using
the canonical vector engine. Affine curves remain exact; projective cubic
pieces subdivide within a 0.25 reference-pixel budget. The original mask uses
the existing Mockup input limits and validation; the generated mask is bounded
to 2,048 segments in total. `plan.clip` holds its projected contours in
normalized reference-canvas coordinates and its pixel bounds. The native
renderer translates those coordinates by the Tight canvas origin, applies the
shared compound mask before PNG encoding and digest calculation, then uses the
existing atomic writer. Straight color channels stay unchanged; covered alpha
multiplies the fitted surface alpha.

The Web renderer uses the same core mask plan, paints region union into a
bounded coverage texture and multiplies its premultiplied output by that
coverage. Mesh/Pin preview, Apply and linked/batch rendering carry `plan.clip`.
The Plane editor retains the original mask and reprojects it through the core
when its solved plane changes, including full-size export; it does not rerun
the fitter or solve geometry in the adapter. Mask absence, source selection,
state removal and context restoration preserve their ordinary behavior.

Errors use the existing stable classes: structural violations, bounds, fold,
and header mismatches are `E_SCHEMA`; rendering, cancellation, capacity, and
publication behavior are exactly the mesh renderer's. Nothing is silently
clamped, reordered, or approximated.

## Agent projection

MCP `deformation_plan` and `deformation_render` accept optional
`planView: "full" | "state"`; omission retains the full existing plan.
The state view returns a closed `worldbend.deformation-work-summary@0.1`:
the complete original work spec, canonical solve, execution vertex/face counts,
edit and stroke counts, and resolved fitting landmarks/refinement/iterations.
It omits generated editing meshes and the projected mask explicitly, keeping an ordinary Agent receipt
small even when a high-detail plan exceeds the MCP response bound. Replanning
that unchanged spec reproduces the full core plan. The renderer always executes
that full plan and verifies the same PNG digest before guarded publication,
regardless of the selected response view. CLI and WASM retain their full plan.
An oversized full MCP response fails before output publication; the state view
does not change geometry, lower the requested refinement or weaken that bound.

For a linked Figma HD revision, the saved `targetSize` remains the original
authoring reference. The renderer samples the complete planned canvas at the
separately requested raster dimensions, including the projected clip and holes.
Changing pixel density alone preserves the result's physical size and position.
When controls expand the canvas, core-derived previous/current origins and
references transport its frame through the result's own axes; a failed update
restores its complete transform together with pixels and stored work.

## Persistence and migration

The work is the durable container for deformation state. Migration is an
explicit, validated, loss-free operation over the two persisted predecessors:

- a regular-grid `worldbend.mesh-warp@0.1` document migrates to one work retaining
  its fixed/free boundary policy and every editable vertex whose warped position
  differs from the regular grid (including free edges and corners); identity interior vertices stay regular rather than becoming
  explicit edits. A mesh with interior warped positions outside `[-2,3]` fails
  migration with that typed bound instead of clamping.
  Indexed geometry does not silently become grid edits: its source positions
  and outline cannot identify the original contour, landmarks and pre-fit
  edits unambiguously. Migration rejects a raw indexed predecessor while
  leaving the original mesh document intact. New fitted works retain their
  recipe directly. Deformation-to-outline conversion is not part of this
  migration contract.
- a `worldbend.surface-deformation@0.1` document migrates to one work carrying
  its surface controls unchanged and no mesh edits.

Both migrations validate the source through its own contract, then verify the
migrated plan is equivalent to the source plan (mesh-identical for mesh-warp,
plan-identical for surface deformation) before returning the work and its
plan. Migration does not write files, contact a carrier, or mutate the source
document; call that replace the persisted state themselves. There is no
reverse migration: a work with mesh edits cannot be represented as surface
controls, and claiming so would be silent approximation.

## Carriers

Full CLI exposes `deformation-inspect`, `deformation-render`, and
`deformation-migrate`. The compact Agent catalog exposes `deformation_plan`,
`deformation_render`, and `deformation_migrate` through `worldbend.run` with
exact closed schemas; render keeps the workspace-root, private-worker,
dry-run, digest, cancellation, capacity, and atomic-publication rules. The
Web/WASM carrier exposes the plan and migration functions and generated
contract types in the default build. The size-bounded Figma WASM profile exposes
the planner and keeps migration in the full carrier. The current Figma
candidate stores one deformation task, upgrades legacy Mesh and Surface tasks
on their next publication, carries unpublished state across its Pin and Mesh
workspaces, and renders both from the shared plan. A Mesh-view density change
keeps the work's Liquify block live by re-planning its pre-edit baseline at
the new density through the planner, instead of baking the brush displacement
into explicit edits. Returning to the Plane
editor carries that same work: its plane loads as the continued editing basis,
the interior previews through the planner's final mesh, later plane edits
compose into the work without disturbing the normalized interior, and
publishing from the Plane editor emits the shared deformation task instead of
a plane-only result that would drop the interior. A preset Warp, which has no
slot in the work, refuses that composition with its reason instead of
silently dropping either side; a plane-only publication can no longer
overwrite a stored designer task. The reduced ComfyUI carrier does not include it.

### Free-outline authoring

Figma Mesh and Pin expose the same Boundary choice. Free outline reveals grid
edges/corners in Mesh and cubic outer controls in Pin; the mode and all controls
survive Plane/Pin/Mesh changes, Undo/Redo, linked publication, JSON reopen and
source replacement. Fixed remains the default for existing work. Changing back
to Fixed must validate the unchanged controls and reject a lossy reset; users
can Undo or Reset deliberately. Grid resampling retains free-edge positions
through the canonical mapping and validates before replacing the current draft.
The current editor bounds its free control gestures to the placement rectangle.
This is not an outward-warp canvas expansion or a PSD warp importer.

## Non-goals

The contract does not infer pins, strokes, or meshes from pixels or pointer
history; does not accept arbitrary triangulation or free-position pins; does
not simulate physics; and does not become an animation timeline. The brush-only
Liquify family is delivered as its own typed block inside this work
(`worldbend.liquify@0.1`, `docs/LIQUIFY_CONTRACT.md`); a free-placement
(puppet-family) model still needs its own typed addition to this work rather
than a second parallel container.
