from __future__ import annotations

import ast
import json
from pathlib import Path
import unittest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]


class NodeContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (PACKAGE_ROOT / "nodes.py").read_text(encoding="utf-8")
        cls.module = ast.parse(cls.source)

    def test_v3_node_ids_and_extension_members_are_explicit(self) -> None:
        classes = {
            node.name: node
            for node in self.module.body
            if isinstance(node, ast.ClassDef)
        }
        for name in [
            "WorldbendCanvasSetSpecNode",
            "WorldbendApplyCanvasSetNode",
            "WorldbendApplyCanvasPlanNode",
            "WorldbendRemapSpecNode",
            "WorldbendApplyRemapNode",
        ]:
            self.assertIn(name, classes)

        extension = classes["WorldbendExtension"]
        get_node_list = next(
            node
            for node in extension.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == "get_node_list"
        )
        returned = next(
            node.value
            for node in ast.walk(get_node_list)
            if isinstance(node, ast.Return)
        )
        self.assertIsInstance(returned, ast.List)
        members = [value.id for value in returned.elts if isinstance(value, ast.Name)]
        self.assertEqual(
            members[-5:],
            [
                "WorldbendCanvasSetSpecNode",
                "WorldbendApplyCanvasSetNode",
                "WorldbendApplyCanvasPlanNode",
                "WorldbendRemapSpecNode",
                "WorldbendApplyRemapNode",
            ],
        )

    def test_both_apply_nodes_publish_image_and_mask_lists(self) -> None:
        classes = {
            node.name: node
            for node in self.module.body
            if isinstance(node, ast.ClassDef)
        }
        for name in ["WorldbendApplyCanvasSetNode", "WorldbendApplyCanvasPlanNode"]:
            calls = [
                node
                for node in ast.walk(classes[name])
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "Output"
                and any(
                    keyword.arg == "is_output_list"
                    and isinstance(keyword.value, ast.Constant)
                    and keyword.value.value is True
                    for keyword in node.keywords
                )
            ]
            self.assertEqual(len(calls), 2, f"{name} must expose IMAGE and MASK lists")

    def test_canvas_example_is_valid_api_json_and_replays_the_plan(self) -> None:
        workflow = json.loads(
            (PACKAGE_ROOT / "examples" / "canvas-api-workflow.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(workflow["2"]["class_type"], "Worldbend_CanvasSetSpec")
        self.assertEqual(workflow["3"]["class_type"], "Worldbend_ApplyCanvasSet")
        self.assertEqual(workflow["6"]["class_type"], "Worldbend_ApplyCanvasPlan")
        self.assertEqual(workflow["6"]["inputs"]["plan"], ["3", 2])
        self.assertEqual(workflow["6"]["inputs"]["sampling"], "nearest")

    def test_remap_example_is_valid_api_json_and_reuses_one_remap(self) -> None:
        workflow = json.loads(
            (PACKAGE_ROOT / "examples" / "remap-api-workflow.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(workflow["3"]["class_type"], "Worldbend_RemapSpec")
        self.assertEqual(workflow["4"]["class_type"], "Worldbend_ApplyRemap")
        self.assertEqual(workflow["6"]["class_type"], "Worldbend_ApplyRemap")
        self.assertEqual(workflow["4"]["inputs"]["remap"], ["3", 0])
        self.assertEqual(workflow["6"]["inputs"]["remap"], ["3", 0])
        self.assertEqual(workflow["4"]["inputs"]["displacement_map"], ["2", 0])
        self.assertEqual(workflow["6"]["inputs"]["displacement_map"], ["2", 0])
        self.assertEqual(workflow["7"]["inputs"]["images"], ["4", 0])
        self.assertEqual(workflow["8"]["inputs"]["images"], ["6", 0])

    def test_every_api_example_contains_a_comfy_output_node(self) -> None:
        for example in sorted((PACKAGE_ROOT / "examples").glob("*-api-workflow.json")):
            with self.subTest(example=example.name):
                workflow = json.loads(example.read_text(encoding="utf-8"))
                self.assertTrue(
                    any(
                        node.get("class_type") in {"PreviewImage", "SaveImage"}
                        for node in workflow.values()
                    ),
                    f"{example.name} must be executable through Comfy's prompt API",
                )


if __name__ == "__main__":
    unittest.main()
