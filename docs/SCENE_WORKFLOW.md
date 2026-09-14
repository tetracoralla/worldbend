# Reuse a design in a scene

Use Composition for a poster, screen or other flat design placed over a scene.
The scene remains visible while you position the artwork. The result is an
image with a saved operation and source bindings; edit the original design to
change its text or artwork, then reopen the result to refresh and apply it.

## In Figma

1. Select the artwork and the scene as separate layers, then open Worldbend.
2. Open **More → Composition**. Select the scene by its name and thumbnail,
   then choose **Use as backdrop**. This sizes the canvas to the scene, moves
   it behind the other sources and centers the artwork without changing its
   aspect ratio. Large scenes are fitted within Figma's 4096 px axis limit.
3. Select the artwork. Move its four handles onto the intended surface.
   Arrow keys move a focused handle; Shift increases the step. Undo and redo
   work on the layout and subsequent edits.
4. Save a named template to reuse the placement, or apply the image. Templates
   show the geometry rather than storing a copy of your artwork.
5. To reuse the template, select the same number of new source layers and open
   **Templates**. Check the source names and preview before applying: source
   slots are positional bindings, not automatic recognition of a scene.

Use **Use as backdrop** when starting a layout: it resets placement of the
other planes and removes seam constraints. Undo restores the previous layout.
It does not infer a surface, lighting, occlusion or shadows from the scene.
For curved artwork, use the visual Warp picker or the bounded Mesh and Split
Warp workspaces instead of representing a curve with four corners.

## Continue through an Agent or CLI

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
