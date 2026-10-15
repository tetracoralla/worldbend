use super::*;
use crate::{MeshBoundary, WarpMeshTopology, WarpVertex};

fn mesh(center: Point) -> WarpMesh {
    WarpMesh {
        topology: WarpMeshTopology::Grid { subdivisions: 2 },
        boundary: MeshBoundary::Fixed,
        shading: None,
        vertices: (0..9)
            .map(|i| {
                let p = Point::new(f64::from(i % 3) / 2., f64::from(i / 3) / 2.);
                WarpVertex {
                    source: p,
                    warped: if i == 4 { center } else { p },
                }
            })
            .collect(),
    }
}
fn polygon(points: &[(f64, f64)]) -> VectorPathSpec {
    VectorPathSpec {
        vertices: points
            .iter()
            .map(|&(x, y)| VectorPathVertex { x, y })
            .collect(),
        segments: (0..points.len())
            .map(|i| VectorPathSegment {
                start: i,
                end: (i + 1) % points.len(),
                tangent_start: None,
                tangent_end: None,
            })
            .collect(),
        regions: vec![VectorPathRegion {
            winding_rule: VectorWindingRule::EvenOdd,
            loops: vec![(0..points.len()).collect()],
        }],
    }
}
fn input(path: VectorPathSpec) -> VectorProjectionInput {
    VectorProjectionInput {
        schema: VECTOR_PROJECTION_SCHEMA.into(),
        version: VECTOR_MESH_PROJECTION_VERSION.into(),
        path,
        stroke: None,
        source_transform: [1., 0., 0., 0., 1., 0.],
        source_bounds: unit_bounds(),
        homography: [100., 0., 0., 0., 100., 0., 0., 0., 1.],
        mesh: Some(mesh(Point::new(0.62, 0.43))),
        reference: Size::new(100., 100.),
        placement: Size::new(100., 100.),
        tolerance_px: 0.25,
    }
}
fn square() -> VectorPathSpec {
    polygon(&[(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)])
}
fn indexed_sliver(center: Point) -> WarpMesh {
    let inside = Point::new(center.x * 0.5, center.y * 0.5 - 1e-11);
    let source = [
        Point::new(0., 0.),
        Point::new(1., 0.),
        Point::new(1., 1.),
        Point::new(0., 1.),
        center,
        inside,
    ];
    WarpMesh {
        topology: WarpMeshTopology::Triangles {
            triangles: vec![
                [0, 1, 5],
                [1, 4, 5],
                [4, 0, 5],
                [1, 2, 4],
                [2, 3, 4],
                [3, 0, 4],
            ],
        },
        boundary: MeshBoundary::Fixed,
        shading: None,
        vertices: source
            .into_iter()
            .enumerate()
            .map(|(index, source)| WarpVertex {
                source,
                warped: if index == 5 {
                    Point::new(source.x, source.y - 0.1)
                } else {
                    source
                },
            })
            .collect(),
    }
}

/// A test-only all-candidates index runs the SAME strict projection/curve/
/// stroke/error engine without the spatial pruning. Compare complete emitted
/// values, not just boxes or sampled pixels; meters intentionally differ.
fn compare_full_scan(i: &VectorProjectionInput) -> TransformResult<VectorProjectionOutput> {
    let linear = ProjectionFrame::new(i)?;
    let mut full = match MeshProjection::new(i.mesh.as_ref().unwrap(), &linear) {
        Ok(full) => full,
        Err(error) => {
            let indexed = plan_vector_projection(i);
            assert_eq!(indexed, Err(error.clone()));
            return indexed;
        }
    };
    full.face_index = MeshIndex::all_candidates(full.map.faces().len());
    full.edge_index = MeshIndex::all_candidates(full.map.edges().len());
    let indexed = plan_vector_projection(i);
    let reference = project_with_work(i, None, Some(&full));
    match (&indexed, &reference) {
        (Ok(a), Ok(b)) => assert_eq!(
            a, b,
            "complete network/tangents/winding/fidelity/error must be unchanged"
        ),
        (Err(a), Err(b)) => assert_eq!(a, b, "refusal and structured error must be unchanged"),
        _ => panic!("indexed/full-scan admission diverged: {indexed:?} / {reference:?}"),
    }
    indexed
}

#[test]
fn broad_phase_matches_full_projection_for_seams_slivers_curves_strokes_and_refusal_recovery() {
    let mut cases = vec![
        input(square()),
        input(curved()),
        input(polygon(&[(0., 0.), (0.5, 0.5), (1., 1.), (0., 1.)])),
    ];
    // More than one BVH leaf: both point and control-hull face pruning must
    // really run, rather than an eight-face grid that returns every face.
    let dense = WarpMesh {
        topology: WarpMeshTopology::Grid { subdivisions: 8 },
        boundary: MeshBoundary::Fixed,
        shading: None,
        vertices: (0..81)
            .map(|i| {
                let p = Point::new(f64::from(i % 9) / 8., f64::from(i / 9) / 8.);
                WarpVertex {
                    source: p,
                    warped: if i == 40 { Point::new(0.56, 0.48) } else { p },
                }
            })
            .collect(),
    };
    for path in [square(), curved()] {
        let mut i = input(path);
        i.mesh = Some(dense.clone());
        cases.push(i);
    }
    let mut exact = input(polygon(&[(0.03, 0.02), (0.22, 0.03), (0.2, 0.12)]));
    exact.path.segments[0].tangent_start = Some(Point::new(0.06, 0.01));
    exact.path.segments[0].tangent_end = Some(Point::new(-0.04, 0.01));
    let exact_output = compare_full_scan(&exact).unwrap();
    assert_eq!(
        exact_output.report.fidelity,
        VectorProjectionFidelity::Exact
    );
    assert!(exact_output.network.segments[0].tangent_start.is_some());
    cases.push(exact);
    let mut holes = input(square());
    let other = polygon(&[(0.35, 0.35), (0.65, 0.35), (0.65, 0.65), (0.35, 0.65)]);
    holes.path.vertices.extend(other.vertices);
    holes
        .path
        .segments
        .extend(other.segments.into_iter().map(|mut s| {
            s.start += 4;
            s.end += 4;
            s
        }));
    holes.path.regions[0].loops.push(vec![4, 5, 6, 7]);
    cases.push(holes);
    let mut sliver = input(polygon(&[
        (0.19758520528548656, 0.34127980021923676),
        (0.1, 0.1),
        (0.2, 0.05),
    ]));
    sliver.mesh = Some(indexed_sliver(Point::new(
        0.39517041057097313,
        0.6825596004484735,
    )));
    sliver.placement = Size::new(10000., 10000.);
    sliver.tolerance_px = 0.01;
    cases.push(sliver);
    for y in [0.5_f64.next_down(), 0.5, 0.5_f64.next_up()] {
        cases.push(input(polygon(&[(0.49, y), (0.51, y), (0.5, 0.6)])));
    }
    let mut stroke = input(square());
    stroke.stroke = Some(VectorStrokeSpec {
        weight: 0.03,
        cap: VectorStrokeCap::Round,
        join: VectorStrokeJoin::Round,
        miter_limit: 4.,
    });
    cases.push(stroke);
    let mut exterior = input(curved());
    exterior.path.segments[0].tangent_start = Some(Point::new(-2., 3.));
    cases.push(exterior);
    let mut horizon = input(square());
    horizon.homography = [1., 0., 0., 0., 1., 0., 1., 0., -0.6];
    cases.push(horizon);
    let mut fidelities = std::collections::BTreeSet::new();
    for mut i in cases {
        if let Ok(output) = compare_full_scan(&i) {
            fidelities.insert(format!("{:?}", output.report.fidelity));
        }
        // Projective magnification/flip adds derivative/horizon/error paths.
        i.homography = [100., 5., 0., -3., 100., 0., 0.08, 0.04, 1.];
        i.placement = Size::new(1000., 800.);
        let _ = compare_full_scan(&i);
    }
    assert_eq!(
        fidelities,
        std::collections::BTreeSet::from([
            "Exact".into(),
            "Approximated".into(),
            "Outlined".into()
        ])
    );
    // A rejected actual exterior domain must not poison the next complete job.
    let invalid = input(polygon(&[(-0.01, 0.2), (0.8, 0.2), (0.8, 0.8)]));
    assert!(compare_full_scan(&invalid).is_err());
    assert!(compare_full_scan(&input(square())).is_ok());
}

#[test]
fn admitted_indexed_sliver_weights_keep_authoring_and_exact_vector_coordinates() {
    let center = Point::new(0.39517041057097313, 0.6825596004484735);
    let point = Point::new(0.19758520528548656, 0.34127980021923676);
    let m = indexed_sliver(center);
    // Exact rational evaluation of these binary64 coordinates gives weights
    // [.25, .25, .5] in face [4,0,5]. Ordinary cross products displaced the
    // result by .02472px at this placement while still declaring Exact.
    let expected = Point::new(0.19758520528548656, 0.2912798002192368);
    let actual_weights = weights(
        [
            m.vertices[4].source,
            m.vertices[0].source,
            m.vertices[5].source,
        ],
        point,
    );
    assert_eq!(actual_weights, [0.25, 0.25, 0.5]);
    let mut i = input(polygon(&[(point.x, point.y), (0.1, 0.1), (0.2, 0.05)]));
    i.mesh = Some(m.clone());
    i.homography = [1., 0., 0., 0., 1., 0., 0., 0., 1.];
    i.reference = Size::new(1., 1.);
    i.placement = Size::new(10000., 10000.);
    i.tolerance_px = 0.01;
    let output = plan_vector_projection(&i).unwrap();
    let vertex = output.network.vertices[0];
    assert!((vertex.x - expected.x * 10000.).hypot(vertex.y - expected.y * 10000.) < 1e-9);
    assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
    // Moving the same source to an ordinary large Figma page origin changes
    // only source document coordinates, never the nonlinear result geometry.
    let mut translated = i.clone();
    translated.source_transform = [1., 0., 75000., 0., 1., 18000.];
    translated.source_bounds.x = 75000.;
    translated.source_bounds.y = 18000.;
    assert_eq!(
        serde_json::to_value(plan_vector_projection(&translated).unwrap()).unwrap(),
        serde_json::to_value(&output).unwrap()
    );
    #[cfg(feature = "deform")]
    {
        let map = MeshCoordinateMap::new(&m).unwrap();
        let mapped = map.map(point, false).unwrap().unwrap();
        assert!((mapped.x - expected.x).hypot(mapped.y - expected.y) < 1e-15);
    }
}

#[test]
fn admitted_indexed_sliver_jacobian_does_not_understate_the_error_scale() {
    let mut i = input(square());
    i.mesh = Some(indexed_sliver(Point::new(
        0.45010988447241845,
        0.6313991500915803,
    )));
    i.homography = [1., 0., 0., 0., 1., 0., 0., 0., 1.];
    i.reference = Size::new(1., 1.);
    i.placement = Size::new(1., 1.);
    let linear = ProjectionFrame::new(&i).unwrap();
    let projection = MeshProjection::new(i.mesh.as_ref().unwrap(), &linear).unwrap();
    // The exact rational derivatives of face [4,0,5] are
    // [1,0,-14027665679.669722,9999999173.59636] after binary64 rounding.
    // Their norm is 17227170048.86501; ordinary determinants underestimated
    // it by 4.9944e-6 relative, far beyond the numerical certificate slack.
    let expected_norm = 17227170048.86501;
    assert!(projection.scale >= expected_norm);
    assert!(projection.scale <= expected_norm * (1.0 + 1e-9));
}
fn curved() -> VectorPathSpec {
    let mut p = square();
    p.segments[0].tangent_start = Some(Point::new(0.15, -0.12));
    p.segments[0].tangent_end = Some(Point::new(-0.15, 0.15));
    p
}
// Independent regular-grid oracle: cell-local triangle weights, not core's
// prepared face/edge/Jacobian helpers or vector projection implementation.
fn oracle(input: &VectorProjectionInput, p: Point) -> Point {
    let t = input.source_transform;
    let p = Point::new(
        (t[0] * p.x + t[1] * p.y + t[2] - input.source_bounds.x) / input.source_bounds.width,
        (t[3] * p.x + t[4] * p.y + t[5] - input.source_bounds.y) / input.source_bounds.height,
    );
    let m = input.mesh.as_ref().unwrap();
    let x = (p.x * 2.).floor().min(1.) as usize;
    let y = (p.y * 2.).floor().min(1.) as usize;
    let dx = p.x * 2. - x as f64;
    let dy = p.y * 2. - y as f64;
    let a = y * 3 + x;
    let (indices, w) = if dx >= dy {
        ([a, a + 1, a + 4], [1. - dx, dx - dy, dy])
    } else {
        ([a, a + 4, a + 3], [1. - dy, dx, dy - dx])
    };
    let p = Point::new(
        (0..3).map(|i| m.vertices[indices[i]].warped.x * w[i]).sum(),
        (0..3).map(|i| m.vertices[indices[i]].warped.y * w[i]).sum(),
    );
    let h = input.homography;
    let den = h[6] * p.x + h[7] * p.y + h[8];
    Point::new(
        (h[0] * p.x + h[1] * p.y + h[2]) / den * input.placement.width / input.reference.width,
        (h[3] * p.x + h[4] * p.y + h[5]) / den * input.placement.height / input.reference.height,
    )
}
fn bezier(c: [Point; 4], t: f64) -> Point {
    let u = 1. - t;
    Point::new(
        u * u * u * c[0].x + 3. * u * u * t * c[1].x + 3. * u * t * t * c[2].x + t * t * t * c[3].x,
        u * u * u * c[0].y + 3. * u * u * t * c[1].y + 3. * u * t * t * c[2].y + t * t * t * c[3].y,
    )
}
fn line_distance(p: Point, a: Point, b: Point) -> f64 {
    let x = b.x - a.x;
    let y = b.y - a.y;
    let d = x * x + y * y;
    let t = if d == 0. {
        0.
    } else {
        (((p.x - a.x) * x + (p.y - a.y) * y) / d).clamp(0., 1.)
    };
    (p.x - a.x - x * t).hypot(p.y - a.y - y * t)
}
fn output_distance(output: &VectorProjectionOutput, p: Point) -> f64 {
    output
        .network
        .segments
        .iter()
        .map(|s| {
            let c = cubic_control_points(s, &output.network.vertices);
            if zero_tangent(s.tangent_start) && zero_tangent(s.tangent_end) {
                line_distance(p, c[0], c[3])
            } else {
                (0..128)
                    .map(|i| {
                        line_distance(
                            p,
                            bezier(c, f64::from(i) / 128.),
                            bezier(c, f64::from(i + 1) / 128.),
                        )
                    })
                    .fold(f64::INFINITY, f64::min)
            }
        })
        .fold(f64::INFINITY, f64::min)
}

#[test]
fn wire_requires_02_for_mesh_and_rejects_null_without_weakening_legacy() {
    let mut i = input(square());
    i.version = "0.1".into();
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
    let mut value = serde_json::to_value(&i).unwrap();
    value["mesh"] = serde_json::Value::Null;
    assert!(serde_json::from_value::<VectorProjectionInput>(value).is_err());
    i.mesh = None;
    assert!(
        !serde_json::to_value(&i)
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("mesh")
    );
    assert!(plan_vector_projection(&i).is_ok());
}
#[test]
fn identity_mesh_has_byte_identical_legacy_output() {
    let mut i = input(curved());
    i.mesh = None;
    i.version = "0.1".into();
    let old = plan_vector_projection(&i).unwrap();
    i.version = "0.2".into();
    i.mesh = Some(mesh(Point::new(0.5, 0.5)));
    assert_eq!(
        serde_json::to_string(&old).unwrap(),
        serde_json::to_string(&plan_vector_projection(&i).unwrap()).unwrap()
    );
    // Identity mesh must not add a whole-unit-square horizon restriction to
    // a valid legacy path that occupies only the safe side of that horizon.
    i.path = polygon(&[(0.02, 0.02), (0.1, 0.02), (0.1, 0.1), (0.02, 0.1)]);
    i.homography = [100., 0., 0., 0., 100., 0., 1., 0., -0.5];
    let identity = plan_vector_projection(&i).unwrap();
    i.mesh = None;
    i.version = "0.1".into();
    assert_eq!(identity, plan_vector_projection(&i).unwrap());
}
#[test]
fn warped_domain_not_unexecuted_original_hull_owns_horizon_validation() {
    let mut i = input(square());
    i.homography = [100., 0., 0., 0., 100., 0., 1., 0., -0.5];
    i.mesh = None;
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::HomographyHorizonCrossing
    );
    let mut moved = mesh(Point::new(0.5, 0.5));
    moved.boundary = MeshBoundary::Free;
    for vertex in &mut moved.vertices {
        vertex.warped = Point::new(0.6 + 0.4 * vertex.source.x, 0.2 + 0.6 * vertex.source.y);
    }
    i.mesh = Some(moved);
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
    for segment in &i.path.segments {
        let a = i.path.vertices[segment.start];
        let b = i.path.vertices[segment.end];
        for step in 0..=32 {
            let t = f64::from(step) / 32.;
            let p = Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            assert!(output_distance(&output, oracle(&i, p)) < 1e-7);
        }
    }
}
#[test]
fn small_projective_row_is_not_exact_after_large_placement() {
    let mut path = polygon(&[(0.03, 0.02), (0.22, 0.03), (0.2, 0.12)]);
    path.segments[0].tangent_start = Some(Point::new(0.06, 0.01));
    path.segments[0].tangent_end = Some(Point::new(-0.04, 0.01));
    let mut i = input(path);
    i.homography[6] = 5e-11;
    i.placement = Size::new(1e12, 1e12);
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(
        output.report.fidelity,
        VectorProjectionFidelity::Approximated
    );
    let error = output.report.max_error.unwrap();
    assert!(error > 0.0 && error <= i.tolerance_px);
}
#[test]
fn near_seam_chooses_the_contained_face_not_first_epsilon_face() {
    let p = Point::new(0.5, 0.5 + 5e-11);
    let mut i = input(polygon(&[(p.x, p.y), (0.1, 0.6), (0.2, 0.7)]));
    let source = [
        Point::new(0., 0.),
        Point::new(1., 0.),
        Point::new(0., 1.),
        Point::new(1., 1.),
    ];
    let target = [
        Point::new(0., 0.),
        Point::new(1., 0.),
        Point::new(0., 0.5),
        Point::new(1., 1.),
    ];
    i.mesh = Some(WarpMesh {
        topology: WarpMeshTopology::Triangles {
            triangles: vec![[0, 1, 3], [0, 3, 2]],
        },
        boundary: MeshBoundary::Free,
        shading: None,
        vertices: source
            .into_iter()
            .zip(target)
            .map(|(source, warped)| WarpVertex { source, warped })
            .collect(),
    });
    i.homography = [1., 0., 0., 0., 1., 0., 0., 0., 1.];
    i.reference = Size::new(1., 1.);
    i.placement = Size::new(1e12, 1e12);
    let output = plan_vector_projection(&i).unwrap();
    let expected = Point::new(p.x * 1e12, (p.x + p.y) * 0.5 * 1e12);
    assert!((output.network.vertices[0].y - expected.y).abs() < 0.001);
    assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
    #[cfg(feature = "deform")]
    {
        let map = MeshCoordinateMap::new(i.mesh.as_ref().unwrap()).unwrap();
        let mapped = map.map(p, false).unwrap().unwrap();
        assert!((mapped.y * 1e12 - expected.y).abs() < 0.001);
        let exterior_control = Point::new(-0.2, 1.2);
        let mapped = map.map_control(exterior_control, p, false).unwrap();
        let reopened = map.map_control(mapped, p, true).unwrap();
        assert!((reopened.x - exterior_control.x).hypot(reopened.y - exterior_control.y) < 1e-10);
    }
    // True shared-edge and vertex membership must remain usable, not turn
    // the correction into a ban on legitimate canonical seams.
    for point in [Point::new(0.5, 0.5), Point::new(0., 0.), Point::new(1., 1.)] {
        i.path.vertices[0] = VectorPathVertex {
            x: point.x,
            y: point.y,
        };
        assert!(plan_vector_projection(&i).is_ok());
    }
}
#[test]
fn indexed_shared_edge_roundoff_does_not_leave_an_authoring_or_projection_gap() {
    let source = [
        Point::new(0., 0.),
        Point::new(1., 0.),
        Point::new(1., 1.),
        Point::new(0., 1.),
        Point::new(0.27195870503783226, 0.2523574760183692),
    ];
    let target = Point::new(0.6624678906984627, 0.5074056423734874);
    let mesh = WarpMesh {
        topology: WarpMeshTopology::Triangles {
            triangles: vec![[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
        },
        boundary: MeshBoundary::Fixed,
        shading: None,
        vertices: source
            .into_iter()
            .enumerate()
            .map(|(index, source)| WarpVertex {
                source,
                warped: if index == 4 { target } else { source },
            })
            .collect(),
    };
    // At this ordinary in-domain point both old directed-edge evaluations
    // rounded negative. Exact f64-coordinate arithmetic puts it on face0's
    // side of (0 -> center), not in a hole or an epsilon-expanded face3.
    let point = Point::new(0.11667315743181769, 0.10826402311516918);
    assert!(contains([source[0], source[1], source[4]], point));
    assert!(!contains([source[3], source[0], source[4]], point));
    let mut i = input(polygon(&[(point.x, point.y), (0.07, 0.13), (0.9, 0.11)]));
    i.mesh = Some(mesh.clone());
    assert_eq!(
        plan_vector_projection(&i).unwrap().report.fidelity,
        VectorProjectionFidelity::Exact
    );
    #[cfg(feature = "deform")]
    {
        let coordinates = MeshCoordinateMap::new(&mesh).unwrap();
        assert!(coordinates.map(point, false).unwrap().is_some());
        let handle = Point::new(-2., 3.);
        let mapped = coordinates.map_control(handle, point, false).unwrap();
        let reopened = coordinates.map_control(mapped, point, true).unwrap();
        assert!((handle.x - reopened.x).hypot(handle.y - reopened.y) < 1e-10);
        assert!(
            coordinates
                .map(Point::new(-1e-16, 0.2), false)
                .unwrap()
                .is_none()
        );
    }
    // The complete real projection also exercises freshly computed seam
    // intersections, not only a hand-fed point lookup. Nonuniform indexed
    // source edges must cover their square throughout continued authoring.
    for edge in 0..4 {
        for step in 0..=64 {
            let t = f64::from(step) / 64.;
            let a = source[edge];
            let b = source[4];
            let p = Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            i.path.vertices[0] = VectorPathVertex { x: p.x, y: p.y };
            assert!(
                plan_vector_projection(&i).is_ok(),
                "edge {edge}, step {step}"
            );
        }
    }
}

#[test]
fn rounded_collinear_shortcuts_keep_real_curve_residual_and_stroke_flatness() {
    let control = [
        Point::new(0.05077155651030568, 0.1860792237786627),
        Point::new(0.19590119161977762, 0.2528451615022825),
        Point::new(0.34103082672924956, 0.31961109922590225),
        Point::new(0.48616046183872147, 0.386377036949522),
    ];
    let direction = Point::new(control[3].x - control[0].x, control[3].y - control[0].y);
    for point in &control[1..3] {
        // Both ordinary determinants round to zero, although their exact
        // binary64-coordinate determinants are strictly negative.
        assert_eq!(
            direction.x * (point.y - control[0].y) - direction.y * (point.x - control[0].x),
            0.0
        );
        assert!(orientation(control[0], control[3], *point) < 0.0);
    }
    assert!(!exactly_collinear(&control));
    let mut pieces = Vec::new();
    subdivide_offset_piece(&control, 1e-5, 1e-6, true, 0, &mut pieces, &mut 0, None).unwrap();
    assert!(
        pieces
            .iter()
            .all(|piece| !piece.straight && piece.error > 0.0)
    );
    let mut path = polygon(&[
        (control[0].x, control[0].y),
        (control[3].x, control[3].y),
        (0.2, 0.5),
    ]);
    path.segments[0].tangent_start = Some(Point::new(
        control[1].x - control[0].x,
        control[1].y - control[0].y,
    ));
    path.segments[0].tangent_end = Some(Point::new(
        control[2].x - control[3].x,
        control[2].y - control[3].y,
    ));
    let mut i = input(path);
    for vertex in &mut i.mesh.as_mut().unwrap().vertices {
        vertex.warped = Point::new(vertex.source.x, vertex.source.y * 0.5);
    }
    i.mesh.as_mut().unwrap().boundary = MeshBoundary::Free;
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(
        output.report.fidelity,
        VectorProjectionFidelity::Approximated
    );
    assert!(output.report.max_error.unwrap() > 0.0);
    // Rounded degree-elevated controls must not make the convex-hull proof
    // zero either. This remains true even after fixing the collinearity gate.
    assert!(
        linear_combination_abs_bound([
            (control[1].x, 3.0),
            (control[0].x, -2.0),
            (control[3].x, -1.0)
        ]) > 0.0
    );
}

#[test]
fn rounded_chord_controls_cannot_zero_the_mesh_curve_proof() {
    let control = [
        Point::new(0.09808226753871438, 0.16032847568281075),
        Point::new(0.21611524113384287, 0.20972733953395686),
        Point::new(0.3341482147289713, 0.259126203385103),
        Point::new(0.4521811883240998, 0.3085250672362491),
    ];
    assert!(!exactly_collinear(&control));
    for axis in [control.map(|p| p.x), control.map(|p| p.y)] {
        assert_eq!(axis[1], (2.0 * axis[0] + axis[3]) / 3.0);
        assert_eq!(axis[2], (axis[0] + 2.0 * axis[3]) / 3.0);
    }
    let mut path = polygon(&[
        (control[0].x, control[0].y),
        (control[3].x, control[3].y),
        (0.2, 0.5),
    ]);
    path.segments[0].tangent_start = Some(Point::new(
        control[1].x - control[0].x,
        control[1].y - control[0].y,
    ));
    path.segments[0].tangent_end = Some(Point::new(
        control[2].x - control[3].x,
        control[2].y - control[3].y,
    ));
    let mut i = input(path);
    for vertex in &mut i.mesh.as_mut().unwrap().vertices {
        vertex.warped = Point::new(vertex.source.x, vertex.source.y * 0.5);
    }
    i.mesh.as_mut().unwrap().boundary = MeshBoundary::Free;
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(
        output.report.fidelity,
        VectorProjectionFidelity::Approximated
    );
    assert!(output.report.max_error.unwrap() > 0.0);
}

#[test]
fn near_parallel_line_still_splits_its_real_indexed_face_crossing() {
    let center = Point::new(0.6345434657246721, 0.5350630241589321);
    let start = Point::new(0.08274797263667595, 0.06977517360680134);
    let end = Point::new(0.5038131051363208, 0.42482789313302743);
    let direction = Point::new(end.x - start.x, end.y - start.y);
    assert_eq!(direction.x * center.y - direction.y * center.x, 0.0);
    assert!(orientation(Point::new(0., 0.), center, start) < 0.0);
    assert!(orientation(Point::new(0., 0.), center, end) > 0.0);
    let source = [
        Point::new(0., 0.),
        Point::new(1., 0.),
        Point::new(1., 1.),
        Point::new(0., 1.),
        center,
    ];
    let mut i = input(polygon(&[(start.x, start.y), (end.x, end.y), (0.7, 0.1)]));
    i.mesh = Some(WarpMesh {
        topology: WarpMeshTopology::Triangles {
            triangles: vec![[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
        },
        boundary: MeshBoundary::Fixed,
        shading: None,
        vertices: source
            .into_iter()
            .enumerate()
            .map(|(index, source)| WarpVertex {
                source,
                warped: if index == 4 {
                    Point::new(0.3, 0.7)
                } else {
                    source
                },
            })
            .collect(),
    });
    let frame = ProjectionFrame::new(&i).unwrap();
    let projection = MeshProjection::new(i.mesh.as_ref().unwrap(), &frame).unwrap();
    let parameters = projection.line_parameters(start, end).unwrap();
    let expected = 995172902522905.0 / 3811086813304018.0;
    assert!(
        parameters
            .iter()
            .any(|&value| (value - expected).abs() < 1e-15),
        "parameters={parameters:?}, sides={:?}/{:?}, edge-sides={:?}/{:?}",
        orientation(source[0], center, start),
        orientation(source[0], center, end),
        orientation(start, end, source[0]),
        orientation(start, end, center),
    );
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
    assert_ne!(
        output.network.segments[0].end, 1,
        "the first source segment must not bridge the real seam unsplit"
    );
}

#[test]
fn rotated_stroke_domain_uses_the_real_outline_not_source_box_corners() {
    let radius = 0.3;
    let k = radius * 0.5522847498307936;
    let mut path = polygon(&[(0.8, 0.5), (0.5, 0.8), (0.2, 0.5), (0.5, 0.2)]);
    for (segment, (start, end)) in path.segments.iter_mut().zip([
        (Point::new(0., k), Point::new(k, 0.)),
        (Point::new(-k, 0.), Point::new(0., k)),
        (Point::new(0., -k), Point::new(-k, 0.)),
        (Point::new(k, 0.), Point::new(0., -k)),
    ]) {
        segment.tangent_start = Some(start);
        segment.tangent_end = Some(end);
    }
    let mut i = input(path);
    let rotation = std::f64::consts::FRAC_1_SQRT_2;
    i.source_transform = [rotation, -rotation, 0.5, rotation, rotation, 0.5 - rotation];
    i.source_bounds = Bounds {
        x: 0.18,
        y: 0.18,
        width: 0.64,
        height: 0.64,
    };
    i.stroke = Some(VectorStrokeSpec {
        weight: 0.01,
        cap: VectorStrokeCap::None,
        join: VectorStrokeJoin::Miter,
        miter_limit: 4.,
    });
    let output = plan_vector_projection(&i).unwrap();
    assert_eq!(output.report.fidelity, VectorProjectionFidelity::Outlined);
    assert_eq!(output.network.regions[1].loops.len(), 2);
    assert!(output.report.max_error.unwrap() <= i.tolerance_px);
    // The same rotation with a genuinely too-small artwork domain still
    // refuses the stroke, even though its centerline remains inside it.
    i.source_bounds = Bounds {
        x: 0.198,
        y: 0.198,
        width: 0.604,
        height: 0.604,
    };
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
}

#[test]
fn nonlinear_stroke_never_drops_source_epsilon_without_a_target_budget() {
    let control = [
        Point::new(0.2, 0.2),
        Point::new(0.4, 0.2 + 1e-10),
        Point::new(0.6, 0.2 + 1e-10),
        Point::new(0.8, 0.2),
    ];
    let mut pieces = Vec::new();
    subdivide_offset_piece(&control, 1e-7, 1e-12, true, 0, &mut pieces, &mut 0, None).unwrap();
    assert!(pieces.len() > 1);
    assert!(
        pieces
            .iter()
            .any(|piece| !piece.straight && piece.error > 0.0)
    );
    let points = [
        Point::new(0.2, 0.2),
        Point::new(0.2 + 1e-10, 0.2 + 1e-10),
        Point::new(0.8, 0.2),
        Point::new(0.2, 0.8),
    ];
    assert_eq!(clean_loop(&points, true), points);
    assert_eq!(clean_loop(&points, false).len(), 3);
}
#[test]
fn stroke_arc_capacity_precedes_allocation_and_tiny_arc_keeps_its_bound() {
    assert_eq!(
        arc_interior(
            Point::new(0., 0.),
            Point::new(1e8, 0.),
            Point::new(-1e8, 0.),
            Point::new(0., 1e8),
            1e8,
            0.01,
            true,
        )
        .unwrap_err()
        .code,
        ErrorCode::OutputLimit
    );
    let (_, bound) = arc_interior(
        Point::new(0., 0.),
        Point::new(1e8, 0.),
        Point::new(1e8, 1e-5),
        Point::new(1e8, 5e-6),
        1e8,
        1e-20,
        true,
    )
    .unwrap();
    assert!(bound > 0.0 && bound <= 1e-20);
    let mut points = Vec::new();
    assert_eq!(
        append_outline_points(
            &mut points,
            (0..MAX_VECTOR_OUTPUT_VERTICES * 2 + 3).map(|index| Point::new(index as f64, 0.)),
            true,
        )
        .unwrap_err()
        .code,
        ErrorCode::OutputLimit
    );
    assert!(plan_vector_projection(&input(square())).is_ok());
}
#[test]
fn outline_cleanup_spends_and_adds_a_bounded_error_instead_of_unbudgeted_snap() {
    let points = [
        Point::new(0.2, 0.2),
        Point::new(0.2 + 1e-10, 0.2 + 1e-10),
        Point::new(0.8, 0.2),
        Point::new(0.2, 0.8),
    ];
    let (high_scale, error) = clean_budgeted_loop(&points, 1e-13);
    assert_eq!(high_scale, points);
    assert_eq!(error, 0.0);
    let (cleaned, error) = clean_budgeted_loop(&points, 1e-4);
    assert_eq!(cleaned.len(), 3);
    assert!(error >= (points[1].x - points[0].x).hypot(points[1].y - points[0].y));
    let mut total = Some(0.1);
    account_outline_cleanup(&mut total, Some(0.2), 0.03);
    assert_eq!(total, Some(0.23));
}
#[test]
fn straight_boundaries_split_at_mesh_seams_and_stay_exact() {
    let i = input(square());
    let o = plan_vector_projection(&i).unwrap();
    assert_eq!(o.report.fidelity, VectorProjectionFidelity::Exact);
    assert!(o.network.segments.len() > 4);
    assert_eq!(o.report.max_error, None);
    for s in &i.path.segments {
        let a = i.path.vertices[s.start];
        let b = i.path.vertices[s.end];
        for step in 0..=32 {
            let t = f64::from(step) / 32.;
            let p = Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            assert!(output_distance(&o, oracle(&i, p)) < 1e-7);
        }
    }
}
#[test]
fn crossing_curves_obey_derived_bound_and_tighter_budget_with_projective_flip() {
    let mut i = input(curved());
    i.homography = [-100., 8., 100., 0., 85., 0., 0.12, -0.03, 1.];
    i.placement = Size::new(180., 70.);
    for tolerance in [0.25, 0.08] {
        i.tolerance_px = tolerance;
        let o = plan_vector_projection(&i).unwrap();
        let bound = o.report.max_error.unwrap();
        assert!(bound <= tolerance);
        assert_eq!(o.report.fidelity, VectorProjectionFidelity::Approximated);
        let c = cubic_control_points(&i.path.segments[0], &i.path.vertices);
        for step in 0..=200 {
            let p = oracle(&i, bezier(c, f64::from(step) / 200.));
            assert!(output_distance(&o, p) <= bound + 1e-5);
        }
        assert_eq!(o, plan_vector_projection(&i).unwrap());
    }
}
#[test]
fn face_contained_cubic_keeps_exact_handles() {
    let mut p = polygon(&[(0.03, 0.02), (0.22, 0.03), (0.2, 0.12)]);
    p.segments[0].tangent_start = Some(Point::new(0.06, 0.01));
    p.segments[0].tangent_end = Some(Point::new(-0.04, 0.01));
    let i = input(p);
    let o = plan_vector_projection(&i).unwrap();
    assert_eq!(o.network.segments.len(), 3);
    assert_eq!(o.report.fidelity, VectorProjectionFidelity::Exact);
    let original = cubic_control_points(&i.path.segments[0], &i.path.vertices);
    let emitted = cubic_control_points(&o.network.segments[0], &o.network.vertices);
    for (actual, source) in emitted.into_iter().zip(original) {
        let expected = oracle(&i, source);
        assert!((actual.x - expected.x).hypot(actual.y - expected.y) < 1e-8);
    }
}
#[test]
fn whole_stroke_outlines_cross_the_mesh_and_preserve_hole_loops() {
    let mut i = input(square());
    i.stroke = Some(VectorStrokeSpec {
        weight: 0.04,
        cap: VectorStrokeCap::None,
        join: VectorStrokeJoin::Miter,
        miter_limit: 4.,
    });
    let o = plan_vector_projection(&i).unwrap();
    assert!(o.report.stroke_outlined);
    assert_eq!(o.network.regions.len(), 2);
    assert_eq!(o.network.regions[1].loops.len(), 2);
    assert!(o.network.regions[1].loops.iter().all(|l| l.len() > 4));
    // Exact offset boundary must reach the moved center-relative location,
    // not the unwarped uniform-width outline after projection.
    for p in [
        Point::new(0.5, 0.18),
        Point::new(0.5, 0.22),
        Point::new(0.78, 0.5),
        Point::new(0.82, 0.5),
    ] {
        assert!(output_distance(&o, oracle(&i, p)) < 1e-7);
    }
}
#[test]
fn hole_regions_and_seam_coincident_boundaries_survive() {
    let mut p = polygon(&[
        (0., 0.),
        (1., 0.),
        (1., 1.),
        (0., 1.),
        (0.4, 0.4),
        (0.5, 0.4),
        (0.5, 0.6),
        (0.4, 0.6),
    ]);
    p.segments = (0..8)
        .map(|i| VectorPathSegment {
            start: i,
            end: if i == 3 {
                0
            } else if i == 7 {
                4
            } else {
                i + 1
            },
            tangent_start: None,
            tangent_end: None,
        })
        .collect();
    p.regions[0].loops = vec![(0..4).collect(), (4..8).collect()];
    let o = plan_vector_projection(&input(p)).unwrap();
    assert_eq!(
        o.network.regions[0].winding_rule,
        VectorWindingRule::EvenOdd
    );
    assert_eq!(o.network.regions[0].loops.len(), 2);
    assert!(o.network.segments.iter().all(|s| s.start != s.end));
}
#[test]
fn invalid_domains_folds_shading_and_horizons_refuse_before_output() {
    let mut i = input(square());
    i.path.vertices[0].x = -0.001;
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
    i = input(square());
    i.mesh = Some(mesh(Point::new(1., 1.)));
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
    i = input(square());
    i.mesh.as_mut().unwrap().shading = Some(vec![0.8; 9]);
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
    i = input(square());
    i.homography = [100., 0., 0., 0., 100., 0., 1., 0., -0.5];
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::HomographyHorizonCrossing
    );
}
#[test]
fn malformed_indices_and_work_budget_are_bounded_and_next_call_recovers() {
    let i = input(square());
    let linear = ProjectionFrame::new(&i).unwrap();
    let projection = MeshProjection::new(i.mesh.as_ref().unwrap(), &linear).unwrap();
    projection.visits.set(MAX_FACE_VISITS);
    assert_eq!(
        projection.map_point(Point::new(0.2, 0.2)).unwrap_err().code,
        ErrorCode::OutputLimit
    );
    assert!(plan_vector_projection(&i).is_ok());
    let mut bad = i;
    let m = bad.mesh.as_mut().unwrap();
    m.topology = WarpMeshTopology::Triangles {
        triangles: vec![[0, 1, 6000], [0, 4, 3]],
    };
    assert_eq!(
        plan_vector_projection(&bad).unwrap_err().code,
        ErrorCode::Schema
    );
}

#[test]
fn near_collinear_is_not_exact_after_large_target_amplification() {
    let mut i = input(square());
    i.placement = Size::new(1e10, 1e10);
    i.path.segments[0].tangent_start = Some(Point::new(0.2, 1e-10));
    i.path.segments[0].tangent_end = Some(Point::new(-0.2, 1e-10));
    // Directly inspect the semantic shortcut independently of output capacity:
    // huge scale may legitimately exhaust the finite emitted network budget.
    let controls = cubic_control_points(&i.path.segments[0], &i.path.vertices);
    assert!(!exactly_collinear(&controls));
    match plan_vector_projection(&i) {
        Ok(output) => assert_ne!(output.report.fidelity, VectorProjectionFidelity::Exact),
        Err(error) => assert_eq!(error.code, ErrorCode::OutputLimit),
    }
}

#[test]
fn repeated_loop_metadata_cannot_bypass_input_or_emitted_network_capacity() {
    let mut i = input(square());
    i.path.regions[0].loops = vec![vec![0, 1, 2, 3]; MAX_VECTOR_INPUT_LOOP_REFERENCES / 4 + 1];
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::OutputLimit
    );
    i.path.regions[0].loops = vec![vec![0, 1, 2, 3]; MAX_VECTOR_INPUT_LOOP_REFERENCES / 4];
    // Every original boundary crosses multiple faces; emitted references
    // expand even though the shared network stays small.
    i.mesh = Some(
        crate::build_warp_mesh(Some(crate::WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.3,
        }))
        .unwrap(),
    );
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::OutputLimit
    );
    assert!(plan_vector_projection(&input(square())).is_ok());
}

#[test]
fn indexed_faces_use_the_identical_mapping_not_a_regular_grid_surrogate() {
    let i = input(curved());
    let expected = plan_vector_projection(&i).unwrap();
    let mut indexed = i.clone();
    let m = indexed.mesh.as_mut().unwrap();
    m.topology = WarpMeshTopology::Triangles {
        triangles: m
            .triangle_indices()
            .unwrap()
            .into_iter()
            .map(|face| face.map(|index| index as u16))
            .collect(),
    };
    assert_eq!(expected, plan_vector_projection(&indexed).unwrap());
}

#[test]
fn exterior_handles_are_allowed_but_actual_exterior_curves_are_not_clamped() {
    let mut i = input(square());
    i.path.segments[0].tangent_start = Some(Point::new(-0.3, 0.05));
    i.path.segments[0].tangent_end = Some(Point::new(-0.2, 0.02));
    assert!(plan_vector_projection(&i).is_ok());
    i.path.segments[0].tangent_start = Some(Point::new(-2., 0.05));
    assert_eq!(
        plan_vector_projection(&i).unwrap_err().code,
        ErrorCode::Schema
    );
}

#[test]
fn derivative_floor_cannot_admit_a_tiny_actual_exterior_curve() {
    let mut path = polygon(&[(0.2, 0.), (0.8, 0.), (0.8, 0.5)]);
    path.segments[0].tangent_start = Some(Point::new(0.2, -1e-16));
    path.segments[0].tangent_end = Some(Point::new(-0.2, -1e-16));
    assert_eq!(
        plan_vector_projection(&input(path)).unwrap_err().code,
        ErrorCode::Schema
    );
    assert_eq!(domain_extrema([0., -1e-16, -1e-16, 0.]).unwrap(), vec![0.5]);
}

#[cfg(feature = "deformation-work")]
#[test]
fn genuine_concave_shape_fit_uses_its_indexed_execution_mesh() {
    let points = [
        (0., 0.),
        (1., 0.),
        (1., 0.4),
        (0.4, 0.4),
        (0.4, 1.),
        (0., 1.),
    ];
    let fit = crate::resolve_shape_fit(&crate::ShapeFitControls {
        contour: crate::MockupClipContour {
            start: Point::new(0., 0.),
            segments: points
                .iter()
                .skip(1)
                .map(|&(x, y)| crate::MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .collect(),
        },
        clip: None,
        corner_positions: None,
        refinement: None,
    })
    .unwrap();
    let mut i = input(square());
    i.mesh = Some(fit.mesh);
    let o = plan_vector_projection(&i).unwrap();
    assert_eq!(o.report.fidelity, VectorProjectionFidelity::Exact);
    assert!(
        o.network
            .vertices
            .iter()
            .all(|point| point.x <= 40. + 1e-8 || point.y <= 40. + 1e-8)
    );
}
