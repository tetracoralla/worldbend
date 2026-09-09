use crate::{
    CssTransform, ErrorCode, Point, Quad, Size, TransformError, TransformResult, TransformSpec,
    emit_css_transform,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

fn center() -> crate::NormalizedAnchor {
    crate::NormalizedAnchor { x: 0.5, y: 0.5 }
}
fn zero() -> Point {
    Point::new(0.0, 0.0)
}

/// Explicit local single-plane pose; see PLANE_POSE_CONTRACT.md for order and units.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanePose {
    /// Perspective distance in CSS pixels. No camera estimation.
    #[schemars(range(min = 1))]
    pub perspective: f64,
    #[serde(default)]
    #[schemars(range(min = -360, max = 360))]
    pub rotate_x: f64,
    #[serde(default)]
    #[schemars(range(min = -360, max = 360))]
    pub rotate_y: f64,
    #[serde(default)]
    #[schemars(range(min = -360, max = 360))]
    pub rotate_z: f64,
    /// Translation toward the viewer, in CSS pixels.
    #[serde(default)]
    pub depth: f64,
    #[serde(default = "zero")]
    pub translate: Point,
    /// Rotation origin as a fraction of the element border box; center by default.
    #[serde(default = "center")]
    pub pivot: crate::NormalizedAnchor,
    /// Projection origin as a fraction of the element border box.
    #[serde(default = "center")]
    pub perspective_origin: crate::NormalizedAnchor,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanePoseInput {
    pub element_size: Size,
    pub pose: PlanePose,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlanePoseOutput {
    pub spec: TransformSpec,
    pub css: CssTransform,
}

pub fn project_plane_pose(input: &PlanePoseInput) -> TransformResult<PlanePoseOutput> {
    let size = input.element_size.validate("elementSize")?;
    let p = input.pose;
    let values = [
        p.perspective,
        p.rotate_x,
        p.rotate_y,
        p.rotate_z,
        p.depth,
        p.translate.x,
        p.translate.y,
        p.pivot.x,
        p.pivot.y,
        p.perspective_origin.x,
        p.perspective_origin.y,
    ];
    if values.iter().any(|v| !v.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "plane pose values must be finite",
        ));
    }
    if p.perspective < 1.0
        || [p.rotate_x, p.rotate_y, p.rotate_z]
            .iter()
            .any(|v| v.abs() > 360.0)
        || [
            p.pivot.x,
            p.pivot.y,
            p.perspective_origin.x,
            p.perspective_origin.y,
        ]
        .iter()
        .any(|v| !(0.0..=1.0).contains(v))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "pose requires perspective >= 1, angles in [-360,360], and origins in [0,1]",
        ));
    }
    let pivot = Point::new(p.pivot.x * size.width, p.pivot.y * size.height);
    let camera = Point::new(
        p.perspective_origin.x * size.width,
        p.perspective_origin.y * size.height,
    );
    let (sx, cx) = p.rotate_x.to_radians().sin_cos();
    let (sy, cy) = p.rotate_y.to_radians().sin_cos();
    let (sz, cz) = p.rotate_z.to_radians().sin_cos();
    let mut points = Quad::unit().points();
    for point in &mut points {
        let x = point.x * size.width - pivot.x;
        let y = point.y * size.height - pivot.y;
        let (y, z) = (y * cx, y * sx);
        let (x, z) = (x * cy + z * sy, -x * sy + z * cy);
        let (x, y) = (
            x * cz - y * sz + pivot.x + p.translate.x,
            x * sz + y * cz + pivot.y + p.translate.y,
        );
        let w = 1.0 - (z + p.depth) / p.perspective;
        if ![x, y, w].iter().all(|v| v.is_finite()) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "plane pose projection overflowed",
            ));
        }
        if w <= 1.0e-9 {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "plane pose touches or crosses the projection horizon",
            ));
        }
        *point = Point::new(camera.x + (x - camera.x) / w, camera.y + (y - camera.y) / w);
    }
    let spec = TransformSpec::pixel(size, Quad::new(points[0], points[1], points[2], points[3]));
    let css = emit_css_transform(&spec, size, None)?;
    Ok(PlanePoseOutput { spec, css })
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use serde_json::json;

    fn input(pose: serde_json::Value) -> PlanePoseInput {
        serde_json::from_value(json!({"elementSize":{"width":640,"height":360},"pose":pose}))
            .unwrap()
    }

    #[test]
    fn identity_and_depth_preserve_center_and_corner_identity() {
        let identity = project_plane_pose(&input(json!({"perspective":1000}))).unwrap();
        assert_relative_eq!(identity.css.matrix3d[0], 1.0, epsilon = 1e-12);
        let result = project_plane_pose(&input(json!({"perspective":1000,"depth":500}))).unwrap();
        assert_eq!(result.spec.destination.quad.tl, Point::new(-320.0, -180.0));
        assert_eq!(result.spec.destination.quad.br, Point::new(960.0, 540.0));
    }

    #[test]
    fn rotation_uses_css_signs_and_independent_origins() {
        let result=project_plane_pose(&input(json!({"perspective":1000,"rotateY":30,"pivot":{"x":0,"y":0},"perspectiveOrigin":{"x":0,"y":0}}))).unwrap();
        assert_eq!(result.spec.destination.quad.tl, Point::new(0.0, 0.0));
        assert_relative_eq!(
            result.spec.destination.quad.tr.x,
            640.0 * 3.0_f64.sqrt() / 2.0 / 1.32,
            epsilon = 1e-10
        );
        assert_relative_eq!(
            result.spec.destination.quad.br.y,
            360.0 / 1.32,
            epsilon = 1e-10
        );
    }

    #[test]
    fn invalid_and_back_facing_poses_fail_without_reordering() {
        for pose in [
            json!({"perspective":0}),
            json!({"perspective":1000,"rotateY":361}),
            json!({"perspective":1000,"pivot":{"x":2,"y":0}}),
        ] {
            assert_eq!(
                project_plane_pose(&input(pose)).unwrap_err().code,
                ErrorCode::Schema
            );
        }
        assert_eq!(
            project_plane_pose(&input(json!({"perspective":1000,"depth":1000})))
                .unwrap_err()
                .code,
            ErrorCode::HomographyHorizonCrossing
        );
        assert!(project_plane_pose(&input(json!({"perspective":1000,"rotateY":90}))).is_err());
        assert_eq!(
            project_plane_pose(&input(json!({"perspective":1000,"rotateY":180})))
                .unwrap_err()
                .code,
            ErrorCode::QuadOrientation
        );
        let mut bad = input(json!({"perspective":1000}));
        bad.pose.rotate_x = f64::NAN;
        assert_eq!(
            project_plane_pose(&bad).unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
    }

    #[test]
    fn unknown_fields_are_rejected() {
        assert!(serde_json::from_value::<PlanePoseInput>(json!({"elementSize":{"width":640,"height":360},"pose":{"perspective":1000,"cameraEstimate":true}})).is_err());
    }
}
