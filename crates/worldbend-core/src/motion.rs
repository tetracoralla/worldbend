use crate::{
    ErrorCode, PixelSize, Point, Quad, TIMELINE_SCHEMA, TIMELINE_VERSION, TimelineFrame,
    TimelinePlan, TimelineProgram, TimelineSpec, TransformError, TransformResult, TransformSpec,
    plan_timeline,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MOTION_SCHEMA: &str = "worldbend.motion";
pub const MOTION_PLAN_SCHEMA: &str = "worldbend.motion-plan";
pub const MOTION_VERSION: &str = "0.1";

const MAX_RATE_NUMERATOR: u32 = 240_000;
const MAX_RATE_DENOMINATOR: u32 = 1_001;
const MAX_ID_BYTES: usize = 64;
const WIRE_DECIMAL_SCALE: f64 = 1_000_000_000_000.0;

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": MOTION_SCHEMA })
}

fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": MOTION_PLAN_SCHEMA })
}

fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": MOTION_VERSION })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FrameRate {
    #[schemars(range(min = 1, max = 240000))]
    pub numerator: u32,
    #[schemars(range(min = 1, max = 1001))]
    pub denominator: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RationalTime {
    pub numerator: u64,
    pub denominator: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MotionEasing {
    Linear,
    Hold,
    CubicBezier {
        #[schemars(range(min = 0.0, max = 1.0))]
        x1: f64,
        #[schemars(range(min = -4.0, max = 4.0))]
        y1: f64,
        #[schemars(range(min = 0.0, max = 1.0))]
        x2: f64,
        #[schemars(range(min = -4.0, max = 4.0))]
        y2: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionKeyframe {
    pub frame: u32,
    pub quad: Quad,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub easing_to_next: Option<MotionEasing>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub output: PixelSize,
    pub timebase: FrameRate,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub source_id: String,
    #[schemars(range(min = 1, max = 240))]
    pub frame_count: u32,
    pub base: TransformSpec,
    #[schemars(length(min = 1, max = 240))]
    pub keyframes: Vec<MotionKeyframe>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionFrameTiming {
    pub index: u32,
    pub id: String,
    pub presentation_time: RationalTime,
    pub segment_start_frame: u32,
    pub segment_end_frame: u32,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub linear_progress: f64,
    pub eased_progress: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MotionPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub output: PixelSize,
    pub timebase: FrameRate,
    pub duration: RationalTime,
    pub source_id: String,
    #[schemars(length(min = 1, max = 240))]
    pub frames: Vec<MotionFrameTiming>,
    pub timeline: TimelinePlan,
}

pub fn plan_motion(spec: &MotionSpec) -> TransformResult<MotionPlan> {
    validate_spec(spec)?;
    let mut frames = Vec::with_capacity(spec.frame_count as usize);
    let mut timeline_frames = Vec::with_capacity(spec.frame_count as usize);
    for index in 0..spec.frame_count {
        let (left, right) = enclosing_keyframes(&spec.keyframes, index);
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
        let mut transform = spec.base.clone();
        transform.destination.quad = interpolate_quad(left.quad, right.quad, eased);
        let id = format!("frame-{index:06}");
        timeline_frames.push(TimelineFrame {
            id: id.clone(),
            source_id: spec.source_id.clone(),
            transform,
        });
        frames.push(MotionFrameTiming {
            index,
            id,
            presentation_time: presentation_time(index, spec.timebase),
            segment_start_frame: left.frame,
            segment_end_frame: right.frame,
            linear_progress: stable_wire_float(linear),
            eased_progress: stable_wire_float(eased),
        });
    }
    let timeline_spec = TimelineSpec {
        schema: TIMELINE_SCHEMA.to_owned(),
        version: TIMELINE_VERSION.to_owned(),
        output: spec.output,
        program: TimelineProgram::Frames {
            frames: timeline_frames,
        },
    };
    let timeline = plan_timeline(&timeline_spec)?;
    Ok(MotionPlan {
        schema: MOTION_PLAN_SCHEMA.to_owned(),
        version: MOTION_VERSION.to_owned(),
        output: spec.output,
        timebase: spec.timebase,
        duration: presentation_time(spec.frame_count - 1, spec.timebase),
        source_id: spec.source_id.clone(),
        frames,
        timeline,
    })
}

pub fn motion_timeline_spec(plan: &MotionPlan) -> TransformResult<TimelineSpec> {
    if plan.schema != MOTION_PLAN_SCHEMA || plan.version != MOTION_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported motion plan schema or version",
        ));
    }
    if plan.frames.len() != plan.timeline.frames.len()
        || plan
            .frames
            .iter()
            .zip(&plan.timeline.frames)
            .any(|(timing, frame)| {
                timing.index != frame.index
                    || timing.id != frame.id
                    || frame.source_id != plan.source_id
            })
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion timing and resolved Timeline frames do not correlate",
        ));
    }
    Ok(TimelineSpec {
        schema: TIMELINE_SCHEMA.to_owned(),
        version: TIMELINE_VERSION.to_owned(),
        output: plan.output,
        program: TimelineProgram::Frames {
            frames: plan
                .timeline
                .frames
                .iter()
                .map(|frame| TimelineFrame {
                    id: frame.id.clone(),
                    source_id: frame.source_id.clone(),
                    transform: frame.transform.clone(),
                })
                .collect(),
        },
    })
}

fn validate_spec(spec: &MotionSpec) -> TransformResult<()> {
    if spec.schema != MOTION_SCHEMA || spec.version != MOTION_VERSION {
        return Err(
            TransformError::new(ErrorCode::Schema, "unsupported motion schema or version")
                .with_details(
                    json!({ "expectedSchema": MOTION_SCHEMA, "expectedVersion": MOTION_VERSION }),
                ),
        );
    }
    spec.output.validate("motion output")?;
    validate_frame_rate(spec.timebase)?;
    validate_id(&spec.source_id, "motion source id")?;
    if !(1..=crate::MAX_TIMELINE_FRAMES as u32).contains(&spec.frame_count) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion frameCount must be from 1 through 240",
        ));
    }
    if spec.keyframes.is_empty() || spec.keyframes.len() > crate::MAX_TIMELINE_FRAMES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion requires between 1 and 240 keyframes",
        ));
    }
    if spec.keyframes.first().map(|keyframe| keyframe.frame) != Some(0)
        || spec.keyframes.last().map(|keyframe| keyframe.frame) != Some(spec.frame_count - 1)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion keyframes must explicitly cover the first and last frame",
        ));
    }
    for pair in spec.keyframes.windows(2) {
        if pair[0].frame >= pair[1].frame {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "motion keyframe indexes must be strictly increasing",
            ));
        }
    }
    if spec
        .keyframes
        .last()
        .is_some_and(|keyframe| keyframe.easing_to_next.is_some())
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "the final motion keyframe must not declare easingToNext",
        ));
    }
    for keyframe in &spec.keyframes {
        if keyframe.frame >= spec.frame_count {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "motion keyframe is outside frameCount",
            ));
        }
        if let Some(easing) = keyframe.easing_to_next {
            validate_easing(easing)?;
        }
    }
    Ok(())
}

fn validate_frame_rate(rate: FrameRate) -> TransformResult<()> {
    if rate.numerator == 0
        || rate.numerator > MAX_RATE_NUMERATOR
        || rate.denominator == 0
        || rate.denominator > MAX_RATE_DENOMINATOR
        || rate.numerator < rate.denominator
        || u64::from(rate.numerator) > 240 * u64::from(rate.denominator)
        || gcd(u64::from(rate.numerator), u64::from(rate.denominator)) != 1
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion timebase must be a reduced rational rate from 1 through 240 fps",
        ));
    }
    Ok(())
}

fn validate_easing(easing: MotionEasing) -> TransformResult<()> {
    if let MotionEasing::CubicBezier { x1, y1, x2, y2 } = easing
        && (!x1.is_finite()
            || !y1.is_finite()
            || !x2.is_finite()
            || !y2.is_finite()
            || !(0.0..=1.0).contains(&x1)
            || !(0.0..=1.0).contains(&x2)
            || !(-4.0..=4.0).contains(&y1)
            || !(-4.0..=4.0).contains(&y2))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion cubicBezier controls exceed their finite x or y bounds",
        ));
    }
    Ok(())
}

fn enclosing_keyframes(
    keyframes: &[MotionKeyframe],
    frame: u32,
) -> (&MotionKeyframe, &MotionKeyframe) {
    for pair in keyframes.windows(2) {
        if pair[0].frame <= frame && frame <= pair[1].frame {
            return (&pair[0], &pair[1]);
        }
    }
    let last = keyframes
        .last()
        .expect("motion keyframes validated non-empty");
    (last, last)
}

fn apply_easing(easing: MotionEasing, progress: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    match easing {
        MotionEasing::Linear => progress,
        MotionEasing::Hold => 0.0,
        MotionEasing::CubicBezier { x1, y1, x2, y2 } => {
            let mut low = 0.0;
            let mut high = 1.0;
            for _ in 0..32 {
                let middle = (low + high) * 0.5;
                if cubic_coordinate(middle, x1, x2) < progress {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            cubic_coordinate((low + high) * 0.5, y1, y2)
        }
    }
}

fn cubic_coordinate(parameter: f64, first: f64, second: f64) -> f64 {
    let inverse = 1.0 - parameter;
    3.0 * inverse * inverse * parameter * first
        + 3.0 * inverse * parameter * parameter * second
        + parameter * parameter * parameter
}

fn interpolate_quad(first: Quad, second: Quad, progress: f64) -> Quad {
    let point = |a: Point, b: Point| {
        Point::new(
            stable_wire_float(a.x + (b.x - a.x) * progress),
            stable_wire_float(a.y + (b.y - a.y) * progress),
        )
    };
    Quad::new(
        point(first.tl, second.tl),
        point(first.tr, second.tr),
        point(first.br, second.br),
        point(first.bl, second.bl),
    )
}

fn presentation_time(frame: u32, rate: FrameRate) -> RationalTime {
    let numerator = u64::from(frame) * u64::from(rate.denominator);
    let denominator = u64::from(rate.numerator);
    if numerator == 0 {
        return RationalTime {
            numerator: 0,
            denominator: 1,
        };
    }
    let divisor = gcd(numerator, denominator);
    RationalTime {
        numerator: numerator / divisor,
        denominator: denominator / divisor,
    }
}

const fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        let remainder = left % right;
        left = right;
        right = remainder;
    }
    left
}

fn stable_wire_float(value: f64) -> f64 {
    (value * WIRE_DECIMAL_SCALE).round() / WIRE_DECIMAL_SCALE
}

fn validate_id(value: &str, field: &str) -> TransformResult<()> {
    let valid = !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if valid {
        Ok(())
    } else {
        Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must match ^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Quad;

    fn quad(offset: f64) -> Quad {
        Quad::new(
            Point::new(offset, 0.0),
            Point::new(1.0 + offset, 0.0),
            Point::new(1.0 + offset, 1.0),
            Point::new(offset, 1.0),
        )
    }

    fn spec(easing: MotionEasing) -> MotionSpec {
        MotionSpec {
            schema: MOTION_SCHEMA.to_owned(),
            version: MOTION_VERSION.to_owned(),
            output: PixelSize::new(100, 100),
            timebase: FrameRate {
                numerator: 30_000,
                denominator: 1_001,
            },
            source_id: "still".to_owned(),
            frame_count: 3,
            base: TransformSpec::normalized(quad(0.0)),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: quad(0.0),
                    easing_to_next: Some(easing),
                },
                MotionKeyframe {
                    frame: 2,
                    quad: quad(0.2),
                    easing_to_next: None,
                },
            ],
        }
    }

    #[test]
    fn linear_motion_has_exact_rational_time_and_timeline_correlation() {
        let plan = plan_motion(&spec(MotionEasing::Linear)).unwrap();
        assert_eq!(
            plan.frames[1].presentation_time,
            RationalTime {
                numerator: 1001,
                denominator: 30000
            }
        );
        assert_eq!(
            plan.duration,
            RationalTime {
                numerator: 1001,
                denominator: 15000
            }
        );
        assert_eq!(plan.frames[1].eased_progress, 0.5);
        assert_eq!(plan.timeline.frames[1].transform.destination.quad.tl.x, 0.1);
        assert_eq!(motion_timeline_spec(&plan).unwrap().output, plan.output);
    }

    #[test]
    fn hold_and_cubic_bezier_have_distinct_closed_progress() {
        let hold = plan_motion(&spec(MotionEasing::Hold)).unwrap();
        assert_eq!(hold.frames[1].eased_progress, 0.0);
        let eased = plan_motion(&spec(MotionEasing::CubicBezier {
            x1: 0.42,
            y1: 0.0,
            x2: 1.0,
            y2: 1.0,
        }))
        .unwrap();
        assert!(eased.frames[1].eased_progress < 0.5);
        assert_ne!(
            eased.timeline.frames[1].transform.destination.quad,
            hold.timeline.frames[1].transform.destination.quad
        );
    }

    #[test]
    fn rejects_unreduced_or_out_of_range_timebase() {
        let mut value = spec(MotionEasing::Linear);
        value.timebase = FrameRate {
            numerator: 60,
            denominator: 2,
        };
        assert_eq!(plan_motion(&value).unwrap_err().code, ErrorCode::Schema);
        value.timebase = FrameRate {
            numerator: 241,
            denominator: 1,
        };
        assert_eq!(plan_motion(&value).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn final_keyframe_cannot_own_an_unused_easing() {
        let mut value = spec(MotionEasing::Linear);
        value.keyframes[1].easing_to_next = Some(MotionEasing::Hold);
        assert_eq!(plan_motion(&value).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn wire_shape_rejects_unknown_fields() {
        let mut value = serde_json::to_value(spec(MotionEasing::Linear)).unwrap();
        value["timebase"]["unexpected"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<MotionSpec>(value).is_err());
    }
}
