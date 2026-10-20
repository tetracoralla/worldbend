use crate::easing::MotionEasing;
use crate::easing::{apply_easing, validate_easing};
use crate::pose::{RigidPlane, project_rigid_plane};
use crate::{
    CssTransform, ErrorCode, Point, Quad, Size, TransformError, TransformResult, TransformSpec,
    cross, emit_css_transform, polygon_signed_area,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

pub const CARD_SCHEMA: &str = "worldbend.card";
pub const CARD_VERSION: &str = "0.1";

/// Maximum single-axis view angle: eight revolutions each way plus envelope
/// tilt. One and two revolutions stay distinguishable because the view keeps
/// the cumulative angle, not its modulo-360 remainder.
const MAX_VIEW_ANGLE: f64 = 3600.0;
const EDGE_AREA_EPSILON: f64 = 1.0e-12;

fn schema_field(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CARD_SCHEMA })
}
fn version_field(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CARD_VERSION })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardGeometry {
    /// Perspective distance in CSS pixels, shared by every view of the card.
    #[schemars(range(min = 1))]
    pub perspective: f64,
    /// Rotation origin as a fraction of the element border box; center by default.
    #[serde(default = "geometry_anchor")]
    pub pivot: crate::NormalizedAnchor,
    /// Projection origin as a fraction of the element border box.
    #[serde(default = "geometry_anchor")]
    pub perspective_origin: crate::NormalizedAnchor,
}

fn geometry_anchor() -> crate::NormalizedAnchor {
    crate::NormalizedAnchor { x: 0.5, y: 0.5 }
}

/// Explicit treatment of the unconfigured back face. The mirrored default
/// keeps a two-sided turn legible without requiring separate back artwork.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "treatment", rename_all = "kebab-case", deny_unknown_fields)]
pub enum CardBack {
    #[default]
    Mirror,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardIdle {
    #[schemars(range(min = 0, max = 45))]
    pub amplitude_x: f64,
    #[schemars(range(min = 0, max = 45))]
    pub amplitude_y: f64,
    #[schemars(range(min = 100, max = 60000))]
    pub period_ms: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardTilt {
    #[schemars(range(min = 0, max = 90))]
    pub max_rotate_x: f64,
    #[schemars(range(min = 0, max = 90))]
    pub max_rotate_y: f64,
    /// Unit-box subregion that maps pointer position onto the tilt envelope.
    #[serde(default = "full_pointer_region")]
    pub pointer_region: CardRegion,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle: Option<CardIdle>,
    /// Exponential pointer-follow time constant; 0 tracks instantly.
    #[schemars(range(min = 0, max = 2000))]
    #[serde(default = "default_smoothing_ms")]
    pub smoothing_ms: f64,
    /// Return-to-rest timing after the pointer leaves the surface.
    #[schemars(range(min = 0, max = 5000))]
    #[serde(default = "default_settle_ms")]
    pub settle_ms: f64,
}

fn full_pointer_region() -> CardRegion {
    CardRegion {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    }
}
fn default_smoothing_ms() -> f64 {
    120.0
}
fn default_settle_ms() -> f64 {
    400.0
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CardRegion {
    #[schemars(range(min = 0, max = 1))]
    pub x: f64,
    #[schemars(range(min = 0, max = 1))]
    pub y: f64,
    #[schemars(range(min = 0, max = 1))]
    pub width: f64,
    #[schemars(range(min = 0, max = 1))]
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CardAxis {
    X,
    Y,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CardInterruption {
    /// Activation during an in-flight action is ignored: no unbounded queue.
    IgnoreWhileActive,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardAction {
    #[serde(default = "default_axis")]
    pub axis: CardAxis,
    /// +1 or -1; selects which way the deliberate turn runs.
    #[serde(default = "default_direction")]
    pub direction: i8,
    /// Complete revolutions of one triggered action; distinguishable in state.
    #[schemars(range(min = 1, max = 8))]
    #[serde(default = "default_turns")]
    pub turns: u32,
    #[schemars(range(min = 100, max = 10000))]
    #[serde(default = "default_duration_ms")]
    pub duration_ms: f64,
    #[serde(default = "default_action_easing")]
    pub easing: MotionEasing,
    #[serde(default = "default_interruption")]
    pub interruption: CardInterruption,
}

fn default_axis() -> CardAxis {
    CardAxis::Y
}
fn default_direction() -> i8 {
    1
}
fn default_turns() -> u32 {
    1
}
fn default_duration_ms() -> f64 {
    720.0
}
fn default_interruption() -> CardInterruption {
    CardInterruption::IgnoreWhileActive
}
fn default_action_easing() -> MotionEasing {
    MotionEasing::CubicBezier {
        x1: 0.4,
        y1: 0.0,
        x2: 0.2,
        y2: 1.0,
    }
}

/// Accepted interactive-card state; see docs/CARD_CONTRACT.md. The rigid
/// geometry is shared with the pose operation; unlike pose, back-facing and
/// edge-on views are reportable states instead of errors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardRig {
    #[schemars(schema_with = "schema_field")]
    pub schema: String,
    #[schemars(schema_with = "version_field")]
    pub version: String,
    pub element_size: Size,
    pub geometry: CardGeometry,
    /// Authored resting pose; live tilt and deliberate turns add to this view.
    #[serde(default)]
    pub rest: CardView,
    #[serde(default)]
    pub back: CardBack,
    pub tilt: CardTilt,
    pub action: CardAction,
}

/// One explicit static view. Angles are cumulative so a two-revolution turn
/// differs from one revolution even when the projected stills match.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardView {
    #[serde(default)]
    pub rotate_x: f64,
    #[serde(default)]
    pub rotate_y: f64,
    #[serde(default)]
    pub rotate_z: f64,
    #[serde(default)]
    pub depth: f64,
    #[serde(default = "zero_translate")]
    pub translate: Point,
}

fn zero_translate() -> Point {
    Point::new(0.0, 0.0)
}

impl Default for CardView {
    fn default() -> Self {
        Self {
            rotate_x: 0.0,
            rotate_y: 0.0,
            rotate_z: 0.0,
            depth: 0.0,
            translate: zero_translate(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CardFace {
    Front,
    Back,
    Edge,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardPoseInput {
    pub rig: CardRig,
    #[serde(default)]
    pub view: Option<CardView>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardPoseOutput {
    pub quad: Quad,
    pub depths: [f64; 4],
    /// Native rigid transform, including independent pivot and camera origins.
    /// Apply with transform-origin: 0 0; valid for front, edge and back.
    pub rigid_css: String,
    /// Same plane with readable authored back content, rotated about its center.
    pub back_css: String,
    pub face: CardFace,
    /// Cumulative revolutions around the rig's action axis, signed; 2.0 after
    /// a two-revolution turn and 1.0 after one even though both stills match.
    pub revolutions: f64,
    /// Present only when the view passes the ordinary front-facing solver
    /// validation; edge and back views carry the raw rigid quad instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec: Option<TransformSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css: Option<CssTransform>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardPointerInput {
    pub rig: CardRig,
    /// Pointer position in the surface's unit box; values outside the rig's
    /// pointer region clamp to its edge.
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardPointerOutput {
    pub clamp_x: f64,
    pub clamp_y: f64,
    /// Envelope tilt in degrees; rotateX follows -y, rotateY follows +x.
    pub tilt_x: f64,
    pub tilt_y: f64,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardIdleInput {
    pub rig: CardRig,
    #[schemars(range(min = 0, max = 1_000_000_000))]
    pub time_ms: f64,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardTurnInput {
    pub rig: CardRig,
    #[schemars(range(min = 0, max = 1))]
    pub progress: f64,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CardTurnOutput {
    pub eased_progress: f64,
    /// Cumulative eased angle in degrees, signed by direction.
    pub angle: f64,
    pub revolutions: f64,
    pub face: CardFace,
}

impl CardRig {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != CARD_SCHEMA || self.version != CARD_VERSION {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card rig requires schema worldbend.card and version 0.1",
            ));
        }
        self.element_size.validate("elementSize")?;
        let g = &self.geometry;
        let anchors = [
            g.pivot.x,
            g.pivot.y,
            g.perspective_origin.x,
            g.perspective_origin.y,
        ];
        let values = [
            g.perspective,
            self.tilt.max_rotate_x,
            self.tilt.max_rotate_y,
            self.tilt.smoothing_ms,
            self.tilt.settle_ms,
            self.tilt.pointer_region.x,
            self.tilt.pointer_region.y,
            self.tilt.pointer_region.width,
            self.tilt.pointer_region.height,
            anchors[0],
            anchors[1],
            anchors[2],
            anchors[3],
            self.action.duration_ms,
        ];
        if values.iter().any(|v| !v.is_finite()) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "card rig values must be finite",
            ));
        }
        if g.perspective < 1.0 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card geometry requires perspective >= 1",
            ));
        }
        if anchors.iter().any(|v| !(0.0..=1.0).contains(v)) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card geometry origins must stay in [0,1]",
            ));
        }
        let t = &self.tilt;
        if !(0.0..=90.0).contains(&t.max_rotate_x)
            || !(0.0..=90.0).contains(&t.max_rotate_y)
            || !(0.0..=2000.0).contains(&t.smoothing_ms)
            || !(0.0..=5000.0).contains(&t.settle_ms)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card tilt envelope, smoothing and settle values are out of range",
            ));
        }
        let r = &t.pointer_region;
        if !(0.0..=1.0).contains(&r.x)
            || !(0.0..=1.0).contains(&r.y)
            || r.width <= 0.0
            || r.height <= 0.0
            || r.x + r.width > 1.0
            || r.y + r.height > 1.0
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card pointer region must be a non-empty box inside the unit box",
            ));
        }
        if let Some(idle) = t.idle {
            let values = [idle.amplitude_x, idle.amplitude_y, idle.period_ms];
            if values.iter().any(|v| !v.is_finite())
                || !(0.0..=45.0).contains(&idle.amplitude_x)
                || !(0.0..=45.0).contains(&idle.amplitude_y)
                || !(100.0..=60000.0).contains(&idle.period_ms)
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "card idle amplitudes and period are out of range",
                ));
            }
        }
        let a = &self.action;
        if a.direction != 1 && a.direction != -1 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card action direction must be +1 or -1",
            ));
        }
        if !(1..=8).contains(&a.turns) || !(100.0..=10000.0).contains(&a.duration_ms) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "card action turns and duration are out of range",
            ));
        }
        validate_easing(a.easing)?;
        validate_view(&self.rest)?;
        Ok(())
    }
}

fn view_axis_angle(rig: &CardRig, view: &CardView) -> f64 {
    match rig.action.axis {
        CardAxis::X => view.rotate_x,
        CardAxis::Y => view.rotate_y,
    }
}

fn validate_view(view: &CardView) -> TransformResult<()> {
    let angles = [view.rotate_x, view.rotate_y, view.rotate_z, view.depth];
    if angles.iter().any(|v| !v.is_finite())
        || ![view.translate.x, view.translate.y]
            .iter()
            .all(|v| v.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "card view values must be finite",
        ));
    }
    if angles[..3].iter().any(|v| v.abs() > MAX_VIEW_ANGLE) || view.depth.abs() > 1.0e6 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "card view angles must stay within [-3600,3600] degrees and depth within 1e6",
        ));
    }
    Ok(())
}

/// Project one explicit card view through the shared rigid pose geometry.
/// Edge and back views return their raw quad and face instead of failing:
/// they are valid states of the two-sided expression. The optional spec/css
/// fields appear only when the ordinary front-facing solver accepts the quad,
/// so existing TransformSpec validation is never weakened or reinterpreted.
pub fn project_card_pose(input: &CardPoseInput) -> TransformResult<CardPoseOutput> {
    input.rig.validate()?;
    let view = input.view.unwrap_or(input.rig.rest);
    validate_view(&view)?;
    let size = input.rig.element_size;
    let geometry = &input.rig.geometry;
    let (points, depths) = project_rigid_plane(&RigidPlane {
        size,
        perspective: geometry.perspective,
        rotate_x: view.rotate_x,
        rotate_y: view.rotate_y,
        rotate_z: view.rotate_z,
        depth: view.depth,
        translate: view.translate,
        pivot: Point::new(
            geometry.pivot.x * size.width,
            geometry.pivot.y * size.height,
        ),
        camera: Point::new(
            geometry.perspective_origin.x * size.width,
            geometry.perspective_origin.y * size.height,
        ),
    })?;
    let quad = Quad::new(points[0], points[1], points[2], points[3]);
    let element_area = size.width * size.height;
    let area = polygon_signed_area(&points);
    let crosses = [
        cross(points[0], points[1], points[2]),
        cross(points[1], points[2], points[3]),
        cross(points[2], points[3], points[0]),
        cross(points[3], points[0], points[1]),
    ];
    let face = if area.abs() <= EDGE_AREA_EPSILON * element_area
        || crosses.iter().any(|value| *value <= 0.0) == crosses.iter().any(|value| *value >= 0.0)
    {
        CardFace::Edge
    } else if crosses.iter().all(|value| *value > 0.0) {
        CardFace::Front
    } else {
        CardFace::Back
    };
    let (spec, css) = if face == CardFace::Front {
        let spec = TransformSpec::pixel(size, quad);
        match emit_css_transform(&spec, size, None) {
            Ok(css) => (Some(spec), Some(css)),
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };
    let pivot = geometry.pivot;
    let camera = geometry.perspective_origin;
    let px = pivot.x * size.width;
    let py = pivot.y * size.height;
    let cx = camera.x * size.width;
    let cy = camera.y * size.height;
    let rigid_css = format!(
        "translate({cx}px, {cy}px) perspective({}px) translate({}px, {}px) translate3d({}px, {}px, {}px) rotateZ({}deg) rotateY({}deg) rotateX({}deg) translate({}px, {}px)",
        geometry.perspective,
        -cx,
        -cy,
        px + view.translate.x,
        py + view.translate.y,
        view.depth,
        view.rotate_z,
        view.rotate_y,
        view.rotate_x,
        -px,
        -py,
    );
    let back_css = format!(
        "{rigid_css} translate({}px, {}px) rotateY(180deg) translate({}px, {}px)",
        size.width / 2.0,
        size.height / 2.0,
        -size.width / 2.0,
        -size.height / 2.0
    );
    Ok(CardPoseOutput {
        quad,
        rigid_css,
        back_css,
        depths,
        face,
        revolutions: view_axis_angle(&input.rig, &view) / 360.0,
        spec,
        css,
    })
}

/// Map a pointer position onto the tilt envelope. Coordinates outside the
/// rig's pointer region clamp to its edge; the mapping itself is linear.
pub fn sample_card_pointer(input: &CardPointerInput) -> TransformResult<CardPointerOutput> {
    input.rig.validate()?;
    if ![input.x, input.y].iter().all(|v| v.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "card pointer position must be finite",
        ));
    }
    let region = input.rig.tilt.pointer_region;
    let unit = |value: f64, origin: f64, length: f64| {
        ((value - origin) / length).clamp(0.0, 1.0) * 2.0 - 1.0
    };
    let clamp_x = unit(input.x, region.x, region.width);
    let clamp_y = unit(input.y, region.y, region.height);
    Ok(CardPointerOutput {
        clamp_x,
        clamp_y,
        tilt_x: -clamp_y * input.rig.tilt.max_rotate_x,
        tilt_y: clamp_x * input.rig.tilt.max_rotate_y,
    })
}

/// Sample the idle wobble at a deterministic time. The two axes run a sine
/// and cosine of the same period so the motion traces an ellipse inside the
/// envelope rather than a diagonal line.
pub fn sample_card_idle(input: &CardIdleInput) -> TransformResult<CardPointerOutput> {
    input.rig.validate()?;
    let idle = input.rig.tilt.idle.ok_or_else(|| {
        TransformError::new(ErrorCode::Schema, "card rig has no idle motion to sample")
    })?;
    if !input.time_ms.is_finite() || !(0.0..=1e9).contains(&input.time_ms) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "card idle time must be finite and in [0,1e9]",
        ));
    }
    let phase = 2.0 * std::f64::consts::PI * input.time_ms / idle.period_ms;
    Ok(CardPointerOutput {
        clamp_x: phase.cos(),
        clamp_y: phase.sin(),
        tilt_x: -idle.amplitude_x.min(input.rig.tilt.max_rotate_x) * phase.sin(),
        tilt_y: idle.amplitude_y.min(input.rig.tilt.max_rotate_y) * phase.cos(),
    })
}

/// Evaluate the triggered complete turn at linear progress. Easing follows
/// the rig's own curve so every carrier samples the identical timeline; the
/// cumulative angle keeps `turns` revolutions distinguishable in state.
pub fn sample_card_turn(input: &CardTurnInput) -> TransformResult<CardTurnOutput> {
    input.rig.validate()?;
    if !input.progress.is_finite() || !(0.0..=1.0).contains(&input.progress) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "card turn progress must be a finite fraction in [0,1]",
        ));
    }
    let action = input.rig.action;
    let eased = apply_easing(action.easing, input.progress);
    let angle = action.direction as f64 * action.turns as f64 * 360.0 * eased;
    let mut view = input.rig.rest;
    match action.axis {
        CardAxis::X => view.rotate_x += angle,
        CardAxis::Y => view.rotate_y += angle,
    }
    // Keep cumulative action state while projecting its equivalent local pose.
    view.rotate_x = view.rotate_x.rem_euclid(360.0);
    view.rotate_y = view.rotate_y.rem_euclid(360.0);
    let face = project_card_pose(&CardPoseInput {
        rig: input.rig.clone(),
        view: Some(view),
    })?
    .face;
    Ok(CardTurnOutput {
        eased_progress: eased,
        angle,
        revolutions: angle / 360.0,
        face,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use serde_json::json;

    fn test_rig(pose: serde_json::Value) -> CardRig {
        let mut value = json!({
            "schema": CARD_SCHEMA,
            "version": CARD_VERSION,
            "elementSize": {"width": 640, "height": 400},
            "geometry": {"perspective": 1000},
            "tilt": {"maxRotateX": 12, "maxRotateY": 16},
            "action": {},
        });
        let target = value.as_object_mut().unwrap();
        for (key, patch) in pose.as_object().into_iter().flatten() {
            target.insert(key.clone(), patch.clone());
        }
        serde_json::from_value(value).unwrap()
    }

    fn view(rotate_y: f64) -> CardView {
        CardView {
            rotate_y,
            ..CardView::default()
        }
    }

    #[test]
    fn front_views_reuse_pose_geometry_and_keep_solver_validation() {
        let output = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(view(30.0)),
        })
        .unwrap();
        assert_eq!(output.face, CardFace::Front);
        // Center pivot, camera at center: TR projects across the vanishing divide.
        assert_relative_eq!(
            output.quad.tr.x,
            320.0 + 320.0 * (3.0_f64.sqrt() / 2.0) / (1.0 + 320.0 * 0.5 / 1000.0),
            epsilon = 1e-9
        );
        let spec = output.spec.expect("front view exposes the ordinary spec");
        assert!(output.css.is_some());
        assert_eq!(spec.destination.reference.unwrap().width, 640.0);
    }

    #[test]
    fn back_and_edge_views_are_states_not_errors() {
        let back = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(view(180.0)),
        })
        .unwrap();
        assert_eq!(back.face, CardFace::Back);
        assert!(back.spec.is_none() && back.css.is_none());
        assert_relative_eq!(back.quad.tl.x, 640.0, epsilon = 1e-6);
        let edge = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(view(90.0)),
        })
        .unwrap();
        assert_eq!(edge.face, CardFace::Edge);
        assert!(edge.spec.is_none());
        // One versus two revolutions stay distinguishable in retained state.
        let two = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({"action": {"turns": 2}})),
            view: Some(view(720.0)),
        })
        .unwrap();
        assert_eq!(two.face, CardFace::Front);
        assert_relative_eq!(two.revolutions, 2.0, epsilon = 1e-12);
        assert_eq!(back.revolutions, 0.5);
    }

    #[test]
    fn pose_operation_still_rejects_edge_and_back() {
        // The ordinary pose route keeps its policy; only the card family
        // reports these states.
        let pose = crate::project_plane_pose(
            &serde_json::from_value::<crate::PlanePoseInput>(json!({
                "elementSize": {"width": 640, "height": 400},
                "pose": {"perspective": 1000, "rotateY": 180}
            }))
            .unwrap(),
        );
        assert_eq!(pose.unwrap_err().code, ErrorCode::QuadOrientation);
        let pose = crate::project_plane_pose(
            &serde_json::from_value::<crate::PlanePoseInput>(json!({
                "elementSize": {"width": 640, "height": 400},
                "pose": {"perspective": 1000, "rotateY": 720}
            }))
            .unwrap(),
        );
        assert_eq!(pose.unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn pointer_maps_and_clamps_through_the_declared_region() {
        let rig = test_rig(json!({
            "tilt": {"maxRotateX": 10, "maxRotateY": 20,
                     "pointerRegion": {"x": 0.25, "y": 0, "width": 0.5, "height": 1}}
        }));
        let center = sample_card_pointer(&CardPointerInput {
            rig: rig.clone(),
            x: 0.5,
            y: 0.5,
        })
        .unwrap();
        assert_relative_eq!(center.tilt_x, 0.0, epsilon = 1e-12);
        assert_relative_eq!(center.tilt_y, 0.0, epsilon = 1e-12);
        let edge = sample_card_pointer(&CardPointerInput {
            rig: rig.clone(),
            x: 2.0,
            y: -1.0,
        })
        .unwrap();
        assert_relative_eq!(edge.tilt_x, 10.0, epsilon = 1e-12);
        assert_relative_eq!(edge.tilt_y, 20.0, epsilon = 1e-12);
        let quarter = sample_card_pointer(&CardPointerInput {
            rig,
            x: 0.375,
            y: 0.75,
        })
        .unwrap();
        assert_relative_eq!(quarter.tilt_x, -5.0, epsilon = 1e-12);
        assert_relative_eq!(quarter.tilt_y, -10.0, epsilon = 1e-12);
    }

    #[test]
    fn idle_samples_a_deterministic_ellipse_and_requires_idle_state() {
        let rig = test_rig(json!({
            "tilt": {"maxRotateX": 12, "maxRotateY": 16,
                     "idle": {"amplitudeX": 3, "amplitudeY": 4, "periodMs": 2000}}
        }));
        let zero = sample_card_idle(&CardIdleInput {
            rig: rig.clone(),
            time_ms: 0.0,
        })
        .unwrap();
        assert_relative_eq!(zero.tilt_x, 0.0, epsilon = 1e-12);
        assert_relative_eq!(zero.tilt_y, 4.0, epsilon = 1e-12);
        let quarter = sample_card_idle(&CardIdleInput {
            rig,
            time_ms: 500.0,
        })
        .unwrap();
        assert_relative_eq!(quarter.tilt_x, -3.0, epsilon = 1e-12);
        assert_relative_eq!(quarter.tilt_y, 0.0, epsilon = 1e-12);
        let absent = sample_card_idle(&CardIdleInput {
            rig: test_rig(json!({})),
            time_ms: 0.0,
        });
        assert_eq!(absent.unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn turn_face_uses_authored_rest_and_shared_projection() {
        let rig = test_rig(json!({
            "rest": {"rotateX": 12, "rotateY": 180},
            "action": {"turns": 2, "easing": {"kind": "linear"}}
        }));
        for progress in [0.0, 0.125, 0.25, 0.375, 1.0] {
            let sample = sample_card_turn(&CardTurnInput {
                rig: rig.clone(),
                progress,
            })
            .unwrap();
            let mut view = rig.rest;
            view.rotate_y += sample.angle;
            let pose = project_card_pose(&CardPoseInput {
                rig: rig.clone(),
                view: Some(view),
            })
            .unwrap();
            assert_eq!(sample.face, pose.face);
        }
        assert_eq!(
            sample_card_turn(&CardTurnInput { rig, progress: 1.0 })
                .unwrap()
                .face,
            CardFace::Back
        );
    }

    #[test]
    fn turn_easing_follows_the_rig_and_reports_revolution_counts() {
        let rig = test_rig(json!({"action": {"turns": 2, "direction": -1}}));
        let start = sample_card_turn(&CardTurnInput {
            rig: rig.clone(),
            progress: 0.0,
        })
        .unwrap();
        assert_relative_eq!(start.angle, 0.0, epsilon = 1e-12);
        let end = sample_card_turn(&CardTurnInput {
            rig: rig.clone(),
            progress: 1.0,
        })
        .unwrap();
        assert_relative_eq!(end.angle, -720.0, epsilon = 1e-9);
        assert_relative_eq!(end.revolutions, -2.0, epsilon = 1e-12);
        assert_eq!(end.face, CardFace::Front);
        let half = sample_card_turn(&CardTurnInput { rig, progress: 0.5 }).unwrap();
        assert_eq!(half.face, CardFace::Back);
        assert!(half.eased_progress > 0.0 && half.eased_progress < 1.0);
        let edge = sample_card_turn(&CardTurnInput {
            rig: test_rig(json!({"action": {"easing": {"kind": "linear"}}})),
            progress: 0.25,
        })
        .unwrap();
        assert_eq!(edge.face, CardFace::Edge);
        assert_relative_eq!(edge.angle, 90.0, epsilon = 1e-9);
    }

    #[test]
    fn rig_validation_rejects_out_of_range_and_unknown_state() {
        for pose in [
            json!({"geometry2": 1}),
            json!({"tilt": {"maxRotateX": 91, "maxRotateY": 16}}),
            json!({"tilt": {"maxRotateX": 12, "maxRotateY": 16,
                            "pointerRegion": {"x": 0.8, "y": 0, "width": 0.5, "height": 1}}}),
            json!({"tilt": {"maxRotateX": 12, "maxRotateY": 16,
                            "idle": {"amplitudeX": 46, "amplitudeY": 4, "periodMs": 2000}}}),
            json!({"action": {"turns": 9}}),
            json!({"action": {"direction": 2}}),
            json!({"action": {"durationMs": 10}}),
        ] {
            let mut value = json!({
                "schema": CARD_SCHEMA,
                "version": CARD_VERSION,
                "elementSize": {"width": 640, "height": 400},
                "geometry": {"perspective": 1000},
                "tilt": {"maxRotateX": 12, "maxRotateY": 16},
                "action": {},
            });
            let target = value.as_object_mut().unwrap();
            for (key, patch) in pose.as_object().into_iter().flatten() {
                target.insert(key.clone(), patch.clone());
            }
            let invalid = match serde_json::from_value::<CardRig>(value) {
                Ok(rig) => rig.validate().is_err(),
                Err(_) => true,
            };
            assert!(invalid, "expected rejection for a card rig patch");
        }
        assert!(
            serde_json::from_value::<CardRig>(json!({
                "schema": "worldbend.card@0.1", "version": "0.1",
                "elementSize": {"width": 640, "height": 400},
                "geometry": {"perspective": 1000},
                "tilt": {"maxRotateX": 12, "maxRotateY": 16},
                "action": {}, "unexpected": true
            }))
            .is_err()
        );
    }

    #[test]
    fn horizon_and_finite_rules_keep_pose_semantics() {
        let err = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(CardView {
                depth: 1000.0,
                ..CardView::default()
            }),
        })
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::HomographyHorizonCrossing);
        let err = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(CardView {
                rotate_x: f64::NAN,
                ..CardView::default()
            }),
        })
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::NonFiniteCoordinate);
        let err = project_card_pose(&CardPoseInput {
            rig: test_rig(json!({})),
            view: Some(view(4000.0)),
        })
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Schema);
    }
    #[test]
    fn authored_rest_and_idle_envelope_survive_sampling() {
        let rig = test_rig(
            json!({"rest": {"rotateX": 17, "rotateY": 24}, "tilt": {"maxRotateX": 1, "maxRotateY": 2, "idle": {"amplitudeX": 3, "amplitudeY": 4, "periodMs": 2000}}}),
        );
        let rest = project_card_pose(&CardPoseInput {
            rig: rig.clone(),
            view: None,
        })
        .unwrap();
        let explicit = project_card_pose(&CardPoseInput {
            rig: rig.clone(),
            view: Some(rig.rest),
        })
        .unwrap();
        assert_eq!(rest.quad, explicit.quad);
        let idle = sample_card_idle(&CardIdleInput {
            rig: rig.clone(),
            time_ms: 0.0,
        })
        .unwrap();
        assert_eq!(idle.tilt_y, 2.0);
        assert!(
            sample_card_idle(&CardIdleInput {
                rig,
                time_ms: f64::NAN
            })
            .is_err()
        );
    }
}
