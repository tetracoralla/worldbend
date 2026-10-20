//! Keep authored free coordinates distinct from the unit-bounded execution mesh.
use crate::{
    Bounds, CoordinateSpace, Destination, ErrorCode, MeshBoundary, MeshWarpPlan, MeshWarpSpec,
    Point, Quad, Size, SolveOutput, TransformError, TransformResult, TransformSpec, WarpMesh,
    plan_mesh_warp, solve_spec, transform_point,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuthoredMeshView {
    pub mesh: WarpMesh,
    /// Original authoring plane, translated into the complete output canvas.
    pub solve: SolveOutput,
    /// Output canvas origin in the original reference pixels.
    pub canvas_origin: Point,
}

fn normalized(mesh: &WarpMesh, context: &str) -> TransformResult<(WarpMesh, Bounds)> {
    if mesh.boundary != MeshBoundary::Free {
        mesh.validate_with_context(context)?;
        return Ok((
            mesh.clone(),
            Bounds {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
        ));
    }
    let mut minimum = Point::new(0.0, 0.0);
    let mut maximum = Point::new(1.0, 1.0);
    for vertex in &mesh.vertices {
        let p = vertex.warped;
        if !p.x.is_finite()
            || !p.y.is_finite()
            || !(-2.0..=3.0).contains(&p.x)
            || !(-2.0..=3.0).contains(&p.y)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "authored free mesh vertices must be finite and remain within [-2,3]",
            ));
        }
        minimum.x = minimum.x.min(p.x);
        minimum.y = minimum.y.min(p.y);
        maximum.x = maximum.x.max(p.x);
        maximum.y = maximum.y.max(p.y);
    }
    let bounds = Bounds {
        x: minimum.x,
        y: minimum.y,
        width: maximum.x - minimum.x,
        height: maximum.y - minimum.y,
    };
    let mut execution = mesh.clone();
    for vertex in &mut execution.vertices {
        vertex.warped = Point::new(
            (vertex.warped.x - bounds.x) / bounds.width,
            (vertex.warped.y - bounds.y) / bounds.height,
        );
    }
    execution.validate_with_context(context)?;
    Ok((execution, bounds))
}

pub(crate) fn validate_authored_mesh(mesh: &WarpMesh, context: &str) -> TransformResult<()> {
    normalized(mesh, context).map(|_| ())
}

pub(crate) fn plan_authored_mesh(
    transform: &TransformSpec,
    target_size: Option<Size>,
    mesh: WarpMesh,
) -> TransformResult<(MeshWarpPlan, Option<AuthoredMeshView>)> {
    let (execution, bounds) = normalized(&mesh, "authored deformation")?;
    let mut spec = MeshWarpSpec {
        schema: crate::MESH_WARP_SCHEMA.to_owned(),
        version: crate::MESH_WARP_VERSION.to_owned(),
        transform: transform.clone(),
        target_size,
        mesh: execution,
    };
    if bounds.x == 0.0 && bounds.y == 0.0 && bounds.width == 1.0 && bounds.height == 1.0 {
        return Ok((plan_mesh_warp(&spec)?, None));
    }
    let original = solve_spec(transform, target_size)?;
    let domain = transform.content.orientation.source_corners().map(|p| {
        Point::new(
            bounds.x + p.x * bounds.width,
            bounds.y + p.y * bounds.height,
        )
    });
    let mut projected = Vec::with_capacity(4);
    let mut sign = None;
    for p in domain {
        let m = original.homography.matrix;
        let w = m[6] * p.x + m[7] * p.y + m[8];
        let next = w.is_sign_positive();
        if sign.is_some_and(|s| s != next) {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "expanded deformation crosses the projective horizon",
            ));
        }
        sign = Some(next);
        projected.push(transform_point(&original.homography, p)?);
    }
    let quad = Quad::new(projected[0], projected[1], projected[2], projected[3]);
    let placed = Bounds::from_quad(quad);
    let reference = original.resolved_destination.reference;
    let origin = Point::new(placed.x.min(0.0).floor(), placed.y.min(0.0).floor());
    let size = Size::new(
        (placed.x + placed.width).max(reference.width).ceil() - origin.x,
        (placed.y + placed.height).max(reference.height).ceil() - origin.y,
    );
    let shift = |p: Point| Point::new(p.x - origin.x, p.y - origin.y);
    spec.transform.destination = Destination {
        space: CoordinateSpace::Normalized,
        reference: None,
        quad: quad.map(|p| {
            let p = shift(p);
            Point::new(p.x / size.width, p.y / size.height)
        }),
    };
    spec.target_size = Some(size);
    let mut authoring = transform.clone();
    authoring.destination = Destination {
        space: CoordinateSpace::Pixel,
        reference: Some(size),
        quad: original.resolved_destination.quad.map(shift),
    };
    let solve = solve_spec(&authoring, Some(size))?;
    Ok((
        plan_mesh_warp(&spec)?,
        Some(AuthoredMeshView {
            mesh,
            solve,
            canvas_origin: origin,
        }),
    ))
}

#[cfg(all(test, feature = "deformation-work"))]
mod tests {
    use super::*;
    use crate::{DeformationWorkSpec, plan_deformation_work};
    use serde_json::json;

    fn work() -> DeformationWorkSpec {
        let points: Vec<_> = (0..4)
            .flat_map(|row| {
                (0..4).map(move |column| {
                    let y = match (row, column) {
                        (0, 1 | 2) => -0.2,
                        (3, 1 | 2) => 1.2,
                        _ => row as f64 / 3.0,
                    };
                    json!({"x":column as f64 / 3.0,"y":y})
                })
            })
            .collect();
        serde_json::from_value(json!({"schema":"worldbend.deformation-work","version":"0.1",
            "transform":TransformSpec::normalized(Quad::unit()),"targetSize":{"width":320,"height":180},
            "boundary":"free","meshSubdivisions":12,"surface":{"envelope":{"columns":1,"rows":1,"points":points}}})).unwrap()
    }

    #[test]
    fn outward_cubic_retains_authored_geometry_and_complete_canvas_on_replay() {
        let work = work();
        let plan = plan_deformation_work(&work).unwrap();
        let view = plan.authored_view.as_ref().unwrap();
        let reference = plan.mesh_warp.solve.resolved_destination.reference;
        assert!(reference.height > 230.0);
        assert_eq!(plan.spec, work);
        assert!(view.mesh.vertices[6].warped.y < -0.14);
        assert!(view.mesh.vertices[162].warped.y > 1.14);
        for (raw, execution) in view
            .mesh
            .vertices
            .iter()
            .zip(&plan.mesh_warp.spec.mesh.vertices)
        {
            let authored = transform_point(&view.solve.homography, raw.warped).unwrap();
            let rendered =
                transform_point(&plan.mesh_warp.solve.homography, execution.warped).unwrap();
            assert!(
                (authored.x - rendered.x).abs() < 1e-9 && (authored.y - rendered.y).abs() < 1e-9
            );
            assert!(
                rendered.x >= -1e-9
                    && rendered.y >= -1e-9
                    && rendered.x <= reference.width + 1e-9
                    && rendered.y <= reference.height + 1e-9
            );
        }
        let reopened: DeformationWorkSpec =
            serde_json::from_str(&serde_json::to_string(&work).unwrap()).unwrap();
        assert_eq!(plan_deformation_work(&reopened).unwrap(), plan);
    }

    #[test]
    fn projective_and_oriented_planes_preserve_each_raw_vertex_in_output_pixels() {
        for orientation in [
            crate::SourceOrientation::Native,
            crate::SourceOrientation::FlipHorizontal,
            crate::SourceOrientation::FlipVertical,
            crate::SourceOrientation::FlipBoth,
        ] {
            let mut work = work();
            work.transform.content.orientation = orientation;
            work.transform.destination.quad = Quad::new(
                Point::new(0.1, 0.1),
                Point::new(0.9, 0.2),
                Point::new(0.85, 0.9),
                Point::new(0.05, 0.85),
            );
            let original = solve_spec(&work.transform, work.target_size).unwrap();
            let plan = plan_deformation_work(&work).unwrap();
            let view = plan.authored_view.as_ref().unwrap();
            for (raw, execution) in view
                .mesh
                .vertices
                .iter()
                .zip(&plan.mesh_warp.spec.mesh.vertices)
            {
                let expected = transform_point(&original.homography, raw.warped).unwrap();
                let actual =
                    transform_point(&plan.mesh_warp.solve.homography, execution.warped).unwrap();
                assert!((actual.x + view.canvas_origin.x - expected.x).abs() < 1e-9);
                assert!((actual.y + view.canvas_origin.y - expected.y).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn expansion_does_not_admit_folds_nonfinite_or_unbounded_authored_coordinates() {
        for point in [
            Point::new(0.5, 2.0),
            Point::new(f64::NAN, 0.0),
            Point::new(0.5, -2.01),
        ] {
            let mut work = work();
            work.mesh_edits = vec![crate::MeshVertexEdit {
                column: 6,
                row: 0,
                warped: point,
            }];
            assert!(plan_deformation_work(&work).is_err());
        }
    }

    #[test]
    fn refuses_a_valid_base_plane_whose_expanded_domain_crosses_the_horizon() {
        let mut work = work();
        work.transform.destination.quad = Quad::new(
            Point::new(0., 0.),
            Point::new(1., 0.),
            Point::new(0.55, 1.),
            Point::new(0.45, 1.),
        );
        solve_spec(&work.transform, work.target_size).unwrap();
        assert_eq!(
            plan_deformation_work(&work).unwrap_err().code,
            ErrorCode::HomographyHorizonCrossing
        );
    }
}
