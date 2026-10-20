#![cfg(feature = "deformation-work")]
use worldbend_core::*;

fn work() -> DeformationWorkSpec {
    let mut points: Vec<Point> = (0..4)
        .flat_map(|y| (0..4).map(move |x| Point::new(f64::from(x) / 3.0, f64::from(y) / 3.0)))
        .collect();
    points[1].y = 0.2;
    points[2].y = 0.2;
    serde_json::from_value(serde_json::json!({
        "schema":"worldbend.deformation-work","version":"0.1",
        "transform":TransformSpec::normalized(Quad::unit()),"targetSize":{"width":320,"height":180},
        "boundary":"free","meshSubdivisions":12,
        "surface":{"envelope":{"columns":1,"rows":1,"points":points},"anchors":[],"strokes":[]}
    }))
    .unwrap()
}

#[test]
fn tangential_edge_controls_stay_in_bounds_at_every_supported_density() {
    for subdivisions in 4..=16 {
        let mut value = work();
        value.mesh_subdivisions = subdivisions;
        let points = &mut value.surface.as_mut().unwrap().envelope.points;
        for (i, point) in points.iter_mut().enumerate() {
            *point = Point::new((i % 4) as f64 / 3.0, (i / 4) as f64 / 3.0);
        }
        points[7].y += 0.01;
        points[11].y += 0.01;
        points[13].x += 0.01;
        points[14].x += 0.01;
        let plan = plan_deformation_work(&value)
            .unwrap_or_else(|error| panic!("density {subdivisions}: {error:?}"));
        for row in 0..=usize::from(subdivisions) {
            assert_eq!(
                plan.mesh_warp.spec.mesh.vertices
                    [row * (usize::from(subdivisions) + 1) + usize::from(subdivisions)]
                .warped
                .x,
                1.0
            );
            assert_eq!(
                plan.mesh_warp.spec.mesh.vertices
                    [usize::from(subdivisions) * (usize::from(subdivisions) + 1) + row]
                    .warped
                    .y,
                1.0
            );
        }
        // Outward authoring reframes execution while retaining bounded vertices.
        value.surface.as_mut().unwrap().envelope.points[7].x += 0.001;
        let expanded = plan_deformation_work(&value).unwrap();
        assert!(expanded.authored_view.is_some());
        expanded.mesh_warp.spec.mesh.validate().unwrap();
        assert_eq!(expanded.spec, value);
    }
}

#[test]
fn cubic_outline_replays_and_roundtrips_without_losing_its_source_or_controls() {
    let original = work();
    let expected = plan_deformation_work(&original).unwrap();
    assert_eq!(expected.mesh_warp.spec.mesh.boundary, MeshBoundary::Free);
    let top_midpoint = expected.mesh_warp.spec.mesh.vertices[6];
    assert_eq!(top_midpoint.source, Point::new(0.5, 0.0));
    assert!((top_midpoint.warped.y - 0.15).abs() < 1e-12);
    let reopened: DeformationWorkSpec =
        serde_json::from_slice(&serde_json::to_vec(&original).unwrap()).unwrap();
    assert_eq!(plan_deformation_work(&reopened).unwrap(), expected);
    let mut moved = reopened.clone();
    moved.transform = TransformSpec::normalized(Quad::new(
        Point::new(0.1, 0.0),
        Point::new(0.9, 0.1),
        Point::new(1.0, 1.0),
        Point::new(0.0, 0.9),
    ));
    assert_eq!(
        plan_deformation_work(&moved).unwrap().mesh_warp.spec.mesh,
        expected.mesh_warp.spec.mesh
    );
    moved.target_size = Some(Size::new(640.0, 360.0));
    assert_eq!(
        plan_deformation_work(&moved).unwrap().mesh_warp.spec.mesh,
        expected.mesh_warp.spec.mesh
    );
}

#[test]
fn free_surface_and_grid_migrations_are_lossless_and_keep_explicit_boundary_edits() {
    let original = work();
    let controls = original.surface.clone().unwrap();
    let surface = SurfaceDeformationSpec {
        schema: SURFACE_DEFORMATION_SCHEMA.into(),
        version: SURFACE_DEFORMATION_VERSION.into(),
        transform: original.transform.clone(),
        target_size: original.target_size,
        mesh_subdivisions: original.mesh_subdivisions,
        boundary: MeshBoundary::Free,
        envelope: controls.envelope,
        anchors: controls.anchors,
        strokes: controls.strokes,
    };
    let migrated = migrate_deformation_work(&DeformationWorkSourceSpec::SurfaceDeformation(
        Box::new(surface.clone()),
    ))
    .unwrap();
    assert_eq!(
        migrated.plan.mesh_warp,
        plan_surface_deformation(&surface).unwrap().mesh_warp
    );
    assert_eq!(migrated.work.boundary, MeshBoundary::Free);
    let mut changed = original;
    changed.mesh_edits.push(MeshVertexEdit {
        column: 6,
        row: 0,
        warped: Point::new(0.5, 0.18),
    });
    let plan = plan_deformation_work(&changed).unwrap();
    assert_eq!(
        plan.mesh_warp.spec.mesh.vertices[6].warped,
        Point::new(0.5, 0.18)
    );
    let migrated = migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(Box::new(
        plan.mesh_warp.spec.clone(),
    )))
    .unwrap();
    assert_eq!(migrated.plan.mesh_warp.spec.mesh, plan.mesh_warp.spec.mesh);
    assert!(migrated.work.mesh_edits.iter().any(|edit| edit.row == 0));
}

#[test]
fn invalid_boundary_rejected_then_valid_work_still_runs_and_fixed_defaults_stay_compatible() {
    let original = work();
    let mut invalid = original.clone();
    invalid.boundary = MeshBoundary::Fixed;
    assert_eq!(
        plan_deformation_work(&invalid).unwrap_err().code,
        ErrorCode::Schema
    );
    invalid = original.clone();
    invalid.mesh_edits = vec![MeshVertexEdit {
        column: 6,
        row: 0,
        warped: Point::new(-0.1, 0.0),
    }];
    assert_eq!(
        plan_deformation_work(&invalid).unwrap_err().code,
        ErrorCode::Schema
    );
    invalid.mesh_edits = vec![MeshVertexEdit {
        column: 0,
        row: 0,
        warped: Point::new(1.0, 1.0),
    }];
    assert_eq!(
        plan_deformation_work(&invalid).unwrap_err().code,
        ErrorCode::Schema
    );
    invalid = original.clone();
    invalid
        .surface
        .as_mut()
        .unwrap()
        .envelope
        .points
        .iter_mut()
        .enumerate()
        .for_each(|(i, p)| *p = Point::new((i % 4) as f64 / 3.0, (i / 4) as f64 / 3.0));
    invalid.boundary = MeshBoundary::Fixed;
    let value = serde_json::to_value(&invalid).unwrap();
    assert!(value.get("boundary").is_none());
    let legacy: DeformationWorkSpec = serde_json::from_value(value).unwrap();
    assert_eq!(legacy.boundary, MeshBoundary::Fixed);
    assert!(plan_deformation_work(&legacy).is_ok());
    assert!(plan_deformation_work(&original).is_ok());
}

#[test]
fn complete_free_grid_capacity_retains_all_corner_and_edge_intent() {
    let mut value = work();
    value.surface = None;
    value.mesh_subdivisions = 16;
    value.mesh_edits = (0..17)
        .flat_map(|row| {
            (0..17).map(move |column| MeshVertexEdit {
                column,
                row,
                warped: Point::new(f64::from(column) / 16.0, f64::from(row) / 16.0),
            })
        })
        .collect();
    let plan = plan_deformation_work(&value).unwrap();
    assert_eq!(plan.mesh_edit_count, 289);
    value.mesh_edits.push(value.mesh_edits[0]);
    assert_eq!(
        plan_deformation_work(&value).unwrap_err().code,
        ErrorCode::Schema
    );
}

#[test]
fn free_outline_composes_with_a_concave_shape_without_baking_either_recipe() {
    let mut value = work();
    value.mesh_subdivisions = 4;
    let interior = plan_deformation_work(&value).unwrap();
    let contour = MockupClipContour {
        start: Point::new(0.0, 0.0),
        segments: [
            (1.0, 0.0),
            (1.0, 1.0 / 3.0),
            (0.6875, 1.0 / 3.0),
            (0.6875, 1.0),
            (0.0, 1.0),
        ]
        .into_iter()
        .map(|(x, y)| MockupClipSegment::Line {
            to: Point::new(x, y),
        })
        .collect(),
    };
    let fit = ShapeFitControls {
        contour,
        clip: None,
        corner_positions: None,
        refinement: Some(1),
    };
    let fit_mesh = resolve_shape_fit(&fit).unwrap().mesh;
    value.shape_fit = Some(fit.clone());
    let composed = plan_deformation_work(&value).unwrap();
    let inner = MeshCoordinateMap::new(&interior.mesh_warp.spec.mesh).unwrap();
    let outer = MeshCoordinateMap::new(&fit_mesh).unwrap();
    let actual = MeshCoordinateMap::new(&composed.mesh_warp.spec.mesh).unwrap();
    for point in [
        Point::new(0.5, 0.0),
        Point::new(0.2, 0.3),
        Point::new(0.8, 0.7),
        Point::new(0.0, 1.0),
    ] {
        let expected = outer
            .map(inner.map(point, false).unwrap().unwrap(), false)
            .unwrap()
            .unwrap();
        let found = actual.map(point, false).unwrap().unwrap();
        assert!((expected.x - found.x).hypot(expected.y - found.y) < 1e-8);
    }
    assert_eq!(composed.spec.shape_fit, Some(fit));
    assert_eq!(composed.spec.surface, value.surface);
    assert_eq!(
        composed.shape_fit_view.unwrap().interior_mesh,
        interior.mesh_warp.spec.mesh
    );
    // The fitting map has a finite source domain. Refuse an exterior edit
    // with that specific reason, without describing all free work as bounded.
    value.surface.as_mut().unwrap().envelope.points[1].y = -0.2;
    value.surface.as_mut().unwrap().envelope.points[2].y = -0.2;
    assert_eq!(
        plan_deformation_work(&value).unwrap_err().message,
        "shape fitting edits must stay inside the fitted domain"
    );
    value.shape_fit = None;
    assert!(
        plan_deformation_work(&value)
            .unwrap()
            .authored_view
            .is_some()
    );
}
