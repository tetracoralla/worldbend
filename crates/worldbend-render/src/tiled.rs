use super::canvas::{preflight_output_directory, publish_directory_noreplace};
use super::media::{
    ColorManagement, FloatMipPyramid, FloatRgbaImage, IccPolicy, MediaOutput, MediaOutputInfo,
    MediaSourceInfo, decode_media_file, encode_output, output_losses, resolve_output,
    straight_alpha_f32,
};
use super::{
    CanvasMode, CanvasPlacement, InversePixelProjector, PixelMapping, RenderLimits,
    SamplingQuality, WarpSampler, conservative_maximum_lod, mapping_requires_mipmaps,
    render_pixel_premultiplied, validate_render_target,
};
use image::{ImageBuffer, Rgba};
use rayon::prelude::*;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};
use worldbend_core::{
    Bounds, ErrorCode, Point, Size, SolveDiagnostics, TransformError, TransformResult,
    TransformSpec, build_warp_mesh, solve_spec,
};

pub const TILED_MEDIA_SCHEMA: &str = "worldbend.tiled-media";
pub const TILED_MEDIA_VERSION: &str = "0.1";
pub const MAX_TILED_AXIS: u32 = 262_144;
pub const MAX_TILED_OUTPUT_PIXELS: u64 = 1_000_000_000;
pub const MAX_TILED_TILES: u32 = 4096;
// Leave headroom beneath the 768 MiB Agent worker ceiling for a 12 MiP float
// source pyramid, one RGBA-f32 tile, one f32 encoder buffer, parser/runtime
// overhead, and cancellation cleanup to coexist.
pub const MAX_TILED_TILE_PIXELS: u64 = 12 * 1024 * 1024;
pub const MAX_TILED_ENCODED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TiledMediaRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub canvas: CanvasMode,
    #[serde(default)]
    pub target_size: Option<Size>,
    pub source_limits: RenderLimits,
    #[schemars(range(min = 1, max = 8192))]
    pub tile_width: u32,
    #[schemars(range(min = 1, max = 8192))]
    pub tile_height: u32,
    #[serde(default = "default_max_output_pixels")]
    #[schemars(range(min = 1, max = MAX_TILED_OUTPUT_PIXELS))]
    pub max_output_pixels: u64,
    #[serde(default = "default_max_encoded_bytes")]
    #[schemars(range(min = 1, max = MAX_TILED_ENCODED_BYTES))]
    pub max_encoded_bytes: u64,
    #[serde(default = "default_max_tiles")]
    #[schemars(range(min = 1, max = MAX_TILED_TILES))]
    pub max_tiles: u32,
    pub output: MediaOutput,
}

const fn default_max_output_pixels() -> u64 {
    MAX_TILED_OUTPUT_PIXELS
}

const fn default_max_encoded_bytes() -> u64 {
    MAX_TILED_ENCODED_BYTES
}

const fn default_max_tiles() -> u32 {
    MAX_TILED_TILES
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TiledMediaStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TiledMediaTile {
    pub row: u32,
    pub column: u32,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub filename: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TiledMediaManifest {
    #[schemars(schema_with = "tiled_schema")]
    pub schema: String,
    #[schemars(schema_with = "tiled_version")]
    pub version: String,
    pub source: MediaSourceInfo,
    pub media: MediaOutputInfo,
    pub placement: CanvasPlacement,
    pub destination_bounds: Bounds,
    pub quality: SamplingQuality,
    pub canvas: CanvasMode,
    pub tile_width: u32,
    pub tile_height: u32,
    pub rows: u32,
    pub columns: u32,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub output_pixels: u64,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub encoded_bytes: u64,
    pub tiles: Vec<TiledMediaTile>,
    pub solve: SolveDiagnostics,
    pub warnings: Vec<String>,
}

fn tiled_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": TILED_MEDIA_SCHEMA })
}

fn tiled_version(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": TILED_MEDIA_VERSION })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TiledMediaRenderResult {
    pub status: TiledMediaStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub manifest: TiledMediaManifest,
    pub manifest_sha256: String,
}

pub fn render_tiled_media_directory(
    source: &Path,
    spec: &TransformSpec,
    output_directory: &Path,
    options: TiledMediaRenderOptions,
    dry_run: bool,
) -> TransformResult<TiledMediaRenderResult> {
    render_tiled_media_directory_with_cancel(
        source,
        spec,
        output_directory,
        options,
        dry_run,
        &|| false,
    )
}

pub fn render_tiled_media_directory_with_cancel(
    source: &Path,
    spec: &TransformSpec,
    output_directory: &Path,
    options: TiledMediaRenderOptions,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<TiledMediaRenderResult> {
    validate_options(&options)?;
    preflight_output_directory(output_directory)?;
    if is_cancelled() {
        return Err(cancelled_error());
    }
    let parent = output_directory.parent().unwrap_or_else(|| Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-tiled-")
        .tempdir_in(parent)
        .map_err(|error| {
            TransformError::new(ErrorCode::Render, "tiled output parent is not writable")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
    validate_render_target(spec, options.target_size)?;
    let solved = solve_spec(spec, options.target_size)?;
    let placement = large_placement(
        solved.diagnostics.bounds,
        solved.resolved_destination.reference,
        options.canvas,
        options.max_output_pixels,
    )?;
    let columns = placement.width.div_ceil(options.tile_width);
    let rows = placement.height.div_ceil(options.tile_height);
    let tile_count = rows.checked_mul(columns).ok_or_else(|| {
        TransformError::new(ErrorCode::OutputLimit, "tiled output count overflowed")
    })?;
    if tile_count == 0 || tile_count > options.max_tiles {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tiled output exceeds the tile-count ceiling",
        )
        .with_details(json!({ "tiles": tile_count, "maximum": options.max_tiles })));
    }
    let decoded = decode_media_file(source, options.source_limits, is_cancelled)?;
    let source_info = decoded.info.clone();
    let (sample_format, format, icc_policy) =
        resolve_output(&options.output, source_info.sample_format)?;
    let warp = WarpSampler::new(
        spec.content
            .warp
            .filter(|warp| warp.amount != 0.0)
            .map(|warp| build_warp_mesh(Some(warp)))
            .transpose()?,
    )?;
    let source = decoded.image.into_rgba32f();
    let use_mipmaps = options.quality != SamplingQuality::Preview
        && (warp.is_active()
            || mapping_requires_mipmaps(
                &solved.homography,
                solved.resolved_destination.quad,
                source.width(),
                source.height(),
            )?);
    let maximum_levels = if use_mipmaps {
        let bound = conservative_maximum_lod(
            &solved.homography,
            solved.resolved_destination.quad,
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
    let mut losses = output_losses(
        &options.output,
        source_info.sample_format,
        source_info.has_alpha,
    );
    let icc = match (icc_policy, decoded.icc_profile) {
        (IccPolicy::Preserve, profile) => profile,
        (IccPolicy::Discard, Some(_)) => {
            losses.push(super::MediaLoss::IccProfileDiscarded);
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
    let icc_embedded =
        icc_policy == IccPolicy::Preserve && source_info.icc_profile_sha256.is_some();
    let media = MediaOutputInfo {
        format,
        sample_format,
        color_management,
        icc_embedded,
        icc_profile_sha256: if icc_embedded {
            source_info.icc_profile_sha256.clone()
        } else {
            None
        },
        losses,
    };
    let extension = super::media::media_output_extension(&options.output);
    let mut tiles = Vec::with_capacity(tile_count as usize);
    let mut encoded_bytes = 0_u64;
    for row in 0..rows {
        for column in 0..columns {
            if is_cancelled() {
                return Err(cancelled_error());
            }
            let x = column * options.tile_width;
            let y = row * options.tile_height;
            let width = options.tile_width.min(placement.width - x);
            let height = options.tile_height.min(placement.height - y);
            let image = render_tile(
                &source,
                &solved.homography,
                solved.resolved_destination.quad,
                &warp,
                Point::new(
                    placement.origin.x + f64::from(x),
                    placement.origin.y + f64::from(y),
                ),
                width,
                height,
                options.quality,
                is_cancelled,
            )?;
            let filename = format!("tile-r{row:04}-c{column:04}.{extension}");
            let path = staging.path().join(&filename);
            let mut file = fs::File::create(&path).map_err(|error| {
                TransformError::new(ErrorCode::Render, "failed to create tiled output")
                    .with_details(json!({ "reason": error.to_string() }))
            })?;
            encode_output(
                &mut file,
                &image,
                &options.output,
                sample_format,
                icc.clone(),
            )?;
            file.sync_all().map_err(|error| {
                TransformError::new(ErrorCode::Render, "failed to sync tiled output")
                    .with_details(json!({ "reason": error.to_string() }))
            })?;
            let (bytes, sha256) = hash_regular_file(&path)?;
            encoded_bytes = encoded_bytes.checked_add(bytes).ok_or_else(|| {
                TransformError::new(ErrorCode::OutputLimit, "tiled byte count overflowed")
            })?;
            if encoded_bytes > options.max_encoded_bytes {
                return Err(TransformError::new(
                    ErrorCode::OutputLimit,
                    "tiled outputs exceed the configured encoded-byte limit",
                )
                .with_details(json!({
                    "bytes": encoded_bytes,
                    "maximum": options.max_encoded_bytes,
                })));
            }
            tiles.push(TiledMediaTile {
                row,
                column,
                x,
                y,
                width,
                height,
                filename,
                bytes,
                sha256,
            });
        }
    }
    let warnings = vec![
        match color_management {
            ColorManagement::ProfilePreservedWithoutConversion =>
                "ICC profile was embedded in each tile; interpolation used stored channel values without color conversion".to_owned(),
            ColorManagement::ProfileDiscardedWithoutConversion =>
                "ICC profile was discarded; interpolation used stored channel values without color conversion".to_owned(),
            ColorManagement::UntaggedChannelValues =>
                "source was untagged; interpolation used stored channel values".to_owned(),
        },
        "tiling bounds destination memory; the decoded source and its bounded mip pyramid remain resident"
            .to_owned(),
    ];
    let manifest = TiledMediaManifest {
        schema: TILED_MEDIA_SCHEMA.to_owned(),
        version: TILED_MEDIA_VERSION.to_owned(),
        source: source_info,
        media,
        placement,
        destination_bounds: solved.diagnostics.bounds,
        quality: options.quality,
        canvas: options.canvas,
        tile_width: options.tile_width,
        tile_height: options.tile_height,
        rows,
        columns,
        output_pixels: u64::from(placement.width) * u64::from(placement.height),
        encoded_bytes,
        tiles,
        solve: solved.diagnostics,
        warnings,
    };
    let manifest_path = staging.path().join("worldbend.tiled-media.json");
    let manifest_bytes = serde_json::to_vec_pretty(&manifest).map_err(|error| {
        TransformError::new(ErrorCode::Internal, "failed to serialize tiled manifest")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if encoded_bytes.saturating_add(manifest_bytes.len() as u64) > options.max_encoded_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tiled outputs and manifest exceed the configured encoded-byte limit",
        ));
    }
    fs::write(&manifest_path, &manifest_bytes).map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to write tiled manifest")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let manifest_sha256 = format!("{:x}", Sha256::digest(&manifest_bytes));
    if is_cancelled() {
        return Err(cancelled_error());
    }
    if !dry_run {
        publish_directory_noreplace(staging.path(), output_directory)?;
    }
    Ok(TiledMediaRenderResult {
        status: if dry_run {
            TiledMediaStatus::Ready
        } else {
            TiledMediaStatus::Written
        },
        dry_run,
        output_directory: output_directory.display().to_string(),
        manifest,
        manifest_sha256,
    })
}

fn validate_options(options: &TiledMediaRenderOptions) -> TransformResult<()> {
    super::validate_limits(options.source_limits)?;
    if options.source_limits.max_pixels > super::MAX_MEDIA_PIXELS
        || options.tile_width == 0
        || options.tile_height == 0
        || options.tile_width > 8192
        || options.tile_height > 8192
        || u64::from(options.tile_width) * u64::from(options.tile_height) > MAX_TILED_TILE_PIXELS
        || options.max_output_pixels == 0
        || options.max_output_pixels > MAX_TILED_OUTPUT_PIXELS
        || options.max_encoded_bytes == 0
        || options.max_encoded_bytes > MAX_TILED_ENCODED_BYTES
        || options.max_tiles == 0
        || options.max_tiles > MAX_TILED_TILES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tiled media options exceed the engine ceiling",
        ));
    }
    Ok(())
}

fn large_placement(
    bounds: Bounds,
    reference: Size,
    canvas: CanvasMode,
    max_pixels: u64,
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
        || width > f64::from(MAX_TILED_AXIS)
        || height > f64::from(MAX_TILED_AXIS)
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tiled canvas is empty, non-finite, or exceeds the axis ceiling",
        ));
    }
    let width = width as u32;
    let height = height as u32;
    let pixels = u64::from(width) * u64::from(height);
    if pixels > max_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tiled canvas exceeds the configured output-pixel limit",
        )
        .with_details(json!({ "pixels": pixels, "maximum": max_pixels })));
    }
    Ok(CanvasPlacement {
        origin: Point::new(origin_x, origin_y),
        width,
        height,
    })
}

#[allow(clippy::too_many_arguments)]
fn render_tile(
    source: &FloatMipPyramid,
    homography: &worldbend_core::Homography,
    destination: worldbend_core::Quad,
    warp: &WarpSampler,
    origin: Point,
    width: u32,
    height: u32,
    quality: SamplingQuality,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<FloatRgbaImage> {
    let mapping = PixelMapping {
        homography,
        warp,
        destination,
        canvas_origin: origin,
    };
    let mut output = vec![0.0_f32; width as usize * height as usize * 4];
    let row_stride = width as usize * 4;
    output.par_chunks_mut(row_stride).enumerate().try_for_each(
        |(y, row)| -> TransformResult<()> {
            if is_cancelled() {
                return Err(cancelled_error());
            }
            let mut projector =
                InversePixelProjector::new(homography, Point::new(origin.x, origin.y + y as f64));
            for (x, pixel) in row.chunks_exact_mut(4).enumerate() {
                let value = render_pixel_premultiplied(
                    source, &mapping, &projector, x as u32, y as u32, quality,
                )?;
                pixel.copy_from_slice(&straight_alpha_f32(value));
                projector.advance_x();
            }
            Ok(())
        },
    )?;
    ImageBuffer::<Rgba<f32>, Vec<f32>>::from_raw(width, height, output).ok_or_else(|| {
        TransformError::new(
            ErrorCode::Internal,
            "tiled output allocation shape is invalid",
        )
    })
}

fn hash_regular_file(path: &Path) -> TransformResult<(u64, String)> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to inspect tiled output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "tiled output must be a regular file",
        ));
    }
    let mut file = fs::File::open(path).map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to reopen tiled output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| {
            TransformError::new(ErrorCode::Render, "failed to hash tiled output")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok((metadata.len(), format!("{:x}", hasher.finalize())))
}

fn cancelled_error() -> TransformError {
    TransformError::new(ErrorCode::Cancelled, "tiled media render was cancelled")
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, RgbaImage};
    use tempfile::tempdir;
    use worldbend_core::Quad;

    fn limits() -> RenderLimits {
        RenderLimits {
            max_width: 64,
            max_height: 64,
            max_pixels: 4096,
            max_source_bytes: 1024 * 1024,
        }
    }

    fn options(tile_width: u32, tile_height: u32) -> TiledMediaRenderOptions {
        TiledMediaRenderOptions {
            quality: SamplingQuality::Standard,
            canvas: CanvasMode::Reference,
            target_size: None,
            source_limits: limits(),
            tile_width,
            tile_height,
            max_output_pixels: 1_000_000,
            max_encoded_bytes: 16 * 1024 * 1024,
            max_tiles: MAX_TILED_TILES,
            output: MediaOutput::Png {
                precision: super::super::OutputPrecision::U8,
                icc: IccPolicy::Discard,
            },
        }
    }

    fn rectangle(width: f64, height: f64) -> Quad {
        Quad::new(
            Point::new(0.0, 0.0),
            Point::new(width, 0.0),
            Point::new(width, height),
            Point::new(0.0, height),
        )
    }

    #[test]
    fn tiles_match_identity_source_without_seams_and_publish_manifest_atomically() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        let output = directory.path().join("tiles");
        let source = RgbaImage::from_fn(4, 2, |x, y| {
            Rgba([(x * 40) as u8, (y * 100) as u8, 30, 255])
        });
        DynamicImage::ImageRgba8(source.clone())
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let spec = TransformSpec::pixel(Size::new(4.0, 2.0), rectangle(4.0, 2.0));
        let result =
            render_tiled_media_directory(&source_path, &spec, &output, options(2, 1), false)
                .unwrap();
        assert_eq!(result.status, TiledMediaStatus::Written);
        assert_eq!(result.manifest.tiles.len(), 4);
        assert!(output.join("worldbend.tiled-media.json").is_file());
        for tile in &result.manifest.tiles {
            let decoded = image::open(output.join(&tile.filename))
                .unwrap()
                .into_rgba8();
            assert_eq!(decoded.dimensions(), (tile.width, tile.height));
            for y in 0..tile.height {
                for x in 0..tile.width {
                    assert_eq!(
                        decoded.get_pixel(x, y),
                        source.get_pixel(tile.x + x, tile.y + y)
                    );
                }
            }
        }
    }

    #[test]
    fn supports_axis_above_full_frame_limit_without_allocating_one_canvas() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        DynamicImage::new_rgba8(1, 1)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let spec = TransformSpec::pixel(Size::new(40_000.0, 1.0), rectangle(40_000.0, 1.0));
        let mut options = options(8192, 1);
        options.max_output_pixels = 40_000;
        let result = render_tiled_media_directory(
            &source_path,
            &spec,
            &directory.path().join("tiles"),
            options,
            true,
        )
        .unwrap();
        assert_eq!(result.manifest.placement.width, 40_000);
        assert_eq!(result.manifest.columns, 5);
        assert!(!directory.path().join("tiles").exists());
    }

    #[test]
    fn cancellation_publishes_no_partial_directory() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        DynamicImage::new_rgba8(2, 2)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let output = directory.path().join("tiles");
        let error = render_tiled_media_directory_with_cancel(
            &source_path,
            &TransformSpec::pixel(Size::new(2.0, 2.0), rectangle(2.0, 2.0)),
            &output,
            options(1, 1),
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }

    #[test]
    fn normalized_destination_requires_an_explicit_target_size() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        DynamicImage::new_rgba8(2, 2)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let spec = TransformSpec::normalized(rectangle(1.0, 1.0));
        let error = render_tiled_media_directory(
            &source_path,
            &spec,
            &directory.path().join("tiles"),
            options(1, 1),
            true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }

    #[test]
    fn rejects_a_single_tile_that_exceeds_the_memory_ceiling() {
        let mut options = options(4096, 4096);
        options.max_output_pixels = MAX_TILED_OUTPUT_PIXELS;
        let error = validate_options(&options).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn tiff_and_jpeg_tiles_use_the_declared_encoding_and_extension() {
        let directory = tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        DynamicImage::new_rgba8(2, 2)
            .save_with_format(&source_path, ImageFormat::Png)
            .unwrap();
        let spec = TransformSpec::pixel(Size::new(2.0, 2.0), rectangle(2.0, 2.0));
        let cases = [
            (
                MediaOutput::Tiff {
                    precision: super::super::OutputPrecision::U16,
                    icc: IccPolicy::Discard,
                },
                "tiff",
                ImageFormat::Tiff,
            ),
            (
                MediaOutput::Jpeg {
                    quality: 90,
                    matte: [255, 255, 255],
                    icc: IccPolicy::Discard,
                },
                "jpg",
                ImageFormat::Jpeg,
            ),
        ];
        for (index, (output_format, extension, image_format)) in cases.into_iter().enumerate() {
            let output = directory.path().join(format!("tiles-{index}"));
            let mut render_options = options(1, 1);
            render_options.output = output_format;
            let result =
                render_tiled_media_directory(&source_path, &spec, &output, render_options, false)
                    .unwrap();
            for tile in result.manifest.tiles {
                assert!(tile.filename.ends_with(&format!(".{extension}")));
                assert_eq!(
                    image::ImageReader::open(output.join(tile.filename))
                        .unwrap()
                        .with_guessed_format()
                        .unwrap()
                        .format(),
                    Some(image_format)
                );
            }
        }
    }
}
