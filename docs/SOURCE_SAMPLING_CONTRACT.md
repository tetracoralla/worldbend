# Source sampling views

A transform describes the logical artwork. A captured image can have a different
coordinate frame: for example, a rotated Figma Frame is exported into an
axis-aligned bitmap. Applying a new transform directly to that bitmap would
apply the old rotation twice. `worldbend.source-sampling@0.1` retains the mapping
between the logical input plane and its encoded image.

The view belongs to one input-plane binding. Two bindings may use the same image
with different views; the image asset and authored TransformSpec are unchanged.
An ordinary image has an identity view by default. A materialized output has a
new identity view, so a program must consume its input view once, at its first
sampling stage, rather than carrying it into every later stage.

`SourceCaptureFacts` supplies logical dimensions, the actual affine transform
from logical units to capture space, the complete capture origin, requested
fixed density, actual decoded pixel dimensions and the explicit
`fixedDensityFromOrigin` convention. The core's `plan_source_capture` converts
these facts into `SourceSamplingFrame.logicalUvToTextureUv` in double precision.
Translation is made relative to the capture origin before GPU conversion.
Signed transforms retain reflection; encoded dimensions are never inferred by
rounding a reported bounding box. The provider remains responsible for proving
that the facts describe the image and the intended complete input view.

The frame has closed schema/version fields, logical dimensions, decoded pixel
dimensions and a row-major 2×3 affine UV map. Readers reject nonfinite,
nonpositive, singular and ill-conditioned input. A renderer rejects a frame
whose pixel dimensions differ from its decoded image. Logical native dimensions
are independent of the encoded-pixel resource limit. The frame is not a promise
that an arbitrary provider export is complete or that its native graph remains
editable.

Raster evaluation follows the existing destination inverse, authored orientation
and optional deformation into logical source UV. Logical coverage is evaluated
there. The view then maps to encoded texture UV exactly once. Encoded-image
edges retain the existing clamp sampling policy in both CPU and WebGL, including
small provider rounding at the edge; this does not establish complete capture.
Texture filtering
uses that composed mapping's derivatives; using logical derivatives with raw
bitmap dimensions selects the wrong mip levels for anisotropic captures.

The native Transform renderer accepts an optional `RenderOptions.sourceView`;
CLI `render` and `media-render` accept its JSON file as `--source-view`, and the
corresponding MCP render options accept the same `sourceView` object.
The floating-point media Transform path uses the same pixel mapping. The WebGL
Transform renderer accepts a core-planned frame beside its image and transforms
both texture sampling and filtering derivatives. The Web editor retains the
paired image/view through preview and export. A final replacement capture must
provide its matching view, or explicitly declare identity, when the current
source uses a view. Preview downsampling changes the encoded dimensions while
retaining the normalized UV map. Clearing or replacing the source clears its
old view.

The WASM planning/validation inputs are bounded at 8192 UTF-8 bytes and their
parse errors at 256 characters. The generated Web types derive from the core.
Figma capture/continuation, all program entry stages and additional direct
renderers must pass the same view before they can claim mapped-source support.
Their integration and native affine publication remain separate work; this
foundation alone is not Figma host acceptance.
