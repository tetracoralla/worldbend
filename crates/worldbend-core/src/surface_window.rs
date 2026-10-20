use crate::{
    Bounds, CssTransform, ErrorCode, PlanePose, PlanePoseInput, Point, Quad, Size, TransformError,
    TransformResult, TransformSpec, emit_css_transform, pose::project_pose_vertices,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

/// A fixed content plane at z=0, viewed through one explicitly posed window.
/// All coordinates are logical CSS pixels, not source texture pixel counts.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceWindowSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    #[schemars(schema_with = "window_size_schema")]
    pub content_size: Size,
    /// Top-left of the stationary content, relative to the unposed window.
    pub content_origin: Point,
    #[schemars(schema_with = "window_size_schema")]
    pub window_size: Size,
    pub pose: PlanePose,
    pub frost: WindowFrost,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WindowFrost {
    /// Blur sampling radius on the content plane at zero separation.
    #[schemars(range(min = 0, max = 64))]
    pub base_radius: f64,
    /// Additional radius per logical pixel of absolute separation from z=0.
    #[schemars(range(min = 0, max = 1))]
    pub spread: f64,
    #[schemars(range(min = 0, max = 64))]
    pub max_radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SurfaceVisibility {
    Visible,
    EdgeOn,
    BackFacing,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceWindowMapping {
    pub css: CssTransform,
    /// Row-major. Maps local window (x,y,1) to homogeneous content UV.
    pub sample_homography: [f64; 9],
    /// z(x,y) = coefficients[0]*x + coefficients[1]*y + coefficients[2].
    pub depth_plane: [f64; 3],
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceWindowPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub spec: SurfaceWindowSpec,
    pub visibility: SurfaceVisibility,
    /// Hidden faces have no drawable mapping; they never reuse a previous face.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mapping: Option<SurfaceWindowMapping>,
}

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.surface-window"})
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.surface-window-plan"})
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"0.1"})
}
fn window_size_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"object","additionalProperties":false,"required":["width","height"],
        "properties":{"width":{"type":"number","minimum":1,"maximum":8192},
                      "height":{"type":"number","minimum":1,"maximum":8192}}})
}

pub fn plan_surface_window(spec: &SurfaceWindowSpec) -> TransformResult<SurfaceWindowPlan> {
    if spec.schema != "worldbend.surface-window" || spec.version != "0.1" {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported surface-window schema or version",
        ));
    }
    for (label, size) in [
        ("contentSize", spec.content_size),
        ("windowSize", spec.window_size),
    ] {
        size.validate(label)?;
        if size.width < 1.0 || size.height < 1.0 || size.width > 8192.0 || size.height > 8192.0 {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "surface-window dimensions must be in [1,8192] logical pixels",
            ));
        }
    }
    let f = spec.frost;
    let bounded = [
        spec.content_origin.x,
        spec.content_origin.y,
        spec.pose.translate.x,
        spec.pose.translate.y,
        spec.pose.depth,
        spec.pose.perspective,
    ];
    if bounded
        .iter()
        .chain([f.base_radius, f.spread, f.max_radius].iter())
        .any(|v| !v.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "surface-window values must be finite",
        ));
    }
    if bounded.iter().any(|v| v.abs() > 1_000_000.0)
        || !(0.0..=64.0).contains(&f.base_radius)
        || !(0.0..=64.0).contains(&f.max_radius)
        || !(0.0..=1.0).contains(&f.spread)
        || f.base_radius > f.max_radius
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "surface-window coordinates exceed 1000000, or frost requires 0 <= baseRadius <= maxRadius <= 64 and spread in [0,1]",
        ));
    }
    let (points, depths) = project_pose_vertices(&PlanePoseInput {
        element_size: spec.window_size,
        pose: spec.pose,
    })?;
    let quad = Quad::new(points[0], points[1], points[2], points[3]);
    let bounds = Bounds::from_quad(quad);
    if points.iter().any(|p| {
        !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 1_000_000.0 || p.y.abs() > 1_000_000.0
    }) {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "projected surface-window exceeds the coordinate limit",
        ));
    }
    // Remove translation before the signed area sum. A projected rigid plane
    // cannot self-intersect while every vertex is on this side of the horizon.
    let scale = bounds.width.max(bounds.height).max(1.0);
    let normalized =
        points.map(|p| Point::new((p.x - points[0].x) / scale, (p.y - points[0].y) / scale));
    let area = crate::polygon_signed_area(&normalized);
    let visibility = if area.abs() <= 1e-8 {
        SurfaceVisibility::EdgeOn
    } else if area < 0.0 {
        SurfaceVisibility::BackFacing
    } else {
        SurfaceVisibility::Visible
    };
    let mapping = if visibility == SurfaceVisibility::Visible {
        let css = emit_css_transform(
            &TransformSpec::pixel(spec.window_size, quad),
            spec.window_size,
            None,
        )?;
        let m = css.matrix3d;
        let (ox, oy) = (spec.content_origin.x, spec.content_origin.y);
        let (w, h) = (spec.content_size.width, spec.content_size.height);
        // Projection onto z=0 is also the ray/window intersection's sample
        // position on the fixed content. No adapter-owned camera solver.
        let sample_homography = [
            (m[0] - ox * m[3]) / w,
            (m[4] - ox * m[7]) / w,
            (m[12] - ox * m[15]) / w,
            (m[1] - oy * m[3]) / h,
            (m[5] - oy * m[7]) / h,
            (m[13] - oy * m[15]) / h,
            m[3],
            m[7],
            m[15],
        ];
        Some(SurfaceWindowMapping {
            css,
            sample_homography,
            depth_plane: [
                (depths[1] - depths[0]) / spec.window_size.width,
                (depths[3] - depths[0]) / spec.window_size.height,
                depths[0],
            ],
        })
    } else {
        None
    };
    Ok(SurfaceWindowPlan {
        schema: "worldbend.surface-window-plan".into(),
        version: "0.1".into(),
        spec: spec.clone(),
        visibility,
        mapping,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;
    use serde_json::json;

    fn spec(pose: serde_json::Value) -> SurfaceWindowSpec {
        serde_json::from_value(json!({"schema":"worldbend.surface-window","version":"0.1",
            "windowSize":{"width":300,"height":400},"contentSize":{"width":600,"height":400},
            "contentOrigin":{"x":-300,"y":0},"pose":pose,
            "frost":{"baseRadius":0,"spread":0.12,"maxRadius":32}}))
        .unwrap()
    }

    #[test]
    fn stationary_content_sample_equals_projected_position_for_general_poses() {
        for pose in [
            json!({"perspective":1200}),
            json!({"perspective":1200,"rotateX":21,"rotateY":-54,"rotateZ":8,"depth":40,"translate":{"x":-17,"y":23}}),
        ] {
            let plan = plan_surface_window(&spec(pose)).unwrap();
            let m = plan.mapping.unwrap();
            for (x, y) in [(0.0, 0.0), (300.0, 400.0), (149.5, 230.5)] {
                let c = m.css.matrix3d;
                let cw = c[3] * x + c[7] * y + c[15];
                let px = (c[0] * x + c[4] * y + c[12]) / cw;
                let py = (c[1] * x + c[5] * y + c[13]) / cw;
                let h = m.sample_homography;
                let sw = h[6] * x + h[7] * y + h[8];
                let u = (h[0] * x + h[1] * y + h[2]) / sw;
                let v = (h[3] * x + h[4] * y + h[5]) / sw;
                assert_relative_eq!(u * 600.0 - 300.0, px, epsilon = 1e-9);
                assert_relative_eq!(v * 400.0, py, epsilon = 1e-9);
            }
        }
    }

    #[test]
    fn independent_ray_plane_reference_and_separation_match_hinged_window() {
        let plan=plan_surface_window(&spec(json!({"perspective":1000,"rotateY":-60,"pivot":{"x":0,"y":0.5},"perspectiveOrigin":{"x":0,"y":0.5}}))).unwrap();
        let m = plan.mapping.unwrap();
        for (x, y) in [(0.0, 200.0), (150.0, 90.0), (300.0, 400.0)] {
            let z = x * 3.0_f64.sqrt() / 2.0;
            let ray_scale = 1000.0 / (1000.0 - z);
            let source_x = x * 0.5 * ray_scale;
            let source_y = 200.0 + (y - 200.0) * ray_scale;
            let h = m.sample_homography;
            let denominator = h[6] * x + h[7] * y + h[8];
            assert_relative_eq!(
                (h[0] * x + h[1] * y + h[2]) / denominator * 600.0 - 300.0,
                source_x,
                epsilon = 1e-9
            );
            assert_relative_eq!(
                (h[3] * x + h[4] * y + h[5]) / denominator * 400.0,
                source_y,
                epsilon = 1e-9
            );
            assert_relative_eq!(
                m.depth_plane[0] * x + m.depth_plane[1] * y + m.depth_plane[2],
                z,
                epsilon = 1e-10
            );
        }
    }

    #[test]
    fn fold_crosses_edge_and_back_without_invalid_quad_or_reordering() {
        for (angle, expected) in [
            (0.0, SurfaceVisibility::Visible),
            (89.0, SurfaceVisibility::Visible),
            (90.0, SurfaceVisibility::EdgeOn),
            (91.0, SurfaceVisibility::BackFacing),
            (180.0, SurfaceVisibility::BackFacing),
        ] {
            let input = spec(
                json!({"perspective":1000,"rotateY":angle,"pivot":{"x":0,"y":0.5},"perspectiveOrigin":{"x":0,"y":0.5}}),
            );
            let plan = plan_surface_window(&input).unwrap();
            assert_eq!(plan.visibility, expected);
            assert_eq!(
                plan.mapping.is_some(),
                expected == SurfaceVisibility::Visible
            );
        }
    }

    #[test]
    fn old_pose_still_rejects_back_faces() {
        let input = spec(json!({"perspective":1000,"rotateY":180}));
        assert_eq!(
            crate::project_plane_pose(&PlanePoseInput {
                element_size: input.window_size,
                pose: input.pose
            })
            .unwrap_err()
            .code,
            ErrorCode::QuadOrientation
        );
    }

    #[test]
    fn fold_faces_share_physical_edges_and_one_global_content_plane() {
        for angle in [0.0, 30.0, 89.9999, 90.0, 90.0001, 135.0, 180.0] {
            let mut outer = spec(json!({"perspective":1500,"rotateY":angle,
                "pivot":{"x":1,"y":0.5},"perspectiveOrigin":{"x":1,"y":0.5}}));
            outer.content_origin.x = 0.0;
            let inner = spec(json!({"perspective":1500,"rotateY":angle-180.0,
                "pivot":{"x":0,"y":0.5},"perspectiveOrigin":{"x":0,"y":0.5}}));
            let vertices = |s: &SurfaceWindowSpec| {
                project_pose_vertices(&PlanePoseInput {
                    element_size: s.window_size,
                    pose: s.pose,
                })
                .unwrap()
                .0
            };
            let a = vertices(&outer);
            let b = vertices(&inner);
            for (i, j) in [(0, 1), (1, 0), (2, 3), (3, 2)] {
                assert_relative_eq!(a[i].x, b[j].x + 300.0, epsilon = 1e-9);
                assert_relative_eq!(a[i].y, b[j].y, epsilon = 1e-9);
            }
            let plans = [
                plan_surface_window(&outer).unwrap(),
                plan_surface_window(&inner).unwrap(),
            ];
            assert_eq!(
                plans.iter().filter(|p| p.mapping.is_some()).count(),
                usize::from(angle != 90.0)
            );
        }
    }

    #[test]
    fn invalid_inputs_and_horizon_fail_closed() {
        let mut input = spec(json!({"perspective":1000,"depth":1000}));
        assert_eq!(
            plan_surface_window(&input).unwrap_err().code,
            ErrorCode::HomographyHorizonCrossing
        );
        input.pose.depth = 0.0;
        input.frost.base_radius = 33.0;
        assert_eq!(
            plan_surface_window(&input).unwrap_err().code,
            ErrorCode::Schema
        );
        input.frost.base_radius = f64::NAN;
        assert_eq!(
            plan_surface_window(&input).unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
        input.frost.base_radius = 0.0;
        input.window_size.width = 8193.0;
        assert_eq!(
            plan_surface_window(&input).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        input.window_size.width = 300.0;
        input.version = "1.0".into();
        assert_eq!(
            plan_surface_window(&input).unwrap_err().code,
            ErrorCode::Schema
        );
        let mut value = serde_json::to_value(input).unwrap();
        value["estimateCamera"] = json!(true);
        assert!(serde_json::from_value::<SurfaceWindowSpec>(value).is_err());
    }
}
