use crate::file_io::{decode_file_with_limits, write_png};
use crate::{
    CanvasMode, RenderLimits, RenderOptions, SamplingQuality, render_rgba_image_with_cancel,
    validate_limits,
};
use image::{DynamicImage, Rgba, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Write},
    path::Path,
};
use worldbend_core::{
    CanvasBackground, CanvasOperation, CanvasOperationKind, CanvasPlan, CanvasSetPlan,
    CanvasSetSpec, ErrorCode, MAX_CANVAS_AXIS, MAX_CANVAS_PIXELS, MAX_CANVAS_SET_PIXELS, PixelRect,
    PixelSize, Point, Quad, Srgb8Space, TransformError, TransformResult, TransformSpec,
    resolve_canvas_set, resolve_trim_rect_rgba_with_cancel,
};
#[cfg(feature = "program")]
use worldbend_core::{CanvasSpec, resolve_canvas};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CanvasReplaySampling {
    Linear,
    Nearest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasReplayOptions {
    pub sampling: CanvasReplaySampling,
    pub outside_fill: [u8; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasSetRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[schemars(schema_with = "positive_json_u64_schema")]
    pub max_cumulative_pixels: u64,
}

impl Default for CanvasSetRenderOptions {
    fn default() -> Self {
        let limits = RenderLimits {
            max_pixels: MAX_CANVAS_PIXELS,
            ..RenderLimits::default()
        };
        Self {
            quality: SamplingQuality::Standard,
            limits,
            max_cumulative_pixels: MAX_CANVAS_SET_PIXELS,
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum CanvasSetProgram<'a> {
    Spec(&'a CanvasSetSpec),
    Plan {
        plan: &'a CanvasSetPlan,
        replay: CanvasReplayOptions,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CanvasSetRenderStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasSetRenderedItem {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    #[schemars(length(min = 64, max = 64), regex(pattern = r"^[0-9a-f]{64}$"))]
    pub sha256: String,
    #[schemars(schema_with = "positive_u32_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasSetFileRenderResult {
    pub status: CanvasSetRenderStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub plan: CanvasSetPlan,
    #[schemars(length(min = 1, max = 16))]
    pub items: Vec<CanvasSetRenderedItem>,
}

fn positive_json_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": MAX_CANVAS_SET_PIXELS })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

fn positive_u32_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": MAX_CANVAS_AXIS })
}

pub fn resolve_canvas_set_for_image(
    source: &DynamicImage,
    spec: &CanvasSetSpec,
) -> TransformResult<CanvasSetPlan> {
    let rgba = source.to_rgba8();
    resolve_canvas_set_for_rgba(&rgba, spec, &|| false)
}

fn resolve_canvas_set_for_rgba(
    source: &RgbaImage,
    spec: &CanvasSetSpec,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<CanvasSetPlan> {
    let source_size = PixelSize::new(source.width(), source.height());
    let resolved_trims = spec
        .variants
        .iter()
        .map(|variant| match variant.operation {
            CanvasOperation::Trim { alpha_threshold } => resolve_trim_rect_rgba_with_cancel(
                source.as_raw(),
                source_size,
                alpha_threshold,
                is_cancelled,
            )
            .map(Some),
            _ => Ok(None),
        })
        .collect::<TransformResult<Vec<_>>>()?;
    resolve_canvas_set(spec, source_size, &resolved_trims)
}

pub fn render_canvas_set_to_directory(
    source: &DynamicImage,
    program: CanvasSetProgram<'_>,
    staging_directory: &Path,
    output_directory_label: &str,
    options: CanvasSetRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<CanvasSetFileRenderResult> {
    validate_limits(options.limits)?;
    if options.max_cumulative_pixels == 0 || options.max_cumulative_pixels > MAX_CANVAS_SET_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Canvas cumulative pixel limit exceeds the product ceiling",
        ));
    }
    if !staging_directory.is_dir() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "Canvas staging directory must exist",
        ));
    }
    let source = source.to_rgba8();
    let source_size = PixelSize::new(source.width(), source.height());
    let (plan, replay) = match program {
        CanvasSetProgram::Spec(spec) => (
            resolve_canvas_set_for_rgba(&source, spec, is_cancelled)?,
            None,
        ),
        CanvasSetProgram::Plan { plan, replay } => {
            plan.validate_for_source(source_size)?;
            (plan.clone(), Some(replay))
        }
    };
    validate_plan_limits(&plan, options)?;

    let mut items = Vec::with_capacity(plan.variants.len());
    for variant in &plan.variants {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        let rendered = match replay {
            Some(replay) => replay_plan(&source, &variant.plan, replay, is_cancelled)?,
            None => render_primary_plan(&source, &variant.plan, options, is_cancelled)?,
        };
        let filename = format!("{}.png", variant.id);
        let path = staging_directory.join(&filename);
        let file = fs::File::create(&path).map_err(render_io("failed to create Canvas output"))?;
        let mut writer = HashingWriter::new(file);
        write_png(&rendered, &mut writer)?;
        writer
            .flush()
            .map_err(render_io("failed to flush Canvas output"))?;
        writer
            .inner
            .sync_all()
            .map_err(render_io("failed to sync Canvas output"))?;
        if is_cancelled() {
            return Err(cancelled_error());
        }
        let (bytes, sha256) = writer.finish();
        items.push(CanvasSetRenderedItem {
            id: variant.id.clone(),
            output: join_output_label(output_directory_label, &filename),
            bytes,
            sha256,
            width: rendered.width(),
            height: rendered.height(),
        });
    }

    if is_cancelled() {
        return Err(cancelled_error());
    }
    Ok(CanvasSetFileRenderResult {
        status: CanvasSetRenderStatus::Ready,
        dry_run: true,
        output_directory: output_directory_label.to_owned(),
        plan,
        items,
    })
}

pub fn render_canvas_set_file(
    source: &Path,
    program: CanvasSetProgram<'_>,
    output_directory: &Path,
    options: CanvasSetRenderOptions,
    dry_run: bool,
) -> TransformResult<CanvasSetFileRenderResult> {
    match program {
        CanvasSetProgram::Spec(spec) => spec.validate()?,
        CanvasSetProgram::Plan { plan, .. } => plan.validate_for_source(plan.source_size)?,
    }
    preflight_output_directory(output_directory)?;
    let parent = output_directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-canvas-")
        .tempdir_in(parent)
        .map_err(render_io("failed to create Canvas staging directory"))?;
    let (source, _, _) = decode_file_with_limits(source, options.limits, None)?;
    let label = output_directory.display().to_string();
    let mut result =
        render_canvas_set_to_directory(&source, program, staging.path(), &label, options, &|| {
            false
        })?;
    if !dry_run {
        if output_directory.exists() {
            return Err(TransformError::new(
                ErrorCode::DestinationExists,
                "Canvas output directory already exists",
            ));
        }
        publish_directory_noreplace(staging.path(), output_directory)?;
        result.status = CanvasSetRenderStatus::Written;
        result.dry_run = false;
    }
    Ok(result)
}

fn validate_plan_limits(
    plan: &CanvasSetPlan,
    options: CanvasSetRenderOptions,
) -> TransformResult<()> {
    let mut cumulative = 0_u64;
    for variant in &plan.variants {
        let size = variant.plan.output_size;
        let pixels = u64::from(size.width) * u64::from(size.height);
        if size.width > options.limits.max_width
            || size.height > options.limits.max_height
            || pixels > options.limits.max_pixels
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Canvas variant exceeds configured output limits",
            )
            .with_details(json!({ "id": variant.id, "width": size.width, "height": size.height, "pixels": pixels })));
        }
        cumulative = cumulative.checked_add(pixels).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "Canvas cumulative pixels overflowed",
            )
        })?;
    }
    if cumulative > options.max_cumulative_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Canvas Set exceeds the configured cumulative output pixel limit",
        )
        .with_details(json!({ "pixels": cumulative, "maximum": options.max_cumulative_pixels })));
    }
    Ok(())
}

pub(crate) fn render_primary_plan(
    source: &RgbaImage,
    plan: &CanvasPlan,
    options: CanvasSetRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    match plan.operation {
        CanvasOperationKind::Crop | CanvasOperationKind::Trim => {
            render_exact_crop(source, plan.source_rect, is_cancelled)
        }
        CanvasOperationKind::Pad => render_exact_pad(source, plan, is_cancelled),
        CanvasOperationKind::Contain
        | CanvasOperationKind::Cover
        | CanvasOperationKind::Stretch => {
            let quad = placement_quad(plan);
            let spec = TransformSpec::pixel(plan.output_size.as_size(), quad);
            let rendered = render_rgba_image_with_cancel(
                source,
                &spec,
                RenderOptions {
                    quality: options.quality,
                    canvas: CanvasMode::Reference,
                    target_size: None,
                    limits: options.limits,
                },
                is_cancelled,
            )?
            .image;
            composite_background(rendered, plan.background, is_cancelled)
        }
    }
}

#[cfg(feature = "program")]
pub(crate) fn resolve_canvas_for_rgba(
    source: &RgbaImage,
    spec: &CanvasSpec,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<CanvasPlan> {
    let source_size = PixelSize::new(source.width(), source.height());
    let resolved_trim = match spec.operation {
        CanvasOperation::Trim { alpha_threshold } => Some(resolve_trim_rect_rgba_with_cancel(
            source.as_raw(),
            source_size,
            alpha_threshold,
            is_cancelled,
        )?),
        _ => None,
    };
    resolve_canvas(spec, source_size, resolved_trim)
}

fn render_exact_crop(
    source: &RgbaImage,
    rect: PixelRect,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    let mut output = RgbaImage::new(rect.width, rect.height);
    for y in 0..rect.height {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        for x in 0..rect.width {
            output.put_pixel(x, y, *source.get_pixel(rect.x + x, rect.y + y));
        }
    }
    Ok(output)
}

fn render_exact_pad(
    source: &RgbaImage,
    plan: &CanvasPlan,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    let background = background_pixel(plan.background);
    let mut output =
        RgbaImage::from_pixel(plan.output_size.width, plan.output_size.height, background);
    let offset_x = plan.placement.x as u32;
    let offset_y = plan.placement.y as u32;
    for y in 0..source.height() {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        for x in 0..source.width() {
            let foreground = *source.get_pixel(x, y);
            let pixel = if background[3] == 0 {
                foreground
            } else {
                source_over(foreground, background)
            };
            output.put_pixel(offset_x + x, offset_y + y, pixel);
        }
    }
    Ok(output)
}

fn composite_background(
    mut image: RgbaImage,
    background: Option<CanvasBackground>,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    let background = background_pixel(background);
    if background[3] == 0 {
        return Ok(image);
    }
    for y in 0..image.height() {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        for x in 0..image.width() {
            let pixel = image.get_pixel_mut(x, y);
            *pixel = source_over(*pixel, background);
        }
    }
    Ok(image)
}

fn replay_plan(
    source: &RgbaImage,
    plan: &CanvasPlan,
    replay: CanvasReplayOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    plan.validate_for_source(PixelSize::new(source.width(), source.height()))?;
    let mut output = RgbaImage::from_pixel(
        plan.output_size.width,
        plan.output_size.height,
        Rgba(replay.outside_fill),
    );
    for y in 0..output.height() {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        let destination_y = y as f64 + 0.5;
        for x in 0..output.width() {
            let destination_x = x as f64 + 0.5;
            if destination_x < plan.placement.x
                || destination_x >= plan.placement.x + plan.placement.width
                || destination_y < plan.placement.y
                || destination_y >= plan.placement.y + plan.placement.height
            {
                continue;
            }
            let source_edge_x =
                plan.source_rect.x as f64 + (destination_x - plan.placement.x) / plan.scale.x;
            let source_edge_y =
                plan.source_rect.y as f64 + (destination_y - plan.placement.y) / plan.scale.y;
            if source_edge_x < plan.source_rect.x as f64
                || source_edge_x >= (plan.source_rect.x + plan.source_rect.width) as f64
                || source_edge_y < plan.source_rect.y as f64
                || source_edge_y >= (plan.source_rect.y + plan.source_rect.height) as f64
            {
                continue;
            }
            let pixel = match replay.sampling {
                CanvasReplaySampling::Nearest => {
                    sample_nearest(source, source_edge_x, source_edge_y)
                }
                CanvasReplaySampling::Linear => {
                    sample_linear(source, source_edge_x - 0.5, source_edge_y - 0.5)
                }
            };
            output.put_pixel(x, y, pixel);
        }
    }
    Ok(output)
}

fn sample_nearest(source: &RgbaImage, edge_x: f64, edge_y: f64) -> Rgba<u8> {
    *source.get_pixel(
        (edge_x.floor() as u32).min(source.width() - 1),
        (edge_y.floor() as u32).min(source.height() - 1),
    )
}

fn sample_linear(source: &RgbaImage, x: f64, y: f64) -> Rgba<u8> {
    let x0 = x.floor() as i64;
    let y0 = y.floor() as i64;
    let tx = x - x0 as f64;
    let ty = y - y0 as f64;
    let samples = [
        (x0, y0, (1.0 - tx) * (1.0 - ty)),
        (x0 + 1, y0, tx * (1.0 - ty)),
        (x0, y0 + 1, (1.0 - tx) * ty),
        (x0 + 1, y0 + 1, tx * ty),
    ];
    let mut premultiplied = [0.0_f64; 3];
    let mut alpha = 0.0_f64;
    for (px, py, weight) in samples {
        let px = px.clamp(0, source.width() as i64 - 1) as u32;
        let py = py.clamp(0, source.height() as i64 - 1) as u32;
        let pixel = source.get_pixel(px, py);
        let sample_alpha = pixel[3] as f64 / 255.0;
        alpha += sample_alpha * weight;
        for channel in 0..3 {
            premultiplied[channel] += pixel[channel] as f64 * sample_alpha * weight;
        }
    }
    let mut result = [0_u8; 4];
    if alpha > 0.0 {
        for channel in 0..3 {
            result[channel] = (premultiplied[channel] / alpha).round().clamp(0.0, 255.0) as u8;
        }
    }
    result[3] = (alpha * 255.0).round().clamp(0.0, 255.0) as u8;
    Rgba(result)
}

fn placement_quad(plan: &CanvasPlan) -> Quad {
    let left = plan.placement.x;
    let top = plan.placement.y;
    let right = left + plan.placement.width;
    let bottom = top + plan.placement.height;
    Quad::new(
        Point::new(left, top),
        Point::new(right, top),
        Point::new(right, bottom),
        Point::new(left, bottom),
    )
}

fn background_pixel(background: Option<CanvasBackground>) -> Rgba<u8> {
    match background.unwrap_or(CanvasBackground::Transparent {}) {
        CanvasBackground::Transparent {} => Rgba([0, 0, 0, 0]),
        CanvasBackground::Color {
            space: Srgb8Space::Srgb8,
            rgba,
        } => Rgba(rgba),
    }
}

fn source_over(foreground: Rgba<u8>, background: Rgba<u8>) -> Rgba<u8> {
    let fa = foreground[3] as u32;
    let ba = background[3] as u32;
    let inverse_fa = 255 - fa;
    let out_a = fa + (ba * inverse_fa + 127) / 255;
    if out_a == 0 {
        return Rgba([0, 0, 0, 0]);
    }
    let mut output = [0_u8; 4];
    for channel in 0..3 {
        let premultiplied = foreground[channel] as u32 * fa
            + (background[channel] as u32 * ba * inverse_fa + 127) / 255;
        output[channel] = ((premultiplied + out_a / 2) / out_a).min(255) as u8;
    }
    output[3] = out_a.min(255) as u8;
    Rgba(output)
}

pub(crate) fn preflight_output_directory(output: &Path) -> TransformResult<()> {
    let parent = output
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    if !parent.is_dir() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "Canvas output parent must be an existing directory",
        ));
    }
    match fs::symlink_metadata(output) {
        Ok(_) => Err(TransformError::new(
            ErrorCode::DestinationExists,
            "Canvas output directory already exists",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(render_io("failed to inspect Canvas output directory")(
            error,
        )),
    }
}

pub(crate) fn publish_directory_noreplace(
    source: &Path,
    destination: &Path,
) -> TransformResult<()> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let source = CString::new(source.as_os_str().as_bytes())
            .map_err(|_| invalid_publish_path("Canvas staging path contains a NUL byte"))?;
        let destination = CString::new(destination.as_os_str().as_bytes())
            .map_err(|_| invalid_publish_path("Canvas destination path contains a NUL byte"))?;
        // SAFETY: both arguments are valid NUL-terminated path buffers for the
        // duration of the call. RENAME_EXCL provides the required no-replace
        // property even if the destination appears after preflight.
        let status = unsafe {
            libc::renameatx_np(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                destination.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        return if status == 0 {
            Ok(())
        } else {
            Err(publish_error(io::Error::last_os_error()))
        };
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let source = CString::new(source.as_os_str().as_bytes())
            .map_err(|_| invalid_publish_path("Canvas staging path contains a NUL byte"))?;
        let destination = CString::new(destination.as_os_str().as_bytes())
            .map_err(|_| invalid_publish_path("Canvas destination path contains a NUL byte"))?;
        // SAFETY: both arguments are valid NUL-terminated path buffers for the
        // duration of the call. RENAME_NOREPLACE makes publication atomic and
        // refuses a destination created by a concurrent actor.
        let status = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                destination.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        return if status == 0 {
            Ok(())
        } else {
            Err(publish_error(io::Error::last_os_error()))
        };
    }

    #[cfg(target_os = "windows")]
    {
        // std::fs::rename delegates to the Windows rename primitive, which
        // fails when the destination directory already exists.
        return fs::rename(source, destination).map_err(publish_error);
    }

    #[allow(unreachable_code)]
    Err(TransformError::new(
        ErrorCode::Render,
        "atomic no-replace Canvas directory publication is unsupported on this platform",
    ))
}

fn invalid_publish_path(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Render, message)
}

fn publish_error(error: io::Error) -> TransformError {
    if error.kind() == io::ErrorKind::AlreadyExists
        || matches!(error.raw_os_error(), Some(libc::EEXIST | libc::ENOTEMPTY))
    {
        TransformError::new(
            ErrorCode::DestinationExists,
            "Canvas output directory already exists",
        )
    } else {
        render_io("failed to atomically publish Canvas output directory")(error)
    }
}

fn join_output_label(directory: &str, filename: &str) -> String {
    if directory.is_empty() {
        filename.to_owned()
    } else {
        format!("{}/{filename}", directory.trim_end_matches(['/', '\\']))
    }
}

fn cancelled_error() -> TransformError {
    TransformError::new(ErrorCode::Cancelled, "Canvas rendering was cancelled")
}

fn render_io(message: &'static str) -> impl FnOnce(io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, message)
            .with_details(json!({ "reason": error.to_string() }))
    }
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
        (self.bytes, hex::encode(self.hasher.finalize()))
    }
}

impl<W: Write> Write for HashingWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.bytes = self.bytes.saturating_add(written as u64);
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageReader;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use worldbend_core::{
        CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasInsets, CanvasVariant, NormalizedAnchor,
    };

    fn set(variants: Vec<(&str, CanvasOperation)>) -> CanvasSetSpec {
        CanvasSetSpec {
            schema: CANVAS_SET_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            variants: variants
                .into_iter()
                .map(|(id, operation)| CanvasVariant {
                    id: id.to_owned(),
                    operation,
                })
                .collect(),
        }
    }

    fn render_into(
        source: RgbaImage,
        spec: &CanvasSetSpec,
        directory: &Path,
    ) -> TransformResult<CanvasSetFileRenderResult> {
        render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(source),
            CanvasSetProgram::Spec(spec),
            directory,
            "outputs",
            CanvasSetRenderOptions::default(),
            &|| false,
        )
    }

    fn read_rgba(path: &Path) -> RgbaImage {
        ImageReader::open(path)
            .unwrap()
            .decode()
            .unwrap()
            .to_rgba8()
    }

    #[test]
    fn crop_and_trim_copy_exact_pixels_and_preserve_set_order() {
        let source = RgbaImage::from_fn(4, 3, |x, y| {
            let alpha = if (1..=2).contains(&x) && y >= 1 {
                200
            } else {
                7
            };
            Rgba([(x * 31) as u8, (y * 47) as u8, (x + y) as u8, alpha])
        });
        let spec = set(vec![
            (
                "cropped",
                CanvasOperation::Crop {
                    rect: PixelRect {
                        x: 1,
                        y: 0,
                        width: 2,
                        height: 2,
                    },
                },
            ),
            ("trimmed", CanvasOperation::Trim { alpha_threshold: 7 }),
        ]);
        let directory = tempfile::tempdir().unwrap();
        let result = render_into(source.clone(), &spec, directory.path()).unwrap();

        assert_eq!(
            result
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["cropped", "trimmed"]
        );
        assert_eq!(result.items[0].output, "outputs/cropped.png");
        let cropped = read_rgba(&directory.path().join("cropped.png"));
        assert_eq!(cropped.dimensions(), (2, 2));
        for y in 0..2 {
            for x in 0..2 {
                assert_eq!(cropped.get_pixel(x, y), source.get_pixel(x + 1, y));
            }
        }
        let trimmed = read_rgba(&directory.path().join("trimmed.png"));
        assert_eq!(trimmed.dimensions(), (2, 2));
        for y in 0..2 {
            for x in 0..2 {
                assert_eq!(trimmed.get_pixel(x, y), source.get_pixel(x + 1, y + 1));
            }
        }
    }

    #[test]
    fn trim_is_strictly_greater_than_threshold_and_rejects_empty_result() {
        let source = RgbaImage::from_pixel(2, 1, Rgba([1, 2, 3, 9]));
        let spec = set(vec![(
            "empty",
            CanvasOperation::Trim { alpha_threshold: 9 },
        )]);
        let directory = tempfile::tempdir().unwrap();
        let error = render_into(source, &spec, directory.path()).unwrap_err();
        assert_eq!(error.code, ErrorCode::TrimEmpty);
        assert!(fs::read_dir(directory.path()).unwrap().next().is_none());
    }

    #[test]
    fn pad_uses_integer_placement_and_source_over_background() {
        let foreground = Rgba([200, 100, 50, 128]);
        let background = Rgba([10, 20, 30, 255]);
        let source = RgbaImage::from_pixel(1, 1, foreground);
        let spec = set(vec![(
            "padded",
            CanvasOperation::Pad {
                insets: CanvasInsets {
                    top: 1,
                    right: 2,
                    bottom: 1,
                    left: 1,
                },
                background: CanvasBackground::Color {
                    space: Srgb8Space::Srgb8,
                    rgba: background.0,
                },
            },
        )]);
        let directory = tempfile::tempdir().unwrap();
        render_into(source, &spec, directory.path()).unwrap();
        let output = read_rgba(&directory.path().join("padded.png"));

        assert_eq!(output.dimensions(), (4, 3));
        assert_eq!(*output.get_pixel(0, 0), background);
        assert_eq!(*output.get_pixel(1, 1), source_over(foreground, background));
    }

    #[test]
    fn plan_replay_requires_exact_source_shape_and_obeys_outside_fill() {
        let source = RgbaImage::from_pixel(2, 1, Rgba([90, 80, 70, 255]));
        let spec = set(vec![(
            "contained",
            CanvasOperation::Contain {
                output: PixelSize::new(4, 4),
                anchor: NormalizedAnchor { x: 0.5, y: 0.5 },
                background: CanvasBackground::Transparent {},
            },
        )]);
        let plan =
            resolve_canvas_set_for_image(&DynamicImage::ImageRgba8(source.clone()), &spec).unwrap();
        let directory = tempfile::tempdir().unwrap();
        render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(source.clone()),
            CanvasSetProgram::Plan {
                plan: &plan,
                replay: CanvasReplayOptions {
                    sampling: CanvasReplaySampling::Nearest,
                    outside_fill: [4, 3, 2, 1],
                },
            },
            directory.path(),
            "replay",
            CanvasSetRenderOptions::default(),
            &|| false,
        )
        .unwrap();
        let output = read_rgba(&directory.path().join("contained.png"));
        assert_eq!(output.dimensions(), (4, 4));
        assert_eq!(*output.get_pixel(0, 0), Rgba([4, 3, 2, 1]));
        assert_eq!(*output.get_pixel(1, 1), Rgba([90, 80, 70, 255]));

        let wrong = DynamicImage::ImageRgba8(RgbaImage::new(3, 1));
        let wrong_directory = tempfile::tempdir().unwrap();
        let error = render_canvas_set_to_directory(
            &wrong,
            CanvasSetProgram::Plan {
                plan: &plan,
                replay: CanvasReplayOptions {
                    sampling: CanvasReplaySampling::Nearest,
                    outside_fill: [0; 4],
                },
            },
            wrong_directory.path(),
            "replay",
            CanvasSetRenderOptions::default(),
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::RasterShapeMismatch);
        assert!(
            fs::read_dir(wrong_directory.path())
                .unwrap()
                .next()
                .is_none()
        );
    }

    #[test]
    fn linear_replay_filters_in_premultiplied_alpha_space() {
        let mut source = RgbaImage::new(2, 1);
        source.put_pixel(0, 0, Rgba([255, 0, 0, 0]));
        source.put_pixel(1, 0, Rgba([0, 0, 255, 255]));

        assert_eq!(sample_linear(&source, 0.5, 0.0), Rgba([0, 0, 255, 128]));
        assert_eq!(sample_linear(&source, 0.0, 0.0), Rgba([0, 0, 0, 0]));
    }

    #[test]
    fn contain_cover_and_stretch_respect_output_anchor_and_background() {
        let source = RgbaImage::from_pixel(2, 1, Rgba([220, 30, 10, 255]));
        let green = CanvasBackground::Color {
            space: Srgb8Space::Srgb8,
            rgba: [0, 200, 0, 255],
        };
        let spec = set(vec![
            (
                "contain_bottom",
                CanvasOperation::Contain {
                    output: PixelSize::new(4, 4),
                    anchor: NormalizedAnchor { x: 0.5, y: 1.0 },
                    background: green,
                },
            ),
            (
                "cover_right",
                CanvasOperation::Cover {
                    output: PixelSize::new(2, 2),
                    anchor: NormalizedAnchor { x: 1.0, y: 0.5 },
                    background: CanvasBackground::Transparent {},
                },
            ),
            (
                "stretched",
                CanvasOperation::Stretch {
                    output: PixelSize::new(3, 3),
                },
            ),
        ]);
        let directory = tempfile::tempdir().unwrap();
        let result = render_into(source, &spec, directory.path()).unwrap();
        assert_eq!(result.plan.variants[0].plan.placement.y, 2.0);
        assert_eq!(result.plan.variants[1].plan.placement.x, -2.0);

        let contain = read_rgba(&directory.path().join("contain_bottom.png"));
        assert_eq!(contain.dimensions(), (4, 4));
        assert_eq!(*contain.get_pixel(0, 0), Rgba([0, 200, 0, 255]));
        assert_eq!(*contain.get_pixel(1, 3), Rgba([220, 30, 10, 255]));
        let cover = read_rgba(&directory.path().join("cover_right.png"));
        assert_eq!(cover.dimensions(), (2, 2));
        assert!(
            cover
                .pixels()
                .all(|pixel| *pixel == Rgba([220, 30, 10, 255]))
        );
        let stretched = read_rgba(&directory.path().join("stretched.png"));
        assert_eq!(stretched.dimensions(), (3, 3));
        assert!(
            stretched
                .pixels()
                .all(|pixel| *pixel == Rgba([220, 30, 10, 255]))
        );
    }

    #[test]
    fn every_variant_reads_the_original_source_and_cumulative_limit_preflights_all() {
        let mut source = RgbaImage::new(2, 1);
        source.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        source.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
        let spec = set(vec![
            (
                "left",
                CanvasOperation::Crop {
                    rect: PixelRect {
                        x: 0,
                        y: 0,
                        width: 1,
                        height: 1,
                    },
                },
            ),
            (
                "right",
                CanvasOperation::Crop {
                    rect: PixelRect {
                        x: 1,
                        y: 0,
                        width: 1,
                        height: 1,
                    },
                },
            ),
        ]);
        let directory = tempfile::tempdir().unwrap();
        render_into(source.clone(), &spec, directory.path()).unwrap();
        assert_eq!(
            *read_rgba(&directory.path().join("left.png")).get_pixel(0, 0),
            Rgba([255, 0, 0, 255])
        );
        assert_eq!(
            *read_rgba(&directory.path().join("right.png")).get_pixel(0, 0),
            Rgba([0, 0, 255, 255])
        );

        let limited = tempfile::tempdir().unwrap();
        let options = CanvasSetRenderOptions {
            max_cumulative_pixels: 1,
            ..CanvasSetRenderOptions::default()
        };
        let error = render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(source),
            CanvasSetProgram::Spec(&spec),
            limited.path(),
            "outputs",
            options,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert!(fs::read_dir(limited.path()).unwrap().next().is_none());
    }

    #[test]
    fn trim_plan_replay_uses_recorded_bounds_without_recomputing_alpha() {
        let mut primary = RgbaImage::from_pixel(3, 1, Rgba([0, 0, 0, 0]));
        primary.put_pixel(1, 0, Rgba([9, 8, 7, 255]));
        let spec = set(vec![(
            "trimmed",
            CanvasOperation::Trim { alpha_threshold: 0 },
        )]);
        let plan = resolve_canvas_set_for_image(&DynamicImage::ImageRgba8(primary), &spec).unwrap();
        let replay_source = RgbaImage::from_pixel(3, 1, Rgba([50, 60, 70, 0]));
        let directory = tempfile::tempdir().unwrap();
        render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(replay_source),
            CanvasSetProgram::Plan {
                plan: &plan,
                replay: CanvasReplayOptions {
                    sampling: CanvasReplaySampling::Nearest,
                    outside_fill: [0; 4],
                },
            },
            directory.path(),
            "replay",
            CanvasSetRenderOptions::default(),
            &|| false,
        )
        .unwrap();
        let output = read_rgba(&directory.path().join("trimmed.png"));
        assert_eq!(output.dimensions(), (1, 1));
        assert_eq!(*output.get_pixel(0, 0), Rgba([50, 60, 70, 0]));
    }

    #[test]
    fn cancellation_is_polled_inside_exact_copy_trim_and_background_rows() {
        let source = RgbaImage::from_pixel(4, 128, Rgba([1, 2, 3, 255]));
        let crop = CanvasPlan {
            schema: worldbend_core::CANVAS_PLAN_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            source_size: PixelSize::new(4, 128),
            source_rect: PixelRect {
                x: 0,
                y: 0,
                width: 4,
                height: 128,
            },
            output_size: PixelSize::new(4, 128),
            placement: worldbend_core::CanvasPlacement {
                x: 0.0,
                y: 0.0,
                width: 4.0,
                height: 128.0,
            },
            scale: worldbend_core::CanvasScale { x: 1.0, y: 1.0 },
            operation: CanvasOperationKind::Crop,
            background: None,
        };
        let crop_calls = AtomicUsize::new(0);
        assert_eq!(
            render_primary_plan(
                &source,
                &crop,
                CanvasSetRenderOptions::default(),
                &|| crop_calls.fetch_add(1, Ordering::SeqCst) >= 3,
            )
            .unwrap_err()
            .code,
            ErrorCode::Cancelled
        );

        let trim_calls = AtomicUsize::new(0);
        assert_eq!(
            resolve_trim_rect_rgba_with_cancel(
                source.as_raw(),
                PixelSize::new(source.width(), source.height()),
                0,
                &|| trim_calls.fetch_add(1, Ordering::SeqCst) >= 3,
            )
            .unwrap_err()
            .code,
            ErrorCode::Cancelled
        );

        let composite_calls = AtomicUsize::new(0);
        assert_eq!(
            composite_background(
                source,
                Some(CanvasBackground::Color {
                    space: Srgb8Space::Srgb8,
                    rgba: [4, 5, 6, 255],
                }),
                &|| composite_calls.fetch_add(1, Ordering::SeqCst) >= 3,
            )
            .unwrap_err()
            .code,
            ErrorCode::Cancelled
        );
    }

    #[test]
    fn cancellation_between_variants_stops_ordered_rendering() {
        let source = RgbaImage::from_pixel(1, 1, Rgba([1, 2, 3, 255]));
        let spec = set(vec![
            (
                "one",
                CanvasOperation::Crop {
                    rect: PixelRect {
                        x: 0,
                        y: 0,
                        width: 1,
                        height: 1,
                    },
                },
            ),
            (
                "two",
                CanvasOperation::Crop {
                    rect: PixelRect {
                        x: 0,
                        y: 0,
                        width: 1,
                        height: 1,
                    },
                },
            ),
        ]);
        let directory = tempfile::tempdir().unwrap();
        let calls = AtomicUsize::new(0);
        let error = render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(source),
            CanvasSetProgram::Spec(&spec),
            directory.path(),
            "outputs",
            CanvasSetRenderOptions::default(),
            &|| calls.fetch_add(1, Ordering::SeqCst) >= 3,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(directory.path().join("one.png").exists());
        assert!(!directory.path().join("two.png").exists());
    }

    #[test]
    fn cancellation_after_last_encode_prevents_a_success_result() {
        let source = RgbaImage::from_pixel(1, 1, Rgba([1, 2, 3, 255]));
        let spec = set(vec![(
            "only",
            CanvasOperation::Crop {
                rect: PixelRect {
                    x: 0,
                    y: 0,
                    width: 1,
                    height: 1,
                },
            },
        )]);
        let directory = tempfile::tempdir().unwrap();
        let calls = AtomicUsize::new(0);
        let error = render_canvas_set_to_directory(
            &DynamicImage::ImageRgba8(source),
            CanvasSetProgram::Spec(&spec),
            directory.path(),
            "outputs",
            CanvasSetRenderOptions::default(),
            &|| calls.fetch_add(1, Ordering::SeqCst) >= 2,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(directory.path().join("only.png").exists());
    }

    #[test]
    fn file_dry_run_executes_full_render_without_publishing_directory() {
        let root = tempfile::tempdir().unwrap();
        let source_path = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([7, 8, 9, 255])))
            .save(&source_path)
            .unwrap();
        let output = root.path().join("published");
        let spec = set(vec![(
            "square",
            CanvasOperation::Stretch {
                output: PixelSize::new(2, 2),
            },
        )]);
        let result = render_canvas_set_file(
            &source_path,
            CanvasSetProgram::Spec(&spec),
            &output,
            CanvasSetRenderOptions::default(),
            true,
        )
        .unwrap();

        assert_eq!(result.status, CanvasSetRenderStatus::Ready);
        assert!(result.dry_run);
        assert!(!output.exists());
        assert!(result.items[0].bytes > 0);
        assert_eq!(result.items[0].sha256.len(), 64);
        assert!(
            fs::read_dir(root.path())
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".worldbend-"))
        );
    }

    #[test]
    fn no_replace_publication_preserves_a_racing_destination() {
        let root = tempfile::tempdir().unwrap();
        let staging = root.path().join(".worldbend-canvas-test.tmp");
        let destination = root.path().join("output");
        fs::create_dir(&staging).unwrap();
        fs::write(staging.join("variant.png"), b"staged").unwrap();
        preflight_output_directory(&destination).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("owner.txt"), b"owner").unwrap();

        let error = publish_directory_noreplace(&staging, &destination).unwrap_err();
        assert_eq!(error.code, ErrorCode::DestinationExists);
        assert_eq!(fs::read(destination.join("owner.txt")).unwrap(), b"owner");
        assert!(staging.join("variant.png").exists());
    }

    #[test]
    fn canvas_result_schema_exposes_ordered_set_and_hash_bounds() {
        let result_schema =
            serde_json::to_value(schemars::schema_for!(CanvasSetFileRenderResult)).unwrap();
        assert_eq!(result_schema["properties"]["items"]["minItems"], 1);
        assert_eq!(result_schema["properties"]["items"]["maxItems"], 16);
        assert_eq!(
            result_schema["$defs"]["CanvasSetRenderedItem"]["properties"]["id"]["pattern"],
            "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
        );
        assert_eq!(
            result_schema["$defs"]["CanvasSetRenderedItem"]["properties"]["sha256"]["pattern"],
            "^[0-9a-f]{64}$"
        );
        let options_schema =
            serde_json::to_value(schemars::schema_for!(CanvasSetRenderOptions)).unwrap();
        assert_eq!(
            options_schema["properties"]["maxCumulativePixels"]["maximum"],
            MAX_CANVAS_SET_PIXELS
        );
    }
}
