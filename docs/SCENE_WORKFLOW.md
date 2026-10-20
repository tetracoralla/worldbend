# Reuse a design in a scene

Use Composition to place a design on a flat, curved or folded surface in a scene.
The scene remains visible while you position the artwork. The result is an
image with a saved operation and source bindings; edit the original design to
change its text or artwork, then reopen the result to refresh and apply it.

## Deliver a complete scene animation

Enable **Animate** in Composition, adjust layer or combined-result poses and
choose a poster. Inside a native scene, **Create complete scene animation**
creates a separate animated scene, retaining its background, shadows, masks,
foreground and editable source copies. **Save video** downloads the native MP4.
The scene remains available in Figma if encoding fails; it can be exported
through native Motion. Cancel removes an unfinished copy and releases editing.
Cancellation also retires source decoding that finishes later, so a new attempt
can start immediately. Regeneration refuses edited generated frame gates or
cached image geometry, appearance and timing. Keep that delivery and start from
its editable source scene when you need to preserve those native frame edits.

Select the completed animation Frame to reopen the saved programme. Change
text or artwork in its adjacent copied sources, reopen, revise the timing and
create another delivery. The previous delivery stays independent. Native
scene objects remain native; Worldbend image frames carry the core's projective
animation. A whole-result pose changes the linked image within its scene, so
native objects outside that result do not automatically follow its perspective.
This is a complete scene video route, with further shared scene and camera
semantics still under development. Native Motion access is required for video;
static Composition continues to work without that beta API.

## Ready scenes and your own scene

Select one artwork layer and open **Templates**. The Studio poster, Desktop
screen, Carton label, Studio can and Hanging fabric entries create editable native Figma scenes. The can wraps artwork around a cylindrical surface;
the fabric gives it three authored folds. Native gradients, metal rims,
hanging rails, loops, shadows and foreground stay editable in Figma. Choose
**Fill surface** to crop uniformly to the artwork slot or **Fit whole artwork**
to retain its complete aspect ratio. The ready thumbnails show the selected
artwork with that fitting and canonical surface before **Use template**. Composition
previews the complete scene, including its native background, shadows and
foreground. Apply publishes the linked artwork image inside that scene. Text
and layout in the adjacent source Frame remain editable; reopen the linked
result after changing them and apply again.

Studio can includes an editable studio backdrop, surface-shadow layer and
softbox reflection, hollow lid groove and a soft floor contact shadow.
The shadows use Multiply and the reflection uses Screen
with transparent gradient stops, so their light also affects replacement
artwork. Their native opacity, paints and visibility remain adjustable in
Figma and travel with saved or copied scenes. The ready thumbnail renders
these layers around the same canonical artwork projection.

Hanging fabric includes a soft wall contact shadow under the cloth, a rail
cast Multiply shade across the upper fabric, and the existing rail, cords
and loops. The cast shade uses transparent gradient stops so it darkens
replacement artwork near the hanging edge without changing mid-cloth
pixels. Contact and cast layers stay editable native decoration and travel
with saved or copied scenes; the ready thumbnail renders them with the
same canonical fabric projection.

Studio poster includes a soft wall contact shadow under the sheet and a
clip cast Multiply shade across the upper poster. The cast paints under the
hanging clip so shade darkens replacement artwork without darkening the
clip hardware. Carton label includes a soft floor contact shadow under the
box and a top-flap cast Multiply shade across the upper label; the cast uses
transparent gradient stops so mid-label pixels stay unchanged. Desktop screen
includes a soft desk contact shadow under the stand and a bezel cast Multiply
shade across the upper screen; the stand stays behind the projected artwork so
its neck sits under the opaque screen while still occluding the desk contact
under the base. These contact and cast layers stay editable native decoration
and travel with saved or copied scenes; ready thumbnails render them with the
same canonical projection.

After publishing, Figma Undo restores the saved task, pixels and editing
controls together. A restored scene with unchanged source pixels uses its
native saved preview without creating temporary layers, preserving Figma's
Redo. Further edits still composite a fresh full-scene draft. Draft history
shortcuts belong to the plugin; use Figma's canvas focus for document Redo.

For your own scene, put the linked Composition result inside a native Frame
with the desired background, shapes, masks and foreground. **Save scene** saves
a separate native master with copied source layers and the current preview's
task and pixels, including edits not yet applied to the original. Name it once;
select new artwork and use that named entry in Templates. Source slots follow
their saved order. Artwork slots always clip Cover/Contain replacement so a
different-aspect design cannot paint over native decoration outside the slot.
Wrapping a non-Frame artwork slot retains its native sibling paint order, so
foreground masks, ribbons and lighting stay above the artwork after save/reuse.
The original artwork and master remain independent of each
use. Native scene decoration stays in Figma; Worldbend retains the projective
placement, source relationships and continuation records. Removing a saved
entry preserves its completed scene on the canvas.

If the artwork contains Worldbend linked results, the scene also copies their
transitive original layers into **Linked sources · edit these originals**.
Their bindings stay inside the new scene: edit those copies and use Results to
refresh the nested results before the scene projection. Shared originals are
copied once per artwork graph. Replacing artwork removes unused plugin-owned
dependency copies while preserving native decoration and any old artwork
children that other scene layers still consume. Current nested drafts
remain pending on their copy's revision; stale drafts remain unavailable and
are not applied by copying. A missing or damaged
binding, a dependency cycle, or an edit during preparation stops the copy
before creating a scene. Copy preparation is bounded to 20,000 nodes, 64
dependency levels and 16 MiB of captured native state, including replacements
and native slot content that will be discarded after cloning.

**Save template** keeps only the canonical operation and its source-slot
descriptors. **Save scene** also keeps the surrounding native artwork. Export
the scene's preview Frame through Figma for a complete still. Choose **Apply and
size complete scene** to apply the current adjustment and open **Sizes** over
that Frame, including its native background, effects and foreground. Add and
name requested dimensions, choose Contain or Cover, inspect each view and apply
the variants. Each result keeps its size operation and a binding to the complete
scene. Reopen a size result to revise it; after editing source artwork, select
its source and use **Results → Update all results** to refresh the linked
projection before its dependent size results. The native scene stays editable.

New Composition publications retain a bounded source-state proof shared by the
human and Agent entries. Reopening an unchanged published scene reads its
existing native preview without temporary canvas writes, preserving host Redo.
Source or task edits require a fresh composite. Scenes saved by earlier versions
acquire this proof on their next update; their initial preview can still use
temporary native capture.

Composition's own whole-result transform and named outputs continue to operate
on the linked projection.

The bundled scenes are original first-party native constructions covered
by this repository's Apache-2.0 license. Artwork you place in them retains its
own rights. Saved native masters live in their Figma file; the named library
is local to the plugin's client storage. An unavailable file or deleted master
must be recovered before that entry can be reused.

An Agent with access to this Figma file can discover the marked native masters
through `figma_templates_inspect`, even when its connector cannot read the
plugin's local library. Discovery includes current slot dimensions and the
master result reference; the scan report identifies incomplete or unavailable
content. Its `readyScenes` entries also describe the bundled first-party
scenes. To create an instance, run `figma_scene_create` with the granted file
link, page and ordered artwork nodes. Choose a ready scene ID or pass a fresh
`figma_mockup_inspect` snapshot of a native master. Cover or Contain fitting
uses the same native artwork replacement as Templates; the new scene has its
own copied sources and leaves the master and supplied artwork intact.

The returned scene is `needs-publication` until its snapshot sources have been
exported, core-rendered and published through the ordinary Composition route
below. Re-executing the same prepared creation request recovers that instance
and its current snapshot. An optional stable `requestId` also supports
re-preparation in a fresh Agent session; changing its inputs requires a new
identity. A reused published instance reports `published`. Native scene copies
receive separate identities. A deleted instance can be created again with the
same request; a surviving damaged instance must be recovered before retrying.
Moving the instance into another native container on the same page retains its
creation identity; recovery scans at most 20,000 nodes and 64 nesting levels.

## In Figma

1. Select the artwork and the scene as separate layers, then open Worldbend.
2. Open **More → Composition**. Select the scene by its name and thumbnail,
   then choose **Use as backdrop**. This sizes the canvas to the scene, moves
   it behind the other sources and centers the artwork without changing its
   aspect ratio. Large scenes are fitted within Figma's 4096 px axis limit.
3. Select the artwork. Move its four handles onto the intended surface.
   Arrow keys move a focused handle; Shift increases the step. Undo and redo
   work on the layout and subsequent edits.
4. Save a named template to reuse just the placement, or apply the image. For
   reuse with native decoration and copied sources, use **Save scene** above.
5. To reuse the template, select the same number of new source layers and open
   **Templates**. Check the source names and preview before applying: source
   slots are positional bindings, not automatic recognition of a scene.

Use **Use as backdrop** when starting a layout: it resets placement of the
other planes and removes seam constraints. Undo restores the previous layout.
It does not infer a surface, lighting, occlusion or shadows from the scene.
When the second selection is a simple straight four-corner Vector, use **Fit
artwork to quad** to map the artwork directly to that geometry. The Vector stays
bound for reopen and later refitting but starts hidden from the rendered result;
its stroke or fill is a guide, not part of the artwork.
Use **Warp** under **Individual layers** to bend the selected artwork inside
its placed boundary. **Whole result** has its own Warp, so the two edits can be
continued independently. Choose **None** to remove the selected layer's bend.
These presets keep the boundary fixed. Curved outlines or a physically curved
surface use **Surface → Cylinder** or **Fabric**. Cylinder controls wrap and
tilt; Fabric controls fold count, depth and phase. Expand **Lighting** to adjust
shading and its left/right direction. The surface changes the outline as well
as the artwork, and its optional grid follows that physical surface. Layer Warp
can still reshape the artwork before it is placed on the surface; it does not
move the physical grid. Choose **Flat** to remove the surface, or set its amount
to zero to keep the original flat rendering. Surface controls are retained by
Save template, Save scene, linked updates and Agent continuation.

These are authored surface models. Matching a can, cloth or other object still
requires appropriate placement and scene artwork; the plugin does not recover
the object's geometry or light from a photograph. The bounded Mesh and Split
Warp workspaces offer additional interior control.

## Continue in the same Figma file with an Agent

Give the Agent the published Composition result's Figma design link, including
its `node-id`. With Figma access, the Agent runs `figma_mockup_inspect` through
`worldbend.run` with `includeSourceRasters: true` and
`sourceRasterTransport: "artifact"`, executes its returned
`use_figma` request and receives ordered source rasters, current bindings and
the result snapshot. The Agent changes the shared MockupSpec and runs
`figma_mockup_publish` with that snapshot, task and sources. The shared core
renders the selected whole-result output; executing the returned guarded Figma
request updates its pixels and revision in place. Larger images return a
transfer plan: run each `figma_publication_step` request in order, including
the final guarded publication, then release its session cache. Staging preserves
the old artwork and supports resume or cancellation. A prepared request alone
is not publication. The Agent needs access to the image artifact bytes, and
transport/resource limits still apply; see [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md).

When designer review is requested, use `figma_mockup_stage` with the snapshot
and changed task instead. Its host request stages geometry without changing
the published image. Select the result and open Worldbend to preview and Apply
using the current Figma source layers. In either route, a stale result or
changed source geometry requires reinspection. The designer does not need to
copy parameters or export images for this same-file continuation.

## Continue outside Figma through an Agent or CLI

Use this route when producing a separate image outside Figma. It needs copied
parameters and separately available source rasters; the file-native route
above uses the Figma result and its linked source nodes instead.

**Copy placement parameters** copies the shared mockup program. The Agent can
inspect this program, revise explicit corners and supply different source
rasters without repeating a sequence of pointer actions. `source-1` and
`source-2` identify the source slots; the order of `planes` controls painting.
Moving a backdrop first must not renumber its source ID.

Save the mockup spec as `scene.json`, then validate it before rendering:

```sh
worldbend mockup-inspect --spec scene.json
worldbend mockup-render --spec scene.json \
  --source source-1=artwork.png --source source-2=scene.png \
  --output result.png --quality high --dry-run
worldbend mockup-render --spec scene.json \
  --source source-1=artwork.png --source source-2=scene.png \
  --output result.png --quality high
```

Supply every source ID used by the program exactly once. The MCP equivalents
are `mockup_plan` and `mockup_render`, discovered through the plugin's compact
tool interface. MCP paths are relative to the explicitly granted workspace.
Existing outputs require explicit overwrite authority. A Figma node ID is not
a local raster path: export authorized source artwork before native rendering.

The Agent may choose coordinates from the user's visual brief. Geometry
execution remains explicit and deterministic; the engine does not silently
recognize or repair the intended surface. Inspect the composed result before
reusing a placement across artwork with different content or aspect ratios.
