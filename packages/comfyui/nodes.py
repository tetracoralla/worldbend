"""ComfyUI V3 node declarations for Worldbend."""

from __future__ import annotations

from typing_extensions import override

from comfy_api.v0_0_2 import ComfyExtension, io

from ._adapter import (
    WorldbendCanvasPlan,
    WorldbendCanvasSet,
    WorldbendRectification,
    WorldbendRemap,
    WorldbendTransform,
    apply_canvas_plan,
    apply_canvas_set,
    apply_rectification,
    apply_remap,
    apply_transform,
    create_canvas_set,
    create_rectification,
    create_remap,
    create_transform,
)


WorldbendTransformType = io.Custom("WORLDBEND_TRANSFORM")
WorldbendRectificationType = io.Custom("WORLDBEND_RECTIFICATION")
WorldbendCanvasSetType = io.Custom("WORLDBEND_CANVAS_SET")
WorldbendCanvasPlanType = io.Custom("WORLDBEND_CANVAS_PLAN")
WorldbendRemapType = io.Custom("WORLDBEND_REMAP")

_IDENTITY_SPEC = """{
  "schema": "worldbend.transform",
  "version": "0.1",
  "destination": {
    "space": "normalized",
    "quad": {
      "tl": { "x": 0, "y": 0 },
      "tr": { "x": 1, "y": 0 },
      "br": { "x": 1, "y": 1 },
      "bl": { "x": 0, "y": 1 }
    }
  },
  "content": { "fit": "stretch" }
}"""

_IDENTITY_RECTIFICATION = """{
  "schema": "worldbend.rectify",
  "version": "0.1",
  "source": {
    "space": "normalized",
    "quad": {
      "tl": { "x": 0, "y": 0 },
      "tr": { "x": 1, "y": 0 },
      "br": { "x": 1, "y": 1 },
      "bl": { "x": 0, "y": 1 }
    }
  },
  "output": { "width": 1024, "height": 1024 }
}"""

_DEFAULT_CANVAS_SET = """{
  "schema": "worldbend.canvas-set",
  "version": "0.1",
  "variants": [
    {
      "id": "square",
      "operation": {
        "kind": "contain",
        "output": { "width": 1024, "height": 1024 },
        "anchor": { "x": 0.5, "y": 0.5 },
        "background": { "kind": "transparent" }
      }
    },
    {
      "id": "portrait",
      "operation": {
        "kind": "cover",
        "output": { "width": 768, "height": 1024 },
        "anchor": { "x": 0.5, "y": 0.5 },
        "background": { "kind": "transparent" }
      }
    }
  ]
}"""

_DEFAULT_CONTROL_OUTSIDE_FILL = (
    '{ "kind": "color", "space": "srgb8", "rgba": [0, 0, 0, 255] }'
)

_IDENTITY_REMAP = """{
  "schema": "worldbend.remap",
  "version": "0.1",
  "output": { "width": 1024, "height": 1024 },
  "operation": {
    "kind": "lens",
    "coefficients": { "k1": 0, "k2": 0, "k3": 0, "p1": 0, "p2": 0 },
    "center": { "x": 0.5, "y": 0.5 },
    "scale": { "x": 0.5, "y": 0.5 }
  }
}"""


class WorldbendTransformSpecNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_TransformSpec",
            display_name="Worldbend Transform Spec",
            category="image/transform/Worldbend",
            description=(
                "Validates one reusable Worldbend TransformSpec. Zero target dimensions "
                "bind normalized specs to the incoming IMAGE size."
            ),
            search_aliases=["perspective", "homography", "free transform", "warp"],
            is_experimental=True,
            inputs=[
                io.String.Input(
                    "spec_json",
                    display_name="TransformSpec JSON",
                    default=_IDENTITY_SPEC,
                    multiline=True,
                    dynamic_prompts=False,
                ),
                io.Int.Input(
                    "target_width",
                    display_name="Target width (0 = IMAGE)",
                    default=0,
                    min=0,
                    max=8192,
                    step=1,
                    advanced=True,
                ),
                io.Int.Input(
                    "target_height",
                    display_name="Target height (0 = IMAGE)",
                    default=0,
                    min=0,
                    max=8192,
                    step=1,
                    advanced=True,
                ),
            ],
            outputs=[
                WorldbendTransformType.Output(
                    "transform",
                    display_name="TRANSFORM",
                )
            ],
        )

    @classmethod
    def execute(
        cls,
        spec_json: str,
        target_width: int,
        target_height: int,
    ) -> io.NodeOutput:
        transform = create_transform(spec_json, target_width, target_height)
        return io.NodeOutput(transform)


class WorldbendApplyTransformNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_ApplyTransform",
            display_name="Apply Worldbend Transform",
            category="image/transform/Worldbend",
            description=(
                "Applies one validated TransformSpec to one IMAGE and optional MASK "
                "through the bundled deterministic Worldbend renderer."
            ),
            search_aliases=["perspective", "homography", "distort", "warp"],
            is_experimental=True,
            inputs=[
                io.Image.Input("image"),
                WorldbendTransformType.Input("transform"),
                io.Combo.Input(
                    "quality",
                    options=["preview", "standard", "high"],
                    default="standard",
                    advanced=True,
                ),
                io.Combo.Input(
                    "canvas",
                    options=["tight", "reference"],
                    default="tight",
                    advanced=True,
                ),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="IMAGE"),
                io.Mask.Output("mask", display_name="MASK"),
                WorldbendTransformType.Output("transform", display_name="TRANSFORM"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        transform: WorldbendTransform,
        quality: str,
        canvas: str,
        mask=None,
    ) -> io.NodeOutput:
        output_image, output_mask, retained_transform = apply_transform(
            image,
            transform,
            quality=quality,
            canvas=canvas,
            mask=mask,
        )
        return io.NodeOutput(output_image, output_mask, retained_transform)


class WorldbendRectificationSpecNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_RectificationSpec",
            display_name="Worldbend Rectification Spec",
            category="image/transform/Worldbend",
            description=(
                "Validates one explicit source quadrilateral and output size. "
                "It does not detect planes or infer dimensions."
            ),
            search_aliases=["perspective correction", "document flatten", "plane rectify"],
            is_experimental=True,
            inputs=[
                io.String.Input(
                    "spec_json",
                    display_name="RectifySpec JSON",
                    default=_IDENTITY_RECTIFICATION,
                    multiline=True,
                    dynamic_prompts=False,
                ),
            ],
            outputs=[
                WorldbendRectificationType.Output(
                    "rectification",
                    display_name="RECTIFICATION",
                )
            ],
        )

    @classmethod
    def execute(cls, spec_json: str) -> io.NodeOutput:
        return io.NodeOutput(create_rectification(spec_json))


class WorldbendApplyRectificationNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_ApplyRectification",
            display_name="Apply Worldbend Rectification",
            category="image/transform/Worldbend",
            description=(
                "Maps the explicitly supplied source quadrilateral to its declared "
                "output rectangle through the bundled deterministic renderer."
            ),
            search_aliases=["perspective correction", "document flatten", "plane rectify"],
            is_experimental=True,
            inputs=[
                io.Image.Input("image"),
                WorldbendRectificationType.Input("rectification"),
                io.Combo.Input(
                    "quality",
                    options=["preview", "standard", "high"],
                    default="standard",
                    advanced=True,
                ),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="IMAGE"),
                io.Mask.Output("mask", display_name="MASK"),
                WorldbendRectificationType.Output(
                    "rectification",
                    display_name="RECTIFICATION",
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        rectification: WorldbendRectification,
        quality: str,
        mask=None,
    ) -> io.NodeOutput:
        output_image, output_mask, retained = apply_rectification(
            image,
            rectification,
            quality=quality,
            mask=mask,
        )
        return io.NodeOutput(output_image, output_mask, retained)


class WorldbendCanvasSetSpecNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_CanvasSetSpec",
            display_name="Worldbend Canvas Set Spec",
            category="image/transform/Worldbend",
            description=(
                "Stores one ordered Canvas Set program. Source-dependent Crop and Trim "
                "validation occurs when the set is applied."
            ),
            search_aliases=["resize", "crop", "trim", "contain", "cover", "multi output"],
            is_experimental=True,
            inputs=[
                io.String.Input(
                    "spec_json",
                    display_name="CanvasSetSpec JSON",
                    default=_DEFAULT_CANVAS_SET,
                    multiline=True,
                    dynamic_prompts=False,
                ),
            ],
            outputs=[
                WorldbendCanvasSetType.Output(
                    "canvas_set",
                    display_name="CANVAS SET",
                )
            ],
        )

    @classmethod
    def execute(cls, spec_json: str) -> io.NodeOutput:
        return io.NodeOutput(create_canvas_set(spec_json))


class WorldbendApplyCanvasSetNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_ApplyCanvasSet",
            display_name="Apply Worldbend Canvas Set",
            category="image/transform/Worldbend",
            description=(
                "Applies every ordered variant to the same B=1 IMAGE in one native "
                "operation and returns heterogeneous IMAGE/MASK lists plus its resolved plan."
            ),
            search_aliases=["resize", "crop", "trim", "contain", "cover", "multi output"],
            is_experimental=True,
            inputs=[
                io.Image.Input("image"),
                WorldbendCanvasSetType.Input("canvas_set"),
                io.Combo.Input(
                    "quality",
                    options=["preview", "standard", "high"],
                    default="standard",
                    advanced=True,
                ),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("images", display_name="IMAGES", is_output_list=True),
                io.Mask.Output("masks", display_name="MASKS", is_output_list=True),
                WorldbendCanvasPlanType.Output("plan", display_name="CANVAS PLAN"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        canvas_set: WorldbendCanvasSet,
        quality: str,
        mask=None,
    ) -> io.NodeOutput:
        images, masks, plan = apply_canvas_set(
            image,
            canvas_set,
            quality=quality,
            mask=mask,
        )
        return io.NodeOutput(images, masks, plan)


class WorldbendApplyCanvasPlanNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_ApplyCanvasPlan",
            display_name="Apply Worldbend Canvas Plan",
            category="image/transform/Worldbend",
            description=(
                "Replays a resolved Canvas Plan on one compatible 8-bit control raster. "
                "It requires the recorded source shape and never re-runs Trim."
            ),
            search_aliases=["control map", "mask sync", "canny", "pose", "segmentation"],
            is_experimental=True,
            inputs=[
                io.Image.Input("image", display_name="8-bit control IMAGE"),
                WorldbendCanvasPlanType.Input("plan"),
                io.Combo.Input(
                    "sampling",
                    options=["nearest", "linear"],
                    default="nearest",
                ),
                io.String.Input(
                    "outside_fill_json",
                    display_name="Outside fill JSON",
                    default=_DEFAULT_CONTROL_OUTSIDE_FILL,
                    multiline=False,
                    dynamic_prompts=False,
                    advanced=True,
                ),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("images", display_name="IMAGES", is_output_list=True),
                io.Mask.Output("masks", display_name="MASKS", is_output_list=True),
                WorldbendCanvasPlanType.Output("plan", display_name="CANVAS PLAN"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        plan: WorldbendCanvasPlan,
        sampling: str,
        outside_fill_json: str,
        mask=None,
    ) -> io.NodeOutput:
        images, masks, retained = apply_canvas_plan(
            image,
            plan,
            sampling=sampling,
            outside_fill_json=outside_fill_json,
            mask=mask,
        )
        return io.NodeOutput(images, masks, retained)


class WorldbendRemapSpecNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_RemapSpec",
            display_name="Worldbend Remap Spec",
            category="image/transform/Worldbend",
            description=(
                "Validates one explicit lens model or channel-driven displacement map. "
                "It does not estimate a lens, depth, flow, or subject geometry."
            ),
            search_aliases=["lens distortion", "displacement map", "barrel", "pincushion"],
            is_experimental=True,
            inputs=[
                io.String.Input(
                    "spec_json",
                    display_name="RemapSpec JSON",
                    default=_IDENTITY_REMAP,
                    multiline=True,
                    dynamic_prompts=False,
                ),
            ],
            outputs=[WorldbendRemapType.Output("remap", display_name="REMAP")],
        )

    @classmethod
    def execute(cls, spec_json: str) -> io.NodeOutput:
        return io.NodeOutput(create_remap(spec_json))


class WorldbendApplyRemapNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="Worldbend_ApplyRemap",
            display_name="Apply Worldbend Remap",
            category="image/transform/Worldbend",
            description=(
                "Applies an explicit lens remap or displacement IMAGE to one IMAGE and MASK. "
                "Map presence is exact and the same REMAP can synchronize other control images."
            ),
            search_aliases=["lens distortion", "displacement map", "depth warp", "control map"],
            is_experimental=True,
            inputs=[
                io.Image.Input("image"),
                WorldbendRemapType.Input("remap"),
                io.Combo.Input(
                    "quality",
                    options=["preview", "standard", "high"],
                    default="standard",
                    advanced=True,
                ),
                io.Mask.Input("mask", optional=True),
                io.Image.Input(
                    "displacement_map",
                    display_name="Displacement map IMAGE",
                    optional=True,
                ),
                io.Mask.Input(
                    "displacement_map_mask",
                    display_name="Displacement map alpha MASK",
                    optional=True,
                    advanced=True,
                ),
            ],
            outputs=[
                io.Image.Output("image", display_name="IMAGE"),
                io.Mask.Output("mask", display_name="MASK"),
                WorldbendRemapType.Output("remap", display_name="REMAP"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        remap: WorldbendRemap,
        quality: str,
        mask=None,
        displacement_map=None,
        displacement_map_mask=None,
    ) -> io.NodeOutput:
        output_image, output_mask, retained = apply_remap(
            image,
            remap,
            quality=quality,
            mask=mask,
            displacement_map=displacement_map,
            displacement_map_mask=displacement_map_mask,
        )
        return io.NodeOutput(output_image, output_mask, retained)


class WorldbendExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            WorldbendTransformSpecNode,
            WorldbendApplyTransformNode,
            WorldbendRectificationSpecNode,
            WorldbendApplyRectificationNode,
            WorldbendCanvasSetSpecNode,
            WorldbendApplyCanvasSetNode,
            WorldbendApplyCanvasPlanNode,
            WorldbendRemapSpecNode,
            WorldbendApplyRemapNode,
        ]


async def comfy_entrypoint() -> WorldbendExtension:
    return WorldbendExtension()
