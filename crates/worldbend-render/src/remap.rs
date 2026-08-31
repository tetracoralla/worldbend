use crate::{
    FileRenderStatus, RenderLimits, SamplingQuality,
    file_io::{decode_file_with_limits, persist_temporary, write_png},
    preflight_destination, validate_limits,
};
use image::{DynamicImage, Rgba, RgbaImage};
use rayon::prelude::*;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
    time::Instant,
};
use worldbend_core::{
    ErrorCode, LensCoefficients, LensScale, RemapBoundary, RemapChannel, RemapOperation, RemapPlan,
    RemapSpec, TransformError, TransformResult, plan_remap,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

fn positive_u32_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": u32::MAX })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemapRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for RemapRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug)]
pub struct RenderedRemap {
    pub image: RgbaImage,
    pub plan: RemapPlan,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemapEvidence {
    pub source_sha256: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map_sha256: Option<String>,
    pub output_sha256: String,
    #[schemars(schema_with = "positive_u32_schema")]
    pub output_width: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub output_height: u32,
    pub output_format: String,
    pub decode_ms: f64,
    pub render_ms: f64,
    pub encode_ms: f64,
    pub total_ms: f64,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemapFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RemapEvidence,
    pub plan: RemapPlan,
}

#[derive(Debug, Clone)]
pub struct RemapFileMap {
    pub path: PathBuf,
    pub sha256: Option<String>,
}

pub fn render_remap(
    source: &DynamicImage,
    map: Option<&DynamicImage>,
    spec: &RemapSpec,
    options: RemapRenderOptions,
) -> TransformResult<RenderedRemap> {
    render_remap_with_cancel(source, map, spec, options, &|| false)
}

pub fn render_remap_with_cancel(
    source: &DynamicImage,
    map: Option<&DynamicImage>,
    spec: &RemapSpec,
    options: RemapRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedRemap> {
    validate_limits(options.limits)?;
    let plan = plan_remap(spec)?;
    let pixels = plan.output_pixels;
    if spec.output.width > options.limits.max_width
        || spec.output.height > options.limits.max_height
        || pixels > options.limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "remap output exceeds configured render limits",
        ));
    }
    if plan.requires_map != map.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            if plan.requires_map {
                "displacement remap requires exactly one map raster"
            } else {
                "lens remap must not include a map raster"
            },
        ));
    }
    validate_image(source, options.limits, "source")?;
    if let Some(map) = map {
        validate_image(map, options.limits, "map")?;
    }
    let source = source.to_rgba8();
    let map = map.map(DynamicImage::to_rgba8);
    let mut output = RgbaImage::new(spec.output.width, spec.output.height);
    let row_stride = usize::try_from(spec.output.width)
        .unwrap()
        .saturating_mul(4);
    output
        .as_mut()
        .par_chunks_mut(row_stride)
        .enumerate()
        .try_for_each(|(y, row)| -> TransformResult<()> {
            if is_cancelled() {
                return Err(TransformError::new(
                    ErrorCode::Cancelled,
                    "remap was cancelled",
                ));
            }
            for (x, pixel) in row.chunks_exact_mut(4).enumerate() {
                let u = (x as f64 + 0.5) / f64::from(spec.output.width);
                let v = (y as f64 + 0.5) / f64::from(spec.output.height);
                let (source_x, source_y, boundary) = match spec.operation {
                    RemapOperation::Lens {
                        coefficients,
                        center,
                        scale,
                    } => {
                        let (su, sv) = lens_output_to_source(u, v, coefficients, center, scale);
                        (
                            su * f64::from(source.width()) - 0.5,
                            sv * f64::from(source.height()) - 0.5,
                            RemapBoundary::Transparent,
                        )
                    }
                    RemapOperation::Displacement {
                        x_channel,
                        y_channel,
                        scale_x_pixels,
                        scale_y_pixels,
                        neutral,
                        boundary,
                    } => {
                        let map = map.as_ref().expect("map presence validated above");
                        let map_pixel = sample_map(map, u, v);
                        let neutral = f64::from(neutral) / 255.0;
                        let dx = (channel_value(map_pixel, x_channel) - neutral) * scale_x_pixels;
                        let dy = (channel_value(map_pixel, y_channel) - neutral) * scale_y_pixels;
                        (
                            u * f64::from(source.width()) - 0.5 + dx,
                            v * f64::from(source.height()) - 0.5 + dy,
                            boundary,
                        )
                    }
                };
                let sampled = match options.quality {
                    SamplingQuality::Preview => {
                        sample_nearest(&source, source_x, source_y, boundary)
                    }
                    SamplingQuality::Standard => {
                        sample_linear(&source, source_x, source_y, boundary)
                    }
                    SamplingQuality::High => sample_cubic(&source, source_x, source_y, boundary),
                };
                pixel.copy_from_slice(&sampled.0);
            }
            Ok(())
        })?;
    Ok(RenderedRemap {
        image: output,
        plan,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn render_remap_file_with_cancel(
    source: &Path,
    source_sha256: Option<&str>,
    map: Option<&RemapFileMap>,
    spec: &RemapSpec,
    output: &Path,
    options: RemapRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RemapFileRenderResult> {
    let total_started = Instant::now();
    let plan = plan_remap(spec)?;
    if plan.requires_map != map.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "remap map presence does not match the selected operation",
        ));
    }
    preflight_destination(output, overwrite)?;
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let decode_started = Instant::now();
    let (source, source_sha256, mut warnings) =
        decode_file_with_limits(source, options.limits, source_sha256)?;
    let (map_image, map_sha256) = match map {
        Some(map) => {
            let (image, sha256, map_warnings) =
                decode_file_with_limits(&map.path, options.limits, map.sha256.as_deref())?;
            warnings.extend(
                map_warnings
                    .into_iter()
                    .map(|warning| format!("map: {warning}")),
            );
            (Some(image), Some(sha256))
        }
        None => (None, None),
    };
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let render_started = Instant::now();
    let rendered =
        render_remap_with_cancel(&source, map_image.as_ref(), spec, options, is_cancelled)?;
    let render_ms = render_started.elapsed().as_secs_f64() * 1000.0;
    let encode_started = Instant::now();
    let mut writer = HashingWriter::new(temporary.as_file_mut());
    write_png(&rendered.image, &mut writer)?;
    writer.flush().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to flush remap output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = writer.finish();
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync remap output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "remap was cancelled",
        ));
    }
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }
    Ok(RemapFileRenderResult {
        status: if dry_run {
            FileRenderStatus::Ready
        } else {
            FileRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        bytes,
        evidence: RemapEvidence {
            source_sha256,
            map_sha256,
            output_sha256,
            output_width: rendered.image.width(),
            output_height: rendered.image.height(),
            output_format: "png".to_owned(),
            decode_ms,
            render_ms,
            encode_ms,
            total_ms: total_started.elapsed().as_secs_f64() * 1000.0,
            warnings,
        },
        plan,
    })
}

fn validate_image(image: &DynamicImage, limits: RenderLimits, label: &str) -> TransformResult<()> {
    let pixels = u64::from(image.width()) * u64::from(image.height());
    if image.width() == 0
        || image.height() == 0
        || image.width() > limits.max_width
        || image.height() > limits.max_height
        || pixels > limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            format!("{label} raster exceeds configured remap limits"),
        ));
    }
    Ok(())
}

fn lens_output_to_source(
    u: f64,
    v: f64,
    coefficients: LensCoefficients,
    center: worldbend_core::Point,
    scale: LensScale,
) -> (f64, f64) {
    let x = (u - center.x) / scale.x;
    let y = (v - center.y) / scale.y;
    let r2 = x * x + y * y;
    let radial =
        1.0 + coefficients.k1 * r2 + coefficients.k2 * r2 * r2 + coefficients.k3 * r2 * r2 * r2;
    let distorted_x =
        x * radial + 2.0 * coefficients.p1 * x * y + coefficients.p2 * (r2 + 2.0 * x * x);
    let distorted_y =
        y * radial + coefficients.p1 * (r2 + 2.0 * y * y) + 2.0 * coefficients.p2 * x * y;
    (
        center.x + distorted_x * scale.x,
        center.y + distorted_y * scale.y,
    )
}

fn sample_map(map: &RgbaImage, u: f64, v: f64) -> [f64; 4] {
    let x = u * f64::from(map.width()) - 0.5;
    let y = v * f64::from(map.height()) - 0.5;
    let x0 = x.floor();
    let y0 = y.floor();
    let tx = x - x0;
    let ty = y - y0;
    let mut output = [0.0; 4];
    for (px, py, weight) in [
        (x0, y0, (1.0 - tx) * (1.0 - ty)),
        (x0 + 1.0, y0, tx * (1.0 - ty)),
        (x0, y0 + 1.0, (1.0 - tx) * ty),
        (x0 + 1.0, y0 + 1.0, tx * ty),
    ] {
        let pixel = map.get_pixel(
            px.clamp(0.0, f64::from(map.width() - 1)) as u32,
            py.clamp(0.0, f64::from(map.height() - 1)) as u32,
        );
        for channel in 0..4 {
            output[channel] += f64::from(pixel[channel]) / 255.0 * weight;
        }
    }
    output
}

fn channel_value(pixel: [f64; 4], channel: RemapChannel) -> f64 {
    match channel {
        RemapChannel::Red => pixel[0],
        RemapChannel::Green => pixel[1],
        RemapChannel::Blue => pixel[2],
        RemapChannel::Alpha => pixel[3],
        RemapChannel::Luminance => pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722,
    }
}

fn coordinate(value: i64, size: u32, boundary: RemapBoundary) -> Option<u32> {
    match boundary {
        RemapBoundary::Transparent => (0..i64::from(size))
            .contains(&value)
            .then_some(value as u32),
        RemapBoundary::Clamp => Some(value.clamp(0, i64::from(size) - 1) as u32),
        RemapBoundary::Wrap => Some(value.rem_euclid(i64::from(size)) as u32),
    }
}

fn sample_nearest(image: &RgbaImage, x: f64, y: f64, boundary: RemapBoundary) -> Rgba<u8> {
    let Some(x) = coordinate(x.round() as i64, image.width(), boundary) else {
        return Rgba([0, 0, 0, 0]);
    };
    let Some(y) = coordinate(y.round() as i64, image.height(), boundary) else {
        return Rgba([0, 0, 0, 0]);
    };
    *image.get_pixel(x, y)
}

fn sample_linear(image: &RgbaImage, x: f64, y: f64, boundary: RemapBoundary) -> Rgba<u8> {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x0 as f64;
    let ty = y - y0 as f64;
    let mut premultiplied = [0.0; 3];
    let mut alpha = 0.0;
    for (px, py, weight) in [
        (x0, y0, (1.0 - tx) * (1.0 - ty)),
        (x0 + 1, y0, tx * (1.0 - ty)),
        (x0, y0 + 1, (1.0 - tx) * ty),
        (x0 + 1, y0 + 1, tx * ty),
    ] {
        let Some(px) = coordinate(px, image.width(), boundary) else {
            continue;
        };
        let Some(py) = coordinate(py, image.height(), boundary) else {
            continue;
        };
        let pixel = image.get_pixel(px, py);
        let sample_alpha = f64::from(pixel[3]) / 255.0;
        alpha += sample_alpha * weight;
        for channel in 0..3 {
            premultiplied[channel] += f64::from(pixel[channel]) * sample_alpha * weight;
        }
    }
    straight_alpha(premultiplied, alpha)
}

fn sample_cubic(image: &RgbaImage, x: f64, y: f64, boundary: RemapBoundary) -> Rgba<u8> {
    let base_x = x.floor() as i64;
    let base_y = y.floor() as i64;
    let mut premultiplied = [0.0; 3];
    let mut alpha = 0.0;
    for offset_y in -1..=2 {
        let sample_y = base_y + offset_y;
        let weight_y = catmull_rom(y - sample_y as f64);
        let Some(sample_y) = coordinate(sample_y, image.height(), boundary) else {
            continue;
        };
        for offset_x in -1..=2 {
            let sample_x = base_x + offset_x;
            let weight = catmull_rom(x - sample_x as f64) * weight_y;
            let Some(sample_x) = coordinate(sample_x, image.width(), boundary) else {
                continue;
            };
            let pixel = image.get_pixel(sample_x, sample_y);
            let sample_alpha = f64::from(pixel[3]) / 255.0;
            alpha += sample_alpha * weight;
            for channel in 0..3 {
                premultiplied[channel] += f64::from(pixel[channel]) * sample_alpha * weight;
            }
        }
    }
    straight_alpha(premultiplied, alpha)
}

fn catmull_rom(distance: f64) -> f64 {
    let distance = distance.abs();
    if distance <= 1.0 {
        1.5 * distance.powi(3) - 2.5 * distance.powi(2) + 1.0
    } else if distance < 2.0 {
        -0.5 * distance.powi(3) + 2.5 * distance.powi(2) - 4.0 * distance + 2.0
    } else {
        0.0
    }
}

fn straight_alpha(premultiplied: [f64; 3], alpha: f64) -> Rgba<u8> {
    let alpha = alpha.clamp(0.0, 1.0);
    let mut output = [0_u8; 4];
    if alpha > 1.0e-12 {
        for channel in 0..3 {
            output[channel] = (premultiplied[channel] / alpha).round().clamp(0.0, 255.0) as u8;
        }
    }
    output[3] = (alpha * 255.0).round() as u8;
    Rgba(output)
}

struct HashingWriter<W> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}

impl<W> HashingWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes: 0,
        }
    }
    fn finish(self) -> (u64, String) {
        (self.bytes, format!("{:x}", self.hasher.finalize()))
    }
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.bytes = self.bytes.saturating_add(written as u64);
        Ok(written)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{PixelSize, Point, REMAP_SCHEMA, REMAP_VERSION};

    fn lens() -> RemapSpec {
        RemapSpec {
            schema: REMAP_SCHEMA.to_owned(),
            version: REMAP_VERSION.to_owned(),
            output: PixelSize::new(3, 3),
            operation: RemapOperation::Lens {
                coefficients: LensCoefficients {
                    k1: 0.0,
                    k2: 0.0,
                    k3: 0.0,
                    p1: 0.0,
                    p2: 0.0,
                },
                center: Point::new(0.5, 0.5),
                scale: LensScale { x: 0.5, y: 0.5 },
            },
        }
    }

    #[test]
    fn zero_lens_is_identity_and_displacement_requires_map() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(3, 3, |x, y| {
            Rgba([(x * 40) as u8, (y * 40) as u8, 9, 255])
        }));
        assert_eq!(
            render_remap(&source, None, &lens(), Default::default())
                .unwrap()
                .image,
            source.to_rgba8()
        );
        let mut displacement = lens();
        displacement.operation = RemapOperation::Displacement {
            x_channel: RemapChannel::Red,
            y_channel: RemapChannel::Green,
            scale_x_pixels: 2.0,
            scale_y_pixels: 2.0,
            neutral: 128,
            boundary: RemapBoundary::Transparent,
        };
        assert_eq!(
            render_remap(&source, None, &displacement, Default::default())
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn neutral_displacement_is_identity_and_boundary_modes_are_explicit() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 3, Rgba([8, 7, 6, 255])));
        let map = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([128, 128, 0, 255])));
        let mut spec = lens();
        spec.operation = RemapOperation::Displacement {
            x_channel: RemapChannel::Red,
            y_channel: RemapChannel::Green,
            scale_x_pixels: 100.0,
            scale_y_pixels: 100.0,
            neutral: 128,
            boundary: RemapBoundary::Clamp,
        };
        assert_eq!(
            render_remap(&source, Some(&map), &spec, Default::default())
                .unwrap()
                .image,
            source.to_rgba8()
        );
    }

    #[test]
    fn high_quality_uses_distinct_cubic_reconstruction() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(7, 7, |x, y| {
            Rgba([
                ((x * 31 + y * 7) % 256) as u8,
                ((x * x * 13 + y * 19) % 256) as u8,
                ((x * 5 + y * y * 17) % 256) as u8,
                if (x + y) % 3 == 0 { 96 } else { 255 },
            ])
        }));
        let mut spec = lens();
        spec.output = PixelSize::new(9, 9);
        spec.operation = RemapOperation::Lens {
            coefficients: LensCoefficients {
                k1: 0.35,
                k2: -0.08,
                k3: 0.01,
                p1: 0.015,
                p2: -0.01,
            },
            center: Point::new(0.43, 0.57),
            scale: LensScale { x: 0.54, y: 0.47 },
        };

        let standard = render_remap(
            &source,
            None,
            &spec,
            RemapRenderOptions {
                quality: SamplingQuality::Standard,
                ..Default::default()
            },
        )
        .unwrap()
        .image;
        let high = render_remap(
            &source,
            None,
            &spec,
            RemapRenderOptions {
                quality: SamplingQuality::High,
                ..Default::default()
            },
        )
        .unwrap()
        .image;

        assert_ne!(standard, high);
    }
}
