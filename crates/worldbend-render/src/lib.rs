//! Native reference raster renderer.
//!
//! Geometry comes only from `worldbend-core`. This crate owns inverse pixel
//! mapping, premultiplied-alpha filtering, output bounds, encoding, and safe
//! file publication.

mod canvas;
#[cfg(feature = "deform")]
mod deform;
mod file_io;
mod media;
#[cfg(feature = "place")]
mod mockup;
#[cfg(feature = "motion")]
mod motion;
#[cfg(feature = "program")]
mod raster_program;
#[cfg(feature = "remap")]
mod remap;
#[cfg(feature = "surface-deformation")]
mod surface_deformation;
#[cfg(feature = "template")]
mod template;
mod tiled;
#[cfg(feature = "timeline")]
mod timeline;
mod vector;

pub use canvas::{
    CanvasReplayOptions, CanvasReplaySampling, CanvasSetFileRenderResult, CanvasSetProgram,
    CanvasSetRenderOptions, CanvasSetRenderStatus, CanvasSetRenderedItem, render_canvas_set_file,
    render_canvas_set_to_directory, resolve_canvas_set_for_image,
};

pub use file_io::{
    preflight_destination, publish_staged_file, rectify_file, rectify_file_with_source_sha256,
    render_file, render_file_with_source_sha256,
};
pub use media::{
    ColorManagement, IccPolicy, MAX_MEDIA_PIXELS, MediaAnalysisRaster, MediaColorModel,
    MediaFileRenderResult, MediaFormat, MediaLoss, MediaOutput, MediaOutputInfo,
    MediaRenderOptions, MediaSampleFormat, MediaSourceInfo, OutputPrecision,
    decode_media_analysis_file_with_cancel, inspect_media_file, media_output_accepts_extension,
    media_output_extension, media_output_format_name, render_media_file,
    render_media_file_with_cancel,
};
pub use tiled::{
    MAX_TILED_AXIS, MAX_TILED_ENCODED_BYTES, MAX_TILED_OUTPUT_PIXELS, MAX_TILED_TILE_PIXELS,
    MAX_TILED_TILES, TILED_MEDIA_SCHEMA, TILED_MEDIA_VERSION, TiledMediaManifest,
    TiledMediaRenderOptions, TiledMediaRenderResult, TiledMediaStatus, TiledMediaTile,
    render_tiled_media_directory, render_tiled_media_directory_with_cancel,
};
pub use vector::{
    MAX_VECTOR_AXIS, MAX_VECTOR_OUTPUT_BYTES, MAX_VECTOR_SOURCE_BYTES, VectorCarrier,
    VectorFileResult, VectorRenderOptions, render_vector_file, render_vector_file_with_cancel,
};

#[cfg(feature = "program")]
pub use raster_program::{
    RasterProgramFileRenderResult, RasterProgramRenderOptions, RasterProgramStageResult,
    RenderedRasterProgram, render_raster_program, render_raster_program_file,
    render_raster_program_file_with_cancel, render_raster_program_file_with_source_sha256,
    render_raster_program_with_cancel,
};

#[cfg(feature = "deform")]
pub use deform::{
    MeshWarpFileRenderResult, MeshWarpRenderOptions, RenderedMeshWarp, render_mesh_warp,
    render_mesh_warp_file_with_cancel, render_mesh_warp_with_cancel,
};

#[cfg(feature = "place")]
pub use mockup::{
    MAX_MOCKUP_SOURCE_PIXELS, MockupExtractFileRenderResult, MockupExtractRenderOptions,
    MockupExtractRenderStatus, MockupExtractRenderedItem, MockupFileRenderResult, MockupFileSource,
    MockupRenderDiagnostics, MockupRenderEvidence, MockupRenderOptions, MockupSourceEvidence,
    RenderedMockup, render_mockup, render_mockup_extract_files,
    render_mockup_extract_files_with_cancel, render_mockup_extract_to_directory,
    render_mockup_files, render_mockup_files_with_cancel, render_mockup_with_cancel,
};

#[cfg(feature = "motion")]
pub use motion::{
    MotionFileRenderResult, MotionRenderedItem, render_motion_files,
    render_motion_files_with_cancel,
};
#[cfg(feature = "remap")]
pub use remap::{
    RemapEvidence, RemapFileMap, RemapFileRenderResult, RemapRenderOptions, RenderedRemap,
    render_remap, render_remap_file_with_cancel, render_remap_with_cancel,
};
#[cfg(feature = "surface-deformation")]
pub use surface_deformation::{
    RenderedSurfaceDeformation, SurfaceDeformationFileRenderResult, render_surface_deformation,
    render_surface_deformation_file_with_cancel, render_surface_deformation_with_cancel,
};
#[cfg(feature = "template")]
pub use template::{
    MAX_VARIATION_JOB_PROCESSED_PIXELS, MAX_VARIATION_JOB_SOURCE_PIXELS, VariationFileAsset,
    VariationJobFileRenderResult, VariationJobItemOutcome, VariationJobRenderOptions,
    VariationJobRenderStatus, VariationSourceEvidence, is_variation_item_failure,
    render_variation_job_files, render_variation_job_files_with_cancel,
};
#[cfg(feature = "timeline")]
pub use timeline::{
    TimelineFileRenderResult, TimelineFileSource, TimelineRenderOptions, TimelineRenderStatus,
    TimelineRenderedItem, TimelineSourceEvidence, render_timeline_files,
    render_timeline_files_with_cancel,
};

use image::{
    DynamicImage, ImageDecoder, ImageError, ImageReader, Limits as ImageLimits, Rgba, RgbaImage,
    metadata::Orientation,
};
use rayon::prelude::*;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    io::{BufRead, Cursor, Seek},
    time::Instant,
};
use worldbend_core::{
    Bounds, CoordinateSpace, ErrorCode, Homography, PixelSize, Point, Quad, RectifyDiagnostics,
    RectifyPlan, RectifySpec, Size, SolveDiagnostics, TransformError, TransformResult,
    TransformSpec, WarpMesh, WarpVertex, build_warp_mesh, cross, polygon_signed_area,
    rectify_plane, solve_spec,
};

#[cfg(test)]
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::{fs, path::Path};

pub const DEFAULT_MAX_AXIS: u32 = 8192;
pub const DEFAULT_MAX_PIXELS: u64 = 64 * 1024 * 1024;
pub const DEFAULT_MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
// Hard engine ceilings that no configured RenderLimits may exceed. Without
// them a caller-supplied `u32::MAX`/`u64::MAX` limit set can pass the
// per-request checks and die inside the allocator instead of returning a
// stable error. The configurable values may narrow these product ceilings;
// they do not turn the unisolated library/CLI path into an unbounded renderer.
pub const ABSOLUTE_MAX_AXIS: u32 = DEFAULT_MAX_AXIS;
pub const ABSOLUTE_MAX_PIXELS: u64 = DEFAULT_MAX_PIXELS;
pub const ABSOLUTE_MAX_SOURCE_BYTES: u64 = DEFAULT_MAX_SOURCE_BYTES;

// JSON numbers above 2^53 - 1 cannot be represented exactly by JavaScript.
// Keep the output byte count portable without turning this transport-exactness
// ceiling into a raster resource limit.
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn positive_u32_output_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 1,
        "maximum": u32::MAX
    })
}

fn json_safe_u64_output_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SamplingQuality {
    Preview,
    #[default]
    Standard,
    High,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CanvasMode {
    #[default]
    Tight,
    Reference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RenderLimits {
    pub max_width: u32,
    pub max_height: u32,
    pub max_pixels: u64,
    pub max_source_bytes: u64,
}

impl Default for RenderLimits {
    fn default() -> Self {
        Self {
            max_width: DEFAULT_MAX_AXIS,
            max_height: DEFAULT_MAX_AXIS,
            max_pixels: DEFAULT_MAX_PIXELS,
            max_source_bytes: DEFAULT_MAX_SOURCE_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub canvas: CanvasMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_size: Option<Size>,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            canvas: CanvasMode::Tight,
            target_size: None,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RectifyRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for RectifyRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasPlacement {
    pub origin: Point,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RenderDiagnostics {
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub source_width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub source_height: u32,
    pub placement: CanvasPlacement,
    pub destination_bounds: Bounds,
    pub quality: SamplingQuality,
    pub canvas: CanvasMode,
    pub solve: SolveDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RectifyRenderDiagnostics {
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub source_width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub source_height: u32,
    pub output: PixelSize,
    pub quality: SamplingQuality,
    pub rectify: RectifyDiagnostics,
}

/// Wire-compatible status values for [`FileRenderResult`]; an enum instead of
/// a free-form string so the variants are exhaustive at the type level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FileRenderStatus {
    Ready,
    Written,
}

#[derive(Debug)]
pub struct RenderedImage {
    pub image: RgbaImage,
    pub diagnostics: RenderDiagnostics,
}

#[derive(Debug)]
pub struct RectifiedImage {
    pub image: RgbaImage,
    pub plan: RectifyPlan,
    pub diagnostics: RectifyRenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_output_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub diagnostics: RenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RectifyFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_output_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub plan: RectifyPlan,
    pub diagnostics: RectifyRenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RenderEvidence {
    pub source_sha256: String,
    pub output_sha256: String,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub output_width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub output_height: u32,
    pub output_format: String,
    pub solve_ms: f64,
    pub decode_ms: f64,
    pub render_ms: f64,
    pub encode_ms: f64,
    pub total_ms: f64,
    pub warnings: Vec<String>,
}

pub(crate) struct RenderExecution {
    pub(crate) rendered: RenderedImage,
    pub(crate) solve_ms: f64,
    pub(crate) render_ms: f64,
}

pub(crate) struct RectifyRenderExecution {
    pub(crate) rendered: RectifiedImage,
    pub(crate) solve_ms: f64,
    pub(crate) render_ms: f64,
}

pub fn decode_image_with_limits(
    bytes: &[u8],
    limits: RenderLimits,
) -> TransformResult<DynamicImage> {
    validate_limits(limits)?;
    if bytes.len() as u64 > limits.max_source_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded source exceeds configured byte limit",
        )
        .with_details(json!({
            "sourceBytes": bytes.len(),
            "maximum": limits.max_source_bytes,
        })));
    }
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| {
            TransformError::new(
                ErrorCode::UnsupportedMedia,
                "source raster format is not recognized",
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?;
    if reader.format().is_none() {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source raster format is not recognized",
        ));
    }
    let (image, _orientation_applied) = decode_reader_with_limits(reader, limits)?;
    Ok(image)
}

fn decode_reader_with_limits<R>(
    mut reader: ImageReader<R>,
    limits: RenderLimits,
) -> TransformResult<(DynamicImage, bool)>
where
    R: BufRead + Seek,
{
    validate_limits(limits)?;
    let max_alloc = limits.max_pixels.saturating_mul(16).min(1024 * 1024 * 1024);
    let maximum_axis = limits.max_width.max(limits.max_height);
    let mut image_limits = ImageLimits::default();
    // EXIF rotation can swap axes. Enforce the exact asymmetric limit after
    // reading orientation, before allocating decoded pixels.
    image_limits.max_image_width = Some(maximum_axis);
    image_limits.max_image_height = Some(maximum_axis);
    image_limits.max_alloc = Some(max_alloc);
    reader.limits(image_limits);

    let mut decoder = reader.into_decoder().map_err(map_decode_error)?;
    let raw_dimensions = decoder.dimensions();
    let orientation = decoder.orientation().map_err(map_decode_error)?;
    let dimensions = oriented_dimensions(raw_dimensions, orientation);
    validate_source_dimensions(dimensions.0, dimensions.1, limits)?;
    if decoder.total_bytes() > max_alloc {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "source raster exceeds configured decode allocation",
        )
        .with_details(json!({
            "decodedBytes": decoder.total_bytes(),
            "maximum": max_alloc,
        })));
    }

    let mut image = DynamicImage::from_decoder(decoder).map_err(map_decode_error)?;
    image.apply_orientation(orientation);
    // A decoder/EXIF mismatch would silently render the wrong crop in release
    // builds, so it is a stable error rather than a debug-only assertion.
    if (image.width(), image.height()) != dimensions {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "decoded dimensions do not match the orientation-aware dimensions",
        )
        .with_details(json!({
            "decoded": { "width": image.width(), "height": image.height() },
            "expected": { "width": dimensions.0, "height": dimensions.1 },
        })));
    }
    Ok((
        image,
        !matches!(orientation, image::metadata::Orientation::NoTransforms),
    ))
}

fn oriented_dimensions(dimensions: (u32, u32), orientation: Orientation) -> (u32, u32) {
    match orientation {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => (dimensions.1, dimensions.0),
        Orientation::NoTransforms
        | Orientation::Rotate180
        | Orientation::FlipHorizontal
        | Orientation::FlipVertical => dimensions,
    }
}

fn map_decode_error(error: ImageError) -> TransformError {
    let code = if matches!(error, ImageError::Limits(_)) {
        ErrorCode::OutputLimit
    } else {
        ErrorCode::UnsupportedMedia
    };
    let message = if code == ErrorCode::OutputLimit {
        "source raster exceeds configured decode limits"
    } else {
        "source must be a decodable PNG, JPEG, or WebP raster image"
    };
    TransformError::new(code, message).with_details(json!({ "reason": error.to_string() }))
}

fn validate_source_dimensions(
    width: u32,
    height: u32,
    limits: RenderLimits,
) -> TransformResult<()> {
    if width == 0 || height == 0 {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source image dimensions must be greater than zero",
        ));
    }
    let pixels = u64::from(width) * u64::from(height);
    if width > limits.max_width || height > limits.max_height || pixels > limits.max_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "decoded source exceeds configured dimensions",
        )
        .with_details(json!({
            "width": width,
            "height": height,
            "pixels": pixels,
            "limits": limits,
        })));
    }
    Ok(())
}

pub fn render_image(
    source: &DynamicImage,
    spec: &TransformSpec,
    options: RenderOptions,
) -> TransformResult<RenderedImage> {
    render_image_with_cancel(source, spec, options, &|| false)
}

/// [`render_image`] with a cooperative cancellation checkpoint. The render
/// polls the predicate once per pixel row and stops with `E_CANCELLED`; rows
/// already in flight finish before the error surfaces.
pub fn render_image_with_cancel(
    source: &DynamicImage,
    spec: &TransformSpec,
    options: RenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedImage> {
    Ok(render_rgba_image(source.to_rgba8(), spec, options, is_cancelled)?.rendered)
}

pub(crate) fn render_rgba_image_with_cancel(
    source: &RgbaImage,
    spec: &TransformSpec,
    options: RenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedImage> {
    Ok(render_rgba_image(source.clone(), spec, options, is_cancelled)?.rendered)
}

pub fn rectify_image(
    source: &DynamicImage,
    spec: &RectifySpec,
    options: RectifyRenderOptions,
) -> TransformResult<RectifiedImage> {
    rectify_image_with_cancel(source, spec, options, &|| false)
}

/// Deterministically flatten one explicit source quadrilateral into the
/// declared output rectangle. Plane detection and output-size inference are
/// deliberately outside this operation.
pub fn rectify_image_with_cancel(
    source: &DynamicImage,
    spec: &RectifySpec,
    options: RectifyRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RectifiedImage> {
    Ok(rectify_rgba_image(source.to_rgba8(), spec, options, is_cancelled)?.rendered)
}

fn cancelled_error() -> TransformError {
    TransformError::new(ErrorCode::Cancelled, "render was cancelled")
}

pub(crate) fn validate_limits(limits: RenderLimits) -> TransformResult<()> {
    if limits.max_width == 0
        || limits.max_height == 0
        || limits.max_pixels == 0
        || limits.max_width > ABSOLUTE_MAX_AXIS
        || limits.max_height > ABSOLUTE_MAX_AXIS
        || limits.max_pixels > ABSOLUTE_MAX_PIXELS
        || limits.max_source_bytes == 0
        || limits.max_source_bytes > ABSOLUTE_MAX_SOURCE_BYTES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "configured render limits exceed the engine ceiling",
        )
        .with_details(json!({
            "maximumAxis": ABSOLUTE_MAX_AXIS,
            "maximumPixels": ABSOLUTE_MAX_PIXELS,
            "maximumSourceBytes": ABSOLUTE_MAX_SOURCE_BYTES,
            "configured": limits,
        })));
    }
    Ok(())
}

pub(crate) fn render_rgba_image(
    source: RgbaImage,
    spec: &TransformSpec,
    options: RenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderExecution> {
    render_rgba_image_with_mesh(source, spec, options, None, is_cancelled)
}

#[cfg(feature = "deform")]
pub(crate) fn render_rgba_image_with_custom_mesh(
    source: RgbaImage,
    spec: &TransformSpec,
    options: RenderOptions,
    mesh: WarpMesh,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderExecution> {
    render_rgba_image_with_mesh(source, spec, options, Some(mesh), is_cancelled)
}

fn render_rgba_image_with_mesh(
    source: RgbaImage,
    spec: &TransformSpec,
    options: RenderOptions,
    mesh: Option<WarpMesh>,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderExecution> {
    validate_limits(options.limits)?;
    validate_render_target(spec, options.target_size)?;
    validate_source_dimensions(source.width(), source.height(), options.limits)?;

    let solve_started = Instant::now();
    let solved = solve_spec(spec, options.target_size)?;
    let solve_ms = solve_started.elapsed().as_secs_f64() * 1000.0;
    let placement = plan_canvas(
        solved.diagnostics.bounds,
        solved.resolved_destination.reference,
        options.canvas,
        options.limits,
    )?;

    let source_width = source.width();
    let source_height = source.height();
    let warp = WarpSampler::new(match mesh {
        Some(mesh) => Some(mesh),
        None => spec
            .content
            .warp
            .filter(|warp| warp.amount != 0.0)
            .map(|warp| build_warp_mesh(Some(warp)))
            .transpose()?,
    })?;
    let (output, render_ms) = render_pixels(
        source,
        &solved.homography,
        solved.resolved_destination.quad,
        placement,
        warp,
        options.quality,
        is_cancelled,
    )?;

    Ok(RenderExecution {
        rendered: RenderedImage {
            image: output,
            diagnostics: RenderDiagnostics {
                source_width,
                source_height,
                placement,
                destination_bounds: solved.diagnostics.bounds,
                quality: options.quality,
                canvas: options.canvas,
                solve: solved.diagnostics,
            },
        },
        solve_ms,
        render_ms,
    })
}

pub(crate) fn rectify_rgba_image(
    source: RgbaImage,
    spec: &RectifySpec,
    options: RectifyRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RectifyRenderExecution> {
    validate_limits(options.limits)?;
    validate_source_dimensions(source.width(), source.height(), options.limits)?;
    let output_pixels = u64::from(spec.output.width) * u64::from(spec.output.height);
    if spec.output.width > options.limits.max_width
        || spec.output.height > options.limits.max_height
        || output_pixels > options.limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "rectification output exceeds configured limits",
        )
        .with_details(json!({
            "width": spec.output.width,
            "height": spec.output.height,
            "pixels": output_pixels,
            "limits": options.limits,
        })));
    }

    let solve_started = Instant::now();
    let plan = rectify_plane(spec)?;
    let solve_ms = solve_started.elapsed().as_secs_f64() * 1000.0;
    let placement = CanvasPlacement {
        origin: Point::new(0.0, 0.0),
        width: spec.output.width,
        height: spec.output.height,
    };
    let source_width = source.width();
    let source_height = source.height();
    let warp = WarpSampler::new(None)?;
    let (image, render_ms) = render_pixels(
        source,
        &plan.homography,
        plan.output_quad,
        placement,
        warp,
        options.quality,
        is_cancelled,
    )?;
    let diagnostics = RectifyRenderDiagnostics {
        source_width,
        source_height,
        output: spec.output,
        quality: options.quality,
        rectify: plan.diagnostics.clone(),
    };
    Ok(RectifyRenderExecution {
        rendered: RectifiedImage {
            image,
            plan,
            diagnostics,
        },
        solve_ms,
        render_ms,
    })
}

fn render_pixels(
    source: RgbaImage,
    homography: &Homography,
    destination: Quad,
    placement: CanvasPlacement,
    warp: WarpSampler,
    quality: SamplingQuality,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<(RgbaImage, f64)> {
    let source_width = source.width();
    let source_height = source.height();
    let render_started = Instant::now();
    let use_mipmaps = quality != SamplingQuality::Preview
        && (warp.is_active()
            || mapping_requires_mipmaps(homography, destination, source_width, source_height)?);
    // Cap the pyramid at the deepest level any pixel can request. The bound
    // below is a conservative upper envelope of the per-pixel footprint, so
    // the sampler's lod clamp can never engage differently than with a full
    // pyramid and the output stays byte-identical while skipping up to a
    // dozen full-image downsample passes on magnifying renders.
    let maximum_levels = if use_mipmaps {
        let lod_bound =
            conservative_maximum_lod(homography, destination, &warp, source_width, source_height);
        if lod_bound.is_finite() {
            (lod_bound.ceil() as usize).saturating_add(1)
        } else {
            usize::MAX
        }
    } else {
        1
    };
    let source = MipPyramid::new(source, use_mipmaps, maximum_levels);
    let mut output = RgbaImage::new(placement.width, placement.height);
    let mapping = PixelMapping {
        homography,
        warp: &warp,
        destination,
        canvas_origin: placement.origin,
    };
    // Pixels whose unit square cannot overlap the destination quad's
    // bounding box are covered by the initial zeros, so whole row bands and
    // column ranges outside it (plus a one-pixel boundary margin) can skip
    // the coverage classifier entirely and stay byte-identical.
    // render_pixel maps the destination quad into canvas-local coordinates by
    // subtracting `canvas_origin + (x, y)`, so the canvas-space bbox of the
    // quad is `quad - origin`.
    let destination_points = destination.points();
    let quad_min_x = destination_points
        .iter()
        .map(|p| p.x - placement.origin.x)
        .fold(f64::INFINITY, f64::min);
    let quad_max_x = destination_points
        .iter()
        .map(|p| p.x - placement.origin.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let quad_min_y = destination_points
        .iter()
        .map(|p| p.y - placement.origin.y)
        .fold(f64::INFINITY, f64::min);
    let quad_max_y = destination_points
        .iter()
        .map(|p| p.y - placement.origin.y)
        .fold(f64::NEG_INFINITY, f64::max);
    let canvas_height = placement.height as usize;
    let canvas_width = placement.width as usize;
    let row_start = (((quad_min_y - 1.0).floor().max(0.0)) as usize).min(canvas_height);
    let row_end = ((((quad_max_y + 1.0).ceil()) as usize).min(canvas_height)).max(row_start);
    let column_start = (((quad_min_x - 1.0).floor().max(0.0)) as usize).min(canvas_width);
    let column_end = ((((quad_max_x + 1.0).ceil()) as usize).min(canvas_width)).max(column_start);
    let column_count = column_end - column_start;
    let row_stride = usize::try_from(placement.width)
        .expect("u32 image width fits usize")
        .saturating_mul(4);
    output
        .as_mut()
        .par_chunks_mut(row_stride)
        .enumerate()
        .try_for_each(|(y, row)| -> TransformResult<()> {
            if y < row_start || y >= row_end {
                return Ok(());
            }
            if is_cancelled() {
                return Err(cancelled_error());
            }
            let mut projector = InversePixelProjector::new(
                mapping.homography,
                Point::new(
                    mapping.canvas_origin.x + column_start as f64,
                    mapping.canvas_origin.y + y as f64,
                ),
            );
            // Slice the covered span before chunking so the inner loop keeps
            // the same shape (and bounds-check elimination) as an unculled
            // render.
            let row = &mut row[column_start * 4..(column_start + column_count) * 4];
            for (x, pixel_bytes) in row.chunks_exact_mut(4).enumerate() {
                let pixel = render_pixel(
                    &source,
                    &mapping,
                    &projector,
                    u32::try_from(x + column_start).expect("row width came from u32"),
                    u32::try_from(y).expect("image height came from u32"),
                    quality,
                )?;
                pixel_bytes.copy_from_slice(&pixel.0);
                projector.advance_x();
            }
            Ok(())
        })?;
    let render_ms = render_started.elapsed().as_secs_f64() * 1000.0;
    Ok((output, render_ms))
}

fn validate_render_target(spec: &TransformSpec, target_size: Option<Size>) -> TransformResult<()> {
    if spec.destination.space == CoordinateSpace::Normalized && target_size.is_none() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "normalized raster rendering requires targetSize",
        ));
    }
    Ok(())
}

pub(crate) fn plan_canvas(
    bounds: Bounds,
    reference: Size,
    canvas: CanvasMode,
    limits: RenderLimits,
) -> TransformResult<CanvasPlacement> {
    let (origin_x, origin_y, width, height) = match canvas {
        CanvasMode::Tight => {
            let left = bounds.x.floor();
            let top = bounds.y.floor();
            let right = (bounds.x + bounds.width).ceil();
            let bottom = (bounds.y + bounds.height).ceil();
            (left, top, right - left, bottom - top)
        }
        CanvasMode::Reference => (0.0, 0.0, reference.width.ceil(), reference.height.ceil()),
    };
    if !origin_x.is_finite()
        || !origin_y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || width > f64::from(u32::MAX)
        || height > f64::from(u32::MAX)
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "render canvas is empty, non-finite, or not representable",
        ));
    }
    let width = width as u32;
    let height = height as u32;
    let pixels = u64::from(width) * u64::from(height);
    if width > limits.max_width || height > limits.max_height || pixels > limits.max_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "render canvas exceeds configured output limits",
        )
        .with_details(json!({
            "width": width,
            "height": height,
            "pixels": pixels,
            "limits": limits,
        })));
    }
    Ok(CanvasPlacement {
        origin: Point::new(origin_x, origin_y),
        width,
        height,
    })
}

struct MipPyramid {
    levels: Vec<RgbaImage>,
}

pub(crate) trait PremultipliedPyramid: Sync {
    fn base_width(&self) -> u32;
    fn base_height(&self) -> u32;
    fn sample(&self, uv: Point, quality: SamplingQuality, lod: f64) -> [f64; 4];
}

impl MipPyramid {
    /// `maximum_levels` caps pyramid depth at the deepest level any pixel can
    /// sample (see `conservative_maximum_lod`); `usize::MAX` builds the full
    /// pyramid down to 1x1.
    fn new(source: RgbaImage, build_levels: bool, maximum_levels: usize) -> Self {
        let mut levels = vec![source];
        if build_levels {
            while levels.len() < maximum_levels.max(1)
                && levels
                    .last()
                    .is_some_and(|level| level.width() > 1 || level.height() > 1)
            {
                let next = downsample_mip(levels.last().expect("level zero always exists"));
                levels.push(next);
            }
        }
        Self { levels }
    }

    fn base(&self) -> &RgbaImage {
        &self.levels[0]
    }
}

impl PremultipliedPyramid for MipPyramid {
    fn base_width(&self) -> u32 {
        self.base().width()
    }

    fn base_height(&self) -> u32 {
        self.base().height()
    }

    fn sample(&self, uv: Point, quality: SamplingQuality, lod: f64) -> [f64; 4] {
        sample_mipmapped(self, uv, quality, lod)
    }
}

fn downsample_mip(source: &RgbaImage) -> RgbaImage {
    let width = source.width().div_ceil(2).max(1);
    let height = source.height().div_ceil(2).max(1);
    RgbaImage::from_fn(width, height, |x, y| {
        let mut accumulated = [0.0; 4];
        let mut count = 0.0;
        for source_y in (y * 2)..=(y * 2 + 1).min(source.height() - 1) {
            for source_x in (x * 2)..=(x * 2 + 1).min(source.width() - 1) {
                add_weighted(
                    &mut accumulated,
                    sample_premultiplied(source, i64::from(source_x), i64::from(source_y)),
                    1.0,
                );
                count += 1.0;
            }
        }
        for channel in &mut accumulated {
            *channel /= count;
        }
        straight_alpha(accumulated)
    })
}

/// Conservative upper envelope of the per-pixel source footprint over the
/// whole destination quad, used only to bound mip pyramid depth. Every factor
/// is an upper bound (denominator floored at its smallest corner magnitude,
/// Jacobian entries at their largest absolute triangle value), so the true
/// per-pixel lod can never exceed it and capped pyramids render
/// byte-identically to full ones. A non-finite bound means "build everything".
fn conservative_maximum_lod(
    homography: &Homography,
    destination: Quad,
    warp: &WarpSampler,
    source_width: u32,
    source_height: u32,
) -> f64 {
    let matrix = homography.inverse;
    let points = destination.points();
    let min_abs_w = points
        .iter()
        .map(|p| (matrix[6] * p.x + matrix[7] * p.y + matrix[8]).abs())
        .fold(f64::INFINITY, f64::min);
    if !min_abs_w.is_finite() {
        return f64::INFINITY;
    }
    let w_floor = min_abs_w.max(f64::MIN_POSITIVE);
    // Inside the validated destination quad the inverse projection's u/v are
    // each in [0,1]. From du/dx=(a-g*u)/w (and its three siblings), these are
    // true coordinate-translation-independent upper bounds. Multiplying g/h
    // by absolute destination x/y underestimates narrow translated quads and
    // is not conservative.
    let dwx_dx = (matrix[0].abs() + matrix[6].abs()) / w_floor;
    let dwx_dy = (matrix[1].abs() + matrix[7].abs()) / w_floor;
    let dwy_dx = (matrix[3].abs() + matrix[6].abs()) / w_floor;
    let dwy_dy = (matrix[4].abs() + matrix[7].abs()) / w_floor;
    let (j0, j1, j2, j3) = warp.maximum_jacobian();
    let width = f64::from(source_width);
    let height = f64::from(source_height);
    let du_dx = (j0 + j1) * dwx_dx.max(dwy_dx);
    let dv_dx = (j2 + j3) * dwx_dx.max(dwy_dx);
    let du_dy = (j0 + j1) * dwx_dy.max(dwy_dy);
    let dv_dy = (j2 + j3) * dwx_dy.max(dwy_dy);
    let footprint_x = (du_dx * width).hypot(dv_dx * height);
    let footprint_y = (du_dy * width).hypot(dv_dy * height);
    let maximum = footprint_x.max(footprint_y);
    if !maximum.is_finite() {
        return f64::INFINITY;
    }
    maximum.max(1.0).log2()
}

fn mapping_requires_mipmaps(
    homography: &Homography,
    quad: Quad,
    source_width: u32,
    source_height: u32,
) -> TransformResult<bool> {
    // A perspective denominator (nonzero H[6]/H[7] against the normalized
    // H[8] = 1) makes the footprint vary inside the quad, and the finite
    // probe set below can miss an interior minification maximum. Any real
    // perspective therefore enables the pyramid; affine renders keep the
    // probe-based decision.
    if homography.matrix[6].hypot(homography.matrix[7]) > 1.0e-9 {
        return Ok(true);
    }
    let points = quad.points();
    let probes = [
        points[0],
        points[1],
        points[2],
        points[3],
        midpoint(points[0], points[1]),
        midpoint(points[1], points[2]),
        midpoint(points[2], points[3]),
        midpoint(points[3], points[0]),
        Point::new(
            points.iter().map(|point| point.x / 4.0).sum(),
            points.iter().map(|point| point.y / 4.0).sum(),
        ),
    ];
    let identity_warp = WarpSampler::new(None)?;
    for probe in probes {
        let (footprint_x, footprint_y) = local_source_footprint(
            homography,
            &identity_warp,
            probe,
            source_width,
            source_height,
        )?;
        if footprint_x.max(footprint_y) > 1.5 {
            return Ok(true);
        }
    }
    Ok(false)
}

fn midpoint(a: Point, b: Point) -> Point {
    Point::new(a.x + (b.x - a.x) * 0.5, a.y + (b.y - a.y) * 0.5)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PixelCoverage {
    Outside,
    Inside,
    Boundary,
}

struct PixelMapping<'a> {
    homography: &'a Homography,
    warp: &'a WarpSampler,
    destination: Quad,
    canvas_origin: Point,
}

#[derive(Clone, Copy)]
struct InversePixelProjector {
    matrix: [f64; 9],
    origin: Point,
    numerator_x: f64,
    numerator_y: f64,
    denominator: f64,
}

impl InversePixelProjector {
    fn new(homography: &Homography, origin: Point) -> Self {
        let matrix = homography.inverse;
        Self {
            matrix,
            origin,
            numerator_x: matrix[0] * origin.x + matrix[1] * origin.y + matrix[2],
            numerator_y: matrix[3] * origin.x + matrix[4] * origin.y + matrix[5],
            denominator: matrix[6] * origin.x + matrix[7] * origin.y + matrix[8],
        }
    }

    fn advance_x(&mut self) {
        self.origin.x += 1.0;
        self.numerator_x += self.matrix[0];
        self.numerator_y += self.matrix[3];
        self.denominator += self.matrix[6];
    }

    fn project(&self, local: Point) -> TransformResult<(Point, f64)> {
        let point = Point::new(self.origin.x + local.x, self.origin.y + local.y);
        let w = self.denominator + self.matrix[6] * local.x + self.matrix[7] * local.y;
        let denominator_scale = (self.matrix[6] * point.x).abs()
            + (self.matrix[7] * point.y).abs()
            + self.matrix[8].abs();
        if !w.is_finite()
            || !denominator_scale.is_finite()
            || denominator_scale == 0.0
            || w.abs() <= 1.0e-12 * denominator_scale
        {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "point lies on or too near the projective horizon",
            ));
        }
        let x = (self.numerator_x + self.matrix[0] * local.x + self.matrix[1] * local.y) / w;
        let y = (self.numerator_y + self.matrix[3] * local.x + self.matrix[4] * local.y) / w;
        if !x.is_finite() || !y.is_finite() {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "point projection is not finite",
            ));
        }
        Ok((Point::new(x, y), w))
    }
}

fn render_pixel(
    source: &MipPyramid,
    mapping: &PixelMapping<'_>,
    projector: &InversePixelProjector,
    x: u32,
    y: u32,
    quality: SamplingQuality,
) -> TransformResult<Rgba<u8>> {
    Ok(straight_alpha(render_pixel_premultiplied(
        source, mapping, projector, x, y, quality,
    )?))
}

pub(crate) fn render_pixel_premultiplied<P: PremultipliedPyramid>(
    source: &P,
    mapping: &PixelMapping<'_>,
    projector: &InversePixelProjector,
    x: u32,
    y: u32,
    quality: SamplingQuality,
) -> TransformResult<[f64; 4]> {
    let pixel_origin = Point::new(
        mapping.canvas_origin.x + f64::from(x),
        mapping.canvas_origin.y + f64::from(y),
    );
    let local_quad = mapping
        .destination
        .map(|point| Point::new(point.x - pixel_origin.x, point.y - pixel_origin.y));
    let coverage = classify_pixel_coverage(local_quad);
    if coverage == PixelCoverage::Outside {
        return Ok([0.0; 4]);
    }

    let (coverage_fraction, representative) = match coverage {
        PixelCoverage::Inside => (1.0, Point::new(0.5, 0.5)),
        PixelCoverage::Boundary => {
            let clipped = clip_quad_to_unit_pixel(local_quad);
            let area = polygon_signed_area(clipped.as_slice())
                .abs()
                .clamp(0.0, 1.0);
            if area <= f64::EPSILON {
                return Ok([0.0; 4]);
            }
            (area, polygon_centroid(clipped.as_slice()))
        }
        PixelCoverage::Outside => unreachable!("handled above"),
    };
    let (footprint_x, footprint_y) = local_source_footprint_projected(
        projector,
        mapping.warp,
        representative,
        source.base_width(),
        source.base_height(),
    )?;
    let maximum_axis_samples = match quality {
        SamplingQuality::Preview => 1,
        SamplingQuality::Standard => 2,
        SamplingQuality::High => 4,
    };
    let mut samples_x = sampling_axis_count(footprint_x, maximum_axis_samples);
    let mut samples_y = sampling_axis_count(footprint_y, maximum_axis_samples);
    if coverage == PixelCoverage::Boundary && quality != SamplingQuality::Preview {
        samples_x = samples_x.max(2);
        samples_y = samples_y.max(2);
    }
    let lod = if quality == SamplingQuality::Preview {
        0.0
    } else {
        let residual_x = footprint_x / f64::from(samples_x);
        let residual_y = footprint_y / f64::from(samples_y);
        residual_x.max(residual_y).log2().max(0.0)
    };

    let mut accumulated = [0.0; 4];
    let mut contributing = 0_u32;
    for sample_y in 0..samples_y {
        for sample_x in 0..samples_x {
            let local = Point::new(
                (f64::from(sample_x) + 0.5) / f64::from(samples_x),
                (f64::from(sample_y) + 0.5) / f64::from(samples_y),
            );
            // Convexity makes every sub-sample of an Inside pixel valid. Only
            // boundary pixels need the per-sample half-plane test.
            if coverage == PixelCoverage::Boundary && !point_in_convex_quad(local_quad, local) {
                continue;
            }
            if let Some(sample_value) =
                sample_projected_destination(source, mapping.warp, projector, local, quality, lod)?
            {
                add_weighted(&mut accumulated, sample_value, 1.0);
                contributing += 1;
            }
        }
    }

    // A sub-pixel quad can fall between every bounded grid point. Its exact
    // clipped area is still non-zero, so sample its centroid instead of
    // disappearing entirely.
    if contributing == 0 {
        if let Some(sample_value) = sample_projected_destination(
            source,
            mapping.warp,
            projector,
            representative,
            quality,
            lod,
        )? {
            accumulated = sample_value;
            contributing = 1;
        } else {
            return Ok([0.0; 4]);
        }
    }

    let scale = coverage_fraction / f64::from(contributing);
    for channel in &mut accumulated {
        *channel *= scale;
    }
    Ok(accumulated)
}

fn sample_projected_destination<P: PremultipliedPyramid>(
    source: &P,
    warp: &WarpSampler,
    projector: &InversePixelProjector,
    local: Point,
    quality: SamplingQuality,
    lod: f64,
) -> TransformResult<Option<[f64; 4]>> {
    let Some(uv) = source_point_at_projected(projector, warp, local)? else {
        return Ok(None);
    };
    if uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 {
        return Ok(None);
    }
    Ok(Some(source.sample(uv, quality, lod)))
}

fn sample_mipmapped(
    source: &MipPyramid,
    uv: Point,
    quality: SamplingQuality,
    lod: f64,
) -> [f64; 4] {
    let maximum_level = source.levels.len() - 1;
    let level = lod.clamp(0.0, maximum_level as f64);
    let lower = level.floor() as usize;
    let upper = level.ceil() as usize;
    let fraction = level - lower as f64;
    let lower_sample = sample_filtered_premultiplied(&source.levels[lower], uv, quality);
    if upper == lower {
        return lower_sample;
    }
    let upper_sample = sample_filtered_premultiplied(&source.levels[upper], uv, quality);
    let mut result = [0.0; 4];
    for index in 0..4 {
        result[index] = lower_sample[index] * (1.0 - fraction) + upper_sample[index] * fraction;
    }
    result
}

fn rgba_to_premultiplied(pixel: Rgba<u8>) -> [f64; 4] {
    const BYTE_TO_UNIT: f64 = 1.0 / 255.0;
    let alpha = f64::from(pixel.0[3]) * BYTE_TO_UNIT;
    [
        f64::from(pixel.0[0]) * BYTE_TO_UNIT * alpha,
        f64::from(pixel.0[1]) * BYTE_TO_UNIT * alpha,
        f64::from(pixel.0[2]) * BYTE_TO_UNIT * alpha,
        alpha,
    ]
}

fn local_source_footprint(
    homography: &Homography,
    warp: &WarpSampler,
    destination: Point,
    source_width: u32,
    source_height: u32,
) -> TransformResult<(f64, f64)> {
    let projector = InversePixelProjector::new(homography, destination);
    local_source_footprint_projected(
        &projector,
        warp,
        Point::new(0.0, 0.0),
        source_width,
        source_height,
    )
}

fn local_source_footprint_projected(
    projector: &InversePixelProjector,
    warp: &WarpSampler,
    local: Point,
    source_width: u32,
    source_height: u32,
) -> TransformResult<(f64, f64)> {
    let (warped, w) = projector.project(local)?;
    if warp.is_active() {
        if warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0 {
            return Ok((1.0, 1.0));
        };
        let Some((_, warp_jacobian)) = warp.source_at_with_jacobian(warped) else {
            return Ok((1.0, 1.0));
        };
        let matrix = projector.matrix;
        let dwx_dx = (matrix[0] - warped.x * matrix[6]) / w;
        let dwx_dy = (matrix[1] - warped.x * matrix[7]) / w;
        let dwy_dx = (matrix[3] - warped.y * matrix[6]) / w;
        let dwy_dy = (matrix[4] - warped.y * matrix[7]) / w;
        let du_dx = warp_jacobian[0] * dwx_dx + warp_jacobian[1] * dwy_dx;
        let du_dy = warp_jacobian[0] * dwx_dy + warp_jacobian[1] * dwy_dy;
        let dv_dx = warp_jacobian[2] * dwx_dx + warp_jacobian[3] * dwy_dx;
        let dv_dy = warp_jacobian[2] * dwx_dy + warp_jacobian[3] * dwy_dy;
        let width = f64::from(source_width);
        let height = f64::from(source_height);
        let footprint_x = (du_dx * width).hypot(dv_dx * height);
        let footprint_y = (du_dy * width).hypot(dv_dy * height);
        if !footprint_x.is_finite() || !footprint_y.is_finite() {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "warped source sampling footprint is not finite",
            ));
        }
        return Ok((footprint_x.max(1.0e-9), footprint_y.max(1.0e-9)));
    }
    let matrix = projector.matrix;
    let du_dx = (matrix[0] - warped.x * matrix[6]) / w;
    let du_dy = (matrix[1] - warped.x * matrix[7]) / w;
    let dv_dx = (matrix[3] - warped.y * matrix[6]) / w;
    let dv_dy = (matrix[4] - warped.y * matrix[7]) / w;
    let width = f64::from(source_width);
    let height = f64::from(source_height);
    let footprint_x = (du_dx * width).hypot(dv_dx * height);
    let footprint_y = (du_dy * width).hypot(dv_dy * height);
    if !footprint_x.is_finite() || !footprint_y.is_finite() {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "source sampling footprint is not finite",
        ));
    }
    Ok((footprint_x, footprint_y))
}

fn source_point_at_projected(
    projector: &InversePixelProjector,
    warp: &WarpSampler,
    local: Point,
) -> TransformResult<Option<Point>> {
    let (warped, _) = projector.project(local)?;
    if warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0 {
        return Ok(None);
    }
    Ok(warp.source_at(warped))
}

const WARP_INDEX_BINS: usize = 32;
const BARYCENTRIC_EPSILON: f64 = 1.0e-10;

#[derive(Debug, Clone, Copy)]
struct WarpTriangle {
    vertices: [WarpVertex; 3],
    source_jacobian: [f64; 4],
}

/// Inverts the core-owned piecewise-linear mesh. A fixed spatial index keeps
/// lookup bounded independently of image dimensions; native render and WebGL
/// consume the same vertex topology rather than maintaining preset formulas.
struct WarpSampler {
    triangles: Vec<WarpTriangle>,
    bins: Vec<Vec<usize>>,
    maximum_jacobian: [f64; 4],
}

impl WarpSampler {
    /// Validates the mesh up front so a malformed (for example deserialized)
    /// mesh surfaces a stable schema error instead of an index panic in the
    /// sampling hot loop.
    fn new(mesh: Option<WarpMesh>) -> TransformResult<Self> {
        let Some(mesh) = mesh else {
            return Ok(Self {
                triangles: Vec::new(),
                bins: Vec::new(),
                maximum_jacobian: [0.0; 4],
            });
        };
        mesh.validate()?;
        let side = usize::from(mesh.subdivisions) + 1;
        let vertices = &mesh.vertices;
        let vertex =
            |x: u16, y: u16| -> WarpVertex { vertices[usize::from(y) * side + usize::from(x)] };
        let mut maximum = [0.0_f64; 4];
        let mut triangles = Vec::with_capacity(usize::from(mesh.subdivisions).pow(2) * 2);
        for y in 0..mesh.subdivisions {
            for x in 0..mesh.subdivisions {
                let tl = vertex(x, y);
                let tr = vertex(x + 1, y);
                let br = vertex(x + 1, y + 1);
                let bl = vertex(x, y + 1);
                let first = source_jacobian([tl, tr, br]);
                let second = source_jacobian([tl, br, bl]);
                for jacobian in [first, second] {
                    for (bound, value) in maximum.iter_mut().zip(jacobian) {
                        *bound = bound.max(value.abs());
                    }
                }
                triangles.push(WarpTriangle {
                    vertices: [tl, tr, br],
                    source_jacobian: first,
                });
                triangles.push(WarpTriangle {
                    vertices: [tl, br, bl],
                    source_jacobian: second,
                });
            }
        }
        let mut bins = vec![Vec::new(); WARP_INDEX_BINS * WARP_INDEX_BINS];
        for (index, triangle) in triangles.iter().enumerate() {
            let xs = triangle.vertices.map(|vertex| vertex.warped.x);
            let ys = triangle.vertices.map(|vertex| vertex.warped.y);
            let min_x = bin_coordinate(xs.into_iter().fold(f64::INFINITY, f64::min));
            let max_x = bin_coordinate(xs.into_iter().fold(f64::NEG_INFINITY, f64::max));
            let min_y = bin_coordinate(ys.into_iter().fold(f64::INFINITY, f64::min));
            let max_y = bin_coordinate(ys.into_iter().fold(f64::NEG_INFINITY, f64::max));
            for bin_y in min_y..=max_y {
                for bin_x in min_x..=max_x {
                    bins[bin_y * WARP_INDEX_BINS + bin_x].push(index);
                }
            }
        }
        Ok(Self {
            triangles,
            bins,
            maximum_jacobian: maximum,
        })
    }

    fn is_active(&self) -> bool {
        !self.triangles.is_empty()
    }

    /// Largest absolute Jacobian entries across all triangles; the identity
    /// pair when no warp is active. Used by the mip depth bound only.
    fn maximum_jacobian(&self) -> (f64, f64, f64, f64) {
        if self.is_active() {
            (
                self.maximum_jacobian[0],
                self.maximum_jacobian[1],
                self.maximum_jacobian[2],
                self.maximum_jacobian[3],
            )
        } else {
            (1.0, 0.0, 0.0, 1.0)
        }
    }

    fn source_at(&self, warped: Point) -> Option<Point> {
        self.source_at_with_jacobian(warped)
            .map(|(source, _)| source)
    }

    fn source_at_with_jacobian(&self, warped: Point) -> Option<(Point, [f64; 4])> {
        if !self.is_active() {
            return Some((warped, [1.0, 0.0, 0.0, 1.0]));
        }
        let bin = bin_coordinate(warped.y) * WARP_INDEX_BINS + bin_coordinate(warped.x);
        for &index in &self.bins[bin] {
            let triangle = self.triangles[index];
            if let Some(weights) = barycentric_weights(triangle.vertices.map(|v| v.warped), warped)
            {
                let source = triangle.vertices.map(|v| v.source);
                return Some((
                    Point::new(
                        weights[0] * source[0].x
                            + weights[1] * source[1].x
                            + weights[2] * source[2].x,
                        weights[0] * source[0].y
                            + weights[1] * source[1].y
                            + weights[2] * source[2].y,
                    ),
                    triangle.source_jacobian,
                ));
            }
        }
        None
    }
}

fn source_jacobian(vertices: [WarpVertex; 3]) -> [f64; 4] {
    let [a, b, c] = vertices;
    let wx1 = b.warped.x - a.warped.x;
    let wy1 = b.warped.y - a.warped.y;
    let wx2 = c.warped.x - a.warped.x;
    let wy2 = c.warped.y - a.warped.y;
    let sx1 = b.source.x - a.source.x;
    let sy1 = b.source.y - a.source.y;
    let sx2 = c.source.x - a.source.x;
    let sy2 = c.source.y - a.source.y;
    let inverse_determinant = 1.0 / (wx1 * wy2 - wx2 * wy1);
    [
        (sx1 * wy2 - sx2 * wy1) * inverse_determinant,
        (-sx1 * wx2 + sx2 * wx1) * inverse_determinant,
        (sy1 * wy2 - sy2 * wy1) * inverse_determinant,
        (-sy1 * wx2 + sy2 * wx1) * inverse_determinant,
    ]
}

fn bin_coordinate(value: f64) -> usize {
    (value.clamp(0.0, 1.0) * WARP_INDEX_BINS as f64)
        .floor()
        .min((WARP_INDEX_BINS - 1) as f64) as usize
}

fn barycentric_weights(triangle: [Point; 3], point: Point) -> Option<[f64; 3]> {
    let [a, b, c] = triangle;
    let denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if denominator.abs() <= f64::EPSILON {
        return None;
    }
    let alpha = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
    let beta = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
    let gamma = 1.0 - alpha - beta;
    (alpha >= -BARYCENTRIC_EPSILON && beta >= -BARYCENTRIC_EPSILON && gamma >= -BARYCENTRIC_EPSILON)
        .then_some([alpha, beta, gamma])
}

fn sampling_axis_count(footprint: f64, maximum: u32) -> u32 {
    footprint.ceil().clamp(1.0, f64::from(maximum)) as u32
}

fn classify_pixel_coverage(quad: Quad) -> PixelCoverage {
    let bounds = Bounds::from_quad(quad);
    let min_x = bounds.x;
    let max_x = bounds.x + bounds.width;
    let min_y = bounds.y;
    let max_y = bounds.y + bounds.height;
    if max_x <= 0.0 || min_x >= 1.0 || max_y <= 0.0 || min_y >= 1.0 {
        return PixelCoverage::Outside;
    }

    let square = [
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ];
    for index in 0..4 {
        let a = quad.points()[index];
        let b = quad.points()[(index + 1) % 4];
        if square.iter().all(|point| cross(a, b, *point) < 0.0) {
            return PixelCoverage::Outside;
        }
    }
    if square
        .iter()
        .all(|point| point_in_convex_quad(quad, *point))
    {
        PixelCoverage::Inside
    } else {
        PixelCoverage::Boundary
    }
}

fn point_in_convex_quad(quad: Quad, point: Point) -> bool {
    let points = quad.points();
    (0..4).all(|index| cross(points[index], points[(index + 1) % 4], point) >= 0.0)
}

fn clip_quad_to_unit_pixel(quad: Quad) -> StackPolygon {
    let mut polygon = StackPolygon::from_quad(quad);
    polygon = clip_polygon(
        &polygon,
        |point| point.x >= 0.0,
        |a, b| interpolate_at_x(a, b, 0.0),
    );
    polygon = clip_polygon(
        &polygon,
        |point| point.x <= 1.0,
        |a, b| interpolate_at_x(a, b, 1.0),
    );
    polygon = clip_polygon(
        &polygon,
        |point| point.y >= 0.0,
        |a, b| interpolate_at_y(a, b, 0.0),
    );
    clip_polygon(
        &polygon,
        |point| point.y <= 1.0,
        |a, b| interpolate_at_y(a, b, 1.0),
    )
}

fn clip_polygon(
    polygon: &StackPolygon,
    inside: impl Fn(Point) -> bool,
    intersection: impl Fn(Point, Point) -> Point,
) -> StackPolygon {
    let Some(mut previous) = polygon.as_slice().last().copied() else {
        return StackPolygon::default();
    };
    let mut previous_inside = inside(previous);
    let mut output = StackPolygon::default();
    for &current in polygon.as_slice() {
        let current_inside = inside(current);
        match (previous_inside, current_inside) {
            (true, true) => output.push(current),
            (true, false) => output.push(intersection(previous, current)),
            (false, true) => {
                output.push(intersection(previous, current));
                output.push(current);
            }
            (false, false) => {}
        }
        previous = current;
        previous_inside = current_inside;
    }
    output
}

struct StackPolygon {
    points: [Point; 8],
    len: usize,
}

impl Default for StackPolygon {
    fn default() -> Self {
        Self {
            points: [Point::new(0.0, 0.0); 8],
            len: 0,
        }
    }
}

impl StackPolygon {
    fn from_quad(quad: Quad) -> Self {
        let mut polygon = Self::default();
        for point in quad.points() {
            polygon.push(point);
        }
        polygon
    }

    fn push(&mut self, point: Point) {
        debug_assert!(self.len < self.points.len());
        if self.len < self.points.len() {
            self.points[self.len] = point;
            self.len += 1;
        }
    }

    fn as_slice(&self) -> &[Point] {
        &self.points[..self.len]
    }
}

fn interpolate_at_x(a: Point, b: Point, x: f64) -> Point {
    let fraction = (x - a.x) / (b.x - a.x);
    Point::new(x, a.y + fraction * (b.y - a.y))
}

fn interpolate_at_y(a: Point, b: Point, y: f64) -> Point {
    let fraction = (y - a.y) / (b.y - a.y);
    Point::new(a.x + fraction * (b.x - a.x), y)
}

fn polygon_centroid(polygon: &[Point]) -> Point {
    let mut twice_area = 0.0;
    let mut x = 0.0;
    let mut y = 0.0;
    for index in 0..polygon.len() {
        let current = polygon[index];
        let next = polygon[(index + 1) % polygon.len()];
        let cross = current.x * next.y - next.x * current.y;
        twice_area += cross;
        x += (current.x + next.x) * cross;
        y += (current.y + next.y) * cross;
    }
    if twice_area.abs() <= f64::EPSILON {
        let count = polygon.len() as f64;
        return Point::new(
            polygon.iter().map(|point| point.x).sum::<f64>() / count,
            polygon.iter().map(|point| point.y).sum::<f64>() / count,
        );
    }
    Point::new(x / (3.0 * twice_area), y / (3.0 * twice_area))
}

fn sample_filtered_premultiplied(
    source: &RgbaImage,
    uv: Point,
    quality: SamplingQuality,
) -> [f64; 4] {
    let x = uv.x * f64::from(source.width()) - 0.5;
    let y = uv.y * f64::from(source.height()) - 0.5;
    match quality {
        SamplingQuality::Preview | SamplingQuality::Standard => {
            sample_bilinear_premultiplied(source, x, y)
        }
        SamplingQuality::High => sample_bicubic_premultiplied(source, x, y),
    }
}

fn sample_bilinear_premultiplied(source: &RgbaImage, x: f64, y: f64) -> [f64; 4] {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x.floor();
    let ty = y - y.floor();
    let stride = usize::try_from(source.width()).expect("positive width fits usize");
    let bytes = source.as_raw();
    let height = i64::from(source.height());
    let width = i64::from(source.width());
    let mut rows = [0_usize; 2];
    let mut weights_y = [0.0_f64; 2];
    for (offset, cy) in [y0, y0 + 1].into_iter().enumerate() {
        rows[offset] = (cy.clamp(0, height - 1)) as usize;
        weights_y[offset] = if offset == 0 { 1.0 - ty } else { ty };
    }
    let mut columns = [0_usize; 2];
    let mut weights_x = [0.0_f64; 2];
    for (offset, cx) in [x0, x0 + 1].into_iter().enumerate() {
        columns[offset] = (cx.clamp(0, width - 1)) as usize;
        weights_x[offset] = if offset == 0 { 1.0 - tx } else { tx };
    }
    let mut accum = [0.0; 4];
    for row in 0..2 {
        let row_base = rows[row] * stride * 4;
        let wy = weights_y[row];
        for column in 0..2 {
            let base = row_base + columns[column] * 4;
            add_weighted(
                &mut accum,
                rgba_to_premultiplied(Rgba([
                    bytes[base],
                    bytes[base + 1],
                    bytes[base + 2],
                    bytes[base + 3],
                ])),
                weights_x[column] * wy,
            );
        }
    }
    accum
}

fn sample_bicubic_premultiplied(source: &RgbaImage, x: f64, y: f64) -> [f64; 4] {
    let base_x = x.floor() as i64;
    let base_y = y.floor() as i64;
    // Distances, weights, and clamped tap coordinates are all per-axis: hoist
    // them out of the 4x4 loop. The accumulation sequence (rows -1..=2, then
    // columns, weight_x * weight_y per tap) stays exactly the one the
    // per-tap version used, so output bytes are unchanged.
    let width = i64::from(source.width());
    let height = i64::from(source.height());
    let stride = usize::try_from(source.width()).expect("positive width fits usize");
    let bytes = source.as_raw();
    let mut columns = [0_usize; 4];
    let mut weights_x = [0.0_f64; 4];
    let mut rows = [0_usize; 4];
    let mut weights_y = [0.0_f64; 4];
    for offset in 0..4 {
        let cx = base_x + offset as i64 - 1;
        let cy = base_y + offset as i64 - 1;
        columns[offset] = (cx.clamp(0, width - 1)) as usize;
        rows[offset] = (cy.clamp(0, height - 1)) as usize;
        weights_x[offset] = catmull_rom(x - f64::from(cx as i32));
        weights_y[offset] = catmull_rom(y - f64::from(cy as i32));
    }
    let mut accum = [0.0; 4];
    for row in 0..4 {
        let row_base = rows[row] * stride * 4;
        let weight_y = weights_y[row];
        for column in 0..4 {
            let base = row_base + columns[column] * 4;
            add_weighted(
                &mut accum,
                rgba_to_premultiplied(Rgba([
                    bytes[base],
                    bytes[base + 1],
                    bytes[base + 2],
                    bytes[base + 3],
                ])),
                weights_x[column] * weight_y,
            );
        }
    }
    accum
}

#[cfg(test)]
fn sample_bilinear(source: &RgbaImage, x: f64, y: f64) -> Rgba<u8> {
    straight_alpha(sample_bilinear_premultiplied(source, x, y))
}

fn catmull_rom(distance: f64) -> f64 {
    let x = distance.abs();
    if x <= 1.0 {
        1.5 * x.powi(3) - 2.5 * x.powi(2) + 1.0
    } else if x < 2.0 {
        -0.5 * x.powi(3) + 2.5 * x.powi(2) - 4.0 * x + 2.0
    } else {
        0.0
    }
}

fn sample_premultiplied(source: &RgbaImage, x: i64, y: i64) -> [f64; 4] {
    // Geometry coverage owns transparency outside the mapped plane. Texture
    // filter taps at a valid UV clamp to the nearest edge texel, matching
    // WebGL's CLAMP_TO_EDGE behavior and avoiding a false transparent fringe.
    // Coordinates are clamped before indexing, so the raw slice access is in
    // bounds and skips the checked get_pixel path on the hottest taps.
    let width = i64::from(source.width());
    let height = i64::from(source.height());
    let x = x.clamp(0, width - 1) as usize;
    let y = y.clamp(0, height - 1) as usize;
    let base = (y * width as usize + x) * 4;
    let bytes = source.as_raw();
    rgba_to_premultiplied(Rgba([
        bytes[base],
        bytes[base + 1],
        bytes[base + 2],
        bytes[base + 3],
    ]))
}

fn add_weighted(accum: &mut [f64; 4], sample: [f64; 4], weight: f64) {
    for index in 0..4 {
        accum[index] += sample[index] * weight;
    }
}

fn straight_alpha(premultiplied: [f64; 4]) -> Rgba<u8> {
    let alpha = premultiplied[3].clamp(0.0, 1.0);
    if alpha <= 1.0e-12 {
        return Rgba([0, 0, 0, 0]);
    }
    let channel = |value: f64| ((value / alpha).clamp(0.0, 1.0) * 255.0).round() as u8;
    Rgba([
        channel(premultiplied[0]),
        channel(premultiplied[1]),
        channel(premultiplied[2]),
        (alpha * 255.0).round() as u8,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgb, RgbImage};
    use worldbend_core::{Point, Quad, SourceOrientation, WarpPreset, WarpSpec, build_warp_mesh};

    fn identity_spec(width: u32, height: u32) -> TransformSpec {
        TransformSpec::pixel(
            Size::new(f64::from(width), f64::from(height)),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(f64::from(width), 0.0),
                Point::new(f64::from(width), f64::from(height)),
                Point::new(0.0, f64::from(height)),
            ),
        )
    }

    #[test]
    fn rectification_flattens_only_the_explicit_source_quad() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(4, 4, |x, y| {
            Rgba([(x * 60) as u8, (y * 60) as u8, 17, 255])
        }));
        let selected_right_half = Quad::new(
            Point::new(0.5, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.5, 1.0),
        );
        let spec = RectifySpec::normalized(selected_right_half, PixelSize::new(2, 4));
        let rendered = rectify_image(
            &source,
            &spec,
            RectifyRenderOptions {
                quality: SamplingQuality::Preview,
                ..RectifyRenderOptions::default()
            },
        )
        .unwrap();
        assert_eq!((rendered.image.width(), rendered.image.height()), (2, 4));
        assert_eq!(rendered.image.get_pixel(0, 0).0, [120, 0, 17, 255]);
        assert_eq!(rendered.image.get_pixel(1, 3).0, [180, 180, 17, 255]);
        assert_eq!(
            rendered.plan.output_spec.destination.quad,
            spec.output.quad()
        );
    }

    #[test]
    fn rectification_enforces_output_limits_before_allocation() {
        let source = DynamicImage::new_rgba8(2, 2);
        let spec = RectifySpec::normalized(Quad::unit(), PixelSize::new(11, 10));
        let error = rectify_image(
            &source,
            &spec,
            RectifyRenderOptions {
                limits: RenderLimits {
                    max_width: 10,
                    max_height: 10,
                    max_pixels: 100,
                    max_source_bytes: 1024,
                },
                ..RectifyRenderOptions::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn capped_mip_pyramids_sample_identically_within_the_lod_bound() {
        // The mip depth cap is only sound if the conservative lod bound
        // dominates every level the sampler can request. Verify the lemma
        // directly: with the capped pyramid, sampling at every uv of a dense
        // grid and every lod up to the bound must be byte-identical to
        // sampling the full pyramid.
        let source = RgbaImage::from_fn(64, 48, |x, y| {
            Rgba([
                (x * 5 % 256) as u8,
                (y * 9 % 256) as u8,
                ((x + y) % 256) as u8,
                255,
            ])
        });
        let quads = [
            Quad::unit().map(|p| Point::new(p.x * 0.2 + 0.4, p.y * 0.2 + 0.4)),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(3.0, 0.2),
                Point::new(2.6, 3.0),
                Point::new(-0.2, 2.4),
            ),
        ];
        for quad in quads {
            let (homography, _) = worldbend_core::solve_quad(&quad).unwrap();
            for warp_spec in [
                None,
                Some(worldbend_core::WarpSpec {
                    preset: worldbend_core::WarpPreset::Twist,
                    amount: 0.8,
                }),
            ] {
                let mesh = build_warp_mesh(warp_spec).unwrap();
                let warp = WarpSampler::new(Some(mesh)).unwrap();
                let bound = conservative_maximum_lod(&homography, quad, &warp, 64, 48);
                assert!(bound.is_finite());
                let capped = MipPyramid::new(source.clone(), true, (bound.ceil() as usize) + 1);
                let full = MipPyramid::new(source.clone(), true, usize::MAX);
                for step in 0..=40 {
                    let uv = Point::new(f64::from(step) / 40.0, f64::from(step % 17) / 17.0);
                    for level_step in 0..=(bound.ceil() as i32) {
                        let lod = f64::from(level_step);
                        assert_eq!(
                            sample_mipmapped(&capped, uv, SamplingQuality::High, lod),
                            sample_mipmapped(&full, uv, SamplingQuality::High, lod),
                            "capped sampling diverged at uv {uv:?} lod {lod}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn conservative_mip_bound_dominates_narrow_translated_perspective() {
        // This valid, narrow quad makes the inverse perspective terms much
        // larger than its absolute x coordinates. The former x/y-scaled
        // formula underestimated the true corner footprint by over two orders
        // of magnitude, so it was not a conservative depth bound.
        let quad = Quad::new(
            Point::new(0.001003329478041907, 0.46265395929984293),
            Point::new(0.0013104067985038566, 0.4119207345990257),
            Point::new(0.001150870167918136, 0.5165389089296496),
            Point::new(0.001024978404950061, 0.5975526920927163),
        );
        let (homography, _) = worldbend_core::solve_quad(&quad).unwrap();
        let warp = WarpSampler::new(None).unwrap();
        let bound = conservative_maximum_lod(&homography, quad, &warp, 64, 64);
        let actual = quad
            .points()
            .into_iter()
            .map(|point| {
                let (x, y) = local_source_footprint(&homography, &warp, point, 64, 64).unwrap();
                x.max(y).max(1.0).log2()
            })
            .fold(0.0_f64, f64::max);
        assert!(
            bound >= actual,
            "bound {bound} was below actual lod {actual}"
        );
    }

    #[test]
    fn configured_limits_can_only_narrow_the_engine_ceiling() {
        let excessive_axis = RenderLimits {
            max_width: ABSOLUTE_MAX_AXIS + 1,
            ..RenderLimits::default()
        };
        assert_eq!(
            validate_limits(excessive_axis).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        let excessive_source = RenderLimits {
            max_source_bytes: ABSOLUTE_MAX_SOURCE_BYTES + 1,
            ..RenderLimits::default()
        };
        assert_eq!(
            validate_limits(excessive_source).unwrap_err().code,
            ErrorCode::OutputLimit
        );
    }

    #[test]
    fn render_result_schema_uses_portable_standard_integer_bounds() {
        let schema = serde_json::to_value(schemars::schema_for!(FileRenderResult)).unwrap();
        let definitions = &schema["$defs"];
        let positive_u32_fields = [
            &definitions["CanvasPlacement"]["properties"]["width"],
            &definitions["CanvasPlacement"]["properties"]["height"],
            &definitions["RenderDiagnostics"]["properties"]["sourceWidth"],
            &definitions["RenderDiagnostics"]["properties"]["sourceHeight"],
            &definitions["RenderEvidence"]["properties"]["outputWidth"],
            &definitions["RenderEvidence"]["properties"]["outputHeight"],
        ];
        for field in positive_u32_fields {
            assert_eq!(
                field,
                &json!({
                    "type": "integer",
                    "minimum": 1,
                    "maximum": u32::MAX
                })
            );
        }
        assert_eq!(
            schema["properties"]["bytes"],
            json!({
                "type": "integer",
                "minimum": 0,
                "maximum": MAX_EXACT_JSON_INTEGER
            })
        );
    }

    #[test]
    fn identity_render_preserves_pixels_and_extent() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(2, 2, |x, y| {
            Rgba([(x * 100) as u8, (y * 100) as u8, 200, 255])
        }));
        let rendered =
            render_image(&source, &identity_spec(2, 2), RenderOptions::default()).unwrap();
        assert_eq!(rendered.image, source.to_rgba8());
        assert_eq!(rendered.diagnostics.placement.width, 2);
        assert_eq!(rendered.diagnostics.placement.height, 2);
    }

    #[test]
    fn reference_canvas_culling_keeps_projector_aligned_with_translated_columns() {
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([220, 40, 30, 255])));
        let spec = TransformSpec::pixel(
            Size::new(16.0, 8.0),
            Quad::new(
                Point::new(10.0, 2.0),
                Point::new(12.0, 2.0),
                Point::new(12.0, 4.0),
                Point::new(10.0, 4.0),
            ),
        );
        let rendered = render_image(
            &source,
            &spec,
            RenderOptions {
                canvas: CanvasMode::Reference,
                ..RenderOptions::default()
            },
        )
        .unwrap();
        assert_eq!(rendered.image.dimensions(), (16, 8));
        assert_eq!(*rendered.image.get_pixel(10, 2), Rgba([220, 40, 30, 255]));
        assert_eq!(*rendered.image.get_pixel(0, 2), Rgba([0, 0, 0, 0]));
    }

    #[test]
    fn reference_canvas_returns_transparent_when_destination_is_fully_outside() {
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([220, 40, 30, 255])));
        let spec = TransformSpec::pixel(
            Size::new(16.0, 8.0),
            Quad::new(
                Point::new(20.0, 2.0),
                Point::new(22.0, 2.0),
                Point::new(22.0, 4.0),
                Point::new(20.0, 4.0),
            ),
        );
        let rendered = render_image(
            &source,
            &spec,
            RenderOptions {
                canvas: CanvasMode::Reference,
                ..RenderOptions::default()
            },
        )
        .unwrap();
        assert!(rendered.image.pixels().all(|pixel| pixel.0 == [0, 0, 0, 0]));
    }

    #[test]
    fn incremental_scanline_projection_matches_the_core_inverse_mapping() {
        let spec = TransformSpec::pixel(
            Size::new(100.0, 80.0),
            Quad::new(
                Point::new(7.0, 4.0),
                Point::new(94.0, 11.0),
                Point::new(88.0, 73.0),
                Point::new(3.0, 68.0),
            ),
        );
        let solved = solve_spec(&spec, None).unwrap();
        for y in [0.0, 17.0, 63.0] {
            let mut projector = InversePixelProjector::new(&solved.homography, Point::new(0.0, y));
            for x in 0..96 {
                let local = Point::new(0.37, 0.61);
                let (actual, _) = projector.project(local).unwrap();
                let expected = worldbend_core::inverse_transform_point(
                    &solved.homography,
                    Point::new(f64::from(x) + local.x, y + local.y),
                )
                .unwrap();
                assert!((actual.x - expected.x).abs() < 1.0e-12);
                assert!((actual.y - expected.y).abs() < 1.0e-12);
                projector.advance_x();
            }
        }
    }

    #[test]
    fn every_core_warp_mesh_inverts_at_its_vertices() {
        for preset in [
            WarpPreset::Arc,
            WarpPreset::Arch,
            WarpPreset::Flag,
            WarpPreset::Wave,
            WarpPreset::Fish,
            WarpPreset::Rise,
            WarpPreset::Fisheye,
            WarpPreset::Inflate,
            WarpPreset::Squeeze,
            WarpPreset::Twist,
        ] {
            let mesh = build_warp_mesh(Some(WarpSpec {
                preset,
                amount: 1.0,
            }))
            .unwrap();
            let sampler = WarpSampler::new(Some(mesh.clone())).unwrap();
            for vertex in mesh.vertices {
                let source = sampler.source_at(vertex.warped).unwrap();
                assert!((source.x - vertex.source.x).abs() < 1.0e-8);
                assert!((source.y - vertex.source.y).abs() < 1.0e-8);
            }
        }
    }

    #[test]
    fn arc_warp_changes_interior_pixels_without_moving_the_canvas_boundary() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(33, 33, |_x, y| {
            Rgba([(y * 7) as u8, 80, 160, 255])
        }));
        let plain = render_image(&source, &identity_spec(33, 33), RenderOptions::default())
            .unwrap()
            .image;
        let mut spec = identity_spec(33, 33);
        spec.content.warp = Some(WarpSpec {
            preset: WarpPreset::Arc,
            amount: 1.0,
        });
        let warped = render_image(&source, &spec, RenderOptions::default())
            .unwrap()
            .image;
        assert_eq!((warped.width(), warped.height()), (33, 33));
        assert_ne!(warped.get_pixel(16, 16), plain.get_pixel(16, 16));
        assert_eq!(warped.get_pixel(0, 0).0[3], 255);
        assert_eq!(warped.get_pixel(32, 32).0[3], 255);
    }

    #[test]
    fn zero_warp_is_byte_identical_to_the_unwarped_render() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(17, 13, |x, y| {
            Rgba([(x * 11) as u8, (y * 17) as u8, 90, 255])
        }));
        let plain = render_image(&source, &identity_spec(17, 13), RenderOptions::default())
            .unwrap()
            .image;
        for preset in [WarpPreset::Arc, WarpPreset::Wave, WarpPreset::Twist] {
            let mut spec = identity_spec(17, 13);
            spec.content.warp = Some(WarpSpec {
                preset,
                amount: 0.0,
            });
            let warped = render_image(&source, &spec, RenderOptions::default())
                .unwrap()
                .image;
            assert_eq!(warped, plain);
        }
    }

    #[test]
    fn warp_footprint_probes_do_not_abort_near_the_projective_horizon() {
        // The inverse map's horizon sits exactly at x = 1.5: a footprint probe
        // from a horizon-safe center lands on it. The probe must fall back
        // instead of aborting the whole render; before the fallback existed
        // this returned E_HOMOGRAPHY_HORIZON_CROSSING.
        let homography = Homography {
            matrix: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 2.0 / 3.0, 0.0, 1.0],
            inverse: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, -2.0 / 3.0, 0.0, 1.0],
        };
        let mesh = build_warp_mesh(Some(WarpSpec {
            preset: WarpPreset::Twist,
            amount: 1.0,
        }))
        .unwrap();
        let warp = WarpSampler::new(Some(mesh)).unwrap();
        let (footprint_x, footprint_y) =
            local_source_footprint(&homography, &warp, Point::new(0.5, 0.5), 512, 512).unwrap();
        assert!(footprint_x.is_finite() && footprint_x > 0.0);
        assert!(footprint_y.is_finite() && footprint_y > 0.0);
    }

    #[test]
    fn perspective_quad_with_warp_keeps_canvas_and_diagnostics() {
        // The composite H^-1 -> mesh path under a real perspective
        // homography: the warp changes pixels but must leave the placement
        // and the full solve diagnostics byte-identical.
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(64, 64, |x, y| {
            Rgba([(x * 4) as u8, (y * 4) as u8, 128, 255])
        }));
        let spec = TransformSpec::pixel(
            Size::new(400.0, 300.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(400.0, 0.0),
                Point::new(300.0, 300.0),
                Point::new(100.0, 300.0),
            ),
        );
        let plain = render_image(&source, &spec, RenderOptions::default()).unwrap();
        let warped = render_image(
            &source,
            &{
                let mut warped = spec.clone();
                warped.content.warp = Some(WarpSpec {
                    preset: WarpPreset::Twist,
                    amount: 0.8,
                });
                warped
            },
            RenderOptions::default(),
        )
        .unwrap();
        assert_eq!(
            (plain.image.width(), plain.image.height()),
            (warped.image.width(), warped.image.height())
        );
        assert_eq!(plain.diagnostics, warped.diagnostics);
        let differing = plain
            .image
            .pixels()
            .zip(warped.image.pixels())
            .filter(|(a, b)| a != b)
            .count();
        assert!(differing > 0, "warp changed no pixels under perspective");
    }

    #[test]
    fn warped_minification_stays_mipmap_filtered() {
        // Twist at full strength compresses interior regions; the composite
        // footprint must route them through the mip pyramid instead of
        // aliasing the checkerboard.
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(2048, 2048, |x, y| {
            let value = if (x + y) % 2 == 0 { 0 } else { 255 };
            Rgba([value, value, value, 255])
        }));
        let mut spec = identity_spec(256, 256);
        spec.content.warp = Some(WarpSpec {
            preset: WarpPreset::Twist,
            amount: 1.0,
        });
        let rendered = render_image(&source, &spec, RenderOptions::default()).unwrap();
        let values = rendered
            .image
            .pixels()
            .map(|pixel| u64::from(pixel.0[0]))
            .collect::<Vec<_>>();
        let mean = values.iter().sum::<u64>() as f64 / values.len() as f64;
        assert!(
            (126.0..=130.0).contains(&mean),
            "warped checker mean was {mean}"
        );
        assert!(values.iter().all(|value| (120..=136).contains(value)));
    }

    #[test]
    fn negative_warp_amount_reverses_direction() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(48, 48, |x, y| {
            Rgba([(x * 5) as u8, (y * 5) as u8, 200, 255])
        }));
        let mut spec = identity_spec(48, 48);
        let mut render_with = |amount: f64| {
            spec.content.warp = Some(WarpSpec {
                preset: WarpPreset::Twist,
                amount,
            });
            render_image(&source, &spec, RenderOptions::default())
                .unwrap()
                .image
        };
        let positive = render_with(1.0);
        let negative = render_with(-1.0);
        assert_ne!(
            positive.get_pixel(24, 12),
            negative.get_pixel(24, 12),
            "twist +1 and -1 must rotate in opposite directions"
        );
        assert_eq!(positive.get_pixel(0, 0), negative.get_pixel(0, 0));
    }

    #[test]
    fn flipped_orientation_mirrors_source_pixels() {
        // A 2x1 source with distinct left/right halves: flipHorizontal must
        // swap them inside the unchanged destination quad.
        let source = DynamicImage::ImageRgba8(
            RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 0, 0, 255, 255]).unwrap(),
        );
        let mut spec = identity_spec(2, 1);
        spec.content.orientation = SourceOrientation::FlipHorizontal;
        let rendered = render_image(&source, &spec, RenderOptions::default()).unwrap();
        assert_eq!(rendered.image.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(rendered.image.get_pixel(1, 0).0, [255, 0, 0, 255]);

        let mut vertical = identity_spec(1, 2);
        vertical.content.orientation = SourceOrientation::FlipVertical;
        let tall = DynamicImage::ImageRgba8(
            RgbaImage::from_raw(1, 2, vec![255, 0, 0, 255, 0, 0, 255, 255]).unwrap(),
        );
        let rendered = render_image(&tall, &vertical, RenderOptions::default()).unwrap();
        assert_eq!(rendered.image.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(rendered.image.get_pixel(0, 1).0, [255, 0, 0, 255]);
    }

    #[test]
    fn premultiplied_filter_avoids_dark_transparent_fringe() {
        let source = RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 0, 0, 0, 0]).unwrap();
        let pixel = sample_bilinear(&source, 0.5, 0.0);
        assert_eq!(pixel.0[0], 255);
        assert!((127..=128).contains(&pixel.0[3]));
    }

    #[test]
    fn edge_filtering_clamps_valid_uv_taps() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([17, 34, 51, 255])));
        let rendered = render_image(&source, &identity_spec(8, 8), RenderOptions::default())
            .unwrap()
            .image;
        assert!(rendered.pixels().all(|pixel| pixel.0 == [17, 34, 51, 255]));
    }

    #[test]
    fn coverage_prevents_horizon_failures_outside_the_quad() {
        let destination = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(30.0 / 13.0, 0.0),
            Point::new(30.0 / 23.0, 30.0 / 23.0),
            Point::new(0.0, 30.0 / 13.0),
        );
        let spec = TransformSpec::pixel(Size::new(3.0, 3.0), destination);
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 3, Rgba([255, 0, 0, 255])));
        let rendered = render_image(&source, &spec, RenderOptions::default()).unwrap();
        assert_eq!((rendered.image.width(), rendered.image.height()), (3, 3));
        assert_eq!(rendered.image.get_pixel(2, 2).0, [0, 0, 0, 0]);
        assert!(rendered.image.pixels().any(|pixel| pixel.0[3] > 0));
    }

    #[test]
    fn mipmapped_downsample_preserves_checkerboard_mean() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(1024, 1024, |x, y| {
            let value = if (x + y) % 2 == 0 { 0 } else { 255 };
            Rgba([value, value, value, 255])
        }));
        let rendered =
            render_image(&source, &identity_spec(31, 31), RenderOptions::default()).unwrap();
        let values = rendered
            .image
            .pixels()
            .map(|pixel| u64::from(pixel.0[0]))
            .collect::<Vec<_>>();
        let mean = values.iter().sum::<u64>() as f64 / values.len() as f64;
        assert!((126.0..=129.0).contains(&mean), "checker mean was {mean}");
        assert!(values.iter().all(|value| (120..=135).contains(value)));
    }

    #[test]
    fn high_quality_upscale_stays_in_gamut_and_interpolates() {
        // The bicubic kernel's negative lobes must reconstruct a smooth
        // upscale without leaving [0,255] and without merely repeating edges.
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(2, 2, |x, y| {
            Rgba([
                if x == 0 { 255 } else { 0 },
                if y == 0 { 0 } else { 255 },
                128,
                255,
            ])
        }));
        let options = RenderOptions {
            quality: SamplingQuality::High,
            ..RenderOptions::default()
        };
        let rendered = render_image(&source, &identity_spec(16, 16), options).unwrap();
        assert_eq!((rendered.image.width(), rendered.image.height()), (16, 16));
        for pixel in rendered.image.pixels() {
            assert_eq!(pixel.0[3], 255);
        }
        let center = rendered.image.get_pixel(8, 8).0;
        assert!(
            (100..=155).contains(&center[0]) && (100..=155).contains(&center[1]),
            "center was {center:?}"
        );
        let corner = rendered.image.get_pixel(1, 1).0;
        assert!(corner[0] > 200 && corner[1] < 55, "corner was {corner:?}");
    }

    #[test]
    fn high_quality_minification_preserves_checkerboard_mean() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(1024, 1024, |x, y| {
            let value = if (x + y) % 2 == 0 { 0 } else { 255 };
            Rgba([value, value, value, 255])
        }));
        let options = RenderOptions {
            quality: SamplingQuality::High,
            ..RenderOptions::default()
        };
        let rendered = render_image(&source, &identity_spec(31, 31), options).unwrap();
        let mean = rendered
            .image
            .pixels()
            .map(|pixel| u64::from(pixel.0[0]))
            .sum::<u64>() as f64
            / f64::from(rendered.image.width() * rendered.image.height());
        assert!(
            (125.0..=130.0).contains(&mean),
            "high-quality checker mean was {mean}"
        );
    }

    #[test]
    fn real_perspective_enables_the_mip_pyramid_even_when_probes_stay_small() {
        // A perspective quad whose corner/midpoint footprints stay below the
        // 1.5 threshold would previously skip the pyramid even though the
        // denominator varies inside the plane.
        let homography = Homography {
            matrix: [
                1.0, 0.0, 0.0, //
                0.0, 1.0, 0.0, //
                0.02, 0.01, 1.0,
            ],
            inverse: [
                1.0, 0.0, 0.0, //
                0.0, 1.0, 0.0, //
                -0.02, -0.01, 1.0,
            ],
        };
        assert!(
            mapping_requires_mipmaps(&homography, Quad::unit(), 512, 512).unwrap(),
            "a nonzero perspective denominator must enable mipmaps"
        );
        // A pure affine upscale (2x2 source onto an 8x8 plane) keeps the
        // probe-based, here no-mipmap, decision.
        let upscale = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(8.0, 0.0),
            Point::new(8.0, 8.0),
            Point::new(0.0, 8.0),
        );
        let affine = Homography {
            matrix: [8.0, 0.0, 0.0, 0.0, 8.0, 0.0, 0.0, 0.0, 1.0],
            inverse: [0.125, 0.0, 0.0, 0.0, 0.125, 0.0, 0.0, 0.0, 1.0],
        };
        assert!(!mapping_requires_mipmaps(&affine, upscale, 2, 2).unwrap());
    }

    #[test]
    fn normalized_render_requires_target_size() {
        let source = DynamicImage::new_rgba8(1, 1);
        let error = render_image(
            &source,
            &TransformSpec::normalized(Quad::unit()),
            RenderOptions::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(
            error.message,
            "normalized raster rendering requires targetSize"
        );
    }

    #[test]
    fn oversized_source_header_returns_output_limit() {
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(2, 1)
            .write_to(&mut encoded, ImageFormat::Png)
            .unwrap();
        let limits = RenderLimits {
            max_width: 1,
            max_height: 10,
            max_pixels: 10,
            max_source_bytes: 1024 * 1024,
        };
        let error = decode_image_with_limits(encoded.get_ref(), limits).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);

        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        let output_path = directory.path().join("output.png");
        fs::write(&source_path, encoded.get_ref()).unwrap();
        let error = render_file(
            &source_path,
            &identity_spec(1, 1),
            &output_path,
            RenderOptions {
                limits,
                ..RenderOptions::default()
            },
            false,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert!(!output_path.exists());
    }

    #[test]
    fn exif_orientation_is_applied_before_dimension_limits() {
        let mut jpeg = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(RgbImage::from_fn(2, 1, |x, _| {
            if x == 0 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 255])
            }
        }))
        .write_to(&mut jpeg, ImageFormat::Jpeg)
        .unwrap();
        let encoded = jpeg_with_exif_orientation(jpeg.into_inner(), 6);
        let decoded = decode_image_with_limits(
            &encoded,
            RenderLimits {
                max_width: 1,
                max_height: 2,
                max_pixels: 2,
                max_source_bytes: 1024 * 1024,
            },
        )
        .unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1, 2));
    }

    #[test]
    fn orientation_dimension_helper_swaps_only_quarter_turns() {
        assert_eq!(
            oriented_dimensions((2, 3), Orientation::Rotate90FlipH),
            (3, 2)
        );
        assert_eq!(oriented_dimensions((2, 3), Orientation::Rotate270), (3, 2));
        assert_eq!(oriented_dimensions((2, 3), Orientation::Rotate180), (2, 3));
    }

    fn jpeg_with_exif_orientation(jpeg: Vec<u8>, orientation: u8) -> Vec<u8> {
        assert!(jpeg.starts_with(&[0xff, 0xd8]));
        let mut payload = Vec::new();
        payload.extend_from_slice(b"Exif\0\0MM\0*");
        payload.extend_from_slice(&8_u32.to_be_bytes());
        payload.extend_from_slice(&1_u16.to_be_bytes());
        payload.extend_from_slice(&0x0112_u16.to_be_bytes());
        payload.extend_from_slice(&3_u16.to_be_bytes());
        payload.extend_from_slice(&1_u32.to_be_bytes());
        payload.extend_from_slice(&[0, orientation, 0, 0]);
        payload.extend_from_slice(&0_u32.to_be_bytes());
        let segment_length = u16::try_from(payload.len() + 2).unwrap();
        let mut result = Vec::with_capacity(jpeg.len() + payload.len() + 4);
        result.extend_from_slice(&jpeg[..2]);
        result.extend_from_slice(&[0xff, 0xe1]);
        result.extend_from_slice(&segment_length.to_be_bytes());
        result.extend_from_slice(&payload);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    #[test]
    fn rejects_output_before_allocation() {
        let source = DynamicImage::new_rgba8(1, 1);
        let options = RenderOptions {
            limits: RenderLimits {
                max_width: 1,
                max_height: 1,
                max_pixels: 1,
                max_source_bytes: 1024,
            },
            ..RenderOptions::default()
        };
        let error = render_image(&source, &identity_spec(2, 2), options).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn dry_run_and_real_render_share_preflight_and_artifact_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        let output_path = directory.path().join("output.png");
        DynamicImage::new_rgba8(2, 2)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let result = render_file(
            &source_path,
            &identity_spec(2, 2),
            &output_path,
            RenderOptions::default(),
            false,
            true,
        )
        .unwrap();
        assert!(result.dry_run);
        assert!(!output_path.exists());
        assert_eq!(result.evidence.output_format, "png");
        assert_eq!(result.evidence.output_width, 2);
        assert_eq!(result.evidence.output_height, 2);
        assert_eq!(result.evidence.source_sha256.len(), 64);
        assert_eq!(result.evidence.output_sha256.len(), 64);
        assert!(result.evidence.solve_ms.is_finite() && result.evidence.solve_ms >= 0.0);
        assert!(result.evidence.render_ms.is_finite() && result.evidence.render_ms >= 0.0);
        assert!(result.evidence.warnings.is_empty());
        assert_eq!(
            hex::encode(Sha256::digest(fs::read(&source_path).unwrap())),
            result.evidence.source_sha256
        );

        let written = render_file(
            &source_path,
            &identity_spec(2, 2),
            &output_path,
            RenderOptions::default(),
            false,
            false,
        )
        .unwrap();
        assert!(output_path.is_file());
        assert_eq!(written.bytes, result.bytes);
        assert_eq!(
            written.evidence.source_sha256,
            result.evidence.source_sha256
        );
        assert_eq!(
            written.evidence.output_sha256,
            result.evidence.output_sha256
        );
        assert_eq!(
            hex::encode(Sha256::digest(fs::read(&output_path).unwrap())),
            written.evidence.output_sha256
        );
    }

    #[test]
    fn rejects_non_png_output_in_preflight() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("output.jpg");
        for dry_run in [true, false] {
            let error = render_file(
                &directory.path().join("missing-source.png"),
                &identity_spec(1, 1),
                &output,
                RenderOptions::default(),
                false,
                dry_run,
            )
            .unwrap_err();
            assert_eq!(error.code, ErrorCode::Schema);
            assert_eq!(
                error.message,
                "render output path must use a .png extension"
            );
        }
    }

    #[test]
    fn no_overwrite_returns_stable_error_without_mutation() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        let output_path = directory.path().join("output.png");
        DynamicImage::new_rgba8(1, 1)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        fs::write(&output_path, b"keep").unwrap();
        let error = render_file(
            &source_path,
            &identity_spec(1, 1),
            &output_path,
            RenderOptions::default(),
            false,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::DestinationExists);
        assert_eq!(fs::read(output_path).unwrap(), b"keep");
    }

    #[test]
    fn preflight_accepts_bare_relative_output_filename() {
        // Path::parent() of a bare filename is Some(""), which is not a usable
        // directory; preflight must treat it as the current directory instead
        // of failing with a missing output directory.
        preflight_destination(Path::new("bare-output-preflight.png"), false).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn no_overwrite_treats_dangling_symlink_as_existing_destination() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let output_path = directory.path().join("output.png");
        symlink(directory.path().join("missing.png"), &output_path).unwrap();
        let error = preflight_destination(&output_path, false).unwrap_err();
        assert_eq!(error.code, ErrorCode::DestinationExists);
        assert!(
            fs::symlink_metadata(output_path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
    }
}
