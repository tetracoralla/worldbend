"""Prepare the packed example scene for portable distribution."""
from pathlib import PurePosixPath


def _relative_image_path(value):
    name = PurePosixPath(value.replace('\\', '/')).name
    if not name:
        raise ValueError('Packed image needs a filename')
    return '//' + name


def prepare_portable_source(bpy):
    for image in bpy.data.images:
        if image.source != 'FILE':
            continue
        if not image.packed_files:
            image.pack()
        path = _relative_image_path(image.filepath_raw)
        # These FILE_MAX buffers can retain old bytes after the terminating
        # NUL. Overwrite the whole buffer before assigning the portable path.
        # filepath_raw changes metadata without reloading the packed pixels.
        image.filepath_raw = ' ' * 1023
        image.filepath_raw = path
        for packed in image.packed_files:
            path = _relative_image_path(packed.filepath)
            packed.filepath = ' ' * 1023
            packed.filepath = path
    for scene in bpy.data.scenes:
        scene.render.filepath = ' ' * 1023
        scene.render.filepath = '//render/'
    # Saved editor state may contain the last file-browser directory too.
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == 'FILE_BROWSER' and space.params:
                    space.params.directory = b' ' * 1023
                    space.params.directory = b'//'
