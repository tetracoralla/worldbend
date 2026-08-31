from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

import torch


MODULE_PATH = Path(__file__).resolve().parents[1] / "_adapter.py"
SPEC = importlib.util.spec_from_file_location("worldbend_comfy_adapter", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
adapter = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = adapter
SPEC.loader.exec_module(adapter)


IDENTITY_SPEC = json.dumps(
    {
        "schema": "worldbend.transform",
        "version": "0.1",
        "destination": {
            "space": "normalized",
            "quad": {
                "tl": {"x": 0, "y": 0},
                "tr": {"x": 1, "y": 0},
                "br": {"x": 1, "y": 1},
                "bl": {"x": 0, "y": 1},
            },
        },
        "content": {"fit": "stretch"},
    }
)

IDENTITY_RECTIFICATION = json.dumps(
    {
        "schema": "worldbend.rectify",
        "version": "0.1",
        "source": {
            "space": "normalized",
            "quad": {
                "tl": {"x": 0, "y": 0},
                "tr": {"x": 1, "y": 0},
                "br": {"x": 1, "y": 1},
                "bl": {"x": 0, "y": 1},
            },
        },
        "output": {"width": 2, "height": 2},
    }
)

CANVAS_SET = json.dumps(
    {
        "schema": "worldbend.canvas-set",
        "version": "0.1",
        "variants": [
            {
                "id": "small",
                "operation": {
                    "kind": "stretch",
                    "output": {"width": 2, "height": 1},
                },
            },
            {
                "id": "square",
                "operation": {
                    "kind": "contain",
                    "output": {"width": 3, "height": 3},
                    "anchor": {"x": 0.5, "y": 0.5},
                    "background": {"kind": "transparent"},
                },
            },
        ],
    }
)

IDENTITY_REMAP = json.dumps(
    {
        "schema": "worldbend.remap",
        "version": "0.1",
        "output": {"width": 2, "height": 2},
        "operation": {
            "kind": "lens",
            "coefficients": {"k1": 0, "k2": 0, "k3": 0, "p1": 0, "p2": 0},
            "center": {"x": 0.5, "y": 0.5},
            "scale": {"x": 0.5, "y": 0.5},
        },
    }
)

DISPLACEMENT_REMAP = json.dumps(
    {
        "schema": "worldbend.remap",
        "version": "0.1",
        "output": {"width": 2, "height": 2},
        "operation": {
            "kind": "displacement",
            "xChannel": "red",
            "yChannel": "green",
            "scaleXPixels": 10,
            "scaleYPixels": 10,
            "neutral": 128,
            "boundary": "transparent",
        },
    }
)


class AdapterIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        executable = os.environ.get("WORLDBEND_CLI")
        if not executable:
            raise RuntimeError("WORLDBEND_CLI must identify the built native test executable")
        path = Path(executable)
        if not path.is_absolute() or not path.is_file():
            raise RuntimeError("WORLDBEND_CLI must be an absolute regular file")

    def test_identity_image_and_mask_cross_the_real_native_boundary(self) -> None:
        transform = adapter.create_transform(IDENTITY_SPEC)
        image = torch.tensor(
            [
                [
                    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                    [[0.0, 0.0, 1.0], [1.0, 1.0, 1.0]],
                ]
            ],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[0.0, 0.25], [0.5, 1.0]]], dtype=torch.float32)

        output_image, output_mask, retained = adapter.apply_transform(
            image,
            transform,
            quality="standard",
            canvas="reference",
            mask=mask,
        )

        self.assertEqual(tuple(output_image.shape), (1, 2, 2, 3))
        self.assertEqual(tuple(output_mask.shape), (1, 2, 2))
        expected_image = image.clone()
        expected_image[0, 1, 1] = 0.0
        self.assertTrue(torch.equal(output_image, expected_image))
        expected_mask = 1.0 - torch.round((1.0 - mask) * 255.0) / 255.0
        self.assertTrue(torch.equal(output_mask, expected_mask))
        self.assertIs(retained, transform)

    def test_explicit_target_size_is_retained_and_applied(self) -> None:
        transform = adapter.create_transform(IDENTITY_SPEC, 4, 3)
        image = torch.ones((1, 2, 2, 3), dtype=torch.float32)

        output_image, output_mask, _ = adapter.apply_transform(
            image,
            transform,
            canvas="reference",
        )

        self.assertEqual(tuple(output_image.shape), (1, 3, 4, 3))
        self.assertEqual(tuple(output_mask.shape), (1, 3, 4))
        self.assertTrue(torch.equal(output_image, torch.ones_like(output_image)))
        self.assertTrue(torch.equal(output_mask, torch.zeros_like(output_mask)))

    def test_every_declared_quality_and_canvas_value_executes(self) -> None:
        transform = adapter.create_transform(IDENTITY_SPEC)
        image = torch.tensor(
            [[[[0.0, 0.25, 0.5], [0.75, 1.0, 0.0]]]],
            dtype=torch.float32,
        )
        for quality in ["preview", "standard", "high"]:
            for canvas in ["tight", "reference"]:
                with self.subTest(quality=quality, canvas=canvas):
                    output_image, output_mask, _ = adapter.apply_transform(
                        image,
                        transform,
                        quality=quality,
                        canvas=canvas,
                    )
                    self.assertEqual(tuple(output_image.shape), tuple(image.shape))
                    self.assertEqual(tuple(output_mask.shape), (1, 1, 2))

    def test_invalid_geometry_preserves_native_error_code(self) -> None:
        invalid = json.loads(IDENTITY_SPEC)
        invalid["destination"]["quad"]["br"] = {"x": -1, "y": 0.5}
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.create_transform(json.dumps(invalid))
        self.assertIn(
            raised.exception.code,
            {"E_QUAD_SELF_INTERSECT", "E_QUAD_CONCAVE", "E_QUAD_ORIENTATION"},
        )

    def test_batch_is_rejected_before_native_render(self) -> None:
        transform = adapter.create_transform(IDENTITY_SPEC)
        image = torch.zeros((2, 2, 2, 3), dtype=torch.float32)
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.apply_transform(image, transform)
        self.assertEqual(raised.exception.code, "E_SCHEMA")
        self.assertIn("sequence and batch semantics", raised.exception.message)

    def test_mask_shape_must_match_image(self) -> None:
        transform = adapter.create_transform(IDENTITY_SPEC)
        image = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        mask = torch.zeros((1, 3, 2), dtype=torch.float32)
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.apply_transform(image, transform, mask=mask)
        self.assertEqual(raised.exception.code, "E_SCHEMA")

    def test_target_dimensions_are_all_or_nothing(self) -> None:
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.create_transform(IDENTITY_SPEC, 512, 0)
        self.assertEqual(raised.exception.code, "E_SCHEMA")

    def test_nonfinite_and_duplicate_json_are_rejected(self) -> None:
        for invalid in [
            IDENTITY_SPEC.replace('"x": 0', '"x": NaN', 1),
            '{"schema":"worldbend.transform","schema":"duplicate"}',
        ]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(adapter.WorldbendNodeError) as raised:
                    adapter.create_transform(invalid)
                self.assertEqual(raised.exception.code, "E_SCHEMA")

    def test_rectification_image_and_mask_cross_the_real_native_boundary(self) -> None:
        rectification = adapter.create_rectification(IDENTITY_RECTIFICATION)
        image = torch.tensor(
            [
                [
                    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                    [[0.0, 0.0, 1.0], [1.0, 1.0, 1.0]],
                ]
            ],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[0.0, 0.25], [0.5, 1.0]]], dtype=torch.float32)

        output_image, output_mask, retained = adapter.apply_rectification(
            image,
            rectification,
            quality="standard",
            mask=mask,
        )

        self.assertEqual(tuple(output_image.shape), (1, 2, 2, 3))
        self.assertEqual(tuple(output_mask.shape), (1, 2, 2))
        expected_image = image.clone()
        expected_image[0, 1, 1] = 0.0
        self.assertTrue(torch.equal(output_image, expected_image))
        expected_mask = 1.0 - torch.round((1.0 - mask) * 255.0) / 255.0
        self.assertTrue(torch.equal(output_mask, expected_mask))
        self.assertIs(retained, rectification)

    def test_rectification_output_dimensions_are_explicit_and_bounded(self) -> None:
        document = json.loads(IDENTITY_RECTIFICATION)
        document["output"] = {"width": 4, "height": 3}
        rectification = adapter.create_rectification(json.dumps(document))
        image = torch.ones((1, 2, 2, 3), dtype=torch.float32)

        output_image, output_mask, _ = adapter.apply_rectification(image, rectification)

        self.assertEqual(tuple(output_image.shape), (1, 3, 4, 3))
        self.assertEqual(tuple(output_mask.shape), (1, 3, 4))

    def test_rectification_rejects_invalid_source_geometry(self) -> None:
        document = json.loads(IDENTITY_RECTIFICATION)
        document["source"]["quad"]["br"] = {"x": -1, "y": 0.5}
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.create_rectification(json.dumps(document))
        self.assertIn(
            raised.exception.code,
            {"E_QUAD_SELF_INTERSECT", "E_QUAD_CONCAVE", "E_QUAD_ORIENTATION"},
        )

    def test_rectification_rejects_implicit_output_dimensions(self) -> None:
        document = json.loads(IDENTITY_RECTIFICATION)
        del document["output"]
        with self.assertRaises(adapter.WorldbendNodeError) as raised:
            adapter.create_rectification(json.dumps(document))
        self.assertEqual(raised.exception.code, "E_SCHEMA")

    def test_identity_lens_remap_and_mask_cross_the_real_native_boundary(self) -> None:
        remap = adapter.create_remap(IDENTITY_REMAP)
        self.assertFalse(remap.requires_map)
        image = torch.tensor(
            [
                [
                    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                    [[0.0, 0.0, 1.0], [1.0, 1.0, 1.0]],
                ]
            ],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[0.0, 0.25], [0.5, 1.0]]], dtype=torch.float32)

        output_image, output_mask, retained = adapter.apply_remap(
            image,
            remap,
            mask=mask,
        )

        self.assertEqual(tuple(output_image.shape), (1, 2, 2, 3))
        self.assertEqual(tuple(output_mask.shape), (1, 2, 2))
        expected_image = image.clone()
        expected_image[0, 1, 1] = 0.0
        self.assertTrue(torch.equal(output_image, expected_image))
        expected_mask = 1.0 - torch.round((1.0 - mask) * 255.0) / 255.0
        self.assertTrue(torch.equal(output_mask, expected_mask))
        self.assertIs(retained, remap)

    def test_displacement_requires_one_map_and_supports_map_alpha(self) -> None:
        remap = adapter.create_remap(DISPLACEMENT_REMAP)
        self.assertTrue(remap.requires_map)
        image = torch.ones((1, 2, 2, 3), dtype=torch.float32)
        neutral = torch.full((1, 2, 2, 3), 128.0 / 255.0, dtype=torch.float32)
        map_mask = torch.zeros((1, 2, 2), dtype=torch.float32)

        with self.assertRaises(adapter.WorldbendNodeError) as missing:
            adapter.apply_remap(image, remap)
        self.assertEqual(missing.exception.code, "E_SCHEMA")

        output_image, output_mask, retained = adapter.apply_remap(
            image,
            remap,
            displacement_map=neutral,
            displacement_map_mask=map_mask,
        )
        self.assertEqual(tuple(output_image.shape), (1, 2, 2, 3))
        self.assertTrue(torch.equal(output_image, image))
        self.assertTrue(torch.equal(output_mask, torch.zeros_like(output_mask)))
        self.assertIs(retained, remap)

    def test_lens_remap_rejects_an_unrequested_map_before_native_render(self) -> None:
        remap = adapter.create_remap(IDENTITY_REMAP)
        image = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        with mock.patch.object(adapter, "_run_cli") as native:
            with self.assertRaises(adapter.WorldbendNodeError) as raised:
                adapter.apply_remap(image, remap, displacement_map=image)
        self.assertEqual(raised.exception.code, "E_SCHEMA")
        native.assert_not_called()

    def test_canvas_set_spec_is_strict_bounded_json_without_python_geometry(self) -> None:
        canvas_set = adapter.create_canvas_set(CANVAS_SET)
        self.assertEqual(canvas_set.spec_json, CANVAS_SET)

        for invalid in [
            CANVAS_SET.replace('"schema": "worldbend.canvas-set"', '"schema": NaN'),
            '{"schema":"worldbend.canvas-set","schema":"duplicate"}',
            "[]",
        ]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(adapter.WorldbendNodeError) as raised:
                    adapter.create_canvas_set(invalid)
                self.assertEqual(raised.exception.code, "E_SCHEMA")

    def test_canvas_set_rejects_input_batch_before_native_execution(self) -> None:
        canvas_set = adapter.create_canvas_set(CANVAS_SET)
        image = torch.zeros((2, 2, 2, 3), dtype=torch.float32)
        with mock.patch.object(adapter, "_apply_canvas_native") as native:
            with self.assertRaises(adapter.WorldbendNodeError) as raised:
                adapter.apply_canvas_set(image, canvas_set)
        self.assertEqual(raised.exception.code, "E_SCHEMA")
        native.assert_not_called()

    def test_canvas_set_routes_the_complete_set_through_one_native_call(self) -> None:
        canvas_set = adapter.create_canvas_set(CANVAS_SET)
        image = torch.zeros((1, 2, 2, 3), dtype=torch.float32)
        plan = adapter.WorldbendCanvasPlan(
            plan_json='{"schema":"worldbend.canvas-set-plan","version":"0.1"}',
            variant_ids=("small", "square"),
            source_size=(2, 2),
        )
        first = torch.zeros((1, 1, 2, 3), dtype=torch.float32)
        second = torch.zeros((1, 3, 3, 3), dtype=torch.float32)
        first_mask = torch.zeros((1, 1, 2), dtype=torch.float32)
        second_mask = torch.zeros((1, 3, 3), dtype=torch.float32)
        with mock.patch.object(
            adapter,
            "_apply_canvas_native",
            return_value=([first, second], [first_mask, second_mask], plan),
        ) as native:
            images, masks, retained = adapter.apply_canvas_set(image, canvas_set)

        native.assert_called_once()
        self.assertEqual([tuple(value.shape) for value in images], [(1, 1, 2, 3), (1, 3, 3, 3)])
        self.assertEqual([tuple(value.shape) for value in masks], [(1, 1, 2), (1, 3, 3)])
        self.assertIs(retained, plan)

    def test_canvas_set_real_native_outputs_preserve_order_shape_and_alpha(self) -> None:
        canvas_set = adapter.create_canvas_set(CANVAS_SET)
        image = torch.tensor(
            [[[[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]]],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[0.0, 0.25]]], dtype=torch.float32)

        images, masks, plan = adapter.apply_canvas_set(
            image,
            canvas_set,
            quality="standard",
            mask=mask,
        )

        self.assertEqual(plan.variant_ids, ("small", "square"))
        self.assertEqual(plan.source_size, (2, 1))
        self.assertEqual(
            [tuple(value.shape) for value in images],
            [(1, 1, 2, 3), (1, 3, 3, 3)],
        )
        self.assertEqual(
            [tuple(value.shape) for value in masks],
            [(1, 1, 2), (1, 3, 3)],
        )
        self.assertTrue(torch.equal(images[0], image))
        expected_first_mask = 1.0 - torch.round((1.0 - mask) * 255.0) / 255.0
        self.assertTrue(torch.equal(masks[0], expected_first_mask))
        # The centered contain output carries transparent/background coverage
        # through the synchronized MASK, including filtered edge coverage.
        self.assertTrue(torch.any(masks[1] > 0.0).item())

    def test_canvas_real_native_transport_metadata_is_verified_before_return(self) -> None:
        canvas_set = adapter.create_canvas_set(CANVAS_SET)
        image = torch.ones((1, 2, 2, 3), dtype=torch.float32)
        original_reader = adapter._read_canvas_result
        observed: dict[str, object] = {}

        def inspect_then_read(result, output_directory, *, source_size):
            observed["source_size"] = source_size
            observed["ids"] = tuple(item["id"] for item in result["items"])
            observed["shapes"] = tuple(
                (item["width"], item["height"]) for item in result["items"]
            )
            observed["paths"] = tuple(item["output"] for item in result["items"])
            observed["files"] = tuple(
                (
                    (output_directory / f"{item['id']}.png").stat().st_size,
                    hashlib.sha256(
                        (output_directory / f"{item['id']}.png").read_bytes()
                    ).hexdigest(),
                )
                for item in result["items"]
            )
            return original_reader(result, output_directory, source_size=source_size)

        with mock.patch.object(
            adapter,
            "_read_canvas_result",
            side_effect=inspect_then_read,
        ) as verifier:
            images, masks, _ = adapter.apply_canvas_set(image, canvas_set)

        verifier.assert_called_once()
        self.assertEqual(observed["source_size"], (2, 2))
        self.assertEqual(observed["ids"], ("small", "square"))
        self.assertEqual(observed["shapes"], ((2, 1), (3, 3)))
        for output in observed["paths"]:
            self.assertTrue(Path(output).is_absolute())
        for (size, digest), item in zip(
            observed["files"],
            verifier.call_args.args[0]["items"],
        ):
            self.assertEqual(size, item["bytes"])
            self.assertEqual(digest, item["sha256"])
        self.assertEqual(len(images), 2)
        self.assertEqual(len(masks), 2)

    def test_canvas_trim_plan_replays_changed_same_shape_control_without_retrim(self) -> None:
        trim_set = adapter.create_canvas_set(
            json.dumps(
                {
                    "schema": "worldbend.canvas-set",
                    "version": "0.1",
                    "variants": [
                        {
                            "id": "occupied",
                            "operation": {"kind": "trim", "alphaThreshold": 0},
                        }
                    ],
                }
            )
        )
        primary = torch.tensor(
            [[[[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [1.0, 1.0, 1.0]]]],
            dtype=torch.float32,
        )
        primary_mask = torch.tensor([[[1.0, 0.0, 1.0]]], dtype=torch.float32)
        primary_images, _, plan = adapter.apply_canvas_set(
            primary,
            trim_set,
            mask=primary_mask,
        )
        self.assertEqual(tuple(primary_images[0].shape), (1, 1, 1, 3))
        plan_document = json.loads(plan.plan_json)
        self.assertEqual(plan_document["variants"][0]["plan"]["operation"], "trim")
        self.assertEqual(
            plan_document["variants"][0]["plan"]["sourceRect"],
            {"x": 1, "y": 0, "width": 1, "height": 1},
        )

        control = torch.tensor(
            [[[[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [1.0, 1.0, 1.0]]]],
            dtype=torch.float32,
        )
        control_images, control_masks, retained = adapter.apply_canvas_plan(
            control,
            plan,
            sampling="nearest",
            outside_fill_json='{"kind":"transparent"}',
        )

        self.assertIs(retained, plan)
        self.assertEqual(tuple(control_images[0].shape), (1, 1, 1, 3))
        self.assertTrue(
            torch.equal(
                control_images[0],
                torch.tensor([[[[1.0, 0.0, 0.0]]]], dtype=torch.float32),
            )
        )
        self.assertTrue(torch.equal(control_masks[0], torch.zeros((1, 1, 1))))

    def test_canvas_real_native_rejects_16_mip_cumulative_set_without_residue(self) -> None:
        oversized_set = adapter.create_canvas_set(
            json.dumps(
                {
                    "schema": "worldbend.canvas-set",
                    "version": "0.1",
                    "variants": [
                        {
                            "id": "limit",
                            "operation": {
                                "kind": "stretch",
                                "output": {"width": 4096, "height": 4096},
                            },
                        },
                        {
                            "id": "one_more",
                            "operation": {
                                "kind": "stretch",
                                "output": {"width": 1, "height": 1},
                            },
                        },
                    ],
                }
            )
        )
        image = torch.ones((1, 1, 1, 3), dtype=torch.float32)
        created: list[str] = []
        original_temporary_directory = adapter.tempfile.TemporaryDirectory

        def record_temporary_directory(*args, **kwargs):
            directory = original_temporary_directory(*args, **kwargs)
            created.append(directory.name)
            return directory

        with mock.patch.object(
            adapter.tempfile,
            "TemporaryDirectory",
            side_effect=record_temporary_directory,
        ):
            with self.assertRaises(adapter.WorldbendNodeError) as raised:
                adapter.apply_canvas_set(image, oversized_set)

        self.assertEqual(raised.exception.code, "E_OUTPUT_LIMIT")
        self.assertEqual(len(created), 1)
        self.assertFalse(Path(created[0]).exists())

    def test_canvas_plan_requires_explicit_strict_replay_behavior(self) -> None:
        plan = adapter.WorldbendCanvasPlan(
            plan_json='{"schema":"worldbend.canvas-set-plan","version":"0.1"}',
            variant_ids=("small",),
            source_size=(2, 2),
        )
        image = torch.zeros((1, 2, 2, 3), dtype=torch.float32)

        with self.assertRaises(adapter.WorldbendNodeError) as raised_sampling:
            adapter.apply_canvas_plan(
                image,
                plan,
                sampling="automatic",
                outside_fill_json='{"kind":"transparent"}',
            )
        self.assertEqual(raised_sampling.exception.code, "E_SCHEMA")

        with self.assertRaises(adapter.WorldbendNodeError) as raised_fill:
            adapter.apply_canvas_plan(
                image,
                plan,
                sampling="nearest",
                outside_fill_json='{"kind":"transparent","kind":"color"}',
            )
        self.assertEqual(raised_fill.exception.code, "E_SCHEMA")

    def test_native_poll_cancellation_kills_and_reaps_the_one_process(self) -> None:
        class FakeProcess:
            def __init__(self) -> None:
                self.returncode = None
                self.killed = False
                self.communications = 0

            def communicate(self, timeout: float):
                self.communications += 1
                if not self.killed:
                    raise adapter.subprocess.TimeoutExpired(["worldbend"], timeout)
                self.returncode = -9
                return (b"", b"")

            def poll(self):
                return self.returncode

            def kill(self) -> None:
                self.killed = True

        process = FakeProcess()
        with mock.patch.object(adapter.subprocess, "Popen", return_value=process), mock.patch.object(
            adapter,
            "_check_comfy_cancellation",
            side_effect=RuntimeError("cancelled by Comfy"),
        ):
            with self.assertRaisesRegex(RuntimeError, "cancelled by Comfy"):
                adapter._run_cli(["inspect"], expected_operation="inspect")

        self.assertTrue(process.killed)
        self.assertEqual(process.communications, 2)


if __name__ == "__main__":
    unittest.main()
