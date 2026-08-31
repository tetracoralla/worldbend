use crate::{
    ErrorCode, PixelSize, Quad, TransformError, TransformResult, TransformSpec, solve_spec,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const TIMELINE_SCHEMA: &str = "worldbend.timeline";
pub const TIMELINE_PLAN_SCHEMA: &str = "worldbend.timeline-plan";
pub const TIMELINE_VERSION: &str = "0.1";
pub const MAX_TIMELINE_FRAMES: usize = 240;
pub const MAX_TIMELINE_PIXELS: u64 = 64 * 1024 * 1024;
const MAX_ID_BYTES: usize = 64;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineSpec {
    pub schema: String,
    pub version: String,
    pub output: PixelSize,
    pub program: TimelineProgram,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TimelineProgram {
    Frames {
        frames: Vec<TimelineFrame>,
    },
    Keyframes {
        source_id: String,
        frame_count: u32,
        base: TransformSpec,
        keyframes: Vec<TimelineKeyframe>,
        #[serde(default)]
        interpolation: TimelineInterpolation,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineFrame {
    pub id: String,
    pub source_id: String,
    pub transform: TransformSpec,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelineKeyframe {
    pub frame: u32,
    pub quad: Quad,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TimelineInterpolation {
    #[default]
    Linear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelinePlanFrame {
    pub index: u32,
    pub id: String,
    pub source_id: String,
    pub transform: TransformSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TimelinePlan {
    pub schema: String,
    pub version: String,
    pub output: PixelSize,
    pub frames: Vec<TimelinePlanFrame>,
    pub source_ids: Vec<String>,
    pub cumulative_output_pixels: u64,
}

pub fn plan_timeline(spec: &TimelineSpec) -> TransformResult<TimelinePlan> {
    if spec.schema != TIMELINE_SCHEMA || spec.version != TIMELINE_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported timeline schema or version",
        ));
    }
    spec.output.validate("timeline output")?;
    let frames = match &spec.program {
        TimelineProgram::Frames { frames } => plan_explicit_frames(frames, spec.output)?,
        TimelineProgram::Keyframes {
            source_id,
            frame_count,
            base,
            keyframes,
            interpolation: TimelineInterpolation::Linear,
        } => plan_keyframes(source_id, *frame_count, base, keyframes, spec.output)?,
    };
    let cumulative_output_pixels = u64::from(spec.output.width)
        .checked_mul(u64::from(spec.output.height))
        .and_then(|pixels| pixels.checked_mul(frames.len() as u64))
        .ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "timeline cumulative output pixel count overflowed",
            )
        })?;
    if cumulative_output_pixels > MAX_TIMELINE_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "timeline exceeds the cumulative output pixel limit",
        )
        .with_details(serde_json::json!({
            "pixels": cumulative_output_pixels,
            "maximum": MAX_TIMELINE_PIXELS,
        })));
    }
    let mut source_ids = Vec::new();
    let mut seen_sources = HashSet::new();
    for frame in &frames {
        if seen_sources.insert(frame.source_id.clone()) {
            source_ids.push(frame.source_id.clone());
        }
    }
    Ok(TimelinePlan {
        schema: TIMELINE_PLAN_SCHEMA.to_owned(),
        version: TIMELINE_VERSION.to_owned(),
        output: spec.output,
        frames,
        source_ids,
        cumulative_output_pixels,
    })
}

fn plan_explicit_frames(
    frames: &[TimelineFrame],
    output: PixelSize,
) -> TransformResult<Vec<TimelinePlanFrame>> {
    validate_frame_count(frames.len())?;
    let mut ids = HashSet::new();
    frames
        .iter()
        .enumerate()
        .map(|(index, frame)| {
            validate_id(&frame.id, "timeline frame id")?;
            validate_id(&frame.source_id, "timeline source id")?;
            if !ids.insert(frame.id.clone()) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "timeline frame ids must be unique",
                ));
            }
            validate_frame_transform(&frame.transform, output)?;
            Ok(TimelinePlanFrame {
                index: index as u32,
                id: frame.id.clone(),
                source_id: frame.source_id.clone(),
                transform: frame.transform.clone(),
            })
        })
        .collect()
}

fn plan_keyframes(
    source_id: &str,
    frame_count: u32,
    base: &TransformSpec,
    keyframes: &[TimelineKeyframe],
    output: PixelSize,
) -> TransformResult<Vec<TimelinePlanFrame>> {
    validate_id(source_id, "timeline source id")?;
    let frame_count = usize::try_from(frame_count).map_err(|_| {
        TransformError::new(
            ErrorCode::OutputLimit,
            "timeline frame count is unsupported",
        )
    })?;
    validate_frame_count(frame_count)?;
    if keyframes.is_empty() || keyframes.len() > MAX_TIMELINE_FRAMES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "keyframe program requires between 1 and 240 keyframes",
        ));
    }
    if keyframes.first().map(|keyframe| keyframe.frame) != Some(0)
        || keyframes.last().map(|keyframe| keyframe.frame) != Some(frame_count as u32 - 1)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "keyframes must explicitly cover the first and last frame",
        ));
    }
    for pair in keyframes.windows(2) {
        if pair[0].frame >= pair[1].frame {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "keyframe indexes must be strictly increasing",
            ));
        }
    }
    if keyframes
        .iter()
        .any(|keyframe| keyframe.frame >= frame_count as u32)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "keyframe index is outside the declared frame count",
        ));
    }
    (0..frame_count)
        .map(|index| {
            let index_u32 = index as u32;
            let (left, right) = enclosing_keyframes(keyframes, index_u32);
            let amount = if left.frame == right.frame {
                0.0
            } else {
                f64::from(index_u32 - left.frame) / f64::from(right.frame - left.frame)
            };
            let mut transform = base.clone();
            transform.destination.quad = interpolate_quad(left.quad, right.quad, amount);
            validate_frame_transform(&transform, output)?;
            Ok(TimelinePlanFrame {
                index: index_u32,
                id: format!("frame-{index_u32:06}"),
                source_id: source_id.to_owned(),
                transform,
            })
        })
        .collect()
}

fn enclosing_keyframes(
    keyframes: &[TimelineKeyframe],
    frame: u32,
) -> (&TimelineKeyframe, &TimelineKeyframe) {
    for pair in keyframes.windows(2) {
        if pair[0].frame <= frame && frame <= pair[1].frame {
            return (&pair[0], &pair[1]);
        }
    }
    let last = keyframes.last().expect("keyframes validated non-empty");
    (last, last)
}

fn interpolate_quad(first: Quad, second: Quad, amount: f64) -> Quad {
    let interpolate = |a: crate::Point, b: crate::Point| crate::Point {
        x: a.x + (b.x - a.x) * amount,
        y: a.y + (b.y - a.y) * amount,
    };
    Quad {
        tl: interpolate(first.tl, second.tl),
        tr: interpolate(first.tr, second.tr),
        br: interpolate(first.br, second.br),
        bl: interpolate(first.bl, second.bl),
    }
}

fn validate_frame_transform(transform: &TransformSpec, output: PixelSize) -> TransformResult<()> {
    solve_spec(transform, Some(output.as_size())).map(|_| ())
}

fn validate_frame_count(count: usize) -> TransformResult<()> {
    if !(1..=MAX_TIMELINE_FRAMES).contains(&count) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "timeline requires between 1 and 240 frames",
        ));
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> TransformResult<()> {
    let valid = !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must match ^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Point, TransformSpec};

    fn quad(offset: f64) -> Quad {
        Quad::new(
            Point::new(offset, 0.0),
            Point::new(1.0 + offset, 0.0),
            Point::new(1.0 + offset, 1.0),
            Point::new(offset, 1.0),
        )
    }

    #[test]
    fn keyframes_expand_linearly_with_stable_ids() {
        let spec = TimelineSpec {
            schema: TIMELINE_SCHEMA.to_owned(),
            version: TIMELINE_VERSION.to_owned(),
            output: PixelSize::new(10, 10),
            program: TimelineProgram::Keyframes {
                source_id: "still".to_owned(),
                frame_count: 3,
                base: TransformSpec::normalized(quad(0.0)),
                keyframes: vec![
                    TimelineKeyframe {
                        frame: 0,
                        quad: quad(0.0),
                    },
                    TimelineKeyframe {
                        frame: 2,
                        quad: quad(0.2),
                    },
                ],
                interpolation: TimelineInterpolation::Linear,
            },
        };
        let plan = plan_timeline(&spec).unwrap();
        assert_eq!(plan.frames[1].id, "frame-000001");
        assert!((plan.frames[1].transform.destination.quad.tl.x - 0.1).abs() < 1e-12);
        assert_eq!(plan.source_ids, ["still"]);
    }

    #[test]
    fn explicit_frames_preserve_order_and_reject_duplicate_ids() {
        let frame = |id: &str| TimelineFrame {
            id: id.to_owned(),
            source_id: "still".to_owned(),
            transform: TransformSpec::normalized(quad(0.0)),
        };
        let mut spec = TimelineSpec {
            schema: TIMELINE_SCHEMA.to_owned(),
            version: TIMELINE_VERSION.to_owned(),
            output: PixelSize::new(2, 2),
            program: TimelineProgram::Frames {
                frames: vec![frame("a"), frame("b")],
            },
        };
        assert_eq!(plan_timeline(&spec).unwrap().frames[1].id, "b");
        spec.program = TimelineProgram::Frames {
            frames: vec![frame("same"), frame("same")],
        };
        assert_eq!(plan_timeline(&spec).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn keyframes_require_explicit_endpoints_and_valid_intermediate_geometry() {
        let spec = TimelineSpec {
            schema: TIMELINE_SCHEMA.to_owned(),
            version: TIMELINE_VERSION.to_owned(),
            output: PixelSize::new(2, 2),
            program: TimelineProgram::Keyframes {
                source_id: "still".to_owned(),
                frame_count: 3,
                base: TransformSpec::normalized(quad(0.0)),
                keyframes: vec![TimelineKeyframe {
                    frame: 1,
                    quad: quad(0.0),
                }],
                interpolation: TimelineInterpolation::Linear,
            },
        };
        assert_eq!(plan_timeline(&spec).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn rejects_unknown_fields_inside_the_tagged_program() {
        let error = serde_json::from_value::<TimelineSpec>(serde_json::json!({
            "schema": TIMELINE_SCHEMA,
            "version": TIMELINE_VERSION,
            "output": { "width": 2, "height": 2 },
            "program": {
                "kind": "frames",
                "frames": [{
                    "id": "frame-a",
                    "sourceId": "still",
                    "transform": TransformSpec::normalized(quad(0.0))
                }],
                "unexpected": true
            }
        }))
        .unwrap_err();

        assert!(error.to_string().contains("unknown field `unexpected`"));
    }
}
