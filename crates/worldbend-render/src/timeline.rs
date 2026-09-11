use crate::{
    CanvasMode, RenderLimits, RenderOptions, SamplingQuality,
    canvas::{preflight_output_directory, publish_directory_noreplace},
    file_io::{decode_file_with_limits, write_png},
    render_image_with_cancel, validate_limits,
};
use image::DynamicImage;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use worldbend_core::{
    ErrorCode, MAX_TIMELINE_PIXELS, TimelinePlan, TimelineSpec, TransformError, TransformResult,
    plan_timeline,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_TIMELINE_SOURCE_PIXELS: u64 = 64 * 1024 * 1024;

fn positive_u32_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": u32::MAX })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[serde(default = "default_cumulative_pixels")]
    pub max_cumulative_pixels: u64,
}

impl Default for TimelineRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
            max_cumulative_pixels: MAX_TIMELINE_PIXELS,
        }
    }
}

const fn default_cumulative_pixels() -> u64 {
    MAX_TIMELINE_PIXELS
}

#[derive(Debug, Clone)]
pub struct TimelineFileSource {
    pub path: PathBuf,
    pub source_sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TimelineRenderStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineSourceEvidence {
    pub source_id: String,
    pub source_sha256: String,
    #[schemars(schema_with = "positive_u32_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub height: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineRenderedItem {
    pub index: u32,
    pub id: String,
    pub source_id: String,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub sha256: String,
    #[schemars(schema_with = "positive_u32_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineFileRenderResult {
    pub status: TimelineRenderStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub plan: TimelinePlan,
    pub sources: Vec<TimelineSourceEvidence>,
    pub items: Vec<TimelineRenderedItem>,
}

pub fn render_timeline_files(
    sources: &HashMap<String, PathBuf>,
    spec: &TimelineSpec,
    output_directory: &Path,
    options: TimelineRenderOptions,
    dry_run: bool,
) -> TransformResult<TimelineFileRenderResult> {
    let sources = sources
        .iter()
        .map(|(id, path)| {
            (
                id.clone(),
                TimelineFileSource {
                    path: path.clone(),
                    source_sha256: None,
                },
            )
        })
        .collect();
    render_timeline_files_with_cancel(&sources, spec, output_directory, options, dry_run, &|| {
        false
    })
}

pub fn render_timeline_files_with_cancel(
    sources: &HashMap<String, TimelineFileSource>,
    spec: &TimelineSpec,
    output_directory: &Path,
    options: TimelineRenderOptions,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<TimelineFileRenderResult> {
    validate_limits(options.limits)?;
    let plan = plan_timeline(spec)?;
    if plan.output.width > options.limits.max_width
        || plan.output.height > options.limits.max_height
        || u64::from(plan.output.width) * u64::from(plan.output.height) > options.limits.max_pixels
        || plan.cumulative_output_pixels > options.max_cumulative_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "timeline exceeds configured render limits",
        )
        .with_details(json!({
            "output": plan.output,
            "cumulativePixels": plan.cumulative_output_pixels,
            "maximumCumulativePixels": options.max_cumulative_pixels,
        })));
    }
    validate_sources(sources, &plan)?;
    preflight_output_directory(output_directory)?;
    let parent = output_directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-timeline-")
        .tempdir_in(parent)
        .map_err(render_io("failed to create timeline staging directory"))?;

    let mut decoded = HashMap::<String, DynamicImage>::new();
    let mut evidence = Vec::with_capacity(plan.source_ids.len());
    let mut cumulative_source_pixels = 0_u64;
    for source_id in &plan.source_ids {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        let source = sources.get(source_id).expect("source set validated");
        let (image, sha256, warnings) = decode_file_with_limits(
            &source.path,
            options.limits,
            source.source_sha256.as_deref(),
        )?;
        cumulative_source_pixels = cumulative_source_pixels
            .checked_add(u64::from(image.width()) * u64::from(image.height()))
            .ok_or_else(|| {
                TransformError::new(
                    ErrorCode::OutputLimit,
                    "timeline source pixel count overflowed",
                )
            })?;
        if cumulative_source_pixels > MAX_TIMELINE_SOURCE_PIXELS {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "timeline sources exceed the cumulative decoded-pixel limit",
            ));
        }
        evidence.push(TimelineSourceEvidence {
            source_id: source_id.clone(),
            source_sha256: sha256,
            width: image.width(),
            height: image.height(),
            warnings,
        });
        decoded.insert(source_id.clone(), image);
    }

    let mut items = Vec::with_capacity(plan.frames.len());
    for frame in &plan.frames {
        if is_cancelled() {
            return Err(cancelled_error());
        }
        let source = decoded
            .get(&frame.source_id)
            .expect("decoded source set validated");
        let rendered = render_image_with_cancel(
            source,
            &frame.transform,
            RenderOptions {
                quality: options.quality,
                canvas: CanvasMode::Reference,
                target_size: Some(plan.output.as_size()),
                limits: options.limits,
            },
            is_cancelled,
        )?;
        if rendered.image.width() != plan.output.width
            || rendered.image.height() != plan.output.height
        {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "timeline frame renderer returned the wrong output size",
            ));
        }
        let filename = format!("{}.png", frame.id);
        let staged_output = staging.path().join(&filename);
        let file = fs::File::create(&staged_output)
            .map_err(render_io("failed to create staged timeline frame"))?;
        let mut writer = DigestWriter::new(file);
        write_png(&rendered.image, &mut writer)?;
        writer
            .flush()
            .map_err(render_io("failed to flush staged timeline frame"))?;
        writer
            .inner
            .sync_all()
            .map_err(render_io("failed to sync staged timeline frame"))?;
        let bytes = writer.bytes;
        let sha256 = hex::encode(writer.digest.finalize());
        items.push(TimelineRenderedItem {
            index: frame.index,
            id: frame.id.clone(),
            source_id: frame.source_id.clone(),
            output: output_directory.join(&filename).display().to_string(),
            bytes,
            sha256,
            width: rendered.image.width(),
            height: rendered.image.height(),
        });
    }
    if is_cancelled() {
        return Err(cancelled_error());
    }
    let mut result = TimelineFileRenderResult {
        status: TimelineRenderStatus::Ready,
        dry_run: true,
        output_directory: output_directory.display().to_string(),
        plan,
        sources: evidence,
        items,
    };
    if !dry_run {
        publish_directory_noreplace(staging.path(), output_directory)?;
        result.status = TimelineRenderStatus::Written;
        result.dry_run = false;
    }
    Ok(result)
}

fn validate_sources(
    sources: &HashMap<String, TimelineFileSource>,
    plan: &TimelinePlan,
) -> TransformResult<()> {
    let required = plan.source_ids.iter().collect::<HashSet<_>>();
    let provided = sources.keys().collect::<HashSet<_>>();
    if required != provided {
        let mut required = required.into_iter().cloned().collect::<Vec<_>>();
        let mut provided = provided.into_iter().cloned().collect::<Vec<_>>();
        required.sort_unstable();
        provided.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "timeline sources must exactly match the planned sourceId values",
        )
        .with_details(json!({ "required": required, "provided": provided })));
    }
    Ok(())
}

struct DigestWriter<W> {
    inner: W,
    digest: Sha256,
    bytes: u64,
}

impl<W> DigestWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            digest: Sha256::new(),
            bytes: 0,
        }
    }
}

impl<W: Write> Write for DigestWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buffer)?;
        self.digest.update(&buffer[..written]);
        self.bytes = self.bytes.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn cancelled_error() -> TransformError {
    TransformError::new(ErrorCode::Cancelled, "timeline render was cancelled")
}

fn render_io(message: &'static str) -> impl FnOnce(io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, message)
            .with_details(json!({ "reason": error.to_string() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use worldbend_core::{
        PixelSize, Point, Quad, TIMELINE_SCHEMA, TIMELINE_VERSION, TimelineFrame, TimelineProgram,
        TransformSpec,
    };

    fn spec() -> TimelineSpec {
        let transform = TransformSpec::normalized(Quad::new(
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 1.0),
        ));
        TimelineSpec {
            schema: TIMELINE_SCHEMA.to_owned(),
            version: TIMELINE_VERSION.to_owned(),
            output: PixelSize::new(2, 2),
            program: TimelineProgram::Frames {
                frames: vec![
                    TimelineFrame {
                        id: "first".to_owned(),
                        source_id: "still".to_owned(),
                        transform: transform.clone(),
                    },
                    TimelineFrame {
                        id: "second".to_owned(),
                        source_id: "still".to_owned(),
                        transform,
                    },
                ],
            },
        }
    }

    #[test]
    fn timeline_publishes_one_ordered_atomic_directory() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255])))
            .save(&source)
            .unwrap();
        let output = root.path().join("frames");
        let sources = HashMap::from([("still".to_owned(), source)]);
        let result = render_timeline_files(
            &sources,
            &spec(),
            &output,
            TimelineRenderOptions::default(),
            false,
        )
        .unwrap();
        assert_eq!(result.status, TimelineRenderStatus::Written);
        assert_eq!(result.items[0].id, "first");
        assert!(output.join("first.png").is_file());
        assert!(output.join("second.png").is_file());
    }

    #[test]
    fn missing_source_or_cancellation_publishes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let output = root.path().join("frames");
        let error = render_timeline_files(
            &HashMap::new(),
            &spec(),
            &output,
            TimelineRenderOptions::default(),
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(!output.exists());

        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255])))
            .save(&source)
            .unwrap();
        let sources = HashMap::from([(
            "still".to_owned(),
            TimelineFileSource {
                path: source,
                source_sha256: None,
            },
        )]);
        let calls = AtomicUsize::new(0);
        let error = render_timeline_files_with_cancel(
            &sources,
            &spec(),
            &output,
            TimelineRenderOptions::default(),
            false,
            &|| calls.fetch_add(1, Ordering::SeqCst) >= 2,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }
}
