# Field Notes — paper theatre

Original cover graphics and an editable paper/book scene produced with Blender's
public Python interface. The scene geometry and artwork are included under the
repository license.
The native source packs cover/back artwork and retains named cameras, material,
physical page edges and paper morph animation. A level 70 mm camera presents
the upright book, and `FrontCamera` gives an orthographic rectangle reference.

Prerequisites: Blender and Python/Pillow. The demonstrated environment used
Blender5.2.2 LTS and Pillow11.3.0. Author project-owned outputs on the project disk:

```sh
python3 examples/blender-paper-stage/artwork.py --output .worldbend-work/paper-print --revision 1
blender --background --factory-startup --python examples/blender-paper-stage/generate.py -- --output .worldbend-work/paper-scene --artwork .worldbend-work/paper-print --render
```

Use `--revision 2` to produce the second cover/camera edition and
`--direction editions` to explore the architectural arrangement. Inspect the
generated result before reuse. The native
render is a reference; the export explicitly selects COMPAT lighting, and the
production receipt declares color, lighting and shadow differences.

The reusable packed sources and immutable GLBs are in the
[receiving example](../../packages/scene-three/examples/paper-stage/README.md).
A later Blender export is a source-asset revision. A receiving cover change is
an explicit document override; downloading the original Blender source does not
silently bake that override into it.
