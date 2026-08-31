use crate::{
    CanvasMode, FileRenderStatus, RectifyRenderOptions, RenderLimits, RenderOptions,
    SamplingQuality,
    canvas::{preflight_output_directory, publish_directory_noreplace},
    file_io::{decode_file_with_limits, persist_temporary, write_png},
    preflight_destination, rectify_image_with_cancel, render_image_with_cancel, validate_limits,
};
use image::{DynamicImage, Rgba, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::Instant,
};
use worldbend_core::{
    CanvasBackground, CoordinateSpace, ErrorCode, MAX_MOCKUP_EXTRACT_PIXELS, MockupExtractPlan,
    MockupExtractSpec, MockupPlan, MockupSpec, Srgb8Space, TransformError, TransformResult,
    plan_mockup, plan_mockup_extract,
};

pub const MAX_MOCKUP_SOURCE_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn positive_u32_output_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": u32::MAX })
}

fn json_safe_u64_output_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for MockupRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupRenderDiagnostics {
    pub source_count: u32,
    pub plane_count: u32,
    pub cumulative_source_pixels: u64,
    pub quality: SamplingQuality,
}

#[derive(Debug)]
pub struct RenderedMockup {
    pub image: RgbaImage,
    pub plan: MockupPlan,
    pub diagnostics: MockupRenderDiagnostics,
}

#[derive(Debug, Clone)]
pub struct MockupFileSource {
    pub path: PathBuf,
    pub source_sha256: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupSourceEvidence {
    pub source_id: String,
    pub source_sha256: String,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub height: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupRenderEvidence {
    pub sources: Vec<MockupSourceEvidence>,
    pub output_sha256: String,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub output_width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub output_height: u32,
    pub output_format: String,
    pub decode_ms: f64,
    pub render_ms: f64,
    pub encode_ms: f64,
    pub total_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_output_schema")]
    pub bytes: u64,
    pub evidence: MockupRenderEvidence,
    pub plan: MockupPlan,
    pub diagnostics: MockupRenderDiagnostics,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[serde(default = "default_extract_cumulative_pixels")]
    pub max_cumulative_pixels: u64,
}

impl Default for MockupExtractRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
            max_cumulative_pixels: MAX_MOCKUP_EXTRACT_PIXELS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum MockupExtractRenderStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractRenderedItem {
    pub id: String,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_output_schema")]
    pub bytes: u64,
    pub sha256: String,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_output_schema")]
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractFileRenderResult {
    pub status: MockupExtractRenderStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub source_sha256: String,
    pub source_width: u32,
    pub source_height: u32,
    pub warnings: Vec<String>,
    pub plan: MockupExtractPlan,
    pub items: Vec<MockupExtractRenderedItem>,
}

pub fn render_mockup(
    sources: &HashMap<String, DynamicImage>,
    spec: &MockupSpec,
    options: MockupRenderOptions,
) -> TransformResult<RenderedMockup> {
    render_mockup_with_cancel(sources, spec, options, &|| false)
}

pub fn render_mockup_with_cancel(
    sources: &HashMap<String, DynamicImage>,
    spec: &MockupSpec,
    options: MockupRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedMockup> {
    validate_limits(options.limits)?;
    let plan = plan_mockup(spec)?;
    let output_pixels = u64::from(plan.canvas.width) * u64::from(plan.canvas.height);
    if plan.canvas.width > options.limits.max_width
        || plan.canvas.height > options.limits.max_height
        || output_pixels > options.limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup canvas exceeds configured render limits",
        )
        .with_details(json!({ "canvas": plan.canvas, "limits": options.limits })));
    }

    let required = plan
        .planes
        .iter()
        .map(|plane| plane.source_id.as_str())
        .collect::<HashSet<_>>();
    if sources.len() != required.len() || required.iter().any(|id| !sources.contains_key(*id)) {
        let mut required_ids = required.into_iter().collect::<Vec<_>>();
        required_ids.sort_unstable();
        let mut provided_ids = sources.keys().map(String::as_str).collect::<Vec<_>>();
        provided_ids.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup sources must exactly match the distinct sourceId values",
        )
        .with_details(json!({
            "required": required_ids,
            "provided": provided_ids,
        })));
    }

    let cumulative_source_pixels = sources.values().try_fold(0_u64, |total, source| {
        let pixels = u64::from(source.width()) * u64::from(source.height());
        total.checked_add(pixels).ok_or_else(|| {
            TransformError::new(ErrorCode::OutputLimit, "mockup source pixel sum overflowed")
        })
    })?;
    if cumulative_source_pixels > MAX_MOCKUP_SOURCE_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup sources exceed the cumulative decoded-pixel limit",
        )
        .with_details(json!({
            "pixels": cumulative_source_pixels,
            "maximum": MAX_MOCKUP_SOURCE_PIXELS,
        })));
    }

    let mut output = background_image(plan.canvas.width, plan.canvas.height, plan.background);
    for plane in &plan.planes {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "mockup render was cancelled",
            ));
        }
        let source = sources.get(&plane.source_id).ok_or_else(|| {
            TransformError::new(
                ErrorCode::Schema,
                "mockup source is missing after preflight",
            )
        })?;
        let target_size = matches!(
            plane.transform.destination.space,
            CoordinateSpace::Normalized
        )
        .then(|| plan.canvas.as_size());
        let rendered = render_image_with_cancel(
            source,
            &plane.transform,
            RenderOptions {
                quality: options.quality,
                canvas: CanvasMode::Reference,
                target_size,
                limits: options.limits,
            },
            is_cancelled,
        )?;
        composite_source_over(&mut output, &rendered.image, plane.opacity, is_cancelled)?;
    }

    Ok(RenderedMockup {
        image: output,
        diagnostics: MockupRenderDiagnostics {
            source_count: u32::try_from(sources.len()).unwrap_or(u32::MAX),
            plane_count: u32::try_from(plan.planes.len()).unwrap_or(u32::MAX),
            cumulative_source_pixels,
            quality: options.quality,
        },
        plan,
    })
}

pub fn render_mockup_files(
    sources: &HashMap<String, PathBuf>,
    spec: &MockupSpec,
    output: &Path,
    options: MockupRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<MockupFileRenderResult> {
    let sources = sources
        .iter()
        .map(|(id, path)| {
            (
                id.clone(),
                MockupFileSource {
                    path: path.clone(),
                    source_sha256: None,
                },
            )
        })
        .collect();
    render_mockup_files_with_cancel(&sources, spec, output, options, overwrite, dry_run, &|| {
        false
    })
}

pub fn render_mockup_extract_files(
    source: &Path,
    spec: &MockupExtractSpec,
    output_directory: &Path,
    options: MockupExtractRenderOptions,
    dry_run: bool,
) -> TransformResult<MockupExtractFileRenderResult> {
    render_mockup_extract_files_with_cancel(
        source,
        None,
        spec,
        output_directory,
        options,
        dry_run,
        &|| false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn render_mockup_extract_files_with_cancel(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &MockupExtractSpec,
    output_directory: &Path,
    options: MockupExtractRenderOptions,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MockupExtractFileRenderResult> {
    validate_limits(options.limits)?;
    let plan = plan_mockup_extract(spec)?;
    validate_extract_limits(&plan, options)?;
    preflight_output_directory(output_directory)?;
    let parent = output_directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-mockup-extract-")
        .tempdir_in(parent)
        .map_err(extract_io(
            "failed to create mockup extraction staging directory",
        ))?;
    let (source, source_sha256, warnings) =
        decode_file_with_limits(source, options.limits, known_source_sha256)?;
    let source_width = source.width();
    let source_height = source.height();
    let output_label = output_directory.display().to_string();
    let items = render_mockup_extract_to_directory(
        &source,
        &plan,
        staging.path(),
        &output_label,
        options,
        is_cancelled,
    )?;
    if is_cancelled() {
        return Err(extract_cancelled());
    }
    let mut result = MockupExtractFileRenderResult {
        status: MockupExtractRenderStatus::Ready,
        dry_run: true,
        output_directory: output_label,
        source_sha256,
        source_width,
        source_height,
        warnings,
        plan,
        items,
    };
    if !dry_run {
        publish_directory_noreplace(staging.path(), output_directory)?;
        result.status = MockupExtractRenderStatus::Written;
        result.dry_run = false;
    }
    Ok(result)
}

pub fn render_mockup_extract_to_directory(
    source: &DynamicImage,
    plan: &MockupExtractPlan,
    staging_directory: &Path,
    output_directory_label: &str,
    options: MockupExtractRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<Vec<MockupExtractRenderedItem>> {
    validate_limits(options.limits)?;
    validate_extract_limits(plan, options)?;
    if !staging_directory.is_dir() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "mockup extraction staging directory must exist",
        ));
    }
    let mut items = Vec::with_capacity(plan.outputs.len());
    for output in &plan.outputs {
        if is_cancelled() {
            return Err(extract_cancelled());
        }
        let rendered = rectify_image_with_cancel(
            source,
            &output.plan.spec,
            RectifyRenderOptions {
                quality: options.quality,
                limits: options.limits,
            },
            is_cancelled,
        )?;
        let path = staging_directory.join(&output.filename);
        let file = fs::File::create(&path)
            .map_err(extract_io("failed to create mockup extraction output"))?;
        let mut writer = HashingWriter::new(file);
        write_png(&rendered.image, &mut writer)?;
        writer
            .flush()
            .map_err(extract_io("failed to flush mockup extraction output"))?;
        writer
            .inner
            .sync_all()
            .map_err(extract_io("failed to sync mockup extraction output"))?;
        if is_cancelled() {
            return Err(extract_cancelled());
        }
        let (bytes, sha256) = writer.finish();
        items.push(MockupExtractRenderedItem {
            id: output.id.clone(),
            output: join_output_label(output_directory_label, &output.filename),
            bytes,
            sha256,
            width: rendered.image.width(),
            height: rendered.image.height(),
        });
    }
    Ok(items)
}

fn validate_extract_limits(
    plan: &MockupExtractPlan,
    options: MockupExtractRenderOptions,
) -> TransformResult<()> {
    if options.max_cumulative_pixels == 0
        || options.max_cumulative_pixels > MAX_MOCKUP_EXTRACT_PIXELS
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup extraction cumulative pixel limit exceeds the product ceiling",
        ));
    }
    if plan.cumulative_output_pixels > options.max_cumulative_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup extraction exceeds the configured cumulative output pixel limit",
        )
        .with_details(json!({
            "pixels": plan.cumulative_output_pixels,
            "maximum": options.max_cumulative_pixels,
        })));
    }
    for output in &plan.outputs {
        let size = output.plan.spec.output;
        let pixels = u64::from(size.width) * u64::from(size.height);
        if size.width > options.limits.max_width
            || size.height > options.limits.max_height
            || pixels > options.limits.max_pixels
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "mockup extraction output exceeds configured render limits",
            )
            .with_details(json!({
                "id": output.id,
                "width": size.width,
                "height": size.height,
                "pixels": pixels,
            })));
        }
    }
    Ok(())
}

const fn default_extract_cumulative_pixels() -> u64 {
    MAX_MOCKUP_EXTRACT_PIXELS
}

fn join_output_label(directory: &str, filename: &str) -> String {
    if directory.is_empty() {
        filename.to_owned()
    } else {
        format!("{}/{filename}", directory.trim_end_matches(['/', '\\']))
    }
}

fn extract_cancelled() -> TransformError {
    TransformError::new(
        ErrorCode::Cancelled,
        "mockup extraction rendering was cancelled",
    )
}

fn extract_io(message: &'static str) -> impl FnOnce(io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, message)
            .with_details(json!({ "reason": error.to_string() }))
    }
}

#[allow(clippy::too_many_arguments)]
pub fn render_mockup_files_with_cancel(
    sources: &HashMap<String, MockupFileSource>,
    spec: &MockupSpec,
    output: &Path,
    options: MockupRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MockupFileRenderResult> {
    let total_started = Instant::now();
    let plan = plan_mockup(spec)?;
    preflight_destination(output, overwrite)?;
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;

    let decode_started = Instant::now();
    let mut decoded = HashMap::with_capacity(sources.len());
    let mut evidence = Vec::with_capacity(sources.len());
    let mut source_ids = sources.keys().cloned().collect::<Vec<_>>();
    source_ids.sort_unstable();
    for source_id in source_ids {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "mockup render was cancelled",
            ));
        }
        let source = &sources[&source_id];
        let (image, source_sha256, warnings) = decode_file_with_limits(
            &source.path,
            options.limits,
            source.source_sha256.as_deref(),
        )?;
        evidence.push(MockupSourceEvidence {
            source_id: source_id.clone(),
            source_sha256,
            width: image.width(),
            height: image.height(),
            warnings,
        });
        decoded.insert(source_id, image);
    }
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;

    let render_started = Instant::now();
    let rendered = render_mockup_with_cancel(&decoded, spec, options, is_cancelled)?;
    debug_assert_eq!(rendered.plan, plan);
    let render_ms = render_started.elapsed().as_secs_f64() * 1000.0;

    let encode_started = Instant::now();
    let mut writer = HashingWriter::new(temporary.as_file_mut());
    write_png(&rendered.image, &mut writer)?;
    writer.flush().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to flush temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = writer.finish();
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "mockup render was cancelled",
        ));
    }
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }

    Ok(MockupFileRenderResult {
        status: if dry_run {
            FileRenderStatus::Ready
        } else {
            FileRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        bytes,
        evidence: MockupRenderEvidence {
            sources: evidence,
            output_sha256,
            output_width: rendered.image.width(),
            output_height: rendered.image.height(),
            output_format: "png".to_owned(),
            decode_ms,
            render_ms,
            encode_ms,
            total_ms: total_started.elapsed().as_secs_f64() * 1000.0,
        },
        plan: rendered.plan,
        diagnostics: rendered.diagnostics,
    })
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

fn background_image(width: u32, height: u32, background: CanvasBackground) -> RgbaImage {
    let pixel = match background {
        CanvasBackground::Transparent {} => Rgba([0, 0, 0, 0]),
        CanvasBackground::Color {
            space: Srgb8Space::Srgb8,
            rgba,
        } => Rgba(rgba),
    };
    RgbaImage::from_pixel(width, height, pixel)
}

fn composite_source_over(
    destination: &mut RgbaImage,
    source: &RgbaImage,
    opacity: f64,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if destination.dimensions() != source.dimensions() {
        return Err(TransformError::new(
            ErrorCode::RasterShapeMismatch,
            "mockup plane output does not match the declared canvas",
        ));
    }
    for y in 0..destination.height() {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "mockup render was cancelled",
            ));
        }
        for x in 0..destination.width() {
            let source_pixel = source.get_pixel(x, y).0;
            let destination_pixel = destination.get_pixel(x, y).0;
            let source_alpha = f64::from(source_pixel[3]) / 255.0 * opacity;
            let destination_alpha = f64::from(destination_pixel[3]) / 255.0;
            let output_alpha = source_alpha + destination_alpha * (1.0 - source_alpha);
            let mut output = [0_u8; 4];
            if output_alpha > 0.0 {
                for channel in 0..3 {
                    let premultiplied = f64::from(source_pixel[channel]) * source_alpha
                        + f64::from(destination_pixel[channel])
                            * destination_alpha
                            * (1.0 - source_alpha);
                    output[channel] =
                        (premultiplied / output_alpha).round().clamp(0.0, 255.0) as u8;
                }
            }
            output[3] = (output_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
            destination.put_pixel(x, y, Rgba(output));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{
        MOCKUP_EXTRACT_SCHEMA, MOCKUP_SCHEMA, MOCKUP_VERSION, MockupEdge, MockupEdgeRef,
        MockupExtractItem, MockupExtractSpec, MockupPlane, MockupSeam, PixelSize, Point, Quad,
        RectifySpec, Size, TransformSpec, plan_mockup_extract,
    };

    fn spec() -> MockupSpec {
        MockupSpec {
            schema: MOCKUP_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            canvas: worldbend_core::PixelSize::new(4, 2),
            background: CanvasBackground::Transparent {},
            planes: vec![
                MockupPlane {
                    id: "left".to_owned(),
                    source_id: "red".to_owned(),
                    transform: TransformSpec::pixel(
                        Size::new(4.0, 2.0),
                        Quad::new(
                            Point::new(0.0, 0.0),
                            Point::new(2.0, 0.0),
                            Point::new(2.0, 2.0),
                            Point::new(0.0, 2.0),
                        ),
                    ),
                    opacity: 1.0,
                    grid: None,
                    measurement: None,
                },
                MockupPlane {
                    id: "right".to_owned(),
                    source_id: "blue".to_owned(),
                    transform: TransformSpec::pixel(
                        Size::new(4.0, 2.0),
                        Quad::new(
                            Point::new(2.0, 0.0),
                            Point::new(4.0, 0.0),
                            Point::new(4.0, 2.0),
                            Point::new(2.0, 2.0),
                        ),
                    ),
                    opacity: 0.5,
                    grid: None,
                    measurement: None,
                },
            ],
            seams: vec![MockupSeam {
                first: MockupEdgeRef {
                    plane_id: "left".to_owned(),
                    edge: MockupEdge::Right,
                },
                second: MockupEdgeRef {
                    plane_id: "right".to_owned(),
                    edge: MockupEdge::Left,
                },
                tolerance_pixels: 0.0,
            }],
        }
    }

    #[test]
    fn composites_ordered_planes_on_one_explicit_canvas() {
        let sources = HashMap::from([
            (
                "red".to_owned(),
                DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([255, 0, 0, 255]))),
            ),
            (
                "blue".to_owned(),
                DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([0, 0, 255, 255]))),
            ),
        ]);
        let rendered = render_mockup(&sources, &spec(), MockupRenderOptions::default()).unwrap();
        assert_eq!(rendered.image.dimensions(), (4, 2));
        assert_eq!(rendered.image.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(rendered.image.get_pixel(3, 0).0, [0, 0, 255, 128]);
        assert_eq!(rendered.plan.seams[0].maximum_error_pixels, 0.0);
    }

    #[test]
    fn requires_exact_sources_and_observes_cancellation() {
        let missing = HashMap::from([("red".to_owned(), DynamicImage::new_rgba8(2, 2))]);
        assert_eq!(
            render_mockup(&missing, &spec(), MockupRenderOptions::default())
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let sources = HashMap::from([
            ("red".to_owned(), DynamicImage::new_rgba8(2, 2)),
            ("blue".to_owned(), DynamicImage::new_rgba8(2, 2)),
        ]);
        assert_eq!(
            render_mockup_with_cancel(&sources, &spec(), MockupRenderOptions::default(), &|| true)
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
    }

    #[test]
    fn reverse_extracts_ordered_planes_from_the_original_source() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(4, 2, |x, _| {
            if x < 2 {
                Rgba([255, 0, 0, 255])
            } else {
                Rgba([0, 0, 255, 255])
            }
        }));
        let extract = MockupExtractSpec {
            schema: MOCKUP_EXTRACT_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            outputs: vec![
                MockupExtractItem {
                    id: "left".to_owned(),
                    rectify: RectifySpec::normalized(
                        Quad::new(
                            Point::new(0.0, 0.0),
                            Point::new(0.5, 0.0),
                            Point::new(0.5, 1.0),
                            Point::new(0.0, 1.0),
                        ),
                        PixelSize::new(2, 2),
                    ),
                },
                MockupExtractItem {
                    id: "right".to_owned(),
                    rectify: RectifySpec::normalized(
                        Quad::new(
                            Point::new(0.5, 0.0),
                            Point::new(1.0, 0.0),
                            Point::new(1.0, 1.0),
                            Point::new(0.5, 1.0),
                        ),
                        PixelSize::new(2, 2),
                    ),
                },
            ],
        };
        let plan = plan_mockup_extract(&extract).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let items = render_mockup_extract_to_directory(
            &source,
            &plan,
            directory.path(),
            "faces",
            MockupExtractRenderOptions::default(),
            &|| false,
        )
        .unwrap();
        assert_eq!(
            items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["left", "right"]
        );
        assert_eq!(items[0].output, "faces/left.png");
        assert_eq!(items[1].output, "faces/right.png");
        let left = image::open(directory.path().join("left.png"))
            .unwrap()
            .to_rgba8();
        let right = image::open(directory.path().join("right.png"))
            .unwrap()
            .to_rgba8();
        assert_eq!(left.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(right.get_pixel(1, 1).0, [0, 0, 255, 255]);
    }

    #[test]
    fn reverse_extraction_preflights_cumulative_limit_and_cancellation() {
        let extract = MockupExtractSpec {
            schema: MOCKUP_EXTRACT_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            outputs: vec![MockupExtractItem {
                id: "face".to_owned(),
                rectify: RectifySpec::normalized(Quad::unit(), PixelSize::new(2, 2)),
            }],
        };
        let plan = plan_mockup_extract(&extract).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let source = DynamicImage::new_rgba8(2, 2);
        let limited = MockupExtractRenderOptions {
            max_cumulative_pixels: 3,
            ..MockupExtractRenderOptions::default()
        };
        assert_eq!(
            render_mockup_extract_to_directory(
                &source,
                &plan,
                directory.path(),
                "faces",
                limited,
                &|| false,
            )
            .unwrap_err()
            .code,
            ErrorCode::OutputLimit
        );
        assert_eq!(
            render_mockup_extract_to_directory(
                &source,
                &plan,
                directory.path(),
                "faces",
                MockupExtractRenderOptions::default(),
                &|| true,
            )
            .unwrap_err()
            .code,
            ErrorCode::Cancelled
        );
    }
}
