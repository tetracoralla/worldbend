//! Timed multi-plane mockup composition for richer device/scene video.
//!
//! Each plane carries Motion-compatible keyframes. Planning expands every frame
//! into an ordinary `MockupSpec` so existing mockup render/seams/clip apply.
//! Encoded MP4 delivery is owned by the video feature (`MockupVideoSpec`).

use crate::{
    CanvasBackground, ErrorCode, MAX_MOCKUP_PLANES, MAX_TIMELINE_FRAMES, MockupClip, MockupPlane,
    MockupSeam, MockupSpec, MotionEasing, MotionFrameTiming, MotionKeyframe, PixelSize,
    TransformError, TransformResult, TransformSpec,
    easing::{apply_easing, validate_easing},
    motion::{
        enclosing_motion_keyframes, interpolate_motion_quad, motion_gcd, motion_presentation_time,
        motion_stable_wire_float, validate_motion_frame_rate,
    },
    plan_mockup,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const MOCKUP_MOTION_SCHEMA: &str = "worldbend.mockup-motion";
pub const MOCKUP_MOTION_PLAN_SCHEMA: &str = "worldbend.mockup-motion-plan";
pub const MOCKUP_MOTION_VERSION: &str = "0.1";

/// Same cumulative raster budget as Video (256 Mi pixels).
pub const MAX_MOCKUP_MOTION_PIXELS: u64 = 256 * 1024 * 1024;

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_MOTION_SCHEMA})
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_MOTION_PLAN_SCHEMA})
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_MOTION_VERSION})
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMotionPlane {
    pub id: String,
    pub source_id: String,
    pub base: TransformSpec,
    pub keyframes: Vec<MotionKeyframe>,
    #[serde(default = "full_opacity")]
    #[schemars(range(min = 0.0, max = 1.0))]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<crate::MockupShadow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<crate::MockupSurface>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<crate::MockupGrid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measurement: Option<crate::MockupPhysicalSize>,
}

const fn full_opacity() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMotionSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub canvas: PixelSize,
    pub timebase: crate::FrameRate,
    pub frame_count: u32,
    pub planes: Vec<MockupMotionPlane>,
    #[serde(default = "transparent_background")]
    pub background: CanvasBackground,
    #[serde(default)]
    pub seams: Vec<MockupSeam>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<MockupClip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<Box<crate::MockupMotionPresentation>>,
}

const fn transparent_background() -> CanvasBackground {
    CanvasBackground::Transparent {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMotionPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub canvas: PixelSize,
    pub timebase: crate::FrameRate,
    /// Last presentation time (Motion semantics). Video display duration adds
    /// the final frame interval separately.
    pub duration: crate::RationalTime,
    #[schemars(length(min = 1, max = 240))]
    pub frames: Vec<MotionFrameTiming>,
    pub source_ids: Vec<String>,
    /// One ordinary mockup document per frame with interpolated plane quads.
    pub frame_specs: Vec<MockupSpec>,
    pub cumulative_output_pixels: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<crate::MockupMotionPresentationPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cumulative_processing_pixels: Option<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub presentation_frames: Vec<crate::MockupMotionPresentationPlan>,
}

impl MockupMotionPlan {
    pub fn output_size(&self) -> PixelSize {
        self.presentation.as_ref().map_or(self.canvas, |p| p.output)
    }
    pub fn presentation_at(&self, frame: usize) -> Option<&crate::MockupMotionPresentationPlan> {
        self.presentation_frames
            .get(frame)
            .or(self.presentation.as_ref())
    }
    pub fn processing_pixels(&self) -> u64 {
        self.cumulative_processing_pixels
            .unwrap_or(self.cumulative_output_pixels)
    }
}

pub fn plan_mockup_motion(spec: &MockupMotionSpec) -> TransformResult<MockupMotionPlan> {
    plan_mockup_motion_with_pixel_limit(spec, MAX_MOCKUP_MOTION_PIXELS)
}

pub(crate) fn plan_mockup_motion_with_pixel_limit(
    spec: &MockupMotionSpec,
    maximum: u64,
) -> TransformResult<MockupMotionPlan> {
    validate_spec(spec)?;
    let mut source_ids = Vec::new();
    let mut seen = HashSet::new();
    for plane in &spec.planes {
        if seen.insert(plane.source_id.clone()) {
            source_ids.push(plane.source_id.clone());
        }
    }

    let mut frames = Vec::with_capacity(spec.frame_count as usize);
    let mut frame_specs = Vec::with_capacity(spec.frame_count as usize);
    for index in 0..spec.frame_count {
        let mut planes = Vec::with_capacity(spec.planes.len());
        let mut shared_timing: Option<(f64, f64, u32, u32)> = None;
        for plane in &spec.planes {
            let (left, right) = enclosing_motion_keyframes(&plane.keyframes, index);
            let linear = if left.frame == right.frame {
                0.0
            } else {
                f64::from(index - left.frame) / f64::from(right.frame - left.frame)
            };
            let easing = left.easing_to_next.unwrap_or(MotionEasing::Linear);
            let eased = if left.frame == right.frame {
                0.0
            } else {
                apply_easing(easing, linear)
            };
            if shared_timing.is_none() {
                shared_timing = Some((linear, eased, left.frame, right.frame));
            }
            let mut transform = plane.base.clone();
            transform.destination.quad = interpolate_motion_quad(left.quad, right.quad, eased);
            planes.push(MockupPlane {
                id: plane.id.clone(),
                source_id: plane.source_id.clone(),
                transform,
                opacity: plane.opacity,
                grid: plane.grid,
                measurement: plane.measurement.clone(),
                surface: plane.surface,
                shadow: plane.shadow,
            });
        }
        let (linear, eased, segment_start, segment_end) =
            shared_timing.expect("mockup-motion planes validated non-empty");
        let id = format!("frame-{index:06}");
        frames.push(MotionFrameTiming {
            index,
            id,
            presentation_time: motion_presentation_time(index, spec.timebase),
            segment_start_frame: segment_start,
            segment_end_frame: segment_end,
            linear_progress: motion_stable_wire_float(linear),
            eased_progress: motion_stable_wire_float(eased),
        });
        let frame_spec = MockupSpec {
            schema: crate::MOCKUP_SCHEMA.to_owned(),
            version: crate::MOCKUP_VERSION.to_owned(),
            canvas: spec.canvas,
            background: spec.background,
            planes,
            seams: spec.seams.clone(),
            clip: spec.clip.clone(),
        };
        // Refuse frames that cannot plan under ordinary mockup rules.
        let _ = plan_mockup(&frame_spec)?;
        frame_specs.push(frame_spec);
    }

    let presentation = spec
        .presentation
        .as_deref()
        .map(crate::plan_mockup_motion_presentation)
        .transpose()?;
    let mut presentation_frames = Vec::new();
    if let Some(value) = spec
        .presentation
        .as_deref()
        .filter(|p| !p.keyframes.is_empty())
    {
        validate_keyframes(&value.keyframes, spec.frame_count, "whole-view")?;
        for index in 0..spec.frame_count {
            let (left, right) = enclosing_motion_keyframes(&value.keyframes, index);
            let linear = if left.frame == right.frame {
                0.0
            } else {
                f64::from(index - left.frame) / f64::from(right.frame - left.frame)
            };
            let eased = if left.frame == right.frame {
                0.0
            } else {
                apply_easing(left.easing_to_next.unwrap_or(MotionEasing::Linear), linear)
            };
            let mut frame = value.clone();
            frame.transform.destination.quad =
                interpolate_motion_quad(left.quad, right.quad, eased);
            presentation_frames.push(crate::plan_mockup_motion_presentation(&frame)?);
        }
    }
    let output = presentation.as_ref().map_or(spec.canvas, |p| p.output);
    let processing = presentation
        .as_ref()
        .map(|p| {
            let raw = u64::from(spec.canvas.width) * u64::from(spec.canvas.height);
            let viewport = u64::from(p.spec.size.width) * u64::from(p.spec.size.height);
            let output = if p.canvas.is_some() {
                u64::from(output.width) * u64::from(output.height)
            } else {
                0
            };
            raw.checked_add(viewport)
                .and_then(|n| n.checked_add(output))
                .and_then(|n| n.checked_mul(u64::from(spec.frame_count)))
                .ok_or_else(|| {
                    TransformError::new(
                        ErrorCode::OutputLimit,
                        "Motion presentation processing budget overflowed",
                    )
                })
        })
        .transpose()?;
    let timed_pixels = |size: PixelSize| {
        u64::from(size.width)
            .checked_mul(u64::from(size.height))
            .and_then(|n| n.checked_mul(u64::from(spec.frame_count)))
            .ok_or_else(|| {
                TransformError::new(ErrorCode::OutputLimit, "Motion raster budget overflowed")
            })
    };
    let raw_pixels = timed_pixels(spec.canvas)?;
    let whole_pixels = presentation
        .as_ref()
        .map(|p| timed_pixels(p.spec.size))
        .transpose()?
        .unwrap_or(0);
    if raw_pixels > maximum || whole_pixels > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Motion presentation processing exceeds the configured pixel budget",
        ));
    }
    let cumulative = u64::from(output.width)
        .checked_mul(u64::from(output.height))
        .and_then(|pixels| pixels.checked_mul(u64::from(spec.frame_count)))
        .ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "mockup-motion cumulative output pixel count overflowed",
            )
        })?;
    if cumulative > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup-motion cumulative output exceeds the configured pixel budget",
        ));
    }

    Ok(MockupMotionPlan {
        schema: MOCKUP_MOTION_PLAN_SCHEMA.to_owned(),
        version: MOCKUP_MOTION_VERSION.to_owned(),
        canvas: spec.canvas,
        timebase: spec.timebase,
        duration: motion_presentation_time(spec.frame_count - 1, spec.timebase),
        frames,
        source_ids,
        frame_specs,
        cumulative_output_pixels: cumulative,
        presentation,
        cumulative_processing_pixels: processing,
        presentation_frames,
    })
}

fn validate_spec(spec: &MockupMotionSpec) -> TransformResult<()> {
    if spec.schema != MOCKUP_MOTION_SCHEMA || spec.version != MOCKUP_MOTION_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported mockup-motion schema or version",
        )
        .with_details(json!({
            "expectedSchema": MOCKUP_MOTION_SCHEMA,
            "expectedVersion": MOCKUP_MOTION_VERSION
        })));
    }
    spec.canvas.validate("mockup-motion canvas")?;
    validate_motion_frame_rate(spec.timebase)?;
    if !(1..=MAX_TIMELINE_FRAMES as u32).contains(&spec.frame_count) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup-motion frameCount must be from 1 through 240",
        ));
    }
    if spec.planes.is_empty() || spec.planes.len() > MAX_MOCKUP_PLANES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup-motion requires between 1 and 16 planes",
        ));
    }
    let mut plane_ids = HashSet::new();
    for plane in &spec.planes {
        validate_id(&plane.id, "mockup-motion plane id")?;
        validate_id(&plane.source_id, "mockup-motion source id")?;
        if !plane_ids.insert(plane.id.clone()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mockup-motion plane ids must be unique",
            ));
        }
        if !(0.0..=1.0).contains(&plane.opacity) || !plane.opacity.is_finite() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mockup-motion plane opacity must be a finite value from 0 through 1",
            ));
        }
        validate_keyframes(&plane.keyframes, spec.frame_count, &plane.id)?;
    }
    Ok(())
}

pub(crate) fn validate_keyframes(
    keyframes: &[MotionKeyframe],
    frame_count: u32,
    plane_id: &str,
) -> TransformResult<()> {
    if keyframes.is_empty() || keyframes.len() > MAX_TIMELINE_FRAMES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup-motion plane requires between 1 and 240 keyframes",
        )
        .with_details(json!({ "planeId": plane_id })));
    }
    if keyframes.first().map(|k| k.frame) != Some(0)
        || keyframes.last().map(|k| k.frame) != Some(frame_count - 1)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup-motion plane keyframes must explicitly cover the first and last frame",
        )
        .with_details(json!({ "planeId": plane_id })));
    }
    for pair in keyframes.windows(2) {
        if pair[0].frame >= pair[1].frame {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mockup-motion plane keyframe indexes must be strictly increasing",
            )
            .with_details(json!({ "planeId": plane_id })));
        }
    }
    if keyframes
        .last()
        .is_some_and(|keyframe| keyframe.easing_to_next.is_some())
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "the final mockup-motion plane keyframe must not declare easingToNext",
        )
        .with_details(json!({ "planeId": plane_id })));
    }
    for keyframe in keyframes {
        if keyframe.frame >= frame_count {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mockup-motion plane keyframe is outside frameCount",
            )
            .with_details(json!({ "planeId": plane_id })));
        }
        if let Some(easing) = keyframe.easing_to_next {
            validate_easing(easing)?;
        }
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> TransformResult<()> {
    let valid = !value.is_empty()
        && value.len() <= 64
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if valid {
        Ok(())
    } else {
        Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must be a non-empty ASCII id of at most 64 bytes"),
        ))
    }
}

/// Display duration including the final frame interval (Video semantics).
pub fn mockup_motion_display_duration(
    frame_count: u32,
    timebase: crate::FrameRate,
) -> crate::RationalTime {
    let numerator = u64::from(frame_count) * u64::from(timebase.denominator);
    let denominator = u64::from(timebase.numerator);
    let divisor = motion_gcd(numerator, denominator);
    crate::RationalTime {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FrameRate, MotionEasing, Point, Quad};

    fn quad(offset: f64) -> Quad {
        Quad::new(
            Point::new(0.10 + offset, 0.10),
            Point::new(0.70 + offset, 0.12),
            Point::new(0.68 + offset, 0.80),
            Point::new(0.08 + offset, 0.78),
        )
    }

    fn plane(id: &str, source: &str, start: f64, end: f64) -> MockupMotionPlane {
        MockupMotionPlane {
            id: id.into(),
            source_id: source.into(),
            base: TransformSpec::normalized(quad(start)),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: quad(start),
                    easing_to_next: Some(MotionEasing::Linear),
                },
                MotionKeyframe {
                    frame: 29,
                    quad: quad(end),
                    easing_to_next: None,
                },
            ],
            opacity: 1.0,
            shadow: None,
            surface: None,
            grid: None,
            measurement: None,
        }
    }

    fn spec() -> MockupMotionSpec {
        MockupMotionSpec {
            schema: MOCKUP_MOTION_SCHEMA.into(),
            version: MOCKUP_MOTION_VERSION.into(),
            canvas: PixelSize {
                width: 640,
                height: 480,
            },
            timebase: FrameRate {
                numerator: 30,
                denominator: 1,
            },
            frame_count: 30,
            planes: vec![
                plane("background", "bg", 0.0, 0.0),
                plane("device", "screen", 0.0, 0.08),
            ],
            background: CanvasBackground::Transparent {},
            seams: vec![],
            clip: None,
            presentation: None,
        }
    }

    #[test]
    fn expands_parallax_planes_and_display_duration() {
        let plan = plan_mockup_motion(&spec()).unwrap();
        assert_eq!(plan.frames.len(), 30);
        assert_eq!(plan.frame_specs.len(), 30);
        assert_eq!(plan.source_ids, ["bg", "screen"]);
        assert_eq!(plan.duration.numerator, 29);
        assert_eq!(
            mockup_motion_display_duration(30, plan.timebase),
            crate::RationalTime {
                numerator: 1,
                denominator: 1
            }
        );
        let first = &plan.frame_specs[0].planes[1].transform.destination.quad;
        let last = &plan.frame_specs[29].planes[1].transform.destination.quad;
        assert!((first.tl.x - 0.10).abs() < 1e-6);
        assert!((last.tl.x - 0.18).abs() < 1e-6);
        // Mid frame has moved.
        let mid = &plan.frame_specs[15].planes[1].transform.destination.quad;
        assert!(mid.tl.x > first.tl.x && mid.tl.x < last.tl.x);
    }

    #[test]
    fn whole_scene_presentation_keeps_motion_and_named_outputs() {
        let mut motion = spec();
        motion.presentation = Some(Box::new(crate::MockupMotionPresentation {
            transform: crate::TransformSpec::normalized(crate::Quad::unit()),
            size: PixelSize::new(800, 600),
            output: crate::SpatialTemplateOutput::CanvasSet {
                spec: crate::CanvasSetSpec {
                    schema: crate::CANVAS_SET_SCHEMA.into(),
                    version: crate::CANVAS_VERSION.into(),
                    variants: vec![
                        crate::CanvasVariant {
                            id: "square".into(),
                            operation: crate::CanvasOperation::Crop {
                                rect: crate::PixelRect {
                                    x: 100,
                                    y: 0,
                                    width: 600,
                                    height: 600,
                                },
                            },
                        },
                        crate::CanvasVariant {
                            id: "wide".into(),
                            operation: crate::CanvasOperation::Stretch {
                                output: PixelSize::new(800, 400),
                            },
                        },
                    ],
                },
            },
            output_id: "square".into(),
            keyframes: vec![],
        }));
        let plan = plan_mockup_motion(&motion).unwrap();
        assert_eq!(plan.canvas, motion.canvas);
        assert_eq!(plan.output_size(), PixelSize::new(600, 600));
        assert_eq!(
            plan.frame_specs[15].planes[1].transform.destination.quad,
            plan_mockup_motion(&spec()).unwrap().frame_specs[15].planes[1]
                .transform
                .destination
                .quad
        );
        assert_eq!(
            plan.presentation.as_ref().unwrap().spec,
            *motion.presentation.clone().unwrap()
        );
        assert!(plan.processing_pixels() > plan.cumulative_output_pixels);
        motion.presentation.as_mut().unwrap().output_id = "missing".into();
        assert!(plan_mockup_motion(&motion).is_err());
    }

    #[test]
    fn rejects_missing_end_keyframe_and_duplicate_plane_ids() {
        let mut broken = spec();
        broken.planes[0].keyframes[1].frame = 10;
        assert!(plan_mockup_motion(&broken).is_err());
        let mut dup = spec();
        dup.planes[1].id = "background".into();
        assert!(plan_mockup_motion(&dup).is_err());
    }
}
