//! Shared authoring mutations over the ordinary timed scene. No carrier-local
//! interpolation, resource bypass or hidden source/geometry conversion.
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{
    ErrorCode, FrameRate, MockupMotionPlane, MockupMotionSpec, MockupSpec, MotionEasing,
    MotionKeyframe, RationalTime, TransformError, TransformResult, mockup_motion_display_duration,
    plan_mockup, plan_mockup_motion,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum MockupMotionAuthoringInput {
    Create {
        scene: MockupSpec,
        timebase: FrameRate,
        #[serde(rename = "frameCount")]
        frame_count: u32,
    },
    Inspect {
        spec: MockupMotionSpec,
    },
    Revise {
        spec: MockupMotionSpec,
        #[serde(rename = "expectedFingerprint")]
        expected_fingerprint: String,
        edit: Box<MockupMotionEdit>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CanvasBackground, MockupGrid, MockupPhysicalSize, MockupPlane, MockupShadow, PixelSize,
        Point, Quad, TransformSpec,
    };
    fn create() -> MockupMotionAuthoringOutput {
        author_mockup_motion(&MockupMotionAuthoringInput::Create {
            scene: MockupSpec {
                schema: crate::MOCKUP_SCHEMA.into(),
                version: crate::MOCKUP_VERSION.into(),
                canvas: PixelSize::new(64, 48),
                background: CanvasBackground::Transparent {},
                seams: vec![],
                clip: None,
                planes: vec![MockupPlane {
                    id: "cover".into(),
                    source_id: "art".into(),
                    transform: TransformSpec::normalized(Quad::unit()),
                    opacity: 0.8,
                    grid: Some(MockupGrid {
                        columns: 3,
                        rows: 4,
                    }),
                    measurement: Some(MockupPhysicalSize {
                        width: 21.,
                        height: 28.,
                        unit: "cm".into(),
                    }),
                    surface: Some(crate::MockupSurface::Cylinder {
                        curvature: 0.3,
                        tilt: 0.,
                        light: Default::default(),
                    }),
                    shadow: Some(MockupShadow {
                        offset: Point::new(3., 4.),
                        blur_sigma_px: 2.,
                        color: [12, 24, 36],
                        opacity: 0.25,
                    }),
                }],
            },
            timebase: FrameRate {
                numerator: 24,
                denominator: 1,
            },
            frame_count: 96,
        })
        .unwrap()
    }
    fn revise(
        base: &MockupMotionAuthoringOutput,
        edit: MockupMotionEdit,
    ) -> TransformResult<MockupMotionAuthoringOutput> {
        author_mockup_motion(&MockupMotionAuthoringInput::Revise {
            spec: base.spec.clone(),
            expected_fingerprint: base.fingerprint.clone(),
            edit: Box::new(edit),
        })
    }
    #[test]
    fn static_creation_retains_scene_and_exact_video_timing() {
        let state = create();
        assert_eq!(
            state.display_duration,
            RationalTime {
                numerator: 4,
                denominator: 1
            }
        );
        assert_eq!(state.keyframe_frames, vec![0, 95]);
        let frames = plan_mockup_motion(&state.spec).unwrap();
        assert!(frames.frame_specs.iter().all(|frame| {
            let p = &frame.planes[0];
            p.shadow == state.spec.planes[0].shadow
                && p.surface == state.spec.planes[0].surface
                && p.grid == state.spec.planes[0].grid
                && p.measurement == state.spec.planes[0].measurement
        }));
        assert_eq!(
            state.fingerprint,
            author_mockup_motion(&MockupMotionAuthoringInput::Inspect { spec: state.spec })
                .unwrap()
                .fingerprint
        );
    }
    #[test]
    fn keyframe_edit_capture_retime_and_stale_write_keep_whole_work() {
        let first = create();
        let mut q = Quad::unit();
        for p in [&mut q.tl, &mut q.tr, &mut q.br, &mut q.bl] {
            p.x += 0.1;
        }
        let edited = revise(
            &first,
            MockupMotionEdit::SetKeyframe {
                plane_id: "cover".into(),
                keyframe: MotionKeyframe {
                    frame: 47,
                    quad: q,
                    easing_to_next: Some(MotionEasing::Hold),
                },
            },
        )
        .unwrap();
        assert!(edited.changed);
        assert_ne!(first.fingerprint, edited.fingerprint);
        let captured = revise(
            &edited,
            MockupMotionEdit::CapturePose {
                frame: 24,
                plane_ids: None,
                easing_to_next: Some(MotionEasing::Linear),
            },
        )
        .unwrap();
        assert_eq!(
            captured.spec.planes[0].keyframes[1].quad,
            plan_mockup_motion(&edited.spec).unwrap().frame_specs[24].planes[0]
                .transform
                .destination
                .quad
        );
        let retimed = revise(
            &captured,
            MockupMotionEdit::Retime {
                timebase: FrameRate {
                    numerator: 24,
                    denominator: 1,
                },
                frame_count: 144,
            },
        )
        .unwrap();
        assert_eq!(
            retimed.display_duration,
            RationalTime {
                numerator: 6,
                denominator: 1
            }
        );
        assert_eq!(retimed.keyframe_frames, vec![0, 36, 71, 143]);
        let stale = author_mockup_motion(&MockupMotionAuthoringInput::Revise {
            spec: retimed.spec.clone(),
            expected_fingerprint: first.fingerprint,
            edit: Box::new(MockupMotionEdit::ReorderPlanes {
                ids: vec!["cover".into()],
            }),
        })
        .unwrap_err();
        assert_eq!(stale.details.unwrap()["reason"], "staleMotion");
        assert_eq!(retimed.spec.planes[0].shadow, first.spec.planes[0].shadow);
    }
    #[test]
    fn whole_view_pose_revision_retime_and_framing_keep_the_full_work() {
        let seed = create();
        let presentation = crate::MockupMotionPresentation {
            transform: TransformSpec::normalized(Quad::unit()),
            size: PixelSize::new(80, 60),
            output: crate::SpatialTemplateOutput::Single {
                id: "output".into(),
            },
            output_id: "output".into(),
            keyframes: vec![],
        };
        let base = revise(
            &seed,
            MockupMotionEdit::SetPresentation {
                presentation: Some(Box::new(presentation.clone())),
            },
        )
        .unwrap();
        let mut tilted = Quad::unit();
        tilted.tr.x = 0.85;
        tilted.tr.y = 0.15;
        tilted.br.x = 0.8;
        let moved = revise(
            &base,
            MockupMotionEdit::SetPresentationAtFrame {
                frame: 48,
                presentation: Box::new(crate::MockupMotionPresentation {
                    transform: TransformSpec::normalized(tilted),
                    ..presentation.clone()
                }),
            },
        )
        .unwrap();
        let plan = plan_mockup_motion(&moved.spec).unwrap();
        assert_eq!(plan.presentation_frames.len(), 96);
        assert_eq!(
            plan.presentation_at(48)
                .unwrap()
                .spec
                .transform
                .destination
                .quad,
            tilted
        );
        assert_eq!(
            plan.presentation_at(0)
                .unwrap()
                .spec
                .transform
                .destination
                .quad,
            Quad::unit()
        );
        assert_eq!(moved.spec.planes, base.spec.planes);
        let mut framed = plan.presentation_at(48).unwrap().spec.clone();
        framed.keyframes.clear();
        framed.size = PixelSize::new(120, 80);
        let style = revise(
            &moved,
            MockupMotionEdit::SetPresentationAtFrame {
                frame: 48,
                presentation: Box::new(framed),
            },
        )
        .unwrap();
        assert_eq!(
            style.spec.presentation.as_ref().unwrap().keyframes,
            moved.spec.presentation.as_ref().unwrap().keyframes
        );
        let mut pixel_view = plan_mockup_motion(&style.spec)
            .unwrap()
            .presentation_at(48)
            .unwrap()
            .spec
            .clone();
        pixel_view.keyframes.clear();
        pixel_view.transform.destination.space = crate::CoordinateSpace::Pixel;
        pixel_view.transform.destination.reference = Some(crate::Size::new(
            f64::from(pixel_view.size.width),
            f64::from(pixel_view.size.height),
        ));
        for point in [
            &mut pixel_view.transform.destination.quad.tl,
            &mut pixel_view.transform.destination.quad.tr,
            &mut pixel_view.transform.destination.quad.br,
            &mut pixel_view.transform.destination.quad.bl,
        ] {
            point.x *= f64::from(pixel_view.size.width);
            point.y *= f64::from(pixel_view.size.height);
        }
        let converted = revise(
            &style,
            MockupMotionEdit::SetPresentationAtFrame {
                frame: 48,
                presentation: Box::new(pixel_view),
            },
        )
        .unwrap();
        let normalized_plan = plan_mockup_motion(&style.spec).unwrap();
        let pixel_plan = plan_mockup_motion(&converted.spec).unwrap();
        for frame in [0, 24, 48, 95] {
            assert_eq!(
                normalized_plan
                    .presentation_at(frame)
                    .unwrap()
                    .solve
                    .resolved_destination
                    .quad,
                pixel_plan
                    .presentation_at(frame)
                    .unwrap()
                    .solve
                    .resolved_destination
                    .quad
            );
        }
        let retimed = revise(
            &style,
            MockupMotionEdit::Retime {
                timebase: style.spec.timebase,
                frame_count: 144,
            },
        )
        .unwrap();
        assert_eq!(
            retimed
                .spec
                .presentation
                .as_ref()
                .unwrap()
                .keyframes
                .iter()
                .map(|k| k.frame)
                .collect::<Vec<_>>(),
            vec![0, 72, 143]
        );
        assert_eq!(retimed.keyframe_frames, vec![0, 72, 143]);
        assert!(
            revise(
                &retimed,
                MockupMotionEdit::Retime {
                    timebase: retimed.spec.timebase,
                    frame_count: 2
                }
            )
            .is_err()
        );
        assert!(
            revise(
                &retimed,
                MockupMotionEdit::RemovePresentationKeyframe { frame: 0 }
            )
            .is_err()
        );
        let removed = revise(
            &retimed,
            MockupMotionEdit::RemovePresentationKeyframe { frame: 72 },
        )
        .unwrap();
        assert_eq!(removed.spec.presentation.unwrap().keyframes.len(), 2);
    }
    #[test]
    fn joined_planes_are_revised_atomically_and_keep_their_seam() {
        let seed = create();
        let mut spec = seed.spec;
        let mut second = spec.planes[0].clone();
        second.id = "side".into();
        for plane in [&mut spec.planes[0], &mut second] {
            plane.surface = None;
            plane.base.destination.space = crate::CoordinateSpace::Normalized;
        }
        let left = Quad::new(
            Point::new(0., 0.),
            Point::new(0.5, 0.),
            Point::new(0.5, 1.),
            Point::new(0., 1.),
        );
        let right = Quad::new(
            Point::new(0.5, 0.),
            Point::new(1., 0.),
            Point::new(1., 1.),
            Point::new(0.5, 1.),
        );
        for (plane, quad) in [(&mut spec.planes[0], left), (&mut second, right)] {
            plane.base.destination.quad = quad;
            for key in &mut plane.keyframes {
                key.quad = quad;
            }
        }
        spec.planes.push(second);
        spec.seams.push(crate::MockupSeam {
            first: crate::MockupEdgeRef {
                plane_id: "cover".into(),
                edge: crate::MockupEdge::Right,
            },
            second: crate::MockupEdgeRef {
                plane_id: "side".into(),
                edge: crate::MockupEdge::Left,
            },
            tolerance_pixels: 0.,
        });
        let base = author_mockup_motion(&MockupMotionAuthoringInput::Inspect { spec }).unwrap();
        let mut next_left = left;
        next_left.tr.x = 0.6;
        next_left.br.x = 0.6;
        let mut next_right = right;
        next_right.tl.x = 0.6;
        next_right.bl.x = 0.6;
        assert!(
            revise(
                &base,
                MockupMotionEdit::SetKeyframe {
                    plane_id: "cover".into(),
                    keyframe: MotionKeyframe {
                        frame: 47,
                        quad: next_left,
                        easing_to_next: None
                    }
                }
            )
            .is_err()
        );
        let revised = revise(
            &base,
            MockupMotionEdit::SetPose {
                frame: 47,
                planes: vec![
                    MockupMotionPosePlane {
                        plane_id: "cover".into(),
                        quad: next_left,
                        easing_to_next: None,
                    },
                    MockupMotionPosePlane {
                        plane_id: "side".into(),
                        quad: next_right,
                        easing_to_next: None,
                    },
                ],
            },
        )
        .unwrap();
        assert_eq!(revised.spec.seams, base.spec.seams);
        let plan = plan_mockup_motion(&revised.spec).unwrap();
        for frame in plan.frame_specs {
            assert_eq!(
                plan_mockup(&frame).unwrap().seams[0].maximum_error_pixels,
                0.
            );
        }
        assert_eq!(base.spec.planes[0].keyframes.len(), 2);
    }
    #[test]
    fn scene_pose_edits_keep_other_times_and_do_not_invent_poses_for_style_only_edits() {
        let first = create();
        let mut later = Quad::unit();
        later.tr.x = 0.8;
        later.br.x = 0.9;
        let animated = revise(
            &first,
            MockupMotionEdit::SetKeyframe {
                plane_id: "cover".into(),
                keyframe: MotionKeyframe {
                    frame: 60,
                    quad: later,
                    easing_to_next: Some(MotionEasing::Hold),
                },
            },
        )
        .unwrap();
        let mut scene = plan_mockup_motion(&animated.spec).unwrap().frame_specs[30].clone();
        scene.planes[0].opacity = 0.3;
        let styled = revise(
            &animated,
            MockupMotionEdit::SetScenePose {
                frame: 30,
                scene: Box::new(scene.clone()),
            },
        )
        .unwrap();
        assert_eq!(styled.keyframe_frames, vec![0, 60, 95]);
        scene.planes[0].transform.destination.quad.tl.x = 0.1;
        let posed = revise(
            &styled,
            MockupMotionEdit::SetScenePose {
                frame: 30,
                scene: Box::new(scene.clone()),
            },
        )
        .unwrap();
        assert_eq!(posed.keyframe_frames, vec![0, 30, 60, 95]);
        assert_eq!(posed.spec.planes[0].keyframes[2].quad, later);
        assert_eq!(
            posed.spec.planes[0].keyframes[2].easing_to_next,
            Some(MotionEasing::Hold)
        );
        assert_eq!(posed.spec.planes[0].opacity, 0.3);
        assert_eq!(posed.spec.planes[0].shadow, first.spec.planes[0].shadow);
        assert_eq!(
            posed.spec.planes[0].measurement,
            first.spec.planes[0].measurement
        );
        assert_eq!(
            plan_mockup_motion(&posed.spec).unwrap().frame_specs[30],
            scene
        );
        let mut missing = scene;
        missing.planes.clear();
        assert!(
            revise(
                &posed,
                MockupMotionEdit::SetScenePose {
                    frame: 30,
                    scene: Box::new(missing)
                }
            )
            .is_err()
        );
    }
    #[test]
    fn invalid_mutations_do_not_merge_or_drop_authored_poses() {
        let state = create();
        assert!(
            revise(
                &state,
                MockupMotionEdit::RemoveKeyframe {
                    plane_id: "cover".into(),
                    frame: 0
                }
            )
            .is_err()
        );
        assert!(
            revise(
                &state,
                MockupMotionEdit::MoveKeyframe {
                    plane_id: "cover".into(),
                    frame: 0,
                    to_frame: 95
                }
            )
            .is_err()
        );
        let captured = revise(
            &state,
            MockupMotionEdit::CapturePose {
                frame: 1,
                plane_ids: None,
                easing_to_next: None,
            },
        )
        .unwrap();
        assert!(
            revise(
                &captured,
                MockupMotionEdit::Retime {
                    timebase: state.spec.timebase,
                    frame_count: 2
                }
            )
            .is_err()
        );
        assert!(
            revise(
                &state,
                MockupMotionEdit::CapturePose {
                    frame: 10,
                    plane_ids: Some(vec!["cover".into(), "cover".into()]),
                    easing_to_next: None
                }
            )
            .is_err()
        );
        assert_eq!(state.keyframe_frames, vec![0, 95]);
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MockupMotionEdit {
    SetPresentation {
        presentation: Option<Box<crate::MockupMotionPresentation>>,
    },
    SetPresentationAtFrame {
        frame: u32,
        presentation: Box<crate::MockupMotionPresentation>,
    },
    SetPresentationKeyframe {
        keyframe: MotionKeyframe,
    },
    RemovePresentationKeyframe {
        frame: u32,
    },
    SetScenePose {
        frame: u32,
        scene: Box<MockupSpec>,
    },
    SetPose {
        frame: u32,
        planes: Vec<MockupMotionPosePlane>,
    },
    SetKeyframe {
        #[serde(rename = "planeId")]
        plane_id: String,
        keyframe: MotionKeyframe,
    },
    RemoveKeyframe {
        #[serde(rename = "planeId")]
        plane_id: String,
        frame: u32,
    },
    MoveKeyframe {
        #[serde(rename = "planeId")]
        plane_id: String,
        frame: u32,
        #[serde(rename = "toFrame")]
        to_frame: u32,
    },
    CapturePose {
        frame: u32,
        #[serde(default, rename = "planeIds")]
        plane_ids: Option<Vec<String>>,
        #[serde(default, rename = "easingToNext")]
        easing_to_next: Option<MotionEasing>,
    },
    Retime {
        timebase: FrameRate,
        #[serde(rename = "frameCount")]
        frame_count: u32,
    },
    ReplacePlane {
        plane: Box<MockupMotionPlane>,
    },
    ReorderPlanes {
        ids: Vec<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockupMotionPosePlane {
    pub plane_id: String,
    pub quad: crate::Quad,
    #[serde(default)]
    pub easing_to_next: Option<MotionEasing>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockupMotionAuthoringOutput {
    #[schemars(schema_with = "output_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub spec: MockupMotionSpec,
    pub fingerprint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_fingerprint: Option<String>,
    pub changed: bool,
    pub source_ids: Vec<String>,
    pub keyframe_frames: Vec<u32>,
    pub display_duration: RationalTime,
}
fn output_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.mockup-motion-authoring"})
}
fn version_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"0.1"})
}
fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn fingerprint(spec: &MockupMotionSpec) -> TransformResult<String> {
    fingerprint_json_value(&canonical_json_value(spec).map_err(|e| error(&e.to_string()))?)
        .map_err(|e| error(&e.to_string()))
}
fn plane_mut<'a>(
    spec: &'a mut MockupMotionSpec,
    id: &str,
) -> TransformResult<&'a mut MockupMotionPlane> {
    spec.planes
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| error("Use an existing motion plane identity"))
}
fn set_keyframe(plane: &mut MockupMotionPlane, keyframe: MotionKeyframe) {
    if keyframe.frame == 0 {
        plane.base.destination.quad = keyframe.quad;
    }
    set_frame(&mut plane.keyframes, keyframe);
}
fn set_frame(keys: &mut Vec<MotionKeyframe>, keyframe: MotionKeyframe) {
    match keys.binary_search_by_key(&keyframe.frame, |k| k.frame) {
        Ok(index) => keys[index] = keyframe,
        Err(index) => keys.insert(index, keyframe),
    }
}
fn retime_keys(keys: &mut Vec<MotionKeyframe>, previous: u32, count: u32) -> TransformResult<()> {
    if count == 1 {
        if keys.len() > 1 {
            return Err(error(
                "Retiming would merge authored poses; keep enough frames",
            ));
        }
    } else if previous == 1 {
        let mut last = keys[0];
        last.frame = count - 1;
        keys.push(last);
    } else {
        let mut used = HashSet::new();
        for key in keys {
            key.frame = ((u64::from(key.frame) * u64::from(count - 1)
                + u64::from(previous - 1) / 2)
                / u64::from(previous - 1)) as u32;
            if !used.insert(key.frame) {
                return Err(error(
                    "Retiming would merge authored poses; keep enough frames",
                ));
            }
        }
    }
    Ok(())
}

pub fn author_mockup_motion(
    input: &MockupMotionAuthoringInput,
) -> TransformResult<MockupMotionAuthoringOutput> {
    let (mut spec, previous) = match input {
        MockupMotionAuthoringInput::Create {
            scene,
            timebase,
            frame_count,
        } => {
            plan_mockup(scene)?;
            if *frame_count == 0 || *frame_count as usize > crate::MAX_TIMELINE_FRAMES {
                return Err(error("Use a supported positive motion frame count"));
            }
            let planes = scene
                .planes
                .iter()
                .map(|plane| {
                    let first = MotionKeyframe {
                        frame: 0,
                        quad: plane.transform.destination.quad,
                        easing_to_next: None,
                    };
                    let mut keyframes = vec![first];
                    if *frame_count > 1 {
                        keyframes.push(MotionKeyframe {
                            frame: *frame_count - 1,
                            ..first
                        });
                    }
                    MockupMotionPlane {
                        id: plane.id.clone(),
                        source_id: plane.source_id.clone(),
                        base: plane.transform.clone(),
                        keyframes,
                        opacity: plane.opacity,
                        surface: plane.surface,
                        shadow: plane.shadow,
                        grid: plane.grid,
                        measurement: plane.measurement.clone(),
                    }
                })
                .collect();
            (
                MockupMotionSpec {
                    schema: crate::MOCKUP_MOTION_SCHEMA.into(),
                    version: crate::MOCKUP_MOTION_VERSION.into(),
                    canvas: scene.canvas,
                    timebase: *timebase,
                    frame_count: *frame_count,
                    planes,
                    background: scene.background,
                    seams: scene.seams.clone(),
                    clip: scene.clip.clone(),
                    presentation: None,
                },
                None,
            )
        }
        MockupMotionAuthoringInput::Inspect { spec } => {
            plan_mockup_motion(spec)?;
            (spec.clone(), None)
        }
        MockupMotionAuthoringInput::Revise {
            spec,
            expected_fingerprint,
            ..
        } => {
            plan_mockup_motion(spec)?;
            let current = fingerprint(spec)?;
            if &current != expected_fingerprint {
                return Err(error("Motion changed; reread before revising").with_details(serde_json::json!({"reason":"staleMotion","expected":expected_fingerprint,"current":current})));
            }
            (spec.clone(), Some(current))
        }
    };
    if let MockupMotionAuthoringInput::Revise { edit, .. } = input {
        match edit.as_ref() {
            MockupMotionEdit::SetPresentation { presentation } => {
                spec.presentation = presentation.clone();
            }
            MockupMotionEdit::SetPresentationAtFrame {
                frame,
                presentation,
            } => {
                if *frame >= spec.frame_count {
                    return Err(error("Use a frame inside the motion"));
                }
                if !presentation.keyframes.is_empty() {
                    return Err(error(
                        "Set a sampled presentation without replacing its authored keyframes",
                    ));
                }
                let plan = plan_mockup_motion(&spec)?;
                let sampled = plan.presentation_at(*frame as usize);
                let mut next = presentation.clone();
                let desired = next.transform.destination.quad;
                if let Some(previous) = spec.presentation.as_ref() {
                    next.keyframes = previous.keyframes.clone();
                    let mut sampled_quad = sampled
                        .expect("existing presentation")
                        .spec
                        .transform
                        .destination
                        .quad;
                    if previous.transform.destination.space != next.transform.destination.space {
                        let old_size = previous.size;
                        let new_size = next.size;
                        let convert = |quad: &mut crate::Quad| {
                            for point in [&mut quad.tl, &mut quad.tr, &mut quad.br, &mut quad.bl] {
                                if previous.transform.destination.space
                                    == crate::CoordinateSpace::Pixel
                                {
                                    point.x /= f64::from(old_size.width);
                                    point.y /= f64::from(old_size.height);
                                }
                                if next.transform.destination.space == crate::CoordinateSpace::Pixel
                                {
                                    point.x *= f64::from(new_size.width);
                                    point.y *= f64::from(new_size.height);
                                }
                            }
                        };
                        convert(&mut sampled_quad);
                        for key in &mut next.keyframes {
                            convert(&mut key.quad);
                        }
                    }
                    if desired != sampled_quad {
                        if next.keyframes.is_empty() {
                            let first = MotionKeyframe {
                                frame: 0,
                                quad: sampled_quad,
                                easing_to_next: None,
                            };
                            next.keyframes.push(first);
                            if spec.frame_count > 1 {
                                next.keyframes.push(MotionKeyframe {
                                    frame: spec.frame_count - 1,
                                    ..first
                                });
                            }
                        }
                        let easing_to_next = next
                            .keyframes
                            .iter()
                            .find(|k| k.frame == *frame)
                            .and_then(|k| k.easing_to_next);
                        set_frame(
                            &mut next.keyframes,
                            MotionKeyframe {
                                frame: *frame,
                                quad: desired,
                                easing_to_next,
                            },
                        );
                    }
                    if let Some(first) = next.keyframes.first() {
                        next.transform.destination.quad = first.quad;
                    }
                }
                spec.presentation = Some(next);
            }
            MockupMotionEdit::SetPresentationKeyframe { keyframe } => {
                let count = spec.frame_count;
                let presentation = spec
                    .presentation
                    .as_mut()
                    .ok_or_else(|| error("Set whole presentation before authoring its poses"))?;
                if presentation.keyframes.is_empty() {
                    let first = MotionKeyframe {
                        frame: 0,
                        quad: presentation.transform.destination.quad,
                        easing_to_next: None,
                    };
                    presentation.keyframes.push(first);
                    if count > 1 {
                        presentation.keyframes.push(MotionKeyframe {
                            frame: count - 1,
                            ..first
                        });
                    }
                }
                if keyframe.frame == 0 {
                    presentation.transform.destination.quad = keyframe.quad;
                }
                set_frame(&mut presentation.keyframes, *keyframe);
            }
            MockupMotionEdit::RemovePresentationKeyframe { frame } => {
                let presentation = spec
                    .presentation
                    .as_mut()
                    .ok_or_else(|| error("Whole presentation is unavailable"))?;
                let index = presentation
                    .keyframes
                    .iter()
                    .position(|k| k.frame == *frame)
                    .ok_or_else(|| error("Use an existing whole-view keyframe"))?;
                presentation.keyframes.remove(index);
            }
            MockupMotionEdit::SetScenePose { frame, scene } => {
                plan_mockup(scene)?;
                let sampled = plan_mockup_motion(&spec)?
                    .frame_specs
                    .get(*frame as usize)
                    .cloned()
                    .ok_or_else(|| error("Use a frame inside the motion"))?;
                let ids = scene.planes.iter().map(|p| &p.id).collect::<HashSet<_>>();
                if ids.len() != spec.planes.len()
                    || spec.planes.iter().any(|p| !ids.contains(&p.id))
                {
                    return Err(error(
                        "A scene pose must retain every existing motion plane",
                    ));
                }
                for next in &scene.planes {
                    let previous = sampled
                        .planes
                        .iter()
                        .find(|p| p.id == next.id)
                        .expect("validated plane");
                    let plane = plane_mut(&mut spec, &next.id)?;
                    let old_space = plane.base.destination.space;
                    let new_space = next.transform.destination.space;
                    if old_space != new_space {
                        for key in &mut plane.keyframes {
                            for point in [
                                &mut key.quad.tl,
                                &mut key.quad.tr,
                                &mut key.quad.br,
                                &mut key.quad.bl,
                            ] {
                                if old_space == crate::CoordinateSpace::Pixel {
                                    point.x /= f64::from(scene.canvas.width);
                                    point.y /= f64::from(scene.canvas.height);
                                } else {
                                    point.x *= f64::from(scene.canvas.width);
                                    point.y *= f64::from(scene.canvas.height);
                                }
                            }
                        }
                    }
                    let first_quad = plane.keyframes[0].quad;
                    plane.base = next.transform.clone();
                    plane.base.destination.quad = first_quad;
                    plane.source_id = next.source_id.clone();
                    plane.opacity = next.opacity;
                    plane.grid = next.grid;
                    plane.measurement = next.measurement.clone();
                    plane.surface = next.surface;
                    plane.shadow = next.shadow;
                    if previous.transform.destination != next.transform.destination {
                        let easing = plane
                            .keyframes
                            .iter()
                            .find(|k| k.frame == *frame)
                            .and_then(|k| k.easing_to_next);
                        set_keyframe(
                            plane,
                            MotionKeyframe {
                                frame: *frame,
                                quad: next.transform.destination.quad,
                                easing_to_next: easing,
                            },
                        );
                    }
                }
                spec.canvas = scene.canvas;
                spec.background = scene.background;
                spec.clip = scene.clip.clone();
                spec.seams = scene.seams.clone();
                spec.planes = scene
                    .planes
                    .iter()
                    .map(|p| {
                        spec.planes
                            .iter()
                            .find(|v| v.id == p.id)
                            .expect("validated plane")
                            .clone()
                    })
                    .collect();
            }

            MockupMotionEdit::SetPose { frame, planes } => {
                if planes.is_empty()
                    || planes.len() > spec.planes.len()
                    || planes
                        .iter()
                        .map(|p| &p.plane_id)
                        .collect::<HashSet<_>>()
                        .len()
                        != planes.len()
                {
                    return Err(error("Set a pose for distinct existing planes"));
                }
                for pose in planes {
                    set_keyframe(
                        plane_mut(&mut spec, &pose.plane_id)?,
                        MotionKeyframe {
                            frame: *frame,
                            quad: pose.quad,
                            easing_to_next: pose.easing_to_next,
                        },
                    );
                }
            }
            MockupMotionEdit::SetKeyframe { plane_id, keyframe } => {
                set_keyframe(plane_mut(&mut spec, plane_id)?, *keyframe)
            }
            MockupMotionEdit::RemoveKeyframe { plane_id, frame } => {
                let plane = plane_mut(&mut spec, plane_id)?;
                let index = plane
                    .keyframes
                    .iter()
                    .position(|k| k.frame == *frame)
                    .ok_or_else(|| error("Use an existing keyframe"))?;
                plane.keyframes.remove(index);
            }
            MockupMotionEdit::MoveKeyframe {
                plane_id,
                frame,
                to_frame,
            } => {
                let plane = plane_mut(&mut spec, plane_id)?;
                let index = plane
                    .keyframes
                    .iter()
                    .position(|k| k.frame == *frame)
                    .ok_or_else(|| error("Use an existing keyframe"))?;
                if frame != to_frame && plane.keyframes.iter().any(|k| k.frame == *to_frame) {
                    return Err(error("A keyframe already occupies that frame"));
                }
                let mut keyframe = plane.keyframes.remove(index);
                keyframe.frame = *to_frame;
                set_keyframe(plane, keyframe);
            }
            MockupMotionEdit::CapturePose {
                frame,
                plane_ids,
                easing_to_next,
            } => {
                let plan = plan_mockup_motion(&spec)?;
                let pose = plan
                    .frame_specs
                    .get(*frame as usize)
                    .ok_or_else(|| error("Use a frame inside the motion"))?;
                let ids = plane_ids
                    .clone()
                    .unwrap_or_else(|| spec.planes.iter().map(|p| p.id.clone()).collect());
                let unique: HashSet<_> = ids.iter().collect();
                if ids.is_empty()
                    || unique.len() != ids.len()
                    || ids
                        .iter()
                        .any(|id| !spec.planes.iter().any(|p| &p.id == id))
                {
                    return Err(error("Capture distinct existing motion planes"));
                }
                for id in ids {
                    let quad = pose
                        .planes
                        .iter()
                        .find(|p| p.id == id)
                        .expect("validated plane")
                        .transform
                        .destination
                        .quad;
                    let plane = plane_mut(&mut spec, &id)?;
                    let easing = easing_to_next.or_else(|| {
                        plane
                            .keyframes
                            .iter()
                            .find(|k| k.frame == *frame)
                            .and_then(|k| k.easing_to_next)
                    });
                    set_keyframe(
                        plane,
                        MotionKeyframe {
                            frame: *frame,
                            quad,
                            easing_to_next: easing,
                        },
                    );
                }
            }
            MockupMotionEdit::Retime {
                timebase,
                frame_count,
            } => {
                if *frame_count == 0 || *frame_count as usize > crate::MAX_TIMELINE_FRAMES {
                    return Err(error("Use a supported positive motion frame count"));
                }
                let previous_count = spec.frame_count;
                for plane in &mut spec.planes {
                    retime_keys(&mut plane.keyframes, previous_count, *frame_count)?;
                }
                if let Some(presentation) = spec
                    .presentation
                    .as_mut()
                    .filter(|p| !p.keyframes.is_empty())
                {
                    retime_keys(&mut presentation.keyframes, previous_count, *frame_count)?;
                }
                spec.timebase = *timebase;
                spec.frame_count = *frame_count;
            }
            MockupMotionEdit::ReplacePlane { plane } => {
                *plane_mut(&mut spec, &plane.id)? = plane.as_ref().clone()
            }
            MockupMotionEdit::ReorderPlanes { ids } => {
                if ids.len() != spec.planes.len()
                    || ids.iter().collect::<HashSet<_>>().len() != ids.len()
                    || ids
                        .iter()
                        .any(|id| !spec.planes.iter().any(|p| &p.id == id))
                {
                    return Err(error("Reorder every existing plane exactly once"));
                }
                spec.planes = ids
                    .iter()
                    .map(|id| {
                        spec.planes
                            .iter()
                            .find(|p| &p.id == id)
                            .expect("validated plane")
                            .clone()
                    })
                    .collect();
            }
        }
    }
    let plan = plan_mockup_motion(&spec)?;
    let current = fingerprint(&spec)?;
    Ok(MockupMotionAuthoringOutput {
        schema: "worldbend.mockup-motion-authoring".into(),
        version: "0.1".into(),
        changed: previous.as_ref().is_some_and(|old| old != &current),
        fingerprint: current,
        previous_fingerprint: previous,
        source_ids: plan.source_ids,
        keyframe_frames: spec
            .planes
            .iter()
            .flat_map(|p| p.keyframes.iter().map(|k| k.frame))
            .chain(
                spec.presentation
                    .iter()
                    .flat_map(|p| p.keyframes.iter().map(|k| k.frame)),
            )
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        display_duration: mockup_motion_display_duration(spec.frame_count, spec.timebase),
        spec,
    })
}
