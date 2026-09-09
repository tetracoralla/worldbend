# Plane pose and live perspective

The `pose` operation takes `{elementSize, pose}` and returns `{spec, css}`.
It is an explicit single-plane authoring convenience over TransformSpec, not
camera estimation, a scene graph, or a second rendering model. A human, Agent,
or upstream program may author its values. No file or workspace grant is needed.

`elementSize` is the untransformed border box in CSS pixels. `pose.perspective`
is a finite distance of at least 1 CSS pixel. Optional `rotateX`, `rotateY`, and
`rotateZ` are CSS-sign degrees in [-360,360], default zero. `depth` is a CSS-pixel
translation toward the viewer, default zero. `translate` is an x/y CSS-pixel
translation, default (0,0). `pivot` and `perspectiveOrigin` are independent
unit-box coordinates in [0,1], both default (0.5,0.5).

The plane starts at (0,0)..(width,height), with z=0. Subtract the pivot, rotate
X then Y then Z, restore the pivot, then translate x/y and depth. Project about
perspectiveOrigin with w=1-z/perspective. This is the CSS transform-list order
translate3d -> rotateZ -> rotateY -> rotateX, surrounded by the corresponding
origin translations. Parent perspective and ancestor transforms are not read
or inferred. The output describes the element's local containing coordinates;
ordinary layout owns placement of the element among other elements.

Preserve TL/TR/BR/BL throughout. A non-finite value is E_NON_FINITE_COORDINATE;
invalid dimensions, ranges or unknown fields are E_SCHEMA. Any corner at or
behind the projection plane (w <= 1e-9) is E_HOMOGRAPHY_HORIZON_CROSSING. The
ordinary core solver rejects edge-on, back-facing, short-edge, concave and
degenerate results with existing geometry codes. Nothing is silently clamped,
reordered or flipped. The returned pixel-space TransformSpec uses elementSize
as its reference; projected corners may extend beyond it. Reuse that spec with
existing inspect, compose, render and CSS operations. A tight output is still
an explicit canvas choice. Single-plane screen position is preserved, not
depth interactions with independently transformed descendants.

The operation is in full CLI, compact MCP and Web/WASM. It is absent from the
eight frozen direct MCP tools, no-CSS Figma WASM, reduced Comfy CLI and portable
Capability projection. The core is the only projection implementation.

Web bindings measure untransformed border boxes, coalesce updates, discard
stale async results and keep the last valid transform after invalid input.
Updating means replacing the complete mapping/pose, not merging hidden state.
Disposal removes observers/listeners, prevents late writes and restores the
owned inline transform declarations. Dynamic pointer work stays in-browser.
Native CSS interpolation is not a promise of Worldbend Motion timing or
intermediate-quad validation. Changes to descendants, focus and media playback
remain the browser's responsibility.

## Shared plane strip

`plane_strip` accepts `{spec, destinationSize?, panels}`. The parent spec is
one front-facing plane, with native source orientation and no nonzero Warp.
Normalized destinations require a concrete destinationSize. Each of 1..32
panels supplies a unique ASCII id (1..64 letters/digits/underscore/hyphen),
`start`, `end` and `elementSize`. Intervals are fractions of the parent source
width, in ascending nonoverlapping order within [0,1], with start < end.
Gaps are intentional source-space gaps, not fixed screen-pixel gaps. A panel
maps its entire independent content into its selected region of the plane.

The core solves the parent homography once and projects every interval through
it. All top edges are collinear; all bottom edges are collinear. Perspective
can change the projected widths/heights: equal source intervals do not promise
equal screen dimensions. This differs from assigning a separate size tier or
camera to each card. Outputs preserve order and correlation IDs and include
one existing TransformSpec plus CSS per panel. Any invalid panel fails the
complete plan; there are no file publications, partial results or generic
batch jobs. The operation is in full CLI, compact MCP and focused Web/WASM.

`attachPerspectiveStrip` applies that plan to 1..32 distinct live HTML elements
in one positioned container. Each element starts at the container's (0,0),
with CSS-owned untransformed dimensions. The container defines destinationSize.
All member styles are applied in the same frame after complete validation.
Observing size, last-valid recovery, latest-update coalescing and disposal are
the same as the single-plane binding. Rebinding any member disposes its old
group, including all observers; groups cannot simultaneously own one element.
Styles outside transform/transform-origin and descendant content are untouched.
Bindings require visible nonzero layout sizes to publish; a hidden element
keeps its last mapping and catches up when ResizeObserver reports a real size.

Panel membership, IDs, order and source intervals are fixed for a binding.
`update(spec)` replaces only the complete plane. Changing media/content inside
the same bound nodes needs no rebind; changing their CSS sizes is observed.
For a different panel list or intervals, dispose the previous binding and
create a new one after the new nodes have mounted. This also handles completely
disjoint replacements, which cannot trigger shared-element ownership cleanup.
Rebinding waits for measured sizes before publishing; it does not promise an
atomic membership transition or a continuity animation. There is no
`update({panels})` overload. See the live-web guide for this lifecycle.

The focused `@worldbend/web/perspective` entry includes only the CSS planner
WASM, bindings and types. It makes no MCP calls during interaction. Hosts must
permit WebAssembly; the ordinary one-shot MCP `css`/`pose`/`plane_strip` result
can instead be pasted into a static web page with no Worldbend runtime download.
Pointer input uses an untransformed wrapper, explicit bounded angle ranges,
fine-pointer detection and reduced-motion preference. It resets on leave,
cancel, focus loss or visibility change and never estimates a camera.
