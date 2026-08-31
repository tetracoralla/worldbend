"""Strict Comfy tensor/file adaptation around the native Worldbend core.

This module deliberately contains no transform math. Geometry validation and
rasterization stay in the bundled ``worldbend`` executable so ComfyUI consumes
the same TransformSpec semantics as the CLI, MCP, Web/WASM, and Figma routes.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
from typing import Any, Optional

from PIL import Image as PillowImage
import torch


MAX_AXIS = 8192
MAX_PIXELS = 32 * 1024 * 1024
MAX_CANVAS_SET_PIXELS = 16 * 1024 * 1024
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SPEC_BYTES = 1024 * 1024
MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024
PROCESS_TIMEOUT_SECONDS = 120.0
POLL_INTERVAL_SECONDS = 0.1

_PACKAGE_ROOT = Path(__file__).resolve().parent


class WorldbendNodeError(RuntimeError):
    """A bounded error carrying a stable Worldbend code into ComfyUI."""

    def __init__(self, code: str, message: str, details: Optional[Any] = None):
        bounded_message = str(message)[:4096]
        super().__init__(f"Worldbend {code}: {bounded_message}")
        self.code = code
        self.message = bounded_message
        self.details = details


@dataclass(frozen=True)
class WorldbendTransform:
    """Validated TransformSpec plus optional concrete execution dimensions."""

    spec_json: str
    destination_space: str
    target_size: Optional[tuple[int, int]]


@dataclass(frozen=True)
class WorldbendRectification:
    """Validated RectifySpec retained as explicit workflow data."""

    spec_json: str
    output_size: tuple[int, int]


@dataclass(frozen=True)
class WorldbendCanvasSet:
    """One bounded, ordered CanvasSetSpec retained as workflow data."""

    spec_json: str


@dataclass(frozen=True)
class WorldbendCanvasPlan:
    """A core-resolved CanvasSetPlan suitable for exact raster replay."""

    plan_json: str
    variant_ids: tuple[str, ...]
    source_size: tuple[int, int]


@dataclass(frozen=True)
class WorldbendRemap:
    """Validated lens or displacement remap retained as workflow data."""

    spec_json: str
    output_size: tuple[int, int]
    requires_map: bool


def create_canvas_set(spec_json: str) -> WorldbendCanvasSet:
    """Validate and retain one strict CanvasSetSpec through the native core.

    Operations whose validity depends on the source raster (notably Crop and
    Trim) cannot be resolved at this node. Python deliberately does not
    reproduce the closed operation schema or geometry.
    """

    document = _validate_spec_json(spec_json)
    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-canvas-spec-") as temporary:
        spec_path = Path(temporary) / "canvas-set.worldbend.json"
        spec_path.write_text(spec_json, encoding="utf-8")
        inspected = _run_cli(
            ["canvas-inspect", "--spec", str(spec_path), "--json"],
            expected_operation="canvasInspect",
        )
    if inspected != document:
        _raise("E_INTERNAL", "native Canvas Set inspection changed the supplied program")
    return WorldbendCanvasSet(spec_json)


def create_remap(spec_json: str) -> WorldbendRemap:
    """Validate one strict RemapSpec through the carrier's native core."""

    document = _validate_spec_json(spec_json)
    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-remap-spec-") as temporary:
        spec_path = Path(temporary) / "remap.worldbend.json"
        spec_path.write_text(spec_json, encoding="utf-8")
        plan = _run_cli(
            ["remap-inspect", "--spec", str(spec_path), "--json"],
            expected_operation="remapInspect",
        )
    if plan.get("schema") != "worldbend.remap-plan" or plan.get("version") != "0.1":
        _raise("E_INTERNAL", "native remap inspection returned an unknown plan header")
    if plan.get("spec") != document:
        _raise("E_INTERNAL", "native remap inspection changed the supplied program")
    output_size = _read_pixel_size(document.get("output"), "remap output")
    _validate_raster_size(*output_size, "remap output")
    requires_map = plan.get("requiresMap")
    if not isinstance(requires_map, bool):
        _raise("E_INTERNAL", "native remap inspection returned no map requirement")
    return WorldbendRemap(spec_json, output_size, requires_map)


def create_transform(
    spec_json: str,
    target_width: int = 0,
    target_height: int = 0,
) -> WorldbendTransform:
    """Validate one TransformSpec using the native core and retain it as data."""

    if not isinstance(spec_json, str):
        _raise("E_SCHEMA", "spec_json must be a string")
    encoded = spec_json.encode("utf-8")
    if not encoded:
        _raise("E_SCHEMA", "spec_json must not be empty")
    if len(encoded) > MAX_SPEC_BYTES:
        _raise(
            "E_SCHEMA",
            "spec_json exceeds the Comfy adapter byte limit",
            {"actual": len(encoded), "maximum": MAX_SPEC_BYTES},
        )

    document = _decode_json_object(spec_json)
    destination = document.get("destination")
    destination_space = (
        destination.get("space") if isinstance(destination, dict) else None
    )
    target_size = _validate_target_size(target_width, target_height)

    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-spec-") as temporary:
        spec_path = Path(temporary) / "transform.worldbend.json"
        spec_path.write_text(spec_json, encoding="utf-8")
        arguments = ["inspect", "--spec", str(spec_path), "--json"]
        if target_size is not None:
            arguments.extend(["--target-size", _format_size(target_size)])
        elif destination_space == "normalized":
            # Normalized geometry is scale-independent. The render node binds an
            # omitted target to the incoming IMAGE size; 1x1 lets the Rust core
            # validate the stored geometry before an IMAGE exists.
            arguments.extend(["--target-size", "1x1"])
        _run_cli(arguments, expected_operation="inspect")

    if destination_space not in {"pixel", "normalized"}:
        # The native inspection above owns the canonical error. This guard only
        # prevents an impossible custom object if its output contract changes.
        _raise(
            "E_INTERNAL",
            "native inspection returned without a known destination space",
        )
    return WorldbendTransform(spec_json, destination_space, target_size)


def create_rectification(spec_json: str) -> WorldbendRectification:
    """Validate one explicit RectifySpec using the native core."""

    document = _validate_spec_json(spec_json)
    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-rectify-spec-") as temporary:
        spec_path = Path(temporary) / "rectify.worldbend.json"
        spec_path.write_text(spec_json, encoding="utf-8")
        result = _run_cli(
            ["rectify", "--spec", str(spec_path), "--json"],
            expected_operation="rectify",
        )
    output = document.get("output")
    if not isinstance(output, dict):
        _raise("E_INTERNAL", "native rectification validation returned without output dimensions")
    width = output.get("width")
    height = output.get("height")
    if isinstance(width, bool) or isinstance(height, bool):
        _raise("E_INTERNAL", "native rectification validation returned invalid output dimensions")
    if not isinstance(width, int) or not isinstance(height, int):
        _raise("E_INTERNAL", "native rectification validation returned invalid output dimensions")
    _validate_raster_size(width, height, "rectification output")
    if not isinstance(result.get("homography"), dict):
        _raise("E_INTERNAL", "native rectification validation returned no homography")
    return WorldbendRectification(spec_json, (width, height))


def apply_transform(
    image: torch.Tensor,
    transform: WorldbendTransform,
    quality: str = "standard",
    canvas: str = "tight",
    mask: Optional[torch.Tensor] = None,
) -> tuple[torch.Tensor, torch.Tensor, WorldbendTransform]:
    """Apply one validated TransformSpec to one Comfy IMAGE and optional MASK."""

    if not isinstance(transform, WorldbendTransform):
        _raise("E_SCHEMA", "transform must come from Worldbend Transform Spec")
    if quality not in {"preview", "standard", "high"}:
        _raise("E_SCHEMA", "quality must be preview, standard, or high")
    if canvas not in {"tight", "reference"}:
        _raise("E_SCHEMA", "canvas must be tight or reference")

    source = _validate_image(image)
    height = int(source.shape[1])
    width = int(source.shape[2])
    source_mask = _validate_mask(mask, height, width) if mask is not None else None

    target_size = transform.target_size
    if target_size is None and transform.destination_space == "normalized":
        target_size = (width, height)

    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-render-") as temporary:
        root = Path(temporary)
        source_path = root / "source.png"
        spec_path = root / "transform.worldbend.json"
        output_path = root / "output.png"
        _write_source_rgba(source, source_mask, source_path)
        spec_path.write_text(transform.spec_json, encoding="utf-8")

        arguments = [
            "render",
            "--source",
            str(source_path),
            "--spec",
            str(spec_path),
            "--output",
            str(output_path),
            "--quality",
            quality,
            "--canvas",
            canvas,
            "--max-width",
            str(MAX_AXIS),
            "--max-height",
            str(MAX_AXIS),
            "--max-pixels",
            str(MAX_PIXELS),
            "--max-source-bytes",
            str(MAX_SOURCE_BYTES),
            "--json",
        ]
        if target_size is not None:
            arguments.extend(["--target-size", _format_size(target_size)])
        _run_cli(arguments, expected_operation="render")
        output_image, output_mask = _read_output_rgba(output_path)

    return output_image, output_mask, transform


def apply_rectification(
    image: torch.Tensor,
    rectification: WorldbendRectification,
    quality: str = "standard",
    mask: Optional[torch.Tensor] = None,
) -> tuple[torch.Tensor, torch.Tensor, WorldbendRectification]:
    """Flatten one explicit source quadrilateral from one IMAGE and optional MASK."""

    if not isinstance(rectification, WorldbendRectification):
        _raise("E_SCHEMA", "rectification must come from Worldbend Rectification Spec")
    if quality not in {"preview", "standard", "high"}:
        _raise("E_SCHEMA", "quality must be preview, standard, or high")

    source = _validate_image(image)
    height = int(source.shape[1])
    width = int(source.shape[2])
    source_mask = _validate_mask(mask, height, width) if mask is not None else None
    _validate_raster_size(*rectification.output_size, "rectification output")

    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-rectify-render-") as temporary:
        root = Path(temporary)
        source_path = root / "source.png"
        spec_path = root / "rectify.worldbend.json"
        output_path = root / "output.png"
        _write_source_rgba(source, source_mask, source_path)
        spec_path.write_text(rectification.spec_json, encoding="utf-8")
        _run_cli(
            [
                "rectify-render",
                "--source",
                str(source_path),
                "--spec",
                str(spec_path),
                "--output",
                str(output_path),
                "--quality",
                quality,
                "--max-width",
                str(MAX_AXIS),
                "--max-height",
                str(MAX_AXIS),
                "--max-pixels",
                str(MAX_PIXELS),
                "--max-source-bytes",
                str(MAX_SOURCE_BYTES),
                "--json",
            ],
            expected_operation="rectifyRender",
        )
        output_image, output_mask = _read_output_rgba(output_path)

    return output_image, output_mask, rectification


def apply_remap(
    image: torch.Tensor,
    remap: WorldbendRemap,
    quality: str = "standard",
    mask: Optional[torch.Tensor] = None,
    displacement_map: Optional[torch.Tensor] = None,
    displacement_map_mask: Optional[torch.Tensor] = None,
) -> tuple[torch.Tensor, torch.Tensor, WorldbendRemap]:
    """Apply one explicit lens or map-driven displacement to IMAGE and MASK."""

    if not isinstance(remap, WorldbendRemap):
        _raise("E_SCHEMA", "remap must come from Worldbend Remap Spec")
    if quality not in {"preview", "standard", "high"}:
        _raise("E_SCHEMA", "quality must be preview, standard, or high")
    if remap.requires_map != (displacement_map is not None):
        _raise(
            "E_SCHEMA",
            "displacement remaps require exactly one map IMAGE; lens remaps reject it",
        )
    if displacement_map is None and displacement_map_mask is not None:
        _raise("E_SCHEMA", "a displacement map MASK requires a displacement map IMAGE")

    source = _validate_image(image)
    height = int(source.shape[1])
    width = int(source.shape[2])
    source_mask = _validate_mask(mask, height, width) if mask is not None else None
    map_image = _validate_image(displacement_map) if displacement_map is not None else None
    map_mask = None
    if displacement_map_mask is not None:
        assert map_image is not None
        map_mask = _validate_mask(
            displacement_map_mask,
            int(map_image.shape[1]),
            int(map_image.shape[2]),
        )
    _validate_raster_size(*remap.output_size, "remap output")

    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-remap-render-") as temporary:
        root = Path(temporary)
        source_path = root / "source.png"
        map_path = root / "map.png"
        spec_path = root / "remap.worldbend.json"
        output_path = root / "output.png"
        _write_source_rgba(source, source_mask, source_path)
        spec_path.write_text(remap.spec_json, encoding="utf-8")
        arguments = [
            "remap-render",
            "--source",
            str(source_path),
            "--spec",
            str(spec_path),
            "--output",
            str(output_path),
            "--quality",
            quality,
            "--max-width",
            str(MAX_AXIS),
            "--max-height",
            str(MAX_AXIS),
            "--max-pixels",
            str(MAX_PIXELS),
            "--max-source-bytes",
            str(MAX_SOURCE_BYTES),
            "--json",
        ]
        if map_image is not None:
            _write_source_rgba(map_image, map_mask, map_path)
            arguments.extend(["--map", str(map_path)])
        result = _run_cli(arguments, expected_operation="remapRender")
        if (
            result.get("status") != "written"
            or result.get("dryRun") is not False
            or result.get("output") != str(output_path)
            or result.get("plan", {}).get("requiresMap") != remap.requires_map
            or result.get("plan", {}).get("spec") != _decode_json_object(remap.spec_json)
        ):
            _raise("E_INTERNAL", "native remap execution returned an invalid result identity")
        evidence = result.get("evidence")
        if (
            not isinstance(evidence, dict)
            or (evidence.get("outputWidth"), evidence.get("outputHeight"))
            != remap.output_size
            or (evidence.get("mapSha256") is not None) != remap.requires_map
        ):
            _raise("E_INTERNAL", "native remap execution returned invalid dimensions or map identity")
        output_image, output_mask = _read_output_rgba(output_path)

    return output_image, output_mask, remap


def apply_canvas_set(
    image: torch.Tensor,
    canvas_set: WorldbendCanvasSet,
    quality: str = "standard",
    mask: Optional[torch.Tensor] = None,
) -> tuple[list[torch.Tensor], list[torch.Tensor], WorldbendCanvasPlan]:
    """Apply every ordered Canvas Set variant to the same original raster."""

    if not isinstance(canvas_set, WorldbendCanvasSet):
        _raise("E_SCHEMA", "canvas_set must come from Worldbend Canvas Set Spec")
    if quality not in {"preview", "standard", "high"}:
        _raise("E_SCHEMA", "quality must be preview, standard, or high")

    source = _validate_image(image)
    height = int(source.shape[1])
    width = int(source.shape[2])
    source_mask = _validate_mask(mask, height, width) if mask is not None else None

    return _apply_canvas_native(
        source,
        source_mask,
        document_json=canvas_set.spec_json,
        document_kind="spec",
        quality=quality,
        sampling=None,
        outside_fill_json=None,
    )


def apply_canvas_plan(
    image: torch.Tensor,
    plan: WorldbendCanvasPlan,
    sampling: str,
    outside_fill_json: str,
    mask: Optional[torch.Tensor] = None,
) -> tuple[list[torch.Tensor], list[torch.Tensor], WorldbendCanvasPlan]:
    """Replay one resolved plan without re-running source-dependent operations."""

    if not isinstance(plan, WorldbendCanvasPlan):
        _raise("E_SCHEMA", "plan must come from Apply Worldbend Canvas Set")
    if sampling not in {"linear", "nearest"}:
        _raise("E_SCHEMA", "sampling must be linear or nearest")
    _validate_spec_json(outside_fill_json)

    source = _validate_image(image)
    height = int(source.shape[1])
    width = int(source.shape[2])
    source_mask = _validate_mask(mask, height, width) if mask is not None else None

    images, masks, replayed = _apply_canvas_native(
        source,
        source_mask,
        document_json=plan.plan_json,
        document_kind="plan",
        quality=None,
        sampling=sampling,
        outside_fill_json=outside_fill_json,
    )
    if (
        replayed.variant_ids != plan.variant_ids
        or replayed.source_size != plan.source_size
        or _decode_json_object(replayed.plan_json) != _decode_json_object(plan.plan_json)
    ):
        _raise("E_INTERNAL", "native Canvas replay returned a different plan identity")
    return images, masks, plan


def _apply_canvas_native(
    image: torch.Tensor,
    mask: Optional[torch.Tensor],
    *,
    document_json: str,
    document_kind: str,
    quality: Optional[str],
    sampling: Optional[str],
    outside_fill_json: Optional[str],
) -> tuple[list[torch.Tensor], list[torch.Tensor], WorldbendCanvasPlan]:
    """One-process Canvas transport seam; the Rust core owns all geometry."""

    if document_kind not in {"spec", "plan"}:
        _raise("E_INTERNAL", "unknown native Canvas document kind")
    if document_kind == "spec":
        if quality not in {"preview", "standard", "high"}:
            _raise("E_INTERNAL", "Canvas Set execution requires a known quality")
        if sampling is not None or outside_fill_json is not None:
            _raise("E_INTERNAL", "Canvas Set execution received replay-only options")
    else:
        if quality is not None:
            _raise("E_INTERNAL", "Canvas plan replay received primary-image quality")
        if sampling not in {"linear", "nearest"} or outside_fill_json is None:
            _raise("E_INTERNAL", "Canvas plan replay requires explicit sampling and fill")

    # Keeping the complete set inside one temporary tree and one CLI call
    # prevents per-variant process fan-out. If Comfy cancels, _run_cli kills and
    # reaps that one child before this context removes every staged artifact.
    with tempfile.TemporaryDirectory(prefix="worldbend-comfy-canvas-") as temporary:
        root = Path(temporary)
        source_path = root / "source.png"
        document_path = root / f"canvas-{document_kind}.worldbend.json"
        output_directory = root / "outputs"
        _write_source_rgba(image, mask, source_path)
        document_path.write_text(document_json, encoding="utf-8")

        arguments = [
            "canvas-render",
            "--source",
            str(source_path),
            f"--{document_kind}",
            str(document_path),
            "--output-directory",
            str(output_directory),
        ]
        if document_kind == "spec":
            arguments.extend(["--quality", str(quality)])
        else:
            outside_fill_path = root / "outside-fill.worldbend.json"
            outside_fill_path.write_text(str(outside_fill_json), encoding="utf-8")
            arguments.extend(
                [
                    "--sampling",
                    str(sampling),
                    "--outside-fill",
                    str(outside_fill_path),
                ]
            )
        arguments.extend(
            [
                "--max-width",
                str(MAX_AXIS),
                "--max-height",
                str(MAX_AXIS),
                "--max-pixels",
                str(MAX_PIXELS),
                "--max-cumulative-pixels",
                str(MAX_CANVAS_SET_PIXELS),
                "--max-source-bytes",
                str(MAX_SOURCE_BYTES),
                "--json",
            ]
        )
        result = _run_cli(arguments, expected_operation="canvasRender")
        return _read_canvas_result(
            result,
            output_directory,
            source_size=(int(image.shape[2]), int(image.shape[1])),
        )


def _read_canvas_result(
    result: dict[str, Any],
    output_directory: Path,
    *,
    source_size: tuple[int, int],
) -> tuple[list[torch.Tensor], list[torch.Tensor], WorldbendCanvasPlan]:
    """Verify native transport/file correlation without re-planning geometry."""

    if (
        result.get("status") != "written"
        or result.get("dryRun") is not False
        or result.get("outputDirectory") != str(output_directory)
        or output_directory.is_symlink()
        or not output_directory.is_dir()
    ):
        _raise("E_INTERNAL", "native Canvas execution returned an invalid publication state")

    plan = result.get("plan")
    items = result.get("items")
    if not isinstance(plan, dict) or not isinstance(items, list):
        _raise("E_INTERNAL", "native Canvas execution returned no ordered plan/items")
    if plan.get("schema") != "worldbend.canvas-set-plan" or plan.get("version") != "0.1":
        _raise("E_INTERNAL", "native Canvas execution returned an unknown plan header")
    if _read_pixel_size(plan.get("sourceSize"), "Canvas plan source") != source_size:
        _raise("E_INTERNAL", "native Canvas execution returned the wrong source shape")

    variants = plan.get("variants")
    if not isinstance(variants, list) or not 1 <= len(variants) <= 16:
        _raise("E_INTERNAL", "native Canvas execution returned an invalid variant set")
    if len(items) != len(variants):
        _raise("E_INTERNAL", "native Canvas result count does not match its plan")

    variant_ids: list[str] = []
    expected_names: list[str] = []
    images: list[torch.Tensor] = []
    masks: list[torch.Tensor] = []
    cumulative_pixels = 0
    for index, (variant, item) in enumerate(zip(variants, items)):
        if not isinstance(variant, dict) or not isinstance(item, dict):
            _raise("E_INTERNAL", "native Canvas result contains a non-object item")
        variant_id = variant.get("id")
        if not isinstance(variant_id, str) or not variant_id:
            _raise("E_INTERNAL", "native Canvas result contains an invalid variant ID")
        if variant_id in variant_ids or item.get("id") != variant_id:
            _raise("E_INTERNAL", "native Canvas result order does not match its plan")
        variant_plan = variant.get("plan")
        if not isinstance(variant_plan, dict):
            _raise("E_INTERNAL", "native Canvas result contains no variant plan")
        width, height = _read_pixel_size(
            variant_plan.get("outputSize"),
            f"Canvas variant {index} output",
        )
        if item.get("width") != width or item.get("height") != height:
            _raise("E_INTERNAL", "native Canvas item dimensions do not match its plan")
        _validate_raster_size(width, height, f"Canvas variant {index} output")
        cumulative_pixels += width * height
        if cumulative_pixels > MAX_CANVAS_SET_PIXELS:
            _raise(
                "E_OUTPUT_LIMIT",
                "Canvas Set exceeds the Comfy cumulative pixel ceiling",
                {"actual": cumulative_pixels, "maximum": MAX_CANVAS_SET_PIXELS},
            )

        filename = f"{variant_id}.png"
        output_path = output_directory / filename
        if item.get("output") != str(output_path):
            _raise("E_INTERNAL", "native Canvas item returned an unexpected output path")
        encoded_bytes = item.get("bytes")
        sha256 = item.get("sha256")
        if (
            isinstance(encoded_bytes, bool)
            or not isinstance(encoded_bytes, int)
            or encoded_bytes < 0
            or not isinstance(sha256, str)
            or len(sha256) != 64
            or any(character not in "0123456789abcdef" for character in sha256)
        ):
            _raise("E_INTERNAL", "native Canvas item returned invalid file metadata")
        if output_path.is_symlink() or not output_path.is_file():
            _raise("E_RENDER", "native Canvas renderer did not publish a regular output file")
        if output_path.stat().st_size != encoded_bytes:
            _raise("E_INTERNAL", "native Canvas output byte count does not match its file")
        if _sha256_file(output_path) != sha256:
            _raise("E_INTERNAL", "native Canvas output digest does not match its file")

        output_image, output_mask = _read_output_rgba(output_path)
        if tuple(output_image.shape) != (1, height, width, 3) or tuple(
            output_mask.shape
        ) != (1, height, width):
            _raise("E_INTERNAL", "native Canvas output shape does not match its plan")
        variant_ids.append(variant_id)
        expected_names.append(filename)
        images.append(output_image)
        masks.append(output_mask)

    actual_names = sorted(entry.name for entry in output_directory.iterdir())
    if actual_names != sorted(expected_names):
        _raise("E_INTERNAL", "native Canvas output directory contains unexpected entries")

    try:
        plan_json = json.dumps(
            plan,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as error:
        _raise("E_INTERNAL", f"native Canvas plan is not finite JSON: {error}")
    retained_plan = WorldbendCanvasPlan(plan_json, tuple(variant_ids), source_size)
    return images, masks, retained_plan


def _read_pixel_size(value: Any, label: str) -> tuple[int, int]:
    if not isinstance(value, dict):
        _raise("E_INTERNAL", f"{label} dimensions are missing")
    width = value.get("width")
    height = value.get("height")
    if (
        isinstance(width, bool)
        or isinstance(height, bool)
        or not isinstance(width, int)
        or not isinstance(height, int)
        or width <= 0
        or height <= 0
    ):
        _raise("E_INTERNAL", f"{label} dimensions are invalid")
    return width, height


def _sha256_file(source: Path) -> str:
    digest = hashlib.sha256()
    with source.open("rb") as stream:
        for chunk in iter(lambda: stream.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_image(image: torch.Tensor) -> torch.Tensor:
    if not isinstance(image, torch.Tensor):
        _raise("E_SCHEMA", "image must be a Comfy IMAGE tensor")
    if image.ndim != 4 or int(image.shape[-1]) != 3:
        _raise("E_SCHEMA", "image must have shape [B,H,W,3]")
    if int(image.shape[0]) != 1:
        _raise(
            "E_SCHEMA",
            "Worldbend v0 accepts exactly one IMAGE; sequence and batch semantics are not published",
            {"batch": int(image.shape[0])},
        )
    height = int(image.shape[1])
    width = int(image.shape[2])
    _validate_raster_size(width, height, "source image")
    detached = image.detach()
    if not torch.isfinite(detached).all().item():
        _raise("E_NON_FINITE_COORDINATE", "image contains NaN or infinite values")
    minimum = detached.amin().item()
    maximum = detached.amax().item()
    if minimum < 0.0 or maximum > 1.0:
        _raise(
            "E_SCHEMA",
            "image values must stay in the closed [0,1] range",
            {"minimum": minimum, "maximum": maximum},
        )
    return detached.to(device="cpu", dtype=torch.float32).contiguous()


def _validate_mask(mask: torch.Tensor, height: int, width: int) -> torch.Tensor:
    if not isinstance(mask, torch.Tensor):
        _raise("E_SCHEMA", "mask must be a Comfy MASK tensor")
    if mask.ndim != 3 or tuple(mask.shape) != (1, height, width):
        _raise(
            "E_SCHEMA",
            "mask must have shape [1,H,W] matching the IMAGE",
            {"actual": list(mask.shape), "expected": [1, height, width]},
        )
    detached = mask.detach()
    if not torch.isfinite(detached).all().item():
        _raise("E_NON_FINITE_COORDINATE", "mask contains NaN or infinite values")
    minimum = detached.amin().item()
    maximum = detached.amax().item()
    if minimum < 0.0 or maximum > 1.0:
        _raise(
            "E_SCHEMA",
            "mask values must stay in the closed [0,1] range",
            {"minimum": minimum, "maximum": maximum},
        )
    return detached.to(device="cpu", dtype=torch.float32).contiguous()


def _validate_target_size(width: int, height: int) -> Optional[tuple[int, int]]:
    if isinstance(width, bool) or isinstance(height, bool):
        _raise("E_SCHEMA", "target width and height must be integers")
    if not isinstance(width, int) or not isinstance(height, int):
        _raise("E_SCHEMA", "target width and height must be integers")
    if width == 0 and height == 0:
        return None
    if width <= 0 or height <= 0:
        _raise(
            "E_SCHEMA",
            "target width and height must both be zero or both be positive",
        )
    _validate_raster_size(width, height, "target size")
    return (width, height)


def _validate_raster_size(width: int, height: int, label: str) -> None:
    if width <= 0 or height <= 0:
        _raise("E_SCHEMA", f"{label} dimensions must be positive")
    pixels = width * height
    if width > MAX_AXIS or height > MAX_AXIS or pixels > MAX_PIXELS:
        _raise(
            "E_OUTPUT_LIMIT",
            f"{label} exceeds the Comfy adapter resource ceiling",
            {
                "actual": {"width": width, "height": height, "pixels": pixels},
                "maximum": {
                    "width": MAX_AXIS,
                    "height": MAX_AXIS,
                    "pixels": MAX_PIXELS,
                },
            },
        )


def _write_source_rgba(
    image: torch.Tensor,
    mask: Optional[torch.Tensor],
    destination: Path,
) -> None:
    rgb = torch.round(image[0] * 255.0).to(torch.uint8).contiguous()
    height = int(rgb.shape[0])
    width = int(rgb.shape[1])
    rgba = PillowImage.frombytes("RGB", (width, height), rgb.numpy().tobytes())
    if mask is None:
        alpha_bytes = bytes([255]) * (width * height)
    else:
        # Comfy MASK follows LoadImage convention: 1 means transparent/masked.
        alpha = torch.round((1.0 - mask[0]) * 255.0).to(torch.uint8).contiguous()
        alpha_bytes = alpha.numpy().tobytes()
    rgba.putalpha(PillowImage.frombytes("L", (width, height), alpha_bytes))
    rgba.save(destination, format="PNG")


def _read_output_rgba(source: Path) -> tuple[torch.Tensor, torch.Tensor]:
    if not source.is_file() or source.is_symlink():
        _raise("E_RENDER", "native renderer did not publish a regular output file")
    with PillowImage.open(source) as opened:
        rgba = opened.convert("RGBA")
        width, height = rgba.size
        _validate_raster_size(width, height, "rendered image")
        raw = bytearray(rgba.tobytes())
    tensor = torch.frombuffer(raw, dtype=torch.uint8).reshape(height, width, 4)
    tensor = tensor.to(dtype=torch.float32).div_(255.0)
    image = tensor[:, :, :3].unsqueeze(0).contiguous()
    mask = (1.0 - tensor[:, :, 3]).unsqueeze(0).contiguous()
    return image, mask


def _decode_json_object(source: str) -> dict[str, Any]:
    def reject_constant(value: str) -> None:
        raise ValueError(f"non-finite JSON number {value}")

    def reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key {key!r}")
            result[key] = value
        return result

    try:
        value = json.loads(
            source,
            parse_constant=reject_constant,
            object_pairs_hook=reject_duplicates,
        )
    except (UnicodeError, ValueError, json.JSONDecodeError) as error:
        _raise("E_SCHEMA", f"spec_json is not strict JSON: {error}")
    if not isinstance(value, dict):
        _raise("E_SCHEMA", "spec_json must contain one JSON object")
    return value


def _validate_spec_json(spec_json: str) -> dict[str, Any]:
    if not isinstance(spec_json, str):
        _raise("E_SCHEMA", "spec_json must be a string")
    encoded = spec_json.encode("utf-8")
    if not encoded:
        _raise("E_SCHEMA", "spec_json must not be empty")
    if len(encoded) > MAX_SPEC_BYTES:
        _raise(
            "E_SCHEMA",
            "spec_json exceeds the Comfy adapter byte limit",
            {"actual": len(encoded), "maximum": MAX_SPEC_BYTES},
        )
    return _decode_json_object(spec_json)


def _run_cli(arguments: list[str], expected_operation: str) -> dict[str, Any]:
    executable = _resolve_cli()
    command = [str(executable), *arguments]
    started = time.monotonic()
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False,
    )
    try:
        while True:
            try:
                stdout, stderr = process.communicate(timeout=POLL_INTERVAL_SECONDS)
                break
            except subprocess.TimeoutExpired:
                _check_comfy_cancellation()
                if time.monotonic() - started >= PROCESS_TIMEOUT_SECONDS:
                    _terminate_process(process)
                    _raise(
                        "E_TIMEOUT",
                        f"native operation exceeded {int(PROCESS_TIMEOUT_SECONDS)} seconds",
                    )
    except BaseException:
        _terminate_process(process)
        raise

    if len(stdout) > MAX_PROCESS_OUTPUT_BYTES or len(stderr) > MAX_PROCESS_OUTPUT_BYTES:
        _raise("E_INTERNAL", "native operation exceeded its process-output byte limit")
    envelope = _decode_process_envelope(stdout)
    if process.returncode != 0 or envelope.get("ok") is not True:
        error = envelope.get("error")
        if isinstance(error, dict):
            _raise(
                str(error.get("code", "E_INTERNAL")),
                str(error.get("message", "native operation failed")),
                error.get("details"),
            )
        diagnostic = stderr.decode("utf-8", errors="replace")[:4096]
        _raise(
            "E_INTERNAL",
            diagnostic or "native operation failed without a structured error",
        )
    if envelope.get("operation") != expected_operation or not isinstance(
        envelope.get("result"), dict
    ):
        _raise("E_INTERNAL", "native operation returned an unexpected success envelope")
    return envelope["result"]


def _decode_process_envelope(stdout: bytes) -> dict[str, Any]:
    try:
        value = json.loads(stdout.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError) as error:
        _raise("E_INTERNAL", f"native operation returned invalid JSON: {error}")
    if not isinstance(value, dict):
        _raise("E_INTERNAL", "native operation returned a non-object JSON envelope")
    return value


def _resolve_cli() -> Path:
    configured = os.environ.get("WORLDBEND_CLI")
    executable_name = "worldbend.exe" if os.name == "nt" else "worldbend"
    candidate = (
        Path(configured)
        if configured
        else _PACKAGE_ROOT / "bin" / executable_name
    )
    if not candidate.is_absolute():
        _raise("E_INTERNAL", "WORLDBEND_CLI must be an absolute path")
    if candidate.is_symlink() or not candidate.is_file():
        _raise(
            "E_INTERNAL",
            f"Worldbend executable is missing or not a regular file: {candidate}",
        )
    if os.name != "nt" and not os.access(candidate, os.X_OK):
        _raise("E_INTERNAL", f"Worldbend executable is not executable: {candidate}")
    return candidate


def _check_comfy_cancellation() -> None:
    try:
        from comfy.model_management import (  # type: ignore[import-not-found]
            throw_exception_if_processing_interrupted,
        )
    except ImportError:
        return
    throw_exception_if_processing_interrupted()


def _terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.kill()
    try:
        process.communicate(timeout=5.0)
    except subprocess.TimeoutExpired:
        pass


def _format_size(size: tuple[int, int]) -> str:
    return f"{size[0]}x{size[1]}"


def _raise(code: str, message: str, details: Optional[Any] = None) -> None:
    raise WorldbendNodeError(code, message, details)
