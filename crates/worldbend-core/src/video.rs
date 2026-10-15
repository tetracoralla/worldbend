use crate::mockup_motion::plan_mockup_motion_with_pixel_limit;
use crate::{
    ErrorCode, MockupMotionPlan, MockupMotionSpec, MotionPlan, MotionSpec, RationalTime,
    TransformError, TransformResult, mockup_motion_display_duration,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

pub const VIDEO_SCHEMA: &str = "worldbend.video";
pub const VIDEO_PLAN_SCHEMA: &str = "worldbend.video-plan";
pub const VIDEO_VERSION: &str = "0.1";
pub const MAX_VIDEO_PIXELS: u64 = 256 * 1024 * 1024;

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":VIDEO_SCHEMA})
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":VIDEO_PLAN_SCHEMA})
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":VIDEO_VERSION})
}

/// Encoding policy is separate from canonical geometry and presentation time.
/// This profile is opaque, lossy, sRGB-derived 8-bit H.264 in an MP4 container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "format", rename_all = "camelCase", deny_unknown_fields)]
pub enum VideoEncoding {
    Mp4H264 {
        #[schemars(range(min = 0, max = 51))]
        crf: u8,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub motion: MotionSpec,
    pub encoding: VideoEncoding,
    /// Explicit opaque matte in sRGB8; an alpha-less format cannot guess it.
    pub background_rgb: [u8; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub motion: MotionPlan,
    pub encoding: VideoEncoding,
    pub background_rgb: [u8; 3],
    /// Includes the final frame's display interval, unlike Motion's last PTS.
    pub duration: RationalTime,
}

pub fn plan_video(spec: &VideoSpec) -> TransformResult<VideoPlan> {
    if spec.schema != VIDEO_SCHEMA || spec.version != VIDEO_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported video schema or version",
        ));
    }
    let VideoEncoding::Mp4H264 { crf } = spec.encoding;
    if crf > 51 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "H.264 CRF must be from 0 through 51",
        ));
    }
    let motion = crate::motion::plan_motion_with_pixel_limit(&spec.motion, MAX_VIDEO_PIXELS)?;
    if motion.output.width < 2
        || motion.output.height < 2
        || !motion.output.width.is_multiple_of(2)
        || !motion.output.height.is_multiple_of(2)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "the MP4 H.264 yuv420p profile requires even output axes of at least two pixels; no implicit resizing is applied",
        ));
    }
    let numerator = motion.frames.len() as u64 * u64::from(motion.timebase.denominator);
    let denominator = u64::from(motion.timebase.numerator);
    let divisor = gcd(numerator, denominator);
    Ok(VideoPlan {
        schema: VIDEO_PLAN_SCHEMA.into(),
        version: VIDEO_VERSION.into(),
        encoding: spec.encoding,
        background_rgb: spec.background_rgb,
        duration: RationalTime {
            numerator: numerator / divisor,
            denominator: denominator / divisor,
        },
        motion,
    })
}
fn gcd(mut a: u64, mut b: u64) -> u64 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        FrameRate, MOTION_SCHEMA, MOTION_VERSION, MotionKeyframe, PixelSize, Point, Quad, Size,
        TransformSpec, plan_motion,
    };
    fn spec(count: u32) -> VideoSpec {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(8.0, 0.0),
            Point::new(8.0, 6.0),
            Point::new(0.0, 6.0),
        );
        VideoSpec {
            schema: VIDEO_SCHEMA.into(),
            version: VIDEO_VERSION.into(),
            motion: MotionSpec {
                schema: MOTION_SCHEMA.into(),
                version: MOTION_VERSION.into(),
                output: PixelSize::new(8, 6),
                timebase: FrameRate {
                    numerator: 30000,
                    denominator: 1001,
                },
                source_id: "art".into(),
                frame_count: count,
                base: TransformSpec::pixel(Size::new(8.0, 6.0), quad),
                keyframes: if count == 1 {
                    vec![MotionKeyframe {
                        frame: 0,
                        quad,
                        easing_to_next: None,
                    }]
                } else {
                    vec![
                        MotionKeyframe {
                            frame: 0,
                            quad,
                            easing_to_next: None,
                        },
                        MotionKeyframe {
                            frame: count - 1,
                            quad,
                            easing_to_next: None,
                        },
                    ]
                },
            },
            encoding: VideoEncoding::Mp4H264 { crf: 18 },
            background_rgb: [255, 255, 255],
        }
    }
    #[test]
    fn includes_final_frame_interval_and_retains_exact_motion_plan() {
        let spec = spec(3);
        let result = plan_video(&spec).unwrap();
        assert_eq!(result.motion, plan_motion(&spec.motion).unwrap());
        assert_eq!(
            result.duration,
            RationalTime {
                numerator: 1001,
                denominator: 10000
            }
        );
        assert_eq!(
            result.motion.duration,
            RationalTime {
                numerator: 1001,
                denominator: 15000
            }
        );
        assert_eq!(
            plan_video(&self::spec(1)).unwrap().duration,
            RationalTime {
                numerator: 1001,
                denominator: 30000
            }
        );
    }
    #[test]
    fn rejects_profile_losses_or_invalid_timing_before_execution() {
        let mut spec = spec(3);
        spec.motion.output.width = 7;
        assert_eq!(plan_video(&spec).unwrap_err().code, ErrorCode::Schema);
        spec.motion.output.width = 8;
        spec.motion.timebase.numerator = 60000;
        spec.motion.timebase.denominator = 2002;
        assert_eq!(plan_video(&spec).unwrap_err().code, ErrorCode::Schema);
        spec.motion.timebase = FrameRate {
            numerator: 30,
            denominator: 1,
        };
        spec.encoding = VideoEncoding::Mp4H264 { crf: 52 };
        assert_eq!(plan_video(&spec).unwrap_err().code, ErrorCode::Schema);
    }
    #[test]
    fn wire_is_closed_and_requires_an_explicit_background() {
        let mut wire = serde_json::to_value(spec(1)).unwrap();
        wire.as_object_mut().unwrap().remove("backgroundRgb");
        assert!(serde_json::from_value::<VideoSpec>(wire).is_err());
        let mut wire = serde_json::to_value(spec(1)).unwrap();
        wire["encoder"] = "arbitrary-program".into();
        assert!(serde_json::from_value::<VideoSpec>(wire).is_err());
    }
    #[test]
    fn video_budget_supports_full_hd_seconds_without_changing_ordinary_motion() {
        let mut spec = spec(120);
        spec.motion.output = PixelSize::new(1920, 1080);
        assert!(plan_video(&spec).is_ok());
        assert_eq!(
            plan_motion(&spec.motion).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        spec.motion.frame_count = 240;
        spec.motion.keyframes[1].frame = 239;
        assert_eq!(plan_video(&spec).unwrap_err().code, ErrorCode::OutputLimit);
    }
}

pub const MOCKUP_VIDEO_SCHEMA: &str = "worldbend.mockup-video";
pub const MOCKUP_VIDEO_PLAN_SCHEMA: &str = "worldbend.mockup-video-plan";

fn mockup_video_spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_VIDEO_SCHEMA})
}
fn mockup_video_plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_VIDEO_PLAN_SCHEMA})
}

/// Multi-plane device/scene Motion encoded with the same opaque MP4 profile as
/// single-source Video. Geometry comes from `MockupMotionSpec`; timing uses the
/// Video display-duration rule (includes the final frame interval).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupVideoSpec {
    #[schemars(schema_with = "mockup_video_spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub mockup_motion: MockupMotionSpec,
    pub encoding: VideoEncoding,
    pub background_rgb: [u8; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupVideoPlan {
    #[schemars(schema_with = "mockup_video_plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub mockup_motion: MockupMotionPlan,
    pub encoding: VideoEncoding,
    pub background_rgb: [u8; 3],
    pub duration: RationalTime,
}

pub fn plan_mockup_video(spec: &MockupVideoSpec) -> TransformResult<MockupVideoPlan> {
    if spec.schema != MOCKUP_VIDEO_SCHEMA || spec.version != VIDEO_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported mockup-video schema or version",
        ));
    }
    let VideoEncoding::Mp4H264 { crf } = spec.encoding;
    if crf > 51 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "H.264 CRF must be from 0 through 51",
        ));
    }
    let mockup_motion = plan_mockup_motion_with_pixel_limit(&spec.mockup_motion, MAX_VIDEO_PIXELS)?;
    let output = mockup_motion.output_size();
    if output.width < 2
        || output.height < 2
        || !output.width.is_multiple_of(2)
        || !output.height.is_multiple_of(2)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "the MP4 H.264 yuv420p profile requires even mockup-motion canvas axes of at least two pixels; no implicit resizing is applied",
        ));
    }
    Ok(MockupVideoPlan {
        schema: MOCKUP_VIDEO_PLAN_SCHEMA.into(),
        version: VIDEO_VERSION.into(),
        encoding: spec.encoding,
        background_rgb: spec.background_rgb,
        duration: mockup_motion_display_duration(
            spec.mockup_motion.frame_count,
            mockup_motion.timebase,
        ),
        mockup_motion,
    })
}

#[cfg(test)]
mod mockup_video_tests {
    use super::*;
    use crate::{
        FrameRate, MOCKUP_MOTION_SCHEMA, MOCKUP_MOTION_VERSION, MockupMotionPlane, MotionEasing,
        MotionKeyframe, Point, Quad, TransformSpec,
    };

    fn quad(x: f64) -> Quad {
        Quad::new(
            Point::new(x, 0.1),
            Point::new(x + 0.5, 0.1),
            Point::new(x + 0.5, 0.8),
            Point::new(x, 0.8),
        )
    }

    #[test]
    fn plans_multi_plane_display_duration_like_video() {
        let plane = |id: &str, source: &str, end: f64| MockupMotionPlane {
            id: id.into(),
            source_id: source.into(),
            base: TransformSpec::normalized(quad(0.1)),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: quad(0.1),
                    easing_to_next: Some(MotionEasing::Linear),
                },
                MotionKeyframe {
                    frame: 59,
                    quad: quad(end),
                    easing_to_next: None,
                },
            ],
            opacity: 1.0,
            shadow: None,
            surface: None,
            grid: None,
            measurement: None,
        };
        let spec = MockupVideoSpec {
            schema: MOCKUP_VIDEO_SCHEMA.into(),
            version: VIDEO_VERSION.into(),
            encoding: VideoEncoding::Mp4H264 { crf: 18 },
            background_rgb: [16, 22, 34],
            mockup_motion: MockupMotionSpec {
                schema: MOCKUP_MOTION_SCHEMA.into(),
                version: MOCKUP_MOTION_VERSION.into(),
                canvas: crate::PixelSize {
                    width: 640,
                    height: 480,
                },
                timebase: FrameRate {
                    numerator: 30,
                    denominator: 1,
                },
                frame_count: 60,
                planes: vec![plane("bg", "bg", 0.1), plane("device", "screen", 0.18)],
                background: crate::CanvasBackground::Transparent {},
                seams: vec![],
                clip: None,
                presentation: None,
            },
        };
        let plan = plan_mockup_video(&spec).unwrap();
        assert_eq!(
            plan.duration,
            RationalTime {
                numerator: 2,
                denominator: 1
            }
        );
        assert_eq!(plan.mockup_motion.frames.len(), 60);
        assert_eq!(plan.mockup_motion.source_ids, ["bg", "screen"]);
    }
}
