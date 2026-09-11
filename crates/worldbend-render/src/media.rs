use super::file_io::{output_parent, persist_temporary, preflight_file_destination};
use super::{
    CanvasPlacement, FileRenderStatus, InversePixelProjector, PixelMapping, PremultipliedPyramid,
    RenderDiagnostics, RenderEvidence, RenderLimits, RenderOptions, SamplingQuality, WarpSampler,
    cancelled_error, conservative_maximum_lod, mapping_requires_mipmaps, plan_canvas,
    render_pixel_premultiplied, validate_limits, validate_render_target,
    validate_source_dimensions,
};
use image::{
    ColorType, DynamicImage, ExtendedColorType, GenericImageView, ImageBuffer, ImageDecoder,
    ImageEncoder, ImageFormat, ImageReader, Limits as ImageLimits, Rgba, RgbaImage,
    codecs::{
        jpeg::JpegEncoder,
        png::{CompressionType, FilterType, PngEncoder},
        tiff::TiffEncoder,
        webp::WebPEncoder,
    },
    metadata::Orientation,
};
use rayon::prelude::*;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufWriter, Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
    time::Instant,
};
use worldbend_core::{
    ErrorCode, Point, TransformError, TransformResult, TransformSpec, build_warp_mesh, solve_spec,
};

const MAX_ICC_PROFILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_MEDIA_PIXELS: u64 = 12 * 1024 * 1024;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MediaFormat {
    Png,
    Jpeg,
    Webp,
    Tiff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MediaSampleFormat {
    U8,
    U16,
    F32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MediaColorModel {
    Gray,
    GrayAlpha,
    Rgb,
    Rgba,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum IccPolicy {
    #[default]
    Preserve,
    Discard,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum OutputPrecision {
    #[default]
    Preserve,
    U8,
    U16,
    F32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "format", rename_all = "camelCase", deny_unknown_fields)]
pub enum MediaOutput {
    Png {
        #[serde(default)]
        precision: OutputPrecision,
        #[serde(default)]
        icc: IccPolicy,
    },
    Tiff {
        #[serde(default)]
        precision: OutputPrecision,
        #[serde(default)]
        icc: IccPolicy,
    },
    Jpeg {
        #[schemars(range(min = 1, max = 100))]
        quality: u8,
        /// Explicit opaque matte in the source channel space. JPEG cannot
        /// retain alpha, so omission is not accepted.
        #[schemars(length(min = 3, max = 3))]
        matte: [u8; 3],
        #[serde(default)]
        icc: IccPolicy,
    },
    WebpLossless {
        #[serde(default)]
        icc: IccPolicy,
    },
}

pub fn media_output_extension(output: &MediaOutput) -> &'static str {
    match output {
        MediaOutput::Png { .. } => "png",
        MediaOutput::Tiff { .. } => "tiff",
        MediaOutput::Jpeg { .. } => "jpg",
        MediaOutput::WebpLossless { .. } => "webp",
    }
}

pub fn media_output_accepts_extension(output: &MediaOutput, extension: &str) -> bool {
    matches!(
        (output, extension),
        (MediaOutput::Png { .. }, "png")
            | (MediaOutput::Tiff { .. }, "tif" | "tiff")
            | (MediaOutput::Jpeg { .. }, "jpg" | "jpeg")
            | (MediaOutput::WebpLossless { .. }, "webp")
    )
}

pub fn media_output_format_name(output: &MediaOutput) -> &'static str {
    match output {
        MediaOutput::Png { .. } => "png",
        MediaOutput::Tiff { .. } => "tiff",
        MediaOutput::Jpeg { .. } => "jpeg",
        MediaOutput::WebpLossless { .. } => "webp",
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaRenderOptions {
    pub render: RenderOptions,
    pub output: MediaOutput,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaSourceInfo {
    pub format: MediaFormat,
    pub sample_format: MediaSampleFormat,
    pub color_model: MediaColorModel,
    pub has_alpha: bool,
    pub width: u32,
    pub height: u32,
    pub orientation_applied: bool,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub encoded_bytes: u64,
    pub source_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icc_profile_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(schema_with = "optional_json_safe_u64_schema")]
    pub icc_profile_bytes: Option<u64>,
}

fn optional_json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "anyOf": [
            { "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER },
            { "type": "null" }
        ]
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MediaLoss {
    PrecisionReduced,
    AlphaFlattened,
    LossyEncoding,
    IccProfileDiscarded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ColorManagement {
    UntaggedChannelValues,
    ProfilePreservedWithoutConversion,
    ProfileDiscardedWithoutConversion,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaOutputInfo {
    pub format: MediaFormat,
    pub sample_format: MediaSampleFormat,
    pub color_management: ColorManagement,
    pub icc_embedded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icc_profile_sha256: Option<String>,
    pub losses: Vec<MediaLoss>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub source: MediaSourceInfo,
    pub media: MediaOutputInfo,
    pub evidence: RenderEvidence,
    pub diagnostics: RenderDiagnostics,
}

pub(crate) struct DecodedMedia {
    pub(crate) image: DynamicImage,
    pub(crate) info: MediaSourceInfo,
    pub(crate) icc_profile: Option<Vec<u8>>,
}

/// Orientation-aware RGBA8 pixels for bounded read-only analysis providers.
/// The source facts retain the original sample format; conversion to RGBA8 is
/// an analysis projection and is never reused as a production render input.
pub struct MediaAnalysisRaster {
    pub pixels: RgbaImage,
    pub source: MediaSourceInfo,
}

pub(crate) type FloatRgbaImage = ImageBuffer<Rgba<f32>, Vec<f32>>;

pub fn inspect_media_file(source: &Path, limits: RenderLimits) -> TransformResult<MediaSourceInfo> {
    validate_limits(limits)?;
    if limits.max_pixels > MAX_MEDIA_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "production media inspection is limited to 12 MiP",
        )
        .with_details(json!({
            "maximumPixels": MAX_MEDIA_PIXELS,
            "configured": limits.max_pixels,
        })));
    }
    Ok(decode_media_file(source, limits, &|| false)?.info)
}

pub fn decode_media_analysis_file_with_cancel(
    source: &Path,
    limits: RenderLimits,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MediaAnalysisRaster> {
    let decoded = decode_media_file(source, limits, is_cancelled)?;
    Ok(MediaAnalysisRaster {
        pixels: decoded.image.into_rgba8(),
        source: decoded.info,
    })
}

pub fn render_media_file(
    source: &Path,
    spec: &TransformSpec,
    output: &Path,
    options: MediaRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<MediaFileRenderResult> {
    render_media_file_with_cancel(source, spec, output, options, overwrite, dry_run, &|| false)
}

pub fn render_media_file_with_cancel(
    source: &Path,
    spec: &TransformSpec,
    output: &Path,
    options: MediaRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MediaFileRenderResult> {
    let total_started = Instant::now();
    validate_media_options(&options, output)?;
    validate_render_target(spec, options.render.target_size)?;
    preflight_file_destination(output, overwrite)?;
    if is_cancelled() {
        return Err(cancelled_error());
    }

    let parent = output_parent(output);
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let decode_started = Instant::now();
    let decoded = decode_media_file(source, options.render.limits, is_cancelled)?;
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let source_info = decoded.info.clone();
    let (sample_format, output_format, icc_policy) =
        resolve_output(&options.output, source_info.sample_format)?;
    let (image, diagnostics, solve_ms, render_ms) = render_float_transform(
        decoded.image.into_rgba32f(),
        spec,
        options.render,
        is_cancelled,
    )?;
    if is_cancelled() {
        return Err(cancelled_error());
    }

    let mut losses = output_losses(
        &options.output,
        source_info.sample_format,
        source_info.has_alpha,
    );
    let icc = match (icc_policy, decoded.icc_profile) {
        (IccPolicy::Preserve, profile) => profile,
        (IccPolicy::Discard, Some(_)) => {
            losses.push(MediaLoss::IccProfileDiscarded);
            None
        }
        (IccPolicy::Discard, None) => None,
    };
    let color_management = match (
        icc_policy,
        icc.is_some(),
        source_info.icc_profile_sha256.is_some(),
    ) {
        (IccPolicy::Preserve, true, _) => ColorManagement::ProfilePreservedWithoutConversion,
        (IccPolicy::Discard, _, true) => ColorManagement::ProfileDiscardedWithoutConversion,
        _ => ColorManagement::UntaggedChannelValues,
    };
    let encode_started = Instant::now();
    encode_output(
        temporary.as_file_mut(),
        &image,
        &options.output,
        sample_format,
        icc,
    )?;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = hash_file(temporary.as_file_mut())?;
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    if is_cancelled() {
        return Err(cancelled_error());
    }
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }
    let icc_embedded =
        icc_policy == IccPolicy::Preserve && source_info.icc_profile_sha256.is_some();
    let total_ms = total_started.elapsed().as_secs_f64() * 1000.0;
    Ok(MediaFileRenderResult {
        status: if dry_run { FileRenderStatus::Ready } else { FileRenderStatus::Written },
        dry_run,
        output: output.display().to_string(),
        bytes,
        source: source_info.clone(),
        media: MediaOutputInfo {
            format: output_format,
            sample_format,
            color_management,
            icc_embedded,
            icc_profile_sha256: if icc_embedded { source_info.icc_profile_sha256.clone() } else { None },
            losses,
        },
        evidence: RenderEvidence {
            source_sha256: source_info.source_sha256.clone(),
            output_sha256,
            output_width: image.width(),
            output_height: image.height(),
            output_format: media_format_name(output_format).to_owned(),
            solve_ms,
            decode_ms,
            render_ms,
            encode_ms,
            total_ms,
            warnings: vec![match color_management {
                ColorManagement::ProfilePreservedWithoutConversion =>
                    "ICC profile was preserved; interpolation used the stored channel values without color conversion".to_owned(),
                ColorManagement::ProfileDiscardedWithoutConversion =>
                    "ICC profile was explicitly discarded; interpolation used the stored channel values without color conversion".to_owned(),
                ColorManagement::UntaggedChannelValues =>
                    "source was untagged; interpolation used the stored channel values".to_owned(),
            }],
        },
        diagnostics,
    })
}

fn render_float_transform(
    source: FloatRgbaImage,
    spec: &TransformSpec,
    options: RenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<(FloatRgbaImage, RenderDiagnostics, f64, f64)> {
    validate_limits(options.limits)?;
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
    let warp = WarpSampler::new(
        spec.content
            .warp
            .filter(|warp| warp.amount != 0.0)
            .map(|warp| build_warp_mesh(Some(warp)))
            .transpose()?,
    )?;
    let source_width = source.width();
    let source_height = source.height();
    let (image, render_ms) = render_float_pixels(
        source,
        &solved.homography,
        solved.resolved_destination.quad,
        placement,
        warp,
        options.quality,
        is_cancelled,
    )?;
    let diagnostics = RenderDiagnostics {
        source_width,
        source_height,
        placement,
        destination_bounds: solved.diagnostics.bounds,
        quality: options.quality,
        canvas: options.canvas,
        solve: solved.diagnostics,
    };
    Ok((image, diagnostics, solve_ms, render_ms))
}

fn render_float_pixels(
    source: FloatRgbaImage,
    homography: &worldbend_core::Homography,
    destination: worldbend_core::Quad,
    placement: CanvasPlacement,
    warp: WarpSampler,
    quality: SamplingQuality,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<(FloatRgbaImage, f64)> {
    let render_started = Instant::now();
    let use_mipmaps = quality != SamplingQuality::Preview
        && (warp.is_active()
            || mapping_requires_mipmaps(homography, destination, source.width(), source.height())?);
    let maximum_levels = if use_mipmaps {
        let bound = conservative_maximum_lod(
            homography,
            destination,
            &warp,
            source.width(),
            source.height(),
        );
        if bound.is_finite() {
            (bound.ceil() as usize).saturating_add(1)
        } else {
            usize::MAX
        }
    } else {
        1
    };
    let source = FloatMipPyramid::new(source, use_mipmaps, maximum_levels);
    let mut output = vec![0.0_f32; placement.width as usize * placement.height as usize * 4];
    let mapping = PixelMapping {
        homography,
        warp: &warp,
        destination,
        canvas_origin: placement.origin,
    };
    let row_stride = placement.width as usize * 4;
    output.par_chunks_mut(row_stride).enumerate().try_for_each(
        |(y, row)| -> TransformResult<()> {
            if is_cancelled() {
                return Err(cancelled_error());
            }
            let mut projector = InversePixelProjector::new(
                homography,
                Point::new(placement.origin.x, placement.origin.y + y as f64),
            );
            for (x, pixel) in row.chunks_exact_mut(4).enumerate() {
                let premultiplied = render_pixel_premultiplied(
                    &source, &mapping, &projector, x as u32, y as u32, quality,
                )?;
                pixel.copy_from_slice(&straight_alpha_f32(premultiplied));
                projector.advance_x();
            }
            Ok(())
        },
    )?;
    let image = FloatRgbaImage::from_raw(placement.width, placement.height, output)
        .expect("validated dimensions match the allocated float buffer");
    Ok((image, render_started.elapsed().as_secs_f64() * 1000.0))
}

pub(crate) struct FloatMipPyramid {
    levels: Vec<FloatRgbaImage>,
}

impl FloatMipPyramid {
    pub(crate) fn new(source: FloatRgbaImage, build: bool, maximum_levels: usize) -> Self {
        let mut levels = vec![source];
        if build {
            while levels.len() < maximum_levels.max(1)
                && levels
                    .last()
                    .is_some_and(|level| level.width() > 1 || level.height() > 1)
            {
                levels.push(downsample_float(levels.last().expect("level zero exists")));
            }
        }
        Self { levels }
    }
}

impl PremultipliedPyramid for FloatMipPyramid {
    fn base_width(&self) -> u32 {
        self.levels[0].width()
    }
    fn base_height(&self) -> u32 {
        self.levels[0].height()
    }

    fn sample(&self, uv: Point, quality: SamplingQuality, lod: f64) -> [f64; 4] {
        let maximum = self.levels.len() - 1;
        let level = lod.clamp(0.0, maximum as f64);
        let lower = level.floor() as usize;
        let upper = level.ceil() as usize;
        let fraction = level - lower as f64;
        let low = sample_float_filtered(&self.levels[lower], uv, quality);
        if lower == upper {
            return low;
        }
        let high = sample_float_filtered(&self.levels[upper], uv, quality);
        std::array::from_fn(|index| low[index] * (1.0 - fraction) + high[index] * fraction)
    }
}

fn downsample_float(source: &FloatRgbaImage) -> FloatRgbaImage {
    let width = source.width().div_ceil(2).max(1);
    let height = source.height().div_ceil(2).max(1);
    FloatRgbaImage::from_fn(width, height, |x, y| {
        let mut value = [0.0; 4];
        let mut count = 0.0;
        for sy in y * 2..=(y * 2 + 1).min(source.height() - 1) {
            for sx in x * 2..=(x * 2 + 1).min(source.width() - 1) {
                add_weighted(
                    &mut value,
                    float_pixel_premultiplied(source.get_pixel(sx, sy)),
                    1.0,
                );
                count += 1.0;
            }
        }
        for channel in &mut value {
            *channel /= count;
        }
        Rgba(straight_alpha_f32(value))
    })
}

fn sample_float_filtered(source: &FloatRgbaImage, uv: Point, quality: SamplingQuality) -> [f64; 4] {
    let x = uv.x * f64::from(source.width()) - 0.5;
    let y = uv.y * f64::from(source.height()) - 0.5;
    let radius = if quality == SamplingQuality::High {
        2
    } else {
        1
    };
    if radius == 1 {
        return sample_float_bilinear(source, x, y);
    }
    sample_float_bicubic(source, x, y)
}

fn sample_float_bilinear(source: &FloatRgbaImage, x: f64, y: f64) -> [f64; 4] {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x.floor();
    let ty = y - y.floor();
    let mut value = [0.0; 4];
    for (sy, wy) in [(y0, 1.0 - ty), (y0 + 1, ty)] {
        for (sx, wx) in [(x0, 1.0 - tx), (x0 + 1, tx)] {
            add_weighted(&mut value, sample_float_pixel(source, sx, sy), wx * wy);
        }
    }
    value
}

fn sample_float_bicubic(source: &FloatRgbaImage, x: f64, y: f64) -> [f64; 4] {
    let base_x = x.floor() as i64;
    let base_y = y.floor() as i64;
    let mut value = [0.0; 4];
    for offset_y in -1..=2 {
        let sy = base_y + offset_y;
        let wy = catmull_rom(y - sy as f64);
        for offset_x in -1..=2 {
            let sx = base_x + offset_x;
            let wx = catmull_rom(x - sx as f64);
            add_weighted(&mut value, sample_float_pixel(source, sx, sy), wx * wy);
        }
    }
    value
}

fn sample_float_pixel(source: &FloatRgbaImage, x: i64, y: i64) -> [f64; 4] {
    let x = x.clamp(0, i64::from(source.width()) - 1) as u32;
    let y = y.clamp(0, i64::from(source.height()) - 1) as u32;
    float_pixel_premultiplied(source.get_pixel(x, y))
}

fn float_pixel_premultiplied(pixel: &Rgba<f32>) -> [f64; 4] {
    let alpha = f64::from(pixel.0[3]).clamp(0.0, 1.0);
    [
        f64::from(pixel.0[0]) * alpha,
        f64::from(pixel.0[1]) * alpha,
        f64::from(pixel.0[2]) * alpha,
        alpha,
    ]
}

pub(crate) fn straight_alpha_f32(value: [f64; 4]) -> [f32; 4] {
    let alpha = value[3].clamp(0.0, 1.0);
    if alpha <= 1.0e-12 {
        return [0.0; 4];
    }
    [
        (value[0] / alpha) as f32,
        (value[1] / alpha) as f32,
        (value[2] / alpha) as f32,
        alpha as f32,
    ]
}

fn add_weighted(value: &mut [f64; 4], sample: [f64; 4], weight: f64) {
    for index in 0..4 {
        value[index] += sample[index] * weight;
    }
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

pub(crate) fn decode_media_file(
    source: &Path,
    limits: RenderLimits,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<DecodedMedia> {
    validate_limits(limits)?;
    let mut file = fs::File::open(source)
        .map_err(|error| media_error("failed to open source image", error))?;
    let metadata = file
        .metadata()
        .map_err(|error| media_error("failed to inspect source image", error))?;
    if !metadata.is_file() {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source image must be a regular file",
        ));
    }
    if metadata.len() > limits.max_source_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded source exceeds configured byte limit",
        )
        .with_details(
            json!({ "sourceBytes": metadata.len(), "maximum": limits.max_source_bytes }),
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.read_to_end(&mut bytes)
        .map_err(|error| media_error("failed to read source image", error))?;
    if is_cancelled() {
        return Err(cancelled_error());
    }
    let source_sha256 = hex::encode(Sha256::digest(&bytes));
    let mut reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| media_error("source raster format is not recognized", error))?;
    let format = reader.format().and_then(media_format).ok_or_else(|| {
        TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source must be PNG, JPEG, WebP, or TIFF",
        )
    })?;
    let maximum_axis = limits.max_width.max(limits.max_height);
    let mut image_limits = ImageLimits::default();
    image_limits.max_image_width = Some(maximum_axis);
    image_limits.max_image_height = Some(maximum_axis);
    image_limits.max_alloc = Some(limits.max_pixels.saturating_mul(16).min(1024 * 1024 * 1024));
    reader.limits(image_limits);
    let mut decoder = reader
        .into_decoder()
        .map_err(|error| media_error("source raster could not be decoded", error))?;
    let raw_dimensions = decoder.dimensions();
    let orientation = decoder
        .orientation()
        .map_err(|error| media_error("source orientation could not be read", error))?;
    let dimensions = super::oriented_dimensions(raw_dimensions, orientation);
    validate_source_dimensions(dimensions.0, dimensions.1, limits)?;
    let color_type = decoder.color_type();
    let icc_profile = decoder
        .icc_profile()
        .map_err(|error| media_error("source ICC profile could not be read", error))?;
    if icc_profile
        .as_ref()
        .is_some_and(|profile| profile.len() > MAX_ICC_PROFILE_BYTES)
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "source ICC profile exceeds the 4 MiB limit",
        ));
    }
    if let Some(profile) = icc_profile.as_deref() {
        validate_icc(profile)?;
    }
    let mut image = DynamicImage::from_decoder(decoder)
        .map_err(|error| media_error("source raster could not be decoded", error))?;
    image.apply_orientation(orientation);
    if image.dimensions() != dimensions {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "decoded dimensions do not match orientation-aware dimensions",
        ));
    }
    let icc_profile_sha256 = icc_profile
        .as_ref()
        .map(|profile| hex::encode(Sha256::digest(profile)));
    Ok(DecodedMedia {
        image,
        info: MediaSourceInfo {
            format,
            sample_format: sample_format(color_type),
            color_model: color_model(color_type),
            has_alpha: color_type.has_alpha(),
            width: dimensions.0,
            height: dimensions.1,
            orientation_applied: !matches!(orientation, Orientation::NoTransforms),
            encoded_bytes: metadata.len(),
            source_sha256,
            icc_profile_sha256,
            icc_profile_bytes: icc_profile.as_ref().map(|profile| profile.len() as u64),
        },
        icc_profile,
    })
}

fn validate_icc(profile: &[u8]) -> TransformResult<()> {
    if profile.len() < 128 || profile.get(36..40) != Some(b"acsp") {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "embedded ICC profile has an invalid header",
        ));
    }
    let declared = u32::from_be_bytes(profile[0..4].try_into().expect("length checked")) as usize;
    if declared < 128 || declared != profile.len() {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "embedded ICC profile has an invalid declared size",
        ));
    }
    Ok(())
}

fn validate_media_options(options: &MediaRenderOptions, output: &Path) -> TransformResult<()> {
    validate_limits(options.render.limits)?;
    if options.render.limits.max_pixels > MAX_MEDIA_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "production media rendering is limited to 12 MiP per source and output",
        )
        .with_details(json!({
            "maximumPixels": MAX_MEDIA_PIXELS,
            "configured": options.render.limits.max_pixels,
        })));
    }
    if let MediaOutput::Jpeg { quality, .. } = options.output
        && !(1..=100).contains(&quality)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "JPEG quality must be in 1..100",
        ));
    }
    let expected = media_output_format_name(&options.output);
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let matches = extension
        .as_deref()
        .is_some_and(|extension| media_output_accepts_extension(&options.output, extension));
    if !matches {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("output extension must match the requested {expected} format"),
        ));
    }
    Ok(())
}

pub(crate) fn resolve_output(
    output: &MediaOutput,
    source: MediaSampleFormat,
) -> TransformResult<(MediaSampleFormat, MediaFormat, IccPolicy)> {
    let result = match *output {
        MediaOutput::Png { precision, icc } => {
            let precision = resolve_precision(precision, source);
            if precision == MediaSampleFormat::F32 {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "PNG output supports u8 or u16 precision, not f32",
                ));
            }
            (precision, MediaFormat::Png, icc)
        }
        MediaOutput::Tiff { precision, icc } => {
            (resolve_precision(precision, source), MediaFormat::Tiff, icc)
        }
        MediaOutput::Jpeg { icc, .. } => (MediaSampleFormat::U8, MediaFormat::Jpeg, icc),
        MediaOutput::WebpLossless { icc } => (MediaSampleFormat::U8, MediaFormat::Webp, icc),
    };
    Ok(result)
}

fn resolve_precision(value: OutputPrecision, source: MediaSampleFormat) -> MediaSampleFormat {
    match value {
        OutputPrecision::Preserve => source,
        OutputPrecision::U8 => MediaSampleFormat::U8,
        OutputPrecision::U16 => MediaSampleFormat::U16,
        OutputPrecision::F32 => MediaSampleFormat::F32,
    }
}

pub(crate) fn output_losses(
    output: &MediaOutput,
    source: MediaSampleFormat,
    has_alpha: bool,
) -> Vec<MediaLoss> {
    let target = resolve_output(output, source)
        .map(|value| value.0)
        .unwrap_or(MediaSampleFormat::U8);
    let source_rank = precision_rank(source);
    let mut losses = Vec::new();
    if precision_rank(target) < source_rank {
        losses.push(MediaLoss::PrecisionReduced);
    }
    if matches!(output, MediaOutput::Jpeg { .. }) {
        if has_alpha {
            losses.push(MediaLoss::AlphaFlattened);
        }
        losses.push(MediaLoss::LossyEncoding);
    }
    losses
}

fn precision_rank(value: MediaSampleFormat) -> u8 {
    match value {
        MediaSampleFormat::U8 => 1,
        MediaSampleFormat::U16 => 2,
        MediaSampleFormat::F32 => 3,
    }
}

pub(crate) fn encode_output(
    file: &mut fs::File,
    image: &FloatRgbaImage,
    output: &MediaOutput,
    precision: MediaSampleFormat,
    icc: Option<Vec<u8>>,
) -> TransformResult<()> {
    let mut writer = BufWriter::new(file);
    match output {
        MediaOutput::Png { .. } => {
            let mut encoder = PngEncoder::new_with_quality(
                &mut writer,
                CompressionType::Best,
                FilterType::Adaptive,
            );
            set_icc(&mut encoder, icc)?;
            let (bytes, color) = encoded_rgba(image, precision)?;
            encoder
                .write_image(&bytes, image.width(), image.height(), color)
                .map_err(encode_error)?;
        }
        MediaOutput::Tiff { .. } => {
            let mut encoder = TiffEncoder::new(&mut writer);
            set_icc(&mut encoder, icc)?;
            let (bytes, color) = encoded_rgba(image, precision)?;
            encoder
                .write_image(&bytes, image.width(), image.height(), color)
                .map_err(encode_error)?;
        }
        MediaOutput::Jpeg { quality, matte, .. } => {
            let mut encoder = JpegEncoder::new_with_quality(&mut writer, *quality);
            set_icc(&mut encoder, icc)?;
            let bytes = jpeg_rgb(image, *matte);
            encoder
                .write_image(
                    &bytes,
                    image.width(),
                    image.height(),
                    ExtendedColorType::Rgb8,
                )
                .map_err(encode_error)?;
        }
        MediaOutput::WebpLossless { .. } => {
            let mut encoder = WebPEncoder::new_lossless(&mut writer);
            set_icc(&mut encoder, icc)?;
            let (bytes, _) = encoded_rgba(image, MediaSampleFormat::U8)?;
            encoder
                .write_image(
                    &bytes,
                    image.width(),
                    image.height(),
                    ExtendedColorType::Rgba8,
                )
                .map_err(encode_error)?;
        }
    }
    writer
        .flush()
        .map_err(|error| media_error("failed to flush encoded output", error))?;
    Ok(())
}

fn set_icc(encoder: &mut impl ImageEncoder, icc: Option<Vec<u8>>) -> TransformResult<()> {
    if let Some(profile) = icc {
        encoder.set_icc_profile(profile).map_err(|error| {
            TransformError::new(
                ErrorCode::UnsupportedMedia,
                "requested output encoder cannot preserve the ICC profile",
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?;
    }
    Ok(())
}

fn encoded_rgba(
    image: &FloatRgbaImage,
    precision: MediaSampleFormat,
) -> TransformResult<(Vec<u8>, ExtendedColorType)> {
    match precision {
        MediaSampleFormat::U8 => Ok((
            image
                .pixels()
                .flat_map(|pixel| pixel.0.map(unit_u8))
                .collect(),
            ExtendedColorType::Rgba8,
        )),
        MediaSampleFormat::U16 => {
            let bytes = image
                .pixels()
                .flat_map(|pixel| pixel.0)
                .flat_map(|value| unit_u16(value).to_ne_bytes())
                .collect();
            Ok((bytes, ExtendedColorType::Rgba16))
        }
        MediaSampleFormat::F32 => {
            let bytes = image
                .pixels()
                .flat_map(|pixel| pixel.0)
                .flat_map(f32::to_ne_bytes)
                .collect();
            Ok((bytes, ExtendedColorType::Rgba32F))
        }
    }
}

fn jpeg_rgb(image: &FloatRgbaImage, matte: [u8; 3]) -> Vec<u8> {
    image
        .pixels()
        .flat_map(|pixel| {
            let alpha = pixel.0[3].clamp(0.0, 1.0);
            std::array::from_fn::<_, 3, _>(|index| {
                let background = f32::from(matte[index]) / 255.0;
                unit_u8(pixel.0[index] * alpha + background * (1.0 - alpha))
            })
        })
        .collect()
}

fn unit_u8(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}
fn unit_u16(value: f32) -> u16 {
    (value.clamp(0.0, 1.0) * 65535.0).round() as u16
}

fn hash_file(file: &mut fs::File) -> TransformResult<(u64, String)> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| media_error("failed to seek encoded output", error))?;
    let mut hasher = Sha256::new();
    let mut bytes = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| media_error("failed to verify encoded output", error))?;
        if count == 0 {
            break;
        }
        bytes = bytes.saturating_add(count as u64);
        hasher.update(&buffer[..count]);
    }
    Ok((bytes, hex::encode(hasher.finalize())))
}

fn media_format(value: ImageFormat) -> Option<MediaFormat> {
    match value {
        ImageFormat::Png => Some(MediaFormat::Png),
        ImageFormat::Jpeg => Some(MediaFormat::Jpeg),
        ImageFormat::WebP => Some(MediaFormat::Webp),
        ImageFormat::Tiff => Some(MediaFormat::Tiff),
        _ => None,
    }
}

fn media_format_name(value: MediaFormat) -> &'static str {
    match value {
        MediaFormat::Png => "png",
        MediaFormat::Jpeg => "jpeg",
        MediaFormat::Webp => "webp-lossless",
        MediaFormat::Tiff => "tiff",
    }
}

fn sample_format(value: ColorType) -> MediaSampleFormat {
    match value {
        ColorType::L16 | ColorType::La16 | ColorType::Rgb16 | ColorType::Rgba16 => {
            MediaSampleFormat::U16
        }
        ColorType::Rgb32F | ColorType::Rgba32F => MediaSampleFormat::F32,
        _ => MediaSampleFormat::U8,
    }
}

fn color_model(value: ColorType) -> MediaColorModel {
    match value {
        ColorType::L8 | ColorType::L16 => MediaColorModel::Gray,
        ColorType::La8 | ColorType::La16 => MediaColorModel::GrayAlpha,
        ColorType::Rgb8 | ColorType::Rgb16 | ColorType::Rgb32F => MediaColorModel::Rgb,
        _ => MediaColorModel::Rgba,
    }
}

fn encode_error(error: image::ImageError) -> TransformError {
    TransformError::new(
        ErrorCode::Render,
        "failed to encode production media output",
    )
    .with_details(json!({ "reason": error.to_string() }))
}

fn media_error(message: &'static str, error: impl std::fmt::Display) -> TransformError {
    TransformError::new(ErrorCode::UnsupportedMedia, message)
        .with_details(json!({ "reason": error.to_string() }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CanvasMode;
    use tempfile::tempdir;

    fn identity_spec(width: u32, height: u32) -> TransformSpec {
        serde_json::from_value(json!({
            "schema": "worldbend.transform",
            "version": "0.1",
            "destination": {
                "space": "pixel",
                "reference": { "width": width, "height": height },
                "quad": {
                    "tl": { "x": 0, "y": 0 },
                    "tr": { "x": width, "y": 0 },
                    "br": { "x": width, "y": height },
                    "bl": { "x": 0, "y": height }
                }
            },
            "content": { "fit": "stretch" }
        }))
        .unwrap()
    }

    fn limits() -> RenderLimits {
        RenderLimits {
            max_width: 64,
            max_height: 64,
            max_pixels: 4096,
            max_source_bytes: 1024 * 1024,
        }
    }

    fn icc_profile() -> Vec<u8> {
        let mut profile = vec![0_u8; 128];
        profile[0..4].copy_from_slice(&128_u32.to_be_bytes());
        profile[36..40].copy_from_slice(b"acsp");
        profile
    }

    fn write_png16(path: &Path, profile: &[u8]) {
        let file = fs::File::create(path).unwrap();
        let mut encoder = PngEncoder::new(file);
        encoder.set_icc_profile(profile.to_vec()).unwrap();
        let samples = [1000_u16, 2000, 3000, 65535, 50000, 40000, 30000, 32768];
        let bytes = samples
            .into_iter()
            .flat_map(u16::to_ne_bytes)
            .collect::<Vec<_>>();
        encoder
            .write_image(&bytes, 2, 1, ExtendedColorType::Rgba16)
            .unwrap();
    }

    #[test]
    fn preserves_png16_precision_and_icc_with_explicit_disclosure() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        let output = directory.path().join("output.png");
        let profile = icc_profile();
        write_png16(&source, &profile);

        let result = render_media_file(
            &source,
            &identity_spec(2, 1),
            &output,
            MediaRenderOptions {
                render: RenderOptions {
                    quality: SamplingQuality::High,
                    canvas: CanvasMode::Reference,
                    target_size: None,
                    limits: limits(),
                },
                output: MediaOutput::Png {
                    precision: OutputPrecision::Preserve,
                    icc: IccPolicy::Preserve,
                },
            },
            false,
            false,
        )
        .unwrap();

        assert_eq!(result.source.sample_format, MediaSampleFormat::U16);
        assert_eq!(result.media.sample_format, MediaSampleFormat::U16);
        assert_eq!(result.media.losses, Vec::<MediaLoss>::new());
        assert_eq!(
            result.media.color_management,
            ColorManagement::ProfilePreservedWithoutConversion
        );
        let mut decoder = ImageReader::open(&output)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .into_decoder()
            .unwrap();
        assert_eq!(decoder.color_type(), ColorType::Rgba16);
        assert_eq!(decoder.icc_profile().unwrap().unwrap(), profile);
    }

    #[test]
    fn reports_explicit_precision_and_profile_loss() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        let output = directory.path().join("output.webp");
        write_png16(&source, &icc_profile());
        let result = render_media_file(
            &source,
            &identity_spec(2, 1),
            &output,
            MediaRenderOptions {
                render: RenderOptions {
                    quality: SamplingQuality::Standard,
                    canvas: CanvasMode::Reference,
                    target_size: None,
                    limits: limits(),
                },
                output: MediaOutput::WebpLossless {
                    icc: IccPolicy::Discard,
                },
            },
            false,
            false,
        )
        .unwrap();
        assert_eq!(result.media.sample_format, MediaSampleFormat::U8);
        assert_eq!(
            result.media.losses,
            vec![MediaLoss::PrecisionReduced, MediaLoss::IccProfileDiscarded]
        );
        assert_eq!(
            result.media.color_management,
            ColorManagement::ProfileDiscardedWithoutConversion
        );
    }

    #[test]
    fn preserves_float_tiff_samples_and_rejects_extension_mismatch() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.tiff");
        let output = directory.path().join("output.tiff");
        let samples = [1.5_f32, -0.25, 0.5, 1.0];
        let bytes = samples
            .into_iter()
            .flat_map(f32::to_ne_bytes)
            .collect::<Vec<_>>();
        TiffEncoder::new(fs::File::create(&source).unwrap())
            .write_image(&bytes, 1, 1, ExtendedColorType::Rgba32F)
            .unwrap();
        let options = MediaRenderOptions {
            render: RenderOptions {
                quality: SamplingQuality::Standard,
                canvas: CanvasMode::Reference,
                target_size: None,
                limits: limits(),
            },
            output: MediaOutput::Tiff {
                precision: OutputPrecision::Preserve,
                icc: IccPolicy::Preserve,
            },
        };
        let result = render_media_file(
            &source,
            &identity_spec(1, 1),
            &output,
            options.clone(),
            false,
            false,
        )
        .unwrap();
        assert_eq!(result.source.sample_format, MediaSampleFormat::F32);
        assert_eq!(result.media.sample_format, MediaSampleFormat::F32);
        let decoded = ImageReader::open(&output)
            .unwrap()
            .with_guessed_format()
            .unwrap()
            .decode()
            .unwrap()
            .into_rgba32f();
        assert_eq!(decoded.dimensions(), (1, 1));
        let pixel = decoded.get_pixel(0, 0).0;
        assert!((pixel[0] - 1.5).abs() < 1.0e-6);
        assert!((pixel[1] + 0.25).abs() < 1.0e-6);

        let failure = render_media_file(
            &source,
            &identity_spec(1, 1),
            &directory.path().join("wrong.png"),
            options,
            false,
            true,
        )
        .unwrap_err();
        assert_eq!(failure.code, ErrorCode::Schema);
    }

    #[test]
    fn jpeg_requires_bounded_quality_and_discloses_lossy_alpha_flattening() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        let output = directory.path().join("output.jpg");
        write_png16(&source, &icc_profile());
        let result = render_media_file(
            &source,
            &identity_spec(2, 1),
            &output,
            MediaRenderOptions {
                render: RenderOptions {
                    quality: SamplingQuality::Standard,
                    canvas: CanvasMode::Reference,
                    target_size: None,
                    limits: limits(),
                },
                output: MediaOutput::Jpeg {
                    quality: 92,
                    matte: [255, 255, 255],
                    icc: IccPolicy::Preserve,
                },
            },
            false,
            false,
        )
        .unwrap();
        assert_eq!(
            result.media.losses,
            vec![
                MediaLoss::PrecisionReduced,
                MediaLoss::AlphaFlattened,
                MediaLoss::LossyEncoding
            ]
        );
        assert_eq!(
            ImageReader::open(&output)
                .unwrap()
                .with_guessed_format()
                .unwrap()
                .format(),
            Some(ImageFormat::Jpeg)
        );
    }

    #[test]
    fn cancellation_and_invalid_media_limits_publish_nothing() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.png");
        let output = directory.path().join("output.png");
        write_png16(&source, &icc_profile());
        let options = MediaRenderOptions {
            render: RenderOptions {
                quality: SamplingQuality::Standard,
                canvas: CanvasMode::Reference,
                target_size: None,
                limits: limits(),
            },
            output: MediaOutput::Png {
                precision: OutputPrecision::U16,
                icc: IccPolicy::Preserve,
            },
        };
        let error = render_media_file_with_cancel(
            &source,
            &identity_spec(2, 1),
            &output,
            options,
            false,
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());

        let mut oversized_inspection_limits = limits();
        oversized_inspection_limits.max_pixels = MAX_MEDIA_PIXELS + 1;
        let error = inspect_media_file(&source, oversized_inspection_limits).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }
}
