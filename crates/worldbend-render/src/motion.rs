use crate::{
    TimelineFileSource, TimelineRenderOptions, TimelineRenderStatus, TimelineSourceEvidence,
    render_timeline_files_with_cancel,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
use worldbend_core::{
    ErrorCode, MotionPlan, MotionSpec, RationalTime, TransformError, TransformResult,
    motion_timeline_spec, plan_motion,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn positive_u32_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": u32::MAX })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionRenderedItem {
    pub index: u32,
    pub id: String,
    pub source_id: String,
    pub presentation_time: RationalTime,
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
pub struct MotionFileRenderResult {
    pub status: TimelineRenderStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub plan: MotionPlan,
    pub sources: Vec<TimelineSourceEvidence>,
    pub items: Vec<MotionRenderedItem>,
}

pub fn render_motion_files(
    sources: &HashMap<String, PathBuf>,
    spec: &MotionSpec,
    output_directory: &Path,
    options: TimelineRenderOptions,
    dry_run: bool,
) -> TransformResult<MotionFileRenderResult> {
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
    render_motion_files_with_cancel(&sources, spec, output_directory, options, dry_run, &|| {
        false
    })
}

pub fn render_motion_files_with_cancel(
    sources: &HashMap<String, TimelineFileSource>,
    spec: &MotionSpec,
    output_directory: &Path,
    options: TimelineRenderOptions,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MotionFileRenderResult> {
    let plan = plan_motion(spec)?;
    let timeline_spec = motion_timeline_spec(&plan)?;
    let rendered = render_timeline_files_with_cancel(
        sources,
        &timeline_spec,
        output_directory,
        options,
        dry_run,
        is_cancelled,
    )?;
    if rendered.plan != plan.timeline || rendered.items.len() != plan.frames.len() {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "motion renderer returned a different Timeline plan",
        ));
    }
    let items = rendered
        .items
        .into_iter()
        .zip(&plan.frames)
        .map(|(item, timing)| MotionRenderedItem {
            index: item.index,
            id: item.id,
            source_id: item.source_id,
            presentation_time: timing.presentation_time,
            output: item.output,
            bytes: item.bytes,
            sha256: item.sha256,
            width: item.width,
            height: item.height,
        })
        .collect();
    Ok(MotionFileRenderResult {
        status: rendered.status,
        dry_run: rendered.dry_run,
        output_directory: rendered.output_directory,
        plan,
        sources: rendered.sources,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba, RgbaImage};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use worldbend_core::{
        FrameRate, MOTION_SCHEMA, MOTION_VERSION, MotionEasing, MotionKeyframe, PixelSize, Point,
        Quad, Size, TransformSpec,
    };

    fn spec() -> MotionSpec {
        MotionSpec {
            schema: MOTION_SCHEMA.to_owned(),
            version: MOTION_VERSION.to_owned(),
            output: PixelSize::new(4, 4),
            timebase: FrameRate {
                numerator: 30_000,
                denominator: 1_001,
            },
            source_id: "still".to_owned(),
            frame_count: 3,
            base: TransformSpec::pixel(Size::new(4.0, 4.0), Quad::unit()),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: Quad::new(
                        Point::new(0.0, 0.0),
                        Point::new(4.0, 0.0),
                        Point::new(4.0, 4.0),
                        Point::new(0.0, 4.0),
                    ),
                    easing_to_next: Some(MotionEasing::CubicBezier {
                        x1: 0.42,
                        y1: 0.0,
                        x2: 0.58,
                        y2: 1.0,
                    }),
                },
                MotionKeyframe {
                    frame: 2,
                    quad: Quad::new(
                        Point::new(1.0, 0.0),
                        Point::new(4.0, 0.0),
                        Point::new(4.0, 4.0),
                        Point::new(1.0, 4.0),
                    ),
                    easing_to_next: None,
                },
            ],
        }
    }

    #[test]
    fn renders_atomic_sequence_with_exact_presentation_times() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_fn(4, 4, |x, y| {
            Rgba([(x * 40) as u8, (y * 40) as u8, 20, 255])
        }))
        .save(&source)
        .unwrap();
        let output = root.path().join("motion");
        let sources = HashMap::from([("still".to_owned(), source)]);
        let result = render_motion_files(
            &sources,
            &spec(),
            &output,
            TimelineRenderOptions::default(),
            false,
        )
        .unwrap();
        assert_eq!(result.status, TimelineRenderStatus::Written);
        assert_eq!(result.items[1].presentation_time.numerator, 1001);
        assert_eq!(result.items[1].presentation_time.denominator, 30_000);
        assert!(output.join("frame-000002.png").is_file());
    }

    #[test]
    fn cancellation_publishes_no_directory() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(4, 4, Rgba([1, 2, 3, 255])))
            .save(&source)
            .unwrap();
        let output = root.path().join("motion");
        let sources = HashMap::from([(
            "still".to_owned(),
            TimelineFileSource {
                path: source,
                source_sha256: None,
            },
        )]);
        let calls = AtomicUsize::new(0);
        let error = render_motion_files_with_cancel(
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
