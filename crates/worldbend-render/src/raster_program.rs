use crate::canvas::{render_primary_plan, resolve_canvas_for_rgba};
use crate::file_io::{
    EvidenceWriter, decode_file_with_limits, output_parent, persist_temporary,
    validate_claimed_source_sha256, write_png,
};
use crate::{
    CanvasMode, CanvasSetRenderOptions, FileRenderStatus, RectifyRenderOptions, RenderEvidence,
    RenderLimits, RenderOptions, SamplingQuality, plan_canvas, preflight_destination,
    rectify_rgba_image, render_rgba_image, validate_limits, validate_render_target,
};
use image::{DynamicImage, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{io::Write, path::Path, time::Instant};
use worldbend_core::{
    CanvasPlan, ErrorCode, MAX_RASTER_PROGRAM_PIXELS, PixelSize, RasterProgramCanvasMode,
    RasterProgramInspection, RasterProgramSpec, RasterProgramStage, RasterProgramStageKind,
    TransformError, TransformResult, inspect_raster_program, rectify_plane, solve_spec,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RasterProgramRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[schemars(schema_with = "cumulative_pixels_schema")]
    pub max_cumulative_pixels: u64,
}

impl Default for RasterProgramRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
            max_cumulative_pixels: MAX_RASTER_PROGRAM_PIXELS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RasterProgramStageResult {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub kind: RasterProgramStageKind,
    pub input: PixelSize,
    pub output: PixelSize,
}

#[derive(Debug)]
pub struct RenderedRasterProgram {
    pub image: RgbaImage,
    pub inspection: RasterProgramInspection,
    pub stages: Vec<RasterProgramStageResult>,
    pub cumulative_pixels: u64,
    pub solve_ms: f64,
    pub render_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RasterProgramFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub inspection: RasterProgramInspection,
    pub stages: Vec<RasterProgramStageResult>,
    #[schemars(schema_with = "cumulative_pixels_output_schema")]
    pub cumulative_pixels: u64,
}

pub fn render_raster_program(
    source: &DynamicImage,
    spec: &RasterProgramSpec,
    options: RasterProgramRenderOptions,
) -> TransformResult<RenderedRasterProgram> {
    render_raster_program_with_cancel(source, spec, options, &|| false)
}

pub fn render_raster_program_with_cancel(
    source: &DynamicImage,
    spec: &RasterProgramSpec,
    options: RasterProgramRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedRasterProgram> {
    render_raster_program_with_budget(source, spec, options, is_cancelled, &mut |_| Ok(()))
}

/// Charge the caller's cumulative budget before each stage allocates or renders.
/// Charges survive a later stage failure, so a containing job cannot repeat
/// expensive failing prefixes without accounting for their work.
pub(crate) fn render_raster_program_with_budget(
    source: &DynamicImage,
    spec: &RasterProgramSpec,
    options: RasterProgramRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
    charge: &mut dyn FnMut(u64) -> TransformResult<()>,
) -> TransformResult<RenderedRasterProgram> {
    validate_limits(options.limits)?;
    if options.max_cumulative_pixels == 0
        || options.max_cumulative_pixels > MAX_RASTER_PROGRAM_PIXELS
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "raster-program cumulative pixel limit exceeds the product ceiling",
        ));
    }
    let inspection = inspect_raster_program(spec)?;
    let mut current = source.to_rgba8();
    let mut stages = Vec::with_capacity(spec.stages.len());
    let mut cumulative_pixels = 0_u64;
    let mut solve_ms = 0.0;
    let mut render_ms = 0.0;

    for stage in &spec.stages {
        check_cancelled(is_cancelled)?;
        let input = PixelSize::new(current.width(), current.height());
        let planned = plan_stage(&current, stage, options, is_cancelled)?;
        let planned_output = planned.output();
        cumulative_pixels = cumulative_pixels
            .checked_add(pixel_count(planned_output))
            .ok_or_else(cumulative_overflow)?;
        if cumulative_pixels > options.max_cumulative_pixels {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "raster program exceeds the configured cumulative pixel limit",
            )
            .with_details(json!({
                "stage": stage.id(),
                "pixels": cumulative_pixels,
                "maximum": options.max_cumulative_pixels,
            })));
        }
        charge(pixel_count(planned_output))?;

        current = match stage {
            RasterProgramStage::Transform {
                spec,
                canvas,
                target_size,
                ..
            } => {
                let execution = render_rgba_image(
                    current,
                    spec,
                    RenderOptions {
                        quality: options.quality,
                        canvas: map_canvas(*canvas),
                        target_size: *target_size,
                        limits: options.limits,
                    },
                    is_cancelled,
                )?;
                solve_ms += execution.solve_ms;
                render_ms += execution.render_ms;
                execution.rendered.image
            }
            RasterProgramStage::Rectify { spec, .. } => {
                let execution = rectify_rgba_image(
                    current,
                    spec,
                    RectifyRenderOptions {
                        quality: options.quality,
                        limits: options.limits,
                    },
                    is_cancelled,
                )?;
                solve_ms += execution.solve_ms;
                render_ms += execution.render_ms;
                execution.rendered.image
            }
            RasterProgramStage::Canvas { .. } => {
                let PlannedStage::Canvas(plan) = planned else {
                    unreachable!("Canvas stages always produce a Canvas plan")
                };
                let started = Instant::now();
                let image = render_primary_plan(
                    &current,
                    &plan,
                    CanvasSetRenderOptions {
                        quality: options.quality,
                        limits: options.limits,
                        max_cumulative_pixels: options.max_cumulative_pixels,
                    },
                    is_cancelled,
                )?;
                render_ms += started.elapsed().as_secs_f64() * 1000.0;
                image
            }
        };
        debug_assert_eq!(
            planned_output,
            PixelSize::new(current.width(), current.height())
        );
        stages.push(RasterProgramStageResult {
            id: stage.id().to_owned(),
            kind: stage.kind(),
            input,
            output: planned_output,
        });
    }
    check_cancelled(is_cancelled)?;
    Ok(RenderedRasterProgram {
        image: current,
        inspection,
        stages,
        cumulative_pixels,
        solve_ms,
        render_ms,
    })
}

enum PlannedStage {
    Output(PixelSize),
    Canvas(CanvasPlan),
}

impl PlannedStage {
    const fn output(&self) -> PixelSize {
        match self {
            Self::Output(size) => *size,
            Self::Canvas(plan) => plan.output_size,
        }
    }
}

fn plan_stage(
    current: &RgbaImage,
    stage: &RasterProgramStage,
    options: RasterProgramRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<PlannedStage> {
    match stage {
        RasterProgramStage::Transform {
            spec,
            canvas,
            target_size,
            ..
        } => {
            validate_render_target(spec, *target_size)?;
            let solved = solve_spec(spec, *target_size)?;
            let placement = plan_canvas(
                solved.diagnostics.bounds,
                solved.resolved_destination.reference,
                map_canvas(*canvas),
                options.limits,
            )?;
            Ok(PlannedStage::Output(PixelSize::new(
                placement.width,
                placement.height,
            )))
        }
        RasterProgramStage::Rectify { spec, .. } => {
            rectify_plane(spec)?;
            validate_output_size(spec.output, options.limits)?;
            Ok(PlannedStage::Output(spec.output))
        }
        RasterProgramStage::Canvas { spec, .. } => {
            let plan = resolve_canvas_for_rgba(current, spec, is_cancelled)?;
            validate_output_size(plan.output_size, options.limits)?;
            Ok(PlannedStage::Canvas(plan))
        }
    }
}

fn validate_output_size(size: PixelSize, limits: RenderLimits) -> TransformResult<()> {
    let pixels = pixel_count(size);
    if size.width > limits.max_width
        || size.height > limits.max_height
        || pixels > limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "raster-program stage output exceeds configured limits",
        )
        .with_details(json!({
            "width": size.width,
            "height": size.height,
            "pixels": pixels,
            "limits": limits,
        })));
    }
    Ok(())
}

const fn pixel_count(size: PixelSize) -> u64 {
    size.width as u64 * size.height as u64
}

fn cumulative_overflow() -> TransformError {
    TransformError::new(
        ErrorCode::OutputLimit,
        "raster-program cumulative pixel count overflowed",
    )
}

fn check_cancelled(is_cancelled: &(dyn Fn() -> bool + Sync)) -> TransformResult<()> {
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "raster program was cancelled",
        ));
    }
    Ok(())
}

const fn map_canvas(mode: RasterProgramCanvasMode) -> CanvasMode {
    match mode {
        RasterProgramCanvasMode::Tight => CanvasMode::Tight,
        RasterProgramCanvasMode::Reference => CanvasMode::Reference,
    }
}

pub fn render_raster_program_file(
    source: &Path,
    spec: &RasterProgramSpec,
    output: &Path,
    options: RasterProgramRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<RasterProgramFileRenderResult> {
    render_raster_program_file_internal(
        source,
        None,
        spec,
        output,
        options,
        overwrite,
        dry_run,
        &|| false,
    )
}

pub fn render_raster_program_file_with_source_sha256(
    source: &Path,
    source_sha256: &str,
    spec: &RasterProgramSpec,
    output: &Path,
    options: RasterProgramRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<RasterProgramFileRenderResult> {
    validate_claimed_source_sha256(source_sha256)?;
    render_raster_program_file_internal(
        source,
        Some(source_sha256),
        spec,
        output,
        options,
        overwrite,
        dry_run,
        &|| false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn render_raster_program_file_with_cancel(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &RasterProgramSpec,
    output: &Path,
    options: RasterProgramRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RasterProgramFileRenderResult> {
    if let Some(source_sha256) = known_source_sha256 {
        validate_claimed_source_sha256(source_sha256)?;
    }
    render_raster_program_file_internal(
        source,
        known_source_sha256,
        spec,
        output,
        options,
        overwrite,
        dry_run,
        is_cancelled,
    )
}

#[allow(clippy::too_many_arguments)]
fn render_raster_program_file_internal(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &RasterProgramSpec,
    output: &Path,
    options: RasterProgramRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RasterProgramFileRenderResult> {
    let total_started = Instant::now();
    validate_limits(options.limits)?;
    inspect_raster_program(spec)?;
    preflight_destination(output, overwrite)?;
    check_cancelled(is_cancelled)?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(output_parent(output)).map_err(|error| {
            TransformError::new(ErrorCode::Render, "output directory is not writable")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
    let decode_started = Instant::now();
    let (source_image, source_sha256, warnings) =
        decode_file_with_limits(source, options.limits, known_source_sha256)?;
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    check_cancelled(is_cancelled)?;
    let rendered = render_raster_program_with_cancel(&source_image, spec, options, is_cancelled)?;
    check_cancelled(is_cancelled)?;
    let encode_started = Instant::now();
    let mut evidence_writer = EvidenceWriter::new(temporary.as_file_mut());
    write_png(&rendered.image, &mut evidence_writer)?;
    evidence_writer.flush().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to flush temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = evidence_writer.finish();
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    check_cancelled(is_cancelled)?;
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }
    let total_ms = total_started.elapsed().as_secs_f64() * 1000.0;
    let output_width = rendered.image.width();
    let output_height = rendered.image.height();
    Ok(RasterProgramFileRenderResult {
        status: if dry_run {
            FileRenderStatus::Ready
        } else {
            FileRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        bytes,
        evidence: RenderEvidence {
            source_sha256,
            output_sha256,
            output_width,
            output_height,
            output_format: "png".to_owned(),
            solve_ms: rendered.solve_ms,
            decode_ms,
            render_ms: rendered.render_ms,
            encode_ms,
            total_ms,
            warnings,
        },
        inspection: rendered.inspection,
        stages: rendered.stages,
        cumulative_pixels: rendered.cumulative_pixels,
    })
}

fn cumulative_pixels_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": MAX_RASTER_PROGRAM_PIXELS })
}

fn cumulative_pixels_output_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": MAX_RASTER_PROGRAM_PIXELS })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use worldbend_core::{
        CANVAS_SCHEMA, CANVAS_VERSION, CanvasOperation, CanvasSpec, Point, Quad,
        RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION, RasterProgramStage, Size, TransformSpec,
    };

    fn source() -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_fn(8, 8, |x, y| {
            Rgba([(x * 17) as u8, (y * 19) as u8, 80, 255])
        }))
    }

    fn program() -> RasterProgramSpec {
        RasterProgramSpec {
            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
            version: RASTER_PROGRAM_VERSION.to_owned(),
            stages: vec![
                RasterProgramStage::Transform {
                    id: "perspective".to_owned(),
                    spec: TransformSpec::pixel(
                        Size::new(8.0, 8.0),
                        Quad::new(
                            Point::new(0.0, 0.0),
                            Point::new(8.0, 0.0),
                            Point::new(8.0, 8.0),
                            Point::new(0.0, 8.0),
                        ),
                    ),
                    canvas: RasterProgramCanvasMode::Reference,
                    target_size: None,
                },
                RasterProgramStage::Canvas {
                    id: "crop".to_owned(),
                    spec: CanvasSpec {
                        schema: CANVAS_SCHEMA.to_owned(),
                        version: CANVAS_VERSION.to_owned(),
                        operation: CanvasOperation::Crop {
                            rect: worldbend_core::PixelRect {
                                x: 2,
                                y: 1,
                                width: 4,
                                height: 5,
                            },
                        },
                    },
                },
            ],
        }
    }

    #[test]
    fn ordered_stages_stay_in_memory_and_report_dimensions() {
        let result =
            render_raster_program(&source(), &program(), RasterProgramRenderOptions::default())
                .unwrap();
        assert_eq!((result.image.width(), result.image.height()), (4, 5));
        assert_eq!(result.stages[0].input, PixelSize::new(8, 8));
        assert_eq!(result.stages[1].output, PixelSize::new(4, 5));
        assert_eq!(result.cumulative_pixels, 84);
    }

    #[test]
    fn cumulative_limit_is_checked_before_the_stage_render() {
        let error = render_raster_program(
            &source(),
            &program(),
            RasterProgramRenderOptions {
                max_cumulative_pixels: 63,
                ..RasterProgramRenderOptions::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn cancellation_after_a_stage_publishes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source.png");
        source()
            .save_with_format(&source_path, image::ImageFormat::Png)
            .unwrap();
        let output = directory.path().join("out.png");
        let polls = AtomicUsize::new(0);
        let error = render_raster_program_file_with_cancel(
            &source_path,
            None,
            &program(),
            &output,
            RasterProgramRenderOptions::default(),
            false,
            false,
            &|| polls.fetch_add(1, Ordering::SeqCst) >= 6,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }
}
