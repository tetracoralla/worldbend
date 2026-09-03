# Worldbend for ComfyUI (experimental local package)

Worldbend brings reusable `TransformSpec`, explicit `RectifySpec`, ordered
`CanvasSetSpec`, and explicit `RemapSpec` data into ComfyUI without adding a
second geometry engine. The
Python nodes adapt Comfy tensors and masks to the bundled native Worldbend
renderer; validation, planning, sampling, alpha handling, and output bounds
remain owned by the same Rust core used by the CLI, Agent Host, Web/WASM, and
Figma routes.

The pack uses Comfy's versioned V3 node API and exposes no frontend extension.
See Comfy's official [V3 migration reference](https://docs.comfy.org/custom-nodes/v3_migration).

## Nodes

- **Worldbend Transform Spec** validates explicit `worldbend.transform@0.1`
  JSON and emits `WORLDBEND_TRANSFORM`. If both target dimensions are zero, a
  normalized spec binds to the incoming IMAGE size when applied. A concrete
  target requires two positive dimensions.
- **Apply Worldbend Transform** consumes one IMAGE, an optional MASK, and the
  transform. It returns an IMAGE, a MASK, and the unchanged transform so the
  exact plane can be reused elsewhere in the workflow.
- **Worldbend Rectification Spec** validates an explicit source quadrilateral
  and explicit output dimensions as `worldbend.rectify@0.1`, then emits
  `WORLDBEND_RECTIFICATION`. It does not inspect pixels, detect a plane, or
  infer an aspect ratio.
- **Apply Worldbend Rectification** maps that caller-supplied source plane to
  the declared output rectangle and returns IMAGE, MASK, and the unchanged
  rectification value.
- **Worldbend Canvas Set Spec** stores one strict JSON object containing an
  ordered `worldbend.canvas-set@0.1` program. Operations that depend on the
  source raster, including Crop bounds and Trim, are resolved only when the set
  is applied.
- **Apply Worldbend Canvas Set** consumes one IMAGE, optional MASK, and one
  Canvas Set. One native process decodes the source once and applies all
  variants independently to the original. It returns ordered heterogeneous
  IMAGE and MASK lists plus the resolved `WORLDBEND_CANVAS_PLAN`.
- **Apply Worldbend Canvas Plan** replays that resolved plan on one compatible
  8-bit control IMAGE. Sampling (`nearest` or `linear`) and outside fill are
  explicit. Replay requires the exact recorded source dimensions and never
  re-runs Trim.
- **Worldbend Remap Spec** validates one explicit Brown-Conrady lens program or
  channel-driven displacement program and emits `WORLDBEND_REMAP`.
- **Apply Worldbend Remap** applies that value to one IMAGE and MASK. A
  displacement program requires exactly one map IMAGE; an optional map MASK
  supplies its alpha channel. Reusing the same Remap and map keeps compatible
  control images on the same deterministic geometry.

The MASK convention matches ComfyUI `LoadImage`: `1` is transparent/masked and
therefore becomes source alpha `0`. When `LoadImage` supplies its all-zero
64 x 64 sentinel for an image without alpha, Worldbend expands that sentinel
to an all-visible mask at the IMAGE dimensions; a non-empty mismatched mask is
still rejected. The native renderer currently publishes
8-bit RGBA PNG, so tensor conversion is intentionally 8-bit. Inputs and outputs
are capped at 8192 pixels per axis and 32 Mi pixels per image. A Canvas Set is
further capped at 16 Mi output pixels cumulatively because all heterogeneous
float tensors remain live in ComfyUI. Ordinary 8-bit Canny, pose, and
segmentation maps can replay a plan; 16-bit depth, float normal/flow maps, and
normal-vector renormalization are not part of this boundary.

The Canvas list outputs preserve the exact variant order and are Comfy lists,
not a padded tensor batch. See `examples/canvas-api-workflow.json` for one
primary render followed by synchronized control-map replay.
`examples/remap-api-workflow.json` shows one displacement program and map reused
for a primary image and a control image.

## Local install

Run `pnpm package:comfyui-local` from the Worldbend source checkout. Copy the
resulting folder under `artifacts/comfyui/` into `ComfyUI/custom_nodes/`, keep
its `bin/` folder intact, then restart ComfyUI. No frontend JavaScript, network
service, model download, or runtime package installation is used.
`THIRD_PARTY_NOTICES.md`, `licenses/`, and `sbom/` describe the locked Rust
dependency closure statically linked into the bundled executable; they do not
declare a Worldbend product license.

The source folder by itself is not self-contained because its native binary is
added only by the local packaging command. For development tests, set the
absolute `WORLDBEND_CLI` path to a matching locally built executable.

## Published boundary

Every operation family accepts exactly one IMAGE (`B=1`). Canvas fan-out is one
atomic ordered set over that source: 1..16 unique variant IDs, no per-item input
paths, no partial success, and no variant-to-variant dependency. The pack still
rejects Comfy input batches and video frame sequences because those require a
different ordering, correlation, fairness, cancellation, and partial-failure
contract. It is a local integration artifact, not a Comfy Registry release;
Registry publisher identity and multi-platform binary distribution remain
separate release decisions.
